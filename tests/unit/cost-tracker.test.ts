import { describe, it, expect, afterEach } from "vitest";
import { CostTracker } from "../../src/telemetry/cost-tracker.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CostTracker", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("estimates cost based on model pricing", () => {
    const tracker = new CostTracker();
    const cost = tracker.estimateCost("claude-sonnet-4-6", 1000, 500);

    // $0.003/1K input + $0.015/1K output = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 3);
  });

  it("tracks total cost across requests", () => {
    const tracker = new CostTracker();
    tracker.record("anthropic", "claude-sonnet-4-6", 1000, 500);
    tracker.record("anthropic", "claude-sonnet-4-6", 2000, 1000);

    expect(tracker.getTotalCost()).toBeGreaterThan(0);
    expect(tracker.getEntryCount()).toBe(2);
  });

  it("tracks cost by provider", () => {
    const tracker = new CostTracker();
    tracker.record("anthropic", "claude-sonnet-4-6", 1000, 500);
    tracker.record("openai", "gpt-4.1", 1000, 500);

    const byProvider = tracker.getCostByProvider();
    expect(byProvider.has("anthropic")).toBe(true);
    expect(byProvider.has("openai")).toBe(true);
  });

  it("detects budget exceeded", () => {
    const tracker = new CostTracker();
    tracker.setBudget(0.01);

    tracker.record("anthropic", "claude-opus-4-6", 5000, 2000);
    expect(tracker.isOverBudget()).toBe(true);
  });

  it("returns false for over-budget when no budget set", () => {
    const tracker = new CostTracker();
    tracker.record("anthropic", "claude-opus-4-6", 100000, 50000);
    expect(tracker.isOverBudget()).toBe(false);
  });

  it("returns 0 cost for unknown models", () => {
    const tracker = new CostTracker();
    const cost = tracker.estimateCost("unknown-model", 1000, 500);
    expect(cost).toBe(0);
  });

  it("persists cumulative totals to disk", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-cost-"));
    const costPath = join(tempDir, "cost.json");

    const writer = new CostTracker(costPath);
    writer.record("anthropic", "claude-sonnet-4-6", 1000, 500);
    writer.record("openai", "gpt-4.1", 500, 250);

    const reader = new CostTracker(costPath);
    expect(reader.getTotalCost()).toBeCloseTo(writer.getTotalCost(), 6);
    expect(reader.getEntryCount()).toBe(2);
  });

  it("persists budget to disk", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-cost-"));
    const costPath = join(tempDir, "cost.json");

    const writer = new CostTracker(costPath);
    writer.setBudget(12.5);

    const reader = new CostTracker(costPath);
    expect(reader.getBudget()).toBe(12.5);
  });

  // Wave 4G: honest token accounting + cache telemetry tests. These
  // cover the HIDDEN_STATE_REPORT finding: 2,225 sessions with 0 tokens
  // because adapters never fed real split usage in and the tracker had
  // no way to record cache hits. The 0-token record is preserved as a
  // real data point (not a silent success), while cache reads/writes
  // flow through to both `getEntries()` and `getCacheHitRatio()`.
  it("preserves 0-token records as honest data (no silent success)", () => {
    const tracker = new CostTracker();
    const entry = tracker.record("anthropic", "claude-sonnet-4-6", 0, 0);
    expect(entry.inputTokens).toBe(0);
    expect(entry.outputTokens).toBe(0);
    expect(entry.cost).toBe(0);
    expect(tracker.getEntryCount()).toBe(1);
  });

  it("records cache read/write tokens via record() cacheTokens arg", () => {
    const tracker = new CostTracker();
    tracker.record("anthropic", "claude-sonnet-4-6", 1000, 500, {
      cacheReadTokens: 400,
      cacheWriteTokens: 200,
    });
    const entries = tracker.getEntries();
    expect(entries[0]?.cacheReadTokens).toBe(400);
    expect(entries[0]?.cacheWriteTokens).toBe(200);
  });

  it("recordTurn() accepts TurnUsage and feeds cache fields", () => {
    const tracker = new CostTracker();
    tracker.recordTurn("anthropic", "claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
    });
    const [entry] = tracker.getEntries();
    expect(entry?.inputTokens).toBe(1000);
    expect(entry?.cacheReadTokens).toBe(800);
    expect(entry?.cacheWriteTokens).toBe(100);
  });

  it("getCacheHitRatio() computes cached/(cached+input)", () => {
    const tracker = new CostTracker();
    tracker.recordTurn("anthropic", "claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 1000,
    });
    // ratio = 1000 cached / (1000 cached + 1000 input) = 0.5
    expect(tracker.getCacheHitRatio()).toBeCloseTo(0.5, 3);
  });

  it("getCacheHitRatio() returns 0 when no cache telemetry recorded", () => {
    const tracker = new CostTracker();
    tracker.record("anthropic", "claude-sonnet-4-6", 1000, 500);
    expect(tracker.getCacheHitRatio()).toBe(0);
  });

  it("getEntries() returns a snapshot, not the live array", () => {
    const tracker = new CostTracker();
    tracker.record("anthropic", "claude-sonnet-4-6", 1000, 500);
    const snap = tracker.getEntries();
    expect(snap.length).toBe(1);
    tracker.record("openai", "gpt-4.1", 200, 100);
    // Original snapshot unchanged (immutable boundary).
    expect(snap.length).toBe(1);
    expect(tracker.getEntries().length).toBe(2);
  });
});
