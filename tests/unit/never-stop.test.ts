import { describe, it, expect, vi } from "vitest";
import {
  NeverStopExecutor,
} from "../../src/autopilot/never-stop.js";
import type {
  ExecutionCallbacks,
  ExecutionOutput,
  VerificationOutput,
} from "../../src/autopilot/never-stop.js";

describe("NeverStopExecutor", () => {
  const successExec = async (): Promise<ExecutionOutput> => ({
    output: "Done",
    costUsd: 0.01,
    tokensUsed: 500,
    filesChanged: ["src/foo.ts"],
  });

  const failExec = async (): Promise<ExecutionOutput> => ({
    output: "Partial",
    costUsd: 0.01,
    tokensUsed: 500,
    filesChanged: [],
  });

  const passVerify = async (): Promise<VerificationOutput> => ({
    score: 1.0,
    passed: true,
    evidence: [
      { criterion: { type: "tests-pass", weight: 4, required: true, description: "Tests" }, passed: true, evidence: "All pass", durationMs: 100 },
    ],
  });

  const failVerify = async (): Promise<VerificationOutput> => ({
    score: 0.2,
    passed: false,
    evidence: [
      { criterion: { type: "tests-pass", weight: 4, required: true, description: "Tests" }, passed: false, evidence: "2 failures", durationMs: 100 },
    ],
  });

  describe("execute", () => {
    it("succeeds on first cycle if verification passes", async () => {
      const executor = new NeverStopExecutor({ maxCycles: 5 });
      const result = await executor.execute("Fix the bug", {
        execute: successExec,
        verify: passVerify,
      });

      expect(result.success).toBe(true);
      expect(result.exitReason).toBe("verified");
      expect(result.totalCycles).toBe(1);
      expect(result.totalCostUsd).toBe(0.01);
      expect(result.filesChanged).toContain("src/foo.ts");
    });

    it("retries when verification fails", async () => {
      let attempt = 0;
      const executor = new NeverStopExecutor({ maxCycles: 5, enableSelfTroubleshoot: false });

      const result = await executor.execute("Fix the bug", {
        execute: failExec,
        verify: async () => {
          attempt++;
          return attempt >= 3 ? passVerify() : failVerify();
        },
      });

      expect(result.success).toBe(true);
      expect(result.totalCycles).toBe(3);
    });

    it("stops at max cycles", async () => {
      let callCount = 0;
      const executor = new NeverStopExecutor({
        maxCycles: 3,
        enableSelfTroubleshoot: false,
        maxConsecutiveIdenticalErrors: 10, // High threshold to avoid doom-loop
      });

      const result = await executor.execute("Fix the bug", {
        execute: failExec,
        verify: async () => ({
          score: 0.2,
          passed: false,
          evidence: [
            {
              criterion: { type: "tests-pass", weight: 4, required: true, description: "Tests" },
              passed: false,
              evidence: `Unique failure ${callCount++}`,
              durationMs: 100,
            },
          ],
        }),
      });

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("max-cycles");
      expect(result.totalCycles).toBe(3);
    });

    it("stops at max cost", async () => {
      const executor = new NeverStopExecutor({ maxCostUsd: 0.02, maxCycles: 100, enableSelfTroubleshoot: false });

      const result = await executor.execute("Expensive task", {
        execute: async () => ({
          output: "work",
          costUsd: 0.015,
          tokensUsed: 1000,
          filesChanged: [],
        }),
        verify: failVerify,
      });

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("max-cost");
    });

    it("stops at max time", async () => {
      const executor = new NeverStopExecutor({ maxTimeMs: 1, maxCycles: 100, enableSelfTroubleshoot: false });

      // Introduce a small delay to let time expire
      const result = await executor.execute("Slow task", {
        execute: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return failExec();
        },
        verify: failVerify,
      });

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("max-time");
    });

    it("detects doom loop with identical errors", async () => {
      const executor = new NeverStopExecutor({
        maxCycles: 10,
        maxConsecutiveIdenticalErrors: 3,
        enableSelfTroubleshoot: false,
      });

      const result = await executor.execute("Stuck task", {
        execute: failExec,
        verify: async () => ({
          score: 0,
          passed: false,
          evidence: [
            { criterion: { type: "tests-pass", weight: 1, required: true, description: "Tests" }, passed: false, evidence: "Same error every time", durationMs: 10 },
          ],
        }),
      });

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("doom-loop");
    });

    it("supports cancellation", async () => {
      const executor = new NeverStopExecutor({ maxCycles: 100, enableSelfTroubleshoot: false });

      // Cancel after first cycle
      let cycleCount = 0;
      const result = await executor.execute("Cancel me", {
        execute: async () => {
          cycleCount++;
          if (cycleCount >= 1) executor.cancel();
          return failExec();
        },
        verify: failVerify,
      });

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("cancelled");
    });

    it("calls onCycleStart and onCycleEnd callbacks", async () => {
      const executor = new NeverStopExecutor({ maxCycles: 2, enableSelfTroubleshoot: false });
      const starts: number[] = [];
      const ends: number[] = [];

      await executor.execute("Callback test", {
        execute: successExec,
        verify: passVerify,
        onCycleStart: (cycle) => starts.push(cycle),
        onCycleEnd: (result) => ends.push(result.cycle),
      });

      expect(starts).toEqual([0]);
      expect(ends).toEqual([0]);
    });

    it("calls onComplete callback on success", async () => {
      const executor = new NeverStopExecutor({ maxCycles: 5 });
      const onComplete = vi.fn();

      await executor.execute("Complete test", {
        execute: successExec,
        verify: passVerify,
        onComplete,
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0]![0].success).toBe(true);
    });

    it("uses error analysis for self-troubleshooting", async () => {
      let attempt = 0;
      const executor = new NeverStopExecutor({ maxCycles: 5, enableSelfTroubleshoot: true });

      const result = await executor.execute("Self-fix task", {
        execute: async () => {
          attempt++;
          return attempt >= 2 ? successExec() : failExec();
        },
        verify: async () => {
          return attempt >= 2 ? passVerify() : failVerify();
        },
        analyzeError: async (error) => `Fix for: ${error}`,
      });

      expect(result.success).toBe(true);
    });

    it("handles execution errors gracefully", async () => {
      let attempt = 0;
      const executor = new NeverStopExecutor({ maxCycles: 3, enableSelfTroubleshoot: false });

      const result = await executor.execute("Error task", {
        execute: async () => {
          attempt++;
          if (attempt === 1) throw new Error("Connection refused");
          return successExec();
        },
        verify: async () => (attempt >= 2 ? passVerify() : failVerify()),
      });

      expect(result.success).toBe(true);
      expect(result.totalCycles).toBe(2);
    });
  });

  describe("getConfig", () => {
    it("returns default config", () => {
      const executor = new NeverStopExecutor();
      const config = executor.getConfig();
      expect(config.maxCycles).toBe(30);
      expect(config.completionThreshold).toBe(0.8);
    });

    it("respects custom config", () => {
      const executor = new NeverStopExecutor({ maxCycles: 10, completionThreshold: 0.9 });
      const config = executor.getConfig();
      expect(config.maxCycles).toBe(10);
      expect(config.completionThreshold).toBe(0.9);
    });
  });
});
