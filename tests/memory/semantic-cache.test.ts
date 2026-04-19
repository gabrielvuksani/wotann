import { describe, it, expect, vi } from "vitest";
import { SemanticCache } from "../../src/memory/semantic-cache.js";

// Deterministic "embedding": map first char of query to a unit vector
function simpleEmbed(text: string): Promise<readonly number[]> {
  const dim = 8;
  const vec = new Array(dim).fill(0) as number[];
  if (text.length > 0) {
    const c = text.charCodeAt(0) % dim;
    vec[c] = 1;
  }
  return Promise.resolve(vec);
}

describe("SemanticCache", () => {
  it("miss on empty cache", async () => {
    const c = new SemanticCache<string>({ embed: simpleEmbed });
    expect(await c.get("hello")).toBeNull();
    expect(c.stats().misses).toBe(1);
  });

  it("set + get returns stored value on identical query", async () => {
    const c = new SemanticCache<string>({ embed: simpleEmbed });
    await c.set("hello", "answer1");
    expect(await c.get("hello")).toBe("answer1");
    expect(c.stats().hits).toBe(1);
  });

  it("similar queries hit the cache above threshold", async () => {
    // Use an embed function that maps "hello"/"hallo" to same vector
    const embed = async (text: string) => {
      const v = new Array(4).fill(0) as number[];
      if (text.startsWith("h")) v[0] = 1;
      if (text.includes("l")) v[1] = 1;
      return v;
    };
    const c = new SemanticCache<string>({ embed, similarityThreshold: 0.9 });
    await c.set("hello", "X");
    expect(await c.get("hallo")).toBe("X"); // same embedding → similarity 1.0
  });

  it("dissimilar queries miss", async () => {
    const c = new SemanticCache<string>({ embed: simpleEmbed });
    await c.set("apple", "fruit"); // first char 'a'
    expect(await c.get("zebra")).toBeNull(); // first char 'z' → different dim
  });

  it("memoize caches fetcher result", async () => {
    const fetcher = vi.fn(async () => "result");
    const c = new SemanticCache<string>({ embed: simpleEmbed });
    await c.memoize("q", fetcher);
    await c.memoize("q", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("TTL expiration", async () => {
    let now = 1000;
    const c = new SemanticCache<string>({
      embed: simpleEmbed,
      ttlMs: 500,
      now: () => now,
    });
    await c.set("q", "v");
    expect(await c.get("q")).toBe("v");
    now += 600;
    expect(await c.get("q")).toBeNull(); // expired
    expect(c.stats().evictions).toBeGreaterThanOrEqual(1);
  });

  it("LRU eviction", async () => {
    const c = new SemanticCache<string>({
      embed: simpleEmbed,
      maxEntries: 2,
    });
    await c.set("a", "A");
    await c.set("b", "B");
    await c.set("c", "C"); // evicts "a"
    expect(c.size()).toBe(2);
  });

  it("hit updates LRU order", async () => {
    const c = new SemanticCache<string>({
      embed: simpleEmbed,
      maxEntries: 2,
    });
    await c.set("a", "A");
    await c.set("b", "B");
    await c.get("a"); // mark "a" as recent
    await c.set("c", "C"); // evicts "b" instead of "a"
    expect(await c.get("a")).toBe("A");
    expect(await c.get("b")).toBeNull();
  });

  it("clear removes all + resets counters", async () => {
    const c = new SemanticCache<string>({ embed: simpleEmbed });
    await c.set("a", "A");
    await c.get("a");
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.stats().hits).toBe(0);
  });

  it("stats reports hit rate", async () => {
    const c = new SemanticCache<string>({ embed: simpleEmbed });
    await c.set("a", "A");
    await c.get("a"); // hit
    await c.get("zzz"); // miss
    expect(c.stats().hitRate).toBeCloseTo(0.5);
  });
});
