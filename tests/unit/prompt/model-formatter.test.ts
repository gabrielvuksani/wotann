import { describe, it, expect } from "vitest";
import {
  ModelPromptFormatter,
  compactToolDescriptions,
  type ToolDescriptor,
  type ModelFormatConfig,
  type PromptFormat,
} from "../../../src/prompt/model-formatter.js";

const formatter = new ModelPromptFormatter();

const sampleTools: readonly ToolDescriptor[] = [
  { name: "Read", description: "Read files from the filesystem with line numbers. Supports images and PDFs." },
  { name: "Edit", description: "Perform exact string replacements in files. Requires reading first." },
  { name: "Bash", description: "Execute shell commands and return output. Working directory persists." },
];

// ── getFormatConfig ─────────────────────────────────────────

describe("ModelPromptFormatter", () => {
  describe("getFormatConfig", () => {
    it("returns xml format for Claude opus", () => {
      const config = formatter.getFormatConfig("claude-opus-4-20250514");
      expect(config.format).toBe("xml");
      expect(config.useStructuredBlocks).toBe(true);
    });

    it("returns xml format for Claude sonnet", () => {
      const config = formatter.getFormatConfig("claude-sonnet-4-20250514");
      expect(config.format).toBe("xml");
    });

    it("returns xml format for Claude haiku", () => {
      const config = formatter.getFormatConfig("claude-3-haiku-20240307");
      expect(config.format).toBe("xml");
    });

    it("returns json format for GPT-4", () => {
      const config = formatter.getFormatConfig("gpt-4-turbo-2024-04-09");
      expect(config.format).toBe("json");
      expect(config.toolDescriptionFormat).toBe("compact");
    });

    it("returns json format for GPT-5", () => {
      const config = formatter.getFormatConfig("gpt-5-0125");
      expect(config.format).toBe("json");
    });

    it("returns json format for GPT-3.5", () => {
      const config = formatter.getFormatConfig("gpt-3.5-turbo");
      expect(config.format).toBe("json");
    });

    it("returns json format for o1 models", () => {
      const config = formatter.getFormatConfig("o1-preview");
      expect(config.format).toBe("json");
    });

    it("returns markdown format for Gemini Pro", () => {
      const config = formatter.getFormatConfig("gemini-pro-1.5");
      expect(config.format).toBe("markdown");
      expect(config.includeExamples).toBe(true);
    });

    it("returns markdown format for Gemini Flash", () => {
      const config = formatter.getFormatConfig("gemini-2.0-flash");
      expect(config.format).toBe("markdown");
    });

    it("returns minimal format for ollama models", () => {
      const config = formatter.getFormatConfig("ollama/llama3:8b");
      expect(config.format).toBe("minimal");
      expect(config.useStructuredBlocks).toBe(false);
      expect(config.toolDescriptionFormat).toBe("names-only");
    });

    it("returns minimal format for llama models", () => {
      const config = formatter.getFormatConfig("llama-3.1-70b");
      expect(config.format).toBe("minimal");
    });

    it("returns minimal format for qwen models", () => {
      const config = formatter.getFormatConfig("qwen-2.5-72b");
      expect(config.format).toBe("minimal");
    });

    it("returns minimal format for phi models", () => {
      const config = formatter.getFormatConfig("phi-3-mini");
      expect(config.format).toBe("minimal");
    });

    it("returns minimal format for gemma models", () => {
      const config = formatter.getFormatConfig("gemma-4-27b");
      expect(config.format).toBe("minimal");
    });

    it("returns default markdown config for unknown models", () => {
      const config = formatter.getFormatConfig("some-unknown-model-v2");
      expect(config.format).toBe("markdown");
      expect(config.maxSystemTokens).toBe(8_000);
      expect(config.toolDescriptionFormat).toBe("compact");
    });

    it("is case-insensitive", () => {
      const lower = formatter.getFormatConfig("claude-opus-4");
      const upper = formatter.getFormatConfig("CLAUDE-OPUS-4");
      expect(lower.format).toBe(upper.format);
    });
  });

  // ── formatSection ───────────────────────────────────────────

  describe("formatSection", () => {
    const title = "Rules";
    const content = "Follow these rules carefully.";

    it("wraps content in XML tags for xml format", () => {
      const result = formatter.formatSection(title, content, "xml");
      expect(result).toBe("<rules>\nFollow these rules carefully.\n</rules>");
    });

    it("sanitizes XML tag names from titles with spaces", () => {
      const result = formatter.formatSection("Task Context", "do the thing", "xml");
      expect(result).toBe("<task_context>\ndo the thing\n</task_context>");
    });

    it("wraps content in code block for json format", () => {
      const result = formatter.formatSection(title, content, "json");
      expect(result).toBe("## Rules\n```\nFollow these rules carefully.\n```");
    });

    it("uses markdown headers for markdown format", () => {
      const result = formatter.formatSection(title, content, "markdown");
      expect(result).toBe("## Rules\n\nFollow these rules carefully.");
    });

    it("uses directive style for minimal format with single line", () => {
      const result = formatter.formatSection(title, content, "minimal");
      expect(result).toBe("Rules: Follow these rules carefully.");
    });

    it("numbers multi-line content for minimal format", () => {
      const multiLine = "Read the code\nPlan changes\nExecute";
      const result = formatter.formatSection("Steps", multiLine, "minimal");
      expect(result).toContain("Steps:");
      expect(result).toContain("1. Read the code");
      expect(result).toContain("2. Plan changes");
      expect(result).toContain("3. Execute");
    });

    it("strips empty lines in minimal format", () => {
      const withBlanks = "First\n\nSecond\n\nThird";
      const result = formatter.formatSection("Items", withBlanks, "minimal");
      expect(result).toContain("1. First");
      expect(result).toContain("2. Second");
      expect(result).toContain("3. Third");
      // Should not have a "4." line
      expect(result).not.toContain("4.");
    });
  });

  // ── formatSystemPrompt ──────────────────────────────────────

  describe("formatSystemPrompt", () => {
    const parts = {
      cachedPrefix: "You are WOTANN, an AI agent harness.",
      dynamicSuffix: "Mode: CAREFUL\n- Verify everything",
    };

    it("wraps both parts in XML for Claude models", () => {
      const result = formatter.formatSystemPrompt(parts, "claude-opus-4");
      expect(result).toContain("<system_context>");
      expect(result).toContain("</system_context>");
      expect(result).toContain("<task_context>");
      expect(result).toContain("</task_context>");
    });

    it("wraps both parts in code blocks for GPT models", () => {
      const result = formatter.formatSystemPrompt(parts, "gpt-4-turbo");
      expect(result).toContain("## system_context");
      expect(result).toContain("```");
      expect(result).toContain("## task_context");
    });

    it("uses markdown headers for Gemini models", () => {
      const result = formatter.formatSystemPrompt(parts, "gemini-pro-1.5");
      expect(result).toContain("## system_context");
      expect(result).toContain("## task_context");
      // Markdown format has double newline after header, not code block
      expect(result).not.toContain("```");
    });

    it("uses directive style for local models", () => {
      const result = formatter.formatSystemPrompt(parts, "ollama/mistral");
      // Minimal format collapses to numbered directives
      expect(result).toContain("system_context:");
      expect(result).toContain("task_context:");
    });

    it("omits empty cachedPrefix section", () => {
      const emptyPrefix = { cachedPrefix: "", dynamicSuffix: "some context" };
      const result = formatter.formatSystemPrompt(emptyPrefix, "claude-opus-4");
      expect(result).not.toContain("<system_context>");
      expect(result).toContain("<task_context>");
    });

    it("omits empty dynamicSuffix section", () => {
      const emptySuffix = { cachedPrefix: "context here", dynamicSuffix: "" };
      const result = formatter.formatSystemPrompt(emptySuffix, "claude-opus-4");
      expect(result).toContain("<system_context>");
      expect(result).not.toContain("<task_context>");
    });

    it("returns empty string when both parts are empty", () => {
      const empty = { cachedPrefix: "", dynamicSuffix: "" };
      const result = formatter.formatSystemPrompt(empty, "gpt-4");
      expect(result).toBe("");
    });
  });

  // ── formatToolDescriptions ──────────────────────────────────

  describe("formatToolDescriptions", () => {
    const fullConfig: ModelFormatConfig = {
      format: "xml",
      useStructuredBlocks: true,
      maxSystemTokens: 16_000,
      includeExamples: false,
      toolDescriptionFormat: "full",
    };

    const compactConfig: ModelFormatConfig = {
      format: "json",
      useStructuredBlocks: true,
      maxSystemTokens: 12_000,
      includeExamples: false,
      toolDescriptionFormat: "compact",
    };

    const namesOnlyConfig: ModelFormatConfig = {
      format: "minimal",
      useStructuredBlocks: false,
      maxSystemTokens: 4_000,
      includeExamples: false,
      toolDescriptionFormat: "names-only",
    };

    it("includes full descriptions for 'full' format", () => {
      const result = formatter.formatToolDescriptions(sampleTools, fullConfig);
      expect(result).toContain("**Read**");
      expect(result).toContain("Read files from the filesystem with line numbers");
      expect(result).toContain("Supports images and PDFs");
    });

    it("includes one-line summaries for 'compact' format", () => {
      const result = formatter.formatToolDescriptions(sampleTools, compactConfig);
      expect(result).toContain("Read:");
      // Should truncate to first sentence
      expect(result).not.toContain("Supports images and PDFs");
    });

    it("lists only names for 'names-only' format", () => {
      const result = formatter.formatToolDescriptions(sampleTools, namesOnlyConfig);
      expect(result).toBe("Available tools: Read, Edit, Bash");
      expect(result).not.toContain("filesystem");
    });

    it("handles empty tool list gracefully", () => {
      const result = formatter.formatToolDescriptions([], fullConfig);
      expect(result).toBe("");
    });

    it("truncates long descriptions in compact mode", () => {
      const longTool: ToolDescriptor = {
        name: "LongTool",
        description: "This is a very long first sentence that exceeds sixty characters by quite a lot indeed yes",
      };
      const result = formatter.formatToolDescriptions([longTool], compactConfig);
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(longTool.description.length + 20);
    });
  });
});

