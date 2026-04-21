/**
 * Reasoning Sandwich Scheduler — turn-counter high-low-high budget allocation.
 *
 * MASTER_PLAN_V8 §5 P1-B5 (+2–4pp TB2).
 *
 * PORT SOURCE: ForgeCode + LangChain deepagents. The research doc
 * `docs/internal/RESEARCH_TERMINALBENCH_HARNESSES_DEEP.md` describes the
 * pattern: first + last turns receive HIGH reasoning budget, middle turns
 * receive LOW. Max-reasoning-always scored 53.9%; sandwich scored 66.5%.
 *
 * RELATIONSHIP TO `src/middleware/reasoning-sandwich.ts` (DO NOT confuse):
 *   - The MIDDLEWARE is a phase-detector: it inspects prompt content and
 *     heuristically guesses planning/execution/verification from keywords.
 *   - THIS SCHEDULER is a turn-counter: the caller explicitly tells it
 *     when a task starts and when the verification phase begins.
 *
 * These are complementary primitives, not duplicates. The scheduler fits
 * orchestration flows where turn boundaries are known a priori (Autopilot,
 * Workshop batch, Coordinator waves). The middleware fits reactive flows
 * where the next turn's role must be inferred from the user message.
 *
 * HONEST FAILURE POLICY (Quality Bar #6):
 *   - If the provider does not expose a reasoning-budget knob, we still
 *     emit a `ReasoningBudget` struct. Callers must check `supported`
 *     before assuming the budget was applied. We do NOT silently claim
 *     "high reasoning" succeeded when the provider does not support it.
 *
 * PER-SESSION STATE (Quality Bar #7):
 *   - Per-taskId state lives in an instance Map. No module-global state.
 *   - Two tasks running concurrently do not interfere.
 */

import type { ProviderName } from "../core/types.js";

/**
 * Discrete reasoning-budget level. Mirrors the deepagents terminology.
 */
export type ReasoningLevel = "high" | "low";

/**
 * Budget spec for a single turn. `tokens` targets native thinking-token
 * budgets (Claude / Gemini); `effort` targets o-series reasoning_effort.
 */
export interface ReasoningBudget {
  readonly level: ReasoningLevel;
  readonly tokens: number;
  readonly effort: "low" | "medium" | "high";
  /**
   * True when the caller has signalled a provider that natively supports
   * a reasoning-budget knob. False means the budget is a hint only.
   */
  readonly supported: boolean;
  /**
   * Non-empty when the scheduler needed to fall back or warn the caller.
   * Callers should surface this via logs.
   */
  readonly warning: string | null;
}

/**
 * Static configuration for the two budget tiers. Values chosen to match
 * the deepagents "xhigh / high" pairing while staying conservative for
 * WOTANN's default provider set.
 */
export interface ReasoningSandwichConfig {
  readonly high: { readonly tokens: number; readonly effort: "high" | "medium" };
  readonly low: { readonly tokens: number; readonly effort: "low" | "medium" };
}

export const DEFAULT_SANDWICH_CONFIG: ReasoningSandwichConfig = Object.freeze({
  high: Object.freeze({ tokens: 8_000, effort: "high" as const }),
  low: Object.freeze({ tokens: 2_000, effort: "low" as const }),
});

/**
 * Per-task scheduler state. Kept private so callers cannot mutate turn
 * counters directly.
 */
interface TaskState {
  readonly taskId: string;
  /** Zero-based turn index. Incremented after each `nextBudget` call. */
  turnIdx: number;
  /** Total expected turns. Final turn returns HIGH. */
  readonly totalBudget: number;
  /** When true, the very next call returns HIGH regardless of turnIdx. */
  isFinal: boolean;
  /** When true, budget is already exhausted; subsequent calls stay LOW. */
  exhausted: boolean;
}

/**
 * ReasoningSandwich — high-low-high turn-counter scheduler.
 *
 * Lifecycle:
 *   1. `start(taskId, totalTurns)` — register a task. First turn is HIGH.
 *   2. `nextBudget(taskId)` — call once per turn. Returns the budget for
 *      THIS turn, then advances the internal counter.
 *   3. `finalize(taskId)` — mark the task as entering its verification
 *      step. The NEXT `nextBudget` call returns HIGH, overriding the
 *      middle-turn rule.
 *   4. `end(taskId)` — clear the state (optional; prevents memory drift
 *      when the caller runs many tasks).
 */
export class ReasoningSandwich {
  private readonly config: ReasoningSandwichConfig;
  private readonly tasks: Map<string, TaskState>;

  constructor(config: Partial<ReasoningSandwichConfig> = {}) {
    this.config = {
      high: { ...DEFAULT_SANDWICH_CONFIG.high, ...(config.high ?? {}) },
      low: { ...DEFAULT_SANDWICH_CONFIG.low, ...(config.low ?? {}) },
    };
    this.tasks = new Map();
  }

  /**
   * Begin tracking a task. Registers per-taskId state. Re-starting an
   * existing taskId resets its counters (caller chose to reuse the id).
   */
  start(taskId: string, totalBudget: number): void {
    if (!taskId) {
      throw new Error("ReasoningSandwich.start: taskId is required");
    }
    if (!Number.isFinite(totalBudget) || totalBudget < 1) {
      throw new Error(`ReasoningSandwich.start: totalBudget must be >=1 (got ${totalBudget})`);
    }
    this.tasks.set(taskId, {
      taskId,
      turnIdx: 0,
      totalBudget: Math.floor(totalBudget),
      isFinal: false,
      exhausted: false,
    });
  }

