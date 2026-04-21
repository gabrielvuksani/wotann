/**
 * fact-time-travel — filter by `valid_from` (when the fact became true).
 *
 * Leverages P1-M5 bi-temporal edges' knowledge-time axis:
 *   valid_from ≤ validAt AND (valid_to IS NULL OR valid_to > validAt)
 *
 * Where ingest-time-travel asks "what did WOTANN KNOW at T?", this
 * mode asks "what was TRUE at T?". Useful for queries like "who was
 * the CEO in 2019?" — the fact was ingested much later, but its
 * validity window straddles 2019.
 *
 * Implementation: filter entries by metadata.validFrom ≤ validAt AND
 * (metadata.validTo undefined OR metadata.validTo > validAt). When
 * entries lack explicit validFrom/validTo we fall back to timestamp
 * (heuristic: treat timestamp as a point-in-time validFrom).
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import { ftsToSearchable } from "./types.js";

function validAtOf(opts?: RetrievalModeOptions, fallback?: string): string | undefined {
  const p = opts?.params ?? {};
  const supplied = typeof p["validAt"] === "string" ? (p["validAt"] as string) : undefined;
  return supplied ?? fallback;
}

export const factTimeTravel: RetrievalMode = {
  name: "fact-time-travel",
  description: "Return entries whose validity window covers a given `validAt` ISO-8601 date.",
  search: async (ctx: RetrievalContext, query: string, opts?: RetrievalModeOptions) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const validAt = validAtOf(opts, ctx.now);
    if (!validAt) {
      return {
        mode: "fact-time-travel",
        results: [],
        scoring: {
          method: "valid-window-filter",
          isHeuristic: true,
          notes: "no validAt supplied and no ctx.now; returning empty",
        },
      };
    }
    const validAtMs = Date.parse(validAt);
    if (Number.isNaN(validAtMs)) {
      return {
        mode: "fact-time-travel",
        results: [],
        scoring: {
          method: "valid-window-filter",
          isHeuristic: true,
          notes: `invalid validAt "${validAt}"`,
        },
      };
    }

    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(50, limit * 3))) : []);

    const q = query.trim().toLowerCase();
    const hits: RetrievalHit[] = [];
    let usedHeuristic = false;
    for (const e of entries) {
      if (q && !e.content.toLowerCase().includes(q)) continue;
      const vfRaw =
        (e.metadata?.["validFrom"] as string | undefined) ??
        (e.metadata?.["valid_from"] as string | undefined);
      const vtRaw =
        (e.metadata?.["validTo"] as string | undefined) ??
        (e.metadata?.["valid_to"] as string | undefined);
      let vfMs: number | undefined;
      let vtMs: number | undefined;
      if (vfRaw) vfMs = Date.parse(vfRaw);
      else if (e.timestamp !== undefined) {
        vfMs = e.timestamp;
        usedHeuristic = true;
      }
      if (vtRaw) vtMs = Date.parse(vtRaw);

      if (vfMs === undefined || Number.isNaN(vfMs)) continue;
      if (vfMs > validAtMs) continue;
      if (vtMs !== undefined && !Number.isNaN(vtMs) && vtMs <= validAtMs) continue;

      hits.push({
        id: e.id,
        content: e.content,
        score: 1.0,
        reason: `valid at ${validAt}`,
        metadata: { validFrom: vfMs, validTo: vtMs ?? null, validAt: validAtMs },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "fact-time-travel",
      results: hits.slice(0, limit),
      scoring: {
        method: "valid-window-filter",
        ...(usedHeuristic
          ? {
              isHeuristic: true,
              notes: "some entries lacked explicit validFrom; timestamp used as fallback",
            }
          : {}),
        weights: { validAtMs },
      },
    };
  },
};
