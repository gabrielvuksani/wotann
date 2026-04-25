/**
 * Storage adapter barrel + selector — V9 FT.3.1.
 *
 * WHAT: Single entry-point for the storage abstraction. Re-exports the
 *   public adapter types and exposes `selectStorageAdapter()` which
 *   probes each candidate backend in priority order and returns the
 *   first one that reports `available === true`.
 *
 * WHY: The rest of the runtime (memory store, scheduler, telemetry,
 *   audit trail) should never know which backend it's talking to.
 *   Centralising selection here means the only file that imports
 *   `better-sqlite3` directly is `sqlite-better-backend.ts` — every
 *   other call site goes through the adapter.
 *
 * WHERE: Imported by callers that currently do
 *   `import Database from "better-sqlite3"` once the rollout is done.
 *   The FT.3 scaffold ships the adapter + selector but does NOT
 *   migrate existing call sites — that work is tracked as a follow-up
 *   so we can ship the Termux installer without a 9-file refactor.
 *
 * HOW: Selection priority (highest → lowest):
 *   1. better-sqlite3      — synchronous, native, fastest. Default.
 *   2. node-sqlite3        — async, native, ships precompiled for
 *                            Termux ARM64. Currently honest-stubbed
 *                            until the async memory store lands.
 *   3. sql.js              — pure JS, WASM-backed. (Not implemented
 *                            in FT.3 — placeholder for future tier.)
 *   4. JSON file fallback  — last-resort, in-memory + JSON persist.
 *                            (Not implemented in FT.3 — placeholder.)
 *
 *   The selector probes each tier in order and returns the first one
 *   that's available. If none are available, it throws a clear error
 *   listing every probe failure so the user can debug.
 *
 * Honest stub policy: The selector NEVER returns an unavailable
 * adapter. If every tier failed, it throws — the runtime cannot
 * silently boot with a non-functional storage layer.
 */

export type {
  StorageAdapter,
  StorageBackendKind,
  StorageHandle,
  StoragePreparedStatement,
  StorageRow,
  StorageRunResult,
} from "./storage-adapter.js";

export { StorageNotSupportedError } from "./storage-adapter.js";

export {
  BetterSqliteAdapter,
  createBetterSqliteAdapter,
  isBetterSqliteAvailable,
} from "./sqlite-better-backend.js";

export {
  NodeSqliteAdapter,
  createNodeSqliteAdapter,
  isNodeSqliteAvailable,
} from "./sqlite-node-backend.js";

import type { StorageAdapter, StorageBackendKind } from "./storage-adapter.js";
import { createBetterSqliteAdapter } from "./sqlite-better-backend.js";
import { createNodeSqliteAdapter } from "./sqlite-node-backend.js";

/**
 * Diagnostic record returned by `selectStorageAdapter()`. Lets the
 * caller introspect which backend was chosen and why each rejected
 * tier was rejected. Exposed via `wotann doctor` and used in
 * cold-start logging.
 */
export interface StorageSelectionReport {
  /** The backend that was picked (or `null` if every tier failed). */
  readonly chosen: StorageBackendKind | null;
  /**
   * Per-tier outcome. Ordered from highest priority to lowest, with
   * the chosen tier last (or absent if every tier failed).
   */
  readonly tries: ReadonlyArray<{
    readonly tier: StorageBackendKind;
    readonly available: boolean;
    readonly reason: string;
  }>;
}

/**
 * Probe-and-return-the-best storage adapter. Throws if no tier is
 * available — the runtime cannot run without storage, so a silent
 * fallback would be a bug.
 *
 * Cold-start cost: lazy imports each backend, so on a typical
 * non-Termux platform we pay the import cost of better-sqlite3 only.
 * On Termux we pay better-sqlite3 (which fails) + sqlite3.
 *
 * Returns an object containing the adapter AND a diagnostic report.
 * Callers that don't care about the report can destructure
 * `{ adapter }` and ignore `report`.
 */
export async function selectStorageAdapter(): Promise<{
  readonly adapter: StorageAdapter;
  readonly report: StorageSelectionReport;
}> {
  const tries: Array<{
    readonly tier: StorageBackendKind;
    readonly available: boolean;
    readonly reason: string;
  }> = [];

  // Tier 1: better-sqlite3 (default for desktop / non-Termux Android).
  const better = await createBetterSqliteAdapter();
  tries.push({
    tier: "better-sqlite3",
    available: better.available,
    reason: better.available ? "" : better.unavailableReason,
  });
  if (better.available) {
    return {
      adapter: better,
      report: { chosen: "better-sqlite3", tries },
    };
  }

  // Tier 2: node-sqlite3 (Termux). Currently honest-stubbed until the
  // async memory store port lands — `available` will be false even if
  // the driver loaded.
  const nodeSqlite = await createNodeSqliteAdapter();
  tries.push({
    tier: "node-sqlite3",
    available: nodeSqlite.available,
    reason: nodeSqlite.available ? "" : nodeSqlite.unavailableReason,
  });
  if (nodeSqlite.available) {
    return {
      adapter: nodeSqlite,
      report: { chosen: "node-sqlite3", tries },
    };
  }

  // Tier 3 (sql.js) and Tier 4 (JSON fallback) are placeholders for
  // future scaffolds. Once they land, add their probe calls here.
  // Until then, every tier failed → throw.

  const summary = tries.map((t) => `  - ${t.tier}: ${t.available ? "OK" : t.reason}`).join("\n");

  throw new Error(
    `No storage backend is available. Probe results:\n${summary}\n\n` +
      `For Termux users: see docs/ANDROID_TERMUX.md.\n` +
      `For desktop users: \`npm install\` to rebuild better-sqlite3.\n`,
  );
}
