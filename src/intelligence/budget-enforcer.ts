/**
 * Budget enforcer for benchmark runs — Phase 4 Sprint B2 item 22.
 *
 * Benchmark runs burn real wall-clock and real dollars (verifier
 * tokens, provider-API calls). Without a hard budget gate, a single
 * runaway task or misbehaving agent loop can blow past the planned
 * tier cap (≤$5 Sonnet per WOTANN-Sonnet tier; $0 per WOTANN-Free
 * tier) and poison the publishable pass@1 numbers.
 *
 * This module ships BudgetEnforcer — a small stateful guard that
 * tracks wall-clock ms and USD spend per-run, and exposes a single
 * predicate `shouldStop()` that benchmark runners check before each
 * task / each verify call / each retry. No timers, no signals — the
 * runner polls.
 *
 * Integrates with CostTracker (already wired in runtime.costTracker).
 * If runners pass a cost-reader callback, the enforcer monitors total
 * session spend. Otherwise it tracks wall-clock only.
 */

// ── Types ──────────────────────────────────────────────

export interface BudgetConfig {
  /** Max wall-clock ms for the entire run. Hard cap. Required. */
  readonly maxWallClockMs: number;
  /** Max USD spend for the entire run. Undefined = no USD cap. */
  readonly maxUsd?: number;
  /**
   * Per-task wall-clock ceiling. Defaults to maxWallClockMs / 10
   * so a single task can't eat the whole budget. Set explicitly for
   * long-horizon benchmarks.
   */
  readonly maxPerTaskMs?: number;
  /**
   * Early-stop safety margin as a fraction of maxWallClockMs (0-1).
   * Runners should stop TAKING new tasks when (wallClockMs / maxWallClockMs)
   * exceeds 1 - earlyStopMargin, so in-flight tasks still get their
   * full per-task budget. Default 0.1 (stop early when 90% used).
   */
  readonly earlyStopMargin?: number;
}

export interface BudgetSnapshot {
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly fractionUsed: number; // 0-1
  readonly usdSpent: number;
  readonly usdRemaining: number; // Infinity when no cap
  readonly tasksStarted: number;
  readonly tasksCompleted: number;
  readonly stopReason: StopReason | null;
}

export type StopReason =
  | "wall-clock-exhausted"
  | "usd-exhausted"
  | "early-stop-margin"
  | "manual-abort";

export type CostReader = () => number; // USD spent-so-far

// ── Enforcer ──────────────────────────────────────────

/**
 * Stateful budget guard — one per benchmark run.
 *
 * Usage:
 *   const budget = new BudgetEnforcer({ maxWallClockMs: 3_600_000, maxUsd: 5 });
 *   budget.attachCostReader(() => runtime.costTracker.getTotalUsd());
 *   for (const task of tasks) {
 *     if (budget.shouldStop()) break;
 *     budget.markTaskStart(task.id);
 *     await runTask(task);
 *     budget.markTaskEnd(task.id);
 *   }
 *   const snapshot = budget.snapshot();
 */
export class BudgetEnforcer {
  private readonly startedAt: number = Date.now();
  private tasksStarted = 0;
  private tasksCompleted = 0;
  private aborted = false;
  private costReader: CostReader | null = null;
  private stopReason: StopReason | null = null;

  constructor(private readonly config: BudgetConfig) {
    if (config.maxWallClockMs <= 0) {
      throw new Error("BudgetEnforcer: maxWallClockMs must be positive");
    }
  }

  attachCostReader(reader: CostReader): void {
    this.costReader = reader;
  }

  markTaskStart(_id?: string): void {
    this.tasksStarted++;
  }

  markTaskEnd(_id?: string): void {
    this.tasksCompleted++;
  }

  /** Manually abort the run — next shouldStop() call returns true. */
  abort(): void {
    this.aborted = true;
    if (!this.stopReason) this.stopReason = "manual-abort";
  }

  /**
   * Should the runner stop picking up new tasks? True when:
   *   - manually aborted
   *   - wall-clock elapsed >= maxWallClockMs
   *   - wall-clock elapsed >= (1 - earlyStopMargin) * maxWallClockMs
   *   - usd spent >= maxUsd
   *
   * In-flight tasks should still finish with their per-task budget —
   * shouldStop is for loop-level gating, not mid-task kill.
   */
  shouldStop(): boolean {
    if (this.aborted) return true;

    const elapsed = Date.now() - this.startedAt;
    if (elapsed >= this.config.maxWallClockMs) {
      this.stopReason = this.stopReason ?? "wall-clock-exhausted";
      return true;
    }
    const margin = this.config.earlyStopMargin ?? 0.1;
    if (elapsed >= this.config.maxWallClockMs * (1 - margin)) {
      this.stopReason = this.stopReason ?? "early-stop-margin";
      return true;
    }

    if (this.config.maxUsd !== undefined && this.costReader) {
      const spent = this.costReader();
      if (spent >= this.config.maxUsd) {
        this.stopReason = this.stopReason ?? "usd-exhausted";
        return true;
      }
    }

    return false;
  }

  /** Remaining ms for the current task (bounded by both maxPerTaskMs and
   * the remaining total budget). Runners should use this as the per-task
   * deadline. */
  remainingMsForTask(): number {
    const elapsed = Date.now() - this.startedAt;
    const totalRemaining = Math.max(0, this.config.maxWallClockMs - elapsed);
    const perTaskCap = this.config.maxPerTaskMs ?? Math.floor(this.config.maxWallClockMs / 10);
    return Math.min(perTaskCap, totalRemaining);
  }

  /** Immutable snapshot of the current budget state. */
  snapshot(): BudgetSnapshot {
    const now = Date.now();
    const elapsed = now - this.startedAt;
    const remaining = Math.max(0, this.config.maxWallClockMs - elapsed);
    const fractionUsed = Math.min(1, elapsed / this.config.maxWallClockMs);
    const usdSpent = this.costReader?.() ?? 0;
    const usdRemaining =
      this.config.maxUsd !== undefined ? Math.max(0, this.config.maxUsd - usdSpent) : Infinity;

    return {
      startedAt: this.startedAt,
      elapsedMs: elapsed,
      remainingMs: remaining,
      fractionUsed,
      usdSpent,
      usdRemaining,
      tasksStarted: this.tasksStarted,
      tasksCompleted: this.tasksCompleted,
      stopReason: this.stopReason,
    };
  }
}

/**
 * Convenience factory for the two-tier leaderboard preset.
 * WOTANN-Free tier: unlimited USD (Groq/Cerebras/DeepSeek free tiers).
 * WOTANN-Sonnet tier: $5 USD cap (Sonnet 4.6 verifier only).
 */
export function budgetForTier(tier: "free" | "sonnet", maxWallClockMs: number): BudgetEnforcer {
  return new BudgetEnforcer(
    tier === "free"
      ? { maxWallClockMs, earlyStopMargin: 0.1 }
      : { maxWallClockMs, maxUsd: 5, earlyStopMargin: 0.15 },
  );
}
