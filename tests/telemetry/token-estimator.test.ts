import { describe, it, expect } from "vitest";
import {
  estimatePromptTokens,
  estimateCost,
  compareModelCosts,
  checkBudget,
  type ModelPricing,
  type ModelOption,
} from "../../src/telemetry/token-estimator.js";

const opusPricing: ModelPricing = { inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 0.0015 };
const haikuPricing: ModelPricing = { inputPer1k: 0.0008, outputPer1k: 0.004 };

describe("estimatePromptTokens", () => {
  it("0 on empty", () => {
    expect(estimatePromptTokens("")).toBe(0);
  });

  it("prose at 4 chars/token", () => {
    const prose = "a".repeat(400);
    expect(estimatePromptTokens(prose)).toBe(100);
  });

  it("code lower chars/token (higher count)", () => {
    const code = "function x() { return { a: 1 }; }".repeat(10);
    const prose = "just a sentence of words repeat ".repeat(10);
    const codeTok = estimatePromptTokens(code);
    const proseTok = estimatePromptTokens(prose);
    // Same length but code tokenizes to more tokens
    expect(codeTok / code.length).toBeGreaterThan(proseTok / prose.length);
  });
});

describe("estimateCost", () => {
  it("computes input+output cost", () => {
    const est = estimateCost({
      prompt: "a".repeat(400), // ~100 tokens
      expectedOutputTokens: 100,
      pricing: opusPricing,
    });
    expect(est.inputTokens).toBe(100);
    expect(est.outputTokens).toBe(100);
    expect(est.inputCostUsd).toBeCloseTo(0.0015, 4);
    expect(est.outputCostUsd).toBeCloseTo(0.0075, 4);
    expect(est.totalCostUsd).toBeCloseTo(0.009, 4);
  });

  it("cached tokens use cache price", () => {
    const est = estimateCost({
      prompt: "a".repeat(4000), // ~1000 tokens
      cachedInputTokens: 500,
      expectedOutputTokens: 0,
      pricing: opusPricing,
    });
    expect(est.cachedInputTokens).toBe(500);
    // 500 fresh at 0.015/1k = 0.0075
    expect(est.inputCostUsd).toBeCloseTo(0.0075, 4);
    // 500 cached at 0.0015/1k = 0.00075
    expect(est.cacheCostUsd).toBeCloseTo(0.00075, 5);
  });

  it("cached capped at total input tokens", () => {
    const est = estimateCost({
      prompt: "a".repeat(40), // ~10 tokens
      cachedInputTokens: 9999,
      expectedOutputTokens: 0,
      pricing: opusPricing,
    });
    expect(est.cachedInputTokens).toBe(10);
  });

  it("cache cost is 0 when no cache price set", () => {
    const est = estimateCost({
      prompt: "a".repeat(400),
      cachedInputTokens: 100,
      expectedOutputTokens: 0,
      pricing: haikuPricing, // no cacheReadPer1k
    });
    expect(est.cacheCostUsd).toBe(0);
  });
});

describe("compareModelCosts", () => {
  const models: ModelOption[] = [
    { id: "opus", pricing: opusPricing },
    { id: "haiku", pricing: haikuPricing },
  ];

  it("ranks models by total cost ascending", () => {
    const comps = compareModelCosts("a".repeat(4000), 500, models);
    expect(comps[0]?.model.id).toBe("haiku"); // cheapest
    expect(comps[1]?.model.id).toBe("opus");
  });

  it("applies cachedInputTokens to all models", () => {
    const comps = compareModelCosts("a".repeat(4000), 500, models, 500);
    for (const c of comps) {
      expect(c.estimate.cachedInputTokens).toBe(500);
    }
  });
});

describe("checkBudget", () => {
  const estimate = {
    inputTokens: 100,
    outputTokens: 100,
    cachedInputTokens: 0,
    inputCostUsd: 0.05,
    outputCostUsd: 0.03,
    cacheCostUsd: 0,
    totalCostUsd: 0.08,
  };

  it("within budget when estimate + margin fits", () => {
    const check = checkBudget(estimate, 1.0);
    expect(check.withinBudget).toBe(true);
  });

  it("over budget when estimate > ceiling", () => {
    const check = checkBudget(estimate, 0.08);
    // default 10% margin → ceiling is 0.072; estimate 0.08 > ceiling
    expect(check.withinBudget).toBe(false);
  });

  it("custom safetyMargin", () => {
    const check = checkBudget(estimate, 0.08, { safetyMargin: 0.0 });
    expect(check.withinBudget).toBe(true); // 0.08 ≤ 0.08
  });

  it("reason is descriptive", () => {
    const check = checkBudget(estimate, 1.0);
    expect(check.reason).toContain("0.0800");
  });
});
