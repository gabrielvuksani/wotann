/**
 * Answer confidence calibration.
 *
 * Not every model output deserves equal trust. A hedged "maybe it's X"
 * should be treated differently from a decisive "the answer is X".
 * Without calibration, benchmark scorers count both as "answered"
 * even when one is a guess. With calibration we can REJECT low-
 * confidence answers (return "unsure" → fall back to human-ask or
 * retry with a stronger model).
 *
 * Three independent signals combine into a confidence score:
 *   1. Hedge-detection: count phrases like "I think", "maybe", "not sure"
 *   2. Consistency: if the caller ran N samples, fraction that agree
 *   3. Self-scored: ask the model to rate its own confidence 0-1
 *
 * The caller picks which signals to enable. The calibrator fuses them
 * into a single score + confidence band (high/medium/low/reject).
 *
 * No LLM calls in this module — caller supplies the confidence query.
 */

// ── Types ──────────────────────────────────────────────

export type ConfidenceBand = "high" | "medium" | "low" | "reject";

export interface ConfidenceSignals {
  /** Raw model output. */
  readonly text: string;
  /**
   * Optional: N additional samples from the same prompt. Used for
   * consistency scoring.
   */
  readonly samples?: readonly string[];
  /**
   * Optional: self-scored confidence 0-1 (model's own estimate).
   */
  readonly selfScore?: number;
}

export interface ConfidenceResult {
  /** Fused score 0-1, higher = more confident. */
  readonly score: number;
  /** Discrete band derived from score thresholds. */
  readonly band: ConfidenceBand;
  /** Per-signal scores (for debugging + calibration). */
  readonly components: {
    readonly hedgeScore: number; // 0-1; 1 = no hedges
    readonly consistencyScore: number | null; // null = not computed
    readonly selfScore: number | null;
  };
  /** Human-readable reason. */
  readonly reason: string;
}

export interface CalibratorOptions {
  /** Threshold for "high". Default 0.8. */
  readonly highThreshold?: number;
  /** Threshold for "medium". Default 0.6. */
  readonly mediumThreshold?: number;
  /** Threshold for "low" (below this = reject). Default 0.3. */
  readonly lowThreshold?: number;
  /** Weights for fusion. Default: 0.3 hedge, 0.4 consistency, 0.3 self. */
  readonly weights?: {
    readonly hedge?: number;
    readonly consistency?: number;
    readonly self?: number;
  };
}

// ── Hedge detection ───────────────────────────────────

const HEDGE_PATTERNS: readonly RegExp[] = [
  /\b(I think|I believe|I guess|I suppose|I'm not sure|I'm unsure)\b/gi,
  /\b(maybe|perhaps|possibly|probably|likely)\b/gi,
  /\b(could be|might be|may be)\b/gi,
  /\b(not certain|uncertain|unclear|ambiguous)\b/gi,
  /\b(approximately|roughly|about|around|kind of|sort of)\b/gi,
  /\b(if I recall|if I remember|if I'm not mistaken)\b/gi,
];

/**
 * Score 0-1 based on hedge density. 1 = no hedges (confident);
 * 0 = heavy hedging.
 */
export function hedgeScore(text: string): number {
  if (!text) return 0;
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount === 0) return 0;

  let hedgeCount = 0;
  for (const re of HEDGE_PATTERNS) {
    const matches = text.match(re);
    if (matches) hedgeCount += matches.length;
  }

  // 1 hedge in 100 words ~= 0.9; 5 hedges ~= 0.5
  const density = hedgeCount / Math.max(1, wordCount / 100);
  const score = Math.max(0, 1 - density * 0.1);
  return Math.min(1, score);
}

// ── Consistency scoring ───────────────────────────────

/**
 * Fraction of samples whose normalized answer matches the primary.
 * 1 = all agree; 0 = all differ; only the final "normalized" token
 * is compared (first line lowercased + trimmed).
 */
export function consistencyScore(primary: string, samples: readonly string[]): number {
  if (samples.length === 0) return 1; // nothing to disagree with
  const normalize = (s: string) => {
    const firstLine = s.split("\n")[0] ?? "";
    return firstLine.trim().toLowerCase();
  };
  const target = normalize(primary);
  let matches = 0;
  for (const s of samples) {
    if (normalize(s) === target) matches++;
  }
  return matches / samples.length;
}

// ── Fusion ─────────────────────────────────────────────

export function calibrateConfidence(
  signals: ConfidenceSignals,
  options: CalibratorOptions = {},
): ConfidenceResult {
  const highThreshold = options.highThreshold ?? 0.8;
  const mediumThreshold = options.mediumThreshold ?? 0.6;
  const lowThreshold = options.lowThreshold ?? 0.3;
  const weights = {
    hedge: options.weights?.hedge ?? 0.3,
    consistency: options.weights?.consistency ?? 0.4,
    self: options.weights?.self ?? 0.3,
  };

  const hedge = hedgeScore(signals.text);
  const consistency =
    signals.samples && signals.samples.length > 0
      ? consistencyScore(signals.text, signals.samples)
      : null;
  const self = signals.selfScore !== undefined ? Math.max(0, Math.min(1, signals.selfScore)) : null;

  // Weighted fusion — re-normalize over available signals
  let weightSum = 0;
  let scoreSum = 0;
  const components = { hedgeScore: hedge, consistencyScore: consistency, selfScore: self };
  scoreSum += hedge * weights.hedge;
  weightSum += weights.hedge;
  if (consistency !== null) {
    scoreSum += consistency * weights.consistency;
    weightSum += weights.consistency;
  }
  if (self !== null) {
    scoreSum += self * weights.self;
    weightSum += weights.self;
  }
  const score = weightSum > 0 ? scoreSum / weightSum : 0;

  let band: ConfidenceBand;
  if (score >= highThreshold) band = "high";
  else if (score >= mediumThreshold) band = "medium";
  else if (score >= lowThreshold) band = "low";
  else band = "reject";

  const reasonParts: string[] = [`score=${score.toFixed(3)}`];
  reasonParts.push(`hedge=${hedge.toFixed(2)}`);
  if (consistency !== null) reasonParts.push(`consistency=${consistency.toFixed(2)}`);
  if (self !== null) reasonParts.push(`self=${self.toFixed(2)}`);

  return {
    score,
    band,
    components,
    reason: reasonParts.join(", "),
  };
}

// ── Self-scoring prompt ───────────────────────────────

/**
 * Build a prompt that asks the model to rate its own confidence in an
 * answer 0-1. Used by callers who want to wire self-score into
 * calibrateConfidence.
 */
export function buildSelfScorePrompt(question: string, answer: string): string {
  return `Rate your confidence that the following answer is correct on a scale of 0 to 1 (where 0 = random guess, 1 = absolutely certain). Output ONLY a single decimal number.

Question: ${question}

Your Answer: ${answer}

Confidence (0-1):`;
}

/**
 * Parse a self-score response. Accepts "0.85", "0.85/1.0", "85%",
 * "about 0.7". Returns null on unparseable input.
 */
export function parseSelfScore(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Percent form: "85%"
  const pctMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    const num = Number(pctMatch[1]);
    if (!Number.isNaN(num)) return Math.max(0, Math.min(1, num / 100));
  }

  // Decimal form: "0.85" possibly followed by "/1.0"
  const decMatch = trimmed.match(/(\d+\.\d+|\d+)/);
  if (decMatch) {
    const num = Number(decMatch[1]);
    if (!Number.isNaN(num)) return Math.max(0, Math.min(1, num));
  }

  return null;
}
