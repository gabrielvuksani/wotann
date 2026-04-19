/**
 * Hybrid retrieval v2 — Supermemory-parity BM25 + dense + reranker
 * with Reciprocal Rank Fusion.
 *
 * The existing `hybrid-retrieval.ts` provides a general orchestration
 * skeleton (generic retrievers + LLM reranker). This v2 module adds the
 * SOTA pattern that Supermemory and Anthropic's Contextual Retrieval
 * paper use:
 *
 *   1. BM25  (lexical/keyword, via Okapi-BM25 scoring)
 *   2. Dense (vector embedding similarity, e.g. cosine)
 *   3. RRF fusion — combines the two rankings without needing score
 *      normalization (k=60 is the literature default).
 *   4. Cross-encoder reranker — re-scores the top-N fused hits using
 *      a query-doc pair model. BGE-reranker is the reference
 *      implementation; we ship a stub that preserves the interface so
 *      a real BGE or mxbai-rerank can slot in later.
 *
 * Why a separate file: the v1 orchestrator is a generic skeleton used
 * across the codebase. Extending it with Supermemory specifics would
 * couple the skeleton to particular scoring choices. A new file keeps
 * v1 stable while adding the parity layer.
 *
 * Interfaces:
 *   - BM25Retriever (via `createBm25Retriever`) — pure TS, Okapi BM25.
 *   - DenseRetriever (via `createDenseRetriever`) — caller supplies
 *     an embedding function; cosine similarity is computed here.
 *   - CrossEncoderReranker (via `createCrossEncoderStub` or a caller-
 *     supplied `Reranker`) — re-orders hits using query-doc pairs.
 *   - hybridSearchV2(query, entries, config) — orchestrator that wires
 *     the three together with RRF + reranker.
 *
 * No external deps beyond what the memory layer already uses.
 * Honest scores, no fabrication (quality bar #6).
 */

import { hybridFusion, type SearchableEntry, type SearchHit } from "./extended-search-types.js";
import type { Retriever, Reranker } from "./hybrid-retrieval.js";

// ── Types ──────────────────────────────────────────────

export interface HybridV2Config {
  /** Required: lexical retriever (BM25 or caller-provided FTS5-backed). */
  readonly bm25: Retriever;
  /** Required: dense/vector retriever. */
  readonly dense: Retriever;
  /** Optional extra retrievers (graph, recency, etc.). Fused alongside. */
  readonly extra?: readonly Retriever[];
  /** Optional reranker. Default: no rerank. */
  readonly reranker?: Reranker;
  /**
   * Minimum reranker score to keep a hit. Hits with reranker scores
   * below this are dropped. When the reranker is a stub that doesn't
   * produce scores, this threshold is effectively ignored (stub passes
   * through unchanged). Default 0.
   */
  readonly rerankThreshold?: number;
  /** Final top-k returned. Default 10. */
  readonly k?: number;
  /** Top-N fused hits to send to the reranker. Default 30. */
  readonly topNForRerank?: number;
  /** RRF constant. Default 60. */
  readonly fusionK?: number;
  /** Run retrievers in parallel. Default true. */
  readonly parallel?: boolean;
}

export interface HybridV2Query {
  readonly query: string;
  readonly k?: number;
  readonly rerankThreshold?: number;
}

export interface HybridV2Result {
  readonly hits: readonly SearchHit[];
  readonly fusedBeforeRerank: readonly SearchHit[];
  readonly bm25Hits: readonly SearchHit[];
  readonly denseHits: readonly SearchHit[];
  readonly extraHits: ReadonlyMap<string, readonly SearchHit[]>;
  readonly rerankerApplied: boolean;
  readonly droppedByThreshold: number;
  readonly durationMs: number;
}

// ── Orchestrator ──────────────────────────────────────

/**
 * Hybrid retrieval v2: BM25 + dense + optional reranker fused via RRF.
 *
 * @param query      Query text (tokenized internally by retrievers)
 * @param entries    Candidate corpus. Retrievers search within this set.
 * @param config     Required retrievers, optional reranker/threshold/k.
 */
