/**
 * Storage adapter interface — V9 FT.3.1.
 *
 * WHAT: A platform-agnostic SQLite-compatible storage interface that lets
 *   WOTANN run on devices where the default `better-sqlite3` native
 *   binding will not build (Termux ARM64 is the canonical example —
 *   nodejs-lts on Termux ships without the toolchain to compile a
 *   native node-gyp module against bionic libc).
 *
 * WHY: section FT.3 of the V9 spec requires WOTANN to ship on Android via
 *   three tiers — Termux CLI (this adapter is the load-bearing primitive),
 *   Tauri Mobile (uses the same adapter through a JNI bridge), and a
 *   12-week Kotlin native build (uses Room directly, no adapter).
 *   Without the adapter, every Termux user will hit a compile failure
 *   the moment they run `npm install -g wotann`.
 *
 * WHERE: Picked up by `src/storage/index.ts::selectStorageAdapter()` and
 *   threaded through the rest of the runtime that currently does
 *   `import Database from "better-sqlite3"` (see `src/memory/store.ts`,
 *   `src/scheduler/schedule-store.ts`, `src/meet/meeting-store.ts`,
 *   `src/daemon/cron-store.ts`, `src/telemetry/audit-trail.ts`,
 *   `src/cli/commands.ts`, `src/memory/sqlite-vec-backend.ts`,
 *   `src/memory/omega-layers.ts`, `src/memory/pluggable-provider.ts`,
 *   `src/memory/evals/longmemeval/runner.ts`).
 *
 * HOW: Each backend implements `StorageAdapter` and exposes a tiny
 *   subset of the better-sqlite3 surface area (open, run-sql, prepare,
 *   close). Async backends like the `sqlite3` package wrap their
 *   callback-style API behind a synchronous facade powered by the
 *   `better-sqlite3` style stmt object. The JSON fallback is a true
 *   last-resort used only when neither native nor pure-JS SQLite is
 *   available; it persists data via `JSON.stringify` to a single file
 *   and supports a read-only, in-memory query path.
 *
 * Adapter selection at runtime is documented in `index.ts`. This file
 * deliberately does NOT contain selection logic so the interface stays
 * portable.
 *
 * Honest stubs: Every adapter must throw a clear "not available" error
 * when its underlying native module fails to load. Silent fallback is
 * forbidden — callers must be able to detect the absence of a backend
 * and react (typically by selecting the next tier).
 */

/**
 * Identifies the underlying storage backend. Used by the adapter
 * selector and by diagnostic / telemetry code paths so we can surface
 * "WOTANN is using node-sqlite3 because better-sqlite3 failed to load"
 * to the user without tripping over implementation details.
 */
export type StorageBackendKind = "better-sqlite3" | "node-sqlite3" | "sqljs" | "json-fallback";

/**
 * Narrow row type returned by query helpers. Matches the surface of
 * `better-sqlite3`'s default row representation.
 */
export type StorageRow = Record<string, unknown>;

/**
 * Prepared-statement facade. Each backend MUST implement these three
 * methods with semantics that mirror `better-sqlite3`:
 *
 *   - run(...args)  — executes a write (INSERT/UPDATE/DELETE) and
 *     returns metadata (row count, last insert id). Synchronous.
 *   - all(...args)  — executes a read and returns every row as an
 *     array of plain objects. Synchronous.
 *   - get(...args)  — executes a read and returns the first row, or
 *     `undefined` if no row matched. Synchronous.
 *
 * Backends that wrap an async API (sqlite3, sql.js with worker) MUST
 * satisfy the synchronous contract via internal queueing — callers in
 * `src/memory/store.ts` rely on synchronous semantics.
 */
export interface StoragePreparedStatement {
  /**
   * Run a mutating statement. Returns `{ changes, lastInsertRowid }`
   * exactly like better-sqlite3. Backends without a real `lastInsertRowid`
   * concept (e.g. JSON fallback) MUST return a deterministic monotonic
   * counter rather than 0.
   */
  run(...args: readonly unknown[]): StorageRunResult;

