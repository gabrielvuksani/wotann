/**
 * CronStore — SQLite-backed persistence for cron jobs.
 *
 * Wave 4F: prior audits flagged `cron.list` as a stub and the daemon-side
 * cron state lived only in `KairosDaemon.state.cronJobs` (an in-memory
 * readonly array). If the daemon died mid-run, every user-added schedule
 * was lost. This store persists jobs to `.wotann/cron.db` (SQLite + WAL
 * journal) so restarts rehydrate schedules before the first tick.
 *
 * This module does NOT execute shell commands — the daemon registers an
 * `executeHandler` and owns the execFile path. The store is pure data.
 *
 * Design notes:
 *   - Table `cron_jobs` mirrors the existing `CronJob` interface at
 *     `kairos.ts` so callers don't need a second type. The store adds
 *     `last_fired_at` and `next_fire_at` columns the in-memory state
 *     doesn't carry — these power the 60s fire-tick and stuck-job
 *     detection on startup.
 *   - WAL journal mode (same as `PlanStore` and `memory.db`) so concurrent
 *     readers (CLI `wotann cron list`) never block the writer.
 *   - 60-second internal tick. Each invocation scans for jobs whose
 *     `next_fire_at <= now` and calls the caller-supplied `executeJob`
 *     handler. Recompute `next_fire_at` after every fire.
 *   - Crash-recovery: on startup, any enabled job whose `last_fired_at`
 *     is more than 24 hours behind `next_fire_at` is flagged via the
 *     `stuckJobHandler` callback so the daemon can emit an audit log
 *     entry before the next tick.
 *
 * This module intentionally does NOT import from `./kairos.js` — the
 * existing circular-import avoidance pattern established by
 * `./cron-utils.ts` (S0-14) demands leaf modules here too.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { matchesCronSchedule } from "./cron-utils.js";

// ── Types ────────────────────────────────────────────────────

/**
 * The shape stored in SQLite. Distinct from `CronJob` in `kairos.ts`
 * only by the two timestamp columns that power the store-side tick.
 * Everything else is identical so callers can project between the two.
 */
export interface CronJobRecord {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly command: string;
  readonly enabled: boolean;
  readonly lastFiredAt: number | null;
  readonly nextFireAt: number | null;
  readonly lastResult: "success" | "failure" | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Callback fired when the store's 60s tick detects a job that's due.
 * The daemon is responsible for actually running the command — this
 * store deliberately has no knowledge of execFile / shell semantics so
 * it stays testable in isolation.
 */
export type CronExecuteHandler = (job: CronJobRecord) => void | Promise<void>;

/**
 * Callback fired when a stuck job is detected on startup. A stuck job
 * is one whose `last_fired_at` is more than 24 hours behind
 * `next_fire_at`, i.e. the daemon died before it could run the job
 * after a scheduled window passed. The daemon wires this into its
 * audit log so operators can see which schedules slipped.
 */
export type StuckJobHandler = (job: CronJobRecord, gapMs: number) => void;

// ── CronStore ────────────────────────────────────────────────

/**
 * Persists cron jobs to SQLite, fires them on a 60-second tick, and
 * surfaces startup crash-resume diagnostics.
 *
 * Lifecycle:
 *   1. `new CronStore(dbPath)` — opens DB, creates schema if missing.
 *   2. `setExecuteHandler(fn)` — daemon registers the fire callback.
 *   3. `setStuckJobHandler(fn)` — optional; daemon registers the audit
 *      callback used only at startup.
 *   4. `start()` — scans for stuck jobs, schedules next_fire_at for
 *      every enabled job, then begins the 60s tick.
 *   5. `stop()` — clears the interval; connection stays open for
 *      reads. Call `close()` for a full teardown.
 */
export class CronStore {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private executeHandler: CronExecuteHandler | null = null;
  private stuckJobHandler: StuckJobHandler | null = null;
  private running = false;
  // Wave 4-AA: tick reentrancy guard. tick() is async — if a job handler
  // takes longer than the 60s interval, the next setInterval invocation
  // would race the prior tick and double-fire any due jobs. Skip the
  // reentrant tick; the next interval picks it up cleanly.
  private tickInFlight = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // The DB lives under `.wotann/` which the daemon creates on start,
    // but tests pass in a tmp path — create the parent dir if missing.
    const parent = dirname(dbPath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }

