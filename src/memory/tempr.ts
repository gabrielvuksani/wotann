/**
 * TEMPR — Time-aware Episodic Memory with Parallel Retrieval.
 *
 * Phase 2 P1-M4 (Hindsight port, arXiv 2512.12818). Reference: Vectorize
 * Hindsight, MIT, 91.4% LongMemEval-S with Gemini-3.
 *
 * TEMPR runs N independent retrieval channels in parallel — each with
 * a different signal — fuses them via Reciprocal Rank Fusion (RRF),
 * and reranks the top-K with a cross-encoder.
 *
 * The 4 canonical channels (Hindsight's "networks"):
 *
 *   1. VECTOR    — dense embedding similarity (captures semantic match)
 *   2. BM25      — lexical keyword overlap (captures exact/rare terms)
 *   3. ENTITY    — KG entity-lookup (captures typed-entity mentions;
 *                  leverages M7 recordEntity + getRelatedEntities)
 *   4. TEMPORAL  — bi-temporal snapshot (captures time-scoped facts;
 *                  leverages M5 querySnapshot / queryValidAt)
 *
 * Why parallel:
 *   - Different signals cover different failure modes. BM25 wins on
 *     exact rare terms; dense wins on paraphrases; entity wins on
 *     "who/what" queries; temporal wins on "when" queries.
 *   - RRF lets the top-K of any channel surface without requiring
 *     score-normalization — a single fused ranking emerges.
 *   - Running in parallel caps total latency at max(channel latency)
 *     rather than sum.
 *
 * Why injectable:
 *   - Unit tests mock channels.
 *   - Production calls wire real channels via store.ts temprSearch().
 *   - The 4-channel canonical stack is a DEFAULT; custom stacks (e.g.
 *     add a 5th "code-aware" channel) work without touching TEMPR.
 *
 * Quality bar #6 (honest-fail):
 *   - If channel X throws, the other channels still contribute.
 *   - The failure is recorded in `channelResults.get(X).error` and
 *     (optionally) surfaced via `onChannelError` callback.
 *   - The whole TEMPR call never crashes due to a single bad channel.
 *
 * Per-query isolation: TEMPR is stateless. Every call allocates its
 * own scratch state. The constructor only stores the channel list,
 * cross-encoder, and defaults — no per-query data.
 */

import { reciprocalRankFusion, type ChannelRanking } from "./rrf.js";
import type { CrossEncoder, CrossEncoderCandidate } from "./cross-encoder.js";

// ── Types ──────────────────────────────────────────────

/**
 * A candidate surfaced by a channel. `id` is the unique memory-entry
 * identifier (store row id, KG node id, whatever the channel uses).
 * `content` is what the cross-encoder will see.
 */
