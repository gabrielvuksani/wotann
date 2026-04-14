import { describe, it, expect } from "vitest";
import { PromptEnhancer, getStylePrompt, listEnhancementStyles } from "../../src/desktop/prompt-enhancer.js";
import type { EnhancementStyle } from "../../src/desktop/types.js";

describe("PromptEnhancer", () => {
  const mockExecutor = async (prompt: string, _systemPrompt: string) => ({
    response: "Enhanced: " + prompt.split("---")[1]?.trim()?.slice(0, 50) + " with more detail and specificity",
    model: "claude-opus-4-6",
    provider: "anthropic",
    tokensUsed: 150,
    durationMs: 500,
  });

  it("should enhance a prompt with default style", async () => {
    const enhancer = new PromptEnhancer();
    const result = await enhancer.enhance("Fix the login bug", mockExecutor);

    expect(result.originalPrompt).toBe("Fix the login bug");
    expect(result.enhancedPrompt).toBeTruthy();
    expect(result.style).toBe("detailed");
    expect(result.model).toBe("claude-opus-4-6");
    expect(result.provider).toBe("anthropic");
    expect(result.tokensUsed).toBe(150);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should enhance with a specific style", async () => {
    const enhancer = new PromptEnhancer();
    const result = await enhancer.enhance("Build a REST API", mockExecutor, "technical");
    expect(result.style).toBe("technical");
  });

  it("should quick enhance with detailed style", async () => {
    const enhancer = new PromptEnhancer();
    const result = await enhancer.quickEnhance("Add auth to the app", mockExecutor);
    expect(result.style).toBe("detailed");
    expect(result.enhancedPrompt).toBeTruthy();
  });

  it("should detect improvements", async () => {
    const longEnhancer = async (_prompt: string, _sys: string) => ({
      response: "Fix the login bug by checking the authentication middleware for expired JWT tokens. Handle edge cases where the refresh token is also expired. Add proper error handling with user-friendly messages. Verify with integration tests.",
      model: "claude-opus-4-6",
      provider: "anthropic",
      tokensUsed: 200,
      durationMs: 800,
    });

    const enhancer = new PromptEnhancer();
    const result = await enhancer.enhance("Fix the login bug", longEnhancer);
    expect(result.improvements.length).toBeGreaterThan(0);
  });

  it("should work with custom config", () => {
    const enhancer = new PromptEnhancer({
      style: "concise",
      maxOutputTokens: 500,
      includeImprovements: false,
    });
    expect(enhancer).toBeDefined();
  });
});

describe("getStylePrompt", () => {
  it("should return prompts for all styles", () => {
    const styles: EnhancementStyle[] = ["concise", "detailed", "technical", "creative", "structured"];
    for (const style of styles) {
      const prompt = getStylePrompt(style);
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(50);
    }
  });
});

describe("listEnhancementStyles", () => {
  it("should list all 5 styles", () => {
    const styles = listEnhancementStyles();
    expect(styles).toHaveLength(5);
    expect(styles.map((s) => s.style)).toEqual(["concise", "detailed", "technical", "creative", "structured"]);
  });

  it("should include descriptions for all styles", () => {
    const styles = listEnhancementStyles();
    for (const style of styles) {
      expect(style.description).toBeTruthy();
      expect(style.description.length).toBeGreaterThan(10);
    }
  });
});
