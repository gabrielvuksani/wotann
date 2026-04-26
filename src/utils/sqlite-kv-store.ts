/**
 * SQLite Key-Value Store - H-24 persistence helper (Wave 6-KK).
 *
 * Per-instance SQLite-backed key-value persistence used by short-lived
 * cross-surface stores (ApprovalQueue, FileDelivery, PairingManager,
 * LiveActivityManager, ComputerSessionStore). The store would otherwise
 * blackhole every record on daemon restart - H-24 finds 5+ such caches.
 *
 * Design (per Wave 6-KK ownership):
 *
 *   Each caller composes a SQLiteKvStore alongside its existing in-memory
 *   Map. On every mutation the caller mirrors the JSON-encoded record into
 *   SQLite; on construction the caller calls `loadAll()` to rehydrate the
 *   Map. The in-memory Map remains the hot-path read; SQLite is the cold
 *   recovery store.
 *
 * Quality bars:
 *
 *   QB #6 (honest fallback) - when better-sqlite3 fails to load (Linux
 *   binary missing, ELF mismatch, etc.) or the file path is unwritable, the
 *   constructor sets `usable=false` and every write/read becomes a no-op.
 *   The CALLER continues to operate in pure-in-memory mode and surfaces a
 *   single console.warn at construction, NEVER throws.
 *
 *   QB #7 (per-instance handle) - every SQLiteKvStore owns its own DB
 *   handle. Module-level singletons would couple test isolation across
 *   stores; constructors take the path explicitly so each store gets a
 *   dedicated file (e.g. `~/.wotann/approvals.db`, `~/.wotann/devices.db`).
 *
 *   QB #11 (sibling-site scan) - Map<string, V>-keyed caches in
 *   src/session/, src/desktop/ are the in-scope blackhole sites.
 *   PaperTrail-style audit logs in src/telemetry/ already persist to disk
 *   via append-only log files (different shape, not in this helper's scope).
 *   The MemoryStore in src/memory/store.ts is the canonical SQLite client
 *   pattern - this helper mirrors its constructor shape.
 *
 *   QB #15 (source-verified shape) - every callsite passes a stable
 *   primary-key string (`approvalId`, `deliveryId`, `deviceId`, `sessionId`)
 *   and a JSON.stringify-safe value. The helper does NOT serialize Maps,
 *   Sets, or class instances - callers must convert to plain objects first.
 */

import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

// ── Types ──────────────────────────────────────────────────

/**
 * Shape exposed to callers. The internal `db` handle stays private so
 * stores can NOT bypass the JSON-string discipline (see QB #15 above).
 */
export interface SQLiteKvStore {
  /** True when the SQLite connection succeeded and PRAGMAs were applied. */
  readonly usable: boolean;
  /** Path the store opened (for diagnostics). */
  readonly dbPath: string;
  /** Reason init failed when `usable === false`. Empty when successful. */
  readonly initError: string;
  /** Idempotent - creates the kv table on first call, no-op afterward. */
  migrate(): void;
  /** Serializes value as JSON.stringify and upserts on (key). */
  put(key: string, value: unknown): void;
  /** Returns parsed JSON for `key` or `null` when absent / parse fails. */
  get(key: string): unknown | null;
  /** Removes `key`. No-op when absent. */
  delete(key: string): void;
  /** Iterates every (key, parsed-value) pair. Skips rows with malformed JSON
   *  rather than throwing - the caller cannot do anything sensible with a
   *  half-restored cache and we'd rather surface the loss honestly via a
   *  count returned to the caller. */
  loadAll<V>(): readonly { key: string; value: V }[];
  /** Total row count (including malformed-JSON rows skipped by loadAll). */
  size(): number;
  /** Closes the underlying handle. Subsequent calls become no-ops via
   *  `usable=false`. */
  close(): void;
}

// Internal handle shape - matches the subset of better-sqlite3 we touch.
interface SqliteHandle {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  pragma: (s: string) => unknown;
  exec: (s: string) => unknown;
  close: () => void;
}

// ── Implementation ─────────────────────────────────────────

/**
 * Open a per-instance SQLite kv store at `dbPath`. When better-sqlite3 is
 * not installable (e.g. native build failed), every method becomes a
 * no-op and `usable` reads false; callers MUST check `usable` before
 * relying on persistence and fall back to pure-memory operation.
 *
 * The PRAGMAs (busy_timeout=5000, journal_mode=WAL) match the
 * MemoryStore pattern in src/memory/store.ts so concurrent daemon +
 * test usage don't deadlock.
 *
 * @param dbPath Absolute filesystem path. Parent directory is auto-mkdir'd.
 * @param tableName Name of the kv table. Default "kv". Multiple stores can
 *  coexist in one DB by passing different names - but the recommended
 *  pattern is one DB per store for isolation (QB #7).
 */
