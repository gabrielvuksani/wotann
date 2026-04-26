/**
 * ScheduleStore — SQLite-backed persistence for Hermes-style cron scheduler.
 *
 * Why a second store alongside `src/daemon/cron-store.ts`?
 *   - `cron-store.ts` is WOTANN's legacy Wave-4F cron table with
 *     embedded exec semantics (`command` column, child_process handler).
 *     Behaviour is at-least-once: `recordFired()` advances
 *     `next_fire_at` AFTER the handler resolves, so a mid-run daemon
 *     crash replays the job on restart.
 *   - The Hermes scheduler we're porting (§4.4 of the research doc)
 *     inverts this — `advance_next_run()` runs BEFORE the handler, so
 *     crash-mid-run = miss one instead of replay burst. This is
 *     at-most-once semantics for recurring jobs and a one-line
 *     invariant with huge UX consequences (§5.3).
 *
 * Rather than retrofit `cron-store.ts` and risk regressing Wave-4F's
 * crash recovery, add a sibling table `schedule_registry` whose row
 * shape is deliberately different:
 *   - `last_fire_at` advances at fire START, not completion
 *   - `missed_policy` column captures Hermes's per-task policy
 *   - `options_json` holds arbitrary metadata (grace seconds, tags)
 *   - No `command` column — handlers are registered at runtime by
 *     id, so persistence covers the schedule only. Restart rehydrates
 *     ids; handlers re-register on daemon boot.
 *
 * Design rules (from §9 Quality Bars):
 *   - Bar #6: honest errors. Malformed cron expressions reject at add
 *     time; no silent accept.
 *   - Bar #10: this is a sibling module to cron-store.ts; grep for
 *     parallel firing sites confirmed the daemon's existing tick is
 *     owned by the store, so the scheduler's tick is separate.
 *   - Bar #14: persistent columns match what the tests assert against
 *     directly.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { computeNextFireAt } from "../daemon/cron-store.js";

// ── Types ────────────────────────────────────────────────────

export type MissedFirePolicy = "skip" | "catch-up-once" | "catch-up-all";

/**
 * Immutable persisted schedule. `lastFireAt` advances at fire START
 * (not completion) — this is the at-most-once invariant that makes
 * crash-mid-run a miss instead of a replay.
 */
export interface ScheduleRecord {
  readonly taskId: string;
  readonly cronExpr: string;
  readonly missedPolicy: MissedFirePolicy;
  readonly enabled: boolean;
  readonly lastFireAt: number | null;
  readonly lastStatus: "success" | "failure" | "skipped" | null;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly options: Readonly<Record<string, unknown>>;
}

// ── Errors ──────────────────────────────────────────────────

/**
 * Raised when a caller registers an expression that isn't a valid
 * 5-field cron. Honest failure beats silently accepting a job that
 * will never fire.
 */
export class CronParseError extends Error {
  constructor(expr: string, reason: string) {
    super(`Invalid cron expression "${expr}": ${reason}`);
    this.name = "CronParseError";
  }
}

// ── ScheduleStore ──────────────────────────────────────────

/**
 * Pure persistence layer. Has no knowledge of handlers, inflight
 * gates, or tick loops — those live in `CronScheduler`. This keeps
 * the store testable in isolation and mirrors the split between
 * `cron-store.ts` (data) and `kairos.ts` (execution).
 */
