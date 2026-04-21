/**
 * Phase 2 P1-M4 — RRF (Reciprocal Rank Fusion) for TEMPR.
 *
 * Tests the id-keyed RRF helper that takes per-channel score maps and
 * returns a fused ranking. The canonical hybridFusion in
 * extended-search-types is hit-keyed; this wrapper exposes the
 * id-keyed form TEMPR channels naturally produce.
 */

import { describe, it, expect } from "vitest";
import { reciprocalRankFusion, type ChannelRanking } from "../../src/memory/rrf.js";

describe("reciprocalRankFusion", () => {
  it("returns [] when all channels are empty", () => {
    const out = reciprocalRankFusion([]);
    expect(out).toEqual([]);
  });

  it("returns [] when channels have zero entries", () => {
    const empty: ChannelRanking = { ranked: [] };
    const out = reciprocalRankFusion([empty, empty]);
    expect(out).toEqual([]);
  });

  it("assigns higher score to ids appearing at rank 0 across channels", () => {
    const c1: ChannelRanking = { ranked: ["a", "b", "c"] };
    const c2: ChannelRanking = { ranked: ["a", "c", "b"] };
    const out = reciprocalRankFusion([c1, c2]);
    expect(out[0]?.id).toBe("a"); // appears first in both channels
    expect(out.length).toBe(3);
  });

  it("classic RRF formula: 1/(k+rank+1) summed across channels", () => {
    const c1: ChannelRanking = { ranked: ["x", "y"] };
    const c2: ChannelRanking = { ranked: ["y", "x"] };
    const out = reciprocalRankFusion([c1, c2], { k: 60 });
    // x: 1/(60+1) + 1/(60+2) = 0.01639 + 0.01613 = 0.03252
    // y: 1/(60+2) + 1/(60+1) = same
    // Both tied, but output is deterministic (first-seen order).
    const xScore = out.find((r) => r.id === "x")?.score;
    const yScore = out.find((r) => r.id === "y")?.score;
    expect(xScore).toBeDefined();
    expect(yScore).toBeDefined();
    expect(Math.abs((xScore ?? 0) - (yScore ?? 0))).toBeLessThan(1e-9);
  });

  it("single-channel pass-through preserves original order", () => {
    const c: ChannelRanking = { ranked: ["a", "b", "c"] };
    const out = reciprocalRankFusion([c]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("respects custom k constant — higher k flattens score differences", () => {
    const c1: ChannelRanking = { ranked: ["a", "b"] };
    const c2: ChannelRanking = { ranked: ["b", "a"] };
    const kLow = reciprocalRankFusion([c1, c2], { k: 1 });
    const kHigh = reciprocalRankFusion([c1, c2], { k: 1000 });
    // At k=1: 1/2 + 1/3 = 0.833; 1/3 + 1/2 = 0.833 → tied again
    // At k=1000: 1/1001 + 1/1002 ≈ 1/1001 + 1/1002 → still tied
    // Test: higher k yields lower absolute scores.
    expect(kLow[0]?.score).toBeGreaterThan(kHigh[0]?.score ?? 0);
  });

  it("handles channels with disjoint ids — union is returned", () => {
    const c1: ChannelRanking = { ranked: ["a"] };
    const c2: ChannelRanking = { ranked: ["b"] };
    const c3: ChannelRanking = { ranked: ["c"] };
    const out = reciprocalRankFusion([c1, c2, c3]);
    expect(out.length).toBe(3);
    expect(new Set(out.map((r) => r.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("preserves channel provenance in the fused output", () => {
    const c1: ChannelRanking = { ranked: ["a", "b"], channelName: "vector" };
    const c2: ChannelRanking = { ranked: ["b", "c"], channelName: "bm25" };
    const out = reciprocalRankFusion([c1, c2]);
    const b = out.find((r) => r.id === "b");
    expect(b?.contributingChannels).toContain("vector");
    expect(b?.contributingChannels).toContain("bm25");
  });

  it("output is sorted by descending score", () => {
    const c: ChannelRanking = { ranked: ["first", "second", "third"] };
    const out = reciprocalRankFusion([c]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.score).toBeLessThanOrEqual(out[i - 1]!.score);
    }
  });

  it("rank 0 beats rank 5 in the same channel", () => {
    const c: ChannelRanking = { ranked: ["first", "b", "c", "d", "e", "sixth"] };
    const out = reciprocalRankFusion([c]);
    const firstScore = out.find((r) => r.id === "first")?.score;
    const sixthScore = out.find((r) => r.id === "sixth")?.score;
    expect(firstScore).toBeGreaterThan(sixthScore ?? 0);
  });
});
