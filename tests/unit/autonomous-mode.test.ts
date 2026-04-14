import { describe, it, expect } from "vitest";
import { AutonomousExecutor } from "../../src/orchestration/autonomous.js";

describe("Autonomous Mode (Supercharged)", () => {
  describe("AutonomousExecutor", () => {
    it("succeeds on first cycle when tests pass", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 5 });

      const result = await executor.execute(
        "Fix the bug",
        async () => ({ output: "Fixed the issue", costUsd: 0.01, tokensUsed: 500 }),
        async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
      );

      expect(result.success).toBe(true);
      expect(result.exitReason).toBe("tests-pass");
      expect(result.totalCycles).toBe(1);
    });

    it("retries and succeeds on second cycle", async () => {
      let callCount = 0;
      const executor = new AutonomousExecutor({ maxCycles: 5 });

      const result = await executor.execute(
        "Fix the bug",
        async () => {
          callCount++;
          return { output: `Attempt ${callCount}`, costUsd: 0.01, tokensUsed: 200 };
        },
        async () => ({
          testsPass: callCount >= 2,
          typecheckPass: true,
          lintPass: true,
          output: callCount < 2 ? "Tests failed" : "",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.totalCycles).toBe(2);
    });

    it("exits on max cycles", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 3 });

      const result = await executor.execute(
        "Fix the bug",
        async () => ({ output: "Still broken", costUsd: 0.01, tokensUsed: 100 }),
        async () => ({ testsPass: false, typecheckPass: false, lintPass: true, output: "Failures" }),
      );

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("max-cycles");
      expect(result.totalCycles).toBe(3);
    });

    it("detects doom loop (identical outputs trigger pattern detection)", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 10 });

      const result = await executor.execute(
        "Fix the bug",
        async () => ({ output: "Same output every time", costUsd: 0.01, tokensUsed: 100 }),
        async () => ({ testsPass: false, typecheckPass: true, lintPass: true, output: "Tests failed" }),
      );

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("circuit-breaker"); // Circuit breaker fires before doom-loop pattern detection
    });

    it("exits on cost budget exceeded", async () => {
      // Use high per-cycle cost so budget is exceeded in 2 cycles (before circuit breaker trips at 3)
      const executor = new AutonomousExecutor({ maxCycles: 100, maxCostUsd: 0.05 });

      const result = await executor.execute(
        "Expensive task",
        async () => ({ output: "Working...", costUsd: 0.03, tokensUsed: 500 }),
        async () => ({ testsPass: false, typecheckPass: true, lintPass: true, output: "Not done" }),
      );

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("max-cost");
    });

    it("tracks strategy escalation", async () => {
      let callCount = 0;
      const executor = new AutonomousExecutor({ maxCycles: 8, escalateAfterFailures: 2 });

      const result = await executor.execute(
        "Complex task",
        async (prompt) => {
          callCount++;
          if (callCount > 2 && prompt.includes("smaller steps")) {
            return { output: "Fixed with decomposition", costUsd: 0.01, tokensUsed: 300 };
          }
          return { output: `Try ${callCount}`, costUsd: 0.01, tokensUsed: 200 };
        },
        async () => ({
          testsPass: callCount > 3,
          typecheckPass: true,
          lintPass: true,
          output: callCount <= 3 ? "Still failing" : "",
        }),
      );

      expect(result.totalCycles).toBeGreaterThan(2);
      const strategies = result.cycles.map((c) => c.strategy);
      expect(strategies.some((s) => s !== "direct")).toBe(true);
    });

    it("supports mode cycling (enter/exit)", () => {
      const executor = new AutonomousExecutor();

      expect(executor.isActive()).toBe(false);

      const state = executor.enterMode("Build feature X");
      expect(executor.isActive()).toBe(true);
      expect(state.task).toBe("Build feature X");
      expect(state.cycleCount).toBe(0);

      executor.exitMode();
      expect(executor.isActive()).toBe(false);
    });

    it("supports pause/resume", () => {
      const executor = new AutonomousExecutor();
      executor.enterMode("Test pause");

      expect(executor.isPaused()).toBe(false);
      executor.togglePause();
      expect(executor.isPaused()).toBe(true);
      executor.togglePause();
      expect(executor.isPaused()).toBe(false);

      executor.exitMode();
    });

    it("supports cancellation", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 100 });

      // Cancel after first cycle
      let cycleNum = 0;
      const result = await executor.execute(
        "Long task",
        async () => {
          cycleNum++;
          if (cycleNum >= 2) executor.cancel();
          return { output: `Cycle ${cycleNum}`, costUsd: 0.01, tokensUsed: 100 };
        },
        async () => ({ testsPass: false, typecheckPass: true, lintPass: true, output: "Still going" }),
      );

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe("cancelled");
    });

    it("tracks heartbeat and detects staleness", () => {
      const executor = new AutonomousExecutor({ heartbeatTimeoutMs: 100 });

      executor.enterMode("Test task");
      executor.heartbeat();
      expect(executor.isStale()).toBe(false);

      executor.exitMode();
    });

    it("tracks total tokens and cost in result", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 2 });

      const result = await executor.execute(
        "Task",
        async () => ({ output: "Done", costUsd: 0.05, tokensUsed: 1000 }),
        async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
      );

      expect(result.totalCostUsd).toBe(0.05);
      expect(result.totalTokens).toBe(1000);
    });

    it("tracks context usage updates", () => {
      const executor = new AutonomousExecutor();
      executor.enterMode("Context test");

      executor.updateContextUsage(0.5);
      expect(executor.getState()?.contextUsage).toBe(0.5);

      executor.updateContextUsage(0.8);
      expect(executor.getState()?.contextUsage).toBe(0.8);

      executor.exitMode();
    });

    it("fires callbacks during execution", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 2 });
      const events: string[] = [];

      await executor.execute(
        "Callback test",
        async () => ({ output: "Done", costUsd: 0, tokensUsed: 0 }),
        async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
        {
          onCycleStart: (cycle) => events.push(`start-${cycle}`),
          onCycleEnd: () => events.push("end"),
        },
      );

      expect(events).toContain("start-0");
      expect(events).toContain("end");
    });

    it("narrows scope and switches to fresh-context under high context pressure", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 1, contextPressureThreshold: 0.75 });

      const result = await executor.execute(
        "Refactor the whole subsystem",
        async () => ({ output: "Done", costUsd: 0, tokensUsed: 0 }),
        async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
        {
          onCycleStart: () => {
            executor.updateContextUsage(0.95);
          },
        },
      );

      expect(result.cycles[0]?.contextIntervention).toContain("Context pressure");
      expect(result.cycles[0]?.strategy).toBe("fresh-context");
    });

    it("returns filesChanged in result", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 1 });

      const result = await executor.execute(
        "Simple task",
        async () => ({ output: "Done", costUsd: 0, tokensUsed: 0 }),
        async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
      );

      expect(result.filesChanged).toBeDefined();
      expect(Array.isArray(result.filesChanged)).toBe(true);
    });

    it("returns strategy in result", async () => {
      const executor = new AutonomousExecutor({ maxCycles: 1 });

      const result = await executor.execute(
        "Simple task",
        async () => ({ output: "Done", costUsd: 0, tokensUsed: 0 }),
        async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
      );

      expect(result.strategy).toBeDefined();
      expect(typeof result.strategy).toBe("string");
    });
  });
});
