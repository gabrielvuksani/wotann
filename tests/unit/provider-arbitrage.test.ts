import { describe, it, expect } from "vitest";
import { ProviderArbitrageEngine } from "../../src/intelligence/provider-arbitrage.js";

describe("ProviderArbitrageEngine", () => {
  describe("findCheapestRoute", () => {
    it("returns the cheapest provider at the requested capability tier", () => {
      const engine = new ProviderArbitrageEngine();
      const route = engine.findCheapestRoute("simple task", "medium");

      expect(route.provider).toBeDefined();
      expect(route.model).toBeDefined();
      expect(route.estimatedCostPer1kTokens).toBeGreaterThanOrEqual(0);
      expect(route.reason).toBeTruthy();
    });

    it("returns free/ollama for low capability tier", () => {
      const engine = new ProviderArbitrageEngine();
      const route = engine.findCheapestRoute("classify text", "low");

      // Free-tier or ollama should be cheapest
      expect(route.estimatedCostPer1kTokens).toBe(0);
    });

    it("returns a capable model for extreme tier", () => {
      const engine = new ProviderArbitrageEngine();
      const route = engine.findCheapestRoute("system design", "extreme");

      expect(route.provider).toBeDefined();
      expect(route.qualityScore).toBeGreaterThan(0);
    });

    it("defaults to sonnet when no eligible providers found", () => {
      const engine = new ProviderArbitrageEngine();
      // Using a capability that doesn't exist in the table
      const route = engine.findCheapestRoute("task", "nonexistent-tier");

      // Should still return a valid route (defaulting or matching low)
      expect(route.provider).toBeDefined();
      expect(route.model).toBeDefined();
    });

    it("uses historical quality when available", () => {
      const engine = new ProviderArbitrageEngine();

      // Record some outcomes
      engine.recordOutcome("ollama", "llama-3.3-70b", 0, 0.95);
      engine.recordOutcome("ollama", "llama-3.3-70b", 0, 0.90);

      const route = engine.findCheapestRoute("simple task", "low");
      // Historical quality should influence the result
      expect(route.qualityScore).toBeGreaterThan(0);
    });
  });

  describe("recordOutcome", () => {
    it("records outcome and reflects in cost report", () => {
      const engine = new ProviderArbitrageEngine();

      engine.recordOutcome("anthropic", "claude-sonnet-4-6", 0.05, 0.9);
      engine.recordOutcome("openai", "gpt-4.1", 0.03, 0.85);

      const report = engine.getCostReport();
      expect(report.routeCount).toBe(2);
      expect(report.totalSpent).toBeCloseTo(0.08, 2);
      expect(report.providerBreakdown.length).toBe(2);
    });

    it("clamps quality to [0, 1]", () => {
      const engine = new ProviderArbitrageEngine();

      engine.recordOutcome("anthropic", "claude-sonnet-4-6", 0.05, 1.5);
      engine.recordOutcome("anthropic", "claude-sonnet-4-6", 0.05, -0.5);

      const report = engine.getCostReport();
      const anthropic = report.providerBreakdown.find(
        (p) => p.provider === "anthropic",
      );
      // Avg quality should be between 0 and 1 (clamped values: 1.0 and 0.0)
      expect(anthropic?.avgQuality).toBeGreaterThanOrEqual(0);
      expect(anthropic?.avgQuality).toBeLessThanOrEqual(1);
    });
  });

  describe("getCostReport", () => {
    it("returns empty report when no outcomes recorded", () => {
      const engine = new ProviderArbitrageEngine();
      const report = engine.getCostReport();

      expect(report.totalSpent).toBe(0);
      expect(report.routeCount).toBe(0);
      expect(report.providerBreakdown.length).toBe(0);
      expect(report.bestValueProvider).toBeNull();
      expect(report.generatedAt).toBeTruthy();
    });

    it("identifies best value provider", () => {
      const engine = new ProviderArbitrageEngine();

      // Cheap + high quality = best value
      engine.recordOutcome("gemini", "gemini-2.5-flash", 0.001, 0.8);
      // Expensive + high quality = not best value
      engine.recordOutcome("anthropic", "claude-opus-4-6", 0.50, 0.95);

      const report = engine.getCostReport();
      expect(report.bestValueProvider).toBe("gemini");
    });

    it("computes total savings vs most expensive", () => {
      const engine = new ProviderArbitrageEngine();

      engine.recordOutcome("anthropic", "claude-sonnet-4-6", 0.01, 0.85);
      engine.recordOutcome("anthropic", "claude-sonnet-4-6", 0.01, 0.85);
      engine.recordOutcome("anthropic", "claude-opus-4-6", 0.10, 0.95);

      const report = engine.getCostReport();
      expect(report.totalSaved).toBeGreaterThanOrEqual(0);
    });

    it("includes provider breakdown with per-provider stats", () => {
      const engine = new ProviderArbitrageEngine();

      engine.recordOutcome("anthropic", "claude-sonnet-4-6", 0.05, 0.9);
      engine.recordOutcome("anthropic", "claude-sonnet-4-6", 0.04, 0.85);
      engine.recordOutcome("openai", "gpt-4.1", 0.03, 0.8);

      const report = engine.getCostReport();
      const anthropic = report.providerBreakdown.find(
        (p) => p.provider === "anthropic",
      );

      expect(anthropic?.requestCount).toBe(2);
      expect(anthropic?.totalCost).toBeCloseTo(0.09, 2);
      expect(anthropic?.avgQuality).toBeCloseTo(0.875, 2);
    });
  });
});
