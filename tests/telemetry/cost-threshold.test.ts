/**
 * V9 GA-07 (T11.3) — cost.warning threshold ladder tests.
 *
 * Pins down the contract:
 *   - Each of {75, 90, 95}% fires AT MOST ONCE per session
 *   - All three fire when crossed in sequence
 *   - Setting a budget RESETS the fire history (new ladder = fresh state)
 *   - Honest stub guarantee: no warnings fire when budget is null
 *   - Subscriber failure does NOT poison the broadcast to other subscribers
 *   - Late subscribers can introspect already-fired thresholds
 *
 * Each test pins down ONE invariant per QB #14 (claim verification).
 *
 * BILLING TEST — uses literal model IDs ("claude-opus-4-7") because the
 * cost-threshold logic exercises specific COST_TABLE rates. A tier-resolver
 * would defeat the test: the per-token rate IS the assertion, so the model
 * id must match a real entry in the cost table. Wave DH-3 keeps these
 * literals intentionally; see tests/_helpers/model-tier.ts header comment.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  CostTracker,
  type CostWarningEvent,
} from "../../src/telemetry/cost-tracker.js";

describe("CostTracker — V9 GA-07 cost.warning threshold ladder", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it("fires no warnings when budget is null (honest stub default)", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    // Big record without budget should NOT fire — silent default
    tracker.record("anthropic", "claude-opus-4-7", 100_000, 50_000);
    expect(events).toHaveLength(0);
  });

  it("fires no warnings when budget is zero or negative (degenerate guard)", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(0);
    tracker.record("anthropic", "claude-opus-4-7", 100_000, 50_000);
    expect(events).toHaveLength(0);
  });

  it("fires the 75% warning exactly once when crossed", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    // Budget $1; opus rate = $0.015/1K input + $0.075/1K output.
    // Record 50K input + 0 output = $0.75 (75% exactly).
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0);
    expect(events.filter((e) => e.threshold === 75)).toHaveLength(1);
  });

  it("does NOT re-fire the 75% warning on a subsequent record at 80%", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    // First record crosses 75%
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0); // $0.75
    // Second record stays in [75, 90) range — should not re-fire 75
    tracker.record("anthropic", "claude-opus-4-7", 5_000, 0); // +$0.075 = $0.825
    expect(events.filter((e) => e.threshold === 75)).toHaveLength(1);
    expect(events.filter((e) => e.threshold === 90)).toHaveLength(0);
  });

  it("fires 75 then 90 then 95 in sequence as cost climbs", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    // $0.75 — crosses 75
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0);
    // +$0.16 = $0.91 — crosses 90 (75 must NOT re-fire)
    tracker.record("anthropic", "claude-opus-4-7", 10_667, 0);
    // +$0.075 = $0.985 — crosses 95
    tracker.record("anthropic", "claude-opus-4-7", 5_000, 0);
    expect(events.map((e) => e.threshold)).toEqual([75, 90, 95]);
  });

  it("fires 75 + 90 + 95 in a single record when cost jumps past all three", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    // Single record blasts past 95% — all three should fire on the
    // same record() call, in ascending order.
    tracker.record("anthropic", "claude-opus-4-7", 70_000, 0); // $1.05
    expect(events.map((e) => e.threshold)).toEqual([75, 90, 95]);
  });

  it("event payload carries threshold, currentCostUsd, budgetUsd, percentUsed, timestamp", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0); // $0.75 = 75%
    const event = events[0]!;
    expect(event.threshold).toBe(75);
    expect(event.currentCostUsd).toBeCloseTo(0.75, 4);
    expect(event.budgetUsd).toBe(1);
    expect(event.percentUsed).toBeCloseTo(75, 2);
    // ISO timestamp is parseable
    expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
  });

  it("setBudget() to a different value resets the fired-threshold ledger", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0); // 75% of $1
    expect(events).toHaveLength(1);
    // New budget — ladder resets
    tracker.setBudget(2);
    // Record more cost; now $0.75 against $2 = 37.5% — should NOT fire
    tracker.record("anthropic", "claude-opus-4-7", 5_000, 0);
    expect(events).toHaveLength(1);
    // Now blow past 75% of the new budget ($1.50)
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0); // total $1.575
    expect(events.filter((e) => e.threshold === 75)).toHaveLength(2);
  });

  it("setBudget() to the SAME value does NOT reset (idempotent setBudget)", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0); // 75%
    expect(events).toHaveLength(1);
    // Re-set same budget — no ladder reset
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 5_000, 0); // still ~82%
    expect(events.filter((e) => e.threshold === 75)).toHaveLength(1);
  });

  it("resetThresholds() lets a future crossing re-emit", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0); // 75%
    expect(events).toHaveLength(1);
    tracker.resetThresholds();
    // Record more — already over 75%, so 75 should re-fire
    tracker.record("anthropic", "claude-opus-4-7", 1_000, 0);
    expect(events.filter((e) => e.threshold === 75)).toHaveLength(2);
  });

  it("getFiredThresholds() exposes ledger for late subscribers", () => {
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 70_000, 0); // crosses all three
    expect(tracker.getFiredThresholds()).toEqual([75, 90, 95]);
  });

  it("disposer returned by onWarning() removes the handler", () => {
    const events: CostWarningEvent[] = [];
    const dispose = tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    dispose();
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0); // 75%
    expect(events).toHaveLength(0);
  });

  it("subscriber that throws does NOT poison the broadcast to other subscribers", () => {
    const goodEvents: CostWarningEvent[] = [];
    tracker.onWarning(() => {
      throw new Error("bad subscriber");
    });
    tracker.onWarning((e) => goodEvents.push(e));
    tracker.setBudget(1);
    tracker.record("anthropic", "claude-opus-4-7", 50_000, 0);
    expect(goodEvents).toHaveLength(1);
    expect(goodEvents[0]?.threshold).toBe(75);
  });

  it("two CostTracker instances do NOT share threshold state (QB #7)", () => {
    const a = new CostTracker();
    const b = new CostTracker();
    const aEvents: CostWarningEvent[] = [];
    const bEvents: CostWarningEvent[] = [];
    a.onWarning((e) => aEvents.push(e));
    b.onWarning((e) => bEvents.push(e));
    a.setBudget(1);
    b.setBudget(1);
    a.record("anthropic", "claude-opus-4-7", 50_000, 0);
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(0);
  });

  it("70%, 80%, 95% sequence — verifies each threshold fires once at correct boundary", () => {
    const events: CostWarningEvent[] = [];
    tracker.onWarning((e) => events.push(e));
    tracker.setBudget(1);
    // Step 1: 70% (under 75) — no fire
    tracker.record("anthropic", "claude-opus-4-7", 46_667, 0); // ~$0.70
    expect(events).toHaveLength(0);
    // Step 2: cumulative ~80% — fires 75 only
    tracker.record("anthropic", "claude-opus-4-7", 6_667, 0); // +$0.10 = ~$0.80
    expect(events.map((e) => e.threshold)).toEqual([75]);
    // Step 3: cumulative ~95% — fires 90 then 95
    tracker.record("anthropic", "claude-opus-4-7", 10_000, 0); // +$0.15 = ~$0.95
    expect(events.map((e) => e.threshold)).toEqual([75, 90, 95]);
  });
});
