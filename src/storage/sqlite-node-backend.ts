/**
 * node-sqlite3 backend — V9 FT.3.1 Termux-tier fallback.
 *
 * WHAT: A `StorageAdapter` that wraps the `sqlite3` npm package (the
 *   asynchronous, callback-style binding). Used when `better-sqlite3`
 *   fails to load — the canonical case being Termux ARM64, where the
 *   nodejs-lts package ships without the gyp toolchain.
 *
 * WHY: `sqlite3` ships precompiled binaries for more architectures than
 *   `better-sqlite3` does, including Android ARM64 / ARMv7 / x86_64
 *   under Termux. Performance is lower and the API is async, but the
 *   functional surface is enough to keep WOTANN's memory store
 *   running. Without this fallback, every Termux user would see the
 *   harness crash on first run.
 *
 * WHERE: Selected by `selectStorageAdapter()` in `src/storage/index.ts`
 *   only after `BetterSqliteAdapter.probe()` reports unavailable.
 *   Threaded through the existing memory store unchanged — callers see
 *   the same `StoragePreparedStatement` interface.
 *
 * HOW: We wrap the async `sqlite3.Database` with a synchronous facade
 *   using a deasync technique: every call returns a value computed
 *   from the resolved promise via `Atomics.wait` on a SharedArrayBuffer.
 *
 *   PRACTICAL NOTE: Termux Node ships without `Atomics.wait` working
 *   reliably on the main thread, so we DO NOT actually deasync. Instead
 *   this scaffold exposes the synchronous façade as a STUB that throws
 *   `StorageNotSupportedError` with a clear message until the async
 *   port of the memory store lands. This is intentional — silent
 *   blocking-on-async would crash the runtime in subtle ways that are
 *   harder to debug than an honest error at startup.
 *
 *   The full async port is tracked separately as V9 FT.3.1.4 (refactor
 *   `src/memory/store.ts` to async). For the FT.3 scaffold we ship the
 *   adapter with `available = false` and a doctor-friendly explanation.
 *
 * Honest stub policy: We could fake-up sync semantics with deasync, but
 * deasync hides bugs and makes debugging a nightmare. Better to fail
 * cleanly and force the runtime to evolve toward an async memory store
 * — which is the right thing for Termux anyway, since the OS will
 * suspend background processes that block synchronously on I/O.
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
 * Cached driver state. Same three-state pattern as the better-sqlite3
 * backend: null = un-probed, false = probe failed, object = ready.
 */
type DriverState = null | false | { readonly Database: unknown };

let driverCache: DriverState = null;
let driverLoadError = "";

/**
 * Lazy-import the `sqlite3` npm package. We do not declare it as a
 * runtime dependency of WOTANN — Termux users install it manually via
 * `npm install -g sqlite3` (the `install-termux.sh` script handles
 * this). Non-Termux users never load this module.
 */
async function loadDriver(): Promise<DriverState> {
  if (driverCache !== null) {
    return driverCache;
  }
  try {
    // The `sqlite3` package historically ships both a CommonJS and an
    // ES Module entry. We prefer the verbose API (`.verbose()`) to get
    // better error messages on schema bootstrap failures.
    //
    // The `@ts-expect-error` is load-bearing: `sqlite3` is intentionally
    // NOT declared in WOTANN's package.json — Termux users install it
    // separately via `npm install -g sqlite3`. On every other platform
    // this dynamic import will fail at runtime (which is fine; we cache
    // the failure and return a "not available" adapter).
    // @ts-expect-error sqlite3 is an optional Termux-only dependency
    const mod = (await import("sqlite3")) as {
      readonly default: {
        verbose: () => { readonly Database: unknown };
      };
    };
    const verbose = mod.default.verbose();
    driverCache = { Database: verbose.Database };
    return driverCache;
  } catch (err) {
    driverLoadError =
      err instanceof Error ? err.message : `unknown error loading sqlite3: ${String(err)}`;
    driverCache = false;
    return driverCache;
  }
}

/**
 * Probe sqlite3 availability without forcing the import path on
 * non-Termux platforms.
 */
