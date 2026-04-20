/**
 * Phase 2 P1-M7: wire test — incremental-indexer into MemoryStore.
 *
 * Verifies that MemoryStore exposes the incremental-indexer helpers
 * end-to-end:
 *   - getStaleFiles returns all files on first run (cold cache)
 *   - markFileIndexed records + persists the SHA cache
 *   - getStaleFiles returns NO files after marking (warm cache)
 *   - changing file content re-surfaces it as stale
 *   - forgetFileIndex removes entries (deleted files)
 *   - getFileIndexStats reports cache size + savings
 *
 * Before this wire, IncrementalIndexer had 212 LOC + tests but zero
 * callers — callers had to construct it themselves. Now the
 * MemoryStore owns the lazy singleton so the SHA cache survives across
 * the store's lifetime.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";

let dir: string;
let cachePath: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-inc-indexer-"));
  cachePath = join(dir, "index-cache.json");
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore incremental indexer wire", () => {
  it("cold cache: every file is stale", async () => {
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "alpha");
    writeFileSync(b, "beta");

    const stale = await store.getStaleFiles([a, b], { cachePath });
    expect(stale).toEqual([a, b]);
  });

  it("warm cache: marked file is NOT stale", async () => {
    const a = join(dir, "a.txt");
    writeFileSync(a, "alpha");

    await store.markFileIndexed(a, "alpha", 2, { cachePath });
    const stale = await store.getStaleFiles([a], { cachePath });
    expect(stale).toEqual([]);
  });

  it("content change re-surfaces file as stale", async () => {
    const a = join(dir, "a.txt");
    writeFileSync(a, "alpha");
    await store.markFileIndexed(a, "alpha", 2, { cachePath });

    // Modify file content
    writeFileSync(a, "alpha-updated");
    const stale = await store.getStaleFiles([a], { cachePath });
    expect(stale).toEqual([a]);
  });

  it("forgetFileIndex removes the entry", async () => {
    const a = join(dir, "a.txt");
    writeFileSync(a, "alpha");
    await store.markFileIndexed(a, "alpha", 2, { cachePath });

    const removed = await store.forgetFileIndex(a, { cachePath });
    expect(removed).toBe(true);

    const stats = await store.getFileIndexStats({ cachePath });
    expect(stats.tracked).toBe(0);
  });

  it("getFileIndexStats reports total chunks + saved ms estimate", async () => {
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "alpha");
    writeFileSync(b, "beta");
    await store.markFileIndexed(a, "alpha", 3, { cachePath });
    await store.markFileIndexed(b, "beta", 5, { cachePath });

    const stats = await store.getFileIndexStats({ cachePath });
    expect(stats.tracked).toBe(2);
    expect(stats.totalChunks).toBe(8);
    expect(stats.estimatedSavedMs).toBeGreaterThan(0);
  });

  it("persistence: new MemoryStore instance reads the same cache", async () => {
    const a = join(dir, "a.txt");
    writeFileSync(a, "alpha");
    await store.markFileIndexed(a, "alpha", 2, { cachePath });

    // New store instance (closes first)
    store.close();
    const store2 = new MemoryStore(join(dir, "memory.db"));
    try {
      const stale = await store2.getStaleFiles([a], { cachePath });
      expect(stale).toEqual([]);
      const stats = await store2.getFileIndexStats({ cachePath });
      expect(stats.tracked).toBe(1);
    } finally {
      store2.close();
    }
  });
});
