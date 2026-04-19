/**
 * Abstention primitive — Phase H memory upgrade.
 *
 * Lane 3 of LongMemEval (WOTANN's weakest category) specifically grades
 * a memory system on its willingness to say "I don't know" when recall
 * is uncertain. Systems that hallucinate confident-sounding answers from
 * weak retrievals lose points; systems that abstain honestly gain them.
 *
 * This module ships the decision layer on top of hybrid retrieval:
 *
 *   - shouldAbstain(results, thresholds)  — pure boolean check
 *   - buildAbstentionResponse(results, thresholds) — typed response
 *     containing either "I don't know" + reason, or the strongest hit.
 *
 * The thresholds encode three independent signals:
 *   1. Top-1 absolute score — is the best match strong enough at all?
 *   2. Top-1 vs. top-5 spread — is the best match clearly better than
 *      the tail? (A flat distribution means nothing stands out.)
 *   3. Context relevance — a caller-supplied per-hit relevance score
 *      (typically an LLM-graded "does this doc actually answer the
 *      query?" signal). Floor applied to the top-1.
 *
 * If ALL signals fail their thresholds, the system abstains. This is a
 * strict AND, not OR — a single strong signal is enough to answer, but
 * we refuse to guess when every signal is weak.
 *
 * Honest scores, no fabrication (quality bar #6).
 */

import type { SearchHit } from "./extended-search-types.js";

// ── Types ──────────────────────────────────────────────

export interface AbstentionThresholds {
  /** Minimum absolute score for the top-1 hit. Default 0.65. */
  readonly minTop1Score: number;
  /**
   * Minimum gap between top-1 score and the mean of top-5
   * (or however many are available). A small spread means nothing
   * stands out from the tail. Default 0.15.
   */
  readonly minTop1vsTopKSpread: number;
  /**
   * Minimum context-relevance (caller-supplied) floor for the top-1.
   * Optional: if no relevance info is provided, this signal is
   * skipped rather than failed. Default 0.70.
   */
  readonly minContextRelevance: number;
  /**
   * K used for the spread calculation (averaged over top-K excl. top-1).
   * Default 5.
   */
  readonly spreadK: number;
}

export const DEFAULT_THRESHOLDS: AbstentionThresholds = {
  minTop1Score: 0.65,
  minTop1vsTopKSpread: 0.15,
  minContextRelevance: 0.7,
  spreadK: 5,
};

export interface AbstentionInput {
  /** Hits already sorted top-first. */
  readonly hits: readonly SearchHit[];
  /**
   * Optional parallel array of "does this hit ANSWER the query?" scores
   * in [0, 1]. Must match `hits` length if provided. When absent, the
   * context-relevance signal is skipped.
   */
  readonly contextRelevance?: readonly number[];
}

export interface AbstentionDecision {
  readonly abstain: boolean;
  /**
   * Which signals FAILED. Empty array means all signals passed.
   */
  readonly failures: readonly AbstentionSignal[];
  /**
   * Which signals PASSED (were above their threshold).
   */
  readonly passes: readonly AbstentionSignal[];
  /**
   * Signals that were SKIPPED because the caller did not supply
   * required inputs (e.g. no contextRelevance array).
   */
  readonly skipped: readonly AbstentionSignal[];
  /**
   * Actual measured values for each signal, for logging / debug.
   */
  readonly measured: {
    readonly top1Score: number;
    readonly top1vsTopKSpread: number;
    readonly top1ContextRelevance?: number;
  };
}

export type AbstentionSignal = "top1Score" | "top1vsTopKSpread" | "contextRelevance";

export type AbstentionAnswer = "I don't know" | SearchHit;

export interface AbstentionResponse {
  readonly answer: AbstentionAnswer;
  /**
   * Caller-facing confidence in [0, 1]. For answers, the top-1 score
   * clipped to [0, 1]. For abstentions, 1 - top1Score (how confident
   * we are in NOT knowing). Never a fabricated value.
   */
  readonly confidence: number;
  /**
   * Human-readable explanation: either "abstained because …" or
   * "answered because …".
   */
  readonly reason: string;
  /**
   * Raw decision breakdown for telemetry.
   */
  readonly decision: AbstentionDecision;
}

// ── Core decision ──────────────────────────────────────

/**
 * Returns true if the retrieval results are too weak to answer.
 * Pure function — no side effects, no mutation of inputs.
 *
 * Strict AND: abstains only when EVERY applicable signal fails.
 * Rationale: a single strong signal (e.g. exact lexical match) is
 * usually enough to justify an answer, but every-signal-weak is
 * the safe-to-abstain zone.
 */
export function shouldAbstain(
  input: AbstentionInput,
  thresholds: AbstentionThresholds = DEFAULT_THRESHOLDS,
): boolean {
  const decision = evaluate(input, thresholds);
  return decision.abstain;
}

/**
 * Full decision breakdown — every signal's pass/fail/skip state plus
 * the measured values. Useful for logging and telemetry.
 */
