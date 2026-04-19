import { describe, it, expect } from "vitest";
import {
  decideModel,
  buildTierMap,
  projectUsage,
  type ModelTierInfo,
} from "../../src/providers/budget-downgrader.js";

const opus: ModelTierInfo = { id: "opus", tier: "frontier", avgCostPer1kTokens: 0.015 };
const sonnet: ModelTierInfo = { id: "sonnet", tier: "fast", avgCostPer1kTokens: 0.003 };
const haiku: ModelTierInfo = { id: "haiku", tier: "small", avgCostPer1kTokens: 0.0008 };
const free: ModelTierInfo = { id: "llama-free", tier: "free", avgCostPer1kTokens: 0 };

const alternatives: ModelTierInfo[] = [opus, sonnet, haiku, free];

describe("decideModel", () => {
  it("no downgrade below 50% budget", () => {
    const d = decideModel({ preferred: opus, spent: 2, budget: 10, alternatives });
    expect(d.downgradeSteps).toBe(0);
    expect(d.model.id).toBe("opus");
  });

  it("1 tier downgrade at 50%", () => {
    const d = decideModel({ preferred: opus, spent: 5, budget: 10, alternatives });
    expect(d.downgradeSteps).toBe(1);
    expect(d.model.id).toBe("sonnet");
  });

  it("2 tier downgrade at 75%", () => {
    const d = decideModel({ preferred: opus, spent: 7.5, budget: 10, alternatives });
    expect(d.downgradeSteps).toBe(2);
    expect(d.model.id).toBe("haiku");
  });

  it("lock to free at 90%+", () => {
    const d = decideModel({ preferred: opus, spent: 9, budget: 10, alternatives });
    expect(d.model.id).toBe("llama-free");
  });

  it("budget=0 disables downgrade", () => {
    const d = decideModel({ preferred: opus, spent: 1000, budget: 0, alternatives });
    expect(d.model.id).toBe("opus");
    expect(d.reason).toContain("no budget");
  });

  it("no downgrade when target tier has no alternative", () => {
    const d = decideModel({
      preferred: opus,
      spent: 5,
      budget: 10,
      alternatives: [opus], // only frontier available
    });
    expect(d.model.id).toBe("opus");
    expect(d.downgradeSteps).toBe(0);
  });

  it("spent > budget still maps to free (not error)", () => {
    const d = decideModel({ preferred: opus, spent: 100, budget: 10, alternatives });
    expect(d.model.id).toBe("llama-free");
  });

  it("starting from sonnet downgrades to haiku then free", () => {
    const d50 = decideModel({ preferred: sonnet, spent: 5, budget: 10, alternatives });
    expect(d50.model.id).toBe("haiku");
    const d75 = decideModel({ preferred: sonnet, spent: 7.5, budget: 10, alternatives });
    expect(d75.model.id).toBe("llama-free");
  });
});

describe("buildTierMap", () => {
  it("maps tier → model", () => {
    const map = buildTierMap(alternatives);
    expect(map.get("frontier")?.id).toBe("opus");
    expect(map.get("fast")?.id).toBe("sonnet");
  });

  it("picks cheapest per tier when multiple", () => {
    const cheap: ModelTierInfo = { id: "cheap-sonnet", tier: "fast", avgCostPer1kTokens: 0.001 };
    const expensive: ModelTierInfo = { id: "expensive-sonnet", tier: "fast", avgCostPer1kTokens: 0.005 };
    const map = buildTierMap([cheap, expensive]);
    expect(map.get("fast")?.id).toBe("cheap-sonnet");
  });
});

describe("projectUsage", () => {
  it("projects a spend trajectory", () => {
    const spendSteps = [0, 2, 5, 7.5, 9, 10];
    const projected = projectUsage(opus, alternatives, 10, spendSteps);
    expect(projected).toHaveLength(6);
    expect(projected[0]?.model.id).toBe("opus"); // 0% spend
    expect(projected[5]?.model.id).toBe("llama-free"); // 100% spend
  });

  it("reason mentions spend fraction", () => {
    const projected = projectUsage(opus, alternatives, 10, [5]);
    expect(projected[0]?.reason).toContain("50.0%");
  });
});
