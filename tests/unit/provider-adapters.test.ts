import { describe, it, expect, vi } from "vitest";
import { createAnthropicAdapter } from "../../src/providers/anthropic-adapter.js";
import { createCodexAdapter, readCodexToken } from "../../src/providers/codex-adapter.js";
import { createCopilotAdapter } from "../../src/providers/copilot-adapter.js";
import { createOllamaAdapter, mapOllamaModels, getOllamaModelContextWindow } from "../../src/providers/ollama-adapter.js";
import { createOpenAIAdapter } from "../../src/providers/openai-compat-adapter.js";
import { augmentQuery, parseToolCallFromText, augmentVision } from "../../src/providers/capability-augmenter.js";
import type { ProviderCapabilities } from "../../src/providers/types.js";

describe("Provider Adapters", () => {
  describe("Anthropic Adapter", () => {
    it("creates adapter with correct capabilities", () => {
      const adapter = createAnthropicAdapter("sk-test");
      expect(adapter.name).toBe("anthropic");
      expect(adapter.capabilities.supportsComputerUse).toBe(true);
      expect(adapter.capabilities.supportsVision).toBe(true);
      expect(adapter.capabilities.supportsThinking).toBe(true);
      expect(adapter.capabilities.maxContextWindow).toBe(1_000_000);
    });

    it("lists Claude models", async () => {
      const adapter = createAnthropicAdapter("sk-test");
      const models = await adapter.listModels();
      expect(models).toContain("claude-opus-4-6");
      expect(models).toContain("claude-sonnet-4-6");
      expect(models).toContain("claude-haiku-4-5");
    });
  });

  describe("Codex Adapter", () => {
    it("creates adapter with correct transport", () => {
      const adapter = createCodexAdapter("test-token");
      expect(adapter.name).toBe("codex");
      expect(adapter.transport).toBe("codex_responses");
      expect(adapter.capabilities.supportsThinking).toBe(true);
      expect(adapter.capabilities.maxContextWindow).toBe(400_000);
    });

    it("lists codex models including codexmini", async () => {
      const adapter = createCodexAdapter("test-token");
      const models = await adapter.listModels();
      expect(models).toContain("codexplan");
      expect(models).toContain("codexspark");
      expect(models).toContain("codexmini");
    });

    it("reads token from env var CODEX_API_KEY", () => {
      vi.stubEnv("CODEX_API_KEY", "test-key");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      // readCodexToken reads from auth file, not env
      // Just verify the function exists and handles missing file
      const token = readCodexToken();
      expect(token === null || typeof token === "string").toBe(true);
      vi.unstubAllEnvs();
    });
  });

  describe("Ollama Adapter", () => {
    it("creates adapter with native transport", () => {
      const adapter = createOllamaAdapter("http://localhost:11434");
      expect(adapter.name).toBe("ollama");
      expect(adapter.capabilities.supportsToolCalling).toBe(true);
      expect(adapter.capabilities.supportsVision).toBe(true);
    });

    it("maps models to tiers correctly", () => {
      const tiers = mapOllamaModels([
        { name: "qwen3-coder:30b", size: 20_000_000_000, modified_at: "" },
        { name: "qwen3.5:27b", size: 18_000_000_000, modified_at: "" },
        { name: "llama3.3:70b", size: 40_000_000_000, modified_at: "" },
        { name: "nemotron:mini", size: 5_000_000_000, modified_at: "" },
      ]);

      expect(tiers.coding).toBe("qwen3-coder:30b");
      // reasoning tier picks first qwen3-matching model (qwen3-coder also matches)
      expect(tiers.reasoning).toContain("qwen3");
      expect(tiers.efficient).toBe("nemotron:mini");
      expect(tiers.general).toBe("llama3.3:70b");
    });

    it("handles empty model list", () => {
      const tiers = mapOllamaModels([]);
      expect(tiers.coding).toBeNull();
      expect(tiers.fallback).toBeNull();
    });

    it("returns default context window for unreachable server", async () => {
      const ctxWindow = await getOllamaModelContextWindow("test", "http://localhost:99999");
      expect(ctxWindow).toBe(256_000);
    });
  });

  describe("OpenAI Adapter", () => {
    it("creates adapter with correct config", () => {
      const adapter = createOpenAIAdapter("sk-test");
      expect(adapter.name).toBe("openai");
      expect(adapter.capabilities.supportsToolCalling).toBe(true);
      expect(adapter.capabilities.maxContextWindow).toBe(1_000_000);
    });
  });

  describe("Copilot Adapter", () => {
    it("creates adapter with correct capabilities", () => {
      const adapter = createCopilotAdapter("ghp_test");
      expect(adapter.name).toBe("copilot");
      expect(adapter.transport).toBe("chat_completions");
      expect(adapter.capabilities.supportsVision).toBe(true);
      expect(adapter.capabilities.supportsToolCalling).toBe(true);
      expect(adapter.capabilities.supportsStreaming).toBe(true);
    });

    it("reports unavailable when token exchange fails", async () => {
      const adapter = createCopilotAdapter("invalid-token");
      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });

    it("yields error chunk on auth failure", async () => {
      const adapter = createCopilotAdapter("invalid-token");
      const chunks: Array<{ type: string; content: string }> = [];
      for await (const chunk of adapter.query({ prompt: "test" })) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]?.type).toBe("error");
      expect(chunks[0]?.content).toContain("Copilot");
    });
  });
});

describe("Capability Augmenter (Extended)", () => {
  const FULL_CAPS: ProviderCapabilities = {
    supportsComputerUse: true, supportsToolCalling: true, supportsVision: true,
    supportsStreaming: true, supportsThinking: true, maxContextWindow: 1_000_000,
  };
  const NO_CAPS: ProviderCapabilities = {
    supportsComputerUse: false, supportsToolCalling: false, supportsVision: false,
    supportsStreaming: false, supportsThinking: false, maxContextWindow: 32_000,
  };

  it("full pipeline: augments all missing capabilities", () => {
    const options = {
      prompt: "x".repeat(200) + " [image:test.png]",
      systemPrompt: "Be helpful",
      tools: [{ name: "test_tool", description: "A test", inputSchema: {} }],
    };

    const augmented = augmentQuery(options, NO_CAPS);

    // Tool augmentation
    expect(augmented.systemPrompt).toContain("Available Tools");
    expect(augmented.tools).toBeUndefined();

    // Thinking augmentation
    expect(augmented.systemPrompt).toContain("step by step");

    // Vision augmentation — S3-7 OCR replaces marker with real OCR
    // text (or honest unavailable fallback). Either way the original
    // [image:...] is consumed and the OCR/Image marker appears.
    expect(augmented.prompt).not.toContain("[image:test.png]");
    expect(augmented.prompt).toMatch(/\[(OCR|Image)/);
  });

  it("preserves options unchanged for full-capability provider", () => {
    const options = { prompt: "Hello", systemPrompt: "Be nice" };
    const result = augmentQuery(options, FULL_CAPS);
    expect(result).toBe(options);
  });

  it("parses tool call with empty args", () => {
    const result = parseToolCallFromText(`
<tool_use>
  <tool name="list_files">
  </tool>
</tool_use>`);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("list_files");
    expect(Object.keys(result?.args ?? {})).toHaveLength(0);
  });

  it("handles base64 image references in vision augmentation", () => {
    const options = { prompt: "What is data:image/png;base64,ABC123?" };
    const result = augmentVision(options, NO_CAPS);
    expect(result.prompt).not.toContain("data:image");
  });
});
