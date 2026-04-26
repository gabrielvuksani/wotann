/**
 * sqlite-store-init.ts — Single-source pragma initialization for SQLite stores.
 *
 * SB-N9 fix companion. Every WOTANN SQLite store (memory, plan-store,
 * audit-trail, meeting-store, schedule-store, cron-store, sqlite-vec-backend)
 * benefits from the same pragma profile for crash-safety + concurrency:
 *
 *   journal_mode = WAL          — non-blocking readers, atomic writers,
 *                                  durable across crashes (replay from -wal file)
 *   synchronous  = NORMAL       — sync at WAL checkpoint (not every write)
 *                                  — same crash-safety as FULL on most disks
 *                                  with 5-10x write throughput
 *   foreign_keys = ON           — enforce FK constraints (off by default in SQLite)
 *   busy_timeout = 5000         — wait 5s before SQLITE_BUSY on lock contention
 *                                  (matches the existing memory/store.ts pattern)
 *
 * Use this helper in every new SQLite store so future stores can't forget.
 * Existing stores (memory/store.ts, orchestration/plan-store.ts,
 * telemetry/audit-trail.ts, meet/meeting-store.ts, scheduler/schedule-store.ts,
 * daemon/cron-store.ts) already wire WAL inline; refactoring them to use this
 * helper is TIER 2 cleanup that doesn't change behavior.
 */

import type Database from "better-sqlite3";

export interface SqliteStoreInitOptions {
  /**
   * Set to false to skip WAL mode (default true). Some test fixtures use
   * `:memory:` databases where WAL is unnecessary; passing false short-circuits
   * the pragma so tests don't accidentally create WAL files in temp dirs.
   */
  readonly walMode?: boolean;
}

export function initSqliteStore(db: Database.Database, options: SqliteStoreInitOptions = {}): void {
  if (options.walMode !== false) {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
}
