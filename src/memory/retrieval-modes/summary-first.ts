/**
 * summary-first — query OMEGA Layer 3 summaries BEFORE Layer 2 facts.
 *
 * Leverages P1-M2 OMEGA layers. When a user asks a high-level
 * question ("what did we decide about auth yesterday?") a compressed
 * summary is usually a better answer than raw facts. This mode first
 * returns any summaries that overlap the query, then tops up from
 * Layer-2 FTS results if we haven't reached the limit.
 *
 * Summaries are scored higher (base 2.0) than facts (base 1.0) so
 * even when FTS produces a better lexical match, the summary wins on
 * tie-ranks. Callers that want a strict "summaries only" behavior
 * can pass params.summariesOnly=true.
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import type { CompressionSummary } from "../omega-layers.js";
import { ftsToSearchable } from "./types.js";

function matchesSummary(summary: CompressionSummary, q: string): boolean {
  if (q.length === 0) return true;
  return summary.content.toLowerCase().includes(q);
}

function listFromStore(ctx: RetrievalContext): readonly CompressionSummary[] {
  // When no summaries are injected we leave them empty. Store.ts does
  // not expose an omega handle directly; callers are expected to feed
  // the list via ctx.summaries (built from createOmegaLayers(store)).
  return ctx.summaries ?? [];
}

export const summaryFirst: RetrievalMode = {
  name: "summary-first",
  description: "Try OMEGA Layer-3 summaries first; fall through to Layer-2 FTS for the remainder.",
  search: async (ctx: RetrievalContext, query: string, opts?: RetrievalModeOptions) => {
    const limit = Math.max(1, opts?.limit ?? 10);
    const summariesOnly = Boolean(opts?.params?.["summariesOnly"]);

    const q = query.trim().toLowerCase();
    const summaries = listFromStore(ctx);

    const hits: RetrievalHit[] = [];
    for (const s of summaries) {
      if (!matchesSummary(s, q)) continue;
      hits.push({
        id: s.id,
        content: s.content,
        score: 2.0,
        reason: `layer-3 summary (${s.sourceEventCount} events)`,
        metadata: {
          layer: 3,
          sessionId: s.sessionId,
          sourceEventCount: s.sourceEventCount,
        },
      });
      if (hits.length >= limit) break;
    }

    let isHeuristic = false;
    let notes = "";
    if (summariesOnly) {
      return {
        mode: "summary-first",
        results: hits.slice(0, limit),
        scoring: {
          method: "summary-priority",
          weights: { summariesOnly: 1 },
        },
      };
    }

    if (hits.length < limit) {
      const entries =
        ctx.entries ?? (ctx.store ? ftsToSearchable(ctx.store.search(query, limit * 3)) : []);
      const remaining = limit - hits.length;
      const topUp: RetrievalHit[] = [];
      for (const e of entries) {
        topUp.push({
          id: e.id,
          content: e.content,
          score: 1.0,
          reason: "layer-2 fact (fallthrough)",
          metadata: { layer: 2 },
        });
        if (topUp.length >= remaining) break;
      }
      hits.push(...topUp);
      if (summaries.length === 0) {
        isHeuristic = true;
        notes = "no Layer-3 summaries present; returned Layer-2 only";
      }
    }
    return {
      mode: "summary-first",
      results: hits.slice(0, limit),
      scoring: {
        method: "summary-priority",
        ...(isHeuristic ? { isHeuristic, notes } : {}),
      },
    };
  },
};
