/**
 * Auto-Mode Classification — Keyword-scored task mode detection.
 *
 * Analyzes a user prompt and returns the most appropriate execution mode
 * based on weighted keyword matching. Each pattern contributes to a
 * confidence score; the highest-scoring mode wins.
 *
 * This is the simplified, function-based API for Phase E auto-mode.
 * For the class-based detector with planning depth, see auto-mode-detector.ts.
 */

// ── Types ────────────────────────────────────────────────

export type AutoMode = "chat" | "build" | "autopilot" | "compare" | "research" | "debug";

export interface ModeClassification {
  readonly mode: AutoMode;
  readonly confidence: number;
  readonly reason: string;
}

// ── Pattern Definitions ─────────────────────────────────

interface ModePattern {
  readonly mode: AutoMode;
  readonly keywords: readonly RegExp[];
  readonly weight: number;
}

const MODE_PATTERNS: readonly ModePattern[] = [
  // Debug — error investigation and fixing
  {
    mode: "debug",
    keywords: [
      /\bfix\b/i,
      /\bdebug\b/i,
      /\berror\b/i,
      /\bbug\b/i,
      /\bcrash(es|ing|ed)?\b/i,
      /\bfail(s|ed|ing|ure)?\b/i,
      /\bbroken\b/i,
      /\bnot\s+working\b/i,
      /\btroubleshoot\b/i,
      /\bstack\s*trace\b/i,
      /\bexception\b/i,
    ],
    weight: 1.0,
  },
  // Build — creating and implementing features
  {
    mode: "build",
    keywords: [
      /\bbuild\b/i,
      /\bcreate\b/i,
      /\bimplement\b/i,
      /\badd\s+feature\b/i,
      /\badd\s+a\b/i,
      /\bwrite\b/i,
      /\bgenerate\b/i,
      /\bscaffold\b/i,
      /\bsetup\b/i,
      /\bset\s+up\b/i,
      /\brefactor\b/i,
      /\bmigrate\b/i,
      /\bdeploy\b/i,
    ],
    weight: 1.0,
  },
  // Compare — side-by-side evaluation
  {
    mode: "compare",
    keywords: [
      /\bcompare\b/i,
      /\bwhich\s+is\s+better\b/i,
      /\bvs\b/i,
      /\bversus\b/i,
      /\bdifference\s+between\b/i,
      /\bpros?\s+and\s+cons?\b/i,
      /\btrade-?offs?\b/i,
      /\bbenchmark\b/i,
    ],
    weight: 1.0,
  },
  // Research — information gathering and analysis
  {
    mode: "research",
    keywords: [
      /\bresearch\b/i,
      /\bfind\s+out\b/i,
      /\bwhat\s+is\b/i,
      /\bwhat\s+are\b/i,
      /\bhow\s+does\b/i,
      /\bhow\s+do\b/i,
      /\bexplain\b/i,
      /\banalyze\b/i,
      /\binvestigate\b/i,
      /\blook\s+into\b/i,
      /\bsummarize\b/i,
    ],
    weight: 0.9,
  },
  // Autopilot — autonomous execution until done
  {
    mode: "autopilot",
    keywords: [
      /\brun\s+until\s+done\b/i,
      /\bautopilot\b/i,
      /\bautonomous(ly)?\b/i,
      /\bfire\s+and\s+forget\b/i,
      /\bhandle\s+everything\b/i,
      /\bdo\s+it\s+all\b/i,
      /\bjust\s+do\s+it\b/i,
      /\bfully\s+automat(e|ic)\b/i,
    ],
    weight: 1.0,
  },
];

// ── Classifier ──────────────────────────────────────────

/**
 * Classify a user prompt into an execution mode using weighted keyword matching.
 *
 * Each mode's keywords are tested against the prompt. Every match adds the
 * mode's weight to its accumulated score. The mode with the highest total
 * score wins. Confidence is derived from the winning score relative to
 * the total number of keywords checked.
 *
 * Returns "chat" as the default when no patterns match with sufficient confidence.
 */
export function classifyTaskMode(prompt: string): ModeClassification {
  const trimmed = prompt.trim();

  // Very short or empty prompts are conversational
  if (trimmed.length === 0) {
    return { mode: "chat", confidence: 1.0, reason: "Empty prompt" };
  }

  if (trimmed.length < 10) {
    return { mode: "chat", confidence: 0.9, reason: "Very short message — conversational" };
  }

  // Score each mode
  const scores = new Map<AutoMode, number>();
  const reasons = new Map<AutoMode, string>();

  for (const pattern of MODE_PATTERNS) {
    let modeScore = 0;
    let lastMatchSource = "";

    for (const keyword of pattern.keywords) {
      if (keyword.test(trimmed)) {
        modeScore += pattern.weight;
        lastMatchSource = keyword.source;
      }
    }

    if (modeScore > 0) {
      const existing = scores.get(pattern.mode) ?? 0;
      scores.set(pattern.mode, existing + modeScore);
      reasons.set(pattern.mode, `Keyword match: ${lastMatchSource}`);
    }
  }

  // Find highest-scoring mode
  let bestMode: AutoMode = "chat";
  let bestScore = 0;
  let bestReason = "No specific pattern matched — default chat mode";

  for (const [mode, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestMode = mode;
      bestReason = reasons.get(mode) ?? bestReason;
    }
  }

  // Normalize confidence: clamp between 0.3 and 0.99
  // A single keyword match gives ~0.5, multiple matches push toward 0.99
  const totalKeywords = MODE_PATTERNS.reduce((sum, p) => sum + p.keywords.length, 0);
  const rawConfidence = bestScore > 0
    ? Math.min(0.99, 0.4 + (bestScore / Math.max(1, totalKeywords)) * 10)
    : 0.3;

  // If best score is below threshold, fall back to chat
  if (bestScore < 0.5) {
    return {
      mode: "chat",
      confidence: 0.5,
      reason: "Low confidence across all patterns — default chat mode",
    };
  }

  return {
    mode: bestMode,
    confidence: rawConfidence,
    reason: bestReason,
  };
}
