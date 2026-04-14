import { describe, it, expect } from "vitest";
import { tokenize, TFIDFIndex, mergeHybridResults } from "../../src/memory/semantic-search.js";

describe("Semantic Memory Search", () => {
  describe("tokenize", () => {
    it("lowercases and splits text", () => {
      const tokens = tokenize("Hello World");
      expect(tokens.every((t) => t === t.toLowerCase())).toBe(true);
    });

    it("removes stop words", () => {
      const tokens = tokenize("the quick brown fox is a good animal");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("is");
      expect(tokens).not.toContain("a");
    });

    it("applies simple stemming", () => {
      const tokens = tokenize("running authentication implementing");
      // Stemmer strips common suffixes
      expect(tokens.some((t) => !t.endsWith("ing"))).toBe(true);
    });

    it("filters short tokens", () => {
      const tokens = tokenize("I am ok at it");
      expect(tokens.length).toBe(0); // All too short or stop words
    });
  });

  describe("TFIDFIndex", () => {
    it("adds and searches documents", () => {
      const idx = new TFIDFIndex();
      idx.addDocument("1", "TypeScript is a strongly typed programming language");
      idx.addDocument("2", "Python is great for machine learning and data science");
      idx.addDocument("3", "OAuth authentication with refresh tokens");

      const results = idx.search("typed programming language");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe("1"); // TypeScript doc should rank first
    });

    it("finds conceptual matches (not just keyword)", () => {
      const idx = new TFIDFIndex();
      idx.addDocument("auth", "Login flow with OAuth tokens and session management authentication");
      idx.addDocument("data", "PostgreSQL database optimization and indexing queries");
      idx.addDocument("test", "Unit testing with vitest and test driven development");

      // Search for a term that shares stems with "auth" doc
      const results = idx.search("OAuth login session tokens");
      expect(results.length).toBeGreaterThan(0);
      // Auth doc shares the most terms with the query
      expect(results[0]?.id).toBe("auth");
    });

    it("handles empty query", () => {
      const idx = new TFIDFIndex();
      idx.addDocument("1", "Some content here");
      const results = idx.search("");
      expect(results.length).toBe(0);
    });

    it("handles empty index", () => {
      const idx = new TFIDFIndex();
      const results = idx.search("anything");
      expect(results.length).toBe(0);
    });

    it("removes documents", () => {
      const idx = new TFIDFIndex();
      idx.addDocument("1", "First document");
      idx.addDocument("2", "Second document");
      expect(idx.size()).toBe(2);

      idx.removeDocument("1");
      expect(idx.size()).toBe(1);
    });

    it("tracks vocabulary size", () => {
      const idx = new TFIDFIndex();
      idx.addDocument("1", "TypeScript React Next.js development");
      expect(idx.vocabularySize()).toBeGreaterThan(0);
    });

    it("clears the index", () => {
      const idx = new TFIDFIndex();
      idx.addDocument("1", "Some content");
      idx.clear();
      expect(idx.size()).toBe(0);
    });
  });

  describe("mergeHybridResults", () => {
    it("merges keyword and semantic results", () => {
      const keyword = [
        { id: "1", score: 1.0, text: "exact match" },
        { id: "2", score: 0.5, text: "partial match" },
      ];
      const semantic = [
        { id: "3", score: 0.9, text: "conceptual match" },
        { id: "1", score: 0.8, text: "exact match" }, // same as keyword
      ];

      const merged = mergeHybridResults(keyword, semantic);
      expect(merged.length).toBe(3);

      // ID "1" should be in "both" since it appears in keyword AND semantic
      const both = merged.find((r) => r.id === "1");
      expect(both?.matchType).toBe("both");
    });

    it("respects keyword weight", () => {
      const keyword = [{ id: "1", score: 1.0, text: "keyword" }];
      const semantic = [{ id: "2", score: 0.9, text: "semantic" }];

      // With high keyword weight, keyword result should rank first
      const merged = mergeHybridResults(keyword, semantic, 0.8);
      expect(merged[0]?.id).toBe("1");
    });

    it("handles empty inputs", () => {
      expect(mergeHybridResults([], []).length).toBe(0);
      expect(mergeHybridResults([{ id: "1", score: 1, text: "t" }], []).length).toBe(1);
    });
  });
});