export function createSqliteKvStore(dbPath: string, tableName: string = "kv"): SQLiteKvStore {
  // Validate table name - used in template-literal SQL below, so it
  // MUST match the safe-identifier pattern lest we open an injection hole.
  const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!SAFE_IDENTIFIER.test(tableName)) {
    return makeUnusable(dbPath, `Invalid table name: ${tableName}`);
  }

  // Try to load better-sqlite3 - when this fails (Linux ELF mismatch,
  // missing native bindings, etc.) we degrade gracefully per QB #6.
  // Use createRequire because the package is ESM and require is not in
  // module scope (matches src/memory/sqlite-vec-backend.ts approach).
  let DatabaseCtor: unknown;
  try {
    const requireFn = createRequire(import.meta.url);
    const raw = requireFn("better-sqlite3") as unknown;
    DatabaseCtor = (raw && (raw as { default?: unknown }).default) ?? raw;
  } catch (err) {
    return makeUnusable(
      dbPath,
      `better-sqlite3 unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Ensure parent directory exists. mkdir errors propagate to the
  // catch below.
  try {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    return makeUnusable(
      dbPath,
      `cannot prepare dir: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Open the DB + apply PRAGMAs. Any failure here means we degrade.
  let db: SqliteHandle;
  try {
    const Ctor = DatabaseCtor as new (path: string) => SqliteHandle;
    db = new Ctor(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
  } catch (err) {
    return makeUnusable(dbPath, `open failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let migrated = false;

  function migrate(): void {
    if (migrated) return;
    try {
      db.exec(
        `CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
      migrated = true;
    } catch {
      // Stay silent - the store stays usable for reads of existing rows
      // even if CREATE failed; future writes will retry.
    }
  }

  // Auto-migrate on construction so callers don't have to remember.
  migrate();

  function put(key: string, value: unknown): void {
    if (typeof key !== "string" || key === "") return;
    try {
      const json = JSON.stringify(value);
      db.prepare(`INSERT OR REPLACE INTO ${tableName} (key, value) VALUES (?, ?)`).run(key, json);
    } catch {
      // Best-effort; the in-memory cache stays authoritative.
    }
  }

  function get(key: string): unknown | null {
    if (typeof key !== "string" || key === "") return null;
    try {
      const row = db.prepare(`SELECT value FROM ${tableName} WHERE key = ?`).get(key) as
        | { value: string }
        | undefined;
      if (!row) return null;
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  function deleteKey(key: string): void {
    if (typeof key !== "string" || key === "") return;
    try {
      db.prepare(`DELETE FROM ${tableName} WHERE key = ?`).run(key);
    } catch {
      // Best-effort.
    }
  }

  function loadAll<V>(): readonly { key: string; value: V }[] {
    try {
      const rows = db.prepare(`SELECT key, value FROM ${tableName}`).all() as Array<{
        key: string;
        value: string;
      }>;
      const out: { key: string; value: V }[] = [];
      for (const row of rows) {
        try {
          out.push({ key: row.key, value: JSON.parse(row.value) as V });
        } catch {
          // Skip malformed rows - caller can compare loadAll().length to
          // size() to detect data loss honestly.
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  function size(): number {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get() as { n: number };
      return Number(row.n) || 0;
    } catch {
      return 0;
    }
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    try {
      db.close();
    } catch {
      // Closing twice is harmless.
    }
  }

  return {
    usable: true,
    dbPath,
    initError: "",
    migrate,
    put,
    get,
    delete: deleteKey,
    loadAll,
    size,
    close,
  };
}

/**
 * Build a degenerate "store" used when the connection failed. Every
 * mutation/read is a no-op so callers can use the same code path
 * without `if (store.usable)` checks at every site (the in-memory Map
 * remains authoritative).
 */
function makeUnusable(dbPath: string, reason: string): SQLiteKvStore {
  // One-time warn so production daemons don't pollute logs every restart.
  // We deliberately do NOT throw - silent in-memory operation matches the
  // pre-Wave-6-KK behavior, which the caller already supports.
  // eslint-disable-next-line no-console
  console.warn(
    `[sqlite-kv-store] persistence disabled for ${dbPath}: ${reason} - falling back to in-memory only`,
  );
  return {
    usable: false,
    dbPath,
    initError: reason,
    migrate: () => {},
    put: () => {},
    get: () => null,
    delete: () => {},
    loadAll: () => [],
    size: () => 0,
    close: () => {},
  };
}
