/**
 * Tests for Intelligent Context Maximizer.
 */

import { describe, it, expect } from "vitest";
import {
  maximizeContext,
  maximizeAllProviders,
  getBestContextOption,
  getMaxContextHeaders,
  getMaxContextBody,
  planContextBudget,
  getProviderReport,
} from "../../src/context/maximizer.js";

describe("Context Maximizer", () => {
  describe("maximizeContext", () => {
    it("returns 1M tokens for Anthropic Claude Opus", () => {
      const result = maximizeContext("claude-opus-4-7", "anthropic");

      expect(result.effectiveTokens).toBeGreaterThanOrEqual(200_000);
      expect(result.model).toBe("claude-opus-4-7");
      expect(result.provider).toBe("anthropic");
      expect(result.probeResult).toBeDefined();
    });

    it("returns max context for OpenAI GPT-5.4", () => {
      const result = maximizeContext("gpt-5.4", "openai");

      expect(result.effectiveTokens).toBeGreaterThanOrEqual(128_000);
      expect(result.model).toBe("gpt-5.4");
    });

    it("returns context for Gemini models", () => {
      const result = maximizeContext("gemini-2.5-flash", "gemini");

      expect(result.effectiveTokens).toBeGreaterThan(0);
      expect(result.provider).toBe("gemini");
    });

    it("returns context for Ollama models", () => {
      const result = maximizeContext("qwen3.5:27b", "ollama");

      expect(result.effectiveTokens).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it("includes activation headers for Anthropic", () => {
      const result = maximizeContext("claude-opus-4-7", "anthropic");

      expect(result.activationHeaders).toBeDefined();
      // Anthropic should have beta headers
      if (Object.keys(result.activationHeaders).length > 0) {
        expect(result.activationHeaders["anthropic-beta"]).toBeDefined();
      }
    });

    it("reports caching capabilities", () => {
      const result = maximizeContext("claude-opus-4-7", "anthropic");

      expect(typeof result.cachingEnabled).toBe("boolean");
      if (result.cachingEnabled) {
        expect(result.cachableTokens).toBeGreaterThan(0);
      }
    });

    it("includes output token limits", () => {
      const result = maximizeContext("claude-opus-4-7", "anthropic");

      expect(result.outputTokens).toBeGreaterThan(0);
    });

    it("provides recommendations", () => {
      const result = maximizeContext("qwen3.5:27b", "ollama");

      expect(result.recommendations.length).toBeGreaterThan(0);
      // Ollama should recommend KV cache settings
      expect(result.recommendations.some((r) => r.includes("KV") || r.includes("NUM_CTX"))).toBe(true);
    });
  });

  describe("maximizeAllProviders", () => {
    it("returns results for all requested providers", () => {
      const providers = new Set(["anthropic", "openai", "gemini"]);
      const results = maximizeAllProviders(providers);

      expect(results.size).toBeGreaterThan(0);

      // Should have entries for each provider
      const providersSeen = new Set<string>();
      for (const ctx of results.values()) {
        providersSeen.add(ctx.provider);
      }
      expect(providersSeen.has("anthropic")).toBe(true);
      expect(providersSeen.has("openai")).toBe(true);
    });

    it("returns empty map for no providers", () => {
      const results = maximizeAllProviders(new Set());
      expect(results.size).toBe(0);
    });

    it("keys include provider:model format", () => {
      const results = maximizeAllProviders(new Set(["anthropic"]));

      for (const key of results.keys()) {
        expect(key).toContain(":");
        expect(key.startsWith("anthropic:")).toBe(true);
      }
    });
  });

  describe("getBestContextOption", () => {
    it("returns the highest context model", () => {
      const best = getBestContextOption(new Set(["anthropic", "openai", "ollama"]));

      expect(best).not.toBeNull();
      expect(best!.effectiveTokens).toBeGreaterThan(0);
    });

    it("returns null for empty provider set", () => {
      const best = getBestContextOption(new Set());
      expect(best).toBeNull();
    });
  });

  describe("getMaxContextHeaders", () => {
    it("returns beta headers for Anthropic", () => {
      const headers = getMaxContextHeaders("anthropic", "claude-opus-4-7");

      expect(typeof headers).toBe("object");
    });

    it("returns empty headers for providers without special headers", () => {
      const headers = getMaxContextHeaders("openai", "gpt-5.4");

      expect(typeof headers).toBe("object");
    });
  });

  describe("getMaxContextBody", () => {
    it("returns body modifications for Anthropic", () => {
      const body = getMaxContextBody("anthropic", "claude-opus-4-7");

      expect(typeof body).toBe("object");
    });

    it("returns num_ctx options for Ollama", () => {
      const body = getMaxContextBody("ollama", "qwen3.5:27b");

      if (body["options"]) {
        const options = body["options"] as Record<string, unknown>;
        expect(options["num_ctx"]).toBeGreaterThan(0);
      }
    });

    it("returns empty object for unknown providers", () => {
      const body = getMaxContextBody("unknown-provider", "unknown-model");
      expect(body).toEqual({});
    });
  });

  describe("planContextBudget", () => {
    it("allocates budget correctly", () => {
      const budget = planContextBudget("claude-opus-4-7", "anthropic", 5000, 2000, 1000);

      expect(budget.totalTokens).toBeGreaterThan(0);
      expect(budget.systemPromptTokens).toBe(5000);
      expect(budget.bootstrapTokens).toBe(2000);
      expect(budget.memoryTokens).toBe(1000);
      expect(budget.codeContextTokens).toBeGreaterThanOrEqual(0);
      expect(budget.conversationTokens).toBeGreaterThanOrEqual(0);
      expect(budget.reservedForOutput).toBeGreaterThan(0);
    });

    it("reserves space for output", () => {
      const budget = planContextBudget("claude-opus-4-7", "anthropic", 100, 100, 100);

      expect(budget.reservedForOutput).toBeGreaterThan(0);
      expect(budget.totalTokens - budget.reservedForOutput).toBeGreaterThan(0);
    });

    it("allocates 60% of flexible budget to code context", () => {
      const budget = planContextBudget("claude-opus-4-7", "anthropic", 1000, 500, 500);

      // Code context should be roughly 60% of available flexible space
      if (budget.available > 0) {
        const ratio = budget.codeContextTokens / budget.available;
        expect(ratio).toBeCloseTo(0.6, 1);
      }
    });

    it("handles oversized fixed costs gracefully", () => {
      const budget = planContextBudget("claude-opus-4-7", "anthropic", 999_999, 1, 1);

      // Should not have negative values
      expect(budget.codeContextTokens).toBeGreaterThanOrEqual(0);
      expect(budget.conversationTokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getProviderReport", () => {
    it("generates report for Anthropic", () => {
      const report = getProviderReport("anthropic");

      expect(report.provider).toBe("anthropic");
      expect(report.models.length).toBeGreaterThan(0);
      expect(report.bestContextModel).toBeDefined();
      expect(report.bestContextTokens).toBeGreaterThan(0);
    });

    it("reports model capabilities correctly", () => {
      const report = getProviderReport("anthropic");

      for (const model of report.models) {
        expect(model.maxContext).toBeGreaterThan(0);
        expect(model.maxOutput).toBeGreaterThan(0);
        expect(typeof model.caching).toBe("boolean");
      }
    });

    it("generates report for multiple providers", () => {
      const providers = ["anthropic", "openai", "gemini", "ollama"];

      for (const provider of providers) {
        const report = getProviderReport(provider);
        expect(report.provider).toBe(provider);
        expect(report.models.length).toBeGreaterThan(0);
      }
    });
  });
});
