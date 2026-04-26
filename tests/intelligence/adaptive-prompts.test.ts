import { describe, it, expect, beforeEach } from "vitest";
import {
  AdaptivePromptGenerator,
  type ModelTier,
  type PromptProfile,
} from "../../src/intelligence/adaptive-prompts.js";

describe("AdaptivePromptGenerator", () => {
  let generator: AdaptivePromptGenerator;

  beforeEach(() => {
    generator = new AdaptivePromptGenerator();
  });

  // -- classifyModel ---------------------------------------------------------

  describe("classifyModel", () => {
    it("classifies opus models as frontier", () => {
      expect(generator.classifyModel("claude-opus-4")).toBe("frontier");
      expect(generator.classifyModel("claude-opus-4-7")).toBe("frontier");
    });

    it("classifies gpt-5 as frontier", () => {
      expect(generator.classifyModel("gpt-5-turbo")).toBe("frontier");
    });

    it("classifies gemini-ultra as frontier", () => {
      expect(generator.classifyModel("gemini-ultra-2")).toBe("frontier");
    });

    it("classifies gemini-3-pro as frontier", () => {
      expect(generator.classifyModel("gemini-3-pro")).toBe("frontier");
    });

    it("classifies sonnet models as strong", () => {
      expect(generator.classifyModel("claude-sonnet-4")).toBe("strong");
      expect(generator.classifyModel("claude-3.5-sonnet")).toBe("strong");
    });

    it("classifies gpt-4 models as strong", () => {
      expect(generator.classifyModel("gpt-4-turbo")).toBe("strong");
      expect(generator.classifyModel("gpt-4o")).toBe("strong");
    });

    it("classifies claude-3 models as strong", () => {
      expect(generator.classifyModel("claude-3")).toBe("strong");
    });

    it("classifies haiku models as standard", () => {
      expect(generator.classifyModel("claude-haiku-3.5")).toBe("standard");
    });

    it("classifies gpt-3.5 as standard", () => {
      expect(generator.classifyModel("gpt-3.5-turbo")).toBe("standard");
    });

    it("classifies gemini-flash as standard", () => {
      expect(generator.classifyModel("gemini-2.0-flash")).toBe("standard");
    });

    it("classifies mistral-large as standard", () => {
      expect(generator.classifyModel("mistral-large-latest")).toBe("standard");
    });

    it("classifies mini models as lightweight", () => {
      expect(generator.classifyModel("gpt-4o-mini")).toBe("lightweight");
      expect(generator.classifyModel("phi-3-mini")).toBe("lightweight");
    });

    it("classifies gemma-2b as lightweight", () => {
      expect(generator.classifyModel("gemma-2b-it")).toBe("lightweight");
    });

    it("classifies tinyllama as lightweight", () => {
      expect(generator.classifyModel("tinyllama-1.1b")).toBe("lightweight");
    });

    it("classifies ollama models as local", () => {
      expect(generator.classifyModel("ollama/mistral")).toBe("local");
    });

    it("classifies gguf models as local", () => {
      expect(generator.classifyModel("codellama-7b.gguf")).toBe("local");
    });

    it("classifies llama models as local", () => {
      expect(generator.classifyModel("llama-3.1-70b")).toBe("local");
    });

    it("classifies qwen models as local", () => {
      expect(generator.classifyModel("qwen2-7b-instruct")).toBe("local");
    });

    it("classifies codestral as local", () => {
      expect(generator.classifyModel("codestral-22b")).toBe("local");
    });

    it("defaults unknown models to standard", () => {
      expect(generator.classifyModel("some-unknown-model-v2")).toBe("standard");
    });

    it("is case-insensitive", () => {
      expect(generator.classifyModel("CLAUDE-OPUS-4")).toBe("frontier");
      expect(generator.classifyModel("GPT-4-Turbo")).toBe("strong");
    });
  });

  // -- getProfile ------------------------------------------------------------

  describe("getProfile", () => {
    it("returns frontier profile with minimal scaffolding", () => {
      const profile = generator.getProfile("frontier");

      expect(profile.tier).toBe("frontier");
      expect(profile.maxSystemPromptTokens).toBe(16_000);
      expect(profile.useStructuredReasoning).toBe(false);
      expect(profile.useChainOfThought).toBe(false);
      expect(profile.toolCallStyle).toBe("native");
      expect(profile.instructionStyle).toBe("minimal");
      expect(profile.includeExamples).toBe(false);
      expect(profile.verificationLevel).toBe("none");
    });

    it("returns strong profile with light verification", () => {
      const profile = generator.getProfile("strong");

      expect(profile.tier).toBe("strong");
      expect(profile.useChainOfThought).toBe(true);
      expect(profile.toolCallStyle).toBe("native");
      expect(profile.verificationLevel).toBe("self-check");
    });

    it("returns standard profile with structured reasoning", () => {
      const profile = generator.getProfile("standard");

      expect(profile.tier).toBe("standard");
      expect(profile.useStructuredReasoning).toBe(true);
      expect(profile.useChainOfThought).toBe(true);
      expect(profile.toolCallStyle).toBe("xml");
      expect(profile.instructionStyle).toBe("detailed");
      expect(profile.includeExamples).toBe(true);
    });

    it("returns lightweight profile with full scaffolding", () => {
      const profile = generator.getProfile("lightweight");

      expect(profile.tier).toBe("lightweight");
      expect(profile.maxSystemPromptTokens).toBe(4_000);
      expect(profile.useStructuredReasoning).toBe(true);
      expect(profile.toolCallStyle).toBe("json");
      expect(profile.instructionStyle).toBe("verbose");
      expect(profile.includeExamples).toBe(true);
      expect(profile.verificationLevel).toBe("multi-step");
    });

    it("returns local profile with full scaffolding", () => {
      const profile = generator.getProfile("local");

      expect(profile.tier).toBe("local");
      expect(profile.maxSystemPromptTokens).toBe(4_000);
      expect(profile.verificationLevel).toBe("multi-step");
    });

    it("each tier has correct token budget ordering", () => {
      const tiers: readonly ModelTier[] = [
        "frontier", "strong", "standard", "lightweight", "local",
      ];
      const budgets = tiers.map((t) => generator.getProfile(t).maxSystemPromptTokens);

      // frontier >= strong >= standard >= lightweight
      expect(budgets[0]).toBeGreaterThanOrEqual(budgets[1]!);
      expect(budgets[1]).toBeGreaterThanOrEqual(budgets[2]!);
      expect(budgets[2]).toBeGreaterThanOrEqual(budgets[3]!);
    });
  });

  // -- generateAdaptiveSection -----------------------------------------------

  describe("generateAdaptiveSection", () => {
    const basePrompt = "You are a helpful assistant. Answer questions clearly.";

    it("returns base prompt unchanged for frontier models", () => {
      const result = generator.generateAdaptiveSection("claude-opus-4", basePrompt);

      expect(result).toBe(basePrompt);
    });

    it("adds verification for strong models", () => {
      const result = generator.generateAdaptiveSection("claude-sonnet-4", basePrompt);

      expect(result).toContain(basePrompt);
      expect(result).toContain("verify");
    });

    it("adds step-by-step reasoning for standard models", () => {
      const result = generator.generateAdaptiveSection("gpt-3.5-turbo", basePrompt);

      expect(result).toContain("step by step");
      expect(result).toContain(basePrompt);
    });

    it("adds tool call instructions for standard/lightweight models", () => {
      const standard = generator.generateAdaptiveSection("gpt-3.5-turbo", basePrompt);
      expect(standard).toContain("tool");

      const lightweight = generator.generateAdaptiveSection("phi-3-mini", basePrompt);
      expect(lightweight).toContain("tool");
    });

    it("adds multi-step verification for lightweight models", () => {
      const result = generator.generateAdaptiveSection("tinyllama-1.1b", basePrompt);

      expect(result).toContain("Check");
      expect(result).toContain("step");
    });

    it("truncates long base prompts for token-constrained tiers", () => {
      const longPrompt = "x".repeat(100_000);
      const result = generator.generateAdaptiveSection("phi-3-mini", longPrompt);

      // Lightweight budget is 4000 tokens * 4 chars/token = 16000 chars
      // Result should be significantly shorter than the input
      expect(result.length).toBeLessThan(longPrompt.length);
      expect(result).toContain("[...truncated for model context limit]");
    });

    it("does not truncate short prompts for any tier", () => {
      const shortPrompt = "Be helpful.";

      const result = generator.generateAdaptiveSection("phi-3-mini", shortPrompt);

      expect(result).toContain(shortPrompt);
      expect(result).not.toContain("truncated");
    });
  });

  // -- wrapInstruction -------------------------------------------------------

  describe("wrapInstruction", () => {
    const instruction = "List the top 3 files that need refactoring.";

    it("returns instruction unchanged for frontier tier", () => {
      const result = generator.wrapInstruction(instruction, "frontier");
      expect(result).toBe(instruction);
    });

    it("adds chain-of-thought for strong tier", () => {
      const result = generator.wrapInstruction(instruction, "strong");

      expect(result).toContain("step by step");
      expect(result).toContain(instruction);
    });

    it("adds structured steps for standard tier", () => {
      const result = generator.wrapInstruction(instruction, "standard");

      expect(result).toContain("Step 1");
      expect(result).toContain("Step 2");
      expect(result).toContain("Step 3");
      expect(result).toContain(instruction);
    });

    it("adds verification step for lightweight tier", () => {
      const result = generator.wrapInstruction(instruction, "lightweight");

      expect(result).toContain("Step 4");
      expect(result).toContain("Verify");
    });

    it("adds verification step for local tier", () => {
      const result = generator.wrapInstruction(instruction, "local");

      expect(result).toContain("Verify");
    });

    it("preserves the original instruction text in all tiers", () => {
      const tiers: readonly ModelTier[] = [
        "frontier", "strong", "standard", "lightweight", "local",
      ];

      for (const tier of tiers) {
        const result = generator.wrapInstruction(instruction, tier);
        expect(result).toContain(instruction);
      }
    });
  });
});
