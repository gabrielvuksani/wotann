/**
 * fuzzy-match — Levenshtein distance against entry keys / first line.
 *
 * Exact-text-matched FTS can miss typos ("Gabreil" vs "Gabriel") and
 * near-misses. This mode scores every candidate by
 *   1 - edit_distance / max(|query|, |key|)
 * so 100% match = 1.0 and totally disjoint strings trend to 0.
 *
 * The comparison target defaults to the entry's metadata.key when
 * present, otherwise the first 80 chars of its content. The
 * implementation uses iterative DP, ~O(|q|*|k|) time, and caps at a
 * small distance window so pathological pairs don't blow up.
 */
import type { RetrievalContext, RetrievalMode, RetrievalHit } from "./types.js";
import { ftsToSearchable } from "./types.js";

const MAX_COMPARE_LEN = 120; // clip to avoid O(n*m) blowups

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const s = a.length > b.length ? b : a;
  const t = a.length > b.length ? a : b;
  let prev = new Array<number>(s.length + 1);
  let curr = new Array<number>(s.length + 1);
  for (let i = 0; i <= s.length; i++) prev[i] = i;
  for (let j = 1; j <= t.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= s.length; i++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[i] = Math.min(curr[i - 1]! + 1, prev[i]! + 1, prev[i - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[s.length]!;
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().slice(0, MAX_COMPARE_LEN);
  const t = target.toLowerCase().slice(0, MAX_COMPARE_LEN);
  if (q.length === 0 || t.length === 0) return 0;
  const dist = levenshtein(q, t);
  const norm = Math.max(q.length, t.length);
  return 1 - dist / norm;
}

export const fuzzyMatch: RetrievalMode = {
  name: "fuzzy-match",
  description: "Rank entries by Levenshtein similarity against query (tolerates typos).",
  search: async (ctx, query, opts) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const threshold = (opts?.params?.["threshold"] as number | undefined) ?? 0.4;

    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(`*`, Math.max(50, limit * 3))) : []);

    const hits: RetrievalHit[] = [];
    for (const e of entries) {
      const key = (e.metadata?.["key"] as string | undefined) ?? "";
      const firstLine = e.content.split("\n")[0] ?? "";
      const target = key || firstLine;
      const score = fuzzyScore(query, target);
      if (score < threshold) continue;
      hits.push({
        id: e.id,
        content: e.content,
        score,
        reason: `fuzzy=${score.toFixed(2)} vs "${target.slice(0, 40)}"`,
        metadata: { fuzzyTarget: target.slice(0, 80), score },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "fuzzy-match",
      results: hits.slice(0, limit),
      scoring: { method: "levenshtein-normalized", weights: { threshold } },
    };
  },
};
