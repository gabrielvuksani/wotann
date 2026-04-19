import { describe, it, expect } from "vitest";
import {
  shouldAbstain,
  evaluate,
  buildAbstentionResponse,
  buildAbstentionFromHits,
  DEFAULT_THRESHOLDS,
  type AbstentionThresholds,
} from "../../src/memory/abstention.js";
import type { SearchHit, SearchableEntry } from "../../src/memory/extended-search-types.js";

// ── Fixtures ───────────────────────────────────────────

function entry(id: string, content: string = ""): SearchableEntry {
  return { id, content: content || `entry-${id}` };
}

function hit(id: string, score: number): SearchHit {
  return { entry: entry(id), score };
}

describe("shouldAbstain — top-1 score signal", () => {
  it("abstains when top-1 < min AND spread is flat", () => {
    const hits: SearchHit[] = [
      hit("a", 0.4),
      hit("b", 0.39),
      hit("c", 0.38),
      hit("d", 0.37),
      hit("e", 0.36),
    ];
    expect(shouldAbstain({ hits })).toBe(true);
  });

  it("does NOT abstain when top-1 is strong (even if tail is close)", () => {
    const hits: SearchHit[] = [
      hit("a", 0.9),
      hit("b", 0.89),
      hit("c", 0.88),
      hit("d", 0.87),
      hit("e", 0.86),
    ];
    // top-1 passes, spread fails → answered (strict AND)
    expect(shouldAbstain({ hits })).toBe(false);
  });
});

describe("shouldAbstain — spread signal", () => {
  it("abstains when top-1 is weak and results are flat", () => {
    const hits: SearchHit[] = [
      hit("a", 0.3),
      hit("b", 0.28),
      hit("c", 0.27),
    ];
    expect(shouldAbstain({ hits })).toBe(true);
  });

  it("does NOT abstain when spread is strong (even with low top-1 tail)", () => {
    // top-1 0.70, tail mean 0.10 → spread 0.60 way above 0.15.
    // top-1 passes threshold 0.65, spread passes → answered.
    const hits: SearchHit[] = [
      hit("a", 0.7),
      hit("b", 0.1),
      hit("c", 0.1),
      hit("d", 0.1),
      hit("e", 0.1),
    ];
    expect(shouldAbstain({ hits })).toBe(false);
  });
});

describe("shouldAbstain — context relevance signal", () => {
  it("abstains when relevance is below threshold and top-1 / spread are also weak", () => {
    const hits: SearchHit[] = [
      hit("a", 0.5),
      hit("b", 0.48),
      hit("c", 0.47),
    ];
    const contextRelevance = [0.4, 0.3, 0.3];
    expect(shouldAbstain({ hits, contextRelevance })).toBe(true);
  });

  it("does not abstain when relevance is high (strict AND)", () => {
    const hits: SearchHit[] = [
      hit("a", 0.4),
      hit("b", 0.39),
      hit("c", 0.38),
    ];
    const contextRelevance = [0.95];
    // top-1 fails, spread fails, relevance passes → NOT abstain
    expect(shouldAbstain({ hits, contextRelevance })).toBe(false);
  });

  it("skips relevance signal when no relevance array provided", () => {
    // 2 signals evaluated; both must fail to abstain.
    const hits: SearchHit[] = [hit("a", 0.9), hit("b", 0.1)]; // top-1 strong
    const d = evaluate({ hits });
    expect(d.skipped).toContain("contextRelevance");
    expect(d.abstain).toBe(false);
  });
});

describe("shouldAbstain — edge cases", () => {
  it("abstains on empty hits (all signals fail at zero)", () => {
    expect(shouldAbstain({ hits: [] })).toBe(true);
    const r = buildAbstentionResponse({ hits: [] });
    expect(r.answer).toBe("I don't know");
  });

  it("abstains on a single weak hit (spread undetermined → treated as ambiguous)", () => {
    // Only 1 hit, score below threshold, no relevance → top1 fails, spread=0 (fails)
    const hits: SearchHit[] = [hit("a", 0.2)];
    expect(shouldAbstain({ hits })).toBe(true);
  });

  it("does NOT abstain on a single strong hit even with spread=0", () => {
    const hits: SearchHit[] = [hit("a", 0.95)];
    // top-1 passes, spread fails → 1 pass 1 fail, NOT all-fail → don't abstain
    expect(shouldAbstain({ hits })).toBe(false);
  });
});

describe("evaluate — signal breakdown", () => {
  it("returns full decision breakdown", () => {
    const hits: SearchHit[] = [
      hit("a", 0.8),
      hit("b", 0.3),
      hit("c", 0.2),
    ];
    const d = evaluate({ hits });
    expect(d.passes).toContain("top1Score");
    expect(d.passes).toContain("top1vsTopKSpread");
    expect(d.skipped).toContain("contextRelevance");
    expect(d.measured.top1Score).toBe(0.8);
    expect(d.measured.top1vsTopKSpread).toBeCloseTo(0.8 - 0.25, 3);
  });

  it("reports failures accurately", () => {
    const hits: SearchHit[] = [hit("a", 0.1), hit("b", 0.09)];
    const d = evaluate({ hits });
    expect(d.failures).toContain("top1Score");
    expect(d.failures).toContain("top1vsTopKSpread");
  });
});

