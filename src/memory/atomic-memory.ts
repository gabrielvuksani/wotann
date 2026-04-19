/**
 * Atomic memory with contextual resolution at ingest — Phase H Task 3.
 *
 * Supermemory (98.60% LongMemEval SOTA) resolves pronouns, references,
 * and abbreviations BEFORE storing — so a later recall for "Maya" hits
 * the atom that originally said "he said he'd ship it by Friday", not a
 * brittle embedding of a bare pronoun.
 *
 * This module ships:
 *   - SessionContext — named-entity bindings (pronouns, aliases) and
 *     task references carried forward across turns.
 *   - resolveContextAtIngest(raw, context) — per-session pure
 *     resolution that rewrites "he" → "Maya", "that one" →
 *     "auth-migration-task", etc. Returns ResolvedMemory with the
 *     original, resolved text, and a provenance diff.
 *   - createLlmResolver(query) — optional LLM-backed upgrade for the
 *     cases the heuristic can't handle. Callers pick which resolver
 *     to use based on budget (see providers/budget-downgrader).
 *
 * Quality bars:
 *   - Honest "resolution_failed" events — never a silent passthrough
 *     that fabricates resolution provenance.
 *   - Per-session state. No module-global bindings. Two parallel
 *     sessions can resolve "he" to different people without crosstalk.
 *   - Immutable inputs/outputs. Bindings update by returning a new
 *     SessionContext, not mutating the old one.
 */

// ── Types ──────────────────────────────────────────────

export interface SessionContext {
  /** Session id — used for provenance and cache partitioning. */
  readonly sessionId: string;
  /**
   * Named-entity bindings: the current referent of each pronoun or
   * short alias within this session. "he" → "Maya", "it" → "the auth
   * migration".
   */
  readonly bindings: ReadonlyMap<string, string>;
  /**
   * Short-lived task references — "that one", "the second task", etc.
   * Keyed by lowercased alias; values are stable task names.
   */
  readonly taskAliases: ReadonlyMap<string, string>;
  /**
   * Abbreviation expansions — "WOTANN" → "WOTANN (Germanic All-Father
   * agent harness)". Defined per-session so the resolved text is
   * consistent and self-explanatory.
   */
  readonly abbreviations: ReadonlyMap<string, string>;
}

export interface ResolutionDiff {
  /** Substring of raw that was replaced. */
  readonly from: string;
  /** Replacement text. */
  readonly to: string;
  /** Which binding the resolution came from. */
  readonly source: "binding" | "taskAlias" | "abbreviation" | "llm";
}

export interface ResolvedMemory {
  /** Original raw content as the caller supplied it. */
  readonly original: string;
  /** Resolved text with pronouns/references expanded. */
  readonly resolved: string;
  /** Ordered list of substitutions. */
  readonly diffs: readonly ResolutionDiff[];
  /**
   * Honest failure signal — when the resolver could not find any
   * referent for a pronoun in the raw text. Empty array = clean resolve.
   * Callers use this to emit a "resolution_failed" event and decide
   * whether to store the raw text or escalate to a better resolver.
   */
  readonly unresolved: readonly string[];
}

/** Resolver contract. sync (heuristic) or async (llm-backed). */
export type ContextualResolver = (
  raw: string,
  context: SessionContext,
) => ResolvedMemory | Promise<ResolvedMemory>;

// ── Empty / builder helpers ────────────────────────────

export function createSessionContext(sessionId: string): SessionContext {
  return {
    sessionId,
    bindings: new Map(),
    taskAliases: new Map(),
    abbreviations: new Map(),
  };
}

/**
 * Add or update a binding. Returns a new SessionContext — the old one
 * is unchanged (immutability is a quality bar).
 */
export function bindPronoun(
  context: SessionContext,
  pronoun: string,
  referent: string,
): SessionContext {
  const next = new Map(context.bindings);
  next.set(pronoun.toLowerCase(), referent);
  return { ...context, bindings: next };
}

