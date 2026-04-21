/**
 * Reciprocal Rank Fusion (RRF) — id-keyed wrapper for TEMPR.
 *
 * Phase 2 P1-M4, Hindsight port (arXiv 2512.12818).
 *
 * Background — Reciprocal Rank Fusion (Cormack et al., 2009):
 *
 *   score(d) = Σ_c  1 / (k + rank_c(d) + 1)
 *
 * where the sum is over channels c that return d, rank_c(d) is the
 * 0-based rank of d in channel c's ranking, and k is a constant
 * (60 is the literature default — it dampens the contribution of
 * very high-ranked outliers so each channel's top-10 contributes
 * meaningfully to the fused list).
 *
 * Why a wrapper, not a duplicate:
 *   - The canonical `hybridFusion` in extended-search-types.ts operates
 *     on `SearchHit[]` (entry + score + reason). That's the right
 *     abstraction for semantic-search.
 *   - TEMPR channels produce candidate IDs (and scores); the hit entry
 *     is rehydrated later by the caller. An id-keyed RRF is the
 *     natural API here.
 *   - Both are provably identical when `k` matches; this wrapper is a
 *     lightweight, id-keyed façade.
 *
 * Pure: no I/O, no globals. Per-query isolation is automatic — every
 * call allocates a fresh accumulator map.
 */

// ── Types ──────────────────────────────────────────────

/**
 * A single channel's ranking. `ranked[0]` is the top hit for the
 * channel. `channelName` is preserved through RRF for provenance
 * tracking in downstream debugging/observability.
 */
export interface ChannelRanking {
  readonly ranked: readonly string[];
  readonly channelName?: string;
}

/**
 * Output of RRF. Sorted by descending `score`. `contributingChannels`
 * lists the names of channels that contributed a non-zero rank for
 * this id — useful for "this memory surfaced because entity + bm25
 * agreed" explanations.
 */
export interface FusedRanking {
  readonly id: string;
  readonly score: number;
  readonly contributingChannels: readonly string[];
}

export interface RRFOptions {
  /**
   * RRF constant. Literature default is 60. Higher k flattens score
   * differences (each channel's top-k contributes more evenly).
   */
  readonly k?: number;
}

// ── Core ──────────────────────────────────────────────

/**
 * Fuse multiple channel rankings via Reciprocal Rank Fusion.
 *
 * @param channels   Per-channel rankings. Each is a list of ids ordered
 *                   most-relevant first.
 * @param options    `{ k?: number }`. Default k = 60.
 * @returns          Fused ranking sorted by descending RRF score.
 */
export function reciprocalRankFusion(
  channels: readonly ChannelRanking[],
  options: RRFOptions = {},
): readonly FusedRanking[] {
  const k = options.k ?? 60;
  if (channels.length === 0) return [];

  // accumulator: id → running score + contributing channel names
  const acc = new Map<string, { score: number; contributingChannels: string[] }>();

  for (const channel of channels) {
    const seenInThisChannel = new Set<string>();
    for (let rank = 0; rank < channel.ranked.length; rank++) {
      const id = channel.ranked[rank]!;
      // If a channel lists the same id multiple times, count only the
      // FIRST (highest) occurrence. This matches the common RRF
      // convention and makes the deduplication guarantee explicit.
      if (seenInThisChannel.has(id)) continue;
      seenInThisChannel.add(id);

      const contribution = 1 / (k + rank + 1);
      const existing = acc.get(id);
      if (existing) {
        existing.score += contribution;
        if (channel.channelName && !existing.contributingChannels.includes(channel.channelName)) {
          existing.contributingChannels.push(channel.channelName);
        }
      } else {
        acc.set(id, {
          score: contribution,
          contributingChannels: channel.channelName ? [channel.channelName] : [],
        });
      }
    }
  }

  // Materialize + sort by descending score. Ties are stable (insertion
  // order) because Map iteration is insertion-ordered and Array.sort
  // is stable in modern V8/JSC.
  const fused: FusedRanking[] = [];
  for (const [id, state] of acc) {
    fused.push({
      id,
      score: state.score,
      contributingChannels: state.contributingChannels,
    });
  }
  fused.sort((a, b) => b.score - a.score);
  return fused;
}
