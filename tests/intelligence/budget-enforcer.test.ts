import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BudgetEnforcer,
  budgetForTier,
} from "../../src/intelligence/budget-enforcer.js";

describe("BudgetEnforcer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("construction", () => {
    it("rejects zero or negative maxWallClockMs", () => {
      expect(() => new BudgetEnforcer({ maxWallClockMs: 0 })).toThrow();
      expect(() => new BudgetEnforcer({ maxWallClockMs: -1 })).toThrow();
    });

    it("accepts positive maxWallClockMs", () => {
      expect(() => new BudgetEnforcer({ maxWallClockMs: 1000 })).not.toThrow();
    });
  });

  describe("wall-clock gating", () => {
    it("does not stop when time remains", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000 });
      expect(b.shouldStop()).toBe(false);
    });

    it("stops when wall-clock fully exhausted", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 1000 });
      vi.advanceTimersByTime(1000);
      expect(b.shouldStop()).toBe(true);
      expect(b.snapshot().stopReason).toBe("wall-clock-exhausted");
    });

    it("stops early at earlyStopMargin threshold", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 1000, earlyStopMargin: 0.2 });
      vi.advanceTimersByTime(800); // 80% used → early-stop
      expect(b.shouldStop()).toBe(true);
      expect(b.snapshot().stopReason).toBe("early-stop-margin");
    });

    it("default earlyStopMargin is 0.1", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 1000 });
      vi.advanceTimersByTime(900); // 90% used → early-stop
      expect(b.shouldStop()).toBe(true);
    });
  });

  describe("USD gating", () => {
    it("does not stop on USD when no cap set", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000 });
      b.attachCostReader(() => 100);
      expect(b.shouldStop()).toBe(false);
    });

    it("stops when USD exhausted", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000, maxUsd: 5 });
      b.attachCostReader(() => 5);
      expect(b.shouldStop()).toBe(true);
      expect(b.snapshot().stopReason).toBe("usd-exhausted");
    });

    it("snapshot reports infinite USD remaining when no cap", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000 });
      b.attachCostReader(() => 1);
      expect(b.snapshot().usdRemaining).toBe(Infinity);
    });

    it("snapshot reports remaining USD correctly with cap", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000, maxUsd: 5 });
      b.attachCostReader(() => 1.5);
      expect(b.snapshot().usdRemaining).toBe(3.5);
    });
  });

  describe("manual abort", () => {
    it("abort() flips shouldStop to true immediately", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000 });
      expect(b.shouldStop()).toBe(false);
      b.abort();
      expect(b.shouldStop()).toBe(true);
      expect(b.snapshot().stopReason).toBe("manual-abort");
    });
  });

  describe("task counting", () => {
    it("counts started and completed tasks", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000 });
      b.markTaskStart("t1");
      b.markTaskStart("t2");
      b.markTaskEnd("t1");
      const s = b.snapshot();
      expect(s.tasksStarted).toBe(2);
      expect(s.tasksCompleted).toBe(1);
    });
  });

  describe("remainingMsForTask", () => {
    it("returns minimum of perTaskCap and total remaining", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000, maxPerTaskMs: 500 });
      expect(b.remainingMsForTask()).toBe(500);
    });

    it("returns total remaining when perTaskCap would exceed it", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 1000, maxPerTaskMs: 500 });
      vi.advanceTimersByTime(800);
      expect(b.remainingMsForTask()).toBe(200);
    });

    it("defaults perTaskCap to maxWallClockMs/10", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 10_000 });
      expect(b.remainingMsForTask()).toBe(1000); // 10% of 10_000
    });
  });

  describe("snapshot", () => {
    it("reports accurate fraction used", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 1000 });
      vi.advanceTimersByTime(250);
      expect(b.snapshot().fractionUsed).toBe(0.25);
    });

    it("caps fractionUsed at 1 when overshoot", () => {
      const b = new BudgetEnforcer({ maxWallClockMs: 1000 });
      vi.advanceTimersByTime(2000);
      expect(b.snapshot().fractionUsed).toBe(1);
    });
  });
});

describe("budgetForTier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("free tier has no USD cap", () => {
    const b = budgetForTier("free", 60_000);
    b.attachCostReader(() => 1000);
    // $1000 spent but free tier has no USD cap → still not stopping
    // from USD (wall-clock has remaining).
    expect(b.shouldStop()).toBe(false);
  });

  it("sonnet tier caps at $5", () => {
    const b = budgetForTier("sonnet", 60_000);
    b.attachCostReader(() => 5.01);
    expect(b.shouldStop()).toBe(true);
    expect(b.snapshot().stopReason).toBe("usd-exhausted");
  });

  it("sonnet tier uses larger earlyStopMargin", () => {
    const b = budgetForTier("sonnet", 1000);
    vi.advanceTimersByTime(850); // 85% used → early-stop (margin 0.15)
    expect(b.shouldStop()).toBe(true);
  });
});
