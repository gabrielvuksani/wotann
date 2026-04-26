import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KairosDaemon, matchesCronSchedule, parseHeartbeatTasks } from "../../src/daemon/kairos.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("KAIROS Daemon (Phase 10)", () => {
  describe("matchesCronSchedule", () => {
    // Wave DH-3: matchesCronSchedule reads UTC components from the Date
    // (src/daemon/cron-utils.ts uses getUTCMinutes/getUTCHours/etc.). Tests
    // MUST construct Dates with explicit UTC strings — `new Date(year, mo,
    // day, hour, min)` constructs in LOCAL time, which makes the test
    // tz-dependent and breaks on any non-UTC machine. ISO "Z" suffix pins
    // the instant to UTC so the assertion is deterministic everywhere.
    it("matches wildcard (every minute)", () => {
      const now = new Date("2026-04-01T08:30:00Z");
      expect(matchesCronSchedule("* * * * *", now)).toBe(true);
    });

    it("matches specific minute and hour", () => {
      const now = new Date("2026-04-01T08:00:00Z");
      expect(matchesCronSchedule("0 8 * * *", now)).toBe(true);
      expect(matchesCronSchedule("30 8 * * *", now)).toBe(false);
    });

    it("matches step values (every 5 minutes)", () => {
      expect(matchesCronSchedule("*/5 * * * *", new Date("2026-01-01T00:00:00Z"))).toBe(true);
      expect(matchesCronSchedule("*/5 * * * *", new Date("2026-01-01T00:05:00Z"))).toBe(true);
      expect(matchesCronSchedule("*/5 * * * *", new Date("2026-01-01T00:03:00Z"))).toBe(false);
    });

    it("matches range values", () => {
      expect(matchesCronSchedule("0 9-17 * * *", new Date("2026-01-01T10:00:00Z"))).toBe(true);
      expect(matchesCronSchedule("0 9-17 * * *", new Date("2026-01-01T20:00:00Z"))).toBe(false);
    });

    it("matches list values", () => {
      expect(matchesCronSchedule("0 8,12,18 * * *", new Date("2026-01-01T12:00:00Z"))).toBe(true);
      expect(matchesCronSchedule("0 8,12,18 * * *", new Date("2026-01-01T14:00:00Z"))).toBe(false);
    });

    it("matches day of week", () => {
      // April 1, 2026 (UTC) is a Wednesday (day 3)
      expect(matchesCronSchedule("0 8 * * 3", new Date("2026-04-01T08:00:00Z"))).toBe(true);
      expect(matchesCronSchedule("0 8 * * 1", new Date("2026-04-01T08:00:00Z"))).toBe(false);
    });

    it("rejects invalid format", () => {
      expect(matchesCronSchedule("bad", new Date())).toBe(false);
    });
  });

  describe("KairosDaemon", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "wotann-kairos-test-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("starts and stops", () => {
      const daemon = new KairosDaemon(join(tempDir, "logs"));
      expect(daemon.getStatus().status).toBe("stopped");

      daemon.start(100);
      expect(daemon.getStatus().status).toBe("running");
      expect(daemon.getStatus().startedAt).toBeDefined();

      daemon.stop();
      expect(daemon.getStatus().status).toBe("stopped");
    });

    it("tracks tick count", async () => {
      vi.useFakeTimers();
      const daemon = new KairosDaemon(join(tempDir, "logs"));
      daemon.start(100);

      vi.advanceTimersByTime(350);
      expect(daemon.getStatus().tickCount).toBe(3);

      daemon.stop();
      vi.useRealTimers();
    });

    it("manages cron jobs", () => {
      const daemon = new KairosDaemon(join(tempDir, "logs"));
      daemon.addCronJob({
        id: "j1", name: "Test Job", schedule: "0 8 * * *",
        command: "echo hello", enabled: true,
      });

      expect(daemon.getStatus().cronJobs).toHaveLength(1);

      daemon.removeCronJob("j1");
      expect(daemon.getStatus().cronJobs).toHaveLength(0);
    });

    it("manages heartbeat tasks", () => {
      const daemon = new KairosDaemon(join(tempDir, "logs"));
      daemon.addHeartbeatTask({
        name: "Check PRs", schedule: "*/30 * * * *", enabled: true,
      });

      expect(daemon.getStatus().heartbeatTasks.length).toBeGreaterThanOrEqual(1);
    });

    it("parses HEARTBEAT.md sections into runnable tasks", () => {
      const tasks = parseHeartbeatTasks([
        "# Heartbeat Schedule",
        "",
        "## On Wake (Every Session Start)",
        "- [ ] Check git status",
        "## Periodic (When Daemon Active)",
        "- [ ] Run health checks",
        "## Nightly (autoDream)",
        "- [ ] Consolidate session memories",
      ].join("\n"), new Date("2026-04-02T08:00:00Z"));

      expect(tasks).toHaveLength(3);
      expect(tasks[0]?.schedule).toBe("on-wake");
      expect(tasks[1]?.schedule).toBe("periodic");
      expect(tasks[2]?.schedule).toBe("nightly");
    });

    it("loads heartbeat tasks from HEARTBEAT.md and runs on-wake tasks at start", () => {
      const logDir = join(tempDir, "logs");
      const daemon = new KairosDaemon(logDir);
      const heartbeatPath = join(tempDir, "HEARTBEAT.md");
      writeFileSync(heartbeatPath, [
        "# Heartbeat Schedule",
        "",
        "## On Wake (Every Session Start)",
        "- [ ] Review memory for relevant context",
      ].join("\n"));

      expect(daemon.loadHeartbeatTasksFromFile(heartbeatPath)).toBe(1);
      daemon.start(10_000);

      const status = daemon.getStatus();
      expect(status.heartbeatTasks.length).toBeGreaterThanOrEqual(1);
      expect(status.heartbeatTasks[0]?.lastRun).toBeInstanceOf(Date);

      daemon.stop();
    });

    it("writes daily log", () => {
      const logDir = join(tempDir, "logs");
      const daemon = new KairosDaemon(logDir);
      daemon.start(10000);
      daemon.stop();

      const today = new Date().toISOString().slice(0, 10);
      const logFile = join(logDir, `${today}.jsonl`);
      expect(existsSync(logFile)).toBe(true);

      const logs = daemon.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2); // start + stop
      expect(logs.some((l) => l.type === "start")).toBe(true);
      expect(logs.some((l) => l.type === "stop")).toBe(true);
    });

    it("prevents double start", () => {
      const daemon = new KairosDaemon(join(tempDir, "logs"));
      daemon.start(10000);
      const firstStart = daemon.getStatus().startedAt;
      daemon.start(10000); // should be no-op
      expect(daemon.getStatus().startedAt).toBe(firstStart);
      daemon.stop();
    });
  });
});
