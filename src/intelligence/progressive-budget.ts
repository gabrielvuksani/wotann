/**
 * Progressive Reasoning Budget — elevates reasoning budget per verify pass.
 *
 * MASTER_PLAN_V8 §5 P1-B12 (+1–2pp TB2).
 *
 * PORT SOURCE: ForgeCode progressive-budget. The research doc
 * `docs/internal/RESEARCH_TERMINALBENCH_HARNESSES_DEEP.md` describes the
 * pattern: instead of burning max reasoning on every verification pass,
 * start at a LOW budget, escalate to MEDIUM if the first pass flags a
 * concern, then escalate to MAX if the second pass still flags a concern.
 * Avoids over-spending on trivial tasks while giving critical reviews
 * enough thinking depth.
 *
 * RELATIONSHIP TO EXISTING CODE:
 *   - `src/prompt/reasoning-sandwich.ts` (B5) is a TURN-counter:
 *     first-and-last turns get HIGH, middle turns get LOW. Per task.
 *   - `src/intelligence/pre-completion-verifier.ts` (B4) runs the
 *     4-perspective review ONCE per verification. No retry loop.
 *   - THIS FILE is a PASS-counter: runs the same verifier N times, each
 *     time with a taller budget, stopping when the verifier passes or
 *     the budget is exhausted.
 *
 *   These are complementary primitives — the sandwich shapes a single
 *   task's turn sequence; the progressive budget shapes the retry loop
 *   that fires *after* the task claims done. Both can be active at once.
 *
 * HONEST FAILURE POLICY (Quality Bar #6):
 *   - When all passes are exhausted and concerns remain, `wrap` rejects
 *     with a `BudgetExhaustedConcernsRemain` error containing the final
 *     verifier report and the structured reasons for every pass.
 *   - We never silently swallow a verifier fail to return "pass".
 *
 * PER-SESSION STATE (Quality Bar #7):
 *   - Per-sessionId pass counters live in an instance Map. No
 *     module-global state. Two sessions running concurrently do not
 *     interfere.
 *   - `reset(sessionId)` clears state for a single session; `resetAll()`
 *     clears every session on this instance.
 *
 * API SURFACE:
 *   - `ProgressiveBudget` class — per-pass budget scheduler.
 *   - `wrap(verifier, options)` — decorates a verifier with the retry
 *     loop. The decorated function returns either a pass result or
 *     rejects with `BudgetExhaustedConcernsRemain`.
 *
 * The wrap API is intentionally generic (no direct coupling to
 * `PreCompletionVerifier` or `CriticRerank`) so any verifier-shaped
 * function can be decorated.
 */

// ── Public types ───────────────────────────────────────────

/**
 * Discrete budget tiers for successive verify passes. Pass 0 = LOW,
 * Pass 1 = MEDIUM, Pass 2 = MAX. Naming matches the reasoning-sandwich
 * vocabulary so callers can reuse mental model.
 */
export type BudgetTier = "low" | "medium" | "max";

/**
 * Budget config emitted by `nextPass`. `tokens` targets native
 * thinking-token budgets (Claude / Gemini); `effort` targets o-series
 * reasoning_effort.
 */
export interface BudgetConfig {
  readonly tier: BudgetTier;
  readonly tokens: number;
  readonly effort: "low" | "medium" | "high";
  /** Zero-based pass index this budget was emitted for. */
  readonly passIdx: number;
}

/**
 * Static configuration for the three budget tiers. Defaults chosen to
 * match the B5 sandwich HIGH spec at the top end (8k tokens / high
 * effort) so wrap(sandwich-HIGH, progressive-MAX) lines up naturally
 * for Claude-family callers.
 */
export interface ProgressiveBudgetConfig {
  readonly low: { readonly tokens: number; readonly effort: "low" | "medium" };
  readonly medium: { readonly tokens: number; readonly effort: "low" | "medium" | "high" };
  readonly max: { readonly tokens: number; readonly effort: "medium" | "high" };
  /** Maximum number of passes before `nextPass` throws. Default 3. */
  readonly maxPasses: number;
}

export const DEFAULT_BUDGET_CONFIG: ProgressiveBudgetConfig = Object.freeze({
  low: Object.freeze({ tokens: 2_000, effort: "low" as const }),
  medium: Object.freeze({ tokens: 4_000, effort: "medium" as const }),
  max: Object.freeze({ tokens: 8_000, effort: "high" as const }),
  maxPasses: 3,
});

// ── Error types ────────────────────────────────────────────

/**
 * Structured error thrown when `wrap` exhausts all passes and the
 * wrapped verifier still reports a concern. Holds the final verifier
 * result and every pass's concerns so callers can emit a proper
 * diagnostic message instead of silently passing.
 *
 * Quality Bar #6: honest failure rather than silent success.
 */