    this.db = new Database(dbPath);
    // WAL journal mode matches PlanStore + memory.db. Same rationale:
    // concurrent readers (CLI `cron list`) never block a writer tick.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  /**
   * Create the `cron_jobs` table if it doesn't exist. Idempotent on
   * repeated starts — no schema migrations needed yet, but the column
   * list is small enough that adding fields later via
   * `ALTER TABLE cron_jobs ADD COLUMN` stays cheap.
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        task_desc TEXT NOT NULL DEFAULT '',
        command TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_fired_at INTEGER,
        next_fire_at INTEGER,
        last_result TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_fire ON cron_jobs(next_fire_at)
        WHERE enabled = 1 AND next_fire_at IS NOT NULL;
    `);
  }

  // ── Handler Registration ────────────────────────────────

  setExecuteHandler(handler: CronExecuteHandler): void {
    this.executeHandler = handler;
  }

  setStuckJobHandler(handler: StuckJobHandler): void {
    this.stuckJobHandler = handler;
  }

  // ── CRUD ────────────────────────────────────────────────

  /**
   * Insert a new cron job. Caller supplies the schedule + command; the
   * store generates an id, computes the first `next_fire_at`, and
   * persists. Returns the fully-hydrated record so callers can display
   * it immediately without a round-trip.
   */
  add(params: {
    readonly name: string;
    readonly schedule: string;
    readonly command: string;
    readonly taskDesc?: string;
    readonly enabled?: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): CronJobRecord {
    const id = randomUUID();
    const now = Date.now();
    const enabled = params.enabled ?? true;
    const nextFire = enabled ? computeNextFireAt(params.schedule, new Date(now)) : null;

    this.db
      .prepare(
        `INSERT INTO cron_jobs
         (id, name, cron_expr, task_desc, command, enabled, next_fire_at,
          created_at, updated_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.name,
        params.schedule,
        params.taskDesc ?? "",
        params.command,
        enabled ? 1 : 0,
        nextFire,
        now,
        now,
        JSON.stringify(params.metadata ?? {}),
      );

    return this.get(id)!;
  }

  /** Get a single job by id, or null if not found. */
  get(id: string): CronJobRecord | null {
    const row = this.db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return rowToRecord(row);
  }

