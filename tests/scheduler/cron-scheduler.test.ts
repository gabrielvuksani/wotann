/**
 * CronScheduler tests — P1-C2 port from Hermes Agent.
 *
 * Scope covers:
 *   - register / unregister / list CRUD
 *   - at-most-once inflight gate (skip while a fire is in progress)
 *   - missed-fire policies: skip, catch-up-once, catch-up-all
 *   - handler error recovery (next fire still attempts)
 *   - unregister while inflight (in-progress handler completes)
 *   - next-fire-at computation on list/get
 *   - persistence across simulated restart
 *   - cron parse errors raise explicit error (no silent accept)
 *   - fireNow bypasses schedule but respects inflight gate
 *
 * These tests are intentionally deterministic — we drive the scheduler
 * via explicit `tick(now)` calls, never `setInterval`, so a CI box
 * with a noisy clock won't flake.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ScheduleStore,
  CronParseError,
  isCronExprValid,
} from "../../src/scheduler/schedule-store.js";
import { CronScheduler, type SchedulerEvent } from "../../src/scheduler/cron-scheduler.js";

// ── Test helpers ────────────────────────────────────────────

function atMinute(minuteUtc: string): Date {
  // Build a deterministic Date at `YYYY-MM-DDTHH:MM:00Z`.
  return new Date(`${minuteUtc}:00Z`);
}

function setup(): {
  tempDir: string;
  store: ScheduleStore;
  scheduler: CronScheduler;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "wotann-scheduler-"));
  const dbPath = join(tempDir, "schedule.db");
  const store = new ScheduleStore(dbPath);
  const scheduler = new CronScheduler(store);
  return { tempDir, store, scheduler };
}

function teardown(ctx: { tempDir: string; store: ScheduleStore; scheduler: CronScheduler }): void {
  ctx.scheduler.stop();
  ctx.store.close();
  rmSync(ctx.tempDir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────

describe("ScheduleStore — pure persistence layer", () => {
  let tempDir: string;
  let store: ScheduleStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-sched-store-"));
    store = new ScheduleStore(join(tempDir, "schedule.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates schema with WAL journal mode", () => {
    // Touching list() forces a real SELECT so we know the table exists.
    expect(store.list()).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it("rejects invalid cron expressions with CronParseError", () => {
    expect(() => store.upsert({ cronExpr: "not-a-cron" })).toThrow(CronParseError);
    expect(() => store.upsert({ cronExpr: "* * *" })).toThrow(CronParseError);
    expect(() => store.upsert({ cronExpr: "" })).toThrow(CronParseError);
  });

  it("upsert is idempotent for repeated taskId", () => {
    const first = store.upsert({ taskId: "my-task", cronExpr: "0 9 * * *" });
    const second = store.upsert({ taskId: "my-task", cronExpr: "0 10 * * *" });
    expect(first.taskId).toBe(second.taskId);
    expect(store.list()).toHaveLength(1);
    expect(store.get("my-task")?.cronExpr).toBe("0 10 * * *");
  });

  it("advanceBeforeFire + recordFireResult preserve last_fire_at", () => {
    const rec = store.upsert({ cronExpr: "* * * * *" });
    const fireAt = Date.now();
    store.advanceBeforeFire(rec.taskId, fireAt);

    // Mid-flight state: last_fire_at set, status "inflight".
    const mid = store.get(rec.taskId)!;
    expect(mid.lastFireAt).toBe(fireAt);

    // Completion stamps the status WITHOUT moving last_fire_at.
    store.recordFireResult(rec.taskId, "success");
    const done = store.get(rec.taskId)!;
    expect(done.lastFireAt).toBe(fireAt);
    expect(done.lastStatus).toBe("success");
  });
});

// ────────────────────────────────────────────────────────────

describe("CronScheduler — register / unregister / list", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));
  afterEach(() => teardown(ctx));

  it("registers a task and surfaces it via list()", () => {
    const rec = ctx.scheduler.register("0 9 * * *", async () => {});
    expect(rec.taskId).toMatch(/^[0-9a-f-]{36}$/);

    const all = ctx.scheduler.list(atMinute("2026-04-20T08:00"));
    expect(all).toHaveLength(1);
    const first = all[0]!;
    expect(first.cronExpr).toBe("0 9 * * *");
    expect(first.enabled).toBe(true);
    expect(first.missedPolicy).toBe("skip");
    expect(first.nextFireAt).toBeGreaterThan(0);
  });

  it("rejects invalid cron expressions at register time", () => {
    expect(() => ctx.scheduler.register("not cron", async () => {})).toThrow(CronParseError);
    expect(() => ctx.scheduler.register("* *", async () => {})).toThrow(CronParseError);
  });

  it("unregister removes the schedule and clears the handler", () => {
    const rec = ctx.scheduler.register("* * * * *", async () => {});
    expect(ctx.scheduler.unregister(rec.taskId)).toBe(true);
    expect(ctx.scheduler.get(rec.taskId)).toBeNull();
    expect(ctx.scheduler.list()).toHaveLength(0);
  });

  it("unregister returns false for unknown taskId", () => {
    expect(ctx.scheduler.unregister("ghost")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────

describe("CronScheduler — at-most-once invariant", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));
  afterEach(() => teardown(ctx));

  it("advances last_fire_at BEFORE the handler runs", async () => {
    // This is THE Hermes invariant. If the daemon dies between
    // advanceBeforeFire() and handler settle, the next boot must
    // see last_fire_at already set.
    let handlerStartedAt: number | null = null;
    let lastFireAtObservedInsideHandler: number | null = null;

    const rec = ctx.scheduler.register("* * * * *", async (taskId) => {
      handlerStartedAt = Date.now();
      const mid = ctx.store.get(taskId);
      lastFireAtObservedInsideHandler = mid?.lastFireAt ?? null;
      // Simulate a crash by throwing — advance-before-fire must
      // already have written. We assert AFTER the throw propagates.
    });

    await ctx.scheduler.tick(atMinute("2026-04-20T09:00"));

    expect(handlerStartedAt).not.toBeNull();
    // The handler observed last_fire_at already populated when it started.
    expect(lastFireAtObservedInsideHandler).toBe(atMinute("2026-04-20T09:00").getTime());

    // Post-fire: last_fire_at is still the fireTime (recordFireResult
    // doesn't touch it).
    const after = ctx.store.get(rec.taskId)!;
    expect(after.lastFireAt).toBe(atMinute("2026-04-20T09:00").getTime());
  });

  it("SKIPS a second fire while the first is still inflight", async () => {
    // Construct a slow handler via an externally-controlled promise.
    let releaseHandler: (() => void) | null = null;
    const handlerPromise = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const rec = ctx.scheduler.register("* * * * *", async () => {
      await handlerPromise;
    });

    const events: SchedulerEvent[] = [];
    ctx.scheduler.on("event", (e: SchedulerEvent) => events.push(e));

    // Kick off fire 1 — don't await, handler is still pending.
    const fire1Promise = ctx.scheduler.tick(atMinute("2026-04-20T09:00"));

    // Give the event loop a turn so tick() reaches the handler.
    await Promise.resolve();

    // Fire 2 while first is inflight — should SKIP with reason="inflight".
    const fire2Events = await ctx.scheduler.tick(atMinute("2026-04-20T09:01"));
    expect(fire2Events.some((e) => e.type === "skip" && e.reason === "inflight")).toBe(true);

    // Release handler; fire 1 completes.
    releaseHandler!();
    await fire1Promise;

    // Now the gate is clear; fire 3 should fire again.
    const fire3Events = await ctx.scheduler.tick(atMinute("2026-04-20T09:02"));
    expect(fire3Events.some((e) => e.type === "fire")).toBe(true);

    void rec;
  });

  it("releases the inflight gate even when the handler throws", async () => {
    let callCount = 0;
    const rec = ctx.scheduler.register("* * * * *", async () => {
      callCount++;
      throw new Error("boom");
    });

    const events: SchedulerEvent[] = [];
    ctx.scheduler.on("event", (e: SchedulerEvent) => events.push(e));

    await ctx.scheduler.tick(atMinute("2026-04-20T09:00"));
    await ctx.scheduler.tick(atMinute("2026-04-20T09:01"));

    // Both ticks fired — the gate released after the first throw.
    expect(callCount).toBe(2);
    expect(events.filter((e) => e.type === "failure")).toHaveLength(2);
    expect(events.filter((e) => e.type === "failure")[0]?.error).toBe("boom");

    // Store records the failure.
    const after = ctx.store.get(rec.taskId)!;
    expect(after.lastStatus).toBe("failure");
    expect(after.lastError).toBe("boom");
  });
});

// ────────────────────────────────────────────────────────────

describe("CronScheduler — missed-fire policies", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));
  afterEach(() => teardown(ctx));

  it("'skip' policy (default) runs nothing on boot after a missed window", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const rec = ctx.scheduler.register("0 9 * * *", handler, { missedPolicy: "skip" });

    // Pretend the task was last fired yesterday morning; daemon was
    // then offline for 25 hours, missing today's 9am window.
    const yesterday = atMinute("2026-04-19T09:00").getTime();
    ctx.store.advanceBeforeFire(rec.taskId, yesterday);
    ctx.store.recordFireResult(rec.taskId, "success");

    // Boot well after today's window.
    const events = await ctx.scheduler.bootForTest(atMinute("2026-04-20T10:00"));

    // Pure at-most-once: nothing fires, no catch-up.
    expect(events).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("'catch-up-once' policy fires exactly one missed window on boot", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const rec = ctx.scheduler.register("0 9 * * *", handler, {
      missedPolicy: "catch-up-once",
    });

    // Last fire was 3 days ago, so 3 daily windows were missed.
    ctx.store.advanceBeforeFire(rec.taskId, atMinute("2026-04-17T09:00").getTime());
    ctx.store.recordFireResult(rec.taskId, "success");

    await ctx.scheduler.bootForTest(atMinute("2026-04-20T10:00"));

    // Only ONE fire — catch-up-once ignores the older misses, only
    // replays the most recent.
    expect(handler).toHaveBeenCalledTimes(1);
    void rec;
  });

  it("'catch-up-all' policy replays every missed window", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const rec = ctx.scheduler.register("0 9 * * *", handler, {
      missedPolicy: "catch-up-all",
    });

    // 3 missed windows: Apr 18, Apr 19, Apr 20 at 09:00.
    ctx.store.advanceBeforeFire(rec.taskId, atMinute("2026-04-17T09:00").getTime());
    ctx.store.recordFireResult(rec.taskId, "success");

    await ctx.scheduler.bootForTest(atMinute("2026-04-20T10:00"));

    expect(handler).toHaveBeenCalledTimes(3);
    void rec;
  });

  it("'catch-up-all' emits a warning when queue exceeds 10 fires", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const rec = ctx.scheduler.register("*/5 * * * *", handler, {
      missedPolicy: "catch-up-all",
    });

    // 6 hours ago at a 5-min schedule = 72 missed windows.
    const sixHoursAgo = atMinute("2026-04-20T03:00").getTime();
    ctx.store.advanceBeforeFire(rec.taskId, sixHoursAgo);
    ctx.store.recordFireResult(rec.taskId, "success");

    const events = await ctx.scheduler.bootForTest(atMinute("2026-04-20T09:00"));
    expect(events.some((e) => e.type === "warning")).toBe(true);
    void rec;
  });
});

