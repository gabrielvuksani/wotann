/**
 * Shared types for the evals subsystem:
 *   - G-Eval (LLM-as-judge with chain-of-thought)
 *   - Ragas (Retrieval-Augmented Generation Assessment)
 *   - OWASP LLM Top 10 red-team harness
 *
 * Design rules:
 *   - Every metric + attack requires a caller-injected LLM; nothing is
 *     hardcoded to Claude/GPT/Gemini.
 *   - Scores are always in a defined range (usually [0, 1]); out-of-range
 *     values are clamped defensively.
 *   - We distinguish "ran" from "passed" — a metric can score a response
 *     low (valid result) vs. failing to score at all (unavailable judge).
 *   - Attack corpora are plain data, not executable — they are prompts the
 *     red-team harness feeds to the target system.
 */

// ── LLM contract ─────────────────────────────────────

/**
 * Minimal LLM contract the evals subsystem needs. Callers inject any
 * provider that satisfies this interface.
 */
export interface EvalLlm {
  readonly query: (prompt: string) => Promise<string>;
  /** Optional name used for audit logs. */
  readonly name?: string;
}

// ── G-Eval ─────────────────────────────────────────

export type GEvalScoreScale = 1 | 3 | 5 | 10;

export type GEvalAggregator = "mean" | "min" | "max" | "weighted";

export interface GEvalCriterion {
  readonly name: string;
  readonly description: string;
  /** Integer score scale: 1..scoreScale. */
  readonly scoreScale: GEvalScoreScale;
  /** Optional weight used only by "weighted" aggregator. Default 1. */
  readonly weight?: number;
  /**
   * Optional bullet-list of what each score on the scale means. If
   * present we inject it into the judge prompt for better calibration.
   */
  readonly rubric?: readonly string[];
}

export interface GEvalRubric {
  readonly criteria: readonly GEvalCriterion[];
  readonly aggregator: GEvalAggregator;
}

export interface GEvalCriterionScore {
  readonly criterion: string;
  /** Raw score in [1, scoreScale]. NaN when judge failed. */
  readonly score: number;
  /** Normalized score in [0, 1]. */
  readonly normalized: number;
  /** Chain-of-thought reasoning the judge produced (truncated for storage). */
  readonly reasoning: string;
  /** True if the judge abstained (returned NaN / unparseable / timeout). */
  readonly abstained: boolean;
}

export interface GEvalResult {
  readonly scores: readonly GEvalCriterionScore[];
  /** Aggregate of normalized scores. NaN if every criterion abstained. */
  readonly aggregate: number;
  /** Number of criteria that abstained. */
  readonly abstentions: number;
  /** Number of LLM calls made. */
  readonly callsMade: number;
}

// ── Ragas ─────────────────────────────────────────

/**
 * A single Ragas test case. We don't care where the retrieval came from —
 * the question, the retrieved contexts, and the generated answer are all
 * supplied. The metric then evaluates the answer against those.
 */
export interface RagasSample {
  readonly question: string;
  /** Retrieved passages the system used to answer the question. */
  readonly contexts: readonly string[];
  /** The system's generated answer. */
  readonly answer: string;
  /**
   * Optional ground-truth answer. Required by `answer_correctness` but
   * optional for faithfulness + context_precision.
   */
  readonly groundTruth?: string;
}

export type RagasMetricName =
  | "faithfulness"
  | "answer_relevancy"
  | "context_precision"
  | "context_recall";

export interface RagasMetricResult {
  readonly metric: RagasMetricName;
  /** Score in [0, 1]. NaN if the metric couldn't run. */
  readonly score: number;
  /** Per-metric detail (useful for debugging / audit). */
  readonly details: Readonly<Record<string, unknown>>;
  readonly abstained: boolean;
}

export interface RagasReport {
  readonly metrics: readonly RagasMetricResult[];
  /** Mean of the ran metrics (ignores abstentions). NaN if all abstained. */
  readonly aggregate: number;
  readonly callsMade: number;
}

// ── OWASP LLM Top 10 ────────────────────────────

/**
 * OWASP LLM Top 10 categories (2023 draft kept stable here). Each
 * category ships with a small hand-curated corpus of attack payloads.
 * The red-team harness iterates each payload through the target system
 * and records whether the system "blocked" (safe) or "complied"
 * (unsafe).
 */
export type OwaspLlmCategory =
  | "LLM01_PROMPT_INJECTION"
  | "LLM02_INSECURE_OUTPUT_HANDLING"
  | "LLM03_TRAINING_DATA_POISONING"
  | "LLM04_MODEL_DOS"
  | "LLM05_SUPPLY_CHAIN"
  | "LLM06_SENSITIVE_INFORMATION_DISCLOSURE"
  | "LLM07_INSECURE_PLUGIN_DESIGN"
  | "LLM08_EXCESSIVE_AGENCY"
  | "LLM09_OVERRELIANCE"
  | "LLM10_MODEL_THEFT";

export interface AttackCase {
  readonly id: string;
  readonly category: OwaspLlmCategory;
  /** The payload that gets sent to the target system. */
  readonly payload: string;
  /**
   * A short string the attack is trying to elicit. If the target's
   * response contains this substring (case-insensitive) we consider
   * the attack successful.
   */
  readonly winCondition: string;
  /**
   * Optional description shown in audit logs.
   */
  readonly description?: string;
}

export interface AttackRunResult {
  readonly case: AttackCase;
  /** Target system's response (possibly truncated). */
  readonly response: string;
  /** True when the attack succeeded (target complied unsafely). */
  readonly succeeded: boolean;
  /** True when the target system emitted an explicit refusal. */
  readonly blocked: boolean;
  /** Optional error if the target errored out. */
  readonly errorMessage?: string;
  /** Wall-clock ms. */
  readonly durationMs: number;
}

export interface RedTeamReport {
  readonly category: OwaspLlmCategory;
  readonly results: readonly AttackRunResult[];
  readonly totalCases: number;
  readonly successfulAttacks: number;
  readonly blockedAttacks: number;
  readonly errors: number;
  /** successfulAttacks / totalCases (in [0, 1]). Higher = worse for target. */
  readonly attackSuccessRate: number;
}

// ── Utility helpers ────────────────────────────

/**
 * Clamp a score to [lo, hi]. NaN passes through unchanged so callers
 * can detect abstention.
 */
export function clampScore(score: number, lo = 0, hi = 1): number {
  if (Number.isNaN(score)) return NaN;
  if (score < lo) return lo;
  if (score > hi) return hi;
  return score;
}

/**
 * Normalize a raw score on scale [1, scaleMax] to [0, 1]. scaleMax=1
 * always yields 0.5 (single-level scales are degenerate).
 */
export function normalizeOnScale(score: number, scaleMax: GEvalScoreScale): number {
  if (Number.isNaN(score)) return NaN;
  if (scaleMax === 1) return 0.5;
  const clamped = Math.max(1, Math.min(scaleMax, score));
  return (clamped - 1) / (scaleMax - 1);
}