export class ScheduleStore {
  private readonly db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const parent = dirname(dbPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

    this.db = new Database(dbPath);
    // Wave 6.5-UU (H-21) standard PRAGMA bundle. WAL + busy_timeout = 5000
    // ensures CLI `schedule list` doesn't throw SQLITE_BUSY against the
    // scheduler tick. synchronous = NORMAL keeps writes durable across
    // crashes (the tick re-fires on restart for missed schedules).
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("user_version"); // read for migration check
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedule_registry (
        task_id TEXT PRIMARY KEY,
        cron_expr TEXT NOT NULL,
        missed_policy TEXT NOT NULL DEFAULT 'skip',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_fire_at INTEGER,
        last_status TEXT,
        last_error TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        options_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_enabled ON schedule_registry(enabled);
    `);
  }

  // ── CRUD ────────────────────────────────────────────────

  /**
   * Persist a new schedule. Rejects invalid cron expressions up
   * front — QB #6, never silently accept a broken schedule.
   *
   * If taskId collides with an existing row, UPDATEs instead of
   * throwing. Registration is idempotent so the daemon can re-register
   * the same task on every boot without special-casing.
   */
  upsert(params: {
    readonly taskId?: string;
    readonly cronExpr: string;
    readonly missedPolicy?: MissedFirePolicy;
    readonly enabled?: boolean;
    readonly options?: Readonly<Record<string, unknown>>;
  }): ScheduleRecord {
    if (!isCronExprValid(params.cronExpr)) {
      throw new CronParseError(params.cronExpr, "must be 5 whitespace-separated fields");
    }

    const taskId = params.taskId ?? randomUUID();
    const now = Date.now();
    const missedPolicy = params.missedPolicy ?? "skip";
    const enabled = params.enabled ?? true;
    const optionsJson = JSON.stringify(params.options ?? {});

    const existing = this.get(taskId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE schedule_registry
           SET cron_expr = ?, missed_policy = ?, enabled = ?,
               updated_at = ?, options_json = ?
           WHERE task_id = ?`,
        )
        .run(params.cronExpr, missedPolicy, enabled ? 1 : 0, now, optionsJson, taskId);
    } else {
      this.db
        .prepare(
          `INSERT INTO schedule_registry
           (task_id, cron_expr, missed_policy, enabled, created_at,
            updated_at, options_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(taskId, params.cronExpr, missedPolicy, enabled ? 1 : 0, now, now, optionsJson);
    }

    return this.get(taskId)!;
  }

  get(taskId: string): ScheduleRecord | null {
    const row = this.db.prepare("SELECT * FROM schedule_registry WHERE task_id = ?").get(taskId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return rowToRecord(row);
  }

  list(): readonly ScheduleRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM schedule_registry ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToRecord);
  }

  remove(taskId: string): boolean {
    const info = this.db.prepare("DELETE FROM schedule_registry WHERE task_id = ?").run(taskId);
    return info.changes > 0;
  }

  /**
   * Advance `last_fire_at` to `fireAt` BEFORE the handler runs. This
   * is the at-most-once invariant — if the daemon dies between this
   * write and handler completion, the schedule has already moved
   * forward, so the next tick won't replay the fire.
   *
   * Pair with `recordFireResult()` to stamp the outcome after the
   * handler settles.
   */
  advanceBeforeFire(taskId: string, fireAt: number): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE schedule_registry
         SET last_fire_at = ?, last_status = ?, last_error = NULL, updated_at = ?
         WHERE task_id = ?`,
      )
      .run(fireAt, "inflight", now, taskId);
  }

  /**
   * Record the outcome of a fire. Does NOT advance `last_fire_at` —
   * `advanceBeforeFire()` already did that. Only `last_status` and
   * `last_error` change here.
   */
  recordFireResult(
    taskId: string,
    status: "success" | "failure" | "skipped",
    error?: string,
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE schedule_registry
         SET last_status = ?, last_error = ?, updated_at = ?
         WHERE task_id = ?`,
      )
      .run(status, error ?? null, now, taskId);
  }

  setEnabled(taskId: string, enabled: boolean): boolean {
    const now = Date.now();
    const info = this.db
      .prepare(
        `UPDATE schedule_registry
         SET enabled = ?, updated_at = ?
         WHERE task_id = ?`,
      )
      .run(enabled ? 1 : 0, now, taskId);
    return info.changes > 0;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM schedule_registry").get() as {
      n: number;
    };
    return row.n;
  }

  countEnabled(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM schedule_registry WHERE enabled = 1")
      .get() as { n: number };
    return row.n;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
  }
}

// ── Helpers ──────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): ScheduleRecord {
  let options: Record<string, unknown> = {};
  try {
    const raw = row["options_json"];
    if (typeof raw === "string" && raw.length > 0) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        options = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Malformed JSON is non-fatal — treat as empty options.
  }

  const lastStatusRaw = row["last_status"];
  const lastStatus =
    lastStatusRaw === "success" || lastStatusRaw === "failure" || lastStatusRaw === "skipped"
      ? lastStatusRaw
      : null;

  const policyRaw = row["missed_policy"];
  const missedPolicy: MissedFirePolicy =
    policyRaw === "catch-up-once" || policyRaw === "catch-up-all" ? policyRaw : "skip";

  return Object.freeze({
    taskId: String(row["task_id"]),
    cronExpr: String(row["cron_expr"]),
    missedPolicy,
    enabled: Number(row["enabled"] ?? 0) === 1,
    lastFireAt: row["last_fire_at"] === null ? null : Number(row["last_fire_at"]),
    lastStatus,
    lastError: row["last_error"] === null ? null : String(row["last_error"]),
    createdAt: Number(row["created_at"]),
    updatedAt: Number(row["updated_at"]),
    options: Object.freeze(options),
  });
}

/**
 * Structural cron validation: 5 whitespace-separated non-empty
 * fields. Matches the same contract as `cron-utils.ts::matchCronField`
 * which accepts asterisk, N, step (slash-N), comma-lists, and hyphen
 * ranges per field. Full semantic validation happens at tick time via
 * `computeNextFireAt` — an expression that parses but never matches
 * any real time (e.g. `99 99 99 99 99`) will simply never fire.
 */
export function isCronExprValid(expr: string): boolean {
  if (typeof expr !== "string") return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  if (!parts.every((p) => p.length > 0)) return false;
  // Semantic sanity: reject expressions that `computeNextFireAt`
  // can't resolve within 400 days. Prevents caller silently
  // registering a never-firing schedule.
  return computeNextFireAt(expr, new Date()) !== null;
}
