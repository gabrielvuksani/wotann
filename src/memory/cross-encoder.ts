/**
 * Cross-encoder reranker — Phase 2 P1-M4 (Hindsight port).
 *
 * A cross-encoder takes a query + a list of candidate documents and
 * scores (query, doc) pairs for relevance. Cross-encoders outperform
 * bi-encoders (dense retrievers) on rerank quality because they see
 * the query-doc PAIR jointly, not two independent embeddings.
 *
 * Hindsight's reference stack uses `cross-encoder/ms-marco-MiniLM-L-6-v2`.
 * We DO NOT ship that here:
 *   - @xenova/transformers was removed from the WOTANN dep tree
 *     (large download, poor device story, conflicts with sqlite-vec
 *     roadmap).
 *   - sqlite-vec + ONNX runtime lands in Phase 2 P1-M2; that milestone
 *     is the proper home for the real MiniLM cross-encoder.
 *
 * What we ship NOW:
 *   - `createHeuristicCrossEncoder`: a length-normalized, case-
 *     insensitive query-token-overlap scorer. Good enough to
 *     demonstrate the wire-up, deterministic, zero-dep, honest about
 *     what it is (a heuristic).
 *   - `createCrossEncoderFromFn`: inject any custom scoring function
 *     (sync or async). This is the upgrade path — once P1-M2 lands
 *     ONNX + MiniLM, the MiniLM inference call slots in through this
 *     hook without touching `TEMPR` or any caller.
 *
 * Quality bar #6 (honest-fail): if a scoring function throws, the
 * reranker returns candidates in ORIGINAL order with zero scores
 * rather than crashing the whole TEMPR query.
 */

// ── Types ──────────────────────────────────────────────

export interface CrossEncoderCandidate {
  readonly id: string;
  readonly content: string;
}

export interface CrossEncoderHit {
  readonly id: string;
  readonly content: string;
  readonly score: number;
}

export interface CrossEncoder {
  readonly rerank: (
    query: string,
    candidates: readonly CrossEncoderCandidate[],
  ) => Promise<readonly CrossEncoderHit[]>;
}

/**
 * Custom score function signature. Takes query + doc contents and
 * returns per-doc relevance scores (one per doc, same order).
 *
 * MUST return an array of the same length as `docs` — otherwise the
 * wrapper treats the whole batch as failed and returns zero-scored
 * passes-through.
 */
export type ScoreFn = (
  query: string,
  docs: readonly string[],
) => readonly number[] | Promise<readonly number[]>;

// ── Heuristic implementation ──────────────────────────

/**
 * Word-overlap cross-encoder. Score = overlap_count / sqrt(doc_tokens).
 *
 *   - Case-insensitive tokenization
 *   - 2+ char tokens (skips stop-punctuation)
 *   - Length-normalized so short docs aren't always beaten by long ones
 *   - Deterministic, pure, zero-dep
 *
 * This is a STUB. Real quality needs MiniLM. The interface is stable;
 * upgrade without touching the TEMPR wiring.
 */
export function createHeuristicCrossEncoder(): CrossEncoder {
  return {
    rerank: async (query, candidates) => {
      if (candidates.length === 0) return [];
      const qTokens = tokenize(query);
      const qSet = new Set(qTokens);

      const scored: CrossEncoderHit[] = candidates.map((c) => {
        if (qSet.size === 0) {
          return { id: c.id, content: c.content, score: 0 };
        }
        const dTokens = tokenize(c.content);
        if (dTokens.length === 0) {
          return { id: c.id, content: c.content, score: 0 };
        }
        let overlap = 0;
        for (const t of dTokens) {
          if (qSet.has(t)) overlap++;
        }
        // Length-normalize: sqrt damping means "memory" (1 token, 1
        // overlap) still beats "memory + 100 filler tokens" (1 overlap,
        // but denominator is sqrt(101) ≈ 10).
        const score = overlap === 0 ? 0 : overlap / Math.sqrt(dTokens.length);
        return { id: c.id, content: c.content, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored;
    },
  };
}

// ── Function wrapper (injection path) ─────────────────

/**
 * Wrap an arbitrary scoring function as a CrossEncoder. The scoring
 * function gets (query, docs[]) and returns per-doc scores.
 *
 * This is the upgrade slot. When P1-M2 lands ONNX + MiniLM, do:
 *
 *   const miniLm = createCrossEncoderFromFn(async (q, docs) => {
 *     const pairs = docs.map((d) => ({ query: q, doc: d }));
 *     const scores = await onnxSession.run(pairs);   // real MiniLM
 *     return scores;
 *   });
 *
 * No change to TEMPR or store.ts. The interface is load-bearing.
 */
export function createCrossEncoderFromFn(scoreFn: ScoreFn): CrossEncoder {
  return {
    rerank: async (query, candidates) => {
      if (candidates.length === 0) return [];
      const docs = candidates.map((c) => c.content);

      let scores: readonly number[];
      try {
        scores = await Promise.resolve(scoreFn(query, docs));
      } catch {
        // Honest-fail: return pass-through with zero scores rather
        // than crashing. Caller sees the hits, score=0, ordered as
        // input. TEMPR's rerankerApplied flag will reflect that the
        // rerank did not complete meaningfully (though the promise
        // did resolve — the failure is captured as a score-vector).
        return candidates.map((c) => ({ id: c.id, content: c.content, score: 0 }));
      }

      // Sanity-check: scores must be 1:1 with candidates.
      if (!Array.isArray(scores) || scores.length !== candidates.length) {
        return candidates.map((c) => ({ id: c.id, content: c.content, score: 0 }));
      }

      const hits: CrossEncoderHit[] = candidates.map((c, i) => ({
        id: c.id,
        content: c.content,
        score: Number(scores[i] ?? 0),
      }));
      hits.sort((a, b) => b.score - a.score);
      return hits;
    },
  };
}

// ── Helpers ───────────────────────────────────────────

function tokenize(text: string): readonly string[] {
  return text.toLowerCase().match(/\b[a-z0-9]{2,}\b/g) ?? [];
}
