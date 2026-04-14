/**
 * Tests for Response Cache — Query Deduplication Layer.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ResponseCache,
  classifyQueryCacheType,
  type CacheableQuery,
} from "../../src/middleware/response-cache.js";

function makeQuery(overrides: Partial<CacheableQuery> = {}): CacheableQuery {
  return {
    model: "claude-opus-4-6",
    provider: "anthropic",
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "What is 2+2?" }],
    temperature: 0,
    ...overrides,
  };
}

describe("Response Cache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache({ maxEntries: 100 });
  });

  describe("classifyQueryCacheType", () => {
    it("marks streaming queries as uncacheable", () => {
      expect(classifyQueryCacheType(makeQuery({ stream: true }))).toBe("uncacheable");
    });

    it("marks high-temperature queries as uncacheable", () => {
      expect(classifyQueryCacheType(makeQuery({ temperature: 0.7 }))).toBe("uncacheable");
    });

    it("identifies WASM bypass queries", () => {
      expect(
        classifyQueryCacheType(makeQuery({
          messages: [{ role: "user", content: "format this JSON" }],
          tools: undefined,
        })),
      ).toBe("wasm");
    });

    it("identifies classification queries", () => {
      expect(
        classifyQueryCacheType(makeQuery({
          messages: [{ role: "user", content: "classify this task as code/plan/review" }],
          tools: undefined,
        })),
      ).toBe("classify");
    });

    it("identifies short utility queries", () => {
      expect(
        classifyQueryCacheType(makeQuery({
          messages: [{ role: "user", content: "What is 2+2?" }],
          tools: undefined,
        })),
      ).toBe("utility");
    });

    it("identifies code queries", () => {
      // Message must be >200 chars to avoid being classified as "utility" first
      const longCodePrompt = "Write a function that handles user authentication with proper error handling and input validation. Here is the current implementation that needs refactoring:\n```typescript\nfunction authenticate(user: string, pass: string) { return db.query(user, pass); }\n```\nPlease refactor this to use proper async/await patterns and add type safety.";
      expect(
        classifyQueryCacheType(makeQuery({
          messages: [{ role: "user", content: longCodePrompt }],
          tools: undefined,
        })),
      ).toBe("code");
    });
  });

  describe("get/set", () => {
    it("returns null for cache miss", () => {
      const result = cache.get(makeQuery());
      expect(result).toBeNull();
    });

    it("returns cached response on hit", () => {
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.set(query, "The answer is 4.", { tokensUsed: 10, costUsd: 0.001 });

      const result = cache.get(query);
      expect(result).not.toBeNull();
      expect(result!.response).toBe("The answer is 4.");
    });

    it("increments hit count on repeated gets", () => {
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.set(query, "Answer", { tokensUsed: 5, costUsd: 0.0005 });

      cache.get(query);
      cache.get(query);
      const third = cache.get(query);

      expect(third!.hitCount).toBe(3);
    });

    it("does not cache streaming queries", () => {
      const query = makeQuery({ stream: true });
      const stored = cache.set(query, "streamed", { tokensUsed: 10, costUsd: 0.001 });
      expect(stored).toBe(false);
    });

    it("does not cache high-temperature queries", () => {
      const query = makeQuery({ temperature: 0.8 });
      const stored = cache.set(query, "creative response", { tokensUsed: 10, costUsd: 0.001 });
      expect(stored).toBe(false);
    });

    it("does not cache oversized responses", () => {
      const query = makeQuery({ temperature: 0, tools: undefined });
      const hugeResponse = "x".repeat(200_000);
      const stored = cache.set(query, hugeResponse, { tokensUsed: 50000, costUsd: 1.0 });
      expect(stored).toBe(false);
    });

    it("returns null for disabled cache", () => {
      const disabled = new ResponseCache({ enabled: false });
      const query = makeQuery({ temperature: 0, tools: undefined });
      disabled.set(query, "test", { tokensUsed: 1, costUsd: 0 });
      expect(disabled.get(query)).toBeNull();
    });
  });

  describe("expiration", () => {
    it("returns null for expired entries", () => {
      const cache = new ResponseCache({ defaultTtlMs: 1 }); // 1ms TTL
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.set(query, "ephemeral", { tokensUsed: 5, costUsd: 0.0005 });

      // Wait for expiration
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      expect(cache.get(query)).toBeNull();
    });
  });

  describe("eviction", () => {
    it("evicts LRU when at capacity", () => {
      const small = new ResponseCache({ maxEntries: 3 });

      // Fill the cache
      for (let i = 0; i < 4; i++) {
        const query = makeQuery({
          messages: [{ role: "user", content: `Question ${i}` }],
          temperature: 0,
          tools: undefined,
        });
        small.set(query, `Answer ${i}`, { tokensUsed: 5, costUsd: 0.001 });
      }

      const stats = small.getStats();
      expect(stats.entries).toBeLessThanOrEqual(3);
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });
  });

  describe("invalidation", () => {
    it("invalidates by provider", () => {
      const q1 = makeQuery({ provider: "anthropic", temperature: 0, tools: undefined });
      const q2 = makeQuery({
        provider: "openai",
        model: "gpt-5.4",
        temperature: 0,
        tools: undefined,
        messages: [{ role: "user", content: "different question" }],
      });

      cache.set(q1, "answer1", { tokensUsed: 5, costUsd: 0.001 });
      cache.set(q2, "answer2", { tokensUsed: 5, costUsd: 0.001 });

      const removed = cache.invalidateByProvider("anthropic");
      expect(removed).toBe(1);
      expect(cache.get(q1)).toBeNull();
      expect(cache.get(q2)).not.toBeNull();
    });

    it("invalidates by predicate", () => {
      const q1 = makeQuery({
        messages: [{ role: "user", content: "short query" }],
        temperature: 0,
        tools: undefined,
      });
      cache.set(q1, "answer", { tokensUsed: 5, costUsd: 0.001 });

      const removed = cache.invalidateWhere((entry) => entry.tokensUsed < 10);
      expect(removed).toBe(1);
    });

    it("clears all entries", () => {
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.set(query, "test", { tokensUsed: 5, costUsd: 0.001 });
      cache.clear();

      expect(cache.getStats().entries).toBe(0);
      expect(cache.getStats().hits).toBe(0);
    });
  });

  describe("pruning", () => {
    it("removes expired entries", () => {
      const cache = new ResponseCache({ defaultTtlMs: 1 });
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.set(query, "old", { tokensUsed: 5, costUsd: 0.001 });

      // Wait for expiration
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      const pruned = cache.prune();
      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(cache.getStats().entries).toBe(0);
    });
  });

  describe("stats", () => {
    it("tracks hits and misses", () => {
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.get(query); // miss
      cache.set(query, "test", { tokensUsed: 10, costUsd: 0.001 });
      cache.get(query); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it("calculates saved tokens and cost", () => {
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.set(query, "answer", { tokensUsed: 100, costUsd: 0.01 });
      cache.get(query); // 1 hit
      cache.get(query); // 2 hits

      const stats = cache.getStats();
      expect(stats.totalSavedTokens).toBe(200); // 100 tokens * 2 hits
      expect(stats.totalSavedCostUsd).toBeCloseTo(0.02); // 0.01 * 2
    });
  });

  describe("export", () => {
    it("exports all cache entries", () => {
      const query = makeQuery({ temperature: 0, tools: undefined });
      cache.set(query, "test", { tokensUsed: 5, costUsd: 0.001 });

      const entries = cache.export();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.response).toBe("test");
    });
  });
});
