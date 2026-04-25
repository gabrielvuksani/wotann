/**
 * TextGrad — shared types for textual gradient computation.
 *
 * Inspired by:
 *  - TextGrad (Yuksekgonul et al. 2024, arXiv:2406.07496) — "automatic
 *    differentiation via text", treats LLM critique as a gradient signal.
 *  - AdalFlow's "Trainable" prompt parameter pattern — prompts are values
 *    that can be optimized like weights.
 *
 * This module is the contract between the critic (which produces feedback
 * on a prompt+output pair) and the optimizer (which applies that feedback
 * as an edit).
 *
 * No LLM calls live here — these are pure types + small helpers.
 */

// ── Core Types ─────────────────────────────────────────

/**
 * The minimal LLM contract TextGrad needs. Callers inject any provider
 * that conforms to this — never hardcoded to Claude/GPT/Gemini.
 *
 * `query()` takes a single prompt string and returns the model's response.
 * Implementations are responsible for retries, timeouts, and rate limits.
 */
export interface TextGradLlm {
  readonly query: (prompt: string) => Promise<string>;
  /** Optional: human-readable name used for telemetry/audit logs. */
  readonly name?: string;
}

/**
 * One training instance: an input the prompt is supposed to handle.
 */
export interface TaskInstance {
  readonly id: string;
  readonly input: string;
  /**
   * Optional reference output. If absent, the critic must judge the
   * actual output against the task description alone.
   */
  readonly expected?: string;
  /** Free-form description of what success looks like. */
  readonly description?: string;
}

/**
 * A failed run: what the prompt produced when given the task input.
 */
export interface TaskFailure {
  readonly taskId: string;
  readonly actualOutput: string;
  /** Optional error message if the run threw. */
  readonly errorMessage?: string;
  /** Score in [0, 1]. 0 = total failure; 1 = perfect (so usually <1 for failures). */
  readonly score: number;
}

/**
 * The "textual gradient" produced by the critic. This is the natural-language
 * analog of a numeric gradient: it tells the optimizer in which direction
 * to edit the prompt, with a confidence weight.
 */
export interface TextGradFeedback {
  /** What the critic thinks went wrong. */
  readonly failureDescription: string;
  /**
   * Concrete suggested edit. Format is loose — usually a sentence describing
   * what to change. The optimizer applies this with a learning rate.
   */
  readonly suggestedEdit: string;
  /**
   * Confidence in [0, 1]. Below `abstainThreshold` (default 0.4), the
   * optimizer skips the update — better to stay at current prompt than
   * descend on a noisy gradient.
   */
  readonly confidence: number;
  /** Optional raw critic response for audit. */
  readonly rawCriticResponse?: string;
}

/**
 * Result of attempting a gradient update.
 */
export type GradientUpdateResult =
  | { readonly ok: true; readonly newPrompt: string; readonly applied: TextGradFeedback }
  | { readonly ok: false; readonly reason: string; readonly originalPrompt: string };

/**
 * Result of computing a gradient.
 */
export type GradientComputeResult =
  | { readonly ok: true; readonly gradient: TextGradFeedback }
  | { readonly ok: false; readonly reason: string };

// ── Helpers ────────────────────────────────────────────

/**
 * Default abstention threshold for low-confidence gradients.
 * Matches TextGrad paper recommendation (§3.2).
 */
export const DEFAULT_ABSTAIN_THRESHOLD = 0.4;

/**
 * Default learning rate for gradient application. 0..1 where:
 *   0   = no update (frozen)
 *   0.5 = moderate edit (preserve structure, tweak wording)
 *   1.0 = full rewrite according to suggestedEdit
 */
export const DEFAULT_LEARNING_RATE = 0.5;

/**
 * Clamp a learning rate into [0, 1]. Above 1 is clipped (with caller
 * notified via the optimizer's onClampWarning callback when present).
 */
export function clampLearningRate(lr: number): {
  readonly value: number;
  readonly wasClamped: boolean;
} {
  if (Number.isNaN(lr)) return { value: DEFAULT_LEARNING_RATE, wasClamped: true };
  if (lr < 0) return { value: 0, wasClamped: true };
  if (lr > 1) return { value: 1, wasClamped: true };
  return { value: lr, wasClamped: false };
}

/**
 * Validate a `TextGradFeedback` shape (fields present, confidence in [0, 1]).
 * Returns null if valid, or an error message describing the violation.
 */
export function validateFeedback(feedback: TextGradFeedback): string | null {
  if (typeof feedback.failureDescription !== "string" || feedback.failureDescription.length === 0) {
    return "failureDescription must be a non-empty string";
  }
  if (typeof feedback.suggestedEdit !== "string" || feedback.suggestedEdit.length === 0) {
    return "suggestedEdit must be a non-empty string";
  }
  if (
    typeof feedback.confidence !== "number" ||
    Number.isNaN(feedback.confidence) ||
    feedback.confidence < 0 ||
    feedback.confidence > 1
  ) {
    return "confidence must be a number in [0, 1]";
  }
  return null;
}
