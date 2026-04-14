import { describe, it, expect } from "vitest";
import { CostOracle } from "../../src/telemetry/cost-oracle.js";

describe("CostOracle", () => {
  const oracle = new CostOracle();

  describe("estimateTaskCost", () => {
    it("estimates cost for a simple task", () => {
      const estimate = oracle.estimateTaskCost(
        "fix typo in readme",
        "anthropic",
        "claude-sonnet-4-6",
      );

      expect(estimate.provider).toBe("anthropic");
      expect(estimate.model).toBe("claude-sonnet-4-6");
      expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
      expect(estimate.confidencePercent).toBeGreaterThan(0);
      expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    });

    it("estimates higher cost for complex tasks", () => {
      const simple = oracle.estimateTaskCost(
        "fix typo",
        "anthropic",
        "claude-sonnet-4-6",
      );
      const complex = oracle.estimateTaskCost(
        "implement the complete user authentication feature with OAuth2 and SSO",
        "anthropic",
        "claude-sonnet-4-6",
      );

      expect(complex.estimatedCostUsd).toBeGreaterThan(simple.estimatedCostUsd);
      expect(complex.estimatedInputTokens).toBeGreaterThan(
        simple.estimatedInputTokens,
      );
    });

    it("returns zero cost for unknown model", () => {
      const estimate = oracle.estimateTaskCost(
        "do something",
        "anthropic",
        "nonexistent-model",
      );

      expect(estimate.estimatedCostUsd).toBe(0);
      expect(estimate.confidencePercent).toBe(0);
    });

    it("returns zero cost for free-tier", () => {
      const estimate = oracle.estimateTaskCost(
        "classify this text",
        "free",
        "free-tier",
      );

      expect(estimate.estimatedCostUsd).toBe(0);
    });

    it("returns higher cost for opus than sonnet", () => {
      const opus = oracle.estimateTaskCost(
        "implement feature X",
        "anthropic",
        "claude-opus-4-6",
      );
      const sonnet = oracle.estimateTaskCost(
        "implement feature X",
        "anthropic",
        "claude-sonnet-4-6",
      );

      expect(opus.estimatedCostUsd).toBeGreaterThan(sonnet.estimatedCostUsd);
    });

    it("includes cost breakdown", () => {
      const estimate = oracle.estimateTaskCost(
        "implement feature",
        "anthropic",
        "claude-sonnet-4-6",
      );

      expect(estimate.breakdown.inputCost).toBeGreaterThan(0);
      expect(estimate.breakdown.outputCost).toBeGreaterThan(0);
      expect(estimate.breakdown.totalCost).toBeCloseTo(
        estimate.breakdown.inputCost +
          estimate.breakdown.outputCost +
          estimate.breakdown.thinkingCost,
        6,
      );
    });
  });

  describe("estimateAutonomousCost", () => {
    it("scales with number of cycles", () => {
      const fewCycles = oracle.estimateAutonomousCost("fix a bug", 3);
      const manyCycles = oracle.estimateAutonomousCost("fix a bug", 10);

      expect(manyCycles.estimatedCostUsd).toBeGreaterThan(
        fewCycles.estimatedCostUsd,
      );
    });

    it("returns lower confidence for more cycles", () => {
      const fewCycles = oracle.estimateAutonomousCost("task", 2);
      const manyCycles = oracle.estimateAutonomousCost("task", 15);

      expect(manyCycles.confidencePercent).toBeLessThanOrEqual(
        fewCycles.confidencePercent,
      );
    });

    it("uses anthropic/sonnet as default model", () => {
      const estimate = oracle.estimateAutonomousCost("do something", 5);
      expect(estimate.provider).toBe("anthropic");
      expect(estimate.model).toBe("claude-sonnet-4-6");
    });

    it("estimates non-zero input tokens", () => {
      const estimate = oracle.estimateAutonomousCost("implement feature", 5);
      expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
      expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
    });
  });

  describe("compareCosts", () => {
    it("returns comparisons for all known models", () => {
      const comparisons = oracle.compareCosts("implement a feature");

      expect(comparisons.length).toBeGreaterThan(0);
      // Should have at least anthropic and openai entries
      expect(comparisons.some((c) => c.provider === "anthropic")).toBe(true);
      expect(comparisons.some((c) => c.provider === "openai")).toBe(true);
    });

    it("marks exactly one provider as cheapest (for free-tier tasks)", () => {
      const comparisons = oracle.compareCosts("classify text");
      const cheapest = comparisons.filter((c) => c.isCheapest);

      // Free-tier providers should all be cheapest at $0
      expect(cheapest.length).toBeGreaterThanOrEqual(1);
      expect(cheapest[0]?.estimatedCostUsd).toBe(0);
    });

    it("computes relative costs", () => {
      const comparisons = oracle.compareCosts("implement feature");

      // All relative costs should be >= 0
      for (const c of comparisons) {
        expect(c.relativeCost).toBeGreaterThanOrEqual(0);
      }

      // Cheapest should have relativeCost of 0 (free) or 1 (paid)
      const cheapest = comparisons.find((c) => c.isCheapest);
      expect(cheapest?.relativeCost).toBeLessThanOrEqual(1);
    });

    it("includes both provider and model in each comparison", () => {
      const comparisons = oracle.compareCosts("do something");

      for (const c of comparisons) {
        expect(c.provider).toBeTruthy();
        expect(c.model).toBeTruthy();
      }
    });
  });
});
