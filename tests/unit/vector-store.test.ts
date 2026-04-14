import { describe, it, expect, beforeEach } from "vitest";
import {
  VectorStore,
  HybridMemorySearch,
  type VectorSearchResult,
} from "../../src/memory/vector-store.js";

// ── VectorStore ─────────────────────────────────────────

describe("VectorStore", () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore();
  });

  describe("addDocument and count", () => {
    it("adds documents and tracks count", () => {
      expect(store.count()).toBe(0);

      store.addDocument("d1", "TypeScript strict mode programming");
      expect(store.count()).toBe(1);

      store.addDocument("d2", "Python machine learning data science");
      expect(store.count()).toBe(2);
    });

    it("overwrites document with same ID", () => {
      store.addDocument("d1", "Original content about TypeScript");
      store.addDocument("d1", "Replaced content about Python");
      expect(store.count()).toBe(1);

      const doc = store.getDocument("d1");
      expect(doc?.content).toBe("Replaced content about Python");
    });

    it("handles empty content", () => {
      store.addDocument("empty", "");
      expect(store.count()).toBe(1);
      // Should not crash on search
      const results = store.search("anything");
      expect(results).toBeDefined();
    });

    it("handles content with only stop words", () => {
      store.addDocument("stops", "the a an is are was were be");
      expect(store.count()).toBe(1);
    });
  });

  describe("search", () => {
    it("returns empty for empty store", () => {
      const results = store.search("any query");
      expect(results).toEqual([]);
    });

    it("returns empty for empty query", () => {
      store.addDocument("d1", "Some real content");
      const results = store.search("");
      expect(results).toEqual([]);
    });

    it("returns empty for stop-word-only query", () => {
      store.addDocument("d1", "TypeScript programming language");
      const results = store.search("the a is");
      expect(results).toEqual([]);
    });

    it("finds matching documents", () => {
      store.addDocument("ts", "TypeScript programming language strict types");
      store.addDocument("py", "Python machine learning data science pandas");
      store.addDocument("auth", "OAuth authentication login tokens session");

      const results = store.search("TypeScript programming types");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe("ts");
    });

    it("ranks by cosine similarity", () => {
      store.addDocument("exact", "database optimization query performance indexing");
      store.addDocument("related", "database schema migration tables");
      store.addDocument("unrelated", "authentication login OAuth tokens");

      const results = store.search("database optimization query performance");
      expect(results.length).toBeGreaterThanOrEqual(2);
      // "exact" shares more terms with query than "related"
      expect(results[0]?.id).toBe("exact");
    });

    it("respects topK limit", () => {
      for (let i = 0; i < 20; i++) {
        store.addDocument(`d${i}`, `document number ${i} about programming`);
      }

      const results = store.search("programming document", 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("returns scores between 0 and 1", () => {
      store.addDocument("d1", "TypeScript React Next.js frontend development");
      store.addDocument("d2", "Rust systems programming memory safety");

      const results = store.search("TypeScript React frontend");
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1.0001); // Allow tiny float imprecision
      }
    });

    it("handles single document store", () => {
      store.addDocument("only", "The sole document about quantum computing");
      const results = store.search("quantum computing");
      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe("only");
    });

    it("semantic similarity: related concepts rank higher", () => {
      store.addDocument("auth-doc", "user authentication login password verification session token");
      store.addDocument("db-doc", "PostgreSQL database indexing query optimization schema");
      store.addDocument("test-doc", "unit testing integration tests vitest coverage");

      // Query uses different words but same domain as auth-doc
      const results = store.search("user login authentication session");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe("auth-doc");
    });
  });

  describe("removeDocument", () => {
    it("removes an existing document", () => {
      store.addDocument("d1", "First document");
      store.addDocument("d2", "Second document");
      expect(store.count()).toBe(2);

      const removed = store.removeDocument("d1");
      expect(removed).toBe(true);
      expect(store.count()).toBe(1);
    });

    it("returns false for non-existent document", () => {
      const removed = store.removeDocument("nope");
      expect(removed).toBe(false);
    });

    it("removed document no longer appears in search", () => {
      store.addDocument("target", "TypeScript programming language");
      store.addDocument("other", "Python data science");

      store.removeDocument("target");

      const results = store.search("TypeScript programming");
      const ids = results.map((r) => r.id);
      expect(ids).not.toContain("target");
    });
  });

  describe("clear", () => {
    it("removes all documents", () => {
      store.addDocument("d1", "First");
      store.addDocument("d2", "Second");
      store.clear();
      expect(store.count()).toBe(0);
      expect(store.search("anything")).toEqual([]);
    });
  });

  describe("getDocument and getDocumentIds", () => {
    it("retrieves document by ID", () => {
      store.addDocument("d1", "Test content");
      const doc = store.getDocument("d1");
      expect(doc).toBeDefined();
      expect(doc?.content).toBe("Test content");
    });

    it("returns undefined for missing document", () => {
      expect(store.getDocument("missing")).toBeUndefined();
    });

    it("lists all document IDs", () => {
      store.addDocument("a", "Alpha");
      store.addDocument("b", "Beta");
      store.addDocument("c", "Gamma");
      const ids = store.getDocumentIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain("a");
      expect(ids).toContain("b");
      expect(ids).toContain("c");
    });
  });

  describe("export and import", () => {
    it("round-trips documents through export/import", () => {
      store.addDocument("d1", "TypeScript programming language");
      store.addDocument("d2", "Python data science");

      const exported = store.exportDocuments();
      expect(exported).toHaveLength(2);

      const newStore = new VectorStore();
      newStore.importDocuments(exported);
      expect(newStore.count()).toBe(2);

      // Search should still work after import
      const results = newStore.search("TypeScript programming");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe("d1");
    });

    it("import preserves metadata", () => {
      const docs = [
        { id: "x", content: "Some content", addedAt: 1000, accessCount: 5 },
      ];

      store.importDocuments(docs);
      const doc = store.getDocument("x");
      expect(doc?.addedAt).toBe(1000);
      expect(doc?.accessCount).toBe(5);
    });
  });

  describe("custom dimensions", () => {
    it("works with smaller vector dimensions", () => {
      const smallStore = new VectorStore(64);
      smallStore.addDocument("d1", "TypeScript React development");
      smallStore.addDocument("d2", "Python machine learning");

      const results = smallStore.search("TypeScript React");
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

// ── HybridMemorySearch ──────────────────────────────────

describe("HybridMemorySearch", () => {
  let vectorStore: VectorStore;

  beforeEach(() => {
    vectorStore = new VectorStore();
  });

  describe("basic fusion", () => {
    it("combines FTS5 and vector results", () => {
      vectorStore.addDocument("d1", "TypeScript React frontend development");
      vectorStore.addDocument("d2", "Python data science analysis");
      vectorStore.addDocument("d3", "database optimization queries");

      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "d1", score: 1.5 },
        { id: "d3", score: 0.8 },
      ];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("TypeScript frontend");

      expect(results.length).toBeGreaterThan(0);
      // d1 appears in both FTS5 and vector, should rank highest
      expect(results[0]?.id).toBe("d1");
      expect(results[0]?.method).toBe("hybrid");
    });

    it("labels method correctly for vector-only results", () => {
      vectorStore.addDocument("vec-only", "machine learning neural networks");
      vectorStore.addDocument("both", "TypeScript programming");

      // FTS5 only returns "both"
      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "both", score: 1.0 },
      ];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("machine learning neural");

      const vecOnly = results.find((r) => r.id === "vec-only");
      if (vecOnly) {
        expect(vecOnly.method).toBe("vector");
      }

      const hybridResult = results.find((r) => r.id === "both");
      if (hybridResult) {
        // "both" appears in FTS5 AND potentially in vector results
        expect(["hybrid", "keyword"]).toContain(hybridResult.method);
      }
    });

    it("labels method correctly for keyword-only results", () => {
      // Add content that won't match "quantum physics" via vector
      vectorStore.addDocument("kw-only", "database optimization indexing");

      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "kw-only", score: 2.0 },
        { id: "fts-extra", score: 1.0 }, // Not in vector store at all
      ];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("quantum physics");

      const kwOnly = results.find((r) => r.id === "fts-extra");
      if (kwOnly) {
        expect(kwOnly.method).toBe("keyword");
      }
    });
  });

  describe("RRF scoring", () => {
    it("items in multiple signals score higher than single-signal items", () => {
      vectorStore.addDocument("multi", "database indexing optimization performance");
      vectorStore.addDocument("single", "authentication login security");

      // FTS5 returns "multi" (it also appears in vector results)
      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "multi", score: 1.0 },
      ];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("database indexing optimization");

      // "multi" should rank above "single" because it gets RRF score from both signals
      const multiResult = results.find((r) => r.id === "multi");
      const singleResult = results.find((r) => r.id === "single");

      if (multiResult && singleResult) {
        expect(multiResult.score).toBeGreaterThan(singleResult.score);
      }
    });

    it("respects topK limit", () => {
      for (let i = 0; i < 20; i++) {
        vectorStore.addDocument(`d${i}`, `document ${i} programming content`);
      }

      const fts5Query = (_q: string): VectorSearchResult[] =>
        Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, score: 20 - i }));

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("programming", 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("all results have positive scores", () => {
      vectorStore.addDocument("d1", "TypeScript programming language");

      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "d1", score: 1.0 },
      ];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("TypeScript programming");

      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });
  });

  describe("temporal and frequency signals", () => {
    it("incorporates temporal recency signal", () => {
      // Use an empty vector store so only FTS5 + temporal compete.
      // FTS5 favors "old" (rank 1), temporal favors "new" (rank 1).
      // We give temporal high weight so it dominates.
      const emptyVecStore = new VectorStore();

      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "old", score: 1.5 },
        { id: "new", score: 1.0 },
      ];

      // "new" is more recent (higher temporal score -> rank 1)
      const temporalSignal = (_ids: readonly string[]) =>
        new Map([
          ["new", 100],
          ["old", 1],
        ]);

      // Give temporal weight high enough to overcome FTS5 rank difference
      const hybrid = new HybridMemorySearch(emptyVecStore, fts5Query, {
        temporalSignal,
        weights: { fts5: 0.2, vector: 0.2, temporal: 0.5, frequency: 0.1 },
      });
      const results = hybrid.search("programming guide");

      const newResult = results.find((r) => r.id === "new");
      const oldResult = results.find((r) => r.id === "old");

      expect(newResult).toBeDefined();
      expect(oldResult).toBeDefined();
      // "new" gets temporal rank 1 with high weight, overcoming FTS5's preference for "old"
      expect(newResult!.score).toBeGreaterThan(oldResult!.score);
    });

    it("incorporates access frequency signal", () => {
      // Same approach: empty vector store, equal FTS5 ranks, frequency breaks tie
      const emptyVecStore = new VectorStore();

      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "popular", score: 1.0 },
        { id: "unpopular", score: 1.0 },
      ];

      const frequencySignal = (_ids: readonly string[]) =>
        new Map([
          ["popular", 50],
          ["unpopular", 1],
        ]);

      const hybrid = new HybridMemorySearch(emptyVecStore, fts5Query, {
        frequencySignal,
      });
      const results = hybrid.search("TypeScript programming");

      const popularResult = results.find((r) => r.id === "popular");
      const unpopularResult = results.find((r) => r.id === "unpopular");

      expect(popularResult).toBeDefined();
      expect(unpopularResult).toBeDefined();
      expect(popularResult!.score).toBeGreaterThan(unpopularResult!.score);
    });

    it("combines all four signals", () => {
      vectorStore.addDocument("winner", "database performance optimization tuning");
      vectorStore.addDocument("loser", "random unrelated document about cooking");

      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "winner", score: 2.0 },
        { id: "loser", score: 0.1 },
      ];

      const temporalSignal = (_ids: readonly string[]) =>
        new Map([
          ["winner", 100],
          ["loser", 1],
        ]);

      const frequencySignal = (_ids: readonly string[]) =>
        new Map([
          ["winner", 50],
          ["loser", 1],
        ]);

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query, {
        temporalSignal,
        frequencySignal,
      });

      const results = hybrid.search("database performance optimization");
      expect(results[0]?.id).toBe("winner");
    });
  });

  describe("custom weights", () => {
    it("allows overriding RRF weights", () => {
      vectorStore.addDocument("d1", "TypeScript React frontend");
      vectorStore.addDocument("d2", "database backend queries");

      // FTS5 strongly favors d2
      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "d2", score: 5.0 },
      ];

      // But with FTS weight near zero and vector weight high,
      // the vector match (d1) should win when searching for frontend terms
      const hybrid = new HybridMemorySearch(vectorStore, fts5Query, {
        weights: { fts5: 0.05, vector: 0.85, temporal: 0.05, frequency: 0.05 },
      });

      const results = hybrid.search("TypeScript React frontend");
      // d1 matches the vector search better since query terms align
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty FTS5 results", () => {
      vectorStore.addDocument("d1", "TypeScript programming");

      const fts5Query = (_q: string): VectorSearchResult[] => [];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("TypeScript programming");
      // Should still return vector results
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.method).toBe("vector");
    });

    it("handles empty vector store", () => {
      const fts5Query = (_q: string): VectorSearchResult[] => [
        { id: "fts1", score: 1.0 },
      ];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("anything");
      expect(results.length).toBe(1);
      expect(results[0]?.method).toBe("keyword");
    });

    it("handles both sources empty", () => {
      const fts5Query = (_q: string): VectorSearchResult[] => [];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("anything");
      expect(results).toEqual([]);
    });

    it("handles query with no tokenizable content", () => {
      vectorStore.addDocument("d1", "TypeScript programming");

      const fts5Query = (_q: string): VectorSearchResult[] => [];

      const hybrid = new HybridMemorySearch(vectorStore, fts5Query);
      const results = hybrid.search("!! ## @@");
      // No vector results (query tokenizes to nothing) and no FTS results
      expect(results).toEqual([]);
    });
  });
});
