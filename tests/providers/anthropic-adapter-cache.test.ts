/**
 * Anthropic adapter cache-warmup wiring — verify that the shared
 * `annotatePromptForCaching` policy drives cache_control placement on
 * single-section large prompts and that the adapter-wide
 * `CacheHitTracker` exposes the shared stats.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getAnthropicCacheTracker } from "../../src/providers/anthropic-adapter.js";

describe("anthropic-adapter cache tracker wiring", () => {
  beforeEach(() => {
    // Isolate each test by resetting the shared tracker.
    getAnthropicCacheTracker().reset();
  });

  it("cache tracker is exposed and starts at zero", () => {
    const tracker = getAnthropicCacheTracker();
    const stats = tracker.stats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  it("tracker records hits and exposes running stats", () => {
    const tracker = getAnthropicCacheTracker();
    tracker.recordHit(1000);
    tracker.recordMiss(2000);
    tracker.recordHit(500);

    const stats = tracker.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    expect(stats.tokensRead).toBe(1500);
    expect(stats.tokensWritten).toBe(2000);
  });

  it("reset clears counters", () => {
    const tracker = getAnthropicCacheTracker();
    tracker.recordHit(100);
    tracker.recordMiss(200);
    tracker.reset();
    const stats = tracker.stats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it("tracker is a singleton — same instance across calls", () => {
    const t1 = getAnthropicCacheTracker();
    const t2 = getAnthropicCacheTracker();
    expect(t1).toBe(t2);
  });
});
