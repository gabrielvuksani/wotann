/**
 * ASMR voter ensemble — V9 Tier 14.2a.
 *
 * Port of the Supermemory "8-12 variant voter" pattern that hit 99% on
 * LongMemEval: run the same query through N different retrievers, then
 * majority-vote the top-K using reciprocal-rank fusion (RRF). The
 * ensemble smooths out individual-retriever bias — a FTS5 miss doesn't
 * tank the answer because the vector backend + cross-encoder reranker
 * are voting alongside it.
 *
 * ── Why RRF ──────────────────────────────────────────────────────────
 * RRF (Cormack et al. 2009) is the simple, parameter-light fusion
 * algorithm TREC uses for meta-search. For each retriever r and each
 * result d at rank k(r, d):
 *
 *   score(d) = Σ_r  1 / (K + k(r, d))
 *
 * Missing results from a retriever contribute zero — no penalty-
 * tuning, no score-normalization, no brittle calibration. The single
 * tunable K is conventionally 60; Supermemory's tests showed K=60
 * reproduces the published LongMemEval results within noise.
 *
 * ── When to use ──────────────────────────────────────────────────────
 * Route through the voter when retrieval quality matters more than
 * latency (~N× retriever cost). The T2 benchmark runner wires it for
 * the LongMemEval nightly — WOTANN's own memory reads stick to the
 * single-retriever `temprSearch` path for latency reasons.
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: a retriever that throws is recorded in
 *    the result's `errors[]` array and its vote is silently dropped —
 *    NEVER fabricated — rather than failing the whole query.
 *  - QB #7 per-call state: pure async function. No module-level state.
 *  - QB #13 env guard: accepts clock + retriever injection; zero
 *    `process.*` reads.
 */

import type { MemoryEntry, MemorySearchResult } from "./store.js";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * A retriever is anything that turns a query string into a scored
 * result list. Callers inject retrievers already configured with
 * their store + mode + reranker so the voter is transport-agnostic.
 */
export type AsmrRetriever = (query: string) => Promise<readonly MemorySearchResult[]>;

export interface AsmrRetrieverSpec {
  /** Short label for telemetry + error reporting. */
  readonly name: string;
  readonly retriever: AsmrRetriever;
}

export interface AsmrVoteOptions {
  /**
   * Reciprocal-rank fusion constant. Smaller K emphasizes top-rank
   * agreement; larger K flattens the curve. 60 is the TREC default
   * and Supermemory's verified setting.
   */
  readonly k?: number;
  /** How many results to return from the vote. */
  readonly topK?: number;
  /**
   * Optional clock injection for deterministic tests (voter records
   * per-retriever durations for telemetry).
   */
  readonly now?: () => number;
}

export interface AsmrRetrieverTelemetry {
  readonly name: string;
  readonly durationMs: number;
  readonly hitCount: number;
  readonly error?: string;
}

export interface AsmrVoteHit {
  readonly entry: MemoryEntry;
  readonly fusedScore: number;
  /**
   * Per-retriever rank this hit appeared at (1-indexed). Absent
   * from a retriever means that retriever didn't return the entry.
   */
  readonly ranks: Readonly<Record<string, number>>;
}

export interface AsmrVoteResult {
  readonly hits: readonly AsmrVoteHit[];
  readonly telemetry: readonly AsmrRetrieverTelemetry[];
  readonly totalDurationMs: number;
  /**
   * True when at least one retriever failed — callers may still get
   * usable results, but quality is degraded (e.g. vector missing ⇒
   * only FTS-side evidence).
   */
  readonly hasPartialFailure: boolean;
}

// ═══ Runner ═══════════════════════════════════════════════════════════════

/**
 * Run the full ensemble. Fires every retriever concurrently via
 * `Promise.allSettled` so a slow one doesn't stall the voter. Returns
 * a structured result with per-retriever telemetry + the fused top-K.
 */
export async function runAsmrVoter(
  query: string,
  retrievers: readonly AsmrRetrieverSpec[],
  options: AsmrVoteOptions = {},
): Promise<AsmrVoteResult> {
  if (retrievers.length === 0) {
    return {
      hits: [],
      telemetry: [],
      totalDurationMs: 0,
      hasPartialFailure: false,
    };
  }

  const k = options.k ?? 60;
  const topK = options.topK ?? 10;
  const now = options.now ?? Date.now;
  const totalStart = now();

  const settled = await Promise.allSettled(
    retrievers.map(async (spec) => {
      const start = now();
      try {
        const hits = await spec.retriever(query);
        return {
          name: spec.name,
          hits,
          durationMs: now() - start,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        throw { name: spec.name, error, durationMs: now() - start };
      }
    }),
  );

  // Aggregate hits by entry ID with RRF scoring.
  const scoreById = new Map<string, number>();
  const entryById = new Map<string, MemoryEntry>();
  const ranksById = new Map<string, Record<string, number>>();
  const telemetry: AsmrRetrieverTelemetry[] = [];
  let hasPartialFailure = false;

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const spec = retrievers[i]!;
    if (outcome.status === "rejected") {
      hasPartialFailure = true;
      const reason = outcome.reason as { error?: string; durationMs?: number };
      telemetry.push({
        name: spec.name,
        durationMs: typeof reason?.durationMs === "number" ? reason.durationMs : 0,
        hitCount: 0,
        error: reason?.error ?? "unknown",
      });
      continue;
    }

    const { name, hits, durationMs } = outcome.value;
    telemetry.push({ name, durationMs, hitCount: hits.length });

    hits.forEach((result, idx) => {
      const id = result.entry.id;
      const rank = idx + 1;
      const contribution = 1 / (k + rank);
      scoreById.set(id, (scoreById.get(id) ?? 0) + contribution);
      if (!entryById.has(id)) entryById.set(id, result.entry);
      const ranks = ranksById.get(id) ?? {};
      ranks[name] = rank;
      ranksById.set(id, ranks);
    });
  }

  const fusedHits: AsmrVoteHit[] = [];
  for (const [id, score] of scoreById.entries()) {
    const entry = entryById.get(id);
    if (!entry) continue;
    fusedHits.push({
      entry,
      fusedScore: score,
      ranks: ranksById.get(id) ?? {},
    });
  }
  fusedHits.sort((a, b) => b.fusedScore - a.fusedScore);

  return {
    hits: fusedHits.slice(0, topK),
    telemetry,
    totalDurationMs: now() - totalStart,
    hasPartialFailure,
  };
}

/**
 * Convenience helper: synthesize N retrievers from a base retriever by
 * varying a seed parameter (useful when the underlying retriever takes
 * a randomized reranker or a shuffled candidate set). Callers supply
 * the seed→retriever factory; the voter handles fanout.
 *
 * Callers typically prefer passing a curated `AsmrRetrieverSpec[]`
 * directly — this helper is for quick experiments + benchmarks.
 */
export function spreadRetrievers(
  factory: (seed: number) => AsmrRetriever,
  count: number,
  labelPrefix: string = "variant",
): readonly AsmrRetrieverSpec[] {
  const specs: AsmrRetrieverSpec[] = [];
  for (let i = 0; i < count; i++) {
    specs.push({
      name: `${labelPrefix}-${i + 1}`,
      retriever: factory(i),
    });
  }
  return specs;
}
