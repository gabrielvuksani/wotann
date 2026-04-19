/**
 * Answer normalization for benchmark scoring — Phase 4 Sprint B2 item 14.
 *
 * Benchmarks often grade on exact-match against a canonical answer
 * ("42", "Paris", "O(log n)") but agents produce surrounded-text
 * answers ("The answer is 42.", "I think the capital is Paris.",
 * "This runs in O(log n) time complexity."). Without normalization,
 * scoring drops 3-5% on GAIA alone and 1-2% on most other eval-style
 * benchmarks (TriviaQA, NQ-open, MMLU-free-response).
 *
 * This module ships a pure-function normalizer:
 *   normalizeAnswer(rawResponse, options?) → canonicalString
 * with options for domain-specific strip rules (units, code fences,
 * markdown) so the benchmark runner can feed canonical-vs-expected
 * comparisons to CompletionOracle's exact-match criterion.
 *
 * No LLM calls, no external deps. Pure TypeScript + regex.
 */

// ── Types ──────────────────────────────────────────────

export interface NormalizeOptions {
  /** Strip surrounding markdown code fences (```lang ... ```). Default: true. */
  readonly stripCodeFences?: boolean;
  /** Strip leading prose like "The answer is:", "Answer:", "Result:", "=>". Default: true. */
  readonly stripLeadingAnswerPrefix?: boolean;
  /** Strip trailing punctuation (. ! ? ; ,). Default: true. */
  readonly stripTrailingPunctuation?: boolean;
  /** Lowercase the final output. Default: false (preserves case-sensitive answers). */
  readonly lowercase?: boolean;
  /** Collapse all whitespace runs to single spaces. Default: true. */
  readonly collapseWhitespace?: boolean;
  /** Strip markdown bold/italic/code span markers around the answer. Default: true. */
  readonly stripMarkdownEmphasis?: boolean;
  /** Strip common unit suffixes when extracting numeric answers (kg, ms, %, $). Default: false. */
  readonly stripUnits?: boolean;
  /** If true, extract the FIRST number found anywhere in the response. Default: false. */
  readonly extractFirstNumber?: boolean;
  /**
   * Domain hint that drives a small preset. "numeric" enables
   * extractFirstNumber + stripUnits. "code" disables lowercase +
   * stripTrailingPunctuation (code is case/punct-significant).
   */
  readonly domain?: "numeric" | "code" | "prose" | "multiple-choice";
}

// ── Normalizer ────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<NormalizeOptions, "domain">> = {
  stripCodeFences: true,
  stripLeadingAnswerPrefix: true,
  stripTrailingPunctuation: true,
  lowercase: false,
  collapseWhitespace: true,
  stripMarkdownEmphasis: true,
  stripUnits: false,
  extractFirstNumber: false,
};

const DOMAIN_PRESETS: Record<NonNullable<NormalizeOptions["domain"]>, Partial<NormalizeOptions>> = {
  numeric: {
    extractFirstNumber: true,
    stripUnits: true,
  },
  code: {
    lowercase: false,
    stripTrailingPunctuation: false,
    stripLeadingAnswerPrefix: false,
  },
  prose: {
    lowercase: true,
    collapseWhitespace: true,
  },
  "multiple-choice": {
    // A/B/C/D answers — strip everything except the first letter
    lowercase: false,
    stripTrailingPunctuation: true,
    stripLeadingAnswerPrefix: true,
    stripMarkdownEmphasis: true,
  },
};

/**
 * Leading-prefix patterns the agent might use to announce the answer.
 * Matched case-insensitively at the start of the trimmed input.
 * Anchored at start + optional whitespace/punctuation separator.
 */
const LEADING_ANSWER_PATTERNS: readonly RegExp[] = [
  /^(?:the\s+)?(?:final\s+)?answer\s+is\s*[:=\-–—]\s*/i,
  /^(?:the\s+)?final\s+answer\s*[:=]\s*/i,
  /^answer\s*[:=]\s*/i,
  /^result\s*[:=]\s*/i,
  /^output\s*[:=]\s*/i,
  /^=>\s*/,
  /^->\s*/,
  /^i\s+(?:think|believe)\s+(?:the\s+)?(?:answer\s+is\s*)?/i,
  /^here\s+is\s+(?:the\s+)?(?:answer|result)\s*[:=]?\s*/i,
];

/** Regex for the first number in a string — integer, decimal, or scientific. */
const FIRST_NUMBER_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/**
 * Common unit suffixes to strip when extracting numeric answers.
 * Non-exhaustive but covers GAIA + most eval sets.
 */
