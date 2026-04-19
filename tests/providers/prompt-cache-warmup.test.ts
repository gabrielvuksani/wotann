import { describe, it, expect, vi } from "vitest";
import {
  estimateTokens,
  annotatePromptForCaching,
  planWarmup,
  warmupCache,
  CacheHitTracker,
  type CachePrefix,
} from "../../src/providers/prompt-cache-warmup.js";

describe("estimateTokens", () => {
  it("approximates 1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });

  it("rounds up", () => {
    expect(estimateTokens("a")).toBe(1);
  });
});

describe("annotatePromptForCaching", () => {
  it("no-cache produces plain block", () => {
    const r = annotatePromptForCaching("sys", "no-cache");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.cache_control).toBeUndefined();
  });

  it("whole puts cache_control on single block", () => {
    const r = annotatePromptForCaching("sys", "whole");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.cache_control?.type).toBe("ephemeral");
  });

  it("auto splits on ---delimiter when prefix is 60%+", () => {
    const big = "x".repeat(1000) + "\n\n---\n\nper-request instructions";
    const r = annotatePromptForCaching(big, "auto");
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]?.cache_control?.type).toBe("ephemeral");
    expect(r.blocks[1]?.cache_control).toBeUndefined();
  });

  it("auto falls back to whole when no split point", () => {
    const r = annotatePromptForCaching("short prompt", "auto");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.cache_control?.type).toBe("ephemeral");
  });
});

describe("planWarmup", () => {
  const longPrefix = (id: string, tokens: number): CachePrefix => ({
    id,
    content: "x".repeat(tokens * 4),
  });

  it("skips prefixes below minTokens", () => {
    const plan = planWarmup(
      [
        longPrefix("small", 100),
        longPrefix("big", 2000),
      ],
      { minTokens: 1024 },
    );
    expect(plan.toWarm.map((p) => p.id)).toEqual(["big"]);
    expect(plan.skipped[0]?.prefix.id).toBe("small");
  });

  it("sorts by expectedUses desc", () => {
    const prefixes: CachePrefix[] = [
      { id: "a", content: "x".repeat(5000), expectedUses: 2 },
      { id: "b", content: "x".repeat(5000), expectedUses: 10 },
    ];
    const plan = planWarmup(prefixes);
    expect(plan.toWarm[0]?.id).toBe("b");
  });

  it("caps at maxPrefixes", () => {
    const prefixes: CachePrefix[] = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      content: "x".repeat(5000),
    }));
    const plan = planWarmup(prefixes, { maxPrefixes: 3 });
    expect(plan.toWarm).toHaveLength(3);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });
});

describe("warmupCache", () => {
  it("sends warmup requests", async () => {
    const prefixes: CachePrefix[] = [
      { id: "p1", content: "x".repeat(5000) },
      { id: "p2", content: "x".repeat(5000) },
    ];
    const sendFn = vi.fn(async () => {});
    const result = await warmupCache(prefixes, sendFn);
    expect(result.warmed).toBe(2);
    expect(result.failed).toBe(0);
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it("records failures", async () => {
    const prefixes: CachePrefix[] = [{ id: "p1", content: "x".repeat(5000) }];
    const sendFn = async () => {
      throw new Error("network down");
    };
    const result = await warmupCache(prefixes, sendFn);
    expect(result.failed).toBe(1);
    expect(result.warmed).toBe(0);
  });

  it("respects concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const prefixes: CachePrefix[] = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      content: "x".repeat(5000),
    }));
    const sendFn = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    };
    await warmupCache(prefixes, sendFn, { concurrency: 2, maxPrefixes: 10 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("calls onWarmup per successful + failed", async () => {
    const callbacks: Array<{ id: string; success: boolean }> = [];
    await warmupCache(
      [
        { id: "ok", content: "x".repeat(5000) },
        { id: "bad", content: "x".repeat(5000) },
      ],
      async (p) => {
        if (p.id === "bad") throw new Error("fail");
      },
      {
        onWarmup: (id, _d, success) => callbacks.push({ id, success }),
      },
    );
    expect(callbacks).toHaveLength(2);
    expect(callbacks.find((c) => c.id === "ok")?.success).toBe(true);
    expect(callbacks.find((c) => c.id === "bad")?.success).toBe(false);
  });
});

describe("CacheHitTracker", () => {
  it("tracks hits + misses", () => {
    const tracker = new CacheHitTracker();
    tracker.recordHit(500);
    tracker.recordHit(300);
    tracker.recordMiss(1000);
    const stats = tracker.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    expect(stats.tokensRead).toBe(800);
    expect(stats.tokensWritten).toBe(1000);
  });

  it("reset clears counters", () => {
    const tracker = new CacheHitTracker();
    tracker.recordHit(100);
    tracker.reset();
    expect(tracker.stats().hits).toBe(0);
  });

  it("hitRate is 0 when no events", () => {
    const tracker = new CacheHitTracker();
    expect(tracker.stats().hitRate).toBe(0);
  });
});
