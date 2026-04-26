/**
 * Tests for the V9 T6.2 onboarding wizard's pure logic surface.
 *
 * The wizard's state machine, availability computation, and ladder
 * filters are all exposed as pure functions so the flow can be
 * exercised without mounting Ink. Renderers are verified by the
 * first-run-success integration (T6.6) and the ladder test.
 */

import { describe, expect, it } from "vitest";
import type { HardwareProfile } from "../../src/core/hardware-detect.js";
import {
  STRATEGY_CHOICES,
  buildAvailabilityFromEnv,
  categoriesForStrategy,
  formatHardwareSummary,
  reduceWizard,
  rungsForStrategy,
  type OnboardingEnvFlags,
  type WizardStep,
} from "../../src/cli/onboarding-screens.js";
import { PROVIDER_LADDER } from "../../src/providers/provider-ladder.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function emptyFlags(): OnboardingEnvFlags {
  return {
    claudeCliAvailable: false,
    codexCliAvailable: false,
    hasGhToken: false,
    hasAnthropicKey: false,
    hasOpenAiKey: false,
    hasGroqKey: false,
    hasGeminiKey: false,
    hasCerebrasKey: false,
    hasDeepseekKey: false,
    hasOpenRouterKey: false,
    ollamaReachable: false,
    lmStudioReachable: false,
  };
}

function sampleHardware(): HardwareProfile {
  return {
    tier: "high",
    platform: "darwin",
    cpuCount: 12,
    cpuModel: "Apple M3 Pro",
    ramGb: 36,
    accelerator: { kind: "apple-silicon", label: "M3 Pro", vramGb: 36 },
    tierReason: "36 GB RAM + M3 Pro: can run 13-27B at Q4 comfortably.",
  };
}

// ── buildAvailabilityFromEnv ──────────────────────────────────────────────

describe("buildAvailabilityFromEnv", () => {
  it("returns all-false when no flags are set", () => {
    const avail = buildAvailabilityFromEnv(emptyFlags());
    for (const rung of PROVIDER_LADDER) {
      expect(avail[rung.probe]).toBe(false);
    }
  });

  it("maps claudeCliAvailable -> claude-cli probe", () => {
    const avail = buildAvailabilityFromEnv({
      ...emptyFlags(),
      claudeCliAvailable: true,
    });
    expect(avail["claude-cli"]).toBe(true);
    expect(avail["codex-cli"]).toBe(false);
  });

  it("maps every flag field to exactly one ladder probe key", () => {
    const fields: readonly (keyof OnboardingEnvFlags)[] = [
      "claudeCliAvailable",
      "codexCliAvailable",
      "hasGhToken",
      "hasAnthropicKey",
      "hasOpenAiKey",
      "hasGroqKey",
      "hasGeminiKey",
      "hasCerebrasKey",
      "hasDeepseekKey",
      "hasOpenRouterKey",
      "ollamaReachable",
      "lmStudioReachable",
    ];
    // 12 flags should produce 12 keys, each mapping to a ladder probe
    for (const f of fields) {
      const flags = { ...emptyFlags(), [f]: true };
      const avail = buildAvailabilityFromEnv(flags);
      const trueCount = Object.values(avail).filter((v) => v === true).length;
      expect(trueCount).toBe(1);
    }
  });
});

// ── categoriesForStrategy ─────────────────────────────────────────────────

describe("categoriesForStrategy", () => {
  it("maps 'app' to subscription", () => {
    expect(categoriesForStrategy("app")).toEqual(["subscription"]);
  });

  it("maps 'byok' to byok", () => {
    expect(categoriesForStrategy("byok")).toEqual(["byok"]);
  });

  it("maps 'free' to free-tier", () => {
    expect(categoriesForStrategy("free")).toEqual(["free-tier"]);
  });

  it("maps 'local' to local", () => {
    expect(categoriesForStrategy("local")).toEqual(["local"]);
  });

  it("maps 'later' to empty list", () => {
    expect(categoriesForStrategy("later")).toEqual([]);
  });
});

// ── rungsForStrategy ──────────────────────────────────────────────────────

describe("rungsForStrategy", () => {
  it("returns empty list for 'later'", () => {
    expect(rungsForStrategy("later")).toEqual([]);
  });

  it("preserves ladder order within a category", () => {
    const rungs = rungsForStrategy("free");
    const ranks = rungs.map((r) => r.rank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]!);
    }
  });

  it("includes only subscription rungs for 'app'", () => {
    const rungs = rungsForStrategy("app");
    expect(rungs.length).toBeGreaterThan(0);
    expect(rungs.every((r) => r.category === "subscription")).toBe(true);
  });

  it("includes only local rungs for 'local'", () => {
    const rungs = rungsForStrategy("local");
    expect(rungs.length).toBeGreaterThan(0);
    expect(rungs.every((r) => r.category === "local")).toBe(true);
  });
});

// ── formatHardwareSummary ─────────────────────────────────────────────────