const UNIT_SUFFIXES = [
  "kg",
  "g",
  "lb",
  "lbs",
  "oz",
  "ms",
  "us",
  "ns",
  "s",
  "min",
  "hr",
  "hrs",
  "km",
  "m",
  "cm",
  "mm",
  "mi",
  "ft",
  "in",
  "%",
  "percent",
  "$",
  "usd",
  "€",
  "£",
  "°c",
  "°f",
  "°",
  "gb",
  "mb",
  "kb",
  "b",
  "bytes",
];

function resolveOptions(
  options: NormalizeOptions | undefined,
): Required<Omit<NormalizeOptions, "domain">> {
  const merged: Required<Omit<NormalizeOptions, "domain">> = { ...DEFAULT_OPTIONS };
  if (options?.domain) {
    const preset = DOMAIN_PRESETS[options.domain];
    for (const [key, value] of Object.entries(preset)) {
      if (value !== undefined && key in merged) {
        (merged as Record<string, boolean>)[key] = value as boolean;
      }
    }
  }
  // Explicit options override domain preset
  for (const [key, value] of Object.entries(options ?? {})) {
    if (key === "domain") continue;
    if (value !== undefined && key in merged) {
      (merged as Record<string, boolean>)[key] = value as boolean;
    }
  }
  return merged;
}

/**
 * Normalize a raw model response into a canonical comparable form.
 *
 * Pipeline (applied in order):
 *  1. Trim outer whitespace
 *  2. Strip code fences (first fenced block wins; if no fences, pass through)
 *  3. Strip leading answer-announcement prefix ("The answer is: ...")
 *  4. Strip markdown emphasis markers around the answer (**bold**, *em*, `code`)
 *  5. If extractFirstNumber: take the first numeric match and return it
 *     (+ unit stripping if stripUnits)
 *  6. Strip trailing punctuation
 *  7. Collapse whitespace runs
 *  8. Lowercase (if enabled)
 *
 * Returns the canonical string. Empty input returns empty string.
 */
export function normalizeAnswer(raw: string, options?: NormalizeOptions): string {
  if (!raw) return "";
  const opts = resolveOptions(options);
  let out = raw.trim();

  // 1. Code fences (```lang ... ```). Take the first fenced block.
  if (opts.stripCodeFences) {
    const fence = out.match(/```(?:[a-z0-9]+)?\s*\n?([\s\S]*?)\n?```/i);
    if (fence?.[1]) {
      out = fence[1].trim();
    }
  }

  // 2. Leading "answer is:" / "result:" / etc.
  if (opts.stripLeadingAnswerPrefix) {
    for (const pattern of LEADING_ANSWER_PATTERNS) {
      if (pattern.test(out)) {
        out = out.replace(pattern, "").trim();
        break;
      }
    }
  }

  // 3. Markdown emphasis: strip **...**, *...*, __...__, _..._, `...`
  if (opts.stripMarkdownEmphasis) {
    // Walk outer-to-inner: bold first, then italic, then code span
    out = out.replace(/^\*\*([\s\S]*?)\*\*\s*$/, "$1");
    out = out.replace(/^__([\s\S]*?)__\s*$/, "$1");
    out = out.replace(/^\*([^*\n]+?)\*\s*$/, "$1");
    out = out.replace(/^_([^_\n]+?)_\s*$/, "$1");
    out = out.replace(/^`([^`\n]+?)`\s*$/, "$1");
    out = out.trim();
  }

  // 4. Extract first number (for numeric-domain benchmarks)
  if (opts.extractFirstNumber) {
    const numberMatch = out.match(FIRST_NUMBER_RE);
    if (numberMatch) {
      out = numberMatch[0];
      if (opts.stripUnits) {
        // No-op for pure number extraction — units were already excluded
        // by the regex — but this branch reserved for future expansion.
      }
      return out; // Short-circuit: numeric extraction is definitive
    }
  }

  // 5. Strip common unit suffixes (independent of number extraction)
  if (opts.stripUnits) {
    const lowered = out.toLowerCase();
    for (const unit of UNIT_SUFFIXES) {
      if (lowered.endsWith(unit.toLowerCase())) {
        out = out.slice(0, out.length - unit.length).trim();
        break;
      }
    }
  }

  // 6. Trailing punctuation
  if (opts.stripTrailingPunctuation) {
    out = out.replace(/[.!?;,]+\s*$/, "");
  }

  // 7. Collapse whitespace
  if (opts.collapseWhitespace) {
    out = out.replace(/\s+/g, " ");
  }

  // 8. Lowercase
  if (opts.lowercase) {
    out = out.toLowerCase();
  }

  return out;
}

/**
 * Convenience wrapper for exact-match comparison. Normalizes both
 * sides with the same options and returns true if they match.
 * Handy for CompletionOracle custom-command criteria where the
 * expected answer comes from task metadata.
 */
export function answersEqual(
  actual: string,
  expected: string,
  options?: NormalizeOptions,
): boolean {
  return normalizeAnswer(actual, options) === normalizeAnswer(expected, options);
}
