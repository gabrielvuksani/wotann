/**
 * CronScheduler — Hermes-style task scheduler with at-most-once semantics.
 *
 * Maps WOTANN's user-facing "Schedule" surface (per CLAUDE.md) to
 * Hermes Agent's `cron/scheduler.py` port (research doc §4.4, §5.3).
 *
 * Core invariants (these are the whole point of this module):
 *
 *   1. **At-most-once**: `advance_last_fire_at()` runs BEFORE the handler.
 *      If the daemon crashes mid-run, the schedule has already moved
 *      forward, so the next tick doesn't replay. This matches Hermes's
 *      `advance_next_run()` + `run_job()` ordering — one-line invariant,
 *      huge UX consequences (no runaway replay storms after a crash).
 *
 *   2. **Inflight gate**: Per-taskId `Map<taskId, boolean>` tracked in
 *      memory. If a fire is in progress and the cron matches again,
 *      the overlap fire is SKIPPED (not queued). Hermes achieves this
 *      through a cross-process file lock; we use an in-process gate
 *      because a single daemon owns all scheduling. The gate is
 *      emitted as a `skip` event with reason `inflight`.
 *
 *   3. **Missed-fire policy**:
 *        - `skip` (default, pure at-most-once) — daemon was down across
 *          one or more scheduled windows, nothing runs on boot. Just
 *          recompute next_fire and carry on.
 *        - `catch-up-once` — on boot, if last_fire_at < any matched
 *          window, fire exactly once for the most recent missed
 *          window. Useful for daily summaries that should still appear
 *          even if the daemon was offline at midnight.
 *        - `catch-up-all` — replay every missed window. Hermes warns
 *          against this for frequent schedules; we honour the caller's
 *          explicit choice but emit a warning event if the catch-up
 *          queue exceeds 10 fires.
 *
 *   4. **Honest failures**: Handler errors are recorded with
 *      `last_status = "failure"` and `last_error = err.message`. The
 *      inflight gate releases in a `finally` so one crashing handler
 *      doesn't permanently lock the task.
 *
 *   5. **Observability**: All fire/skip/success/failure transitions
 *      emit typed events via `.on()`. The daemon wires these into its
 *      daily JSONL audit log; the CLI wires them into the TUI live
 *      scheduler panel.
 *
 * This module intentionally has NO knowledge of:
 *   - child_process or command strings — handlers are caller-supplied
 *     functions. Daemon wiring lives in `kairos.ts` where execFile has
 *     always lived.
 *   - File lock semantics (`flock` / `msvcrt.locking`) — WOTANN's
 *     single-daemon topology means an in-process Map suffices. If we
 *     ever run multiple daemons on one `.wotann/` directory,
 *     ScheduleStore's `last_status = "inflight"` column is the
 *     primitive we'll build the cross-process gate from.
 */

import { EventEmitter } from "node:events";
import {
  ScheduleStore,
  CronParseError,
  type ScheduleRecord,
  type MissedFirePolicy,
  isCronExprValid,
} from "./schedule-store.js";
import { computeNextFireAt } from "../daemon/cron-store.js";
import { matchesCronSchedule } from "../daemon/cron-utils.js";

// ── Types ────────────────────────────────────────────────────

/**
 * A scheduled handler. Receives the taskId so one handler function
 * can back multiple registrations (Hermes pattern: one "run_agent"
 * handler wired to every cron-triggered session).
 */
export type ScheduleHandler = (taskId: string) => void | Promise<void>;

/**
 * Structured event emitted on every scheduler transition. Surfaced
 * verbatim to the daemon's audit log. `timestamp` is ms-precision.
 */
