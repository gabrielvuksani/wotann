/**
 * sqlite-vec backend — Phase 2 P1-M2 (OMEGA port).
 *
 * OMEGA (omegamax.co, Apache-2.0, 95.4% LongMemEval) ships a 3-layer
 * SQLite store with native `sqlite-vec` extension for dense vector
 * search. This module is the WOTANN port of the vector layer.
 *
 * Design contract:
 *
 *   1. sqlite-vec is an OPTIONAL native dependency. On platforms
 *      where the extension cannot load (missing binary, wrong ABI,
 *      sandboxed fs, etc.) we DO NOT fake it — `isSqliteVecAvailable`
 *      returns false and `createSqliteVecBackend` throws with an
 *      install-hint error. Callers (store.ts, temprSearch) detect
 *      the throw and fall back to the existing FTS5-based shortlist.
 *
 *   2. Backend operations are small and composable:
 *        - `upsert(id, vec)` — insert or replace by row-id map
 *        - `knn(query, k)`   — nearest neighbor search
 *        - `delete(id)`      — remove
 *        - `count()`         — population
 *        - `version()`       — extension version (diag)
 *
 *   3. Per-backend isolation: each backend owns a distinct vec0
 *      table name (default `vec_embeddings`). Multiple backends on
 *      the same db are allowed as long as they use different tables.
 *
 *   4. Honest failure on dimension mismatch: every upsert and knn
 *      validates that the vector length matches the declared
 *      `dimensions`. Silent truncation or padding would corrupt
 *      retrieval in subtle ways — better to throw.
 *
 * sqlite-vec uses an `id_map` row-id scheme internally — the backend
 * maintains a parallel `_ids` table that maps INTEGER rowids back to
 * the caller's string ids so `knn()` can return ids, not rowids.
 */

import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────

export interface SqliteVecBackendConfig {
  /** Open better-sqlite3 database. Caller owns the lifecycle. */
  readonly db: Database.Database;
  /** Vector dimension. 384 for MiniLM-L-6-v2; 768 for MiniLM-L-12-v2. */
  readonly dimensions: number;
  /** Override the vec0 table name. Default `vec_embeddings`. */
  readonly tableName?: string;
}

export interface SqliteVecHit {
  readonly id: string;
  readonly distance: number;
}

export interface SqliteVecBackend {
  /** Insert or replace the vector for a caller-supplied id. */
  readonly upsert: (id: string, vector: readonly number[]) => void;
  /** Remove a vector by id. No-op if absent. */
  readonly delete: (id: string) => void;
  /** K-nearest neighbors via vec0 MATCH (uses table's distance_metric, default L2). */
  readonly knn: (query: readonly number[], k: number) => readonly SqliteVecHit[];
  /**
   * K-nearest neighbors via explicit cosine distance (sqlite-vec
   * `vec_distance_cosine` SQL function). Because vecToBuf L2-normalizes
   * inputs, cosine_distance(a, b) = 1 - dot(a, b). Returns hits sorted
   * by ASCENDING distance (0 = identical, 2 = opposite). Wave 5-FF.
   */
  readonly searchCosine: (query: readonly number[], limit: number) => readonly SqliteVecHit[];
  /** Number of vectors currently stored. */
  readonly count: () => number;
  /** sqlite-vec extension version string (e.g. "v0.1.9"). */
  readonly version: () => string;
}

// ── Extension availability probe ──────────────────────

let probeCache: boolean | null = null;

/**
 * Probe whether sqlite-vec is loadable in this process. Results are
 * cached per-process (the answer cannot change at runtime). The
 * probe creates a throwaway in-memory db to avoid polluting caller's
 * db connection with a failed extension load.
 */
export function isSqliteVecAvailable(): boolean {
  if (probeCache !== null) return probeCache;
  try {
    // better-sqlite3 is a CJS module; require() returns the constructor
    // directly. Some toolchains (esmodule-interop on) alias it under
    // `.default`, others don't — accept both.
    const bsqRaw = require("better-sqlite3") as unknown;
    const DatabaseCtor = ((bsqRaw as { default?: unknown }).default ??
      bsqRaw) as typeof import("better-sqlite3");
    const probeDb = new DatabaseCtor(":memory:");
    try {
      const sqliteVec = require("sqlite-vec") as { load: (db: unknown) => void };
      sqliteVec.load(probeDb);
      // Sanity: call vec_version so we know the C entry point is wired.
      probeDb.prepare("SELECT vec_version() AS v").get();
      probeCache = true;
    } finally {
      probeDb.close();
    }
  } catch {
    probeCache = false;
  }
  return probeCache;
}