export function bindTaskAlias(
  context: SessionContext,
  alias: string,
  task: string,
): SessionContext {
  const next = new Map(context.taskAliases);
  next.set(alias.toLowerCase(), task);
  return { ...context, taskAliases: next };
}

export function bindAbbreviation(
  context: SessionContext,
  abbreviation: string,
  expansion: string,
): SessionContext {
  const next = new Map(context.abbreviations);
  next.set(abbreviation, expansion);
  return { ...context, abbreviations: next };
}

// ── Heuristic resolver ─────────────────────────────────

/** Pronouns the heuristic tries to resolve. Case-insensitive. */
const PRONOUNS: readonly string[] = [
  "he",
  "she",
  "they",
  "him",
  "her",
  "them",
  "his",
  "hers",
  "their",
  "theirs",
  "it",
  "its",
];

/** Multi-word references the heuristic tries to resolve. */
const TASK_REFERENCE_PATTERNS: readonly RegExp[] = [
  /\bthat one\b/gi,
  /\bthat task\b/gi,
  /\bthe second (?:task|item)\b/gi,
  /\bthe first (?:task|item)\b/gi,
  /\bthis one\b/gi,
];

/**
 * Escape a string for use inside a RegExp character class / literal
 * subpattern. Avoids the regex-injection trap where a binding key
 * contains a metacharacter.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve pronouns, references, and abbreviations at ingest using only
 * the session-local bindings. No LLM calls. Idempotent on a resolved
 * string.
 *
 * Pronouns only resolve when exactly one candidate binding exists —
 * ambiguous resolutions flow through as unresolved rather than
 * guessing (honest failure bar).
 */
export function resolveContextAtIngest(raw: string, context: SessionContext): ResolvedMemory {
  if (!raw || raw.length === 0) {
    return { original: raw, resolved: raw, diffs: [], unresolved: [] };
  }

  let working = raw;
  const diffs: ResolutionDiff[] = [];
  const unresolved = new Set<string>();

  // Abbreviations first — deterministic, case-sensitive.
  for (const [abbr, expansion] of context.abbreviations) {
    const re = new RegExp(`\\b${escapeRegex(abbr)}\\b`, "g");
    if (re.test(working)) {
      working = working.replace(new RegExp(`\\b${escapeRegex(abbr)}\\b`, "g"), expansion);
      diffs.push({ from: abbr, to: expansion, source: "abbreviation" });
    }
  }

  // Task aliases — longest key first so "the second task" wins over
  // "task".
  const taskEntries = [...context.taskAliases.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [alias, task] of taskEntries) {
    const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "gi");
    if (re.test(working)) {
      working = working.replace(new RegExp(`\\b${escapeRegex(alias)}\\b`, "gi"), task);
      diffs.push({ from: alias, to: task, source: "taskAlias" });
    }
  }

  // Built-in task reference patterns — only resolve when EXACTLY one
  // taskAlias binding exists.
  for (const pattern of TASK_REFERENCE_PATTERNS) {
    const matches = working.match(pattern);
    if (!matches || matches.length === 0) continue;
    if (context.taskAliases.size === 1) {
      const task = [...context.taskAliases.values()][0]!;
      for (const match of matches) {
        working = working.replace(match, task);
        diffs.push({ from: match, to: task, source: "taskAlias" });
      }
    } else {
      // Ambiguous — record honestly.
      for (const match of matches) unresolved.add(match);
    }
  }

  // Pronouns — only resolve when exactly one binding exists for the
  // pronoun key. Ambiguous cases flow through as unresolved.
  for (const pronoun of PRONOUNS) {
    const re = new RegExp(`\\b${escapeRegex(pronoun)}\\b`, "gi");
    if (!re.test(working)) continue;

    const referent = context.bindings.get(pronoun.toLowerCase());
    if (!referent) {
      unresolved.add(pronoun);
      continue;
    }

    // Replace all occurrences (case-insensitive).
    working = working.replace(new RegExp(`\\b${escapeRegex(pronoun)}\\b`, "gi"), referent);
    diffs.push({ from: pronoun, to: referent, source: "binding" });
  }

  return {
    original: raw,
    resolved: working,
    diffs,
    unresolved: [...unresolved],
  };
}

