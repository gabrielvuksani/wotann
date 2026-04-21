/**
 * Integration test for MemoryStore.searchWithMode — verifies the
 * dispatcher routes queries through the registry and returns results
 * shaped like RetrievalModeResult. Uses a real on-disk SQLite store
 * (same pattern as omega-layers.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../../src/memory/store.js";

let tmpDir: string;
let dbPath: string;
let store: MemoryStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "retrieval-modes-dispatcher-"));
  dbPath = join(tmpDir, "memory.db");
  store = new MemoryStore(dbPath);
  store.insert({
    id: "d1",
    layer: "working",
    blockType: "user",
    key: "alpha",
    value: "alpha content mentions auth",
    verified: true,
    freshnessScore: 1,
    confidenceLevel: 5,
    verificationStatus: "verified",
  });
  store.insert({
    id: "d2",
    layer: "working",
    blockType: "user",
    key: "beta",
    value: "beta content mentions auth",
    verified: false,
    freshnessScore: 1,
    confidenceLevel: 1,
    verificationStatus: "unverified",
  });
});

afterEach(() => {
  try {
    store.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("store.searchWithMode dispatcher", () => {
  it("lists all 12 P1-M6 retrieval modes by default", () => {
    const names = store.listRetrievalModes();
    expect(names.length).toBe(12);
    expect(names).toContain("graph-traversal");
    expect(names).toContain("fuzzy-match");
    expect(names).toContain("cross-session-bridge");
  });

  it("dispatches to authority-weight mode over real store data", async () => {
    const r = await store.searchWithMode("authority-weight", "auth");
    const ids = r.results.map((h) => h.id);
    expect(ids).toContain("d1");
    expect(ids).toContain("d2");
    expect(r.scoring.method).toBe("authority-multiplier");
    // verified d1 must rank above unverified d2
    expect(ids[0]).toBe("d1");
  });

  it("returns unknown-mode scoring when mode name is bogus (non-throwing)", async () => {
    const r = await store.searchWithMode("not-a-real-mode", "anything");
    expect(r.results).toEqual([]);
    expect(r.scoring.method).toBe("unknown-mode");
    expect(r.scoring.isHeuristic).toBe(true);
  });

  it("registerRetrievalMode adds a custom mode that searchWithMode can dispatch to", async () => {
    store.registerRetrievalMode({
      name: "sentinel",
      description: "test",
      search: async (_ctx, q) => ({
        mode: "sentinel",
        results: [{ id: "x", content: q, score: 1 }],
        scoring: { method: "constant" },
      }),
    });
    const r = await store.searchWithMode("sentinel", "hello");
    expect(r.results[0]?.content).toBe("hello");
    expect(r.scoring.method).toBe("constant");
  });
});
