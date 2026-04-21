/**
 * Voice Intent Parser — WOTANN Phase 3 P1-F13 helper.
 *
 * Pure, dependency-free mapping from a raw voice transcript to a best-match
 * template id plus any extracted slot values. This is the "intent parsing"
 * layer that CarPlay (hands-free-only by regulation) needs between the
 * iOS-side STT output and the daemon-side task dispatch.
 *
 * Why this module exists (distinct from carplay-dispatch.ts):
 *
 *   - carplay-dispatch owns POLICY (registry, rate limits, auto-claim,
 *     store coupling). It is stateful (per-instance ledger) and knows
 *     about F1 ComputerSessionStore.
 *
 *   - voice-intent owns MATCHING (pattern → template id, token → slot
 *     value, confidence scoring). It is pure, stateless, and knows
 *     nothing about sessions or stores.
 *
 * This split lets us unit-test parsing without dragging the F1 store into
 * the harness, and lets callers (e.g. the phone UI) use parsing for a
 * "preview what this voice command would do" flow without touching
 * dispatch side-effects.
 *
 * Design constraints (session quality bars):
 *
 *   QB #6 (honest failures) — low-confidence inputs are NOT silently
 *   coerced into a best-guess template. The caller receives a structured
 *   `{ templateId: null, topCandidates, rawTranscript }` response so the
 *   UI can say "Did you mean X or Y?" instead of guessing.
 *
 *   QB #7 (per-session state) — module-level constants only; no state
 *   lives here. All behavior flows from function arguments.
 *
 *   QB #10 (sibling-site scan) — `grep -rn "voice.*intent|intent.*parse"
 *   src/` found zero prior implementations. Voice pipeline is STT-only;
 *   intent classification is a net-new concern.
 *
 *   QB #13 (no env-dependent tests) — deterministic tokenization (split
 *   on whitespace, lowercased), deterministic regex compilation, no
 *   Date.now / Math.random. Tests pass on clean CI identically.
 *
 *   QB #14 (claim verification) — this file provides a pure function;
 *   claims about "freeform falls through to generic session" belong to
 *   carplay-dispatch.ts tests that exercise the full path.
 *
 * Scope: regex-based matching only, no ML/embedding. A freeform fallback
 * handles the "no template matched" case honestly. Production voice apps
 * would use a proper intent classifier — F13 is the primitive, not the
 * final shape.
 */

// ── Types ──────────────────────────────────────────────────

/**
 * A voice-matching rule attached to a CarPlay template. Two kinds:
 *
 *   - `keywords`: match if ALL keywords appear as substrings in the
 *     (normalized) transcript. Cheapest and most predictable.
 *
 *   - `regex`: full regex control. Named capture groups become slot
 *     values (e.g. `/remind me to (?<what>.+)/i` extracts slot "what").
 *     Authors should anchor patterns or expect partial matches.
 *
 * Each rule carries a `priority` (default 1.0) so templates with more
 * specific patterns can win over generic ones on transcripts that match
 * multiple templates.
 */
export type VoicePattern =
  | { readonly kind: "keywords"; readonly keywords: readonly string[]; readonly priority?: number }
  | { readonly kind: "regex"; readonly pattern: RegExp; readonly priority?: number };

/** A template's declared voice-intent rules. One template can have many. */
export interface VoiceTemplateBinding {
  readonly templateId: string;
  readonly patterns: readonly VoicePattern[];
}

/**
 * Result of matching a single transcript against a set of bindings.
 *
 * `matched`:
 *   - non-null when at least one pattern's score >= threshold
 *   - null when no pattern cleared threshold (caller shows confirmation UI)
 *
 * `topCandidates`:
 *   - sorted desc by confidence
 *   - always populated — even on null `matched`, callers can offer the
 *     user the top-2 as "did you mean?" buttons
 *
 * `slots`: named-capture values extracted from the winning pattern.
 */
export interface VoiceIntentMatch {
  readonly matched: {
    readonly templateId: string;
    readonly confidence: number;
    readonly slots: Readonly<Record<string, string>>;
  } | null;
  readonly topCandidates: readonly {
    readonly templateId: string;
    readonly confidence: number;
  }[];
  readonly rawTranscript: string;
  readonly normalizedTranscript: string;
}

/** Confidence threshold below which matched=null (caller confirms). */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

/** Max candidates kept in `topCandidates` — more = clutter on small screens. */
export const DEFAULT_TOP_CANDIDATES = 3;

// ── Normalization ──────────────────────────────────────────

/**
 * Normalize a voice transcript for matching. Deterministic and locale-
 * unaware (STT layer handles locale).
 *
 * Steps:
 *   1. Lowercase (case-insensitive matching)
 *   2. Trim + collapse interior whitespace
 *   3. Strip leading wake-word variations ("hey wotann", "wotann")
 *   4. Strip trailing punctuation that doesn't change semantics
 *
 * We deliberately DO NOT strip stopwords, stem, or translate — those are
 * locale-sensitive and would burn reliability for a tiny quality bump.
 */
