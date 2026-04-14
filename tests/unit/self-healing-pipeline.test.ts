import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyError,
  detectErrorRepetition,
  SelfHealingPipeline,
} from "../../src/orchestration/self-healing-pipeline.js";

describe("Self-Healing Pipeline", () => {
  describe("classifyError", () => {
    it("classifies TypeScript type errors", () => {
      const result = classifyError("Type 'string' is not assignable to type 'number'");
      expect(result.category).toBe("type-error");
      expect(result.confidence).toBe(0.9);
      expect(result.suggestedFix).toContain("type mismatch");
    });

    it("classifies missing module errors", () => {
      const result = classifyError("Cannot find module './utils/helpers'");
      expect(result.category).toBe("import-error");
      expect(result.suggestedFix).toContain("not found");
    });

    it("classifies test assertion failures", () => {
      const result = classifyError("expected 42 to equal 43");
      expect(result.category).toBe("test-failure");
    });

    it("classifies rate limit errors", () => {
      const result = classifyError("429 Too Many Requests");
      expect(result.category).toBe("rate-limit");
    });

    it("classifies context overflow errors", () => {
      const result = classifyError("maximum context length exceeded");
      expect(result.category).toBe("context-overflow");
    });

    it("classifies syntax errors", () => {
      const result = classifyError("SyntaxError: Unexpected token '}'");
      expect(result.category).toBe("syntax-error");
    });

    it("classifies permission errors", () => {
      const result = classifyError("EACCES: permission denied, open '/etc/hosts'");
      expect(result.category).toBe("permission-denied");
    });

    it("classifies circular dependency errors", () => {
      const result = classifyError("circular dependency detected in module graph");
      expect(result.category).toBe("circular-dependency");
    });

    it("classifies provider errors", () => {
      const result = classifyError("500 Internal Server Error from API");
      expect(result.category).toBe("provider-error");
    });

    it("returns unknown for unrecognized errors", () => {
      const result = classifyError("some completely novel error");
      expect(result.category).toBe("unknown");
      expect(result.confidence).toBe(0.3);
    });

    it("extracts file and line from error text", () => {
      const result = classifyError("Type 'string' is not assignable to type 'number' at src/utils.ts:42");
      expect(result.file).toBe("src/utils.ts");
      expect(result.line).toBe(42);
    });
  });

  describe("detectErrorRepetition", () => {
    it("detects no repetition with fewer than 2 errors", () => {
      const result = detectErrorRepetition([
        { category: "type-error", message: "err", confidence: 0.9, relatedPatterns: [] },
      ]);
      expect(result.isRepeating).toBe(false);
    });

    it("detects repetition when same category appears 3+ times", () => {
      const errors = Array.from({ length: 3 }, () => ({
        category: "type-error" as const,
        message: "Type mismatch",
        confidence: 0.9,
        relatedPatterns: [] as readonly string[],
      }));
      const result = detectErrorRepetition(errors);
      expect(result.isRepeating).toBe(true);
      expect(result.repeatedCategory).toBe("type-error");
      expect(result.repeatCount).toBe(3);
    });

    it("does not flag repetition for mixed categories", () => {
      const errors = [
        { category: "type-error" as const, message: "a", confidence: 0.9, relatedPatterns: [] as readonly string[] },
        { category: "import-error" as const, message: "b", confidence: 0.9, relatedPatterns: [] as readonly string[] },
        { category: "syntax-error" as const, message: "c", confidence: 0.9, relatedPatterns: [] as readonly string[] },
      ];
      const result = detectErrorRepetition(errors);
      expect(result.isRepeating).toBe(false);
    });
  });

  describe("SelfHealingPipeline", () => {
    let pipeline: SelfHealingPipeline;

    beforeEach(() => {
      pipeline = new SelfHealingPipeline(5);
    });

    it("selects prompt-fix as default first recovery", async () => {
      const result = await pipeline.executeRecovery("Type 'string' is not assignable to type 'number'", {
        taskId: "t1",
        taskDescription: "Fix type errors",
        workingDir: "/tmp/test",
        provider: "anthropic",
        model: "claude-opus-4-6",
      });
      expect(result.strategy).toBe("prompt-fix");
      expect(result.success).toBe(true);
    });

    it("escalates to strategy-change after repeated errors", async () => {
      const ctx = {
        taskId: "t1",
        taskDescription: "Fix errors",
        workingDir: "/tmp/test",
        provider: "anthropic" as const,
        model: "claude-opus-4-6",
      };

      // Feed 3 same-category errors
      await pipeline.executeRecovery("Type 'string' is not assignable to type 'number'", ctx);
      await pipeline.executeRecovery("Type 'boolean' is not assignable to type 'number'", ctx);
      const result = await pipeline.executeRecovery("Type 'Date' is not assignable to type 'number'", ctx);

      expect(result.strategy).toBe("strategy-change");
    });

    it("runs the full pipeline with successful first attempt", async () => {
      const result = await pipeline.run(
        async (_prompt) => ({ success: true, output: "done", tokensUsed: 100 }),
        "Fix the bug",
        {
          taskId: "t1",
          workingDir: "/tmp/test",
          provider: "anthropic",
          model: "claude-opus-4-6",
        },
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.finalStrategy).toBe("direct");
    });

    it("gives up after max attempts", async () => {
      let attempt = 0;
      const result = await pipeline.run(
        async (_prompt) => {
          attempt++;
          return { success: false, output: "Type 'a' is not assignable to type 'b'", tokensUsed: 100 };
        },
        "Fix the bug",
        {
          taskId: "t1",
          workingDir: "/tmp/test",
          provider: "anthropic",
          model: "claude-opus-4-6",
        },
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(5);
    });

    it("tracks error and recovery history", async () => {
      await pipeline.executeRecovery("Type error", {
        taskId: "t1",
        taskDescription: "Fix stuff",
        workingDir: "/tmp/test",
        provider: "anthropic",
        model: "claude-opus-4-6",
      });

      expect(pipeline.getErrorHistory()).toHaveLength(1);
      expect(pipeline.getRecoveryHistory()).toHaveLength(1);
    });

    it("resets state cleanly", async () => {
      await pipeline.executeRecovery("Error", {
        taskId: "t1",
        taskDescription: "Fix",
        workingDir: "/tmp/test",
        provider: "anthropic",
        model: "claude-opus-4-6",
      });

      pipeline.reset();
      expect(pipeline.getErrorHistory()).toHaveLength(0);
      expect(pipeline.getRecoveryHistory()).toHaveLength(0);
    });
  });
});
