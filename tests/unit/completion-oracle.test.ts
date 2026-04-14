import { describe, it, expect } from "vitest";
import { evaluateCompletion, getDefaultCriteria } from "../../src/autopilot/completion-oracle.js";
import type { CompletionCriterion } from "../../src/autopilot/types.js";

describe("Completion Oracle", () => {
  const workingDir = process.cwd();

  describe("evaluateCompletion", () => {
    it("passes when all required criteria pass", async () => {
      const criteria: CompletionCriterion[] = [
        { type: "custom-command", weight: 1, required: true, description: "Always pass", config: { command: "echo 'ok'" } },
      ];

      const result = await evaluateCompletion("Test task", criteria, { workingDir, threshold: 0.5 });
      expect(result.completed).toBe(true);
      expect(result.score).toBe(1);
      expect(result.evidence).toHaveLength(1);
    });

    it("fails when a required criterion fails", async () => {
      const criteria: CompletionCriterion[] = [
        { type: "custom-command", weight: 1, required: true, description: "Always fail", config: { command: "exit 1" } },
      ];

      const result = await evaluateCompletion("Test task", criteria, { workingDir, threshold: 0.5 });
      expect(result.completed).toBe(false);
      expect(result.evidence[0]!.passed).toBe(false);
    });

    it("calculates weighted score correctly", async () => {
      const criteria: CompletionCriterion[] = [
        { type: "custom-command", weight: 3, required: false, description: "Pass", config: { command: "echo 'ok'" } },
        { type: "custom-command", weight: 1, required: false, description: "Fail", config: { command: "exit 1" } },
      ];

      const result = await evaluateCompletion("Test task", criteria, { workingDir, threshold: 0.5 });
      expect(result.score).toBeCloseTo(0.75, 1); // 3/4 weight passed
      expect(result.completed).toBe(true); // 0.75 >= 0.5 threshold
    });

    it("respects threshold", async () => {
      const criteria: CompletionCriterion[] = [
        { type: "custom-command", weight: 1, required: false, description: "Pass", config: { command: "echo 'ok'" } },
        { type: "custom-command", weight: 3, required: false, description: "Fail", config: { command: "exit 1" } },
      ];

      const result = await evaluateCompletion("Test task", criteria, { workingDir, threshold: 0.5 });
      expect(result.score).toBeCloseTo(0.25, 1); // 1/4 weight passed
      expect(result.completed).toBe(false); // 0.25 < 0.5 threshold
    });

    it("uses llm-judge callback when provided", async () => {
      const criteria: CompletionCriterion[] = [
        { type: "llm-judge", weight: 1, required: true, description: "LLM says yes" },
      ];

      const result = await evaluateCompletion("Test task", criteria, { workingDir, threshold: 0.5 }, {
        llmJudge: async () => ({ passed: true, reasoning: "Looks good" }),
      });

      expect(result.completed).toBe(true);
      expect(result.evidence[0]!.evidence).toContain("Looks good");
    });

    it("records duration for each criterion", async () => {
      const criteria: CompletionCriterion[] = [
        { type: "custom-command", weight: 1, required: false, description: "Quick", config: { command: "echo 'ok'" } },
      ];

      const result = await evaluateCompletion("Test task", criteria, { workingDir, threshold: 0.5 });
      expect(result.evidence[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getDefaultCriteria", () => {
    it("returns code criteria with typecheck and tests", () => {
      const criteria = getDefaultCriteria("code");
      const types = criteria.map((c) => c.type);
      expect(types).toContain("typecheck-pass");
      expect(types).toContain("tests-pass");
    });

    it("returns UI criteria with browser test", () => {
      const criteria = getDefaultCriteria("ui");
      const types = criteria.map((c) => c.type);
      expect(types).toContain("browser-test");
      expect(types).toContain("visual-match");
    });

    it("returns docs criteria with llm-judge", () => {
      const criteria = getDefaultCriteria("docs");
      const types = criteria.map((c) => c.type);
      expect(types).toContain("llm-judge");
    });

    it("returns test criteria with coverage", () => {
      const criteria = getDefaultCriteria("test");
      expect(criteria.length).toBeGreaterThan(2);
    });
  });
});
