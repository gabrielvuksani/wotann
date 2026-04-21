/**
 * Tests for ProgressiveBudget — per-pass budget elevation over verify loops.
 * Implements MASTER_PLAN_V8 §5 P1-B12 (ForgeCode progressive-budget port).
 */
import { describe, it, expect } from "vitest";
import {
  ProgressiveBudget,
  BudgetExhaustedConcernsRemain,
  DEFAULT_BUDGET_CONFIG,
  tierForPass,
  type PassVerifier,
  type BudgetConfig,
  type PassVerifierOutcome,
} from "../../src/intelligence/progressive-budget.js";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Build a fake verifier that returns `concerns[i]` on its i-th call.
 * An empty array for that index means "pass on that pass".
 */
function mkVerifier(
  concernsPerPass: readonly (readonly string[])[],
): {
  verifier: PassVerifier<string, string>;
  calls: Array<{ input: string; budget: BudgetConfig }>;
} {
  const calls: Array<{ input: string; budget: BudgetConfig }> = [];
  const verifier: PassVerifier<string, string> = async (input, budget) => {
    calls.push({ input, budget });
    const idx = calls.length - 1;
    const concerns = concernsPerPass[idx] ?? [];
    const outcome: PassVerifierOutcome<string> = {
      result: `result-pass-${idx}`,
      concerns,
    };
    return outcome;
  };
  return { verifier, calls };
}

// ── tierForPass (pure helper) ────────────────────────────────

describe("tierForPass", () => {
  it("returns low for pass 0", () => {
    expect(tierForPass(0)).toBe("low");
  });

  it("returns medium for pass 1", () => {
    expect(tierForPass(1)).toBe("medium");
  });

  it("returns max for pass 2", () => {
    expect(tierForPass(2)).toBe("max");
  });

  it("clamps negative indices to low (defensive)", () => {
    expect(tierForPass(-1)).toBe("low");
  });

  it("saturates to max for pass >= 3", () => {
    expect(tierForPass(3)).toBe("max");
    expect(tierForPass(10)).toBe("max");
  });
});

// ── nextPass scheduler ───────────────────────────────────────

describe("ProgressiveBudget.nextPass", () => {
  it("first pass uses LOW budget", () => {
    const pb = new ProgressiveBudget();
    const budget = pb.nextPass("s1");
    expect(budget.tier).toBe("low");
    expect(budget.tokens).toBe(DEFAULT_BUDGET_CONFIG.low.tokens);
    expect(budget.effort).toBe(DEFAULT_BUDGET_CONFIG.low.effort);
    expect(budget.passIdx).toBe(0);
  });

  it("second pass uses MEDIUM budget", () => {
    const pb = new ProgressiveBudget();
    pb.nextPass("s1");
    const budget = pb.nextPass("s1");
    expect(budget.tier).toBe("medium");
    expect(budget.tokens).toBe(DEFAULT_BUDGET_CONFIG.medium.tokens);
    expect(budget.effort).toBe(DEFAULT_BUDGET_CONFIG.medium.effort);
    expect(budget.passIdx).toBe(1);
  });

  it("third pass uses MAX budget", () => {
    const pb = new ProgressiveBudget();
    pb.nextPass("s1");
    pb.nextPass("s1");
    const budget = pb.nextPass("s1");
    expect(budget.tier).toBe("max");
    expect(budget.tokens).toBe(DEFAULT_BUDGET_CONFIG.max.tokens);
    expect(budget.effort).toBe(DEFAULT_BUDGET_CONFIG.max.effort);
    expect(budget.passIdx).toBe(2);
  });

  it("pass beyond maxPasses throws RangeError", () => {
    const pb = new ProgressiveBudget();
    pb.nextPass("s1");
    pb.nextPass("s1");
    pb.nextPass("s1");
    expect(() => pb.nextPass("s1")).toThrow(RangeError);
  });

  it("missing sessionId throws", () => {
    const pb = new ProgressiveBudget();
    expect(() => pb.nextPass("")).toThrow();
  });

  it("passesUsed reflects counter after each nextPass", () => {
    const pb = new ProgressiveBudget();
    expect(pb.passesUsed("s1")).toBe(0);
    pb.nextPass("s1");
    expect(pb.passesUsed("s1")).toBe(1);
    pb.nextPass("s1");
    expect(pb.passesUsed("s1")).toBe(2);
  });

  it("peekNext does NOT advance the counter", () => {
    const pb = new ProgressiveBudget();
    const peeked = pb.peekNext("s1");
    expect(peeked?.tier).toBe("low");
    expect(pb.passesUsed("s1")).toBe(0);
    pb.nextPass("s1"); // advance to 1
    const peeked2 = pb.peekNext("s1");
    expect(peeked2?.tier).toBe("medium");
    expect(pb.passesUsed("s1")).toBe(1);
  });

  it("peekNext returns null once exhausted", () => {
    const pb = new ProgressiveBudget();
    pb.nextPass("s1");
    pb.nextPass("s1");
    pb.nextPass("s1");
    expect(pb.peekNext("s1")).toBeNull();
  });
});

// ── Per-session isolation (QB #7) ────────────────────────────

