import { describe, it, expect } from "vitest";
import { RedBlueTestRunner } from "../../src/orchestration/red-blue-testing.js";
import type { TaskExecutor } from "../../src/orchestration/red-blue-testing.js";

describe("RedBlueTestRunner", () => {
  const runner = new RedBlueTestRunner();

  function createMockExecutor(responses: string[]): TaskExecutor {
    let callIndex = 0;
    return {
      execute: async (_prompt: string): Promise<string> => {
        const response = responses[callIndex % responses.length];
        callIndex++;
        return response ?? "";
      },
    };
  }

  describe("runRedPhase", () => {
    it("generates an implementation from task description", async () => {
      const executor = createMockExecutor(["function auth() { return true; }"]);
      const result = await runner.runRedPhase("Implement authentication", executor);

      expect(result.task).toBe("Implement authentication");
      expect(result.implementation).toContain("function auth");
      expect(result.executedAt).toBeGreaterThan(0);
    });

    it("extracts file names from implementation comments", async () => {
      const executor = createMockExecutor(["// file: src/auth.ts\nfunction auth() {}"]);
      const result = await runner.runRedPhase("Implement auth", executor);

      expect(result.filesChanged).toContain("src/auth.ts");
    });
  });

  describe("runBluePhase", () => {
    it("returns findings from blue agent analysis", async () => {
      const blueResponse = JSON.stringify({
        findings: [
          {
            category: "security",
            severity: "high",
            title: "No input validation",
            description: "User input is not validated",
            suggestedFix: "Add zod validation",
          },
        ],
        verdict: "fail",
      });

      const executor = createMockExecutor([blueResponse]);
      const redResult = {
        task: "Auth",
        implementation: "function auth(input) { return input; }",
        filesChanged: [] as readonly string[],
        executedAt: Date.now(),
      };

      const result = await runner.runBluePhase(redResult, executor);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.category).toBe("security");
      expect(result.overallVerdict).toBe("fail");
    });

    it("handles non-JSON response gracefully", async () => {
      const executor = createMockExecutor(["This is not JSON"]);
      const redResult = {
        task: "Auth",
        implementation: "code",
        filesChanged: [] as readonly string[],
        executedAt: Date.now(),
      };

      const result = await runner.runBluePhase(redResult, executor);
      expect(result.findings).toHaveLength(0);
      expect(result.overallVerdict).toBe("pass");
    });
  });

  describe("runAdversarialLoop", () => {
    it("completes when blue gives a pass verdict", async () => {
      const responses = [
        "function auth() { /* implementation */ }",
        JSON.stringify({ findings: [], verdict: "pass" }),
      ];
      const executor = createMockExecutor(responses);

      const result = await runner.runAdversarialLoop("Implement auth", executor, 3);
      expect(result.finalVerdict).toBe("pass");
      expect(result.totalRounds).toBe(1);
      expect(result.unresolvedCount).toBe(0);
    });

    it("runs multiple rounds when findings exist", async () => {
      let callCount = 0;
      const executor: TaskExecutor = {
        execute: async (): Promise<string> => {
          callCount++;
          // Odd calls = red (implementation), even calls = blue (review)
          if (callCount % 2 === 1) {
            return "function auth() { return true; }";
          }
          // First blue review finds issues, second passes
          if (callCount <= 3) {
            return JSON.stringify({
              findings: [{ category: "bug", severity: "high", title: "Issue", description: "desc" }],
              verdict: "fail",
            });
          }
          return JSON.stringify({ findings: [], verdict: "pass" });
        },
      };

      const result = await runner.runAdversarialLoop("Auth", executor, 5);
      expect(result.totalRounds).toBeGreaterThanOrEqual(1);
      expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    });

    it("respects maxRounds limit", async () => {
      const failResponse = JSON.stringify({
        findings: [{ category: "bug", severity: "medium", title: "Still broken", description: "desc" }],
        verdict: "needs-improvement",
      });
      const executor = createMockExecutor(["impl code", failResponse]);

      const result = await runner.runAdversarialLoop("Hard task", executor, 2);
      expect(result.totalRounds).toBe(2);
      expect(result.finalVerdict).toBe("max-rounds-reached");
    });

    it("tracks all findings across rounds", async () => {
      const executor = createMockExecutor([
        "impl",
        JSON.stringify({
          findings: [
            { category: "security", severity: "critical", title: "XSS", description: "xss vuln" },
          ],
          verdict: "fail",
        }),
      ]);

      const result = await runner.runAdversarialLoop("Build form", executor, 1);
      expect(result.allFindings.length).toBeGreaterThanOrEqual(1);
    });
  });
});