export interface TEMPRCandidate {
  readonly id: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Arguments passed to each channel. Channels receive the raw query +
 * a snapshot of shared options (topK hint). Channels are free to
 * ignore these and do their own thing.
 */
export interface TEMPRChannelArgs {
  readonly query: string;
  readonly topK?: number;
}

export interface TEMPRChannelResult {
  readonly candidates: readonly TEMPRCandidate[];
}

/**
 * A single retrieval channel. Channels MUST resolve (never reject) —
 * TEMPR relies on `.catch` at the outer level to turn rejections into
 * captured errors, but well-behaved channels handle their own errors
 * and return an empty candidate list.
 */
export interface TEMPRChannel {
  readonly name: string;
  readonly retrieve: (args: TEMPRChannelArgs) => Promise<TEMPRChannelResult>;
}

/**
 * Per-channel state captured during a TEMPR.search() call. Either
 * `candidates` is populated (success) or `error` is populated
 * (channel failed). Never both.
 */
export interface TEMPRChannelState {
  readonly channelName: string;
  readonly candidates?: readonly TEMPRCandidate[];
  readonly error?: Error;
}

/**
 * Hit returned by TEMPR — rehydrated candidate + fused score +
 * provenance chain (which channels contributed).
 */
export interface TEMPRHit {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly contributingChannels: readonly string[];
  readonly rerankScore?: number;
}

export interface TEMPRSearchResult {
  readonly hits: readonly TEMPRHit[];
  readonly channelResults: ReadonlyMap<string, TEMPRChannelState>;
  readonly rerankerApplied: boolean;
  readonly durationMs: number;
}

export interface TEMPRConfig {
  readonly channels: readonly TEMPRChannel[];
  /** Optional cross-encoder for top-K rerank. */
  readonly crossEncoder?: CrossEncoder;
  /** Top-K to keep AFTER rerank (or after fusion if no reranker). Default 20. */
  readonly topK?: number;
  /** Top-K to send TO the reranker. Default 30. */
  readonly topKBeforeRerank?: number;
  /** RRF constant. Default 60. */
  readonly rrfK?: number;
  /** Callback fired when a channel errors. Stateless — for observability. */
  readonly onChannelError?: (channelName: string, error: Error) => void;
}

export interface TEMPRSearchOptions {
  readonly topK?: number;
}

// ── TEMPR ──────────────────────────────────────────────

/**
 * TEMPR search handle. Statelsss — safe to share across concurrent
 * queries. Each `search()` call allocates its own state.
 */
export interface TEMPR {
  readonly search: (query: string, options?: TEMPRSearchOptions) => Promise<TEMPRSearchResult>;
}

export function createTEMPR(config: TEMPRConfig): TEMPR {
  const defaultTopK = config.topK ?? 20;
  const topKBeforeRerank = config.topKBeforeRerank ?? 30;
  const rrfK = config.rrfK ?? 60;

  return {
    search: async (query, options = {}) => {
      const started = Date.now();
      const topK = options.topK ?? defaultTopK;

      if (config.channels.length === 0) {
        return {
          hits: [],
          channelResults: new Map(),
          rerankerApplied: false,
          durationMs: Date.now() - started,
        };
      }

      // 1. Dispatch channels in parallel with isolated error handling.
      const channelPromises = config.channels.map(async (ch) => {
        try {
          const result = await ch.retrieve({ query, topK });
          const state: TEMPRChannelState = {
            channelName: ch.name,
            candidates: result.candidates,
          };
          return state;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          config.onChannelError?.(ch.name, error);
          const state: TEMPRChannelState = {
            channelName: ch.name,
            error,
          };
          return state;
        }
      });

      const channelStates = await Promise.all(channelPromises);
      const channelResults = new Map<string, TEMPRChannelState>();
      for (const state of channelStates) {
        channelResults.set(state.channelName, state);
      }

      // 2. Build a per-id content map AND per-channel rankings.
      //    When multiple channels surface the same id, the first
      //    non-empty content wins.
      const idToContent = new Map<string, TEMPRCandidate>();
      const rankings: ChannelRanking[] = [];
      for (const state of channelStates) {
        if (!state.candidates) continue;
        // Dedup within a channel so RRF's first-occurrence convention
        // is respected upstream. (RRF itself also dedups, but doing it
        // here keeps the id-to-content map clean.)
        const seen = new Set<string>();
        const ranked: string[] = [];
        for (const cand of state.candidates) {
          if (seen.has(cand.id)) continue;
          seen.add(cand.id);
          ranked.push(cand.id);
          if (!idToContent.has(cand.id) && cand.content) {
            idToContent.set(cand.id, cand);
          } else if (!idToContent.has(cand.id)) {
            // Ensure every surfaced id has SOMETHING to reference.
            idToContent.set(cand.id, cand);
          }
        }
        rankings.push({ ranked, channelName: state.channelName });
      }

      // 3. RRF fusion.
      const fused = reciprocalRankFusion(rankings, { k: rrfK });

      // 4. Trim to topKBeforeRerank BEFORE rerank.
      const preRerank = fused.slice(0, topKBeforeRerank);

      // 5. Optional cross-encoder rerank.
      let rerankerApplied = false;
      let finalHits: TEMPRHit[];

      if (config.crossEncoder && preRerank.length > 0) {
        const candidatesForRerank: CrossEncoderCandidate[] = preRerank.map((f) => {
          const c = idToContent.get(f.id);
          return { id: f.id, content: c?.content ?? "" };
        });

        try {
          const reranked = await config.crossEncoder.rerank(query, candidatesForRerank);
          rerankerApplied = true;
          // Preserve fused scoring for traceability but re-order by
          // rerankScore. Hits that lost content mapping fall to the
          // tail.
          const fusedById = new Map(fused.map((f) => [f.id, f]));
          finalHits = reranked.map((r) => {
            const f = fusedById.get(r.id);
            return {
              id: r.id,
              content: r.content,
              score: f?.score ?? 0,
              contributingChannels: f?.contributingChannels ?? [],
              rerankScore: r.score,
            };
          });
        } catch {
          // Honest-fail: rerank failure → fall back to fused order.
          rerankerApplied = false;
          finalHits = fusedToHits(preRerank, idToContent);
        }
      } else {
        finalHits = fusedToHits(preRerank, idToContent);
      }

      return {
        hits: finalHits.slice(0, topK),
        channelResults,
        rerankerApplied,
        durationMs: Date.now() - started,
      };
    },
  };
}

// ── Helpers ───────────────────────────────────────────

function fusedToHits(
  fused: readonly { id: string; score: number; contributingChannels: readonly string[] }[],
  idToContent: ReadonlyMap<string, TEMPRCandidate>,
): TEMPRHit[] {
  return fused.map((f) => {
    const c = idToContent.get(f.id);
    return {
      id: f.id,
      content: c?.content ?? "",
      score: f.score,
      contributingChannels: f.contributingChannels,
    };
  });
}