describe("ProgressiveBudget per-session isolation", () => {
  it("two sessions count independently", () => {
    const pb = new ProgressiveBudget();
    pb.nextPass("alpha"); // alpha@1
    pb.nextPass("beta"); // beta@1
    pb.nextPass("alpha"); // alpha@2
    expect(pb.passesUsed("alpha")).toBe(2);
    expect(pb.passesUsed("beta")).toBe(1);
    const alphaBudget = pb.peekNext("alpha");
    const betaBudget = pb.peekNext("beta");
    expect(alphaBudget?.tier).toBe("max");
    expect(betaBudget?.tier).toBe("medium");
  });

  it("reset clears one session only", () => {
    const pb = new ProgressiveBudget();
    pb.nextPass("alpha");
    pb.nextPass("beta");
    pb.reset("alpha");
    expect(pb.passesUsed("alpha")).toBe(0);
    expect(pb.passesUsed("beta")).toBe(1);
  });

  it("resetAll clears every session", () => {
    const pb = new ProgressiveBudget();
    pb.nextPass("alpha");
    pb.nextPass("beta");
    pb.resetAll();
    expect(pb.activeSessionCount()).toBe(0);
    expect(pb.passesUsed("alpha")).toBe(0);
    expect(pb.passesUsed("beta")).toBe(0);
  });
});

// ── Config overrides ─────────────────────────────────────────

describe("ProgressiveBudget config overrides", () => {
  it("honours custom budget values", () => {
    const pb = new ProgressiveBudget({
      low: { tokens: 500, effort: "low" },
      medium: { tokens: 3_000, effort: "medium" },
      max: { tokens: 16_000, effort: "high" },
      maxPasses: 3,
    });
    const b0 = pb.nextPass("s1");
    const b1 = pb.nextPass("s1");
    const b2 = pb.nextPass("s1");
    expect(b0.tokens).toBe(500);
    expect(b1.tokens).toBe(3_000);
    expect(b2.tokens).toBe(16_000);
  });

  it("honours custom maxPasses > 3", () => {
    const pb = new ProgressiveBudget({ maxPasses: 5 });
    const budgets: string[] = [];
    for (let i = 0; i < 5; i++) budgets.push(pb.nextPass("s1").tier);
    // 0=low, 1=medium, 2+=max (saturate).
    expect(budgets).toEqual(["low", "medium", "max", "max", "max"]);
    expect(() => pb.nextPass("s1")).toThrow(RangeError);
  });

  it("honours custom maxPasses = 1", () => {
    const pb = new ProgressiveBudget({ maxPasses: 1 });
    expect(pb.nextPass("s1").tier).toBe("low");
    expect(() => pb.nextPass("s1")).toThrow(RangeError);
  });

  it("rejects maxPasses < 1", () => {
    expect(() => new ProgressiveBudget({ maxPasses: 0 })).toThrow();
    expect(() => new ProgressiveBudget({ maxPasses: -1 })).toThrow();
  });

  it("getConfig exposes effective config", () => {
    const pb = new ProgressiveBudget({ maxPasses: 4 });
    const cfg = pb.getConfig();
    expect(cfg.maxPasses).toBe(4);
    expect(cfg.low.tokens).toBe(DEFAULT_BUDGET_CONFIG.low.tokens);
  });
});

// ── wrap() — decorator over a verifier ───────────────────────