  /**
   * Return the budget for the CURRENT turn and advance the counter.
   * Budget rule:
   *   - turnIdx === 0                        -> HIGH  (the opening plan)
   *   - isFinal OR turnIdx === totalBudget-1 -> HIGH  (the closing verify)
   *   - exhausted                            -> LOW   (+ warning)
   *   - everything in between                -> LOW   (the cheap middle)
   *
   * @param taskId   — task previously registered via `start`
   * @param provider — optional provider hint; drives the `supported` flag
   */
  nextBudget(taskId: string, provider?: ProviderName): ReasoningBudget {
    const state = this.tasks.get(taskId);
    if (!state) {
      // Unknown task → default to LOW + warning. Do NOT throw: the runtime
      // may invoke the scheduler optimistically on paths where start() was
      // skipped (e.g., a quick single-turn completion). Returning a safe
      // default is more useful than crashing the whole turn.
      return this.buildBudget("low", provider, `taskId "${taskId}" not started; using LOW default`);
    }

    const supported = isProviderBudgetSupported(provider);
    const isFirst = state.turnIdx === 0;
    const isLast = state.turnIdx === state.totalBudget - 1;
    const isPastEnd = state.turnIdx >= state.totalBudget;
    const isFinalOverride = state.isFinal;

    // Budget-exhausted path: caller ran past totalBudget. QB #6 — emit a
    // warning and keep running at LOW rather than silently failing.
    let warning: string | null = null;
    if (isPastEnd || state.exhausted) {
      state.exhausted = true;
      warning = `budget exhausted (turn ${state.turnIdx + 1} of ${state.totalBudget}); continuing at LOW`;
    }

    let level: ReasoningLevel;
    if (isFinalOverride && !state.exhausted) {
      // Finalize can still force HIGH, but only while we're within budget.
      // After overrun we respect the exhaustion signal — no free HIGH tokens.
      level = "high";
      // Consume the finalize flag: subsequent calls go back to normal rules.
      state.isFinal = false;
    } else if (state.exhausted) {
      level = "low";
    } else if (isFirst || isLast) {
      level = "high";
    } else {
      level = "low";
    }

    // Advance counter once per call.
    state.turnIdx += 1;

    // Provider-unsupported warning takes priority only when there's no
    // higher-severity exhaustion warning already queued.
    if (!supported && warning === null) {
      warning = `provider ${provider ?? "<unknown>"} lacks a native reasoning-budget knob; budget is advisory`;
    }

    return this.buildBudget(level, provider, warning, supported);
  }

  /**
   * Mark the task so the NEXT `nextBudget` call returns HIGH, even when
   * the normal rule would return LOW. Use this when the caller is about
   * to start the explicit verification / reconcile turn.
   *
   * Calling finalize on an unknown task is a silent no-op — the task may
   * already have been cleaned up by `end()`. This is safer than throwing
   * from a lifecycle callback.
   */
  finalize(taskId: string): void {
    const state = this.tasks.get(taskId);
    if (!state) return;
    state.isFinal = true;
  }

  /**
   * Stop tracking a task. Calling `end` on an unknown task is a no-op.
   * Callers running long-lived daemons should call this to avoid
   * unbounded Map growth.
   */
  end(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /**
   * Read-only accessor for diagnostics / tests. Returns a snapshot; the
   * caller cannot mutate scheduler state through the returned object.
   */
  inspect(taskId: string): Readonly<{
    turnIdx: number;
    totalBudget: number;
    isFinal: boolean;
    exhausted: boolean;
  }> | null {
    const state = this.tasks.get(taskId);
    if (!state) return null;
    return Object.freeze({
      turnIdx: state.turnIdx,
      totalBudget: state.totalBudget,
      isFinal: state.isFinal,
      exhausted: state.exhausted,
    });
  }

  /** Number of currently tracked tasks — for leak detection in tests. */
  activeTaskCount(): number {
    return this.tasks.size;
  }

  // ── Private helpers ────────────────────────────────────────

  private buildBudget(
    level: ReasoningLevel,
    provider: ProviderName | undefined,
    warning: string | null,
    supported?: boolean,
  ): ReasoningBudget {
    const spec = level === "high" ? this.config.high : this.config.low;
    const resolvedSupport = supported ?? isProviderBudgetSupported(provider);
    return {
      level,
      tokens: spec.tokens,
      effort: spec.effort,
      supported: resolvedSupport,
      warning,
    };
  }
}

/**
 * Pure helper: does this provider expose a native reasoning-budget knob?
 *
 * Matches the list used by `src/providers/extended-thinking.ts`. Keeping
 * the two in sync is the caller's responsibility; we intentionally do
 * not import from extended-thinking.ts to avoid a circular dependency
 * with the prompt package.
 */
export function isProviderBudgetSupported(provider: ProviderName | undefined): boolean {
  if (!provider) return false;
  switch (provider) {
    case "anthropic":
    case "openai":
    case "gemini":
    case "ollama":
      return true;
    // Providers without a documented reasoning-budget knob.
    // (codex, copilot, huggingface, free, azure, bedrock, vertex, mistral,
    //  deepseek, perplexity, xai, together, fireworks, sambanova, groq.)
    default:
      return false;
  }
}
