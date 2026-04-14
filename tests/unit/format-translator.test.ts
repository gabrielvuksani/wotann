import { describe, it, expect } from "vitest";
import { anthropicToOpenAI, openAIToAnthropic } from "../../src/providers/format-translator.js";

describe("Format Translator", () => {
  describe("anthropicToOpenAI", () => {
    it("translates simple text messages", () => {
      const result = anthropicToOpenAI([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: "user", content: "Hello" });
      expect(result[1]).toEqual({ role: "assistant", content: "Hi there!" });
    });

    it("translates tool_use blocks to function calls", () => {
      const result = anthropicToOpenAI([
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me read that file." },
            {
              type: "tool_use",
              id: "toolu_123",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.tool_calls).toHaveLength(1);
      expect(result[0]?.tool_calls?.[0]?.function.name).toBe("Read");
    });

    it("translates tool results to tool messages", () => {
      const result = anthropicToOpenAI([
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "File contents here",
            },
          ],
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe("tool");
      expect(result[0]?.content).toBe("File contents here");
    });

    it("preserves thinking blocks as structured metadata", () => {
      const result = anthropicToOpenAI([
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me analyze this..." },
            { type: "text", text: "Here's my analysis." },
          ],
        },
      ]);

      // Thinking blocks become separate assistant messages with metadata
      // followed by the text content message
      expect(result.length).toBeGreaterThanOrEqual(2);
      const thinkingMsg = result.find((m) => (m as Record<string, unknown>).metadata !== undefined);
      expect(thinkingMsg).toBeDefined();
      const textMsg = result.find((m) => typeof m.content === "string" && m.content.includes("analysis"));
      expect(textMsg).toBeDefined();
    });
  });

  describe("openAIToAnthropic", () => {
    it("translates simple messages", () => {
      const result = openAIToAnthropic([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: "user", content: "Hello" });
      expect(result[1]).toEqual({ role: "assistant", content: "Hi!" });
    });

    it("skips system messages", () => {
      const result = openAIToAnthropic([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe("user");
    });

    it("translates function calls to tool_use", () => {
      const result = openAIToAnthropic([
        {
          role: "assistant",
          content: "Reading file...",
          tool_calls: [
            {
              id: "call_123",
              type: "function" as const,
              function: {
                name: "Read",
                arguments: '{"file_path": "/src/index.ts"}',
              },
            },
          ],
        },
      ]);

      expect(result).toHaveLength(1);
      const blocks = result[0]?.content;
      expect(Array.isArray(blocks)).toBe(true);
      if (Array.isArray(blocks)) {
        expect(blocks).toHaveLength(2);
        expect(blocks[0]?.type).toBe("text");
        expect(blocks[1]?.type).toBe("tool_use");
        expect(blocks[1]?.name).toBe("Read");
      }
    });

    it("translates tool response messages", () => {
      const result = openAIToAnthropic([
        {
          role: "tool",
          content: "File contents",
          tool_call_id: "call_123",
        },
      ]);

      expect(result).toHaveLength(1);
      const blocks = result[0]?.content;
      expect(Array.isArray(blocks)).toBe(true);
      if (Array.isArray(blocks)) {
        expect(blocks[0]?.type).toBe("tool_result");
        expect(blocks[0]?.tool_use_id).toBe("call_123");
      }
    });
  });
});