export class BudgetExhaustedConcernsRemain<R = unknown> extends Error {
  public readonly lastResult: R;
  public readonly passHistory: readonly PassHistoryEntry<R>[];
  public readonly sessionId: string;

  constructor(sessionId: string, passHistory: readonly PassHistoryEntry<R>[]) {
    const lastResult = (passHistory[passHistory.length - 1]?.result ?? null) as R;
    const passCount = passHistory.length;
    const firstConcerns = passHistory[0]?.concerns ?? [];
    const msg = [
      `Progressive-budget verifier exhausted after ${passCount} pass(es) for session "${sessionId}".`,
      `Concerns remain. First-pass concerns: ${firstConcerns.length ? firstConcerns.join("; ") : "<none captured>"}`,
    ].join(" ");
    super(msg);
    this.name = "BudgetExhaustedConcernsRemain";
    this.lastResult = lastResult;
    this.passHistory = passHistory;
    this.sessionId = sessionId;
  }
}

export interface PassHistoryEntry<R = unknown> {
  readonly passIdx: number;
  readonly budget: BudgetConfig;
  readonly concerns: readonly string[];
  readonly result: R;
  /** Elapsed ms for this pass. */
  readonly durationMs: number;
}

// ── wrap() — decorator for verifiers ────────────────────────

/**
 * A verifier-shaped function. Returns a result + a flag indicating
 * whether the result carries unresolved concerns.
 *
 * The signature is intentionally generic so any verifier can be wrapped
 * (PreCompletionVerifier, CriticRerank, or a caller-supplied closure).
 *
 * @typeParam I — the input type of the verifier (whatever the caller
 *                wants to hand to the inner verifier each pass)
 * @typeParam R — the result type (arbitrary; the wrapper only inspects
 *                the `concerns` side channel)
 */
export type PassVerifier<I, R> = (
  input: I,
  budget: BudgetConfig,
) => Promise<PassVerifierOutcome<R>>;

/** Outcome of a single verifier pass. */
export interface PassVerifierOutcome<R> {
  readonly result: R;
  /**
   * Empty => pass. Non-empty => concerns. Callers MUST return an empty
   * array when satisfied; anything else triggers the next pass.
   */
  readonly concerns: readonly string[];
}

/** Options for `wrap`. */
export interface WrapOptions {
  /** Session/task identifier for per-session state isolation. */
  readonly sessionId: string;
}

/** Result returned when wrap succeeds (verifier passed within budget). */
export interface WrapSuccess<R> {
  readonly result: R;
  readonly passesUsed: number;
  readonly finalBudget: BudgetConfig;
  readonly history: readonly PassHistoryEntry<R>[];
}

// ── Scheduler class ─────────────────────────────────────────

/**
 * ProgressiveBudget — per-pass budget scheduler.
 *
 * Lifecycle:
 *   1. Construct once per runtime. Safe to share across sessions.
 *   2. Per session: each call to `nextPass(sessionId)` returns the
 *      budget for THIS pass, then advances the per-session counter.
 *   3. `reset(sessionId)` clears state for that session so the next
 *      call returns the pass-0 (LOW) budget again.
 *
 * Exception contract:
 *   - `nextPass` throws `RangeError` when called beyond `maxPasses`.
 *     Callers who want non-throwing behaviour should use `wrap()`,
 *     which converts overrun into `BudgetExhaustedConcernsRemain`.
 */
export class ProgressiveBudget {
  private readonly config: ProgressiveBudgetConfig;
  private readonly counters: Map<string, number>;

  constructor(config: Partial<ProgressiveBudgetConfig> = {}) {
    this.config = {
      low: { ...DEFAULT_BUDGET_CONFIG.low, ...(config.low ?? {}) },
      medium: { ...DEFAULT_BUDGET_CONFIG.medium, ...(config.medium ?? {}) },
      max: { ...DEFAULT_BUDGET_CONFIG.max, ...(config.max ?? {}) },
      maxPasses: Number.isFinite(config.maxPasses as number)
        ? Math.floor(config.maxPasses as number)
        : DEFAULT_BUDGET_CONFIG.maxPasses,
    };
    if (this.config.maxPasses < 1) {
      throw new Error(`ProgressiveBudget: maxPasses must be >= 1 (got ${this.config.maxPasses})`);
    }
    this.counters = new Map();
  }

  /**
   * Return the budget for the current pass on this session and advance
   * the session's counter. Throws when the pass index would exceed
   * `maxPasses`.
   */
  nextPass(sessionId: string): BudgetConfig {
    if (!sessionId) {
      throw new Error("ProgressiveBudget.nextPass: sessionId is required");
    }
    const currentIdx = this.counters.get(sessionId) ?? 0;
    if (currentIdx >= this.config.maxPasses) {
      throw new RangeError(
        `ProgressiveBudget: session "${sessionId}" exhausted after ${this.config.maxPasses} passes`,
      );
    }
    const budget = this.budgetForPass(currentIdx);
    this.counters.set(sessionId, currentIdx + 1);
    return budget;
  }

