/**
 * time-decay — FTS hits reweighted by exponential recency decay.
 *
 * FTS ranks by rarity-weighted term overlap. In a long-running session
 * recent facts are typically more relevant than older ones even if the
 * older ones have higher BM25. This mode multiplies BM25 by
 *   exp(-age / halflifeDays)
 * so every doubling of the half-life roughly halves the recency boost.
 *
 * Halflife defaults to 7 days — a common choice in literature for
 * "relevant recent" without discarding month-old context. Callers
 * can override via opts.params.halflifeDays.
 */
import type { RetrievalContext, RetrievalMode, RetrievalHit } from "./types.js";
import { ftsToSearchable } from "./types.js";

export const timeDecay: RetrievalMode = {
  name: "time-decay",
  description: "Rerank FTS hits with exponential time-decay (halflifeDays default=7).",
  search: async (ctx, query, opts) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const halflifeDays = Math.max(0.1, (opts?.params?.["halflifeDays"] as number | undefined) ?? 7);

    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(50, limit * 3))) : []);

    const nowMs = ctx.now ? Date.parse(ctx.now) || Date.now() : Date.now();
    const q = query.trim().toLowerCase();
    const halflifeMs = halflifeDays * 86_400_000;
    const ln2 = Math.log(2);

    const hits: RetrievalHit[] = [];
    for (const e of entries) {
      if (q && !e.content.toLowerCase().includes(q)) continue;
      const ts = e.timestamp ?? 0;
      const ageMs = Math.max(0, nowMs - ts);
      const decay = ts === 0 ? 0 : Math.exp(-ln2 * (ageMs / halflifeMs));
      // Base score = token overlap (cheap BM25-ish) so that two
      // equally-recent entries differ by content relevance.
      const overlap =
        q.length === 0
          ? 0.5
          : Math.min(
              1,
              e.content.toLowerCase().split(q).length - 1 > 0
                ? 0.5 + Math.min(0.5, (e.content.toLowerCase().split(q).length - 1) / 10)
                : 0,
            );
      const score = decay * overlap;
      if (score === 0) continue;
      hits.push({
        id: e.id,
        content: e.content,
        score,
        reason: `decay=${decay.toFixed(3)} overlap=${overlap.toFixed(2)}`,
        metadata: {
          ageDays: ageMs / 86_400_000,
          decay,
          halflifeDays,
        },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "time-decay",
      results: hits.slice(0, limit),
      scoring: {
        method: "exp-decay",
        weights: { halflifeDays },
      },
    };
  },
};
