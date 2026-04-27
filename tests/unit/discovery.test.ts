import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverProviders, formatFullStatus, discoverOllamaModels } from "../../src/providers/discovery.js";

// Suppress Claude CLI detection so tests don't depend on local CLI install.
const NO_CLI = { checkClaudeCli: () => false } as const;

describe("Provider Discovery", () => {
  beforeEach(() => {
    // Clear all provider env vars
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("OLLAMA_URL", "");
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("AZURE_OPENAI_API_KEY", "");
    vi.stubEnv("AZURE_OPENAI_ENDPOINT", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("CEREBRAS_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("HF_TOKEN", "");
    vi.stubEnv("HUGGINGFACE_API_KEY", "");
    vi.stubEnv("HUGGING_FACE_HUB_TOKEN", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("CODEX_HOME", "");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent/path");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("discoverProviders", () => {
    it("detects Anthropic OAuth token", async () => {
      vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-test-token");
      const providers = await discoverProviders(NO_CLI);

      const anthropic = providers.find(
        (p) => p.provider === "anthropic" && p.method === "oauth-token",
      );
      expect(anthropic).toBeDefined();
      expect(anthropic?.billing).toBe("subscription");
      expect(anthropic?.models).toContain("claude-opus-4-7");
    });

    it("detects Anthropic API key", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      const providers = await discoverProviders(NO_CLI);

      const anthropic = providers.find(
        (p) => p.provider === "anthropic" && p.method === "api-key",
      );
      expect(anthropic).toBeDefined();
      expect(anthropic?.billing).toBe("api-key");
    });

    it("detects both Anthropic auth methods", async () => {
      vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-token");
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      const providers = await discoverProviders(NO_CLI);

      const authMethods = providers
        .filter((p) => p.provider === "anthropic")
        .map((p) => p.method);
      expect(authMethods).toContain("oauth-token");
      expect(authMethods).toContain("api-key");
    });

    it("detects OpenAI", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
      const providers = await discoverProviders(NO_CLI);

      const openai = providers.find((p) => p.provider === "openai");
      expect(openai).toBeDefined();
      expect(openai?.transport).toBe("chat_completions");
    });

    it("detects GitHub Copilot via GH_TOKEN with expanded model list", async () => {
      vi.stubEnv("GH_TOKEN", "ghp_test123");
      const providers = await discoverProviders(NO_CLI);

      const copilot = providers.find((p) => p.provider === "copilot");
      expect(copilot).toBeDefined();
      expect(copilot?.billing).toBe("subscription");
      // Verify expanded model list includes models from multiple vendors.
      // Wave DH-3: Copilot catalog uses dotted minor version naming
      // ("claude-sonnet-4.7", not the Anthropic-direct "claude-sonnet-4-7"),
      // matching the GA SKUs Copilot exposes (V14.3 dropped bare
      // "claude-sonnet-4" — retired June 15, 2026). Per-provider literal IDs
      // are correct here because this test asserts the Copilot-specific
      // catalog, not a tier-driven generic selection.
      expect(copilot?.models).toContain("gpt-4.1");
      expect(copilot?.models).toContain("claude-sonnet-4.7");
      expect(copilot?.models).toContain("gemini-2.5-pro");
    });

    it("detects GitHub Copilot via COPILOT_GITHUB_TOKEN", async () => {
      vi.stubEnv("COPILOT_GITHUB_TOKEN", "ghp_copilot_test");
      const providers = await discoverProviders(NO_CLI);

      const copilot = providers.find((p) => p.provider === "copilot");
      expect(copilot).toBeDefined();
    });

    it("detects Azure OpenAI", async () => {
      vi.stubEnv("AZURE_OPENAI_API_KEY", "azure-key");
      vi.stubEnv("AZURE_OPENAI_ENDPOINT", "https://my.openai.azure.com");
      const providers = await discoverProviders(NO_CLI);

      const azure = providers.find((p) => p.provider === "azure");
      expect(azure).toBeDefined();
    });

    it("detects AWS Bedrock", async () => {
      vi.stubEnv("AWS_REGION", "us-east-1");
      vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIA-test");
      const providers = await discoverProviders(NO_CLI);

      const bedrock = providers.find((p) => p.provider === "bedrock");
      expect(bedrock).toBeDefined();
      expect(bedrock?.method).toBe("aws-iam");
    });

    it("detects Google Vertex AI", async () => {
      vi.stubEnv("GOOGLE_CLOUD_PROJECT", "my-project");
      vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/path/to/creds.json");
      const providers = await discoverProviders(NO_CLI);

      const vertex = providers.find((p) => p.provider === "vertex");
      expect(vertex).toBeDefined();
    });

    it("detects Google Gemini via GEMINI_API_KEY", async () => {
      vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
      const providers = await discoverProviders(NO_CLI);

      const gemini = providers.find((p) => p.provider === "gemini");
      expect(gemini).toBeDefined();
      expect(gemini?.billing).toBe("free");
      expect(gemini?.models).toContain("gemini-2.5-flash");
    });

    it("detects HuggingFace Inference via HF_TOKEN", async () => {
      vi.stubEnv("HF_TOKEN", "hf_test_token");
      const providers = await discoverProviders(NO_CLI);

      const huggingface = providers.find((p) => p.provider === "huggingface");
      expect(huggingface).toBeDefined();
      expect(huggingface?.models).toContain("meta-llama/Llama-3.3-70B-Instruct");
    });

    it("returns empty array when no providers configured", async () => {
      const providers = await discoverProviders(NO_CLI);
      expect(providers.length).toBe(0);
    });
  });

  describe("formatFullStatus", () => {
    it("shows all 20 providers with active/inactive status", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
      const detected = await discoverProviders(NO_CLI);
      const statuses = formatFullStatus(detected);

      // Gap-7 fix: ALL_PROVIDERS now includes groq + openrouter + cerebras
      // (was 18 → 20 → 21). Mirrors the ProviderName union from
      // src/core/types.ts. 21 providers: anthropic, openai, codex, copilot,
      // ollama, gemini, huggingface, free, azure, bedrock, vertex, mistral,
      // deepseek, perplexity, xai, together, fireworks, sambanova, groq,
      // openrouter, cerebras.
      expect(statuses.length).toBe(21);

      // Anthropic should be active
      const anthropic = statuses.find((s) => s.provider === "anthropic");
      expect(anthropic?.available).toBe(true);

      // Newly added providers should be inactive when no key is set
      const openrouter = statuses.find((s) => s.provider === "openrouter");
      expect(openrouter?.available).toBe(false);
      const groq = statuses.find((s) => s.provider === "groq");
      expect(groq?.available).toBe(false);

      // Others should be inactive
      const ollama = statuses.find((s) => s.provider === "ollama");
      expect(ollama?.available).toBe(false);
    });
  });

  describe("discoverOllamaModels", () => {
    it("returns empty array when Ollama is not running", async () => {
      const models = await discoverOllamaModels("http://localhost:99999");
      expect(models).toEqual([]);
    });
  });
});