  /**
   * Peek at the next budget without advancing the counter. Useful for
   * diagnostics / tests.
   */
  peekNext(sessionId: string): BudgetConfig | null {
    const currentIdx = this.counters.get(sessionId) ?? 0;
    if (currentIdx >= this.config.maxPasses) return null;
    return this.budgetForPass(currentIdx);
  }

  /**
   * Clear per-session state so the next `nextPass` call returns the
   * pass-0 (LOW) budget. Safe to call on unknown sessionIds.
   */
  reset(sessionId: string): void {
    this.counters.delete(sessionId);
  }

  /** Clear every session's counter. Use between unrelated test runs. */
  resetAll(): void {
    this.counters.clear();
  }

  /** How many passes this session has consumed. 0 means fresh. */
  passesUsed(sessionId: string): number {
    return this.counters.get(sessionId) ?? 0;
  }

  /** Diagnostic: number of sessions with non-zero counters. */
  activeSessionCount(): number {
    return this.counters.size;
  }

  /** Read-only view of the effective config (for tests). */
  getConfig(): Readonly<ProgressiveBudgetConfig> {
    return this.config;
  }

  /**
   * Decorate a verifier with the progressive-budget retry loop.
   *
   * Flow:
   *   - Pass 0: call verifier with LOW budget.
   *     - If `concerns` is empty -> resolve with success.
   *     - Else record in history and escalate.
   *   - Pass 1: call verifier with MEDIUM budget.
   *   - Pass 2: call verifier with MAX budget.
   *   - All passes exhausted AND concerns still non-empty ->
   *     reject with `BudgetExhaustedConcernsRemain`.
   *
   * The returned function does NOT reset the session counter
   * automatically; callers who reuse sessionIds across unrelated
   * tasks must call `reset(sessionId)` themselves. This is deliberate:
   * it lets a caller re-enter wrap mid-task to append more passes on
   * the same budget ladder when needed.
   */
  wrap<I, R>(
    verifier: PassVerifier<I, R>,
    options: WrapOptions,
  ): (input: I) => Promise<WrapSuccess<R>> {
    if (!options.sessionId) {
      throw new Error("ProgressiveBudget.wrap: options.sessionId is required");
    }
    if (typeof verifier !== "function") {
      throw new Error("ProgressiveBudget.wrap: verifier must be a function");
    }

    const sessionId = options.sessionId;

    return async (input: I): Promise<WrapSuccess<R>> => {
      const history: PassHistoryEntry<R>[] = [];

      // Run until we either pass or exhaust.
      while (this.passesUsed(sessionId) < this.config.maxPasses) {
        const passIdx = this.passesUsed(sessionId);
        const budget = this.nextPass(sessionId);
        const start = Date.now();
        let outcome: PassVerifierOutcome<R>;
        try {
          outcome = await verifier(input, budget);
        } catch (err) {
          // Verifier threw. Record the failure as a concern and let the
          // loop decide whether to retry with a higher budget. This is
          // the honest-failure stance: we surface the reason rather than
          // silently swallowing it.
          const msg = err instanceof Error ? err.message : String(err);
          const entry: PassHistoryEntry<R> = {
            passIdx,
            budget,
            concerns: [`verifier threw: ${msg}`],
            // The result slot is filled with a dummy null cast — callers
            // should consult concerns to learn that the pass failed hard.
            result: null as unknown as R,
            durationMs: Date.now() - start,
          };
          history.push(entry);
          continue;
        }

        const entry: PassHistoryEntry<R> = {
          passIdx,
          budget,
          concerns: outcome.concerns,
          result: outcome.result,
          durationMs: Date.now() - start,
        };
        history.push(entry);

        if (outcome.concerns.length === 0) {
          return {
            result: outcome.result,
            passesUsed: passIdx + 1,
            finalBudget: budget,
            history,
          };
        }
        // Concerns present -> next iteration escalates.
      }

      // All passes exhausted and concerns remain.
      throw new BudgetExhaustedConcernsRemain(sessionId, history);
    };
  }

  // ── Private helpers ────────────────────────────────────

  private budgetForPass(passIdx: number): BudgetConfig {
    const tier = tierForPass(passIdx);
    const spec = this.config[tier];
    return {
      tier,
      tokens: spec.tokens,
      effort: spec.effort,
      passIdx,
    };
  }
}

/**
 * Pure helper: map a zero-based pass index to its tier.
 *   0 -> low, 1 -> medium, 2+ -> max
 *
 * Exported for callers that want the mapping without constructing a
 * ProgressiveBudget instance (e.g., documentation generators, tests).
 */
export function tierForPass(passIdx: number): BudgetTier {
  if (passIdx <= 0) return "low";
  if (passIdx === 1) return "medium";
  return "max";
}
