import { describe, it, expect } from "vitest";
import {
  getThinkingMethod,
  buildThinkingParams,
  buildChainOfThoughtPrompt,
  extractThinking,
} from "../../src/providers/extended-thinking.js";

describe("Extended Thinking", () => {
  describe("getThinkingMethod", () => {
    it("returns native_thinking_blocks for Anthropic", () => {
      expect(getThinkingMethod("anthropic", "claude-opus-4-7")).toBe("native_thinking_blocks");
    });

    it("returns native_reasoning for OpenAI o-series", () => {
      expect(getThinkingMethod("openai", "o1-preview")).toBe("native_reasoning");
      expect(getThinkingMethod("openai", "gpt-5.4")).toBe("native_reasoning");
    });

    it("returns native_thinking_config for Gemini 2.5+", () => {
      expect(getThinkingMethod("gemini", "gemini-2.5-pro")).toBe("native_thinking_config");
    });

    it("returns stream_think_tags for Ollama", () => {
      expect(getThinkingMethod("ollama", "qwen3-coder")).toBe("stream_think_tags");
    });

    it("returns chain_of_thought for unsupported providers", () => {
      expect(getThinkingMethod("copilot", "copilot-default")).toBe("chain_of_thought");
    });
  });

  describe("buildThinkingParams", () => {
    it("builds Anthropic thinking params", () => {
      const params = buildThinkingParams("anthropic", "claude-opus-4-7", { budgetTokens: 32_000 });
      expect(params).toHaveProperty("thinking");
      const thinking = params["thinking"] as Record<string, unknown>;
      expect(thinking["type"]).toBe("enabled");
      expect(thinking["budget_tokens"]).toBe(32_000);
    });

    it("builds OpenAI reasoning params", () => {
      const params = buildThinkingParams("openai", "gpt-5.4", { effort: "high" });
      expect(params).toHaveProperty("reasoning_effort");
      expect(params["reasoning_effort"]).toBe("high");
    });

    it("builds Gemini thinking config", () => {
      const params = buildThinkingParams("gemini", "gemini-2.5-pro", { budgetTokens: 16_000 });
      expect(params).toHaveProperty("thinking_config");
      const config = params["thinking_config"] as Record<string, unknown>;
      expect(config["thinking_budget"]).toBe(16_000);
    });

    it("returns empty object for chain-of-thought", () => {
      const params = buildThinkingParams("copilot", "copilot-default");
      expect(Object.keys(params).length).toBe(0);
    });
  });

  describe("buildChainOfThoughtPrompt", () => {
    it("wraps prompt with thinking tags", () => {
      const wrapped = buildChainOfThoughtPrompt("What is 2+2?");
      expect(wrapped).toContain("<thinking>");
      expect(wrapped).toContain("</thinking>");
      expect(wrapped).toContain("What is 2+2?");
    });
  });

  describe("extractThinking", () => {
    it("extracts from Ollama think tags", () => {
      const response = "<think>Let me analyze this step by step.</think>The answer is 42.";
      const result = extractThinking(response, "stream_think_tags");
      expect(result.thinking).toBe("Let me analyze this step by step.");
      expect(result.response).toBe("The answer is 42.");
    });

    it("extracts from chain-of-thought tags", () => {
      const response = "<thinking>Step 1: analyze. Step 2: compute.</thinking>Result: 7.";
      const result = extractThinking(response, "chain_of_thought");
      expect(result.thinking).toBe("Step 1: analyze. Step 2: compute.");
      expect(result.response).toBe("Result: 7.");
    });

    it("returns empty thinking for plain text", () => {
      const result = extractThinking("Just a plain response", "stream_think_tags");
      expect(result.thinking).toBe("");
      expect(result.response).toBe("Just a plain response");
    });

    it("extracts from Claude structured response", () => {
      const structured = {
        content: [
          { type: "thinking", thinking: "Deep analysis here" },
          { type: "text", text: "The answer is X" },
        ],
      };
      const result = extractThinking(structured, "native_thinking_blocks");
      expect(result.thinking).toBe("Deep analysis here");
      expect(result.response).toBe("The answer is X");
    });
  });
});
