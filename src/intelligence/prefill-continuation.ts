/**
 * Thinking-Only Prefill Continuation.
 *
 * When a model's response starts with a thinking/reasoning block but gets
 * truncated (hits max tokens mid-thought), this module detects it and
 * provides the data needed to automatically continue generation with the
 * thinking prefix preserved.
 *
 * Supports three thinking formats:
 * - XML-style: <thinking>...</thinking>
 * - Bracket-style: [thinking]...[/thinking]
 * - Prose-style: "Thinking..." or "Let me think..." without conclusion
 */

// ── Types ──────────────────────────────────────────────────────

export interface PrefillResult {
  readonly needsContinuation: boolean;
  readonly thinkingPrefix: string;
  readonly truncatedAt: number;
}

// ── Thinking Pattern Detection ─────────────────────────────────

/** Known opening/closing tag pairs for thinking blocks. */
const THINKING_PAIRS: ReadonlyArray<{ open: RegExp; close: RegExp; tag: string }> = [
  { open: /<thinking>/i, close: /<\/thinking>/i, tag: "thinking" },
  { open: /<reflection>/i, close: /<\/reflection>/i, tag: "reflection" },
  { open: /<reasoning>/i, close: /<\/reasoning>/i, tag: "reasoning" },
  { open: /<analysis>/i, close: /<\/analysis>/i, tag: "analysis" },
  { open: /\[thinking\]/i, close: /\[\/thinking\]/i, tag: "thinking-bracket" },
  { open: /\[reasoning\]/i, close: /\[\/reasoning\]/i, tag: "reasoning-bracket" },
];

/** Prose-style thinking indicators that suggest an ongoing thought process. */
const THINKING_PROSE_STARTS: readonly RegExp[] = [
  /^Thinking\.\.\./m,
  /^Let me think/m,
  /^I need to reason/m,
  /^First, let me analyze/m,
  /^Let me work through/m,
  /^Reasoning step/m,
];

/** Conclusion markers that indicate the model finished its thinking. */
const CONCLUSION_MARKERS: readonly RegExp[] = [
  /\b(therefore|thus|in conclusion|to summarize|in summary|the answer is|my conclusion|final answer)\b/i,
  /^##?\s+(Answer|Result|Conclusion|Summary|Solution)/m,
  /<\/?(answer|result|conclusion|output)>/i,
];

// ── Core Functions ─────────────────────────────────────────────

/**
 * Detect whether a response was truncated mid-thinking block.
 *
 * Checks for:
 * 1. Unclosed XML/bracket thinking tags
 * 2. Prose-style thinking openers without a conclusion marker
 * 3. Abrupt endings (mid-sentence, mid-word, mid-code-block)
 */
export function detectTruncatedThinking(response: string): PrefillResult {
  const noTruncation: PrefillResult = {
    needsContinuation: false,
    thinkingPrefix: "",
    truncatedAt: 0,
  };

  if (response.length < 20) return noTruncation;

  // 1. Check XML/bracket-style thinking blocks
  for (const pair of THINKING_PAIRS) {
    const openMatch = pair.open.exec(response);
    if (openMatch) {
      const closeMatch = pair.close.exec(response.slice(openMatch.index));
      if (!closeMatch) {
        // Opening tag found, no closing tag — truncated mid-thought
        return {
          needsContinuation: true,
          thinkingPrefix: response.slice(openMatch.index),
          truncatedAt: response.length,
        };
      }
    }
  }

  // 2. Check prose-style thinking indicators
  const hasProseThinking = THINKING_PROSE_STARTS.some((re) => re.test(response));
  if (hasProseThinking) {
    const hasConclusion = CONCLUSION_MARKERS.some((re) => re.test(response));
    if (!hasConclusion && looksAbruptlyEnded(response)) {
      return {
        needsContinuation: true,
        thinkingPrefix: response,
        truncatedAt: response.length,
      };
    }
  }

  // 3. Check for abrupt ending without any thinking indicator
  // (only if the response ends very abruptly — mid-sentence with no punctuation)
  if (looksAbruptlyEnded(response) && hasOpenCodeBlock(response)) {
    return {
      needsContinuation: true,
      thinkingPrefix: response,
      truncatedAt: response.length,
    };
  }

  return noTruncation;
}

/**
 * Build a continuation prompt that includes the thinking prefix so the
 * model continues from where it left off.
 *
 * The prefix is injected as an assistant prefill so the model seamlessly
 * resumes its reasoning chain without restarting.
 */
export function buildContinuationPrompt(original: string, thinkingPrefix: string): string {
  const trimmed = thinkingPrefix.trimEnd();

  return [
    "Continue your response from exactly where you left off.",
    "Your previous response was truncated. Here is what you had so far:",
    "",
    "---BEGIN PREVIOUS RESPONSE---",
    trimmed,
    "---END PREVIOUS RESPONSE---",
    "",
    "Continue from that exact point. Do not restart or repeat. Complete your reasoning and provide your final answer.",
  ].join("\n");
}

// ── Internal Helpers ───────────────────────────────────────────

/** Check if a response looks like it was cut off mid-sentence. */
function looksAbruptlyEnded(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;

  const lastChar = trimmed[trimmed.length - 1]!;
  // Ends with a letter, comma, or opening bracket — likely mid-sentence
  if (/[a-zA-Z,([{]/.test(lastChar)) return true;
  // Ends with a hyphen (mid-word)
  if (lastChar === "-") return true;

  return false;
}

/** Check if the response has an unclosed code block. */
function hasOpenCodeBlock(text: string): boolean {
  const backtickBlocks = text.match(/```/g);
  if (!backtickBlocks) return false;
  // Odd number of ``` markers means one is unclosed
  return backtickBlocks.length % 2 !== 0;
}
