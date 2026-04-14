import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MicroEvalRunner,
  type MicroEvalTestCase,
  type MicroEvalCheck,
  type MicroEvalSuite,
} from "../../src/intelligence/micro-eval.js";

// ── Helpers ────────────────────────────────────────────────

function makePassingExecutor(): (prompt: string) => Promise<string> {
  return async (_prompt: string) =>
    "I will use the Read tool with file_path='/tmp/test-file.txt'. " +
    "Write tool with file_path and content parameters. " +
    "Grep search with pattern TODO. " +
    "Bash command: npm test. " +
    "Edit tool with old_string and new_string.";
}

function makeFailingExecutor(): (prompt: string) => Promise<string> {
  return async (_prompt: string) => "I don't know how to help with that.";
}

function makeThrowingExecutor(): (prompt: string) => Promise<string> {
  return async (_prompt: string) => {
    throw new Error("Connection refused");
  };
}

function makeCustomTestCases(): readonly MicroEvalTestCase[] {
  return [
    {
      tool: "custom_tool",
      prompt: "Use the custom tool",
      validate: (_response: string): MicroEvalCheck => ({
        passed: true,
      }),
    },
  ];
}

// ── Tests ──────────────────────────────────────────────────

describe("MicroEvalRunner", () => {
  let runner: MicroEvalRunner;

  beforeEach(() => {
    runner = new MicroEvalRunner();
  });

  describe("constructor", () => {
    it("uses default test cases when none provided", () => {
      const tools = runner.getTestCaseTools();
      expect(tools).toContain("file_read");
      expect(tools).toContain("file_write");
      expect(tools).toContain("grep_search");
      expect(tools).toContain("bash_command");
      expect(tools).toContain("file_edit");
      expect(tools.length).toBe(5);
    });

    it("accepts custom test cases", () => {
      const custom = makeCustomTestCases();
      const customRunner = new MicroEvalRunner(custom);
      const tools = customRunner.getTestCaseTools();
      expect(tools).toEqual(["custom_tool"]);
    });

    it("accepts empty test cases array", () => {
      const emptyRunner = new MicroEvalRunner([]);
      expect(emptyRunner.getTestCaseTools()).toEqual([]);
    });
  });

  describe("evaluateToolCompatibility", () => {
    it("scores 1.0 when all tools pass", async () => {
      const suite = await runner.evaluateToolCompatibility(
        "claude-sonnet",
        "anthropic",
        makePassingExecutor(),
      );

      expect(suite.overallScore).toBe(1);
      expect(suite.failingTools).toEqual([]);
      expect(suite.results.length).toBe(5);
      expect(suite.results.every((r) => r.passed)).toBe(true);
    });

    it("scores 0 when all tools fail", async () => {
      const suite = await runner.evaluateToolCompatibility(
        "weak-model",
        "test-provider",
        makeFailingExecutor(),
      );

      expect(suite.overallScore).toBe(0);
      expect(suite.failingTools.length).toBe(5);
      expect(suite.results.every((r) => !r.passed)).toBe(true);
    });

    it("records executor errors without crashing", async () => {
      const suite = await runner.evaluateToolCompatibility(
        "broken-model",
        "test-provider",
        makeThrowingExecutor(),
      );

      expect(suite.overallScore).toBe(0);
      for (const result of suite.results) {
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe("executor-error");
        expect(result.suggestedFix).toContain("Connection refused");
      }
    });

    it("records latencyMs for each result", async () => {
      const suite = await runner.evaluateToolCompatibility(
        "claude-sonnet",
        "anthropic",
        makePassingExecutor(),
      );

      for (const result of suite.results) {
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("sets evaluatedAt timestamp on the suite", async () => {
      const before = Date.now();
      const suite = await runner.evaluateToolCompatibility(
        "claude-sonnet",
        "anthropic",
        makePassingExecutor(),
      );
      const after = Date.now();

      expect(suite.evaluatedAt).toBeGreaterThanOrEqual(before);
      expect(suite.evaluatedAt).toBeLessThanOrEqual(after);
    });

    it("generates recommendations for missing tool calls", async () => {
      const suite = await runner.evaluateToolCompatibility(
        "weak-model",
        "test-provider",
        makeFailingExecutor(),
      );

      expect(suite.recommendations.length).toBeGreaterThan(0);
      expect(suite.recommendations.some((r) => r.includes("tool calls"))).toBe(true);
    });

    it("generates 'no calibration needed' when all pass", async () => {
      const suite = await runner.evaluateToolCompatibility(
        "claude-sonnet",
        "anthropic",
        makePassingExecutor(),
      );

      expect(suite.recommendations).toContain(
        "All tool compatibility tests passed. No calibration needed.",
      );
    });

    it("truncates long executor error messages in suggestedFix", async () => {
      const longErrorExecutor = async (_prompt: string): Promise<string> => {
        throw new Error("x".repeat(200));
      };

      const suite = await runner.evaluateToolCompatibility(
        "err-model",
        "provider",
        longErrorExecutor,
      );

      for (const result of suite.results) {
        // suggestedFix includes "Executor failed: " prefix + sliced message
        expect(result.suggestedFix!.length).toBeLessThanOrEqual(200);
      }
    });

    it("handles non-Error thrown values", async () => {
      const stringThrower = async (_prompt: string): Promise<string> => {
        throw "raw string error";
      };

      const suite = await runner.evaluateToolCompatibility(
        "throw-model",
        "provider",
        stringThrower,
      );

      for (const result of suite.results) {
        expect(result.errorType).toBe("executor-error");
        expect(result.suggestedFix).toContain("raw string error");
      }
    });
  });

  describe("getCachedResults", () => {
    it("returns null when no cached results exist", () => {
      expect(runner.getCachedResults("claude-sonnet", "anthropic")).toBeNull();
    });

    it("returns cached suite after evaluation", async () => {
      await runner.evaluateToolCompatibility(
        "claude-sonnet",
        "anthropic",
        makePassingExecutor(),
      );

      const cached = runner.getCachedResults("claude-sonnet", "anthropic");
      expect(cached).not.toBeNull();
      expect(cached!.overallScore).toBe(1);
    });

    it("caches separate results per model+provider", async () => {
      await runner.evaluateToolCompatibility("model-a", "provider-1", makePassingExecutor());
      await runner.evaluateToolCompatibility("model-b", "provider-2", makeFailingExecutor());

      const cachedA = runner.getCachedResults("model-a", "provider-1");
      const cachedB = runner.getCachedResults("model-b", "provider-2");

      expect(cachedA!.overallScore).toBe(1);
      expect(cachedB!.overallScore).toBe(0);
    });

    it("overwrites cache on re-evaluation of same model+provider", async () => {
      await runner.evaluateToolCompatibility("model-a", "provider-1", makeFailingExecutor());
      expect(runner.getCachedResults("model-a", "provider-1")!.overallScore).toBe(0);

      await runner.evaluateToolCompatibility("model-a", "provider-1", makePassingExecutor());
      expect(runner.getCachedResults("model-a", "provider-1")!.overallScore).toBe(1);
    });
  });

  describe("clearCache", () => {
    it("removes all cached results", async () => {
      await runner.evaluateToolCompatibility("model-a", "p1", makePassingExecutor());
      await runner.evaluateToolCompatibility("model-b", "p2", makePassingExecutor());

      runner.clearCache();

      expect(runner.getCachedResults("model-a", "p1")).toBeNull();
      expect(runner.getCachedResults("model-b", "p2")).toBeNull();
    });

    it("is safe to call on empty cache", () => {
      expect(() => runner.clearCache()).not.toThrow();
    });
  });

  describe("getTestCaseTools", () => {
    it("returns tool names in order", () => {
      const tools = runner.getTestCaseTools();
      expect(tools[0]).toBe("file_read");
      expect(tools[4]).toBe("file_edit");
    });
  });

  describe("evaluateToolCompatibility with custom test cases", () => {
    it("evaluates empty test suite producing score 0", async () => {
      const emptyRunner = new MicroEvalRunner([]);
      const suite = await emptyRunner.evaluateToolCompatibility(
        "model",
        "provider",
        makePassingExecutor(),
      );

      expect(suite.results).toEqual([]);
      expect(suite.overallScore).toBe(0);
      expect(suite.failingTools).toEqual([]);
    });

    it("handles partial pass/fail for mixed results", async () => {
      let callCount = 0;
      const mixedExecutor = async (_prompt: string): Promise<string> => {
        callCount++;
        // Only pass Read tool prompt
        if (callCount === 1) return "Use the Read tool with file_path parameter";
        return "I don't know";
      };

      const suite = await runner.evaluateToolCompatibility(
        "mixed-model",
        "provider",
        mixedExecutor,
      );

      expect(suite.overallScore).toBeGreaterThan(0);
      expect(suite.overallScore).toBeLessThan(1);
      expect(suite.failingTools.length).toBeGreaterThan(0);
      expect(suite.failingTools.length).toBeLessThan(5);
    });
  });
});
