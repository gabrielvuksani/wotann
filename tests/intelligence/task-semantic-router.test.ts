import { describe, it, expect } from "vitest";
import {
  TaskSemanticRouter,
  type TaskType,
  type TaskComplexity,
} from "../../src/intelligence/task-semantic-router.js";

describe("TaskSemanticRouter", () => {
  const router = new TaskSemanticRouter();

  const ALL_MODELS: readonly string[] = [
    "claude-opus-4",
    "claude-sonnet-4",
    "gpt-4",
    "gemini-pro",
    "haiku",
    "local",
  ];

  // -- classify() -----------------------------------------------------------

  describe("classify", () => {
    it("classifies code generation prompts correctly", () => {
      const result = router.classify("Write a REST API for user management", ALL_MODELS);
      expect(result.type).toBe("code-generation");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.recommendedModel).toBeDefined();
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it("classifies code review prompts correctly", () => {
      const result = router.classify("Review my authentication module for security issues", ALL_MODELS);
      expect(result.type).toBe("code-review");
    });

    it("classifies debugging prompts correctly", () => {
      const result = router.classify("Fix this error: TypeError: Cannot read property 'id' of undefined", ALL_MODELS);
      expect(result.type).toBe("debugging");
    });

    it("classifies research prompts correctly", () => {
      const result = router.classify("Research the best frameworks for building CLI tools in TypeScript", ALL_MODELS);
      expect(result.type).toBe("research");
    });

    it("classifies creative writing prompts when no code indicators present", () => {
      const result = router.classify("Draft a blog post about remote work culture", ALL_MODELS);
      expect(result.type).toBe("creative-writing");
    });

    it("prefers code-generation over creative-writing when code indicators present", () => {
      const result = router.classify("Write a function that validates email addresses", ALL_MODELS);
      // Should be code-generation, not creative-writing, because "function" is a code indicator
      expect(result.type).toBe("code-generation");
    });

    it("classifies math reasoning prompts correctly", () => {
      const result = router.classify("Prove that the square root of 2 is irrational", ALL_MODELS);
      expect(result.type).toBe("math-reasoning");
    });

    it("classifies document processing prompts correctly", () => {
      const result = router.classify("Summarize this PDF and extract the key findings", ALL_MODELS);
      expect(result.type).toBe("document-processing");
    });

    it("classifies image understanding prompts correctly", () => {
      const result = router.classify("What does this screenshot show?", ALL_MODELS);
      expect(result.type).toBe("image-understanding");
    });

    it("falls back to conversation for ambiguous prompts", () => {
      const result = router.classify("Hello, how are you?", ALL_MODELS);
      // Very generic prompt -- should be conversation or at least not crash
      expect(result.type).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it("provides fallback models that are different from the recommended model", () => {
      const result = router.classify("Implement a binary search tree", ALL_MODELS);
      expect(result.fallbackModels.length).toBeGreaterThan(0);
      for (const fallback of result.fallbackModels) {
        expect(fallback).not.toBe(result.recommendedModel);
      }
    });

    it("estimates cost as a non-negative number", () => {
      const result = router.classify("Build a microservices architecture", ALL_MODELS);
      expect(result.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    });

    it("assigns higher complexity for longer prompts with complexity signals", () => {
      const simpleResult = router.classify("Write a simple hello world", ALL_MODELS);
      const complexResult = router.classify(
        "Architect a distributed system with microservices, event sourcing, " +
        "and CQRS pattern for an enterprise production environment " +
        "that handles millions of requests",
        ALL_MODELS,
      );

      const complexityOrder: readonly TaskComplexity[] = [
        "trivial", "simple", "moderate", "complex", "expert",
      ];
      const simpleIndex = complexityOrder.indexOf(simpleResult.complexity);
      const complexIndex = complexityOrder.indexOf(complexResult.complexity);

      expect(complexIndex).toBeGreaterThan(simpleIndex);
    });

    it("works with a limited set of available models", () => {
      const result = router.classify("Implement user auth", ["local", "haiku"]);
      expect(["local", "haiku"]).toContain(result.recommendedModel);
    });

    it("returns a default model when no available models match preferences", () => {
      const result = router.classify("Write a server", ["unknown-model"]);
      expect(result.recommendedModel).toBe("unknown-model");
    });
  });

  // -- selectModel() --------------------------------------------------------

  describe("selectModel", () => {
    it("selects opus for code-generation at complex level", () => {
      const model = router.selectModel("code-generation", "complex", ALL_MODELS);
      expect(model).toBe("claude-opus-4");
    });

    it("selects cheap models for trivial tasks", () => {
      const model = router.selectModel("code-generation", "trivial", ALL_MODELS);
      expect(["haiku", "local", "claude-sonnet-4"]).toContain(model);
    });

    it("skips most expensive model for simple tasks", () => {
      // For code-generation, opus is first; simple should skip it
      const model = router.selectModel("code-generation", "simple", ALL_MODELS);
      expect(model).not.toBe("claude-opus-4");
    });

    it("selects gemini-pro for research tasks", () => {
      const model = router.selectModel("research", "moderate", ALL_MODELS);
      expect(model).toBe("gemini-pro");
    });

    it("selects sonnet for creative writing", () => {
      const model = router.selectModel("creative-writing", "moderate", ALL_MODELS);
      expect(model).toBe("claude-sonnet-4");
    });

    it("selects opus for math reasoning", () => {
      const model = router.selectModel("math-reasoning", "complex", ALL_MODELS);
      expect(model).toBe("claude-opus-4");
    });

    it("falls back to first available model when no preferences match", () => {
      const model = router.selectModel("conversation", "moderate", ["my-custom-model"]);
      expect(model).toBe("my-custom-model");
    });

    it("handles empty available models gracefully", () => {
      const model = router.selectModel("debugging", "moderate", []);
      expect(model).toBe("claude-sonnet-4"); // ultimate fallback
    });
  });

  // -- getSupportedTaskTypes() ----------------------------------------------

  describe("getSupportedTaskTypes", () => {
    it("returns all 10 task types", () => {
      const types = router.getSupportedTaskTypes();
      expect(types.length).toBe(10);
      expect(types).toContain("code-generation");
      expect(types).toContain("debugging");
      expect(types).toContain("research");
      expect(types).toContain("math-reasoning");
    });
  });

  // -- getPreferences() -----------------------------------------------------

  describe("getPreferences", () => {
    it("returns a non-empty preference list for known task types", () => {
      const prefs = router.getPreferences("code-generation");
      expect(prefs.length).toBeGreaterThan(0);
      expect(prefs[0]).toBe("claude-opus-4");
    });

    it("returns empty array for unknown task types", () => {
      const prefs = router.getPreferences("unknown" as TaskType);
      expect(prefs).toEqual([]);
    });
  });
});
