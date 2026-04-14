import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getModelContextConfig,
  getMaxAvailableContext,
  getMaxDocumentedContext,
  getOllamaKVCacheConfig,
  isExtendedContextEnabled,
  isOpus1MAvailable,
} from "../../src/context/limits.js";

describe("Context Limits Registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getModelContextConfig", () => {
    it("returns exact match for known model+provider", () => {
      const config = getModelContextConfig("claude-opus-4-6", "anthropic");
      // 1M context GA since March 13, 2026 — no activation needed
      expect(config.maxContextTokens).toBe(1_000_000);
      expect(config.documentedMaxContextTokens).toBe(1_000_000);
      expect(config.supportsExtendedContext).toBe(false);
      expect(config.supportsPromptCaching).toBe(true);
      expect(config.activationMode).toBe("default");
    });

    it("returns config for Codex models with current 400K-class public context", () => {
      const config = getModelContextConfig("codexplan", "codex");
      expect(config.maxContextTokens).toBe(400_000);
      expect(config.inputCostPer1K).toBe(0);
    });

    it("returns config for Gemini with 1M context", () => {
      const config = getModelContextConfig("gemini-2.5-flash", "gemini");
      expect(config.maxContextTokens).toBe(1_000_000);
    });

    it("promotes Sonnet to 1M when extended context is explicitly enabled", () => {
      vi.stubEnv("ANTHROPIC_ENABLE_1M_CONTEXT", "1");
      const config = getModelContextConfig("claude-sonnet-4-6", "anthropic");
      expect(config.maxContextTokens).toBe(1_000_000);
    });

    it("returns sensible defaults for unknown models", () => {
      const config = getModelContextConfig("unknown-model", "anthropic");
      expect(config.maxContextTokens).toBeGreaterThan(0);
      expect(config.provider).toBe("anthropic");
    });

    it("falls back to general default for unknown provider", () => {
      const config = getModelContextConfig("unknown-model", "unknown-provider");
      expect(config.maxContextTokens).toBe(128_000);
    });

    it("matches model across providers when no exact match", () => {
      const config = getModelContextConfig("gpt-4.1", "copilot");
      expect(config.maxContextTokens).toBeGreaterThan(0);
    });
  });

  describe("getMaxAvailableContext", () => {
    it("returns 1M for Anthropic (GA since March 2026)", () => {
      const max = getMaxAvailableContext(new Set(["anthropic"]));
      expect(max).toBe(1_000_000);
    });

    it("returns 400K when only Codex is available", () => {
      const max = getMaxAvailableContext(new Set(["codex"]));
      expect(max).toBe(400_000);
    });

    it("returns highest across multiple providers", () => {
      const max = getMaxAvailableContext(new Set(["anthropic", "codex", "ollama"]));
      expect(max).toBe(1_000_000); // Anthropic 1M is now highest
    });

    it("returns 128K default when no providers match", () => {
      const max = getMaxAvailableContext(new Set(["unknown"]));
      expect(max).toBe(128_000);
    });

    it("reports documented maxima separately", () => {
      const max = getMaxDocumentedContext(new Set(["anthropic", "codex"]));
      expect(max).toBe(1_000_000);
    });
  });

  describe("getOllamaKVCacheConfig", () => {
    it("returns q8_0 cache type", () => {
      const config = getOllamaKVCacheConfig(131_072);
      expect(config.OLLAMA_KV_CACHE_TYPE).toBe("q8_0");
      expect(config.numCtx).toBe(131_072);
    });

    it("includes descriptive text", () => {
      const config = getOllamaKVCacheConfig(256_000);
      expect(config.description).toContain("q8_0");
      expect(config.description).toContain("256K");
    });
  });

  describe("isOpus1MAvailable", () => {
    it("returns true by default — 1M is GA since March 2026", () => {
      const result = isOpus1MAvailable(new Set(["anthropic"]));
      expect(result.available).toBe(true);
      expect(result.maxTokens).toBe(1_000_000);
      expect(result.requiresExplicitEnablement).toBe(false);
    });

    it("returns true when Anthropic long context is explicitly enabled", () => {
      vi.stubEnv("ANTHROPIC_ENABLE_1M_CONTEXT", "1");
      const result = isOpus1MAvailable(new Set(["anthropic"]));
      expect(result.available).toBe(true);
      expect(result.maxTokens).toBe(1_000_000);
    });

    it("returns false when only Ollama is available", () => {
      const result = isOpus1MAvailable(new Set(["ollama"]));
      expect(result.available).toBe(false);
    });

    it("returns false when no providers available", () => {
      const result = isOpus1MAvailable(new Set());
      expect(result.available).toBe(false);
    });
  });

  describe("isExtendedContextEnabled", () => {
    it("detects explicit model aliases", () => {
      expect(isExtendedContextEnabled("anthropic", "claude-opus-4-6 [1m]")).toBe(true);
    });
  });
});
