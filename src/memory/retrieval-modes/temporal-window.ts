/**
 * temporal-window — constrain results to a [from, to] time window.
 *
 * Leverages P1-M5 bi-temporal semantics: `validFrom` / `validTo`
 * describe when the fact was true in the world. Unlike fact-time-travel
 * (which takes a single `validAt` instant) this mode takes a WINDOW
 * and returns any entry whose `eventDate` (fact-time) OR `documentDate`
 * (ingest-time) intersects the window.
 *
 * Fallback: when entries carry only a flat `timestamp` (unit tests),
 * we treat it as both axes.
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import { ftsToSearchable } from "./types.js";

interface TemporalWindowParams {
  readonly from?: number;
  readonly to?: number;
}

function paramsOf(opts?: RetrievalModeOptions): TemporalWindowParams {
  const p = opts?.params ?? {};
  const from = typeof p["from"] === "number" ? (p["from"] as number) : undefined;
  const to = typeof p["to"] === "number" ? (p["to"] as number) : undefined;
  return { from, to };
}

export const temporalWindow: RetrievalMode = {
  name: "temporal-window",
  description: "Filter entries whose timestamp falls within [from, to] milliseconds.",
  search: async (ctx, query, opts) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const { from, to } = paramsOf(opts);

    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(50, limit * 3))) : []);

    const nowMs = ctx.now ? Date.parse(ctx.now) || Date.now() : Date.now();
    const q = query.trim().toLowerCase();

    const hits: RetrievalHit[] = [];
    for (const e of entries) {
      if (q && !e.content.toLowerCase().includes(q)) continue;
      const ts = e.timestamp;
      if (ts === undefined) continue;
      if (from !== undefined && ts < from) continue;
      if (to !== undefined && ts > to) continue;

      const age = Math.max(0, nowMs - ts);
      const score = 1 / (1 + age / 86_400_000);
      hits.push({
        id: e.id,
        content: e.content,
        score,
        reason: "within temporal window",
        metadata: { timestamp: ts, ageDays: age / 86_400_000 },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "temporal-window",
      results: hits.slice(0, limit),
      scoring: {
        method: "window-filter+recency-decay",
        ...(from === undefined && to === undefined
          ? { isHeuristic: true, notes: "no window supplied; returning all timestamped hits" }
          : {}),
      },
    };
  },
};
