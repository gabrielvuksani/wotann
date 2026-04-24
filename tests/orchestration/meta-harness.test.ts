/**
 * Tier 12 T12.1 — Meta-Harness policy tests.
 *
 * Covers: strategy selection across complexity buckets, budget awareness,
 * preference overrides, input validation, bucket thresholds, adapter
 * fallback, per-caller isolation.
 */

import { describe, it, expect } from "vitest";
import {
  createMetaHarness,
  decide,
  type MetaHarnessInputs,
  type MetaHarnessSuccess,
  type MetaHarnessFailure,
  type ProviderAvailability,
  type BudgetSnapshot,
  type ComplexitySignals,
} from "../../src/orchestration/meta-harness.js";

// ── Fixtures ──────────────────────────────────────────────

function bothAvailable(adapters: readonly string[] = ["fly-sprites"]): ProviderAvailability {
  return {
    cloudOffloadAvailable: true,
    liveAdapters: adapters,
    localAvailable: true,
  };
}

function localOnly(): ProviderAvailability {
  return {
    cloudOffloadAvailable: false,
    liveAdapters: [],
    localAvailable: true,
  };
}

function cloudOnly(adapters: readonly string[] = ["fly-sprites"]): ProviderAvailability {
  return {
    cloudOffloadAvailable: true,
    liveAdapters: adapters,
    localAvailable: false,
  };
}

function unlimitedBudget(spent = 0): BudgetSnapshot {
  return { spentUsd: spent, capUsd: Infinity };
}

function tightBudget(spent: number, cap: number): BudgetSnapshot {
  return { spentUsd: spent, capUsd: cap };
}

function makeInputs(args: {
  complexity: ComplexitySignals;
  availability?: ProviderAvailability;
  budget?: BudgetSnapshot;
}): MetaHarnessInputs {
  return {
    complexity: args.complexity,
    availability: args.availability ?? bothAvailable(),
    budget: args.budget ?? unlimitedBudget(),
  };
}

function asSuccess(d: MetaHarnessSuccess | MetaHarnessFailure): MetaHarnessSuccess {
  if (!d.ok) {
    throw new Error(`expected success but got failure: ${d.reason}`);
  }
  return d;
}

// ── Bucket / score tests ─────────────────────────────────

describe("decide — complexity bucketing", () => {
  it("trivial task → local strategy", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { estimatedTokens: 500, expectedFilesTouched: 1, phaseCount: 1 },
        }),
      ),
    );
    expect(d.complexity).toBe("trivial");
    expect(d.strategy).toBe("local");
    expect(d.estimatedCostUsd).toBe(0);
  });

  it("small task → local strategy", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { estimatedTokens: 15_000, expectedFilesTouched: 3, phaseCount: 2 },
        }),
      ),
    );
    expect(d.complexity).toBe("small");
    expect(d.strategy).toBe("local");
  });

  it("medium task → hybrid strategy (default)", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { estimatedTokens: 60_000, expectedFilesTouched: 12, phaseCount: 4 },
        }),
      ),
    );
    expect(d.complexity).toBe("medium");
    expect(d.strategy).toBe("hybrid");
    expect(d.suggestedAdapter).toBe("fly-sprites");
  });

  it("large task → hybrid strategy", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: {
            estimatedTokens: 140_000,
            expectedFilesTouched: 30,
            phaseCount: 6,
            expectedDurationMinutes: 90,
          },
        }),
      ),
    );
    expect(d.complexity).toBe("large");
    expect(d.strategy).toBe("hybrid");
  });

  it("xlarge task → cloud-offload strategy", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { explicitBucket: "xlarge", estimatedTokens: 300_000 },
        }),
      ),
    );
    expect(d.complexity).toBe("xlarge");
    expect(d.strategy).toBe("cloud-offload");
  });

  it("explicitBucket overrides score-derived bucket", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: {
            explicitBucket: "xlarge",
            estimatedTokens: 100, // would otherwise be trivial
          },
        }),
      ),
    );
    expect(d.complexity).toBe("xlarge");
    expect(d.strategy).toBe("cloud-offload");
  });

  it("score is always within [0, 1]", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: {
            estimatedTokens: 10_000_000,
            expectedFilesTouched: 10_000,
            phaseCount: 100,
            expectedDurationMinutes: 5_000,
          },
        }),
      ),
    );
    expect(d.score).toBeGreaterThanOrEqual(0);
    expect(d.score).toBeLessThanOrEqual(1);
  });
});

