import { describe, it, expect } from "vitest";
import {
  augmentToolCalling,
  augmentThinking,
  augmentVision,
  augmentQuery,
  parseToolCallFromText,
} from "../../src/providers/capability-augmenter.js";
import type { ProviderCapabilities, UnifiedQueryOptions } from "../../src/providers/types.js";

const FULL_CAPS: ProviderCapabilities = {
  supportsComputerUse: true,
  supportsToolCalling: true,
  supportsVision: true,
  supportsStreaming: true,
  supportsThinking: true,
  maxContextWindow: 1_000_000,
};

const MINIMAL_CAPS: ProviderCapabilities = {
  supportsComputerUse: false,
  supportsToolCalling: false,
  supportsVision: false,
  supportsStreaming: false,
  supportsThinking: false,
  maxContextWindow: 32_000,
};

const BASE_OPTIONS: UnifiedQueryOptions = {
  prompt: "Write a function that sorts an array of numbers in ascending order",
  systemPrompt: "You are a helpful coding assistant.",
};

describe("Capability Augmenter", () => {
  describe("augmentToolCalling", () => {
    it("passes through when provider supports tool calling", () => {
      const options: UnifiedQueryOptions = {
        ...BASE_OPTIONS,
        tools: [{ name: "read_file", description: "Read a file", inputSchema: { path: { type: "string" } } }],
      };
      const result = augmentToolCalling(options, FULL_CAPS);
      expect(result).toBe(options); // Same reference — no augmentation
    });

    it("injects XML tool definitions for non-tool models", () => {
      const options: UnifiedQueryOptions = {
        ...BASE_OPTIONS,
        tools: [{ name: "read_file", description: "Read a file", inputSchema: { path: { type: "string", description: "File path" } } }],
      };
      const result = augmentToolCalling(options, MINIMAL_CAPS);
      expect(result.systemPrompt).toContain("Available Tools");
      expect(result.systemPrompt).toContain("read_file");
      expect(result.systemPrompt).toContain("<tool_use>");
      expect(result.tools).toBeUndefined();
    });

    it("does nothing when no tools provided", () => {
      const result = augmentToolCalling(BASE_OPTIONS, MINIMAL_CAPS);
      expect(result).toBe(BASE_OPTIONS);
    });
  });

  describe("augmentThinking", () => {
    it("passes through when provider supports thinking", () => {
      const result = augmentThinking(BASE_OPTIONS, FULL_CAPS);
      expect(result).toBe(BASE_OPTIONS);
    });

    it("injects thinking preamble for non-thinking models with complex prompts", () => {
      const longPrompt: UnifiedQueryOptions = {
        prompt: "x".repeat(150),
        systemPrompt: "You are helpful.",
      };
      const result = augmentThinking(longPrompt, MINIMAL_CAPS);
      expect(result.systemPrompt).toContain("think through this step by step");
      expect(result.systemPrompt).toContain("<thinking>");
    });

    it("skips augmentation for short prompts", () => {
      const shortPrompt: UnifiedQueryOptions = { prompt: "hi" };
      const result = augmentThinking(shortPrompt, MINIMAL_CAPS);
      expect(result).toBe(shortPrompt);
    });
  });

  describe("augmentVision", () => {
    it("passes through when provider supports vision", () => {
      const options: UnifiedQueryOptions = { prompt: "Describe [image:screenshot.png]" };
      const result = augmentVision(options, FULL_CAPS);
      expect(result).toBe(options);
    });

    it("replaces image references for non-vision models", () => {
      const options: UnifiedQueryOptions = { prompt: "What's in [image:photo.jpg]?" };
      const result = augmentVision(options, MINIMAL_CAPS);
      // S3-7: vision OCR replaces the placeholder with either real
      // OCR text or an honest "[OCR ...]" marker. Either way the
      // original [image:...] is consumed and the system note about
      // text descriptions is appended to systemPrompt.
      expect(result.prompt).not.toContain("[image:photo.jpg]");
      expect(result.prompt).toMatch(/\[(OCR|Image)/);
      expect(result.systemPrompt).toContain("text descriptions");
    });

    it("does nothing when no images referenced", () => {
      const result = augmentVision(BASE_OPTIONS, MINIMAL_CAPS);
      expect(result).toBe(BASE_OPTIONS);
    });
  });

  describe("augmentQuery (full pipeline)", () => {
    it("applies all augmentations for minimal-capability models", () => {
      const options: UnifiedQueryOptions = {
        prompt: "x".repeat(150) + " [image:test.png]",
        systemPrompt: "You are helpful.",
        tools: [{ name: "test", description: "Test tool", inputSchema: {} }],
      };
      const result = augmentQuery(options, MINIMAL_CAPS);
      expect(result.systemPrompt).toContain("Available Tools");
      expect(result.systemPrompt).toContain("think through this step by step");
      // S3-7: vision OCR consumes the [image:...] marker.
      expect(result.prompt).not.toContain("[image:test.png]");
      expect(result.prompt).toMatch(/\[(OCR|Image)/);
    });

    it("passes through unchanged for full-capability models", () => {
      const result = augmentQuery(BASE_OPTIONS, FULL_CAPS);
      expect(result).toBe(BASE_OPTIONS);
    });
  });

  describe("parseToolCallFromText", () => {
    it("parses valid tool call XML", () => {
      const text = `I'll read the file for you.

<tool_use>
  <tool name="read_file">
    <param name="path">src/index.ts</param>
  </tool>
</tool_use>`;

      const result = parseToolCallFromText(text);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("read_file");
      expect(result?.args["path"]).toBe("src/index.ts");
    });

    it("returns null when no tool call found", () => {
      const result = parseToolCallFromText("Just a normal response with no tools.");
      expect(result).toBeNull();
    });

    it("handles multiple parameters", () => {
      const text = `<tool_use>
  <tool name="write_file">
    <param name="path">output.txt</param>
    <param name="content">Hello world</param>
  </tool>
</tool_use>`;

      const result = parseToolCallFromText(text);
      expect(result?.name).toBe("write_file");
      expect(result?.args["path"]).toBe("output.txt");
      expect(result?.args["content"]).toBe("Hello world");
    });
  });
});