export interface SchedulerEvent {
  readonly type: "fire" | "skip" | "success" | "failure" | "warning";
  readonly taskId: string;
  readonly timestamp: number;
  readonly reason?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface RegisterOptions {
  readonly taskId?: string;
  readonly missedPolicy?: MissedFirePolicy;
  readonly enabled?: boolean;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface ScheduleDescriptor {
  readonly taskId: string;
  readonly cronExpr: string;
  readonly missedPolicy: MissedFirePolicy;
  readonly enabled: boolean;
  readonly lastFireAt: number | null;
  readonly lastStatus: ScheduleRecord["lastStatus"];
  readonly lastError: string | null;
  readonly nextFireAt: number | null;
  readonly inflight: boolean;
}

// ── CronScheduler ──────────────────────────────────────────

export class CronScheduler extends EventEmitter {
  private readonly store: ScheduleStore;

  /** Handlers live in-process; restart forces re-registration. */
  private readonly handlers = new Map<string, ScheduleHandler>();

  /**
   * In-process at-most-once gate. Key = taskId, value = true while a
   * fire is in progress. Missing key = not inflight. Map avoids the
   * "is undefined falsy? is null falsy?" trap that a plain object
   * would invite.
   */
  private readonly inflight = new Map<string, boolean>();

  private tickHandle: ReturnType<typeof setInterval> | null = null;

  constructor(store: ScheduleStore) {
    super();
    this.store = store;
  }

  // ── Lifecycle ──────────────────────────────────────────

  /**
   * Start the periodic tick. Default interval is 60s — matches the
   * minute-precision of 5-field cron. Tests pass smaller intervals
   * via `startForTest()` below; production code should use `start()`.
   */
  start(intervalMs: number = 60_000, now: Date = new Date()): void {
    if (this.tickHandle) return;
    // Run missed-fire recovery FIRST so catch-up-once/catch-up-all
    // surfaces appear before the first tick fires live schedules.
    void this.runMissedFireRecovery(now);
    this.tickHandle = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  /**
   * Convenience for tests — synchronous recovery, no interval.
   * The caller drives time via explicit `tick(at)` calls.
   */
  async bootForTest(now: Date): Promise<readonly SchedulerEvent[]> {
    return this.runMissedFireRecovery(now);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  isRunning(): boolean {
    return this.tickHandle !== null;
  }

  // ── Handler registry ──────────────────────────────────

  /**
   * Register a task with a cron schedule and a handler. Persists the
   * schedule to SQLite; handler stays in memory keyed by the returned
   * taskId.
   *
   * Idempotent: re-registering the same taskId updates the cronExpr
   * and replaces the handler. The persisted last_fire_at / last_status
   * are preserved so restart + re-register doesn't reset state.
   */
  register(
    cronExpr: string,
    handler: ScheduleHandler,
    options: RegisterOptions = {},
  ): ScheduleRecord {
    if (!isCronExprValid(cronExpr)) {
      throw new CronParseError(cronExpr, "must be 5 whitespace-separated fields");
    }
    // upsert handles the ID assignment and idempotence.
    const upsertParams: Parameters<ScheduleStore["upsert"]>[0] = {
      cronExpr,
      ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
      ...(options.missedPolicy !== undefined ? { missedPolicy: options.missedPolicy } : {}),
      ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
      ...(options.options !== undefined ? { options: options.options } : {}),
    };
    const record = this.store.upsert(upsertParams);
    this.handlers.set(record.taskId, handler);
    return record;
  }

  /**
   * Remove a task. If the task is currently in-flight, the handler
   * is allowed to complete; the registry row is deleted but the
   * inflight gate is respected so the handler doesn't run again
   * after completion (post-settle recheck reads the store).
   *
   * Returns true if a row was removed from the store.
   */
  unregister(taskId: string): boolean {
    const removed = this.store.remove(taskId);
    this.handlers.delete(taskId);
    // Don't touch this.inflight — if a fire is in progress, the
    // settle path will see the row is gone and skip post-fire
    // bookkeeping. If we cleared the gate here, a second tick during
    // the handler could register a new handler for the same id and
    // fire it concurrently with the first — defeats at-most-once.
    return removed;
  }

  /**
   * List all registered schedules with derived fields (next_fire_at,
   * inflight state). Order matches insertion order (ScheduleStore
   * sorts by created_at ASC).
   */
  list(now: Date = new Date()): readonly ScheduleDescriptor[] {
    return this.store.list().map((record) => this.describe(record, now));
  }

  /**
   * Describe a single task. Returns null if the taskId is unknown.
   */
  get(taskId: string, now: Date = new Date()): ScheduleDescriptor | null {
    const record = this.store.get(taskId);
    if (!record) return null;
    return this.describe(record, now);
  }

  /**
   * Fire a task immediately, bypassing the cron schedule. Respects
   * the inflight gate — concurrent fires still skip. Useful for
   * CLI `wotann schedule fire <id>` and iOS manual triggers.
   *
   * If the task is unknown, returns false without emitting anything.
   */
  async fireNow(taskId: string, now: Date = new Date()): Promise<boolean> {
    const record = this.store.get(taskId);
    if (!record) return false;
    if (!this.handlers.has(taskId)) {
      // Registered in store but no handler in memory (e.g. daemon
      // restarted and the owner module hasn't re-registered). Emit
      // a skip so the caller sees why nothing happened.
      this.emitEvent({
        type: "skip",
        taskId,
        timestamp: now.getTime(),
        reason: "no_handler",
      });
      return false;
    }
    return this.executeFire(record, now, "manual");
  }

  // ── Tick ────────────────────────────────────────────────

  /**
   * Fire every enabled task whose cron expression matches `now` and
   * isn't inflight. Exposed for tests so they can drive time directly.
   *
   * Returns the events emitted during this tick, in order. Production
   * callers don't need the return value — consume via `.on('event')`.
   */
  async tick(now: Date = new Date()): Promise<readonly SchedulerEvent[]> {
    const events: SchedulerEvent[] = [];
    const records = this.store.list();

    for (const record of records) {
      if (!record.enabled) continue;
      // Schedule is already validated at register/upsert time, but
      // matchesCronSchedule is the source of truth for minute-level
      // match. Same parser that `computeNextFireAt` used.
      if (!matchesCronSchedule(record.cronExpr, now)) continue;

      const captured = await this.executeFire(record, now, "scheduled", events);
      // executeFire already pushed to events if it fired/skipped;
      // captured is unused here.
      void captured;
    }

    return events;
  }

  /**
   * Missed-fire recovery. Called once at scheduler.start() and
   * exposed for `bootForTest`. For each enabled task:
   *   - `skip`: do nothing (pure at-most-once)
   *   - `catch-up-once`: if lastFireAt < most-recent-match, fire once
   *   - `catch-up-all`: enumerate every match between lastFireAt and
   *     now, fire in order. Emit warning if > 10 fires pending.
   *
   * Recovery is sequential (not parallel) so the handler sees fires
   * in schedule order. This matters for audit trails where ordering
   * is part of the story.
   */
  async runMissedFireRecovery(now: Date): Promise<readonly SchedulerEvent[]> {
    const events: SchedulerEvent[] = [];
    for (const record of this.store.list()) {
      if (!record.enabled) continue;
      if (record.missedPolicy === "skip") continue;
      if (!this.handlers.has(record.taskId)) continue;

      const lastFire = record.lastFireAt ?? record.createdAt;
      const missed = this.enumerateMatches(record.cronExpr, lastFire, now.getTime());
      if (missed.length === 0) continue;

      if (record.missedPolicy === "catch-up-once") {
        // Fire exactly the most recent missed window.
        const latest = missed[missed.length - 1];
        if (latest === undefined) continue;
        const fireTime = new Date(latest);
        await this.executeFire(record, fireTime, "catch-up-once", events);
      } else if (record.missedPolicy === "catch-up-all") {
        if (missed.length > 10) {
          const warn: SchedulerEvent = {
            type: "warning",
            taskId: record.taskId,
            timestamp: now.getTime(),
            reason: `catch-up-all would fire ${missed.length} times`,
          };
          events.push(warn);
          this.emitEvent(warn);
        }
        for (const ts of missed) {
          await this.executeFire(record, new Date(ts), "catch-up-all", events);
        }
      }
    }
    return events;
  }

  // ── Internals ──────────────────────────────────────────

  /**
   * The core fire loop. Handles:
   *   1. Inflight gate check (skip if already running)
   *   2. ADVANCE last_fire_at BEFORE calling handler (at-most-once)
   *   3. Run handler, catch errors
   *   4. Record outcome in store
   *   5. Release inflight gate in finally
   *
   * `events` is an optional accumulator so tick()/recovery() can
   * surface the full event stream to their callers. Always emits
   * via `.emit()` regardless.
   */
  private async executeFire(
    record: ScheduleRecord,
    fireTime: Date,
    cause: "scheduled" | "manual" | "catch-up-once" | "catch-up-all",
    events?: SchedulerEvent[],
  ): Promise<boolean> {
    const { taskId } = record;
    const timestamp = fireTime.getTime();

    // (1) Inflight gate — at-most-once in-process guard.
    if (this.inflight.get(taskId) === true) {
      const skipEvt: SchedulerEvent = {
        type: "skip",
        taskId,
        timestamp,
        reason: "inflight",
      };
      events?.push(skipEvt);
      this.emitEvent(skipEvt);
      return false;
    }

    const handler = this.handlers.get(taskId);
    if (!handler) {
      // Registered in store but no handler in memory. This is the
      // "daemon restarted, owner module hasn't re-registered yet"
      // case. Emit a skip so operators see why the task didn't fire.
      const skipEvt: SchedulerEvent = {
        type: "skip",
        taskId,
        timestamp,
        reason: "no_handler",
      };
      events?.push(skipEvt);
      this.emitEvent(skipEvt);
      return false;
    }

    // (2) ADVANCE BEFORE FIRE — Hermes's at-most-once invariant.
    // Persist first; if the process dies between this write and
    // handler completion, the next boot sees last_fire_at already
    // moved forward and doesn't replay.
    this.inflight.set(taskId, true);
    this.store.advanceBeforeFire(taskId, timestamp);

    const fireEvt: SchedulerEvent = {
      type: "fire",
      taskId,
      timestamp,
      reason: cause,
    };
    events?.push(fireEvt);
    this.emitEvent(fireEvt);

    const start = Date.now();
    try {
      // (3) Run the handler. Await so we observe rejections; a
      // sync handler that throws is also captured by the try.
      await handler(taskId);

      // (4a) Happy path. Check the row still exists — a concurrent
      // unregister() may have removed it while we were firing.
      if (this.store.get(taskId)) {
        this.store.recordFireResult(taskId, "success");
      }
      const durationMs = Date.now() - start;
      const evt: SchedulerEvent = {
        type: "success",
        taskId,
        timestamp: Date.now(),
        durationMs,
      };
      events?.push(evt);
      this.emitEvent(evt);
      return true;
    } catch (err) {
      // (4b) Honest failure. Record it, emit the event, keep the
      // schedule enabled — next fire still attempts.
      const msg = err instanceof Error ? err.message : String(err);
      if (this.store.get(taskId)) {
        this.store.recordFireResult(taskId, "failure", msg);
      }
      const durationMs = Date.now() - start;
      const evt: SchedulerEvent = {
        type: "failure",
        taskId,
        timestamp: Date.now(),
        durationMs,
        error: msg,
      };
      events?.push(evt);
      this.emitEvent(evt);
      return false;
    } finally {
      // (5) Release the gate ALWAYS — handler error must not lock
      // the task permanently. This is the behavior tests lock in.
      this.inflight.delete(taskId);
    }
  }

  /**
   * Build the derived ScheduleDescriptor from a persisted record.
   * Centralises the list/get shape so CLI + RPC callers get the same
   * view.
   */
  private describe(record: ScheduleRecord, now: Date): ScheduleDescriptor {
    return Object.freeze({
      taskId: record.taskId,
      cronExpr: record.cronExpr,
      missedPolicy: record.missedPolicy,
      enabled: record.enabled,
      lastFireAt: record.lastFireAt,
      lastStatus: record.lastStatus,
      lastError: record.lastError,
      nextFireAt: computeNextFireAt(record.cronExpr, now),
      inflight: this.inflight.get(record.taskId) === true,
    });
  }

  /**
   * Enumerate every minute-aligned match of `expr` strictly after
   * `afterMs` and up to (inclusive) `untilMs`. Used by catch-up
   * policies. Walks minute-by-minute; bounded by missed window since
   * each minute is a cheap O(1) check.
   */
  private enumerateMatches(expr: string, afterMs: number, untilMs: number): readonly number[] {
    if (afterMs >= untilMs) return [];
    const matches: number[] = [];
    const cursor = new Date(afterMs);
    // Advance to start of next whole minute after afterMs.
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    // Safety cap — don't enumerate more than ~2 years of minutes.
    const hardCap = 2 * 365 * 24 * 60;
    let count = 0;
    while (cursor.getTime() <= untilMs && count < hardCap) {
      if (matchesCronSchedule(expr, cursor)) {
        matches.push(cursor.getTime());
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
      count++;
    }
    return matches;
  }

  private emitEvent(event: SchedulerEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }
}
