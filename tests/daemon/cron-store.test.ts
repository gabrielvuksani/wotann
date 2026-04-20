import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

import { CronStore, computeNextFireAt } from "../../src/daemon/cron-store.js";

// Wave 4F: exercise the SQLite-backed cron persistence layer directly.
// These tests cover the CRUD API, crash-recovery, next-fire-at
// computation, and the 60s tick fire loop — all in isolation from the
// KairosDaemon so regressions surface cleanly.

describe("CronStore", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-cron-store-"));
    dbPath = join(tempDir, "cron.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("schema", () => {
    it("creates the cron_jobs table on open", () => {
      const store = new CronStore(dbPath);
      try {
        // Peek the schema via a raw connection — PlanStore-style test
        // pattern ensures the DDL is real, not stubbed.
        const db = new Database(dbPath, { readonly: false });
        try {
          const row = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cron_jobs'")
            .get() as { name: string } | undefined;
          expect(row?.name).toBe("cron_jobs");
        } finally {
          db.close();
        }
      } finally {
        store.close();
      }
    });

    it("enables WAL journal mode", () => {
      const store = new CronStore(dbPath);
      try {
        const db = new Database(dbPath);
        try {
          const mode = db.pragma("journal_mode", { simple: true });
          expect(mode).toBe("wal");
        } finally {
          db.close();
        }
      } finally {
        store.close();
      }
    });
  });

  describe("add/list/get/remove", () => {
    it("adds a cron job and returns the hydrated record", () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({
          name: "echo test",
          schedule: "*/5 * * * *",
          command: "echo hello",
        });
        expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(job.name).toBe("echo test");
        expect(job.schedule).toBe("*/5 * * * *");
        expect(job.enabled).toBe(true);
        expect(job.nextFireAt).not.toBeNull();
      } finally {
        store.close();
      }
    });

    it("persists jobs across reopens (crash resume)", () => {
      const store1 = new CronStore(dbPath);
      let id: string;
      try {
        const job = store1.add({
          name: "persistent",
          schedule: "0 9 * * *",
          command: "echo persistent",
        });
        id = job.id;
      } finally {
        store1.close();
      }

      // Second open simulates daemon restart. The in-memory kairos
      // state is gone; only the DB file survives.
      const store2 = new CronStore(dbPath);
      try {
        const retrieved = store2.get(id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.name).toBe("persistent");
        expect(retrieved?.schedule).toBe("0 9 * * *");
      } finally {
        store2.close();
      }
    });

    it("removes a job and returns true; false for unknown id", () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "a", schedule: "* * * * *", command: "echo a" });
        expect(store.remove(job.id)).toBe(true);
        expect(store.get(job.id)).toBeNull();
        expect(store.remove("nonexistent")).toBe(false);
      } finally {
        store.close();
      }
    });

    it("setEnabled toggles state and recomputes next_fire_at", () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "t", schedule: "* * * * *", command: "echo t" });
        expect(store.setEnabled(job.id, false)).toBe(true);
        const disabled = store.get(job.id);
        expect(disabled?.enabled).toBe(false);
        expect(disabled?.nextFireAt).toBeNull();

        store.setEnabled(job.id, true);
        const enabled = store.get(job.id);
        expect(enabled?.enabled).toBe(true);
        expect(enabled?.nextFireAt).not.toBeNull();
      } finally {
        store.close();
      }
    });
  });

  describe("computeNextFireAt", () => {
    it("returns the next matching minute for '*/5 * * * *'", () => {
      const after = new Date(2026, 3, 19, 10, 0, 30); // 10:00:30
      const next = computeNextFireAt("*/5 * * * *", after);
      expect(next).not.toBeNull();
      const nextDate = new Date(next!);
      // Next minute matching */5 after 10:00:30 is 10:05:00.
      expect(nextDate.getMinutes()).toBe(5);
      expect(nextDate.getSeconds()).toBe(0);
    });

    it("returns null for a malformed schedule", () => {
      expect(computeNextFireAt("not a cron", new Date())).toBeNull();
      expect(computeNextFireAt("* * *", new Date())).toBeNull();
      expect(computeNextFireAt("", new Date())).toBeNull();
    });
  });

  describe("tick (fire loop)", () => {
    it("fires a due job and records success", async () => {
      const store = new CronStore(dbPath);
      try {
        // Create a job, then backdate next_fire_at so the tick fires
        // it deterministically. Use a raw DB handle to set the
        // column since the public API always advances next_fire_at
        // to a future time.
        const job = store.add({ name: "due", schedule: "* * * * *", command: "echo due" });
        const db = new Database(dbPath);
        try {
          db.prepare("UPDATE cron_jobs SET next_fire_at = ? WHERE id = ?").run(
            Date.now() - 1000,
            job.id,
          );
        } finally {
          db.close();
        }

        let fired = false;
        store.setExecuteHandler(() => {
          fired = true;
        });

        const result = await store.tick();
        expect(fired).toBe(true);
        expect(result).toHaveLength(1);
        expect(result[0]?.lastResult).toBe("success");

        const refreshed = store.get(job.id);
        expect(refreshed?.lastResult).toBe("success");
        expect(refreshed?.lastFiredAt).not.toBeNull();
        // next_fire_at advanced to the future.
        expect(refreshed?.nextFireAt).toBeGreaterThan(Date.now() - 60_000);
      } finally {
        store.close();
      }
    });

    it("records failure when the handler throws", async () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "fail", schedule: "* * * * *", command: "echo f" });
        const db = new Database(dbPath);
        try {
          db.prepare("UPDATE cron_jobs SET next_fire_at = ? WHERE id = ?").run(
            Date.now() - 1000,
            job.id,
          );
        } finally {
          db.close();
        }

        store.setExecuteHandler(() => {
          throw new Error("boom");
        });

        const result = await store.tick();
        expect(result[0]?.lastResult).toBe("failure");
      } finally {
        store.close();
      }
    });

    it("records failure (not silent success) when no handler is wired", async () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "nohandler", schedule: "* * * * *", command: "echo" });
        const db = new Database(dbPath);
        try {
          db.prepare("UPDATE cron_jobs SET next_fire_at = ? WHERE id = ?").run(
            Date.now() - 1000,
            job.id,
          );
        } finally {
          db.close();
        }

        const result = await store.tick();
        expect(result[0]?.lastResult).toBe("failure");
      } finally {
        store.close();
      }
    });

    it("skips jobs whose schedule becomes malformed (honest disable, not fire)", async () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "bad", schedule: "* * * * *", command: "echo" });
        // Corrupt the schedule directly in the DB — simulates a bad
        // migration or manual edit. The tick must not fire it.
        const db = new Database(dbPath);
        try {
          db.prepare(
            "UPDATE cron_jobs SET cron_expr = 'garbage', next_fire_at = ? WHERE id = ?",
          ).run(Date.now() - 1000, job.id);
        } finally {
          db.close();
        }

        let fired = false;
        store.setExecuteHandler(() => {
          fired = true;
        });

        const result = await store.tick();
        expect(fired).toBe(false);
        expect(result).toHaveLength(0);
        const after = store.get(job.id);
        expect(after?.enabled).toBe(false);
      } finally {
        store.close();
      }
    });
  });

  describe("recoverStuckJobs (crash recovery)", () => {
    it("flags jobs whose last_fired_at is >24h behind next_fire_at", () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "stuck", schedule: "0 9 * * *", command: "echo" });

        // Backdate last_fired_at to 3 days ago and next_fire_at to 1 day
        // ago — a dead daemon failed to run the 1-day-old scheduled
        // window, and we're detecting it now. Gap between the two
        // timestamps is 2 days (>24h threshold).
        const db = new Database(dbPath);
        try {
          db.prepare(
            "UPDATE cron_jobs SET last_fired_at = ?, next_fire_at = ? WHERE id = ?",
          ).run(Date.now() - 3 * 86_400_000, Date.now() - 86_400_000, job.id);
        } finally {
          db.close();
        }

        const captured: Array<{ id: string; gap: number }> = [];
        store.setStuckJobHandler((j, gap) => {
          captured.push({ id: j.id, gap });
        });

        const stuck = store.recoverStuckJobs();
        expect(stuck).toHaveLength(1);
        expect(captured).toHaveLength(1);
        expect(captured[0]?.id).toBe(job.id);
        expect(captured[0]?.gap).toBeGreaterThan(86_400_000); // >24h
      } finally {
        store.close();
      }
    });

    it("reschedules enabled jobs whose next_fire_at is in the past", () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "past", schedule: "*/10 * * * *", command: "echo" });

        // Backdate next_fire_at to 5 minutes ago — the daemon was off
        // when the window passed. Recovery should reset it to a
        // future time without firing the job.
        const now = Date.now();
        const past = now - 5 * 60_000;
        const db = new Database(dbPath);
        try {
          db.prepare("UPDATE cron_jobs SET next_fire_at = ? WHERE id = ?").run(past, job.id);
        } finally {
          db.close();
        }

        store.recoverStuckJobs();
        const refreshed = store.get(job.id);
        expect(refreshed?.nextFireAt).not.toBeNull();
        expect(refreshed?.nextFireAt!).toBeGreaterThan(now);
      } finally {
        store.close();
      }
    });

    it("fills in NULL next_fire_at for legacy rows", () => {
      const store = new CronStore(dbPath);
      try {
        const job = store.add({ name: "legacy", schedule: "0 9 * * *", command: "echo" });
        const db = new Database(dbPath);
        try {
          db.prepare("UPDATE cron_jobs SET next_fire_at = NULL WHERE id = ?").run(job.id);
        } finally {
          db.close();
        }

        store.recoverStuckJobs();
        const refreshed = store.get(job.id);
        expect(refreshed?.nextFireAt).not.toBeNull();
      } finally {
        store.close();
      }
    });
  });

  describe("lifecycle", () => {
    it("start/stop are idempotent", () => {
      const store = new CronStore(dbPath);
      try {
        expect(store.isRunning()).toBe(false);
        store.start(1_000_000); // giant interval — tick never fires in test
        expect(store.isRunning()).toBe(true);
        store.start(1_000_000); // no-op
        expect(store.isRunning()).toBe(true);
        store.stop();
        expect(store.isRunning()).toBe(false);
        store.stop(); // no-op
      } finally {
        store.close();
      }
    });

    it("close() shuts the DB file's WAL cleanly", () => {
      const store = new CronStore(dbPath);
      store.add({ name: "x", schedule: "* * * * *", command: "echo" });
      store.close();
      // A subsequent fresh open must succeed — WAL was checkpointed.
      const reopen = new CronStore(dbPath);
      try {
        expect(reopen.list()).toHaveLength(1);
      } finally {
        reopen.close();
      }
    });

    it("countEnabled reports only enabled jobs", () => {
      const store = new CronStore(dbPath);
      try {
        const j1 = store.add({ name: "a", schedule: "* * * * *", command: "echo" });
        store.add({ name: "b", schedule: "* * * * *", command: "echo" });
        expect(store.countEnabled()).toBe(2);
        store.setEnabled(j1.id, false);
        expect(store.countEnabled()).toBe(1);
      } finally {
        store.close();
      }
    });

    it("exposes the db path via getDbPath", () => {
      const store = new CronStore(dbPath);
      try {
        expect(store.getDbPath()).toBe(dbPath);
        expect(existsSync(dbPath)).toBe(true);
      } finally {
        store.close();
      }
    });
  });
});
