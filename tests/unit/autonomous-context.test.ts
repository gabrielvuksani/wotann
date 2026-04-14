import { describe, it, expect, beforeEach } from "vitest";
import { AutonomousContextManager, estimateCycleTokens } from "../../src/orchestration/autonomous-context.js";

describe("Autonomous Context Intelligence", () => {
  let manager: AutonomousContextManager;

  beforeEach(() => {
    manager = new AutonomousContextManager(200_000);
  });

  describe("estimateCycleTokens", () => {
    it("estimates tokens for a plan with tool calls", () => {
      const estimate = estimateCycleTokens("Fix type errors in auth module", ["Read", "Edit", "Bash"]);
      expect(estimate.estimatedTokens).toBeGreaterThan(0);
      expect(estimate.toolCalls).toBe(3);
    });

    it("flags large cycles for splitting", () => {
      const tools = Array(20).fill("Read").concat(Array(10).fill("Bash"));
      const estimate = estimateCycleTokens("Huge refactor", tools);
      expect(estimate.recommendation).toContain("Split");
    });
  });

  describe("budget state", () => {
    it("starts at green pressure", () => {
      const state = manager.getBudgetState();
      expect(state.pressure).toBe("green");
      expect(state.recommendation).toBe("proceed-normally");
    });

    it("reports yellow at 65% usage", () => {
      manager.updateUsage(130_000);
      const state = manager.getBudgetState();
      expect(state.pressure).toBe("yellow");
    });

    it("reports red at 88% usage", () => {
      manager.updateUsage(176_000);
      const state = manager.getBudgetState();
      expect(state.pressure).toBe("red");
    });

    it("reports critical at 95% usage", () => {
      manager.updateUsage(190_000);
      const state = manager.getBudgetState();
      expect(state.pressure).toBe("critical");
      expect(state.recommendation).toBe("halt-and-compact");
    });

    it("estimates remaining cycles based on history", () => {
      manager.recordCycle(10_000, 5);
      manager.recordCycle(12_000, 6);
      manager.updateUsage(100_000);

      const state = manager.getBudgetState();
      // Average ~11K per cycle, 100K remaining → ~9 cycles
      expect(state.estimatedCyclesRemaining).toBeGreaterThan(5);
    });
  });

  describe("shouldProceed", () => {
    it("allows cycles in green zone", () => {
      const result = manager.shouldProceed({
        estimatedTokens: 10_000,
        toolCalls: 3,
        confidence: 0.7,
        willExceedBudget: false,
        recommendation: "Proceed",
      });
      expect(result.proceed).toBe(true);
    });

    it("blocks cycles in critical zone", () => {
      manager.updateUsage(192_000);
      const result = manager.shouldProceed({
        estimatedTokens: 5_000,
        toolCalls: 1,
        confidence: 0.7,
        willExceedBudget: false,
        recommendation: "Proceed",
      });
      expect(result.proceed).toBe(false);
      expect(result.reason).toContain("critical");
    });

    it("blocks cycles that would exceed budget", () => {
      manager.updateUsage(190_000);
      const result = manager.shouldProceed({
        estimatedTokens: 50_000,
        toolCalls: 10,
        confidence: 0.7,
        willExceedBudget: true,
        recommendation: "Split",
      });
      expect(result.proceed).toBe(false);
    });
  });

  describe("wave execution", () => {
    it("plans waves from phases", () => {
      const waves = manager.planWaves([
        { phase: "1", description: "Read and understand", files: ["src/auth.ts"], dependencies: [] },
        { phase: "2", description: "Implement fix", files: ["src/auth.ts"], dependencies: ["1"] },
        { phase: "3", description: "Test", files: ["tests/auth.test.ts"], dependencies: ["2"] },
      ]);

      expect(waves).toHaveLength(3);
      expect(waves[0]?.phase).toBe("1");
    });

    it("advances through waves", () => {
      manager.planWaves([
        { phase: "1", description: "Phase 1", files: [], dependencies: [] },
        { phase: "2", description: "Phase 2", files: [], dependencies: [] },
      ]);

      expect(manager.getNextWave()?.phase).toBe("1");
      manager.advanceWave();
      expect(manager.getNextWave()?.phase).toBe("2");
      manager.advanceWave();
      expect(manager.getNextWave()).toBeNull();
    });
  });

  describe("adaptive prompts", () => {
    it("adds no warnings in green zone", () => {
      const prompt = manager.buildAdaptivePrompt("Fix the bug");
      expect(prompt).toBe("Fix the bug");
    });

    it("adds conciseness warning in yellow zone", () => {
      manager.updateUsage(135_000);
      const prompt = manager.buildAdaptivePrompt("Fix the bug");
      expect(prompt).toContain("65% capacity");
      expect(prompt).toContain("concise");
    });

    it("adds strong warnings in orange zone", () => {
      manager.updateUsage(160_000);
      const prompt = manager.buildAdaptivePrompt("Fix the bug");
      expect(prompt).toContain("78% capacity");
      expect(prompt).toContain("Minimize tool calls");
    });

    it("adds critical warnings in red zone", () => {
      manager.updateUsage(178_000);
      const prompt = manager.buildAdaptivePrompt("Fix the bug");
      expect(prompt).toContain("CRITICAL");
      expect(prompt).toContain("88% capacity");
    });
  });

  describe("compaction directives", () => {
    it("returns null in green zone", () => {
      expect(manager.getCompactionDirective()).toBeNull();
    });

    it("returns pre-cycle compact in red zone", () => {
      manager.updateUsage(178_000);
      const directive = manager.getCompactionDirective();
      expect(directive).toContain("COMPACTION");
    });

    it("returns emergency compact at critical", () => {
      manager.updateUsage(192_000);
      const directive = manager.getCompactionDirective();
      expect(directive).toContain("COMPACTION REQUIRED");
    });
  });

  describe("budget adjustment", () => {
    it("adjusts budget for provider switching", () => {
      manager.adjustBudget(1_000_000); // Switching to 1M model
      manager.updateUsage(100_000);
      const state = manager.getBudgetState();
      expect(state.pressure).toBe("green"); // 100K/1M = 10%
    });
  });
});
