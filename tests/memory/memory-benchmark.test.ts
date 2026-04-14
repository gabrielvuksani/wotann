/**
 * Tests for the LoCoMo-inspired memory quality benchmark.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryBenchmark,
  type BenchmarkStoreAdapter,
  type BenchmarkQuestion,
  type BenchmarkSuite,
} from "../../src/memory/memory-benchmark.js";

// ── In-Memory Mock Store ─────────────────────────────────────

interface StoredEntry {
  readonly id: string;
  readonly layer: string;
  readonly blockType: string;
  readonly key: string;
  readonly value: string;
  readonly verified: boolean;
  readonly freshnessScore: number;
  readonly confidenceLevel: number;
  readonly verificationStatus: string;
  readonly domain?: string;
  readonly topic?: string;
}

/**
 * Simple in-memory store that uses substring matching for search.
 * Real stores would use FTS5 or vector similarity — this is a
 * deterministic test double.
 */
function createMockStore(): BenchmarkStoreAdapter & { readonly entries: StoredEntry[] } {
  const entries: StoredEntry[] = [];

  function substringScore(query: string, text: string): number {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Check for exact substring match.
    if (textLower.includes(queryLower)) return 1.0;

    // Word-level overlap scoring.
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);
    const textWords = new Set(textLower.split(/\s+/));
    const matched = queryWords.filter((w) => textWords.has(w)).length;

    return queryWords.length > 0 ? matched / queryWords.length : 0;
  }

  return {
    entries,

    insert(entry) {
      entries.push({ ...entry });
    },

    search(query: string, limit: number) {
      const scored = entries
        .map((e) => ({
          entry: { key: e.key, value: e.value },
          score: Math.max(
            substringScore(query, e.key),
            substringScore(query, e.value),
          ),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return scored;
    },

    searchPartitioned(
      query: string,
      options: { domain?: string; topic?: string; limit?: number },
    ) {
      const { domain, topic, limit = 10 } = options;

      const filtered = entries.filter((e) => {
        if (domain && e.domain !== domain) return false;
        if (topic && e.topic !== topic) return false;
        return true;
      });

      const scored = filtered
        .map((e) => ({
          entry: { key: e.key, value: e.value },
          score: Math.max(
            substringScore(query, e.key),
            substringScore(query, e.value),
          ),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return scored;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("MemoryBenchmark", () => {
  let bench: MemoryBenchmark;

  beforeEach(() => {
    bench = new MemoryBenchmark();
  });

  describe("constructor", () => {
    it("loads the built-in question set", () => {
      const questions = bench.getQuestions();
      expect(questions.length).toBeGreaterThanOrEqual(20);
    });

    it("accepts a custom question set", () => {
      const custom: readonly BenchmarkQuestion[] = [
        {
          id: "custom-01",
          category: "single-hop",
          question: "What language?",
          expectedAnswer: "TypeScript",
          setup: [{ key: "lang", value: "TypeScript", blockType: "project" }],
        },
      ];
      const customBench = new MemoryBenchmark(custom);
      expect(customBench.getQuestions()).toHaveLength(1);
    });
  });

  describe("built-in questions", () => {
    it("has at least 4 questions per category", () => {
      const questions = bench.getQuestions();
      const categories = ["single-hop", "multi-hop", "temporal", "open-domain", "adversarial"];

      for (const cat of categories) {
        const count = questions.filter((q) => q.category === cat).length;
        expect(count, `category "${cat}" should have >= 4 questions`).toBeGreaterThanOrEqual(4);
      }
    });

    it("has unique question IDs", () => {
      const ids = bench.getQuestions().map((q) => q.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("every question has at least one setup entry", () => {
      for (const q of bench.getQuestions()) {
        expect(q.setup.length, `question ${q.id} should have setup entries`).toBeGreaterThan(0);
      }
    });

    it("adversarial questions expect NOT_FOUND", () => {
      const adversarial = bench.getQuestions().filter((q) => q.category === "adversarial");
      for (const q of adversarial) {
        expect(q.expectedAnswer).toBe("NOT_FOUND");
      }
    });
  });

  describe("run()", () => {
    it("produces a valid BenchmarkSuite", () => {
      const store = createMockStore();
      const suite = bench.run(store);

      expect(suite.totalQuestions).toBeGreaterThanOrEqual(20);
      expect(suite.passed + suite.failed).toBe(suite.totalQuestions);
      expect(suite.scorePercent).toBeGreaterThanOrEqual(0);
      expect(suite.scorePercent).toBeLessThanOrEqual(100);
      expect(suite.durationMs).toBeGreaterThanOrEqual(0);
      expect(suite.results).toHaveLength(suite.totalQuestions);
    });

    it("seeds entries into the store", () => {
      const store = createMockStore();
      bench.run(store);

      // The store should have entries from seeding.
      expect(store.entries.length).toBeGreaterThan(0);
    });

    it("returns results with correct structure", () => {
      const store = createMockStore();
      const suite = bench.run(store);

      for (const result of suite.results) {
        expect(result).toHaveProperty("questionId");
        expect(result).toHaveProperty("category");
        expect(result).toHaveProperty("passed");
        expect(result).toHaveProperty("expectedAnswer");
        expect(result).toHaveProperty("actualAnswer");
        expect(result).toHaveProperty("searchResults");
        expect(result).toHaveProperty("durationMs");
        expect(typeof result.passed).toBe("boolean");
        expect(typeof result.durationMs).toBe("number");
      }
    });

    it("reports category scores for all 5 categories", () => {
      const store = createMockStore();
      const suite = bench.run(store);
      const categories = ["single-hop", "multi-hop", "temporal", "open-domain", "adversarial"];

      for (const cat of categories) {
        expect(suite.categoryScores[cat], `missing category score for "${cat}"`).toBeDefined();
        const score = suite.categoryScores[cat]!;
        expect(score.total).toBeGreaterThanOrEqual(4);
        expect(score.passed).toBeGreaterThanOrEqual(0);
        expect(score.passed).toBeLessThanOrEqual(score.total);
        expect(score.percent).toBeGreaterThanOrEqual(0);
        expect(score.percent).toBeLessThanOrEqual(100);
      }
    });

    it("scorePercent is consistent with passed/total", () => {
      const store = createMockStore();
      const suite = bench.run(store);
      const expected = Math.round((suite.passed / suite.totalQuestions) * 100);
      expect(suite.scorePercent).toBe(expected);
    });
  });

  describe("runCategory()", () => {
    it("runs only questions for the specified category", () => {
      const store = createMockStore();
      const suite = bench.runCategory(store, "single-hop");

      expect(suite.totalQuestions).toBe(4);
      for (const result of suite.results) {
        expect(result.category).toBe("single-hop");
      }
    });

    it("returns empty suite for unknown category", () => {
      const store = createMockStore();
      const suite = bench.runCategory(store, "nonexistent");

      expect(suite.totalQuestions).toBe(0);
      expect(suite.passed).toBe(0);
      expect(suite.failed).toBe(0);
      expect(suite.scorePercent).toBe(0);
      expect(suite.results).toHaveLength(0);
    });

    it("produces valid category scores scoped to the category", () => {
      const store = createMockStore();
      const suite = bench.runCategory(store, "adversarial");

      expect(Object.keys(suite.categoryScores)).toEqual(["adversarial"]);
      expect(suite.categoryScores["adversarial"]!.total).toBe(4);
    });
  });

  describe("single-hop evaluation", () => {
    it("passes when the store returns matching entries", () => {
      const store = createMockStore();
      const suite = bench.runCategory(store, "single-hop");

      // With our substring-matching mock, single-hop should achieve high scores
      // since the setup entries contain the expected answers directly.
      expect(suite.passed).toBeGreaterThanOrEqual(1);
    });
  });

  describe("adversarial evaluation", () => {
    it("passes when no relevant results are found", () => {
      // Create a store that returns empty results for everything.
      const emptyStore: BenchmarkStoreAdapter = {
        insert() {},
        search() {
          return [];
        },
        searchPartitioned() {
          return [];
        },
      };

      const suite = bench.runCategory(emptyStore, "adversarial");
      // All adversarial questions should pass when nothing is returned.
      expect(suite.passed).toBe(4);
      expect(suite.scorePercent).toBe(100);
    });

    it("fails when irrelevant but high-scoring results are returned", () => {
      // Create a store that always returns a result with high score and
      // keyword overlap with the question.
      const noisyStore: BenchmarkStoreAdapter = {
        insert() {},
        search(query: string) {
          // Return a result whose value contains words from the question.
          return [{ entry: { key: "noise", value: query }, score: 1.0 }];
        },
        searchPartitioned(query: string) {
          return [{ entry: { key: "noise", value: query }, score: 1.0 }];
        },
      };

      const suite = bench.runCategory(noisyStore, "adversarial");
      // At least some adversarial questions should fail when the store
      // returns high-scoring results with keyword overlap.
      expect(suite.failed).toBeGreaterThanOrEqual(1);
    });
  });

  describe("store adapter compatibility", () => {
    it("works without searchPartitioned", () => {
      const basicStore: BenchmarkStoreAdapter = {
        insert() {},
        search() {
          return [];
        },
      };

      // Should not throw even without searchPartitioned.
      const suite = bench.run(basicStore);
      expect(suite.totalQuestions).toBeGreaterThanOrEqual(20);
    });

    it("seeds entries with correct fields", () => {
      const insertedEntries: Array<Record<string, unknown>> = [];
      const capturingStore: BenchmarkStoreAdapter = {
        insert(entry) {
          insertedEntries.push({ ...entry });
        },
        search() {
          return [];
        },
      };

      bench.runCategory(capturingStore, "single-hop");

      expect(insertedEntries.length).toBeGreaterThan(0);
      for (const entry of insertedEntries) {
        expect(entry).toHaveProperty("id");
        expect(entry).toHaveProperty("layer", "core_blocks");
        expect(entry).toHaveProperty("blockType");
        expect(entry).toHaveProperty("key");
        expect(entry).toHaveProperty("value");
        expect(entry).toHaveProperty("verified", true);
        expect(entry).toHaveProperty("freshnessScore", 1.0);
        expect(entry).toHaveProperty("confidenceLevel", 1.0);
        expect(entry).toHaveProperty("verificationStatus", "verified");
      }
    });
  });

  describe("regression guard", () => {
    it("mock store achieves non-zero score", () => {
      const store = createMockStore();
      const suite = bench.run(store);

      // A functioning store should pass at least some questions.
      expect(suite.passed).toBeGreaterThan(0);
      expect(suite.scorePercent).toBeGreaterThan(0);
    });

    it("each category result count matches question count", () => {
      const store = createMockStore();
      const questions = bench.getQuestions();
      const suite = bench.run(store);

      for (const [cat, score] of Object.entries(suite.categoryScores)) {
        const questionCount = questions.filter((q) => q.category === cat).length;
        expect(score.total).toBe(questionCount);
      }
    });
  });
});
