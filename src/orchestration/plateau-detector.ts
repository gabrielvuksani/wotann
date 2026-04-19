/**
 * Plateau Detector — delta-over-window scoring detection.
 *
 * PART OF: long-horizon orchestrator (autonovel-style, Phase H+D).
 *
 * Signal: when improvement across N iterations stays below a delta threshold,
 * the worker is plateaued. Continuing to iterate wastes budget; the
 * orchestrator should escalate model tier, request human review, or abort.
 *
 * Detector state is INTENTIONALLY pure — each call receives the iteration
 * history and returns a verdict. This makes it trivial to unit-test
 * plateau/non-plateau shapes and to swap the detection rule later.
 *
 * Three signals are combined:
 *   1. Absolute delta: max(scores[-N:]) - min(scores[-N:]) < threshold
 *   2. Monotonic drop: scores strictly decreasing for N (regression plateau)
 *   3. Oscillation:    scores bouncing within ±threshold around a midline
 *
 * Any one signal triggers a plateau verdict.
 */

// ── Types ──────────────────────────────────────────────

export interface PlateauConfig {
  /** Window size: how many recent iterations to consider. */
  readonly windowSize: number;
  /** Max score delta across the window that still counts as "no progress". */
  readonly deltaThreshold: number;
  /** Require at least this many iterations before any plateau check fires. */
  readonly minIterations: number;
}

export type PlateauKind = "absolute-delta" | "monotonic-drop" | "oscillation" | null;

export interface PlateauVerdict {
  readonly plateaued: boolean;
  readonly kind: PlateauKind;
  readonly reason: string;
  readonly windowScores: readonly number[];
  readonly delta: number;
}

export const DEFAULT_PLATEAU_CONFIG: PlateauConfig = {
  windowSize: 5,
  deltaThreshold: 0.02,
  minIterations: 5,
};

// ── Detector ───────────────────────────────────────────

/**
 * Examine the last N iteration scores and decide whether the worker is
 * plateaued. Returns a structured verdict so callers can log or branch on
 * which plateau kind fired.
 *
 * Contract:
 *   - history.length < minIterations → NOT plateaued (too early to say)
 *   - history.length < windowSize    → NOT plateaued (insufficient window)
 *   - All three signals checked in order; first hit wins.
 */
export function detectPlateau(
  scores: readonly number[],
  config: PlateauConfig = DEFAULT_PLATEAU_CONFIG,
): PlateauVerdict {
  if (config.windowSize < 2) {
    throw new Error(`plateau window size must be >= 2 (got ${config.windowSize})`);
  }

  if (scores.length < config.minIterations || scores.length < config.windowSize) {
    return {
      plateaued: false,
      kind: null,
      reason: `insufficient history (${scores.length}/${Math.max(config.minIterations, config.windowSize)})`,
      windowScores: scores,
      delta: 0,
    };
  }

  const window = scores.slice(-config.windowSize);
  const minScore = Math.min(...window);
  const maxScore = Math.max(...window);
  const delta = maxScore - minScore;

  // Signal 1: absolute delta too small
  if (delta < config.deltaThreshold) {
    return {
      plateaued: true,
      kind: "absolute-delta",
      reason: `score delta ${delta.toFixed(4)} < threshold ${config.deltaThreshold.toFixed(4)} over ${config.windowSize} iters`,
      windowScores: window,
      delta,
    };
  }

  // Signal 2: monotonically decreasing (worker is regressing)
  if (isMonotonicDrop(window)) {
    return {
      plateaued: true,
      kind: "monotonic-drop",
      reason: `scores strictly decreasing for ${config.windowSize} iters`,
      windowScores: window,
      delta,
    };
  }

  // Signal 3: oscillation around a tight midline
  if (isOscillating(window, config.deltaThreshold)) {
    return {
      plateaued: true,
      kind: "oscillation",
      reason: `scores oscillating within ±${config.deltaThreshold.toFixed(4)} over ${config.windowSize} iters`,
      windowScores: window,
      delta,
    };
  }

  return {
    plateaued: false,
    kind: null,
    reason: `delta ${delta.toFixed(4)} > threshold ${config.deltaThreshold.toFixed(4)}`,
    windowScores: window,
    delta,
  };
}

// ── Shape detectors ────────────────────────────────────

/**
 * True if the window is strictly decreasing (worker is regressing).
 * Allows no equal pairs — any plateau of equal values signals stagnation
 * too, but that's caught by signal #1 (absolute delta).
 */
function isMonotonicDrop(window: readonly number[]): boolean {
  if (window.length < 2) return false;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const curr = window[i];
    if (prev === undefined || curr === undefined) return false;
    if (curr >= prev) return false;
  }
  return true;
}

/**
 * True if the window alternates direction with every step AND stays within
 * delta threshold of the mean. A classic "up-down-up-down" trajectory around
 * a fixed value means the worker is stuck.
 */
function isOscillating(window: readonly number[], deltaThreshold: number): boolean {
  if (window.length < 3) return false;

  const mean = window.reduce((sum, x) => sum + x, 0) / window.length;

  // All points must be within delta of the mean (tight band)
  for (const v of window) {
    if (Math.abs(v - mean) > deltaThreshold) return false;
  }

  // Direction must flip at least floor((N-1)/2) times — more than random
  let flips = 0;
  for (let i = 2; i < window.length; i++) {
    const a = window[i - 2];
    const b = window[i - 1];
    const c = window[i];
    if (a === undefined || b === undefined || c === undefined) continue;
    const upDown = b > a && c < b;
    const downUp = b < a && c > b;
    if (upDown || downUp) flips++;
  }
  const requiredFlips = Math.floor((window.length - 1) / 2);
  return flips >= requiredFlips;
}

// ── Escalation advisor ────────────────────────────────

export type PlateauResponse = "escalate-tier" | "request-human" | "abort" | "continue";

/**
 * Given a plateau verdict + how long we've been plateaued, recommend a
 * response. The orchestrator owns the actual action (model swap, human
 * callback, abort); this is just policy advice so the decision logic is
 * centralized and testable.
 *
 * Rules:
 *   - Not plateaued              → continue
 *   - First plateau detection    → escalate-tier (try a stronger model)
 *   - Plateau persists after 1x  → request-human (we're stuck)
 *   - Plateau persists after 2x  → abort (respect budget, fail honestly)
 */
export function recommendPlateauResponse(
  verdict: PlateauVerdict,
  consecutivePlateauVerdicts: number,
): PlateauResponse {
  if (!verdict.plateaued) return "continue";
  if (consecutivePlateauVerdicts <= 1) return "escalate-tier";
  if (consecutivePlateauVerdicts === 2) return "request-human";
  return "abort";
}
