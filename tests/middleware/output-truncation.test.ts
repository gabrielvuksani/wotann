import { describe, it, expect, beforeEach } from "vitest";
import {
  OutputTruncationMiddleware,
  createOutputTruncationMiddleware,
} from "../../src/middleware/output-truncation.js";
import type { MiddlewareContext, AgentResult } from "../../src/middleware/types.js";

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    sessionId: "test-session",
    userMessage: "test",
    recentHistory: [],
    workingDir: "/tmp/test",
    ...overrides,
  };
}

function makeResult(overrides?: Partial<AgentResult>): AgentResult {
  return {
    content: "ok",
    success: true,
    ...overrides,
  };
}

/** Generate a string with N lines, each ~40 chars. */
function generateLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}: some output content here`).join("\n");
}

describe("OutputTruncationMiddleware", () => {
  let instance: OutputTruncationMiddleware;

  beforeEach(() => {
    instance = new OutputTruncationMiddleware();
  });

  describe("truncate()", () => {
    it("passes through content within limits", () => {
      const content = generateLines(50);
      const result = instance.truncate(content);

      expect(result.truncated).toBe(false);
      expect(result.linesDropped).toBe(0);
      expect(result.content).toBe(content);
    });

    it("truncates content exceeding maxToolOutputLines", () => {
      const content = generateLines(300);
      const result = instance.truncate(content);

      expect(result.truncated).toBe(true);
      expect(result.linesDropped).toBe(220); // 300 - 50 head - 30 tail
      expect(result.content).toContain("line 1:");
      expect(result.content).toContain("line 50:");
      expect(result.content).not.toContain("line 51:");
      expect(result.content).toContain("[... truncated 220 lines ...]");
      expect(result.content).toContain("line 300:");
      expect(result.content).toContain("line 271:");
    });

    it("truncates content exceeding maxToolOutputChars", () => {
      // Each line is ~40 chars, so 250 lines = ~10000 chars > 8000 default
      const content = generateLines(250);
      const result = instance.truncate(content);

      expect(result.truncated).toBe(true);
      expect(result.linesDropped).toBeGreaterThan(0);
    });

    it("preserves head and tail lines", () => {
      const instance2 = new OutputTruncationMiddleware({
        preserveHead: 3,
        preserveTail: 2,
        maxToolOutputLines: 10,
      });

      const content = generateLines(20);
      const result = instance2.truncate(content);

      expect(result.truncated).toBe(true);
      const lines = result.content.split("\n");

      // Head: 3 lines, blank, marker, blank, tail: 2 lines = 8 lines
      expect(lines[0]).toContain("line 1:");
      expect(lines[1]).toContain("line 2:");
      expect(lines[2]).toContain("line 3:");
      expect(lines[3]).toBe("");
      expect(lines[4]).toContain("[... truncated 15 lines ...]");
      expect(lines[5]).toBe("");
      expect(lines[6]).toContain("line 19:");
      expect(lines[7]).toContain("line 20:");
    });

    it("handles content with fewer lines than head+tail", () => {
      const instance2 = new OutputTruncationMiddleware({
        preserveHead: 50,
        preserveTail: 30,
        maxToolOutputLines: 10,
      });

      // 60 lines: head=50, tail=10 (capped since 60-50=10 < 30), dropped=0
      const content = generateLines(60);
      const result = instance2.truncate(content);

      // Not enough lines to drop anything meaningfully
      expect(result.truncated).toBe(false);
    });

    it("tracks cumulative statistics", () => {
      const content = generateLines(300);
      instance.truncate(content);
      instance.truncate(content);

      const stats = instance.getStats();
      expect(stats.totalTruncations).toBe(2);
      expect(stats.totalLinesDropped).toBe(440); // 220 * 2
      expect(stats.totalCharsDropped).toBeGreaterThan(0);
    });

    it("resets statistics", () => {
      instance.truncate(generateLines(300));
      instance.reset();

      const stats = instance.getStats();
      expect(stats.totalTruncations).toBe(0);
      expect(stats.totalLinesDropped).toBe(0);
      expect(stats.totalCharsDropped).toBe(0);
    });
  });

  describe("custom config", () => {
    it("respects custom truncation message", () => {
      const instance2 = new OutputTruncationMiddleware({
        truncationMessage: "--- SNIPPED {count} lines ---",
        maxToolOutputLines: 10,
        preserveHead: 3,
        preserveTail: 2,
      });

      const result = instance2.truncate(generateLines(20));
      expect(result.content).toContain("--- SNIPPED 15 lines ---");
    });

    it("respects custom char limit", () => {
      const instance2 = new OutputTruncationMiddleware({
        maxToolOutputChars: 500,
        preserveHead: 3,
        preserveTail: 2,
      });

      // 20 lines at ~40 chars each = ~800 chars > 500
      const content = generateLines(20);
      const result = instance2.truncate(content);

      expect(result.truncated).toBe(true);
    });
  });

  describe("pipeline adapter", () => {
    it("returns result unchanged when content is within limits", () => {
      const middleware = createOutputTruncationMiddleware(instance);
      const ctx = makeCtx();
      const result = makeResult({ content: "short output" });

      const processed = middleware.after!(ctx, result) as AgentResult;
      expect(processed.content).toBe("short output");
      expect(processed.followUp).toBeUndefined();
    });

    it("truncates oversized tool output in after hook", () => {
      const middleware = createOutputTruncationMiddleware(instance);
      const ctx = makeCtx();
      const result = makeResult({
        content: generateLines(300),
        toolName: "Bash",
      });

      const processed = middleware.after!(ctx, result) as AgentResult;
      expect(processed.content).toContain("[... truncated");
      expect(processed.followUp).toContain("[OutputTruncation]");
      expect(processed.followUp).toContain("Bash");
    });

    it("appends trace to existing followUp", () => {
      const middleware = createOutputTruncationMiddleware(instance);
      const ctx = makeCtx();
      const result = makeResult({
        content: generateLines(300),
        toolName: "Read",
        followUp: "existing note",
      });

      const processed = middleware.after!(ctx, result) as AgentResult;
      expect(processed.followUp).toContain("existing note");
      expect(processed.followUp).toContain("[OutputTruncation]");
    });

    it("passes through results with no content", () => {
      const middleware = createOutputTruncationMiddleware(instance);
      const ctx = makeCtx();
      const result = makeResult({ content: "" });

      const processed = middleware.after!(ctx, result) as AgentResult;
      expect(processed.content).toBe("");
    });

    it("has correct name and order", () => {
      const middleware = createOutputTruncationMiddleware(instance);
      expect(middleware.name).toBe("OutputTruncation");
      expect(middleware.order).toBe(6.5);
    });
  });
});