// ── compactToolDescriptions (standalone function) ───────────

describe("compactToolDescriptions", () => {
  it("returns full descriptions when format is 'full'", () => {
    const result = compactToolDescriptions(sampleTools, "full");
    expect(result).toContain("**Read**");
    expect(result).toContain("**Edit**");
    expect(result).toContain("**Bash**");
  });

  it("returns compact descriptions when format is 'compact'", () => {
    const result = compactToolDescriptions(sampleTools, "compact");
    expect(result).toContain("Read:");
    expect(result).toContain("Edit:");
    // Should not contain full multi-sentence descriptions
    expect(result).not.toContain("Supports images and PDFs");
  });

  it("returns names-only when format is 'names-only'", () => {
    const result = compactToolDescriptions(sampleTools, "names-only");
    expect(result).toBe("Available tools: Read, Edit, Bash");
  });

  it("is equivalent to formatToolDescriptions on the class", () => {
    const config: ModelFormatConfig = {
      format: "xml",
      useStructuredBlocks: true,
      maxSystemTokens: 16_000,
      includeExamples: false,
      toolDescriptionFormat: "compact",
    };
    const standalone = compactToolDescriptions(sampleTools, "compact");
    const classMethod = formatter.formatToolDescriptions(sampleTools, config);
    expect(standalone).toBe(classMethod);
  });
});
