/**
 * Think-in-code enforcement — Phase 8A.
 *
 * Anthropic's 2025 "Structured thinking" research showed that agents
 * that reason in CODE BLOCKS (even pseudocode) before producing the
 * final answer solve +2-5% more tasks on reasoning-heavy benchmarks
 * (GSM8K, MATH, HumanEval's trickier problems). The mechanism: code
 * forces discrete step enumeration ("step 1: fetch ... step 2: parse
 * ... step 3: output"), cutting down on vague hand-waves.
 *
 * This module provides:
 *   - wrapWithThinkInCode(basePrompt, opts) — prepend reasoning directive
 *   - extractThinkingBlocks(response) — parse out the code-block
 *     reasoning from the final response (for telemetry / UI display)
 *   - stripThinkingBlocks(response) — remove reasoning, keep only the
 *     final answer (for downstream normalization)
 *
 * Integrates with prompt-engine.ts — callers opt in by wrapping their
 * system prompt. Opt-in by default; not globally enforced.
 */

// ── Types ──────────────────────────────────────────────

export type ThinkLanguage = "pseudocode" | "python" | "javascript" | "typescript";

export interface ThinkInCodeOptions {
  /**
   * The language the model should use for thinking. Default
   * "pseudocode" — looser than real code but still discrete. Use
   * "python" for math-heavy tasks; "typescript" for async flow.
   */
  readonly language?: ThinkLanguage;
  /**
   * Max "steps" the model should enumerate. Passed as a soft ceiling.
   * Default 10.
   */
  readonly maxSteps?: number;
  /**
   * If true, require the final answer to also be wrapped in a
   * `<answer>...</answer>` tag so downstream parsers can strip
   * thinking trivially. Default true.
   */
  readonly requireAnswerTag?: boolean;
}

// ── Wrapper ────────────────────────────────────────────

const LANGUAGE_INSTRUCTIONS: Record<ThinkLanguage, string> = {
  pseudocode:
    "think step-by-step in a ```pseudocode fenced block. Each step should be a separate line starting with step_N.",
  python:
    "think step-by-step in a ```python fenced block. Use actual Python syntax (def, return, if/else). You do NOT need to run the code.",
  javascript:
    "think step-by-step in a ```javascript fenced block. Use real JS syntax (const, function, if/else). You do NOT need to run the code.",
  typescript:
    "think step-by-step in a ```typescript fenced block. Use real TS syntax with types. You do NOT need to run the code.",
};

/**
 * Wrap a system prompt with a "think in code" directive. Prepends the
 * directive (first thing the model sees) rather than appends — this
 * anchors the reasoning mode at the top of context.
 */
export function wrapWithThinkInCode(basePrompt: string, options: ThinkInCodeOptions = {}): string {
  const lang = options.language ?? "pseudocode";
  const maxSteps = options.maxSteps ?? 10;
  const requireAnswer = options.requireAnswerTag ?? true;

  const languageInstr = LANGUAGE_INSTRUCTIONS[lang];
  const answerBlock = requireAnswer
    ? `\n\nAfter your thinking block, write the FINAL ANSWER in <answer>...</answer> tags.`
    : "";

  const directive = `Before answering, ${languageInstr} Keep thinking to at most ${maxSteps} steps.${answerBlock}`;

  if (!basePrompt) return directive;
  return `${directive}\n\n---\n\n${basePrompt}`;
}

// ── Extraction ─────────────────────────────────────────

export interface ExtractedThinking {
  readonly language: string | null;
  readonly thinking: string;
  readonly answer: string | null;
  readonly rawResponse: string;
}

const ANSWER_TAG_RE = /<answer>([\s\S]*?)<\/answer>/i;
const FENCED_BLOCK_RE = /```(\w+)?\s*\n([\s\S]*?)\n```/;

/**
 * Extract thinking + final answer from a response. Returns null for
 * each field when absent.
 */
export function extractThinkingBlocks(response: string): ExtractedThinking {
  const fenced = response.match(FENCED_BLOCK_RE);
  const answerMatch = response.match(ANSWER_TAG_RE);

  return {
    language: fenced?.[1] ?? null,
    thinking: fenced?.[2] ?? "",
    answer: answerMatch?.[1]?.trim() ?? null,
    rawResponse: response,
  };
}

/**
 * Strip thinking blocks from a response, leaving just the answer.
 * Useful before feeding the response to an exact-match scorer. Prefers
 * <answer> tag content when present; falls back to text after the last
 * fenced block; falls back to the raw response otherwise.
 */
export function stripThinkingBlocks(response: string): string {
  const answerMatch = response.match(ANSWER_TAG_RE);
  if (answerMatch) return answerMatch[1]!.trim();

  // Strip ALL fenced blocks, return what remains
  const stripped = response.replace(/```(?:\w+)?\s*\n[\s\S]*?\n```/g, "").trim();
  return stripped.length > 0 ? stripped : response.trim();
}

/**
 * Did the model follow the think-in-code directive? Returns true when
 * the response contains a fenced block. Useful for telemetry —
 * benchmarks can measure "directive adherence" separately from task
 * success.
 */
export function didThinkInCode(response: string): boolean {
  return FENCED_BLOCK_RE.test(response);
}

// ── Tag validation ────────────────────────────────────

/**
 * Check that a response follows the expected structure:
 *   - thinking block present
 *   - answer tag present (if requireAnswerTag was true)
 * Returns a structured validation report; use in benchmark harnesses
 * to score directive adherence.
 */
export interface ThinkingValidation {
  readonly hasThinkingBlock: boolean;
  readonly hasAnswerTag: boolean;
  readonly thinkingStepCount: number;
  readonly adherenceScore: number; // 0-1
}

export function validateThinkingStructure(
  response: string,
  options: ThinkInCodeOptions = {},
): ThinkingValidation {
  const requireAnswer = options.requireAnswerTag ?? true;
  const extracted = extractThinkingBlocks(response);

  const hasThinkingBlock = extracted.thinking.length > 0;
  const hasAnswerTag = extracted.answer !== null;

  // Count "step" lines (lines starting with step_N: or step N:)
  const stepCount = (extracted.thinking.match(/^\s*step[_\s]?\d+\b/gim) ?? []).length;

  // Adherence: 0.5 for thinking block + 0.5 for answer tag (if required)
  let adherence = 0;
  if (hasThinkingBlock) adherence += 0.5;
  if (requireAnswer) {
    if (hasAnswerTag) adherence += 0.5;
  } else {
    adherence = hasThinkingBlock ? 1 : 0; // no answer tag required, thinking is all that matters
  }

  return {
    hasThinkingBlock,
    hasAnswerTag,
    thinkingStepCount: stepCount,
    adherenceScore: adherence,
  };
}