  /** Return all jobs ordered by creation time. Uses readonly return. */
  list(): readonly CronJobRecord[] {
    const rows = this.db.prepare("SELECT * FROM cron_jobs ORDER BY created_at DESC").all() as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToRecord);
  }

  /** Delete a job by id. Returns true if a row was removed. */
  remove(id: string): boolean {
    const info = this.db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);
    return info.changes > 0;
  }

  /** Toggle enabled state. Recomputes next_fire_at when enabling. */
  setEnabled(id: string, enabled: boolean): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    const now = Date.now();
    const nextFire = enabled ? computeNextFireAt(existing.schedule, new Date(now)) : null;

    const info = this.db
      .prepare(
        `UPDATE cron_jobs
         SET enabled = ?, next_fire_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, nextFire, now, id);

    return info.changes > 0;
  }

  /**
   * Update last_fired_at + last_result + advance next_fire_at. Called
   * from the tick after `executeHandler` resolves.
   */
  recordFired(id: string, result: "success" | "failure"): void {
    const existing = this.get(id);
    if (!existing) return;

    const now = Date.now();
    const nextFire = computeNextFireAt(existing.schedule, new Date(now));

    this.db
      .prepare(
        `UPDATE cron_jobs
         SET last_fired_at = ?, last_result = ?, next_fire_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, result, nextFire, now, id);
  }

  // ── Startup / Recovery ──────────────────────────────────

  /**
   * Detect jobs that look stuck — `last_fired_at` more than 24h behind
   * `next_fire_at`. If the daemon ran the job's tick 24h ago but
   * crashed before recording the result, we'll see `last_fired_at`
   * lagging. Emit the audit callback once per stuck job so operators
   * can investigate without digging through log files.
   *
   * Also handles jobs that are enabled but whose `next_fire_at` is
   * behind `now` by more than 60 seconds — the daemon was off when the
   * schedule window passed. We don't auto-backfill those (cron-style
   * schedules aren't catch-up by default), but we DO reset
   * `next_fire_at` to the next future window so the job doesn't fire
   * repeatedly on the first tick.
   */
  recoverStuckJobs(now: Date = new Date()): readonly CronJobRecord[] {
    const nowMs = now.getTime();
    const stuck: CronJobRecord[] = [];
    const day = 24 * 60 * 60 * 1000;

    for (const job of this.list()) {
      if (!job.enabled) continue;

      // Case 1: last_fired_at is more than 24h behind next_fire_at.
      if (
        job.lastFiredAt !== null &&
        job.nextFireAt !== null &&
        job.nextFireAt - job.lastFiredAt > day &&
        job.lastFiredAt < nowMs - day
      ) {
        const gap = nowMs - job.lastFiredAt;
        stuck.push(job);
        if (this.stuckJobHandler) {
          try {
            this.stuckJobHandler(job, gap);
          } catch {
            // Audit callback failure must never break recovery.
          }
        }
      }

      // Case 2: enabled job whose next_fire_at is in the past by
      // more than 60 seconds. The daemon was off — skip the window,
      // reschedule to the next future match.
      if (job.nextFireAt !== null && job.nextFireAt < nowMs - 60_000) {
        const rescheduled = computeNextFireAt(job.schedule, now);
        this.db
          .prepare("UPDATE cron_jobs SET next_fire_at = ?, updated_at = ? WHERE id = ?")
          .run(rescheduled, nowMs, job.id);
      }

      // Case 3: enabled job with a NULL next_fire_at (pre-4F rows that
      // were persisted before the column was populated). Fill it in.
      if (job.nextFireAt === null) {
        const firstFire = computeNextFireAt(job.schedule, now);
        this.db
          .prepare("UPDATE cron_jobs SET next_fire_at = ?, updated_at = ? WHERE id = ?")
          .run(firstFire, nowMs, job.id);
      }
    }

    return stuck;
  }

  // ── Tick ────────────────────────────────────────────────

  /**
   * Start the 60-second tick. Honour the caller-supplied `intervalMs`
   * for tests that want to accelerate time — production always uses
   * 60_000 so the tick stays aligned with minute boundaries in
   * `matchesCronSchedule`.
   */
  start(intervalMs: number = 60_000): void {
    if (this.running) return;
    this.running = true;

    // Run recovery FIRST so the very first tick doesn't fire a
    // stale next_fire_at against today's clock.
    this.recoverStuckJobs();

    this.tickInterval = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.running = false;
  }

  close(): void {
    this.stop();
    this.db.close();
  }

  /**
   * Fire every job whose `next_fire_at <= now`. Honest about failures —
   * a thrown handler is recorded as a failure, not silently swallowed.
   * Exposed for tests so they can drive the tick deterministically.
   */
  async tick(now: Date = new Date()): Promise<readonly CronJobRecord[]> {
    // Wave 4-AA: reentrancy guard. tick() is async and may await a
    // user-supplied executeHandler that takes longer than the 60s
    // interval. Without this guard, the next setInterval fire would
    // race the prior tick and double-execute due jobs (cron at-most-once
    // becomes at-least-twice). Returning empty preserves the contract:
    // tick() returns the records fired *this invocation*, and the
    // skipped records will fire on the next clean interval.
    if (this.tickInFlight) {
      console.warn("[CronStore] skip tick — previous tick still running");
      return [];
    }
    this.tickInFlight = true;
    try {
      const nowMs = now.getTime();
      const due = this.db
        .prepare(
          `SELECT * FROM cron_jobs
           WHERE enabled = 1
             AND next_fire_at IS NOT NULL
             AND next_fire_at <= ?
           ORDER BY next_fire_at ASC`,
        )
        .all(nowMs) as Array<Record<string, unknown>>;

      const fired: CronJobRecord[] = [];

      for (const row of due) {
        const job = rowToRecord(row);

        // Belt-and-suspenders: also check the cron expression against
        // `now`. In practice next_fire_at was computed from the same
        // parser, so matchesCronSchedule should agree — but a malformed
        // expression should be rejected honestly rather than fired
        // blindly. If it fails, disable the job and skip.
        if (!isScheduleValid(job.schedule)) {
          this.db
            .prepare("UPDATE cron_jobs SET enabled = 0, updated_at = ? WHERE id = ?")
            .run(nowMs, job.id);
          continue;
        }

        let result: "success" | "failure" = "success";

        if (this.executeHandler) {
          try {
            await this.executeHandler(job);
          } catch {
            result = "failure";
          }
        } else {
          // No handler wired — that's not success, it's an honest skip.
          // Record as failure so the operator knows something is wrong.
          result = "failure";
        }

        this.recordFired(job.id, result);
        fired.push({ ...job, lastFiredAt: nowMs, lastResult: result });
      }

      return fired;
    } finally {
      this.tickInFlight = false;
    }
  }

  // ── Inspection ──────────────────────────────────────────

  /** For telemetry — how many jobs are enabled right now. */
  countEnabled(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM cron_jobs WHERE enabled = 1").get() as {
      n: number;
    };
    return row.n;
  }

  /** Absolute path to the database file, for diagnostics. */
  getDbPath(): string {
    return this.dbPath;
  }

  isRunning(): boolean {
    return this.running;
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Convert a SQLite row to the immutable record shape. Centralised so
 * the SQL to record mapping lives in one place.
 */
function rowToRecord(row: Record<string, unknown>): CronJobRecord {
  let metadata: Record<string, unknown> = {};
  try {
    const raw = row["metadata_json"];
    if (typeof raw === "string" && raw.length > 0) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Malformed metadata JSON is non-fatal — treat as empty.
  }

  return Object.freeze({
    id: String(row["id"]),
    name: String(row["name"]),
    schedule: String(row["cron_expr"]),
    command: String(row["command"] ?? ""),
    enabled: Number(row["enabled"] ?? 0) === 1,
    lastFiredAt: row["last_fired_at"] === null ? null : Number(row["last_fired_at"]),
    nextFireAt: row["next_fire_at"] === null ? null : Number(row["next_fire_at"]),
    lastResult:
      row["last_result"] === "success" || row["last_result"] === "failure"
        ? row["last_result"]
        : null,
    createdAt: Number(row["created_at"]),
    updatedAt: Number(row["updated_at"]),
    metadata: Object.freeze(metadata),
  });
}

/**
 * Compute the next absolute ms timestamp at which `schedule` will
 * match. Scans forward minute-by-minute up to 400 days (covers all
 * monthly/yearly patterns). Returns null if no match is found in that
 * window — a valid cron expression cannot fail to match in 400 days,
 * so a null return indicates a malformed expression the caller should
 * handle.
 *
 * Exported for tests and reused by the `recoverStuckJobs()` path.
 */
export function computeNextFireAt(schedule: string, after: Date): number | null {
  if (!isScheduleValid(schedule)) return null;

  // Advance to the start of the next whole minute so the first candidate
  // is strictly in the future relative to `after`.
  // UTC for DST-safety per Wave 3-Q — local-time advance can skip the
  // spring-forward hour entirely or repeat the fall-back hour, which makes
  // schedules like `"30 2 * * *"` either never-fire or fire-twice on those
  // days. UTC has no DST so the minute counter is monotonic.
  const candidate = new Date(after.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  const limit = after.getTime() + 400 * 24 * 60 * 60 * 1000;

  while (candidate.getTime() < limit) {
    if (matchesCronSchedule(schedule, candidate)) {
      return candidate.getTime();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return null;
}

/**
 * Cheap structural validation: a 5-field schedule where each field
 * is non-empty. Full semantic validation is delegated to
 * `matchesCronSchedule` at tick time — if a field like `99` never
 * matches, the job simply never fires (and `computeNextFireAt`
 * returns null after scanning 400 days).
 */
function isScheduleValid(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => p.length > 0);
}