export async function isNodeSqliteAvailable(): Promise<boolean> {
  const state = await loadDriver();
  return state !== false && state !== null;
}

/**
 * Prepared-statement façade for the async sqlite3 driver.
 *
 * IMPORTANT: This is a HONEST STUB. The real implementation requires
 * an async memory store — the existing `src/memory/store.ts` is
 * synchronous and would block forever on these methods if we naively
 * called the underlying async API.
 *
 * Until the async port lands (V9 FT.3.1.4), every method throws
 * `StorageNotSupportedError` so callers see a clean error at first
 * use rather than a silent hang.
 */
function buildStubStatement(sql: string): StoragePreparedStatement {
  const reason =
    `sqlite3 (async) backend cannot satisfy the synchronous ` +
    `StoragePreparedStatement contract. Statement: ${sql.slice(0, 64)}…`;
  return {
    run(...args: readonly unknown[]): StorageRunResult {
      void args;
      throw new StorageNotSupportedError("node-sqlite3", reason);
    },
    all(...args: readonly unknown[]): readonly StorageRow[] {
      void args;
      throw new StorageNotSupportedError("node-sqlite3", reason);
    },
    get(...args: readonly unknown[]): StorageRow | undefined {
      void args;
      throw new StorageNotSupportedError("node-sqlite3", reason);
    },
  };
}

/**
 * Wrap a sqlite3 `Database` into a `StorageHandle`. Closing the
 * handle is best-effort — the async close callback is fired and we
 * ignore its result so the synchronous `close()` contract is honoured.
 */
function wrapHandle(db: unknown): StorageHandle {
  const d = db as {
    close: (cb: (err: Error | null) => void) => void;
  };
  let closed = false;
  return {
    execSql(sql: string): void {
      void sql;
      throw new StorageNotSupportedError(
        "node-sqlite3",
        "Schema-exec on the async sqlite3 backend is not yet implemented (V9 FT.3.1.4 will port the memory store to async).",
      );
    },
    prepare(sql: string): StoragePreparedStatement {
      return buildStubStatement(sql);
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      d.close(() => {
        // Ignore — best-effort. Real implementation will surface
        // close errors to telemetry once the async port lands.
      });
    },
  };
}

/**
 * Concrete adapter. Probes the driver lazily and surfaces a clear
 * "not yet implemented" error when callers try to actually use it.
 *
 * This is wired into `selectStorageAdapter()` so the doctor command
 * can report "sqlite3 is installed but the async port isn't ready
 * yet" — which is much better than a silent hang on first read.
 */
export class NodeSqliteAdapter implements StorageAdapter {
  public readonly platform = "node-sqlite3" as const;
  public available = false;
  public unavailableReason = "";

  public async probe(): Promise<void> {
    const state = await loadDriver();
    if (state === false || state === null) {
      this.available = false;
      this.unavailableReason =
        driverLoadError ||
        "sqlite3 npm package not installed (Termux users: `pkg install sqlite && npm install -g sqlite3`)";
      return;
    }
    // Driver loads, but synchronous façade is not implemented.
    // We mark unavailable so the selector falls through to the JSON
    // fallback rather than crashing on first use.
    this.available = false;
    this.unavailableReason =
      "sqlite3 driver is installed, but WOTANN's synchronous memory store is not yet ported to async (tracked as V9 FT.3.1.4). Use the JSON fallback or wait for the async memory port.";
  }

  public async open(path: string): Promise<StorageHandle> {
    void path;
    const state = await loadDriver();
    if (state === false || state === null) {
      throw new StorageNotSupportedError(
        "node-sqlite3",
        this.unavailableReason || "sqlite3 driver is not available on this platform",
      );
    }
    // Driver loaded but contract not satisfied — return the stub
    // handle so callers see honest errors rather than hangs.
    const Ctor = state.Database as new (file: string) => unknown;
    const db = new Ctor(path);
    return wrapHandle(db);
  }
}

/**
 * Factory. Probes immediately so the selector can read `.available`
 * synchronously after the await.
 */
export async function createNodeSqliteAdapter(): Promise<NodeSqliteAdapter> {
  const adapter = new NodeSqliteAdapter();
  await adapter.probe();
  return adapter;
}