// ── Backend factory ────────────────────────────────────

export function createSqliteVecBackend(config: SqliteVecBackendConfig): SqliteVecBackend {
  if (!Number.isFinite(config.dimensions) || config.dimensions <= 0) {
    throw new Error(`sqlite-vec: dimensions must be a positive integer (got ${config.dimensions})`);
  }
  const dim = Math.floor(config.dimensions);
  const table = config.tableName ?? "vec_embeddings";
  // sqlite identifier safety: whitelist alnum + underscore.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`sqlite-vec: invalid tableName "${table}" (alnum + _ only)`);
  }
  const idsTable = `${table}_ids`;

  // Load extension on this db. If it fails, throw a caller-friendly
  // error with an install hint rather than a cryptic binding error.
  try {
    const sqliteVec = require("sqlite-vec") as { load: (db: unknown) => void };
    sqliteVec.load(config.db);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `sqlite-vec extension not available: ${msg}. ` +
        `Install with: npm install sqlite-vec. On some platforms the ` +
        `native binary may be missing; see https://github.com/asg017/sqlite-vec.`,
    );
  }

  // Create the vec0 virtual table (fixed-dim FLOAT[dim] column named
  // "embedding") and the parallel id-map for string<->rowid translation.
  // Using db.prepare().run() for the DDL to avoid any SQL-exec ambiguity.
  config.db
    .prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(embedding FLOAT[${dim}])`)
    .run();
  config.db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${idsTable} (
         rowid INTEGER PRIMARY KEY AUTOINCREMENT,
         id TEXT UNIQUE NOT NULL
       )`,
    )
    .run();

  // Prepared statements (reused).
  const lookupRowidStmt = config.db.prepare(`SELECT rowid FROM ${idsTable} WHERE id = ?`);
  const insertIdStmt = config.db.prepare(`INSERT INTO ${idsTable} (id) VALUES (?)`);
  const deleteIdStmt = config.db.prepare(`DELETE FROM ${idsTable} WHERE id = ?`);
  const deleteVecStmt = config.db.prepare(`DELETE FROM ${table} WHERE rowid = ?`);
  const insertVecStmt = config.db.prepare(`INSERT INTO ${table} (rowid, embedding) VALUES (?, ?)`);
  const countStmt = config.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`);
  const versionStmt = config.db.prepare("SELECT vec_version() AS v");
  const knnStmt = config.db.prepare(
    `SELECT ${table}.rowid AS rowid, distance, ${idsTable}.id AS id
       FROM ${table}
       JOIN ${idsTable} ON ${idsTable}.rowid = ${table}.rowid
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance`,
  );
  // Wave 5-FF: explicit cosine search via standalone `vec_distance_cosine`.
  // Selects from idsTable (the regular row source) and joins to the vec0
  // table so we can compute distance per row. vec0 row order is rowid;
  // we rely on the JOIN to surface the embedding for each id. This is
  // O(N) per query but is correct regardless of distance_metric on the
  // virtual table and works across all sqlite-vec >= 0.1.9 builds.
  const cosineSearchStmt = config.db.prepare(
    `SELECT ${idsTable}.id AS id,
            vec_distance_cosine(${table}.embedding, ?) AS dist
       FROM ${idsTable}
       JOIN ${table} ON ${table}.rowid = ${idsTable}.rowid
      ORDER BY dist ASC
      LIMIT ?`,
  );

  const vecToBuf = (v: readonly number[]): Buffer => {
    // Wave 5-FF: dimension validation is HONEST — silent truncation/padding
    // would corrupt KNN in ways that only show up at recall-eval time.
    // We throw here AND check at the upsert/knn call sites.
    if (!Array.isArray(v) || v.length !== dim) {
      throw new Error(
        `sqlite-vec: vector dimension mismatch (expected ${dim}, got ${v?.length ?? 0})`,
      );
    }
    // First pass: copy + finite-check.
    const f32 = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const n = Number(v[i] ?? 0);
      if (!Number.isFinite(n)) {
        throw new Error(`sqlite-vec: non-finite value at index ${i}`);
      }
      f32[i] = n;
    }
    // Wave 5-FF: L2-normalize so unit-length vectors satisfy
    // cosine_distance(a, b) = 1 - dot(a, b). The standalone
    // `vec_distance_cosine` SQL function then matches the searchCosine
    // method without requiring a `distance_metric=cosine` table option
    // (which would force a schema migration on existing dbs).
    //
    // Norm-zero guard: a zero vector cannot be normalized. Leave it as-is
    // (cosine distance to anything is undefined/2 anyway). This matches
    // the behavior of most embedding libraries (sentence-transformers
    // returns the unmodified zero vector in this edge case).
    let sumSq = 0;
    for (let i = 0; i < f32.length; i++) {
      sumSq += f32[i]! * f32[i]!;
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < f32.length; i++) {
        f32[i] = f32[i]! / norm;
      }
    }
    // sqlite-vec accepts Float32Array serialized as Buffer.
    return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  };

  // Transactional upsert: if id exists, replace the row at the
  // existing rowid. Otherwise allocate a new rowid via idsTable and
  // insert. The two-table pattern keeps vec0 happy (it wants integer
  // rowids) while exposing string ids at the API.
  //
  // IMPORTANT: sqlite-vec's vec0 virtual table rejects JS Number for
  // the rowid primary-key column (see vec0.c source). Must pass BigInt.
  // We use BigInt throughout for consistency.
  const upsertTxn = config.db.transaction((id: string, buf: Buffer) => {
    const existing = lookupRowidStmt.get(id) as { rowid: number | bigint } | undefined;
    if (existing) {
      const rid = BigInt(existing.rowid);
      deleteVecStmt.run(rid);
      insertVecStmt.run(rid, buf);
      return;
    }
    const info = insertIdStmt.run(id);
    const rowid = BigInt(info.lastInsertRowid);
    insertVecStmt.run(rowid, buf);
  });

  const deleteTxn = config.db.transaction((id: string) => {
    const existing = lookupRowidStmt.get(id) as { rowid: number | bigint } | undefined;
    if (!existing) return;
    const rid = BigInt(existing.rowid);
    deleteVecStmt.run(rid);
    deleteIdStmt.run(id);
  });

  return {
    upsert: (id: string, vector: readonly number[]): void => {
      if (!id || typeof id !== "string") {
        throw new Error("sqlite-vec: id must be a non-empty string");
      }
      const buf = vecToBuf(vector);
      upsertTxn(id, buf);
    },

    delete: (id: string): void => {
      if (!id || typeof id !== "string") return;
      deleteTxn(id);
    },

    knn: (query: readonly number[], k: number): readonly SqliteVecHit[] => {
      const kInt = Math.max(0, Math.floor(k));
      if (kInt === 0) return [];
      const buf = vecToBuf(query);
      const countRow = countStmt.get() as { c: number };
      if (countRow.c === 0) return [];
      const rows = knnStmt.all(buf, Math.min(kInt, countRow.c)) as {
        id: string;
        distance: number;
      }[];
      return rows.map((r) => ({ id: r.id, distance: r.distance }));
    },

    searchCosine: (query: readonly number[], limit: number): readonly SqliteVecHit[] => {
      const limInt = Math.max(0, Math.floor(limit));
      if (limInt === 0) return [];
      // vecToBuf both validates dim AND L2-normalizes the query — keeps
      // the searchCosine vs knn paths aligned on representation.
      const buf = vecToBuf(query);
      const countRow = countStmt.get() as { c: number };
      if (countRow.c === 0) return [];
      const rows = cosineSearchStmt.all(buf, Math.min(limInt, countRow.c)) as {
        id: string;
        dist: number;
      }[];
      return rows.map((r) => ({ id: r.id, distance: r.dist }));
    },

    count: (): number => {
      const row = countStmt.get() as { c: number };
      return row.c;
    },

    version: (): string => {
      const row = versionStmt.get() as { v: string };
      return row.v;
    },
  };
}