export async function hybridSearchV2(
  query: string | HybridV2Query,
  entries: readonly SearchableEntry[],
  config: HybridV2Config,
): Promise<HybridV2Result> {
  const started = Date.now();

  const q = typeof query === "string" ? { query } : query;
  const k = q.k ?? config.k ?? 10;
  const rerankThreshold = q.rerankThreshold ?? config.rerankThreshold ?? 0;
  const topN = config.topNForRerank ?? 30;
  const fusionK = config.fusionK ?? 60;
  const parallel = config.parallel ?? true;

  // 1. Run BM25 + dense (+ optional extras)
  const retrievers: readonly Retriever[] = [config.bm25, config.dense, ...(config.extra ?? [])];

  const runOne = async (r: Retriever) => ({
    name: r.name,
    hits: await r.search(q.query, entries).catch(() => [] as readonly SearchHit[]),
  });

  const results = parallel
    ? await Promise.all(retrievers.map(runOne))
    : await runAllSequential(retrievers, runOne);

  const bm25Hits = results[0]?.hits ?? [];
  const denseHits = results[1]?.hits ?? [];
  const extraResults = results.slice(2);
  const extraHits = new Map(extraResults.map((r) => [r.name, r.hits]));

  // 2. RRF fusion
  const fused = hybridFusion(
    results.map((r) => r.hits),
    fusionK,
  );

  // 3. Trim to topN before reranking
  const topForRerank = fused.slice(0, topN);

  // 4. Rerank (optional)
  let reranked: readonly SearchHit[] = topForRerank;
  let rerankerApplied = false;
  let droppedByThreshold = 0;

  if (config.reranker && topForRerank.length > 0) {
    try {
      const rrOut = await config.reranker.rerank(q.query, topForRerank);
      rerankerApplied = true;
      // Drop hits below rerankThreshold
      if (rerankThreshold > 0) {
        const filtered = rrOut.filter((h) => h.score >= rerankThreshold);
        droppedByThreshold = rrOut.length - filtered.length;
        reranked = filtered;
      } else {
        reranked = rrOut;
      }
    } catch {
      // On failure, keep fused order as-is
      reranked = topForRerank;
      rerankerApplied = false;
    }
  }

  // 5. Final top-k
  const finalHits = reranked.slice(0, k);

  return {
    hits: finalHits,
    fusedBeforeRerank: topForRerank,
    bm25Hits,
    denseHits,
    extraHits,
    rerankerApplied,
    droppedByThreshold,
    durationMs: Date.now() - started,
  };
}

async function runAllSequential<T>(
  items: readonly Retriever[],
  fn: (r: Retriever) => Promise<T>,
): Promise<T[]> {
  const out: T[] = [];
  for (const r of items) {
    out.push(await fn(r));
  }
  return out;
}

// ── BM25 retriever ────────────────────────────────────

export interface Bm25Options {
  /** BM25 `k1` term-frequency saturation. Default 1.5. */
  readonly k1?: number;
  /** BM25 `b` length normalization. Default 0.75. */
  readonly b?: number;
  /** Custom tokenizer. Default: lowercase word tokens (len >= 2). */
  readonly tokenize?: (text: string) => readonly string[];
}

/**
 * Okapi BM25 retriever over an in-memory corpus. Re-indexes on every
 * call — O(N) per query, which is fine for the ~10-100k entry regime
 * the memory layer operates in. For larger corpora, swap this for a
 * SQLite FTS5-backed retriever via the same `Retriever` interface.
 */
export function createBm25Retriever(options: Bm25Options = {}): Retriever {
  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;
  const tokenize = options.tokenize ?? defaultTokenize;

  return {
    name: "bm25",
    search: async (query, entries) => {
      const qTokens = tokenize(query);
      if (qTokens.length === 0 || entries.length === 0) return [];

      // Doc stats
      const docTokens: string[][] = entries.map((e) => [...tokenize(e.content)]);
      const docLengths = docTokens.map((t) => t.length);
      const avgDl = docLengths.reduce((s, x) => s + x, 0) / Math.max(1, docLengths.length);
      const N = entries.length;

      // IDF per query term
      const df = new Map<string, number>();
      for (const t of new Set(qTokens)) {
        let count = 0;
        for (const tokens of docTokens) {
          if (tokens.includes(t)) count++;
        }
        df.set(t, count);
      }

      // Okapi BM25 with smoothed IDF: log(1 + (N - df + 0.5) / (df + 0.5))
      const hits: SearchHit[] = [];
      for (let i = 0; i < entries.length; i++) {
        const tokens = docTokens[i]!;
        const dl = docLengths[i]!;
        const tfMap = new Map<string, number>();
        for (const t of tokens) tfMap.set(t, (tfMap.get(t) ?? 0) + 1);

        let score = 0;
        for (const qt of qTokens) {
          const tf = tfMap.get(qt);
          if (!tf) continue;
          const n = df.get(qt) ?? 0;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          const denom = tf + k1 * (1 - b + b * (dl / (avgDl || 1)));
          score += idf * ((tf * (k1 + 1)) / (denom || 1));
        }

        if (score > 0) {
          hits.push({
            entry: entries[i]!,
            score,
            reason: `bm25=${score.toFixed(3)}`,
          });
        }
      }

      hits.sort((a, b) => b.score - a.score);
      return hits;
    },
  };
}

function defaultTokenize(text: string): readonly string[] {
  return text.toLowerCase().match(/\b[a-z0-9]{2,}\b/g) ?? [];
}

// ── Dense retriever ───────────────────────────────────