export function normalizeTranscript(raw: string): string {
  if (!raw) return "";
  let s = raw.toLowerCase().trim();
  // Collapse internal whitespace first so the wake-word regex doesn't
  // have to handle multi-space variants.
  s = s.replace(/\s+/g, " ");
  // Strip wake-word prefix ("hey wotann", "wotann", "hi wotann").
  s = s.replace(/^(?:hey|hi|ok|okay)?\s*wotann[,:\s]*/u, "").trim();
  // Strip trailing punctuation.
  s = s.replace(/[.?!,]+$/u, "").trim();
  return s;
}

// ── Scoring ────────────────────────────────────────────────

/**
 * Score a single pattern against a normalized transcript. Returns a value
 * in [0, 1]:
 *
 *   - keywords kind: (keywords matched / total keywords) × priority, clamped
 *   - regex kind: 1 × priority if the regex matches, 0 otherwise
 *
 * A caller-supplied `priority` lets authors hint that a rule is more
 * specific (e.g., a four-word phrase rule should beat a single-keyword
 * rule when both match). `priority` is multiplied in, so authors can also
 * use values < 1 to downweight loose keyword rules.
 */
function scorePattern(
  pattern: VoicePattern,
  normalized: string,
): {
  readonly score: number;
  readonly slots: Record<string, string>;
} {
  const priority = pattern.priority ?? 1.0;
  if (pattern.kind === "keywords") {
    if (pattern.keywords.length === 0) return { score: 0, slots: {} };
    let matched = 0;
    for (const kw of pattern.keywords) {
      if (!kw || kw.length === 0) continue;
      if (normalized.includes(kw.toLowerCase())) matched++;
    }
    const fraction = matched / pattern.keywords.length;
    const score = Math.min(1, fraction * priority);
    return { score, slots: {} };
  }
  // regex kind
  const m = normalized.match(pattern.pattern);
  if (!m) return { score: 0, slots: {} };
  const slots: Record<string, string> = {};
  const groups = m.groups ?? {};
  for (const [name, value] of Object.entries(groups)) {
    if (typeof value === "string") slots[name] = value.trim();
  }
  const score = Math.min(1, 1.0 * priority);
  return { score, slots };
}

// ── Parser ─────────────────────────────────────────────────

export interface VoiceIntentParserOptions {
  readonly confidenceThreshold?: number;
  readonly topCandidates?: number;
}

/**
 * Parse a raw voice transcript against a set of template bindings. Pure
 * and stateless — every call is an independent computation.
 *
 * Behavior summary:
 *
 *   1. Normalize the transcript.
 *   2. Score every pattern of every binding; keep the best score per
 *      template id.
 *   3. Sort templates desc by confidence, take `topCandidates`.
 *   4. If the top score >= threshold, return matched with extracted
 *      slots; otherwise matched=null but topCandidates still populated.
 *
 * Empty bindings list or empty transcript → matched=null, topCandidates=[].
 */
export function parseVoiceIntent(
  rawTranscript: string,
  bindings: readonly VoiceTemplateBinding[],
  opts: VoiceIntentParserOptions = {},
): VoiceIntentMatch {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const topN = Math.max(1, opts.topCandidates ?? DEFAULT_TOP_CANDIDATES);
  const normalized = normalizeTranscript(rawTranscript);

  if (!normalized || bindings.length === 0) {
    return {
      matched: null,
      topCandidates: [],
      rawTranscript,
      normalizedTranscript: normalized,
    };
  }

  // For each binding, keep the best (score, slots) across its patterns.
  // Map keyed by template id so duplicate bindings (shouldn't exist, but
  // defensive) collapse to the best.
  type ScoredTemplate = {
    readonly templateId: string;
    readonly score: number;
    readonly slots: Record<string, string>;
  };
  const bestByTemplate = new Map<string, ScoredTemplate>();

  for (const binding of bindings) {
    let best: ScoredTemplate | null = null;
    for (const pattern of binding.patterns) {
      const result = scorePattern(pattern, normalized);
      if (!best || result.score > best.score) {
        best = {
          templateId: binding.templateId,
          score: result.score,
          slots: result.slots,
        };
      }
    }
    if (best && best.score > 0) {
      const existing = bestByTemplate.get(binding.templateId);
      if (!existing || best.score > existing.score) {
        bestByTemplate.set(binding.templateId, best);
      }
    }
  }

  // Sort desc by score. Ties broken by template id ASC for determinism
  // (keeps tests stable on clean CI — QB #13).
  const ranked = [...bestByTemplate.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.templateId.localeCompare(b.templateId);
  });

  const top = ranked.slice(0, topN);
  const topCandidates = top.map((r) => ({
    templateId: r.templateId,
    confidence: r.score,
  }));

  if (ranked.length === 0) {
    return {
      matched: null,
      topCandidates: [],
      rawTranscript,
      normalizedTranscript: normalized,
    };
  }

  const winner = ranked[0];
  if (!winner || winner.score < threshold) {
    return {
      matched: null,
      topCandidates,
      rawTranscript,
      normalizedTranscript: normalized,
    };
  }

  return {
    matched: {
      templateId: winner.templateId,
      confidence: winner.score,
      slots: { ...winner.slots },
    },
    topCandidates,
    rawTranscript,
    normalizedTranscript: normalized,
  };
}
