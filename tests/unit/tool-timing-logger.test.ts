import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ToolTimingBaseline,
  ToolTimingLogger,
  withTiming,
} from "../../src/tools/tool-timing.js";

/**
 * Wave 4G: tool-timing logger tests. Cover the JSONL sink + withTiming
 * wrapper that now backs every dispatched runtime tool so
 * `.wotann/tool-timing.jsonl` carries honest per-tool latency data.
 */
describe("ToolTimingLogger", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends one JSONL row per record() call", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-tt-"));
    const path = join(tempDir, "tool-timing.jsonl");
    const logger = new ToolTimingLogger(path);

    logger.record({
      timestamp: Date.now(),
      toolName: "bash",
      durationMs: 120,
      success: true,
    });
    logger.record({
      timestamp: Date.now(),
      toolName: "web_fetch",
      durationMs: 820,
      success: false,
      errorMessage: "timeout",
    });

    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first["toolName"]).toBe("bash");
    expect(first["durationMs"]).toBe(120);
    expect(first["success"]).toBe(true);

    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(second["errorMessage"]).toBe("timeout");
    expect(second["success"]).toBe(false);
  });

  it("annotates entries with baselineMs when baseline tracker provided", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-tt-"));
    const path = join(tempDir, "tool-timing.jsonl");
    const baseline = new ToolTimingBaseline(5);
    const logger = new ToolTimingLogger(path, baseline);

    // Need ≥3 samples before baseline() returns anything.
    for (const d of [100, 110, 120, 130]) {
      logger.record({ timestamp: Date.now(), toolName: "bash", durationMs: d, success: true });
    }

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    // Baseline for first 3 samples (100,110,120) = 110; fourth call is
    // recorded after baseline() reads. Just verify the field shows up.
    expect(typeof last["baselineMs"]).toBe("number");
  });

  it("swallows filesystem errors silently (best-effort)", () => {
    // Unwritable path. Previous fixture was `/proc/invalid/does/not/...`
    // which had OS-specific behaviour: macOS mkdirSync errors instantly,
    // but Linux's /proc filesystem is virtual and node ≥22's mkdirSync
    // recursive walk hung the vitest forks worker on shard 4 in CI for
    // 7+ minutes (verified via load-tracer 2026-04-26). Use a path that
    // always fails fast on every OS instead — a regular file masquerading
    // as a parent directory triggers ENOTDIR immediately.
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-tt-blocked-"));
    const blocker = join(tempDir, "blocker");
    require("node:fs").writeFileSync(blocker, "x");
    const logger = new ToolTimingLogger(join(blocker, "child.jsonl"));
    expect(() =>
      logger.record({
        timestamp: Date.now(),
        toolName: "bash",
        durationMs: 50,
        success: true,
      }),
    ).not.toThrow();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("withTiming wrapper", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("logs success with positive durationMs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-tt-"));
    const path = join(tempDir, "tool-timing.jsonl");
    const logger = new ToolTimingLogger(path);

    const wrapped = withTiming(
      async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return x * 2;
      },
      "multiply",
      logger,
      "session-abc",
    );

    const result = await wrapped(5);
    expect(result).toBe(10);

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry["toolName"]).toBe("multiply");
    expect(entry["sessionId"]).toBe("session-abc");
    expect(entry["success"]).toBe(true);
    expect(Number(entry["durationMs"])).toBeGreaterThanOrEqual(10);
  });

  it("logs failure with errorMessage and re-throws", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-tt-"));
    const path = join(tempDir, "tool-timing.jsonl");
    const logger = new ToolTimingLogger(path);

    const wrapped = withTiming(
      async () => {
        throw new Error("boom");
      },
      "broken",
      logger,
    );

    await expect(wrapped()).rejects.toThrow("boom");

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry["success"]).toBe(false);
    expect(entry["errorMessage"]).toBe("boom");
  });
});
