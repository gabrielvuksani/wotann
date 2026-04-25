/**
 * Sleep-time summarizer — V9 Tier 11 T11.2 (audit fix 2026-04-24).
 *
 * The audit found that V9 references `src/context/sleep-summarizer.ts`
 * but the file did not exist. This module ships the summarizer so
 * idle-time agents (`src/learning/sleep-time-agent.ts`) have something
 * concrete to call: given a buffer of recent context blocks, the
 * summarizer collapses redundant entries, deduplicates near-duplicates
 * by edit-distance, and emits a compact summary block ready for
 * insertion into the next session's prompt.
 *
 * Design
 * ──────
 * The summarizer is PURE. Callers inject:
 *   - `entries`: the recent context blocks, in chronological order.
 *   - `targetTokens`: hard cap on the summary length (rough heuristic
 *     using ≈4 chars/token).
 *   - `clock`: optional deterministic clock for tests.
 *
 * The output is a single SummaryBlock the caller writes back into
 * memory or threads through to the next-session prompt.
 *
 * Quality bars
 *   - QB #6 honest stubs: empty input → `{ok: false, reason}` not silent
 *     "ok with empty summary".
 *   - QB #7 per-call state: pure function. No module-level cache.
 *   - QB #13 env guard: zero process.env reads.
 */

// ── Types ────────────────────────────────────────────────

export interface SummarizableEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly source: string;
  readonly content: string;
  /** Optional weight for ranking. Default 1.0. */
  readonly weight?: number;
}

export interface SummarizeOptions {
  readonly entries: readonly SummarizableEntry[];
  /** Target token budget (rough heuristic via 4 chars/token). Default 1024. */
  readonly targetTokens?: number;
  /** Deduplication threshold (0..1, normalized similarity). Default 0.85. */
  readonly dedupeThreshold?: number;
  /** Maximum entries to consider. Default 200. */
  readonly maxEntries?: number;
  /** Clock for deterministic tests. */
  readonly now?: () => number;
}

export interface SummaryBlock {
  readonly producedAt: number;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly summary: string;
  readonly droppedAsDuplicate: number;
  readonly truncatedToFitBudget: boolean;
}

export type SummarizeResult =
  | { readonly ok: true; readonly block: SummaryBlock }
  | { readonly ok: false; readonly error: string };

// ── Helpers ──────────────────────────────────────────────

/**
 * Cheap edit-distance ratio for near-duplicate detection. We DON'T
 * compute Levenshtein on multi-KB blocks — that's O(nm). Instead we
 * compute a Jaccard-style ratio over normalized 5-char shingles which
 * runs in O(n+m) and gives a usable similarity signal for plain prose.
 */
function shingleSet(text: string, k: number = 5): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  if (normalized.length < k) {
    out.add(normalized);
    return out;
  }
  for (let i = 0; i <= normalized.length - k; i++) {
    out.add(normalized.slice(i, i + k));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const s of a) {
    if (b.has(s)) intersect += 1;
  }
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/** Rough char→token heuristic. 4 chars per token is the OpenAI
 *  reference for English prose; close enough for budget caps. */
function tokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Main entry ───────────────────────────────────────────

/**
 * Build a SummaryBlock from a chronological entry buffer.
 *
 * Algorithm:
 *   1. Cap input at `maxEntries` (drops oldest).
 *   2. Deduplicate via Jaccard shingle similarity. When two entries
 *      exceed `dedupeThreshold`, keep the higher-weighted one
 *      (ties broken by recency).
 *   3. Concatenate the surviving entries, prefixed by their source
 *      tag. Truncate to `targetTokens` budget if needed.
 *
 * Returns `{ok:false}` on empty input.
 */
export function summarizeForSleep(opts: SummarizeOptions): SummarizeResult {
  if (!opts || typeof opts !== "object") {
    return { ok: false, error: "summarizeForSleep: options object required" };
  }
  if (!Array.isArray(opts.entries) || opts.entries.length === 0) {
    return { ok: false, error: "summarizeForSleep: entries must be a non-empty array" };
  }

  const targetTokens = opts.targetTokens ?? 1024;
  const dedupeThreshold = opts.dedupeThreshold ?? 0.85;
  const maxEntries = opts.maxEntries ?? 200;
  const now = opts.now ?? Date.now;

  if (targetTokens <= 0 || dedupeThreshold < 0 || dedupeThreshold > 1) {
    return {
      ok: false,
      error: "summarizeForSleep: targetTokens and dedupeThreshold must be sensible",
    };
  }

  const trimmed = opts.entries.slice(-maxEntries);

  // Deduplicate. Iterate newest→oldest so a later duplicate replaces
  // the earlier one when weights tie.
  const surviving: SummarizableEntry[] = [];
  const survivingShingles: Set<string>[] = [];
  let droppedAsDuplicate = 0;

  for (let i = trimmed.length - 1; i >= 0; i--) {
    const entry = trimmed[i];
    if (!entry) continue;
    const shingles = shingleSet(entry.content);
    let isDuplicate = false;
    for (let j = 0; j < surviving.length; j++) {
      const existingShingles = survivingShingles[j];
      if (!existingShingles) continue;
      const sim = jaccard(shingles, existingShingles);
      if (sim >= dedupeThreshold) {
        isDuplicate = true;
        // If this entry has higher weight, swap it in.
        const existing = surviving[j];
        const existingWeight = existing?.weight ?? 1;
        if ((entry.weight ?? 1) > existingWeight) {
          surviving[j] = entry;
          survivingShingles[j] = shingles;
        }
        break;
      }
    }
    if (!isDuplicate) {
      surviving.push(entry);
      survivingShingles.push(shingles);
    } else {
      droppedAsDuplicate += 1;
    }
  }

  // Restore chronological order.
  surviving.sort((a, b) => a.timestamp - b.timestamp);

  // Build the summary string, capping at the token budget.
  let summary = "";
  let outputCount = 0;
  let truncated = false;
  for (const entry of surviving) {
    const block = `[${entry.source}] ${entry.content}\n`;
    if (tokenCount(summary + block) > targetTokens) {
      truncated = true;
      break;
    }
    summary += block;
    outputCount += 1;
  }

  return {
    ok: true,
    block: {
      producedAt: now(),
      inputCount: opts.entries.length,
      outputCount,
      summary: summary.trim(),
      droppedAsDuplicate,
      truncatedToFitBudget: truncated,
    },
  };
}
