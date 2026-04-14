/**
 * Autonomous Context Intelligence — context-budget-aware cycle planning.
 *
 * The #1 failure mode for autonomous agents is context saturation:
 * they accumulate tool outputs until the window overflows, then start
 * hallucinating or losing track of the plan.
 *
 * This module sits between the autonomous executor and the context window,
 * providing:
 * - Pre-cycle token estimation (how much will this cycle cost?)
 * - Adaptive plan complexity (reduce scope when context is tight)
 * - Proactive compaction scheduling (compact BEFORE overflow, not after)
 * - Wave execution (fresh context per phase of a multi-phase plan)
 * - Context utilization telemetry
 */

export interface ContextBudgetState {
  readonly totalBudget: number;
  readonly used: number;
  readonly available: number;
  readonly pressure: "green" | "yellow" | "orange" | "red" | "critical";
  readonly utilizationPercent: number;
  readonly estimatedCyclesRemaining: number;
  readonly recommendation: ContextRecommendation;
}

export type ContextRecommendation =
  | "proceed-normally"
  | "reduce-plan-scope"
  | "compact-before-next-cycle"
  | "switch-to-wave-execution"
  | "emergency-compact-now"
  | "halt-and-compact";

export interface CycleEstimate {
  readonly estimatedTokens: number;
  readonly toolCalls: number;
  readonly confidence: number;
  readonly willExceedBudget: boolean;
  readonly recommendation: string;
}

export interface WaveConfig {
  readonly id: string;
  readonly phase: string;
  readonly description: string;
  readonly files: readonly string[];
  readonly estimatedTokens: number;
  readonly dependencies: readonly string[];
}

// ── Pressure Thresholds ─────────────────────────────────

const PRESSURE_THRESHOLDS = {
  green: 0.50,   // < 50% — full speed
  yellow: 0.65,  // 65% — start being careful
  orange: 0.78,  // 78% — reduce scope
  red: 0.88,     // 88% — compact soon
  critical: 0.95 // 95% — halt and compact NOW
} as const;

// ── Token Estimation ────────────────────────────────────

const TOOL_TOKEN_ESTIMATES: Record<string, number> = {
  Read: 2000,        // average file read
  Write: 1500,       // file content + confirmation
  Edit: 800,         // old + new string
  Bash: 3000,        // command output
  Glob: 200,         // file list
  Grep: 1500,        // search results
  LSP: 500,          // symbol info
  WebSearch: 2000,   // search results
  WebFetch: 5000,    // page content
  Agent: 1000,       // subagent invocation
  ComputerUse: 3000, // screenshot + actions
};

/**
 * Estimate how many tokens a planning cycle will consume.
 */
export function estimateCycleTokens(
  planDescription: string,
  expectedToolCalls: readonly string[],
): CycleEstimate {
  // Base cost: the plan description + model reasoning
  let estimate = Math.ceil(planDescription.length / 4) + 500; // reasoning overhead

  // Tool call estimates
  for (const tool of expectedToolCalls) {
    estimate += TOOL_TOKEN_ESTIMATES[tool] ?? 1000;
  }

  // Response overhead (model's text output)
  estimate += 2000;

  const confidence = expectedToolCalls.length > 0 ? 0.7 : 0.4;

  return {
    estimatedTokens: estimate,
    toolCalls: expectedToolCalls.length,
    confidence,
    willExceedBudget: false, // Caller checks against their budget
    recommendation: estimate > 50_000 ? "Split into smaller steps" : "Proceed",
  };
}

// ── Context Budget Manager ──────────────────────────────

export class AutonomousContextManager {
  private totalBudget: number;
  private usedTokens: number = 0;
  private cycleHistory: Array<{ cycle: number; tokensUsed: number; toolCalls: number }> = [];
  private waves: WaveConfig[] = [];
  private currentWaveIndex: number = 0;

  constructor(totalBudget: number) {
    this.totalBudget = totalBudget;
  }

  /**
   * Update the current token usage.
   */
  updateUsage(tokensUsed: number): void {
    this.usedTokens = tokensUsed;
  }

  /**
   * Record a completed cycle for estimation accuracy.
   */
  recordCycle(tokensUsed: number, toolCalls: number): void {
    this.cycleHistory.push({
      cycle: this.cycleHistory.length + 1,
      tokensUsed,
      toolCalls,
    });
  }

  /**
   * Get the current context budget state with recommendation.
   */
  getBudgetState(): ContextBudgetState {
    const available = this.totalBudget - this.usedTokens;
    const utilizationPercent = this.usedTokens / this.totalBudget;
    const pressure = this.classifyPressure(utilizationPercent);
    const recommendation = this.getRecommendation(pressure, available);

    // Estimate remaining cycles based on average consumption
    const avgTokensPerCycle = this.getAverageTokensPerCycle();
    const estimatedCyclesRemaining = avgTokensPerCycle > 0
      ? Math.floor(available / avgTokensPerCycle)
      : 100;

    return {
      totalBudget: this.totalBudget,
      used: this.usedTokens,
      available,
      pressure,
      utilizationPercent: Math.round(utilizationPercent * 100),
      estimatedCyclesRemaining,
      recommendation,
    };
  }

