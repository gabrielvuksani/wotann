import { describe, it, expect } from "vitest";
import { getProviderHeaders, buildProviderUrl } from "../../src/providers/header-injection.js";

describe("Provider Header Injection", () => {
  describe("getProviderHeaders", () => {
    it("adds beta headers for Anthropic Opus with extended context", () => {
      const { headers } = getProviderHeaders("anthropic", "claude-opus-4-7", { enableExtendedContext: true });
      expect(headers["anthropic-version"]).toBe("2024-10-22");
      expect(headers["anthropic-beta"]).toContain("extended-context");
      expect(headers["anthropic-beta"]).toContain("extended-thinking");
      expect(headers["anthropic-beta"]).toContain("prompt-caching");
    });

    it("skips extended-context header when not enabled", () => {
      // Force env vars off for this test
      const origExtended = process.env["WOTANN_ENABLE_EXTENDED_CONTEXT"];
      const origAnthropic = process.env["ANTHROPIC_ENABLE_1M_CONTEXT"];
      delete process.env["WOTANN_ENABLE_EXTENDED_CONTEXT"];
      delete process.env["ANTHROPIC_ENABLE_1M_CONTEXT"];

      try {
        const { headers } = getProviderHeaders("anthropic", "claude-opus-4-7", { enableExtendedContext: false });
        expect(headers["anthropic-beta"]).not.toContain("extended-context");
        expect(headers["anthropic-beta"]).toContain("extended-thinking");
      } finally {
        if (origExtended !== undefined) process.env["WOTANN_ENABLE_EXTENDED_CONTEXT"] = origExtended;
        if (origAnthropic !== undefined) process.env["ANTHROPIC_ENABLE_1M_CONTEXT"] = origAnthropic;
      }
    });

    it("adds prompt caching for Haiku", () => {
      const { headers } = getProviderHeaders("anthropic", "claude-haiku-4-5");
      expect(headers["anthropic-beta"]).toContain("prompt-caching");
    });

    it("adds OpenAI-Beta for GPT-5 models", () => {
      const { headers } = getProviderHeaders("openai", "gpt-5.4");
      expect(headers["OpenAI-Beta"]).toBe("assistants=v2");
    });

    it("returns empty headers for unknown providers", () => {
      const { headers } = getProviderHeaders("unknown", "model-x");
      expect(Object.keys(headers)).toHaveLength(0);
    });

    it("returns query params for Gemini", () => {
      const result = getProviderHeaders("gemini", "gemini-2.5-pro");
      expect(result.queryParams).toBeDefined();
      expect(result.queryParams!["model"]).toBe("gemini-2.5-pro");
    });
  });

  describe("buildProviderUrl", () => {
    it("builds Anthropic URL", () => {
      expect(buildProviderUrl("https://api.anthropic.com", "anthropic", "claude-opus-4-7"))
        .toBe("https://api.anthropic.com/v1/messages");
    });

    it("builds OpenAI URL", () => {
      expect(buildProviderUrl("https://api.openai.com", "openai", "gpt-5.4"))
        .toBe("https://api.openai.com/v1/chat/completions");
    });

    it("builds Gemini URL with model", () => {
      expect(buildProviderUrl("https://generativelanguage.googleapis.com", "gemini", "gemini-2.5-pro"))
        .toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent");
    });

    it("returns base URL for unknown providers", () => {
      expect(buildProviderUrl("https://custom.api.com", "custom", "model"))
        .toBe("https://custom.api.com");
    });
  });
});