describe("ProgressiveBudget.wrap", () => {
  it("verifier passes on pass 0 — returns success after 1 call", async () => {
    const pb = new ProgressiveBudget();
    const { verifier, calls } = mkVerifier([[]]); // pass 0 clean
    const wrapped = pb.wrap(verifier, { sessionId: "s1" });
    const success = await wrapped("input-a");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.budget.tier).toBe("low");
    expect(success.passesUsed).toBe(1);
    expect(success.finalBudget.tier).toBe("low");
    expect(success.result).toBe("result-pass-0");
    expect(success.history).toHaveLength(1);
    expect(success.history[0]!.concerns).toEqual([]);
  });

  it("verifier flags concern on pass 0, retries with MEDIUM and passes", async () => {
    const pb = new ProgressiveBudget();
    const { verifier, calls } = mkVerifier([["missing null check"], []]);
    const wrapped = pb.wrap(verifier, { sessionId: "s2" });
    const success = await wrapped("input-b");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.budget.tier).toBe("low");
    expect(calls[1]!.budget.tier).toBe("medium");
    expect(success.passesUsed).toBe(2);
    expect(success.finalBudget.tier).toBe("medium");
    expect(success.history).toHaveLength(2);
    expect(success.history[0]!.concerns).toEqual(["missing null check"]);
    expect(success.history[1]!.concerns).toEqual([]);
  });

  it("verifier flags concerns on passes 0 and 1, retries with MAX and passes", async () => {
    const pb = new ProgressiveBudget();
    const { verifier, calls } = mkVerifier([
      ["off-by-one"],
      ["edge case miss"],
      [],
    ]);
    const wrapped = pb.wrap(verifier, { sessionId: "s3" });
    const success = await wrapped("input-c");
    expect(calls).toHaveLength(3);
    expect(calls[0]!.budget.tier).toBe("low");
    expect(calls[1]!.budget.tier).toBe("medium");
    expect(calls[2]!.budget.tier).toBe("max");
    expect(success.passesUsed).toBe(3);
    expect(success.finalBudget.tier).toBe("max");
  });

  it("verifier flags concerns through all passes -> BudgetExhaustedConcernsRemain", async () => {
    const pb = new ProgressiveBudget();
    const { verifier, calls } = mkVerifier([
      ["c1"],
      ["c2"],
      ["c3"],
    ]);
    const wrapped = pb.wrap(verifier, { sessionId: "s4" });
    let caught: unknown = null;
    try {
      await wrapped("input-d");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BudgetExhaustedConcernsRemain);
    expect(calls).toHaveLength(3);
    const exhausted = caught as BudgetExhaustedConcernsRemain<string>;
    expect(exhausted.sessionId).toBe("s4");
    expect(exhausted.passHistory).toHaveLength(3);
    expect(exhausted.passHistory[0]!.concerns).toEqual(["c1"]);
    expect(exhausted.passHistory[1]!.concerns).toEqual(["c2"]);
    expect(exhausted.passHistory[2]!.concerns).toEqual(["c3"]);
    expect(exhausted.lastResult).toBe("result-pass-2");
  });

  it("BudgetExhaustedConcernsRemain carries descriptive message", async () => {
    const pb = new ProgressiveBudget();
    const { verifier } = mkVerifier([["a"], ["b"], ["c"]]);
    const wrapped = pb.wrap(verifier, { sessionId: "session-X" });
    // One invocation only — subsequent invocations on the same session
    // would find it already exhausted (that behaviour is covered by
    // the "exhausts after 2 passes" and other tests). Here we assert
    // both regex patterns on the single rejection.
    let caught: unknown = null;
    try {
      await wrapped("x");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BudgetExhaustedConcernsRemain);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/session "session-X"/);
    expect(msg).toMatch(/3 pass/);
  });

  it("verifier that throws is treated as a concerns-filled pass (honest failure)", async () => {
    const pb = new ProgressiveBudget();
    let callCount = 0;
    const throwingThenPass: PassVerifier<string, string> = async (_input, _budget) => {
      callCount += 1;
      if (callCount === 1) throw new Error("boom");
      return { result: `ok-${callCount}`, concerns: [] };
    };
    const wrapped = pb.wrap(throwingThenPass, { sessionId: "s5" });
    const success = await wrapped("input-e");
    expect(callCount).toBe(2);
    expect(success.passesUsed).toBe(2);
    expect(success.finalBudget.tier).toBe("medium");
    expect(success.history[0]!.concerns[0]).toMatch(/verifier threw: boom/);
    expect(success.history[1]!.concerns).toEqual([]);
  });

  it("wrap invocations on different sessions do not interfere", async () => {
    const pb = new ProgressiveBudget();
    const { verifier: va, calls: callsA } = mkVerifier([["a1"], []]);
    const { verifier: vb, calls: callsB } = mkVerifier([[]]);
    const wrapA = pb.wrap(va, { sessionId: "alpha" });
    const wrapB = pb.wrap(vb, { sessionId: "beta" });

    const [resA, resB] = await Promise.all([wrapA("in-a"), wrapB("in-b")]);

    expect(resA.passesUsed).toBe(2);
    expect(resA.finalBudget.tier).toBe("medium");
    expect(resB.passesUsed).toBe(1);
    expect(resB.finalBudget.tier).toBe("low");
    expect(callsA).toHaveLength(2);
    expect(callsB).toHaveLength(1);
  });

  it("wrap rejects without a sessionId", () => {
    const pb = new ProgressiveBudget();
    const { verifier } = mkVerifier([[]]);
    expect(() => pb.wrap(verifier, { sessionId: "" })).toThrow();
  });

  it("wrap rejects a non-function verifier", () => {
    const pb = new ProgressiveBudget();
    expect(() =>
      pb.wrap(
        // @ts-expect-error exercising runtime guard
        null,
        { sessionId: "s" },
      ),
    ).toThrow();
  });

  it("history entries record duration and passIdx", async () => {
    const pb = new ProgressiveBudget();
    const { verifier } = mkVerifier([["x"], []]);
    const wrapped = pb.wrap(verifier, { sessionId: "s6" });
    const success = await wrapped("in");
    expect(success.history[0]!.passIdx).toBe(0);
    expect(success.history[1]!.passIdx).toBe(1);
    expect(success.history[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(success.history[1]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("custom maxPasses=2: exhausts after 2 passes when both concern", async () => {
    const pb = new ProgressiveBudget({ maxPasses: 2 });
    const { verifier, calls } = mkVerifier([["c1"], ["c2"]]);
    const wrapped = pb.wrap(verifier, { sessionId: "s7" });
    await expect(wrapped("input")).rejects.toBeInstanceOf(BudgetExhaustedConcernsRemain);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.budget.tier).toBe("low");
    expect(calls[1]!.budget.tier).toBe("medium"); // never reaches MAX
  });
});