describe("buildAbstentionResponse", () => {
  it("returns 'I don't know' with confidence when abstaining", () => {
    const hits: SearchHit[] = [
      hit("a", 0.3),
      hit("b", 0.28),
      hit("c", 0.27),
    ];
    const r = buildAbstentionResponse({ hits });
    expect(r.answer).toBe("I don't know");
    // confidence = 1 - top1 = 0.7
    expect(r.confidence).toBeCloseTo(0.7, 3);
    expect(r.reason.toLowerCase()).toContain("abstained");
  });

  it("returns top hit when answering", () => {
    const hits: SearchHit[] = [
      hit("a", 0.9),
      hit("b", 0.1),
      hit("c", 0.1),
    ];
    const r = buildAbstentionResponse({ hits });
    expect(r.answer).not.toBe("I don't know");
    if (r.answer !== "I don't know") {
      expect(r.answer.entry.id).toBe("a");
    }
    expect(r.confidence).toBeCloseTo(0.9, 3);
    expect(r.reason.toLowerCase()).toContain("answered");
  });

  it("never fabricates a confidence outside [0, 1]", () => {
    const hits: SearchHit[] = [hit("a", 1.5)]; // provider might return >1
    const r = buildAbstentionResponse({ hits });
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });

  it("handles NaN/Infinity scores without propagating garbage", () => {
    const hits: SearchHit[] = [hit("a", Number.NaN)];
    const r = buildAbstentionResponse({ hits });
    expect(Number.isFinite(r.confidence)).toBe(true);
  });

  it("explains WHICH signals failed in the reason string", () => {
    const hits: SearchHit[] = [
      hit("a", 0.3),
      hit("b", 0.29),
      hit("c", 0.28),
    ];
    const r = buildAbstentionResponse({ hits });
    // Reason should cite top-1 score and spread
    expect(r.reason).toMatch(/top-1 score/);
    expect(r.reason).toMatch(/spread/);
  });

  it("empty hits → 'I don't know' with confidence 1", () => {
    const r = buildAbstentionResponse({ hits: [] });
    expect(r.answer).toBe("I don't know");
    expect(r.confidence).toBe(1);
  });
});

describe("custom thresholds", () => {
  it("stricter thresholds reject more", () => {
    const hits: SearchHit[] = [
      hit("a", 0.66),
      hit("b", 0.1),
      hit("c", 0.1),
    ];
    // With default 0.65, this passes. With 0.8, it fails.
    expect(shouldAbstain({ hits })).toBe(false);
    const strict: AbstentionThresholds = {
      ...DEFAULT_THRESHOLDS,
      minTop1Score: 0.8,
    };
    // With strict: top-1 fails, spread still passes → 1 pass 1 fail → NOT abstain
    expect(shouldAbstain({ hits }, strict)).toBe(false);
    // But if we tighten spread too → abstain
    const stricter: AbstentionThresholds = {
      ...strict,
      minTop1vsTopKSpread: 0.8,
    };
    expect(shouldAbstain({ hits }, stricter)).toBe(true);
  });

  it("custom spreadK averages over different tail sizes", () => {
    const hits: SearchHit[] = [
      hit("a", 0.9),
      hit("b", 0.8),
      hit("c", 0.1),
      hit("d", 0.1),
      hit("e", 0.1),
    ];
    const narrow: AbstentionThresholds = {
      ...DEFAULT_THRESHOLDS,
      spreadK: 2, // only compare top-1 to b
    };
    const wide: AbstentionThresholds = {
      ...DEFAULT_THRESHOLDS,
      spreadK: 5,
    };
    const narrowSpread = evaluate({ hits }, narrow).measured.top1vsTopKSpread;
    const wideSpread = evaluate({ hits }, wide).measured.top1vsTopKSpread;
    // Narrow spread (top1 0.9 - b 0.8 = 0.1) < wide spread (top1 - mean(b,c,d,e))
    expect(narrowSpread).toBeLessThan(wideSpread);
  });
});

describe("buildAbstentionFromHits convenience", () => {
  it("delegates to buildAbstentionResponse", () => {
    const hits: SearchHit[] = [hit("a", 0.9), hit("b", 0.1)];
    const r = buildAbstentionFromHits(hits);
    expect(r.answer).not.toBe("I don't know");
  });

  it("accepts a custom context-relevance array", () => {
    const hits: SearchHit[] = [hit("a", 0.2), hit("b", 0.19)];
    const r = buildAbstentionFromHits(hits, DEFAULT_THRESHOLDS, [0.1, 0.1]);
    expect(r.answer).toBe("I don't know");
    expect(r.decision.failures).toContain("contextRelevance");
  });
});

describe("honesty (quality bar #6)", () => {
  it("confidence tracks top-1 score — no fabricated boosts", () => {
    const hits: SearchHit[] = [hit("a", 0.73), hit("b", 0.1)];
    const r = buildAbstentionResponse({ hits });
    expect(r.confidence).toBe(0.73);
  });

  it("decision is fully visible (no hidden magic)", () => {
    const hits: SearchHit[] = [hit("a", 0.5), hit("b", 0.4)];
    const r = buildAbstentionResponse({ hits });
    // Caller can see exactly which signals failed/passed/were skipped
    expect(r.decision.failures.length + r.decision.passes.length + r.decision.skipped.length)
      .toBe(3);
  });
});
