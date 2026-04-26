/**
 * schema-drift — SQLite migration helpers shared across stores.
 *
 * Wave 6.5-UU (SB-12): legacy `.wotann/*.db` files created by earlier WOTANN
 * builds are missing columns the current code expects. Three stores used to
 * HARD CRASH on those legacy schemas (plan-store missed `lifecycle`,
 * audit-trail missed `content_hash`, meeting-store crashed in `saveSummary`
 * on pre-summary `meetings.db` files). The helpers here let every store
 * apply forward-only migrations idempotently and survive SIGKILL between
 * the version check and the schema mutation.
 *
 * Two primitives:
 *
 *   - `migrateLegacySchema(db, migrations)` — reads `PRAGMA user_version`,
 *     runs each numbered migration in order whose `version` is greater than
 *     the current value, then bumps `user_version` to the highest applied
 *     migration. Each migration runs inside an explicit transaction so a
 *     mid-migration crash leaves the DB in the pre-migration state, never
 *     half-migrated. Migrations are pure side-effecting functions of the
 *     `Database` instance.
 *
 *   - `ensureColumnExists(db, table, column, type)` — ALTER TABLE ADD COLUMN
 *     when the column is missing. Both `table` and `column` are validated
 *     against a strict identifier regex (the same one used by
 *     `MemoryStore.migrateAddColumn`) so callers can't accidentally inject
 *     SQL via dynamic input.
 *
 * Both helpers are intentionally synchronous — the better-sqlite3 driver is
 * synchronous and these only run at store-construction time.
 */
import type Database from "better-sqlite3";

// Same safe-identifier pattern memory/store.ts uses. Letters, digits,
// underscores; must start with a letter or underscore.
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * A single forward-only schema migration.
 *
 * `version` is the integer that PRAGMA user_version will be set to once
 * `apply` returns. Order matters: migrations run in ascending `version` order
 * and only those whose `version > currentUserVersion` are applied.
 *
 * `apply` receives the open Database. It MUST be idempotent w.r.t. its own
 * effects (e.g. use `IF NOT EXISTS` / `ensureColumnExists`) so partial
 * application followed by a retry stays safe.
 */
export interface SchemaMigration {
  readonly version: number;
  readonly description: string;
  readonly apply: (db: Database.Database) => void;
}

/**
 * Apply forward-only schema migrations gated by PRAGMA user_version. Each
 * migration runs inside an explicit transaction so a mid-migration crash
 * (SIGKILL between the column add and the user_version bump) leaves the DB
 * in its pre-migration state, never half-migrated.
 *
 * Idempotent: re-running with the same set of migrations after they've all
 * been applied is a no-op (the user_version is already at or past the
 * highest known migration).
 *
 * Throws if `migrations` contains duplicate version numbers — this catches
 * a programming error early rather than silently skipping migrations.
 */
export function migrateLegacySchema(
  db: Database.Database,
  migrations: readonly SchemaMigration[],
): void {
  if (migrations.length === 0) return;

  // Sort a defensive copy so caller order doesn't matter.
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  // Catch duplicate versions — would silently skip migrations otherwise.
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const prev = sorted[i - 1]!;
    if (cur.version === prev.version) {
      throw new Error(
        `migrateLegacySchema: duplicate migration version ${cur.version} ("${cur.description}" vs "${prev.description}")`,
      );
    }
  }

  const current = readUserVersion(db);
  for (const migration of sorted) {
    if (migration.version <= current) continue;
    // Wrap the entire migration + version bump in a transaction so SIGKILL
    // between the schema change and the PRAGMA leaves a consistent DB.
    db.transaction(() => {
      migration.apply(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}

/**
 * Read the current PRAGMA user_version. Returns 0 for fresh DBs (the SQLite
 * default) so callers can treat "never migrated" and "version 0" identically.
 */
export function readUserVersion(db: Database.Database): number {
  const rows = db.pragma("user_version") as Array<{ user_version?: number }> | number[];
  // better-sqlite3 returns either [{user_version: N}] or, with `simple: true`, just N.
  // We use the default object form here.
  if (Array.isArray(rows) && rows.length > 0) {
    const head = rows[0];
    if (typeof head === "number") return head;
    if (head && typeof head.user_version === "number") return head.user_version;
  }
  return 0;
}

/**
 * Ensure `column` exists on `table`. Runs `ALTER TABLE ... ADD COLUMN ...`
 * when the column is missing; returns early when it already exists.
 *
 * Both `table` and `column` are validated against `SAFE_IDENTIFIER`. `type`
 * is validated to disallow semicolons and SQL line comments so it can carry
 * a CHECK / DEFAULT clause without opening an injection hole. Callers are
 * still expected to use hardcoded literals — this is defense in depth, not
 * a license to pass user input.
 *
 * Idempotent: a second call with the same args after the column exists is a
 * no-op. Safe under SIGKILL — the underlying ALTER is a single SQLite
 * statement (transactional).
 */
export function ensureColumnExists(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  if (!SAFE_IDENTIFIER.test(table)) {
    throw new Error(`ensureColumnExists: invalid table identifier "${table}"`);
  }
  if (!SAFE_IDENTIFIER.test(column)) {
    throw new Error(`ensureColumnExists: invalid column identifier "${column}"`);
  }
  // Disallow obvious injection vectors. Type can include things like
  // "TEXT NOT NULL DEFAULT 'pending'" but never a separate statement.
  if (/[;]|--/.test(type)) {
    throw new Error(`ensureColumnExists: invalid column type "${type}"`);
  }

  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;

  // SQLite swallows DUPLICATE_COLUMN_NAME if a concurrent migration races
  // us. Treat that specific error as success — the column landed.
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate column name/i.test(message)) return;
    throw err;
  }
}

/**
 * Standard PRAGMA bundle every WOTANN SQLite store should apply right after
 * `new Database(path)`. Wave 6.5-UU (H-21) hardening:
 *
 *   - busy_timeout = 5000 — wait up to 5s for a writer lock instead of
 *     immediately throwing SQLITE_BUSY (the better-sqlite3 default).
 *   - journal_mode = WAL — concurrent readers don't block writers.
 *   - synchronous = NORMAL — durable across application crashes; only
 *     vulnerable to power loss in a narrow window. Tradeoff vs FULL is
 *     ~10x throughput for a window orders of magnitude smaller than the
 *     "your laptop loses power mid-fsync" risk.
 *   - foreign_keys = ON — required for ON DELETE CASCADE behaviour.
 *
 * Reads PRAGMA user_version at the end so callers can pass the result to
 * `migrateLegacySchema`. Caller never has to remember the exact incantation.
 */
export function applyStandardPragmas(db: Database.Database): number {
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  return readUserVersion(db);
}