  /**
   * Check if a specific cycle should proceed given its estimated cost.
   */
  shouldProceed(cycleEstimate: CycleEstimate): {
    proceed: boolean;
    reason: string;
    alternativeAction?: string;
  } {
    const state = this.getBudgetState();

    if (state.pressure === "critical") {
      return {
        proceed: false,
        reason: "Context is at critical capacity (95%+). Must compact before continuing.",
        alternativeAction: "halt-and-compact",
      };
    }

    if (state.pressure === "red" && cycleEstimate.estimatedTokens > state.available * 0.3) {
      return {
        proceed: false,
        reason: `Cycle would use ~${cycleEstimate.estimatedTokens} tokens but only ${state.available} remain at red pressure.`,
        alternativeAction: "compact-before-next-cycle",
      };
    }

    if (cycleEstimate.estimatedTokens > state.available) {
      return {
        proceed: false,
        reason: `Cycle needs ~${cycleEstimate.estimatedTokens} tokens but only ${state.available} available.`,
        alternativeAction: "reduce-plan-scope",
      };
    }

    return { proceed: true, reason: `Budget OK: ~${state.available} tokens remaining.` };
  }

  /**
   * Plan wave execution: break a multi-phase plan into fresh-context waves.
   */
  planWaves(
    phases: readonly { phase: string; description: string; files: readonly string[]; dependencies: readonly string[] }[],
  ): readonly WaveConfig[] {
    this.waves = phases.map((phase, i) => ({
      id: `wave_${i}`,
      phase: phase.phase,
      description: phase.description,
      files: phase.files,
      estimatedTokens: estimateCycleTokens(
        phase.description,
        ["Read", "Edit", "Bash", "Grep"],
      ).estimatedTokens,
      dependencies: phase.dependencies,
    }));

    this.currentWaveIndex = 0;
    return [...this.waves];
  }

  /**
   * Get the next wave to execute. Returns null if all waves are done.
   */
  getNextWave(): WaveConfig | null {
    if (this.currentWaveIndex >= this.waves.length) return null;
    return this.waves[this.currentWaveIndex] ?? null;
  }

  /**
   * Advance to the next wave (after completing current).
   */
  advanceWave(): void {
    this.currentWaveIndex++;
  }

  /**
   * Build a context-aware prompt that adapts to budget pressure.
   */
  buildAdaptivePrompt(basePrompt: string): string {
    const state = this.getBudgetState();
    const additions: string[] = [];

    if (state.pressure === "yellow") {
      additions.push(
        "Note: Context window is at 65% capacity. Be concise in tool outputs.",
        "Prefer targeted file reads over full file reads.",
      );
    }

    if (state.pressure === "orange") {
      additions.push(
        "IMPORTANT: Context is at 78% capacity. Minimize tool calls.",
        "Only read the specific lines you need, not full files.",
        "Skip verbose commands. Use focused diagnostics only.",
        "If possible, complete the task with your current knowledge.",
      );
    }

    if (state.pressure === "red") {
      additions.push(
        "CRITICAL: Context is at 88% capacity. Finishing soon.",
        "Make ONE more focused attempt, then either complete or compact.",
        "DO NOT read more files or run long commands.",
        `Estimated ${state.estimatedCyclesRemaining} cycles remaining.`,
      );
    }

    if (additions.length === 0) return basePrompt;

    return `${basePrompt}\n\n---\n${additions.join("\n")}`;
  }

  /**
   * Generate a compaction directive if needed.
   */
  getCompactionDirective(): string | null {
    const state = this.getBudgetState();

    if (state.recommendation === "emergency-compact-now" || state.recommendation === "halt-and-compact") {
      return [
        "COMPACTION REQUIRED: Context is near overflow.",
        "",
        "Strategy: aggressive-summarize",
        "- Summarize all tool outputs to 1-line results",
        "- Keep only the last 5 conversation turns",
        "- Preserve: active plan, modified files list, current task",
        "- Discard: file contents, search results, old reasoning",
      ].join("\n");
    }

    if (state.recommendation === "compact-before-next-cycle") {
      return [
        "PRE-CYCLE COMPACTION: Context pressure is high.",
        "",
        "Strategy: selective",
        "- Summarize tool outputs older than 3 turns",
        "- Keep active plan and recent conversation",
        "- Compress file contents to headers-only",
      ].join("\n");
    }

    return null;
  }

  /**
   * Adjust the total budget (e.g., when switching providers).
   */
  adjustBudget(newBudget: number): void {
    this.totalBudget = newBudget;
  }

  // ── Private ───────────────────────────────────────────

  private classifyPressure(utilization: number): ContextBudgetState["pressure"] {
    if (utilization >= PRESSURE_THRESHOLDS.critical) return "critical";
    if (utilization >= PRESSURE_THRESHOLDS.red) return "red";
    if (utilization >= PRESSURE_THRESHOLDS.orange) return "orange";
    if (utilization >= PRESSURE_THRESHOLDS.yellow) return "yellow";
    return "green";
  }

  private getRecommendation(pressure: string, available: number): ContextRecommendation {
    switch (pressure) {
      case "critical": return "halt-and-compact";
      case "red": return available < 20_000 ? "emergency-compact-now" : "compact-before-next-cycle";
      case "orange": return "switch-to-wave-execution";
      case "yellow": return "reduce-plan-scope";
      default: return "proceed-normally";
    }
  }

  private getAverageTokensPerCycle(): number {
    if (this.cycleHistory.length === 0) return 10_000; // Default estimate
    const total = this.cycleHistory.reduce((sum, c) => sum + c.tokensUsed, 0);
    return Math.ceil(total / this.cycleHistory.length);
  }
}