export interface DenseOptions {
  /**
   * Embedding function — caller supplies. The dense retriever will
   * reuse `entry.embedding` when present to avoid re-embedding.
   */
  readonly embed: (text: string) => Promise<readonly number[]>;
  /** Optional batch embed for missing entry embeddings. */
  readonly embedBatch?: (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;
  /**
   * Minimum cosine similarity to keep a hit. Default 0 (keep all
   * non-zero). Set higher to drop noise.
   */
  readonly minSim?: number;
}

/**
 * Dense retriever: cosine similarity between query embedding and
 * per-entry embeddings. Reuses `entry.embedding` when present.
 */
export function createDenseRetriever(options: DenseOptions): Retriever {
  const minSim = options.minSim ?? 0;

  return {
    name: "dense",
    search: async (query, entries) => {
      const qVec = await options.embed(query);
      if (qVec.length === 0 || entries.length === 0) return [];

      // Embed any entries that lack embeddings.
      const missingIdx: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (!entries[i]!.embedding || entries[i]!.embedding!.length === 0) {
          missingIdx.push(i);
        }
      }

      const computedVecs = new Map<number, readonly number[]>();
      if (missingIdx.length > 0) {
        if (options.embedBatch) {
          const texts = missingIdx.map((i) => entries[i]!.content);
          const vecs = await options.embedBatch(texts);
          missingIdx.forEach((i, k) => computedVecs.set(i, vecs[k] ?? []));
        } else {
          for (const i of missingIdx) {
            const v = await options.embed(entries[i]!.content);
            computedVecs.set(i, v);
          }
        }
      }

      const hits: SearchHit[] = [];
      for (let i = 0; i < entries.length; i++) {
        const eVec = entries[i]!.embedding ?? computedVecs.get(i) ?? [];
        const sim = cosineSimilarity(qVec, eVec);
        if (sim >= minSim && sim > 0) {
          hits.push({
            entry: entries[i]!,
            score: sim,
            reason: `cosine=${sim.toFixed(3)}`,
          });
        }
      }

      hits.sort((a, b) => b.score - a.score);
      return hits;
    },
  };
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Cross-encoder reranker stub ───────────────────────

export interface CrossEncoderInput {
  readonly query: string;
  readonly docs: readonly string[];
}

export interface CrossEncoderOutput {
  /** Per-doc relevance score in [0, 1], same length as docs. */
  readonly scores: readonly number[];
}

/**
 * Cross-encoder interface. Real implementations (BGE-reranker-base,
 * mxbai-rerank, Cohere Rerank) take a query + doc list and return a
 * relevance score per doc. Pass-through reranker stub preserves input
 * order but tags each hit with a scaled fallback score so the
 * `rerankThreshold` can still filter obviously-weak hits.
 */
export type CrossEncoderFn = (input: CrossEncoderInput) => Promise<CrossEncoderOutput>;

export interface CrossEncoderStubOptions {
  /** Max doc chars sent to the stub (real reranker sees ~512 tokens). */
  readonly maxDocChars?: number;
}

/**
 * Stub cross-encoder: echoes input scores rescaled to [0, 1] based on
 * original RRF rank. Useful for wiring tests without a model dep.
 *
 * Real BGE-reranker slots in via `createCrossEncoderReranker(bgeFn)`.
 */
export function createCrossEncoderStub(_options: CrossEncoderStubOptions = {}): CrossEncoderFn {
  return async (input) => {
    const n = input.docs.length;
    if (n === 0) return { scores: [] };
    // Linear decay from 1.0 down to ~0.1 based on input order — this
    // preserves the fused ranking but provides a deterministic score
    // the reranker threshold can filter against. NOT a real semantic
    // score — documented as a stub.
    const scores: number[] = [];
    for (let i = 0; i < n; i++) {
      scores.push(Math.max(0.1, 1 - (i / Math.max(1, n - 1)) * 0.9));
    }
    return { scores };
  };
}

/**
 * Wrap a CrossEncoderFn as a Reranker. Produces hits sorted by the
 * encoder's relevance scores (descending).
 */
export function createCrossEncoderReranker(
  encode: CrossEncoderFn,
  options: CrossEncoderStubOptions = {},
): Reranker {
  const maxDocChars = options.maxDocChars ?? 2000;
  return {
    name: "cross-encoder",
    rerank: async (query, hits) => {
      if (hits.length === 0) return hits;
      const docs = hits.map((h) => h.entry.content.slice(0, maxDocChars));
      const { scores } = await encode({ query, docs });
      if (scores.length !== hits.length) {
        // Length mismatch → return input unchanged
        return hits;
      }
      const rescored: SearchHit[] = hits.map((h, i) => ({
        entry: h.entry,
        score: scores[i] ?? 0,
        reason: `rerank=${(scores[i] ?? 0).toFixed(3)}`,
      }));
      rescored.sort((a, b) => b.score - a.score);
      return rescored;
    },
  };
}

// ── Re-exports for ergonomic wiring ──────────────────

export type { SearchableEntry, SearchHit } from "./extended-search-types.js";
export type { Retriever, Reranker } from "./hybrid-retrieval.js";
