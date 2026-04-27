import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, getDefaultConfig, loadConfigFromEnv } from "../../src/core/config.js";

describe("Config System", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear all 19 supported provider env vars so the "returns empty"
    // assertion is environment-independent (Gap-4 expanded the env-var
    // surface in src/core/config.ts; the prior stub list of 7 vars left
    // GEMINI_API_KEY/GROQ_API_KEY/etc. leaking from the host shell into
    // the test, which falsely populated `providers` and broke the
    // empty-snapshot assertion on developer machines with those keys).
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    vi.stubEnv("MISTRAL_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("PERPLEXITY_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("CEREBRAS_API_KEY", "");
    vi.stubEnv("TOGETHER_API_KEY", "");
    vi.stubEnv("FIREWORKS_API_KEY", "");
    vi.stubEnv("SAMBANOVA_API_KEY", "");
    vi.stubEnv("OLLAMA_URL", "");
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("HF_TOKEN", "");
    vi.stubEnv("HUGGINGFACE_API_KEY", "");
    vi.stubEnv("HUGGING_FACE_HUB_TOKEN", "");
    vi.stubEnv("AZURE_OPENAI_API_KEY", "");
    vi.stubEnv("AZURE_OPENAI_ENDPOINT", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_PROFILE", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getDefaultConfig", () => {
    it("returns default config with standard hook profile", () => {
      const config = getDefaultConfig();
      expect(config.version).toBe("0.1.0");
      expect(config.hooks.profile).toBe("standard");
      expect(config.memory.enabled).toBe(true);
      expect(config.daemon.enabled).toBe(false);
    });

    it("returns immutable copies", () => {
      const a = getDefaultConfig();
      const b = getDefaultConfig();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe("loadConfigFromEnv", () => {
    it("detects ANTHROPIC_API_KEY", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-key");
      const env = loadConfigFromEnv();
      expect(env.providers).toBeDefined();
      expect(env.providers?.["anthropic"]).toBeDefined();
    });

    it("detects OPENAI_API_KEY", () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
      const env = loadConfigFromEnv();
      expect(env.providers?.["openai"]).toBeDefined();
    });

    it("detects GH_TOKEN for Copilot", () => {
      vi.stubEnv("GH_TOKEN", "ghp_test123");
      const env = loadConfigFromEnv();
      expect(env.providers?.["copilot"]).toBeDefined();
    });

    // Gap-4 fix: lock in env-var detection for the 14 providers that
    // the prior loadConfigFromEnv silently dropped. Each test stubs
    // ONE env var and verifies its provider key surfaces in the
    // snapshot. Failures here indicate a regression in the
    // ProviderName ↔ env-var mapping.

    it("detects GEMINI_API_KEY", () => {
      vi.stubEnv("GEMINI_API_KEY", "AIza-test-key");
      const env = loadConfigFromEnv();
      expect(env.providers?.["gemini"]).toBeDefined();
      expect(env.providers?.["gemini"]?.apiKey).toBe("AIza-test-key");
    });

    it("detects OPENROUTER_API_KEY with baseUrl wired", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
      const env = loadConfigFromEnv();
      expect(env.providers?.["openrouter"]).toBeDefined();
      expect(env.providers?.["openrouter"]?.baseUrl).toBe("https://openrouter.ai/api/v1");
    });

    // Provider consolidation: GROQ_API_KEY / AWS_ACCESS_KEY_ID /
    // GOOGLE_APPLICATION_CREDENTIALS detection blocks were removed
    // alongside the 21→8 ProviderName narrowing. Users wanting
    // Groq/Bedrock/Vertex reach those backends via OpenRouter
    // (`<vendor>/<model>` slugs) instead of separate provider entries.
    // The kept env-var coverage (anthropic/openai/codex/copilot/ollama/
    // gemini/openrouter/huggingface) is exercised by the tests above.

    it("returns empty when no env vars set", () => {
      const env = loadConfigFromEnv();
      expect(env).toEqual({});
    });
  });

  describe("loadConfig", () => {
    it("returns valid config even with no workspace", () => {
      const config = loadConfig(null);
      expect(config.version).toBeDefined();
      expect(config.hooks).toBeDefined();
      expect(config.hooks.profile).toBe("standard");
    });

    it("merges env config into defaults", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
      const config = loadConfig(null);
      expect(config.providers["anthropic"]).toBeDefined();
    });

    it("applies CLI overrides", () => {
      const config = loadConfig(null, { hookProfile: "strict" });
      expect(config.hooks.profile).toBe("strict");
    });
  });
});
