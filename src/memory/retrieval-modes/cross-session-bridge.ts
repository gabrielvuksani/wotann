/**
 * cross-session-bridge — merge results from multiple sessionIds via RRF.
 *
 * Single-session search is often the default (avoid leaking one
 * conversation into another). But for persistent knowledge
 * ("what patterns have I used for retry logic?") we want to pull
 * from every session. This mode runs the base FTS once per supplied
 * `sessionIds[]` and fuses the rankings via RRF.
 *
 * When ctx.store is absent we operate over the injected ctx.entries
 * pool by partitioning them by metadata.sessionId, fusing each
 * partition's matches through RRF. That keeps the mode unit-testable.
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import { ftsToSearchable } from "./types.js";
import { hybridFusion, type SearchHit } from "../extended-search-types.js";

function paramsOf(opts?: RetrievalModeOptions): { sessionIds: readonly string[]; rrfK: number } {
  const p = opts?.params ?? {};
  const raw = p["sessionIds"];
  const sessionIds = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : [];
  const rrfK = typeof p["rrfK"] === "number" ? (p["rrfK"] as number) : 60;
  return { sessionIds, rrfK };
}

export const crossSessionBridge: RetrievalMode = {
  name: "cross-session-bridge",
  description: "Run search across multiple sessionIds and fuse rankings via RRF (k=60 default).",
  search: async (ctx: RetrievalContext, query: string, opts?: RetrievalModeOptions) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const { sessionIds, rrfK } = paramsOf(opts);

    if (sessionIds.length === 0) {
      return {
        mode: "cross-session-bridge",
        results: [],
        scoring: {
          method: "rrf-across-sessions",
          isHeuristic: true,
          notes: "no sessionIds supplied",
        },
      };
    }

    // Build one ranking per session.
    const rankings: SearchHit[][] = [];
    const idToContent = new Map<string, string>();
    for (const sessionId of sessionIds) {
      let pool = ctx.entries ?? [];
      if (ctx.store && !ctx.entries) {
        pool = ftsToSearchable(ctx.store.search(query, Math.max(50, limit * 3)));
      }
      const q = query.trim().toLowerCase();
      const perSession: SearchHit[] = [];
      for (const e of pool) {
        const sid = (e.metadata?.["sessionId"] as string | null | undefined) ?? null;
        if (sid !== sessionId) continue;
        if (q && !e.content.toLowerCase().includes(q)) continue;
        perSession.push({ entry: e, score: 1, reason: `session=${sessionId}` });
        idToContent.set(e.id, e.content);
      }
      rankings.push(perSession);
    }

    const fused = hybridFusion(rankings, rrfK);
    const hits: RetrievalHit[] = fused.slice(0, limit).map((f) => ({
      id: f.entry.id,
      content: idToContent.get(f.entry.id) ?? f.entry.content,
      score: f.score,
      ...(f.reason ? { reason: f.reason } : {}),
      metadata: { fused: true },
    }));
    return {
      mode: "cross-session-bridge",
      results: hits,
      scoring: {
        method: "rrf-across-sessions",
        weights: { rrfK, sessionCount: sessionIds.length },
      },
    };
  },
};
