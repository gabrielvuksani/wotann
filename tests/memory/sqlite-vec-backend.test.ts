/**
 * Phase 2 P1-M2 — sqlite-vec backend tests.
 *
 * Validates the native-extension vector store used by the OMEGA vector
 * channel. Extension-loading is best-effort: tests that require the
 * native .so/.dylib skip gracefully if the dev environment cannot load
 * it. Tests that don't need the extension (API shape, honest-fail
 * paths) always run.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSqliteVecBackend,
  isSqliteVecAvailable,
  type SqliteVecBackend,
} from "../../src/memory/sqlite-vec-backend.js";

const have = isSqliteVecAvailable();

describe("sqlite-vec availability probe", () => {
  it("probe returns a boolean and does not throw", () => {
    expect(typeof have).toBe("boolean");
  });
});

describe("createSqliteVecBackend (native extension required)", () => {
  let db: Database.Database;
  let backend: SqliteVecBackend;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it.skipIf(!have)("loads sqlite-vec extension and reports version", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    expect(backend.version()).toMatch(/^v\d/);
  });

  it.skipIf(!have)("upserts and returns vectors by id", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    backend.upsert("a", [1, 0, 0, 0]);
    backend.upsert("b", [0, 1, 0, 0]);
    const hits = backend.knn([1, 0, 0, 0], 2);
    expect(hits.length).toBe(2);
    expect(hits[0]?.id).toBe("a"); // closest to query
    expect(hits[0]?.distance).toBeCloseTo(0, 3);
  });

  it.skipIf(!have)("replaces vector when id already exists (upsert semantics)", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    backend.upsert("a", [1, 0, 0, 0]);
    backend.upsert("a", [0, 1, 0, 0]); // replace
    const hits = backend.knn([0, 1, 0, 0], 1);
    expect(hits[0]?.id).toBe("a");
    expect(hits[0]?.distance).toBeCloseTo(0, 3);
  });

  it.skipIf(!have)("knn with k larger than population returns all", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    backend.upsert("x", [1, 0, 0, 0]);
    const hits = backend.knn([1, 0, 0, 0], 50);
    expect(hits.length).toBe(1);
  });

  it.skipIf(!have)("empty knn returns []", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    const hits = backend.knn([1, 0, 0, 0], 10);
    expect(hits).toEqual([]);
  });

  it.skipIf(!have)("rejects wrong-dim vectors on upsert", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    expect(() => backend.upsert("a", [1, 0, 0])).toThrow(/dimension/i);
  });

  it.skipIf(!have)("rejects wrong-dim query vectors on knn", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    expect(() => backend.knn([1, 0, 0], 1)).toThrow(/dimension/i);
  });

  it.skipIf(!have)("delete removes a vector", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    backend.upsert("a", [1, 0, 0, 0]);
    backend.upsert("b", [0, 1, 0, 0]);
    backend.delete("a");
    const hits = backend.knn([1, 0, 0, 0], 5);
    expect(hits.find((h) => h.id === "a")).toBeUndefined();
    expect(hits.find((h) => h.id === "b")).toBeDefined();
  });

  it.skipIf(!have)("count returns current population", () => {
    backend = createSqliteVecBackend({ db, dimensions: 4 });
    expect(backend.count()).toBe(0);
    backend.upsert("a", [1, 0, 0, 0]);
    backend.upsert("b", [0, 1, 0, 0]);
    expect(backend.count()).toBe(2);
  });

  it.skipIf(!have)("distinct backends on same db use different table names (isolation)", () => {
    const b1 = createSqliteVecBackend({ db, dimensions: 4, tableName: "vec_a" });
    const b2 = createSqliteVecBackend({ db, dimensions: 4, tableName: "vec_b" });
    b1.upsert("alpha", [1, 0, 0, 0]);
    b2.upsert("beta", [0, 1, 0, 0]);
    expect(b1.count()).toBe(1);
    expect(b2.count()).toBe(1);
    expect(b1.knn([1, 0, 0, 0], 5).find((h) => h.id === "beta")).toBeUndefined();
  });
});

describe("createSqliteVecBackend — honest fail when extension missing", () => {
  it("throws a clear install-hint error when called but extension is missing", () => {
    if (have) {
      // Can't simulate missing extension when it's present in dev env.
      // Just assert the API refuses to silently succeed on dim mismatch.
      const db = new Database(":memory:");
      try {
        const backend = createSqliteVecBackend({ db, dimensions: 4 });
        expect(() => backend.upsert("a", [])).toThrow();
      } finally {
        db.close();
      }
      return;
    }
    // Extension missing path — constructor must throw with helpful hint.
    const db = new Database(":memory:");
    try {
      expect(() => createSqliteVecBackend({ db, dimensions: 4 })).toThrow(/sqlite-vec/i);
    } finally {
      db.close();
    }
  });
});