describe("formatHardwareSummary", () => {
  it("uppercases the tier", () => {
    const profile = sampleHardware();
    expect(formatHardwareSummary(profile)).toContain("HIGH");
  });

  it("produces different text for each tier", () => {
    const tiers: readonly HardwareProfile["tier"][] = [
      "cloud-only",
      "low",
      "medium",
      "high",
      "extreme",
    ];
    const texts = tiers.map((t) =>
      formatHardwareSummary({ ...sampleHardware(), tier: t }),
    );
    expect(new Set(texts).size).toBe(tiers.length);
  });
});

// ── STRATEGY_CHOICES ──────────────────────────────────────────────────────

describe("STRATEGY_CHOICES", () => {
  it("ships exactly 6 strategies with auto first (V9 Wave 1-F order)", () => {
    expect(STRATEGY_CHOICES).toHaveLength(6);
    expect(STRATEGY_CHOICES.map((c) => c.key)).toEqual([
      "auto",
      "app",
      "byok",
      "free",
      "local",
      "later",
    ]);
  });

  it("labels and hints are non-empty", () => {
    for (const c of STRATEGY_CHOICES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.hint.length).toBeGreaterThan(0);
    }
  });
});

// ── reduceWizard ──────────────────────────────────────────────────────────

describe("reduceWizard", () => {
  const welcome: WizardStep = { kind: "welcome" };

  it("advances welcome -> strategy on next-from-welcome", () => {
    expect(reduceWizard(welcome, { type: "next-from-welcome" })).toEqual({
      kind: "strategy",
    });
  });

  it("pick-strategy 'later' jumps straight to done:skip", () => {
    const next = reduceWizard({ kind: "strategy" }, {
      type: "pick-strategy",
      strategy: "later",
    });
    expect(next.kind).toBe("done");
    if (next.kind === "done") {
      expect(next.reason).toBe("skip");
      expect(next.rung).toBeNull();
    }
  });

  it("pick-strategy 'app' transitions to pick screen for that strategy", () => {
    const next = reduceWizard({ kind: "strategy" }, {
      type: "pick-strategy",
      strategy: "app",
    });
    expect(next).toEqual({ kind: "pick", strategy: "app" });
  });

  it("pick-rung with null rung transitions to confirm with rung:null", () => {
    const next = reduceWizard(
      { kind: "pick", strategy: "byok" },
      { type: "pick-rung", rung: null },
    );
    expect(next).toEqual({ kind: "confirm", strategy: "byok", rung: null });
  });

  it("confirm with rung:null jumps straight to done:skip", () => {
    const next = reduceWizard(
      { kind: "confirm", strategy: "byok", rung: null },
      { type: "confirm" },
    );
    expect(next.kind).toBe("done");
    if (next.kind === "done") expect(next.reason).toBe("skip");
  });

  it("confirm with a rung transitions to firstRun", () => {
    const rung = PROVIDER_LADDER[0]!;
    const next = reduceWizard(
      { kind: "confirm", strategy: "app", rung },
      { type: "confirm" },
    );
    expect(next).toEqual({ kind: "firstRun", strategy: "app", rung });
  });

  it("finish action records success outcome in done state", () => {
    const rung = PROVIDER_LADDER[0]!;
    const state: WizardStep = {
      kind: "firstRun",
      strategy: "app",
      rung,
    };
    const next = reduceWizard(state, { type: "finish", reason: "success" });
    expect(next.kind).toBe("done");
    if (next.kind === "done") {
      expect(next.reason).toBe("success");
      expect(next.rung).toEqual(rung);
    }
  });

  it("finish action records failureReason when reason is 'failed'", () => {
    const rung = PROVIDER_LADDER[0]!;
    const state: WizardStep = {
      kind: "firstRun",
      strategy: "app",
      rung,
    };
    const next = reduceWizard(state, {
      type: "finish",
      reason: "failed",
      failureReason: "timeout",
    });
    expect(next.kind).toBe("done");
    if (next.kind === "done") {
      expect(next.reason).toBe("failed");
      expect(next.failureReason).toBe("timeout");
    }
  });

  it("back navigates strategy -> welcome", () => {
    expect(reduceWizard({ kind: "strategy" }, { type: "back" })).toEqual({
      kind: "welcome",
    });
  });

  it("back navigates pick -> strategy, preserving no extra state", () => {
    expect(
      reduceWizard({ kind: "pick", strategy: "app" }, { type: "back" }),
    ).toEqual({ kind: "strategy" });
  });

  it("back from confirm preserves the originally picked strategy", () => {
    const rung = PROVIDER_LADDER[0]!;
    const next = reduceWizard(
      { kind: "confirm", strategy: "byok", rung },
      { type: "back" },
    );
    expect(next).toEqual({ kind: "pick", strategy: "byok" });
  });

  it("ignores mismatched actions (e.g. pick-rung from welcome)", () => {
    const rung = PROVIDER_LADDER[0]!;
    const next = reduceWizard(welcome, { type: "pick-rung", rung });
    expect(next).toEqual(welcome);
  });
});
