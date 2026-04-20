/**
 * Phase 2 P1-M7: wire tests — hybrid-retrieval + memvid-backend into
 * MemoryStore.
 *
 * hybrid-retrieval:
 *   - hybridRetrieverSearch pulls entries from memory_entries and runs
 *     them through hybridSearch (RRF fusion + optional reranker)
 *   - createLexicalRetriever / createVectorRetriever factories exposed
 *     so callers build a pipeline without a second import
 *
 * memvid-backend:
 *   - exportToMemvid serializes non-archived entries to a MemvidFile
 *   - importFromMemvid replays entries into memory_entries
 *   - round-trip preserves keys, values, confidence, tags
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-hybrid-memvid-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore.hybridRetrieverSearch (hybrid-retrieval wire)", () => {
  beforeEach(() => {
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "oauth implementation",
      value: "The OAuth 2.0 authentication flow with PKCE is preferred.",
      verified: true,
    });
    store.insert({
      id: "b",
      layer: "core_blocks",
      blockType: "feedback",
      key: "docker deploy",
      value: "Docker multi-stage builds reduce image size significantly.",
      verified: true,
    });
    store.insert({
      id: "c",
      layer: "core_blocks",
      blockType: "feedback",
      key: "oauth token refresh",
      value: "Refresh tokens should rotate on use; PKCE prevents interception.",
      verified: true,
    });
  });

  it("uses the default lexical retriever when no config supplied", async () => {
    const result = await store.hybridRetrieverSearch("oauth");
    expect(result.hits.length).toBeGreaterThan(0);
    // The OAuth entries should rank above Docker.
    const topIds = result.hits.slice(0, 2).map((h) => h.entry.id);
    expect(topIds).toContain("a");
    expect(topIds).toContain("c");
  });

  it("honors a custom limit", async () => {
    const result = await store.hybridRetrieverSearch("oauth", { limit: 1 });
    expect(result.hits.length).toBe(1);
  });

  it("supports a user-supplied retriever chain", async () => {
    const lex = store.createLexicalRetriever();
    const result = await store.hybridRetrieverSearch("docker", {
      retrievers: [lex],
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.entry.id).toBe("b");
  });

  it("exposes perRetriever results for observability", async () => {
    const result = await store.hybridRetrieverSearch("refresh", {
      retrievers: [store.createLexicalRetriever()],
    });
    expect(result.perRetriever.has("lexical")).toBe(true);
  });

  it("reports duration in ms", async () => {
    const result = await store.hybridRetrieverSearch("oauth");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("MemoryStore memvid export/import", () => {
  it("exportToMemvid serializes non-archived entries", () => {
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "fact-1",
      value: "Alpha value.",
      verified: true,
      confidence: 0.9,
      tags: "tag1,tag2",
    });
    const file = store.exportToMemvid({
      outputPath: join(dir, "memvid-out.json"),
    });
    expect(file.header.entryCount).toBeGreaterThan(0);
    expect(file.entries.length).toBe(file.header.entryCount);
    const fact = file.entries.find((e) => e.key === "fact-1");
    expect(fact).toBeDefined();
    expect(fact!.value).toBe("Alpha value.");
    expect(fact!.tags).toEqual(["tag1", "tag2"]);
  });

  it("respects minConfidence filter", () => {
    store.insert({
      id: "high",
      layer: "core_blocks",
      blockType: "feedback",
      key: "high-conf",
      value: "confident",
      verified: true,
      confidence: 0.9,
    });
    store.insert({
      id: "low",
      layer: "core_blocks",
      blockType: "feedback",
      key: "low-conf",
      value: "uncertain",
      verified: true,
      confidence: 0.2,
    });
    const file = store.exportToMemvid({
      minConfidence: 0.5,
      outputPath: join(dir, "memvid-filtered.json"),
    });
    const keys = file.entries.map((e) => e.key);
    expect(keys).toContain("high-conf");
    expect(keys).not.toContain("low-conf");
  });

  it("importFromMemvid replays entries into memory_entries", () => {
    // Arrange: produce a file from one store
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "shared-fact",
      value: "Shared across machines.",
      verified: true,
      confidence: 0.8,
    });
    const file = store.exportToMemvid({
      outputPath: join(dir, "mem-share.json"),
    });

    // Act: import into a fresh store
    const otherDir = mkdtempSync(join(tmpdir(), "store-other-"));
    const other = new MemoryStore(join(otherDir, "memory.db"));
    try {
      const result = other.importFromMemvid(file);
      expect(result.imported).toBeGreaterThan(0);

      // Assert: the fresh store has the new row.
      // Use bare-word FTS5 query (dashes are operator chars).
      const hits = other.search("Shared");
      expect(hits.length).toBeGreaterThan(0);
    } finally {
      other.close();
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("importFromMemvid skips duplicates on the second pass", () => {
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "dup-key",
      value: "Value1",
      verified: true,
      confidence: 0.8,
    });
    const file = store.exportToMemvid({
      outputPath: join(dir, "dup.json"),
    });

    // Second import into same store — duplicate key should be skipped
    const result1 = store.importFromMemvid(file);
    expect(result1.imported).toBe(0); // key already exists in our store
  });
});
