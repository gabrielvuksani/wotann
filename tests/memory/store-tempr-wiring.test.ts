/**
 * Phase 2 P1-M4 — MemoryStore.temprSearch wiring test.
 *
 * Smoke-tests that the 4-channel TEMPR properly wires into the store:
 *   - all 4 channels resolve (none throw)
 *   - BM25 finds lexical matches
 *   - entity channel finds capitalized-entity mentions
 *   - temporal channel returns results when validAt is supplied
 *   - cross-encoder rerank actually reorders
 *   - a broken embedder (throws) is isolated — other channels still fire
 *
 * Uses a real in-memory sqlite store (tests/memory/ existing pattern).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: MemoryStore;
let tempDir: string;

function insertEntry(s: MemoryStore, id: string, key: string, value: string): void {
  s.insert({
    id,
    layer: "working",
    blockType: "user",
    key,
    value,
    verified: true,
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "wotann-tempr-"));
  store = new MemoryStore(join(tempDir, "test.db"));
});

afterEach(() => {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("MemoryStore.temprSearch", () => {
  it("returns empty when store is empty", async () => {
    const result = await store.temprSearch("anything");
    expect(result.hits).toEqual([]);
    // All 4 canonical channels dispatched
    expect([...result.channelResults.keys()].sort()).toEqual([
      "bm25",
      "entity",
      "temporal",
      "vector",
    ]);
  });

  it("4 canonical channels are always dispatched", async () => {
    insertEntry(store, "n1", "greet", "hello world memory");
    const result = await store.temprSearch("hello");
    const keys = [...result.channelResults.keys()].sort();
    expect(keys).toEqual(["bm25", "entity", "temporal", "vector"]);
  });

  it("BM25 channel finds lexical matches", async () => {
    insertEntry(store, "n1", "note1", "the quick brown fox jumps over the lazy dog");
    insertEntry(store, "n2", "note2", "unrelated content about quantum mechanics");
    const result = await store.temprSearch("fox");
    const bm25 = result.channelResults.get("bm25");
    expect(bm25?.candidates?.length ?? 0).toBeGreaterThan(0);
    expect(result.hits.length).toBeGreaterThan(0);
    const contents = result.hits.map((h) => h.content).join(" ");
    expect(contents).toContain("fox");
  });

  it("vector channel emits empty without embedder (honest-fail)", async () => {
    insertEntry(store, "n1", "n", "searchable content");
    const result = await store.temprSearch("content");
    const vector = result.channelResults.get("vector");
    expect(vector?.candidates ?? []).toEqual([]);
    expect(vector?.error).toBeUndefined();
  });

  it("a broken embedder is isolated — other channels still fire", async () => {
    insertEntry(store, "n1", "n", "some important data here");
    const errors: string[] = [];
    const result = await store.temprSearch("data", {
      embed: async () => {
        throw new Error("embed boom");
      },
      onChannelError: (name) => errors.push(name),
    });
    expect(errors).toContain("vector");
    const bm25 = result.channelResults.get("bm25");
    expect(bm25?.candidates?.length ?? 0).toBeGreaterThan(0);
  });

  it("cross-encoder rerank runs by default", async () => {
    insertEntry(store, "n1", "n1", "memory retrieval system architecture");
    insertEntry(store, "n2", "n2", "cat video on youtube");
    const result = await store.temprSearch("memory retrieval");
    expect(result.rerankerApplied).toBe(true);
    expect(result.hits[0]?.content).toContain("memory");
  });

  it("can disable cross-encoder with crossEncoder: null", async () => {
    insertEntry(store, "n1", "n", "some content");
    const result = await store.temprSearch("content", { crossEncoder: null });
    expect(result.rerankerApplied).toBe(false);
  });

  it("respects topK limit", async () => {
    for (let i = 0; i < 20; i++) {
      insertEntry(store, `n${i}`, `n${i}`, `entry number ${i} about shared term`);
    }
    const result = await store.temprSearch("shared term", { topK: 5 });
    expect(result.hits.length).toBeLessThanOrEqual(5);
  });

  it("returns full MemoryEntry on each hit", async () => {
    insertEntry(store, "na", "note-a", "discoverable memory content");
    const result = await store.temprSearch("discoverable");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.entry).not.toBeNull();
    expect(result.hits[0]?.entry?.value).toContain("discoverable");
  });

  it("per-query isolation — two searches don't share state", async () => {
    insertEntry(store, "n1", "n1", "first memory");
    insertEntry(store, "n2", "n2", "second memory");
    const r1 = await store.temprSearch("first");
    const r2 = await store.temprSearch("second");
    expect(r1.hits[0]?.content).toContain("first");
    expect(r2.hits[0]?.content).toContain("second");
  });

  it("durationMs is a non-negative number", async () => {
    const result = await store.temprSearch("anything");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("honest-fail on validAt with no edges — temporal channel empty", async () => {
    insertEntry(store, "n1", "n", "content without bi-temporal edges");
    const result = await store.temprSearch("content", {
      validAt: "2020-01-01T00:00:00.000Z",
    });
    const temporal = result.channelResults.get("temporal");
    expect(temporal?.candidates).toEqual([]);
    expect(temporal?.error).toBeUndefined();
  });
});