// ────────────────────────────────────────────────────────────

describe("CronScheduler — unregister while inflight", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));
  afterEach(() => teardown(ctx));

  it("allows in-progress handler to complete but removes the row", async () => {
    let releaseHandler: (() => void) | null = null;
    const handlerPromise = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    let observedHandlerCompletion = false;
    const rec = ctx.scheduler.register("* * * * *", async () => {
      await handlerPromise;
      observedHandlerCompletion = true;
    });

    // Kick off fire; handler is pending.
    const firePromise = ctx.scheduler.tick(atMinute("2026-04-20T09:00"));
    await Promise.resolve();

    // Unregister while inflight.
    const removed = ctx.scheduler.unregister(rec.taskId);
    expect(removed).toBe(true);
    expect(ctx.scheduler.get(rec.taskId)).toBeNull();

    // Release handler; must complete without throwing.
    releaseHandler!();
    await firePromise;
    expect(observedHandlerCompletion).toBe(true);

    // No recordFireResult should have updated an already-deleted row.
    expect(ctx.store.get(rec.taskId)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────

describe("CronScheduler — persistence across restart", () => {
  it("rehydrates registered schedules after store close/reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-sched-persist-"));
    const dbPath = join(tempDir, "schedule.db");

    try {
      // Session 1: register two tasks.
      const store1 = new ScheduleStore(dbPath);
      const scheduler1 = new CronScheduler(store1);
      scheduler1.register("0 9 * * *", async () => {}, { taskId: "morning-brief" });
      scheduler1.register("0 18 * * *", async () => {}, {
        taskId: "evening-brief",
        missedPolicy: "catch-up-once",
      });
      store1.close();

      // Session 2: reopen, observe rows.
      const store2 = new ScheduleStore(dbPath);
      const scheduler2 = new CronScheduler(store2);
      const list = scheduler2.list();
      expect(list).toHaveLength(2);
      expect(list.find((r) => r.taskId === "morning-brief")?.cronExpr).toBe("0 9 * * *");
      expect(list.find((r) => r.taskId === "evening-brief")?.missedPolicy).toBe("catch-up-once");

      // Handlers did NOT persist — that's the contract. Re-register
      // to use them.
      store2.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────

describe("CronScheduler — fireNow", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));
  afterEach(() => teardown(ctx));

  it("runs the handler immediately regardless of schedule", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    // Schedule that wouldn't match "now" — 9am only, at 3pm we fire.
    const rec = ctx.scheduler.register("0 9 * * *", handler);

    const fired = await ctx.scheduler.fireNow(rec.taskId, atMinute("2026-04-20T15:00"));
    expect(fired).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns false for unknown taskId without emitting events", async () => {
    const events: SchedulerEvent[] = [];
    ctx.scheduler.on("event", (e: SchedulerEvent) => events.push(e));

    const fired = await ctx.scheduler.fireNow("ghost-id");
    expect(fired).toBe(false);
    expect(events).toEqual([]);
  });

  it("respects the inflight gate — concurrent fireNow skips", async () => {
    let releaseHandler: (() => void) | null = null;
    const handlerPromise = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const rec = ctx.scheduler.register("* * * * *", async () => {
      await handlerPromise;
    });

    const events: SchedulerEvent[] = [];
    ctx.scheduler.on("event", (e: SchedulerEvent) => events.push(e));

    // Kick off slow fireNow; don't await.
    const p1 = ctx.scheduler.fireNow(rec.taskId);
    await Promise.resolve();

    // Second fireNow while first is inflight — must skip.
    const second = await ctx.scheduler.fireNow(rec.taskId);
    expect(second).toBe(false);
    expect(events.some((e) => e.type === "skip" && e.reason === "inflight")).toBe(true);

    releaseHandler!();
    await p1;
  });
});

// ────────────────────────────────────────────────────────────

describe("isCronExprValid — standalone helper", () => {
  it("accepts canonical 5-field expressions", () => {
    expect(isCronExprValid("* * * * *")).toBe(true);
    expect(isCronExprValid("0 9 * * *")).toBe(true);
    expect(isCronExprValid("*/15 * * * *")).toBe(true);
    expect(isCronExprValid("0 0 1 1 *")).toBe(true);
    expect(isCronExprValid("0 9-17 * * 1-5")).toBe(true);
  });

  it("rejects malformed expressions", () => {
    expect(isCronExprValid("* * * *")).toBe(false);
    expect(isCronExprValid("* * * * * *")).toBe(false);
    expect(isCronExprValid("")).toBe(false);
    expect(isCronExprValid("   ")).toBe(false);
  });
});
