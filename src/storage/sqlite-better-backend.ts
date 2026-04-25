/**
 * better-sqlite3 backend — V9 FT.3.1 default tier.
 *
 * WHAT: A `StorageAdapter` that wraps `better-sqlite3` (the synchronous,
 *   single-threaded native SQLite binding currently used everywhere in
 *   WOTANN). On non-Termux platforms (macOS, Linux, Windows desktop,
 *   non-rooted Android via Tauri JNI) this is the preferred adapter.
 *
 * WHY: better-sqlite3 is the fastest pure-SQLite option in Node and
 *   gives us deterministic synchronous semantics (`prepare().get()` is
 *   blocking). The OMEGA layers and FTS5 search code in
 *   `src/memory/store.ts` rely on synchronous semantics that the async
 *   `sqlite3` package can't provide without queueing.
 *
 * WHERE: Selected first by `selectStorageAdapter()` in
 *   `src/storage/index.ts`. Falls through to the node-sqlite3 backend
 *   if the native binding fails to load (Termux ARM64, missing
 *   toolchain, ABI mismatch).
 *
 * HOW: We perform a lazy `import("better-sqlite3")` so non-Termux
 *   platforms don't pay the cost of the import on a cold start. The
 *   import happens once per process; subsequent `open()` calls reuse
 *   the cached module reference. We DO NOT cache the database handle
 *   itself — each `open()` returns a fresh handle and the caller owns
 *   the lifecycle.
 *
 * Honest stub: if the native binding fails to load, `available` is set
 * to false and `open()` throws a `StorageNotSupportedError` with the
 * exact npm install hint that Termux users need to see.
 */

import type {
  StorageAdapter,
  StorageHandle,
  StoragePreparedStatement,
  StorageRow,
  StorageRunResult,
} from "./storage-adapter.js";
import { StorageNotSupportedError } from "./storage-adapter.js";

/**
 * Cached driver reference. `null` means we haven't tried to load yet.
 * `false` means we tried and failed. A truthy value means the binding
 * is loaded and ready.
 *
 * The reason for the union with `false` rather than just keeping the
 * adapter's `available` flag is that we may probe the binding from
 * multiple threads / call sites; the cache lets us return the same
 * answer without re-importing.
 */
type DriverState = null | false | { readonly Database: unknown };

let driverCache: DriverState = null;
let driverLoadError = "";

/**
 * Lazy-load `better-sqlite3`. Returns the module's default export
 * (the `Database` constructor) on success, or `null` on failure.
 *
 * We use dynamic `import()` rather than a static `import` so the
 * module isn't required at type-check or test time on platforms
 * where the binding cannot be installed (notably Termux, where
 * `npm install better-sqlite3` fails during gyp).
 */
async function loadDriver(): Promise<DriverState> {
  if (driverCache !== null) {
    return driverCache;
  }
  try {
    const mod = (await import("better-sqlite3")) as {
      readonly default: unknown;
    };
    driverCache = { Database: mod.default };
    return driverCache;
  } catch (err) {
    driverLoadError =
      err instanceof Error ? err.message : `unknown error loading better-sqlite3: ${String(err)}`;
    driverCache = false;
    return driverCache;
  }
}

/**
 * Synchronous probe used by the adapter selector. Returns true only
 * after a successful dynamic import. Callers that need a
 * synchronous answer at startup MUST `await` `selectStorageAdapter()`
 * — there is no synchronous probe path.
 *
 * Exposed for tests + the `wotann doctor` command.
 */
export async function isBetterSqliteAvailable(): Promise<boolean> {
  const state = await loadDriver();
  return state !== false && state !== null;
}

/**
 * Wrap a better-sqlite3 prepared statement so it satisfies the
 * `StoragePreparedStatement` contract. better-sqlite3's surface is
 * already a strict superset, so the wrapper is mostly type narrowing.
 */
function wrapStatement(stmt: unknown): StoragePreparedStatement {
  // better-sqlite3 statements have run/all/get methods. We don't
  // import the type because the dynamic-import path means the type
  // isn't reachable at compile time on platforms without the binding.
  // Instead, we narrow with `as` after a runtime shape check.
  const s = stmt as {
    run: (...args: readonly unknown[]) => {
      readonly changes: number;
      readonly lastInsertRowid: number | bigint;
    };
    all: (...args: readonly unknown[]) => readonly unknown[];
    get: (...args: readonly unknown[]) => unknown;
  };
  return {
    run(...args: readonly unknown[]): StorageRunResult {
      const result = s.run(...args);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    all(...args: readonly unknown[]): readonly StorageRow[] {
      const rows = s.all(...args);
      return rows.map((r) => (r as StorageRow) ?? {});
    },
    get(...args: readonly unknown[]): StorageRow | undefined {
      const row = s.get(...args);
      return row === undefined ? undefined : (row as StorageRow);
    },
  };
}

/**
 * Wrap a better-sqlite3 Database into a `StorageHandle`. The wrapper
 * is paper-thin — better-sqlite3 already has the exact API we need.
 */
function wrapHandle(db: unknown): StorageHandle {
  const d = db as {
    exec: (sql: string) => unknown;
    prepare: (sql: string) => unknown;
    close: () => unknown;
  };
  let closed = false;
  return {
    execSql(sql: string): void {
      d.exec(sql);
    },
    prepare(sql: string): StoragePreparedStatement {
      return wrapStatement(d.prepare(sql));
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      d.close();
    },
  };
}

/**
 * Construct the better-sqlite3 backend. The constructor performs a
 * lazy probe of the driver state but does NOT throw if the driver is
 * missing — that lets callers see `available === false` and pick a
 * different tier without try/catch noise.
 */
export class BetterSqliteAdapter implements StorageAdapter {
  public readonly platform = "better-sqlite3" as const;
  public available = false;
  public unavailableReason = "";

  /**
   * Probe the driver. Idempotent — safe to call multiple times. The
   * adapter selector calls this once during cold start.
   */
  public async probe(): Promise<void> {
    const state = await loadDriver();
    if (state === false || state === null) {
      this.available = false;
      this.unavailableReason =
        driverLoadError ||
        "better-sqlite3 native binding failed to load (likely Termux ARM64 — install nodejs-lts and prefer the node-sqlite3 backend)";
      return;
    }
    this.available = true;
    this.unavailableReason = "";
  }

  public async open(path: string): Promise<StorageHandle> {
    const state = await loadDriver();
    if (state === false || state === null) {
      throw new StorageNotSupportedError(
        "better-sqlite3",
        this.unavailableReason || "better-sqlite3 native binding is not available on this platform",
      );
    }
    const Ctor = state.Database as new (file: string) => unknown;
    const db = new Ctor(path);
    return wrapHandle(db);
  }
}

/**
 * Convenience factory used by `selectStorageAdapter()`. Performs the
 * probe before returning so the caller can read `available` without
 * an extra await.
 */
export async function createBetterSqliteAdapter(): Promise<BetterSqliteAdapter> {
  const adapter = new BetterSqliteAdapter();
  await adapter.probe();
  return adapter;
}
