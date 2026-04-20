/**
 * Phase 2 P1-M7 Wave 3: wire tests for semantic-cache, memory-benchmark,
 * and memory-tools.
 *
 * semantic-cache:
 *   - cachedSearch returns live-search on miss, caches the result
 *   - getRetrievalCacheStats reports hit/miss counters
 *   - clearRetrievalCache resets state
 *
 * memory-benchmark:
 *   - runMemoryBenchmark runs the LongMemEval suite against the store
 *     via the BenchmarkStoreAdapter MemoryStore already implements
 *
 * memory-tools:
 *   - createAgentToolkit returns a MemoryToolkit wired to this store
 *   - getMemoryToolDefinitions returns registerable tool schemas
 *   - dispatchMemoryTool("memory_search") actually searches
 *   - dispatchMemoryTool("memory_insert") actually inserts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-wave3-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore semantic-cache wire", () => {
  it("cachedSearch: miss -> live -> cached", async () => {
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "lang TypeScript",
      value: "TypeScript is strict and great.",
      verified: true,
    });

    const first = await store.cachedSearch("TypeScript");
    expect(first.length).toBeGreaterThan(0);

    const stats1 = store.getRetrievalCacheStats();
    expect(stats1).not.toBeNull();
    expect(stats1!.misses).toBeGreaterThan(0);

    // Second identical call should hit the cache
    const second = await store.cachedSearch("TypeScript");
    expect(second).toEqual(first);
    const stats2 = store.getRetrievalCacheStats();
    expect(stats2!.hits).toBeGreaterThanOrEqual(1);
  });

  it("clearRetrievalCache resets cached state", async () => {
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "foo",
      value: "bar baz",
      verified: true,
    });
    await store.cachedSearch("bar");
    const before = store.getRetrievalCacheStats();
    expect(before!.size).toBeGreaterThan(0);

    store.clearRetrievalCache();
    const after = store.getRetrievalCacheStats();
    expect(after!.size).toBe(0);
  });
});

describe("MemoryStore memory-benchmark wire", () => {
  it("runMemoryBenchmark executes the built-in question set", () => {
    const suite = store.runMemoryBenchmark();
    expect(suite.totalQuestions).toBeGreaterThan(0);
    expect(suite.results.length).toBe(suite.totalQuestions);
    expect(suite.scorePercent).toBeGreaterThanOrEqual(0);
    expect(suite.scorePercent).toBeLessThanOrEqual(100);
    expect(suite.durationMs).toBeGreaterThan(0);
  });

  it("runMemoryBenchmark(category) narrows to a single slice", () => {
    const full = store.runMemoryBenchmark();
    const categories = Object.keys(full.categoryScores);
    expect(categories.length).toBeGreaterThan(0);
    const firstCat = categories[0]!;
    const narrow = store.runMemoryBenchmark(firstCat);
    expect(narrow.totalQuestions).toBeLessThanOrEqual(full.totalQuestions);
    // Every result should match the requested category
    for (const r of narrow.results) {
      expect(r.category).toBe(firstCat);
    }
  });
});

describe("MemoryStore memory-tools wire", () => {
  it("createAgentToolkit returns a MemoryToolkit bound to the store", () => {
    const kit = store.createAgentToolkit();
    expect(kit).toBeDefined();
    expect(typeof kit.dispatch).toBe("function");
    expect(typeof kit.getToolDefinitions).toBe("function");
  });

  it("getMemoryToolDefinitions returns the 4 canonical tool defs", () => {
    const defs = store.getMemoryToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(names).toContain("memory_search");
    expect(names).toContain("memory_replace");
    expect(names).toContain("memory_insert");
  });

  it("dispatchMemoryTool(memory_search) returns matches for indexed rows", () => {
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "zebra fact",
      value: "Zebras have stripes.",
      verified: true,
    });
    const result = store.dispatchMemoryTool("memory_search", {
      query: "Zebras",
      limit: 5,
    });
    expect(result.success).toBe(true);
    const data = result.data as { results: Array<{ entry: { value: string } }> };
    expect(data.results.length).toBeGreaterThan(0);
  });

  it("dispatchMemoryTool(memory_insert) adds a new entry", () => {
    const result = store.dispatchMemoryTool("memory_insert", {
      key: "new-fact",
      value: "This is a fact added via the tool dispatcher.",
      block: "feedback",
      layer: "core_blocks",
    });
    expect(result.success).toBe(true);
    // Verify the entry is findable
    const search = store.search("fact");
    expect(search.length).toBeGreaterThan(0);
  });

  it("dispatchMemoryTool(unknown_tool) returns a clean error envelope", () => {
    const result = store.dispatchMemoryTool("nonexistent_tool", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });
});