export function evaluate(
  input: AbstentionInput,
  thresholds: AbstentionThresholds = DEFAULT_THRESHOLDS,
): AbstentionDecision {
  const measured = measureSignals(input, thresholds);

  const failures: AbstentionSignal[] = [];
  const passes: AbstentionSignal[] = [];
  const skipped: AbstentionSignal[] = [];

  // Signal 1: top-1 absolute score
  if (measured.top1Score < thresholds.minTop1Score) {
    failures.push("top1Score");
  } else {
    passes.push("top1Score");
  }

  // Signal 2: spread
  if (measured.top1vsTopKSpread < thresholds.minTop1vsTopKSpread) {
    failures.push("top1vsTopKSpread");
  } else {
    passes.push("top1vsTopKSpread");
  }

  // Signal 3: context relevance (skippable)
  if (measured.top1ContextRelevance === undefined) {
    skipped.push("contextRelevance");
  } else if (measured.top1ContextRelevance < thresholds.minContextRelevance) {
    failures.push("contextRelevance");
  } else {
    passes.push("contextRelevance");
  }

  // Abstain iff ALL applicable (non-skipped) signals failed.
  const applicable = failures.length + passes.length;
  const abstain = applicable > 0 && failures.length === applicable;

  return { abstain, failures, passes, skipped, measured };
}

/**
 * Build a structured response for downstream consumers: either
 * "I don't know" + reason, or the top-1 hit + confidence.
 */
export function buildAbstentionResponse(
  input: AbstentionInput,
  thresholds: AbstentionThresholds = DEFAULT_THRESHOLDS,
): AbstentionResponse {
  const decision = evaluate(input, thresholds);
  const top1 = input.hits[0];

  if (decision.abstain || top1 === undefined) {
    return {
      answer: "I don't know",
      confidence: clamp01(1 - decision.measured.top1Score),
      reason: buildAbstainReason(decision),
      decision,
    };
  }

  return {
    answer: top1,
    confidence: clamp01(decision.measured.top1Score),
    reason: buildAnswerReason(decision),
    decision,
  };
}

// ── Helpers ────────────────────────────────────────────

function measureSignals(
  input: AbstentionInput,
  thresholds: AbstentionThresholds,
): AbstentionDecision["measured"] {
  const hits = input.hits;
  const top1 = hits[0];

  if (top1 === undefined) {
    return {
      top1Score: 0,
      top1vsTopKSpread: 0,
      top1ContextRelevance: input.contextRelevance?.[0],
    };
  }

  const top1Score = top1.score;

  // Spread = top1 - mean(top2..topK). Needs at least 2 hits.
  const k = Math.max(2, thresholds.spreadK);
  const tail = hits.slice(1, k);
  let spread = 0;
  if (tail.length > 0) {
    let sum = 0;
    for (const h of tail) sum += h.score;
    const tailMean = sum / tail.length;
    spread = top1Score - tailMean;
  } else {
    // If there is literally only one hit, treat spread as "maximally
    // ambiguous" — you can't confirm a top-1 is better than its tail
    // when there is no tail. This biases toward abstention when
    // retrieval returns exactly one weak hit.
    spread = 0;
  }

  const top1Relevance =
    input.contextRelevance && input.contextRelevance.length > 0
      ? input.contextRelevance[0]
      : undefined;

  return {
    top1Score,
    top1vsTopKSpread: spread,
    top1ContextRelevance: top1Relevance,
  };
}

function buildAbstainReason(decision: AbstentionDecision): string {
  if (decision.failures.length === 0) {
    return "No retrieval hits returned";
  }
  const parts: string[] = [];
  const m = decision.measured;
  if (decision.failures.includes("top1Score")) {
    parts.push(`top-1 score ${m.top1Score.toFixed(3)} below threshold`);
  }
  if (decision.failures.includes("top1vsTopKSpread")) {
    parts.push(`top-1 vs. tail spread ${m.top1vsTopKSpread.toFixed(3)} below threshold`);
  }
  if (decision.failures.includes("contextRelevance") && m.top1ContextRelevance !== undefined) {
    parts.push(`context relevance ${m.top1ContextRelevance.toFixed(3)} below threshold`);
  }
  return `Abstained: ${parts.join("; ")}`;
}

function buildAnswerReason(decision: AbstentionDecision): string {
  const m = decision.measured;
  const parts: string[] = [`top-1 score ${m.top1Score.toFixed(3)}`];
  parts.push(`spread ${m.top1vsTopKSpread.toFixed(3)}`);
  if (m.top1ContextRelevance !== undefined) {
    parts.push(`relevance ${m.top1ContextRelevance.toFixed(3)}`);
  }
  return `Answered: ${parts.join(", ")} — ${decision.passes.length} signal(s) passed`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ── Convenience: combine with an arbitrary hybrid result ─

/**
 * Convenience overload for callers using the `hybridSearch` return
 * type: feed it directly, get a response. No coupling — we only use
 * the `hits` field.
 */
export function buildAbstentionFromHits(
  hits: readonly SearchHit[],
  thresholds: AbstentionThresholds = DEFAULT_THRESHOLDS,
  contextRelevance?: readonly number[],
): AbstentionResponse {
  return buildAbstentionResponse({ hits, contextRelevance }, thresholds);
}
