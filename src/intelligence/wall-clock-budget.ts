/**
 * Wall-Clock Budget -- track time and force completion at limit.
 *
 * Phases:
 *   normal    (0-80%)  -- full exploration allowed
 *   finishing (80-95%) -- skip exploration, focus on completing current work
 *   forced   (95%+)    -- force completion with best-effort result immediately
 *
 * The budget injects system prompt overrides at each phase transition
 * to guide the agent toward timely completion.
 */

// -- Types ------------------------------------------------------------------

export type BudgetPhase = "normal" | "finishing" | "forced";

export interface TimeBudget {
  readonly maxDurationMs: number;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly percentUsed: number;
  readonly phase: BudgetPhase;
}

// -- Phase Thresholds -------------------------------------------------------

const FINISHING_THRESHOLD = 0.80;
const FORCED_THRESHOLD = 0.95;

// -- Wall-Clock Budget ------------------------------------------------------

export class WallClockBudget {
  private readonly startedAt: number;
  private readonly maxDurationMs: number;

  constructor(maxDurationMs: number = 300_000) {
    if (maxDurationMs <= 0) {
      throw new Error("maxDurationMs must be positive");
    }
    this.startedAt = Date.now();
    this.maxDurationMs = maxDurationMs;
  }

  /**
   * Get the current budget status snapshot.
   * Returns a new immutable TimeBudget each call.
   */
  check(): TimeBudget {
    const now = Date.now();
    const elapsedMs = now - this.startedAt;
    const remainingMs = Math.max(0, this.maxDurationMs - elapsedMs);
    const percentUsed = Math.min(1, elapsedMs / this.maxDurationMs);
    const phase = this.computePhase(percentUsed);

    return {
      maxDurationMs: this.maxDurationMs,
      startedAt: this.startedAt,
      elapsedMs,
      remainingMs,
      percentUsed,
      phase,
    };
  }

  /**
   * True when 80%+ of the budget is consumed.
   * Agent should stop exploring and finish current work.
   */
  shouldFinishNow(): boolean {
    const { percentUsed } = this.check();
    return percentUsed >= FINISHING_THRESHOLD;
  }

  /**
   * True when 95%+ of the budget is consumed.
   * Agent must produce best-effort output immediately.
   */
  shouldForceComplete(): boolean {
    const { percentUsed } = this.check();
    return percentUsed >= FORCED_THRESHOLD;
  }

  /**
   * True when the budget is fully exhausted.
   */
  isExpired(): boolean {
    return Date.now() - this.startedAt >= this.maxDurationMs;
  }

  /**
   * Get a system prompt override for the current phase, or null if normal.
   * These overrides guide the agent to respect the time budget.
   */
  getSystemPromptOverride(): string | null {
    const budget = this.check();

    switch (budget.phase) {
      case "normal":
        return null;

      case "finishing": {
        const remainingSec = Math.round(budget.remainingMs / 1000);
        return [
          "TIME BUDGET WARNING: You have used 80%+ of your allotted time.",
          `Remaining: ${remainingSec} seconds.`,
          "INSTRUCTIONS:",
          "- Stop exploring new approaches or tangential work.",
          "- Complete your current task with what you have.",
          "- Skip non-essential verification steps.",
          "- Produce output now, even if imperfect.",
        ].join("\n");
      }

      case "forced": {
        const remainingSec = Math.round(budget.remainingMs / 1000);
        return [
          "TIME BUDGET CRITICAL: You have used 95%+ of your allotted time.",
          `Remaining: ${remainingSec} seconds.`,
          "INSTRUCTIONS:",
          "- STOP all current work immediately.",
          "- Produce the best possible output with what you have RIGHT NOW.",
          "- Do not start any new tool calls or edits.",
          "- Summarize what was completed and what remains.",
        ].join("\n");
      }
    }
  }

  /**
   * Format the budget as a human-readable string for status displays.
   */
  format(): string {
    const budget = this.check();
    const elapsedSec = Math.round(budget.elapsedMs / 1000);
    const maxSec = Math.round(budget.maxDurationMs / 1000);
    const pct = Math.round(budget.percentUsed * 100);

    return `${elapsedSec}s / ${maxSec}s (${pct}%) [${budget.phase}]`;
  }

  // -- Private --------------------------------------------------------------

  private computePhase(percentUsed: number): BudgetPhase {
    if (percentUsed >= FORCED_THRESHOLD) return "forced";
    if (percentUsed >= FINISHING_THRESHOLD) return "finishing";
    return "normal";
  }
}