// ── Preference overrides ────────────────────────────────

describe("decide — preferences", () => {
  it("preferLocal keeps medium task on local", () => {
    const d = asSuccess(
      decide({
        ...makeInputs({
          complexity: { estimatedTokens: 60_000, expectedFilesTouched: 12, phaseCount: 4 },
        }),
        preferences: { preferLocal: true },
      }),
    );
    expect(d.strategy).toBe("local");
  });

  it("forceCloud routes any task to cloud-offload", () => {
    const d = asSuccess(
      decide({
        ...makeInputs({
          complexity: { estimatedTokens: 100 },
        }),
        preferences: { forceCloud: true },
      }),
    );
    expect(d.strategy).toBe("cloud-offload");
    expect(d.rejectedAlternatives.some((r) => r.strategy === "local")).toBe(true);
    expect(d.rejectedAlternatives.some((r) => r.strategy === "hybrid")).toBe(true);
  });

  it("allowHybrid=false disables hybrid on medium tasks", () => {
    const d = asSuccess(
      decide({
        ...makeInputs({
          complexity: { estimatedTokens: 60_000, expectedFilesTouched: 12, phaseCount: 4 },
        }),
        preferences: { allowHybrid: false },
      }),
    );
    expect(d.strategy).toBe("local");
    expect(d.rejectedAlternatives.some((r) => r.strategy === "hybrid")).toBe(true);
  });

  it("contradictory preferences (preferLocal + forceCloud) yield failure", () => {
    const d = decide({
      ...makeInputs({
        complexity: { estimatedTokens: 500 },
      }),
      preferences: { preferLocal: true, forceCloud: true },
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("contradict");
  });

  it("forceCloud without adapter yields failure", () => {
    const d = decide({
      ...makeInputs({
        complexity: { estimatedTokens: 500 },
        availability: localOnly(),
      }),
      preferences: { forceCloud: true },
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("forceCloud");
  });
});

// ── Budget-aware routing ─────────────────────────────────

describe("decide — budget awareness", () => {
  it("tight budget blocks cloud-offload on xlarge", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { explicitBucket: "xlarge" },
          budget: tightBudget(4.99, 5.0),
        }),
      ),
    );
    // Cloud is rejected for budget, hybrid fallback chosen or local last-resort.
    expect(d.strategy === "hybrid" || d.strategy === "local").toBe(true);
    expect(d.rejectedAlternatives.some((r) => r.strategy === "cloud-offload")).toBe(true);
  });

  it("unlimited budget allows full cloud on xlarge", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { explicitBucket: "xlarge" },
          budget: unlimitedBudget(100),
        }),
      ),
    );
    expect(d.strategy).toBe("cloud-offload");
  });

  it("cloudFloorUsd blocks cloud when remaining budget below floor", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { explicitBucket: "xlarge" },
          budget: { spentUsd: 4, capUsd: 5, cloudFloorUsd: 10 },
        }),
      ),
    );
    expect(d.strategy).not.toBe("cloud-offload");
    expect(d.rejectedAlternatives.some((r) => r.reason.includes("cloudFloorUsd"))).toBe(true);
  });

  it("maxUsdForThisTask preference overrides budget snapshot", () => {
    const d = asSuccess(
      decide({
        ...makeInputs({
          complexity: { explicitBucket: "xlarge" },
          budget: unlimitedBudget(),
        }),
        preferences: { maxUsdForThisTask: 0.001 },
      }),
    );
    // 0.001 USD is too little for xlarge cloud-offload (250K tokens × 2e-5).
    expect(d.strategy).not.toBe("cloud-offload");
  });
});

// ── Availability fallbacks ──────────────────────────────