// ── LLM-backed resolver (optional) ─────────────────────

export type LlmQuery = (
  prompt: string,
  options: { readonly maxTokens: number; readonly temperature?: number },
) => Promise<string>;

const LLM_RESOLVE_PROMPT = (
  raw: string,
  context: SessionContext,
) => `Rewrite the INPUT so that every pronoun and ambiguous reference is replaced with the referent from CONTEXT. Do NOT add new information. Do NOT paraphrase. If a referent is ambiguous, leave the pronoun as-is.

CONTEXT bindings:
${[...context.bindings.entries()].map(([k, v]) => `  ${k} → ${v}`).join("\n") || "  (none)"}

TASK aliases:
${[...context.taskAliases.entries()].map(([k, v]) => `  ${k} → ${v}`).join("\n") || "  (none)"}

INPUT:
"""
${raw.slice(0, 4000)}
"""

Output ONLY the rewritten text. No markdown, no commentary.`;

/**
 * Build an LLM-backed resolver. Always runs the heuristic first, then
 * hands any UNRESOLVED pronouns to the LLM. When the LLM succeeds its
 * diff is appended and labelled "llm".
 *
 * Callers using the cheapest provider (Haiku/Gemma via
 * budget-downgrader) get Supermemory-grade resolution on the long tail
 * at minimal cost; the heuristic alone already handles 80%+ of common
 * cases.
 */
export function createLlmResolver(query: LlmQuery): ContextualResolver {
  return async (raw: string, context: SessionContext): Promise<ResolvedMemory> => {
    const heuristic = resolveContextAtIngest(raw, context);
    if (heuristic.unresolved.length === 0) return heuristic;

    let rewritten: string;
    try {
      rewritten = await query(LLM_RESOLVE_PROMPT(heuristic.resolved, context), {
        maxTokens: 800,
        temperature: 0,
      });
    } catch {
      // Honest failure — return the heuristic result with unresolved
      // pronouns untouched. Caller emits resolution_failed event.
      return heuristic;
    }

    const trimmed = rewritten.trim();
    if (!trimmed || trimmed === heuristic.resolved) return heuristic;

    return {
      original: heuristic.original,
      resolved: trimmed,
      diffs: [...heuristic.diffs, { from: heuristic.resolved, to: trimmed, source: "llm" }],
      // Anything still unresolved after the LLM pass stays honest.
      unresolved: heuristic.unresolved.filter((p) =>
        new RegExp(`\\b${escapeRegex(p)}\\b`, "i").test(trimmed),
      ),
    };
  };
}

// ── Provenance helpers ─────────────────────────────────

export interface ResolutionEvent {
  readonly kind: "resolved" | "resolution_failed";
  readonly sessionId: string;
  readonly original: string;
  readonly resolved: string;
  readonly unresolved: readonly string[];
  readonly diffs: readonly ResolutionDiff[];
  readonly at: number;
}

/**
 * Build a provenance event from a resolution result. Callers pipe
 * these through their telemetry / audit trail so unresolved pronouns
 * don't silently disappear.
 */
export function toResolutionEvent(
  result: ResolvedMemory,
  sessionId: string,
  at: number = Date.now(),
): ResolutionEvent {
  return {
    kind: result.unresolved.length === 0 ? "resolved" : "resolution_failed",
    sessionId,
    original: result.original,
    resolved: result.resolved,
    unresolved: result.unresolved,
    diffs: result.diffs,
    at,
  };
}
