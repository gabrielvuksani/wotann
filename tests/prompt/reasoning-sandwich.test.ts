/**
 * Tests for the turn-counter ReasoningSandwich scheduler.
 * DISTINCT from tests/unit/reasoning-sandwich.test.ts which tests the
 * phase-detection middleware at src/middleware/reasoning-sandwich.ts.
 */
import { describe, it, expect } from "vitest";
import {
  ReasoningSandwich,
  DEFAULT_SANDWICH_CONFIG,
  isProviderBudgetSupported,
} from "../../src/prompt/reasoning-sandwich.js";

describe("ReasoningSandwich (turn-counter scheduler)", () => {
  describe("nextBudget — basic sandwich rule", () => {
    it("first turn returns HIGH", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 5);
      const budget = rs.nextBudget("t1", "anthropic");
      expect(budget.level).toBe("high");
      expect(budget.tokens).toBe(DEFAULT_SANDWICH_CONFIG.high.tokens);
      expect(budget.effort).toBe("high");
    });

    it("second turn returns LOW", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 5);
      rs.nextBudget("t1", "anthropic"); // turn 0: high
      const budget = rs.nextBudget("t1", "anthropic"); // turn 1: low
      expect(budget.level).toBe("low");
      expect(budget.tokens).toBe(DEFAULT_SANDWICH_CONFIG.low.tokens);
      expect(budget.effort).toBe("low");
    });

    it("N-th middle turn keeps returning LOW until the last", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 6);
      const levels: string[] = [];
      for (let i = 0; i < 6; i++) {
        levels.push(rs.nextBudget("t1", "anthropic").level);
      }
      // 6-turn sandwich: high, low, low, low, low, high
      expect(levels).toEqual(["high", "low", "low", "low", "low", "high"]);
    });

    it("last turn returns HIGH", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 3);
      rs.nextBudget("t1", "anthropic"); // 0 high
      rs.nextBudget("t1", "anthropic"); // 1 low
      const last = rs.nextBudget("t1", "anthropic"); // 2 high
      expect(last.level).toBe("high");
    });

    it("two-turn task yields high,high (both first and last)", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 2);
      expect(rs.nextBudget("t1", "anthropic").level).toBe("high");
      expect(rs.nextBudget("t1", "anthropic").level).toBe("high");
    });

    it("single-turn task is always HIGH (first IS last)", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 1);
      expect(rs.nextBudget("t1", "anthropic").level).toBe("high");
    });
  });

  describe("turn counter advancement", () => {
    it("inspect reflects turn index after each call", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 4);
      expect(rs.inspect("t1")?.turnIdx).toBe(0);
      rs.nextBudget("t1", "anthropic");
      expect(rs.inspect("t1")?.turnIdx).toBe(1);
      rs.nextBudget("t1", "anthropic");
      expect(rs.inspect("t1")?.turnIdx).toBe(2);
    });

    it("inspect returns null for unknown task", () => {
      const rs = new ReasoningSandwich();
      expect(rs.inspect("never-started")).toBeNull();
    });
  });

  describe("finalize override", () => {
    it("finalize forces next call to HIGH even in the middle", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 10);
      rs.nextBudget("t1", "anthropic"); // turn 0: high
      rs.nextBudget("t1", "anthropic"); // turn 1: low
      rs.finalize("t1");
      const budget = rs.nextBudget("t1", "anthropic"); // turn 2: would be low, but finalize → high
      expect(budget.level).toBe("high");
    });

    it("finalize consumes the flag — the turn AFTER goes back to normal", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 10);
      rs.nextBudget("t1", "anthropic"); // 0 high
      rs.finalize("t1");
      const forced = rs.nextBudget("t1", "anthropic"); // 1: forced high
      const afterForce = rs.nextBudget("t1", "anthropic"); // 2: normal → low
      expect(forced.level).toBe("high");
      expect(afterForce.level).toBe("low");
    });

    it("finalize on unknown task is a silent no-op (does not throw)", () => {
      const rs = new ReasoningSandwich();
      expect(() => rs.finalize("never-started")).not.toThrow();
    });
  });

  describe("per-session state isolation (QB #7)", () => {
    it("different tasks do not interfere", () => {
      const rs = new ReasoningSandwich();
      rs.start("alpha", 4);
      rs.start("beta", 4);

      rs.nextBudget("alpha", "anthropic"); // alpha turn 0 (high)
      rs.nextBudget("alpha", "anthropic"); // alpha turn 1 (low)
      rs.nextBudget("alpha", "anthropic"); // alpha turn 2 (low)

      // Beta should still be on its first turn → HIGH
      const betaFirst = rs.nextBudget("beta", "anthropic");
      expect(betaFirst.level).toBe("high");
      expect(rs.inspect("beta")?.turnIdx).toBe(1);
      expect(rs.inspect("alpha")?.turnIdx).toBe(3);
    });

    it("end() removes one task without affecting another", () => {
      const rs = new ReasoningSandwich();
      rs.start("alpha", 3);
      rs.start("beta", 3);
      rs.end("alpha");
      expect(rs.inspect("alpha")).toBeNull();
      expect(rs.inspect("beta")).not.toBeNull();
      expect(rs.activeTaskCount()).toBe(1);
    });

    it("end() on unknown task is a no-op", () => {
      const rs = new ReasoningSandwich();
      expect(() => rs.end("never-started")).not.toThrow();
    });
  });

  describe("config override", () => {
    it("custom high/low token budgets are respected", () => {
      const rs = new ReasoningSandwich({
        high: { tokens: 20_000, effort: "high" },
        low: { tokens: 500, effort: "low" },
      });
      rs.start("t1", 3);
      const first = rs.nextBudget("t1", "anthropic");
      const mid = rs.nextBudget("t1", "anthropic");
      expect(first.tokens).toBe(20_000);
      expect(mid.tokens).toBe(500);
    });

    it("partial config merges with defaults (low stays default when only high overridden)", () => {
      const rs = new ReasoningSandwich({ high: { tokens: 12_000, effort: "high" } });
      rs.start("t1", 3);
      const first = rs.nextBudget("t1", "anthropic");
      const mid = rs.nextBudget("t1", "anthropic");
      expect(first.tokens).toBe(12_000);
      expect(mid.tokens).toBe(DEFAULT_SANDWICH_CONFIG.low.tokens);
    });
  });

  describe("honest failure — provider support (QB #6)", () => {
    it("supported=true for providers with native reasoning budget", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 3);
      const anthropic = rs.nextBudget("t1", "anthropic");
      expect(anthropic.supported).toBe(true);
      expect(anthropic.warning).toBeNull();
    });

    it("supported=false for providers without native reasoning budget", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 3);
      const groq = rs.nextBudget("t1", "groq");
      expect(groq.supported).toBe(false);
      expect(groq.warning).toContain("advisory");
    });

    it("supported=false when provider is omitted entirely", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 3);
      const budget = rs.nextBudget("t1");
      expect(budget.supported).toBe(false);
      expect(budget.warning).toContain("advisory");
    });

    it("isProviderBudgetSupported is pure + exported for callers", () => {
      expect(isProviderBudgetSupported("anthropic")).toBe(true);
      expect(isProviderBudgetSupported("openai")).toBe(true);
      expect(isProviderBudgetSupported("gemini")).toBe(true);
      expect(isProviderBudgetSupported("ollama")).toBe(true);
      expect(isProviderBudgetSupported("groq")).toBe(false);
      expect(isProviderBudgetSupported("copilot")).toBe(false);
      expect(isProviderBudgetSupported(undefined)).toBe(false);
    });
  });

  describe("budget exhaustion (QB #6 honest)", () => {
    it("continuing past totalBudget emits a warning but keeps returning", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 2);
      rs.nextBudget("t1", "anthropic"); // turn 0
      rs.nextBudget("t1", "anthropic"); // turn 1 (last)
      const overrun = rs.nextBudget("t1", "anthropic"); // past end
      expect(overrun.warning).toMatch(/exhausted/);
      expect(overrun.level).toBe("low");
    });

    it("exhausted flag sticks across subsequent calls", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 1);
      rs.nextBudget("t1", "anthropic"); // consumes the single turn
      const over1 = rs.nextBudget("t1", "anthropic");
      const over2 = rs.nextBudget("t1", "anthropic");
      expect(over1.warning).toMatch(/exhausted/);
      expect(over2.warning).toMatch(/exhausted/);
    });
  });

  describe("unknown task safety", () => {
    it("nextBudget on unknown taskId returns safe default + warning (does not throw)", () => {
      const rs = new ReasoningSandwich();
      const budget = rs.nextBudget("never-started", "anthropic");
      expect(budget.level).toBe("low");
      expect(budget.warning).toContain("not started");
    });
  });

  describe("validation", () => {
    it("start throws when taskId is empty", () => {
      const rs = new ReasoningSandwich();
      expect(() => rs.start("", 3)).toThrow(/taskId/);
    });

    it("start throws when totalBudget is less than 1", () => {
      const rs = new ReasoningSandwich();
      expect(() => rs.start("t1", 0)).toThrow(/totalBudget/);
      expect(() => rs.start("t1", -1)).toThrow(/totalBudget/);
    });

    it("start throws when totalBudget is not finite", () => {
      const rs = new ReasoningSandwich();
      expect(() => rs.start("t1", Number.NaN)).toThrow(/totalBudget/);
      expect(() => rs.start("t1", Number.POSITIVE_INFINITY)).toThrow(/totalBudget/);
    });

    it("re-starting an existing taskId resets its state", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 3);
      rs.nextBudget("t1", "anthropic");
      rs.nextBudget("t1", "anthropic");
      rs.start("t1", 5); // reset
      expect(rs.inspect("t1")?.turnIdx).toBe(0);
      expect(rs.inspect("t1")?.totalBudget).toBe(5);
      expect(rs.nextBudget("t1", "anthropic").level).toBe("high");
    });

    it("fractional totalBudget is floored", () => {
      const rs = new ReasoningSandwich();
      rs.start("t1", 3.9);
      expect(rs.inspect("t1")?.totalBudget).toBe(3);
    });
  });
});