describe("decide — availability", () => {
  it("local-only availability → always local", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { estimatedTokens: 60_000, expectedFilesTouched: 12, phaseCount: 4 },
          availability: localOnly(),
        }),
      ),
    );
    expect(d.strategy).toBe("local");
    expect(d.suggestedAdapter).toBeUndefined();
  });

  it("cloud-only availability → always cloud", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { estimatedTokens: 500 },
          availability: cloudOnly(["cloudflare-agents"]),
        }),
      ),
    );
    expect(d.strategy).toBe("cloud-offload");
    expect(d.suggestedAdapter).toBe("cloudflare-agents");
  });

  it("both unavailable → failure", () => {
    const d = decide(
      makeInputs({
        complexity: { estimatedTokens: 500 },
        availability: {
          cloudOffloadAvailable: false,
          liveAdapters: [],
          localAvailable: false,
        },
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("picks the first live adapter by default", () => {
    const d = asSuccess(
      decide(
        makeInputs({
          complexity: { explicitBucket: "xlarge" },
          availability: bothAvailable(["fly-sprites", "cloudflare-agents", "anthropic-managed"]),
        }),
      ),
    );
    expect(d.suggestedAdapter).toBe("fly-sprites");
  });
});

// ── Input validation ────────────────────────────────────

describe("decide — input validation", () => {
  it("rejects missing complexity", () => {
    const d = decide({
      complexity: undefined as unknown as ComplexitySignals,
      availability: bothAvailable(),
      budget: unlimitedBudget(),
    });
    expect(d.ok).toBe(false);
  });

  it("rejects negative spentUsd", () => {
    const d = decide(
      makeInputs({
        complexity: { estimatedTokens: 100 },
        budget: { spentUsd: -1, capUsd: 10 },
      }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("spentUsd");
  });

  it("rejects negative capUsd", () => {
    const d = decide(
      makeInputs({
        complexity: { estimatedTokens: 100 },
        budget: { spentUsd: 0, capUsd: -1 },
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("rejects invalid threshold ordering", () => {
    const harness = createMetaHarness({
      complexityThresholds: { trivial: 0.5, small: 0.3, medium: 0.4, large: 0.9 },
    });
    const d = harness.decide(
      makeInputs({
        complexity: { estimatedTokens: 100 },
      }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("ascending");
  });

  it("rejects negative cloudCostPerToken override", () => {
    const harness = createMetaHarness({ cloudCostPerToken: -0.01 });
    const d = harness.decide(
      makeInputs({
        complexity: { estimatedTokens: 100 },
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("rejects hybridCloudFraction outside [0, 1]", () => {
    const harness = createMetaHarness({ hybridCloudFraction: 1.5 });
    const d = harness.decide(
      makeInputs({
        complexity: { estimatedTokens: 100 },
      }),
    );
    expect(d.ok).toBe(false);
  });
});

// ── Factory + isolation ─────────────────────────────────

describe("createMetaHarness — per-caller isolation", () => {
  it("returns independent instances", () => {
    const a = createMetaHarness();
    const b = createMetaHarness();
    expect(a).not.toBe(b);
    // Both decide consistently on the same inputs.
    const inputs = makeInputs({ complexity: { estimatedTokens: 500 } });
    const da = asSuccess(a.decide(inputs));
    const db = asSuccess(b.decide(inputs));
    expect(da.strategy).toBe(db.strategy);
  });

  it("overrides are per-instance", () => {
    const defaulted = createMetaHarness();
    const expensive = createMetaHarness({ cloudCostPerToken: 1 });
    const inputs = makeInputs({
      complexity: { explicitBucket: "xlarge" },
      budget: tightBudget(0, 50),
    });
    const dDef = asSuccess(defaulted.decide(inputs));
    const dExp = asSuccess(expensive.decide(inputs));
    // Expensive cost model should make cloud prohibitive → not cloud.
    expect(dDef.strategy).toBe("cloud-offload");
    expect(dExp.strategy).not.toBe("cloud-offload");
  });

  it("custom thresholds shift bucket boundaries", () => {
    const generous = createMetaHarness({
      complexityThresholds: { trivial: 0.8, small: 0.85, medium: 0.9, large: 0.95 },
    });
    const d = asSuccess(
      generous.decide(
        makeInputs({
          complexity: { estimatedTokens: 100_000, expectedFilesTouched: 15 },
        }),
      ),
    );
    // Under generous thresholds this would score ~0.25 which is now trivial.
    expect(d.complexity === "trivial" || d.complexity === "small").toBe(true);
  });
});

// ── Reasoning surface ───────────────────────────────────

describe("decide — reason + rejected alternatives", () => {
  it("always includes a non-empty reason on success", () => {
    const d = asSuccess(decide(makeInputs({ complexity: { estimatedTokens: 500 } })));
    expect(d.reason.length).toBeGreaterThan(5);
  });

  it("surfaces rejected alternatives when forced", () => {
    const d = asSuccess(
      decide({
        ...makeInputs({ complexity: { estimatedTokens: 500 } }),
        preferences: { forceCloud: true },
      }),
    );
    expect(d.rejectedAlternatives.length).toBeGreaterThan(0);
  });
});
