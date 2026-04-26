import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverProviders } from "../../src/providers/discovery.js";
import { createProviderInfrastructure } from "../../src/providers/registry.js";
import { getModelContextConfig, getMaxAvailableContext, isOpus1MAvailable } from "../../src/context/limits.js";

const NO_CLI = { checkClaudeCli: () => false } as const;

describe("Provider Auth Integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("Full provider stack with context limits", () => {
    it("Anthropic API key creates working infrastructure", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const providers = await discoverProviders(NO_CLI);

      expect(providers.length).toBeGreaterThan(0);

      const infra = createProviderInfrastructure(providers);
      expect(infra.adapters.has("anthropic")).toBe(true);
      expect(infra.bridge.getAvailableProviders()).toContain("anthropic");

      // Context limits — 1M is GA since March 13, 2026
      const opusConfig = getModelContextConfig("claude-opus-4-7", "anthropic");
      expect(opusConfig.maxContextTokens).toBe(1_000_000);
      expect(opusConfig.documentedMaxContextTokens).toBe(1_000_000);
    });

    it("Multiple providers create fallback chain", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
      vi.stubEnv("GEMINI_API_KEY", "gemini-test");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");

      const providers = await discoverProviders(NO_CLI);
      expect(providers.length).toBeGreaterThanOrEqual(3);

      const infra = createProviderInfrastructure(providers);
      const available = infra.bridge.getAvailableProviders();
      expect(available).toContain("anthropic");
      expect(available).toContain("openai");
      expect(available).toContain("gemini");
    });

    it("Free tier providers create valid infrastructure", async () => {
      vi.stubEnv("GEMINI_API_KEY", "gemini-test");
      vi.stubEnv("GROQ_API_KEY", "groq-test");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");

      const providers = await discoverProviders(NO_CLI);
      const freeProviders = providers.filter((p) => p.billing === "free");
      expect(freeProviders.length).toBeGreaterThan(0);

      const infra = createProviderInfrastructure(providers);
      expect(infra.adapters.size).toBeGreaterThan(0);
    });
  });

  describe("Context maximization", () => {
    it("max context reflects available providers", () => {
      const anthropicOnly = getMaxAvailableContext(new Set(["anthropic"]));
      expect(anthropicOnly).toBe(1_000_000); // 1M GA

      const codexOnly = getMaxAvailableContext(new Set(["codex"]));
      expect(codexOnly).toBe(400_000);

      const combined = getMaxAvailableContext(new Set(["anthropic", "codex", "gemini"]));
      expect(combined).toBe(1_000_000);
    });

    it("Opus 1M available check", () => {
      const withAnthropic = isOpus1MAvailable(new Set(["anthropic"]));
      expect(withAnthropic.available).toBe(true); // 1M is GA — always available
      expect(withAnthropic.requiresExplicitEnablement).toBe(false);

      const withoutAnthropic = isOpus1MAvailable(new Set(["openai", "gemini"]));
      expect(withoutAnthropic.available).toBe(false); // Not Anthropic
    });
  });
});
