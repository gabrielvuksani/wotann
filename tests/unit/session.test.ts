import { describe, it, expect } from "vitest";
import { createSession, addMessage, updateModel, formatSessionStats } from "../../src/core/session.js";

describe("Session", () => {
  describe("createSession", () => {
    it("creates a session with UUID and timestamp", () => {
      const session = createSession("anthropic", "claude-sonnet-4-6");

      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.startedAt).toBeInstanceOf(Date);
      expect(session.provider).toBe("anthropic");
      expect(session.model).toBe("claude-sonnet-4-6");
      expect(session.totalTokens).toBe(0);
      expect(session.totalCost).toBe(0);
      expect(session.toolCalls).toBe(0);
      expect(session.messages).toEqual([]);
    });
  });

  describe("addMessage", () => {
    it("adds message immutably", () => {
      const session = createSession("anthropic", "claude-sonnet-4-6");
      const updated = addMessage(session, {
        role: "user",
        content: "Hello",
      });

      // Original unchanged
      expect(session.messages.length).toBe(0);
      // New session has message
      expect(updated.messages.length).toBe(1);
      expect(updated.messages[0]?.content).toBe("Hello");
    });

    it("tracks token usage", () => {
      const session = createSession("anthropic", "claude-sonnet-4-6");
      const updated = addMessage(session, {
        role: "assistant",
        content: "Hi there",
        tokensUsed: 150,
        cost: 0.003,
      });

      expect(updated.totalTokens).toBe(150);
      expect(updated.totalCost).toBe(0.003);
    });

    it("counts tool calls", () => {
      const session = createSession("anthropic", "claude-sonnet-4-6");
      const updated = addMessage(session, {
        role: "tool",
        content: "file contents",
        toolName: "Read",
      });

      expect(updated.toolCalls).toBe(1);
    });
  });

  describe("updateModel", () => {
    it("updates model immutably", () => {
      const session = createSession("anthropic", "claude-sonnet-4-6");
      const updated = updateModel(session, "ollama", "qwen3-coder-next");

      expect(session.provider).toBe("anthropic");
      expect(updated.provider).toBe("ollama");
      expect(updated.model).toBe("qwen3-coder-next");
    });
  });

  describe("formatSessionStats", () => {
    it("formats stats as readable string", () => {
      const session = createSession("anthropic", "claude-sonnet-4-6");
      const stats = formatSessionStats(session);

      expect(stats).toContain("anthropic");
      expect(stats).toContain("claude-sonnet-4-6");
      expect(stats).toContain("Tokens:");
      expect(stats).toContain("Cost:");
    });
  });
});