  /**
   * Read every matching row. Empty array if no rows matched. Never
   * returns `null` or `undefined` — callers iterate the result.
   */
  all(...args: readonly unknown[]): readonly StorageRow[];

  /**
   * Read a single row. Returns `undefined` if no row matched. The
   * return type is intentionally permissive — callers cast with their
   * domain types in the same module that wrote the schema.
   */
  get(...args: readonly unknown[]): StorageRow | undefined;
}

/**
 * Result of a write statement. Mirrors the `RunResult` shape from
 * `better-sqlite3` so existing callers can be ported with a typedef
 * change rather than a refactor.
 */
export interface StorageRunResult {
  /** Number of rows affected by the statement. */
  readonly changes: number;
  /**
   * Last inserted rowid (or equivalent). Use `bigint` for compat with
   * better-sqlite3 — callers that need `number` MUST narrow explicitly.
   */
  readonly lastInsertRowid: number | bigint;
}

/**
 * Open database handle. Every backend produces one of these from
 * `StorageAdapter#open`. The handle owns its own resources and must
 * be closed exactly once via `close()`.
 *
 * The interface is intentionally narrower than better-sqlite3's full
 * `Database` type. We only expose what the existing memory store
 * actually uses today; anything richer (pragma access, custom
 * functions, backup APIs) needs a feature flag and a careful
 * portability pass.
 */
export interface StorageHandle {
  /**
   * Run one or more SQL statements without returning rows. Used for
   * schema bootstrapping (CREATE TABLE, PRAGMA …).
   *
   * Backends that don't speak SQL natively (JSON fallback) MUST throw
   * a `StorageNotSupportedError` so the caller can pick a different
   * persistence path or surface a configuration error.
   */
  execSql(sql: string): void;

  /**
   * Prepare a parameterised statement. Returns a reusable handle. The
   * caller is responsible for re-preparing if the schema changes.
   */
  prepare(sql: string): StoragePreparedStatement;

  /**
   * Release the database handle. Backends MUST be idempotent — a
   * second `close()` call is a no-op rather than an error.
   */
  close(): void;
}

/**
 * Adapter facade. Concrete implementations live in
 * `sqlite-better-backend.ts`, `sqlite-node-backend.ts`, and the
 * (future) `sqljs-backend.ts` and `json-fallback-backend.ts`.
 */
export interface StorageAdapter {
  /** Static identifier for diagnostics and the `--storage-backend` flag. */
  readonly platform: StorageBackendKind;

  /**
   * Did the underlying driver load successfully on this process?
   * Backends MUST set this to `false` rather than throw at import time
   * — selectStorageAdapter() reads it during cold start.
   */
  readonly available: boolean;

  /**
   * Human-readable explanation of why the adapter is or isn't
   * available. Surfaced in `wotann doctor` and the Termux installer.
   * Empty string when `available === true`.
   */
  readonly unavailableReason: string;

  /**
   * Open (or create) a database file at `path`. The caller owns the
   * lifecycle of the returned handle.
   *
   * Backends MUST throw `StorageNotSupportedError` if `available`
   * is false — calling `open()` on an unavailable adapter is a bug.
   *
   * Async signature: backends that need to `import()` their driver
   * lazily can do so here without forcing the entire app to wait for
   * the import on a non-Termux platform.
   */
  open(path: string): Promise<StorageHandle>;
}

/**
 * Thrown when an adapter cannot fulfil a request because its
 * underlying driver isn't available, or because the requested
 * operation isn't supported by this backend (typically: schema-exec
 * on the JSON fallback).
 *
 * Callers should `catch` this and decide whether to fall back to
 * another adapter, surface a doctor-style configuration error, or
 * abort. Silently ignoring the error is forbidden.
 */
export class StorageNotSupportedError extends Error {
  public readonly backend: StorageBackendKind;

  public constructor(backend: StorageBackendKind, message: string) {
    super(`[storage:${backend}] ${message}`);
    this.name = "StorageNotSupportedError";
    this.backend = backend;
  }
}
