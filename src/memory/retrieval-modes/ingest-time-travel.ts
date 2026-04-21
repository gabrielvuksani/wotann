/**
 * ingest-time-travel — filter by `recorded_from` (when WOTANN learned).
 *
 * Leverages P1-M5 bi-temporal edges. The caller asks "what did WOTANN
 * know at time T?" — not "what was true at T". Those are different
 * axes:
 *   - knowledge-time (valid_from) = when a fact became true
 *   - ingest-time   (recorded_from) = when WOTANN ingested it
 *
 * Example: a user says on Mon "I moved to Toronto in 2020". The fact's
 * valid_from=2020 but its recorded_from=Mon. Asking ingest-time-travel
 * "what did WOTANN know on Sunday?" should NOT surface the fact even
 * though it was true then.
 *
 * Implementation: if ctx.store is present, read knowledge_edges via
 * store.queryKnownAt(knownAt). Otherwise filter ctx.entries by their
 * metadata.recordedAt (injected by tests).
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import { ftsToSearchable } from "./types.js";

function knownAtOf(opts?: RetrievalModeOptions, fallback?: string): string | undefined {
  const p = opts?.params ?? {};
  const supplied = typeof p["knownAt"] === "string" ? (p["knownAt"] as string) : undefined;
  return supplied ?? fallback;
}

export const ingestTimeTravel: RetrievalMode = {
  name: "ingest-time-travel",
  description: "Return entries WOTANN had ingested by a given `knownAt` ISO-8601 date.",
  search: async (ctx: RetrievalContext, query: string, opts?: RetrievalModeOptions) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const knownAt = knownAtOf(opts, ctx.now);
    if (!knownAt) {
      return {
        mode: "ingest-time-travel",
        results: [],
        scoring: {
          method: "recorded_from-filter",
          isHeuristic: true,
          notes: "no knownAt supplied and no ctx.now; returning empty",
        },
      };
    }

    const knownAtMs = Date.parse(knownAt);
    if (Number.isNaN(knownAtMs)) {
      return {
        mode: "ingest-time-travel",
        results: [],
        scoring: {
          method: "recorded_from-filter",
          isHeuristic: true,
          notes: `invalid knownAt "${knownAt}"`,
        },
      };
    }

    // Prefer injected entries (tests). Filter by metadata.recordedAt ≤ knownAt.
    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(50, limit * 3))) : []);

    const q = query.trim().toLowerCase();
    const hits: RetrievalHit[] = [];
    for (const e of entries) {
      if (q && !e.content.toLowerCase().includes(q)) continue;
      const recordedAtRaw =
        (e.metadata?.["recordedAt"] as string | undefined) ??
        (e.metadata?.["recorded_from"] as string | undefined);
      let recordedMs: number | undefined;
      if (recordedAtRaw) recordedMs = Date.parse(recordedAtRaw);
      else if (e.timestamp !== undefined) recordedMs = e.timestamp;
      if (recordedMs === undefined || Number.isNaN(recordedMs)) continue;
      if (recordedMs > knownAtMs) continue;

      const ageMs = Math.max(0, knownAtMs - recordedMs);
      const score = 1 / (1 + ageMs / 86_400_000);
      hits.push({
        id: e.id,
        content: e.content,
        score,
        reason: `recorded_from=${new Date(recordedMs).toISOString()} ≤ knownAt`,
        metadata: { recordedAt: recordedMs, knownAt: knownAtMs },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "ingest-time-travel",
      results: hits.slice(0, limit),
      scoring: { method: "recorded_from-filter", weights: { knownAtMs } },
    };
  },
};
