import { describe, it, expect } from "vitest";
import { runRalphMode, type RalphConfig } from "../../src/orchestration/ralph-mode.js";

describe("Ralph Mode (§22) — Persistent Verify-Fix Loop", () => {
  const config: RalphConfig = {
    maxCycles: 5,
    command: "npm test",
    description: "Run tests until they pass",
  };

  it("succeeds on first try when verifier passes", async () => {
    const result = await runRalphMode(
      config,
      async () => ({ success: true, output: "All tests pass" }),
      async () => "no fix needed",
    );
    expect(result.success).toBe(true);
    expect(result.cycles).toBe(1);
    expect(result.fixesApplied.length).toBe(0);
  });

  it("applies fix and retries on failure", async () => {
    let attempt = 0;
    const result = await runRalphMode(
      config,
      async () => {
        attempt++;
        return attempt >= 3
          ? { success: true, output: "pass" }
          : { success: false, output: "test failed" };
      },
      async (error) => `Fixed: ${error}`,
    );
    expect(result.success).toBe(true);
    expect(result.cycles).toBe(3);
    expect(result.fixesApplied.length).toBe(2); // fixed twice before passing
  });

  it("returns failure when max cycles reached", async () => {
    const result = await runRalphMode(
      { maxCycles: 3, command: "test", description: "test" },
      async () => ({ success: false, output: "still failing" }),
      async () => "attempted fix",
    );
    expect(result.success).toBe(false);
    expect(result.cycles).toBe(3);
    expect(result.lastError).toContain("Max cycles");
    expect(result.fixesApplied.length).toBe(3);
  });

  it("records all fixes applied", async () => {
    let attempt = 0;
    const result = await runRalphMode(
      config,
      async () => {
        attempt++;
        return attempt > 2
          ? { success: true, output: "pass" }
          : { success: false, output: `error-${attempt}` };
      },
      async (error) => `fix-for-${error}`,
    );
    expect(result.fixesApplied).toEqual(["fix-for-error-1", "fix-for-error-2"]);
  });

  it("handles single-cycle config", async () => {
    const result = await runRalphMode(
      { maxCycles: 1, command: "test", description: "test" },
      async () => ({ success: false, output: "fail" }),
      async () => "fix",
    );
    expect(result.success).toBe(false);
    expect(result.cycles).toBe(1);
  });

  it("records HUD metrics", async () => {
    const result = await runRalphMode(
      { maxCycles: 2, command: "test", description: "test" },
      async () => ({ success: true, output: "pass" }),
      async () => "fix",
    );

    expect(result.hud.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.cycleMetrics).toHaveLength(1);
  });

  it("aborts when the time budget is exhausted", async () => {
    const result = await runRalphMode(
      { maxCycles: 5, command: "test", description: "test", maxDurationMs: 0 },
      async () => ({ success: false, output: "fail" }),
      async () => "fix",
    );

    expect(result.success).toBe(false);
    expect(result.abortedReason).toBe("time-budget");
  });

  it("escalates strategy on repeated failures", async () => {
    let lastFixInput = "";
    const result = await runRalphMode(
      { maxCycles: 2, command: "npm test", description: "Fix suite", strategyEscalationThreshold: 1 },
      async () => ({ success: false, output: "same failure" }),
      async (error) => {
        lastFixInput = error;
        return "fix";
      },
    );

    expect(result.escalated).toBe(true);
    expect(lastFixInput).toContain("[RALPH ESCALATION]");
  });
});
