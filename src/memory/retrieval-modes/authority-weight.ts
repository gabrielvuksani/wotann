/**
 * authority-weight — verified=true entries ranked above unverified.
 *
 * MemoryEntry carries a `verified` boolean (agent/user-confirmed) and
 * a `confidenceLevel` 0..5 scalar. Authority-weighted retrieval
 * produces `baseScore * authorityBoost` where authorityBoost =
 *   1.0 + verifiedBonus + confidenceLevel * confidenceBoost
 *
 * Default verifiedBonus = 1.0 (doubles score), confidenceBoost = 0.2
 * (top-level 5 adds another +1.0). Callers can tune via opts.params.
 *
 * Unverified content still surfaces — it's just deprioritized. That
 * keeps recall high even when only 1-2 facts carry verification.
 */
import type { RetrievalContext, RetrievalMode, RetrievalHit } from "./types.js";
import { ftsToSearchable } from "./types.js";

export const authorityWeight: RetrievalMode = {
  name: "authority-weight",
  description: "Rank entries by FTS score * (verified + confidenceLevel) multiplier.",
  search: async (ctx, query, opts) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const verifiedBonus = (opts?.params?.["verifiedBonus"] as number | undefined) ?? 1.0;
    const confidenceBoost = (opts?.params?.["confidenceBoost"] as number | undefined) ?? 0.2;

    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(50, limit * 3))) : []);

    const q = query.trim().toLowerCase();
    const hits: RetrievalHit[] = [];
    for (const e of entries) {
      if (q && !e.content.toLowerCase().includes(q)) continue;
      const verified = (e.metadata?.["verified"] as boolean | undefined) ?? false;
      const confLevel = (e.metadata?.["confidenceLevel"] as number | undefined) ?? 0;
      const base = 1.0; // uniform baseline; FTS ordering drives pre-filter
      const authority = 1 + (verified ? verifiedBonus : 0) + confLevel * confidenceBoost;
      const score = base * authority;
      hits.push({
        id: e.id,
        content: e.content,
        score,
        reason: `verified=${verified} confLevel=${confLevel} authority=${authority.toFixed(2)}`,
        metadata: { verified, confidenceLevel: confLevel, authority },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "authority-weight",
      results: hits.slice(0, limit),
      scoring: {
        method: "authority-multiplier",
        weights: { verifiedBonus, confidenceBoost },
      },
    };
  },
};
