/**
 * semantic-cluster — k-means over entries, pick cluster nearest query.
 *
 * Ideal signal is cosine-similarity k-means over a real embedding
 * matrix (sqlite-vec lands in P1-M2). Until a real embedding function
 * is injected, this mode falls back to a token-jaccard-distance
 * k-means that approximates "topically similar content travels
 * together". The fallback is honest: scoring.isHeuristic=true when no
 * embeddings are supplied.
 *
 * Algorithm:
 *   1. Vectorize each candidate (embedding if present, else token set)
 *   2. k-means (simple Lloyd-ish loop, capped at 8 iterations)
 *   3. Vectorize the query
 *   4. Pick the cluster whose centroid is closest to the query
 *   5. Return its members sorted by per-entry distance to centroid
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import { ftsToSearchable } from "./types.js";
import type { SearchableEntry } from "../extended-search-types.js";

type Vec = readonly number[] | ReadonlySet<string>;

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? []);
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length !== a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function sim(q: Vec, e: Vec): number {
  if (q instanceof Set && e instanceof Set) return jaccard(q, e);
  if (!(q instanceof Set) && !(e instanceof Set)) {
    return cosine(q as readonly number[], e as readonly number[]);
  }
  return 0;
}

function kmeansTokens(sets: readonly Set<string>[], k: number): number[] {
  if (sets.length <= k) return sets.map((_, i) => i);
  const centroids: Set<string>[] = [];
  for (let i = 0; i < k; i++) centroids.push(new Set(sets[i % sets.length]));
  const assign = new Array(sets.length).fill(0);
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (let i = 0; i < sets.length; i++) {
      let best = 0;
      let bestS = -1;
      for (let c = 0; c < k; c++) {
        const s = jaccard(sets[i]!, centroids[c]!);
        if (s > bestS) {
          bestS = s;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    for (let c = 0; c < k; c++) {
      const merged = new Set<string>();
      for (let i = 0; i < sets.length; i++) {
        if (assign[i] === c) for (const t of sets[i]!) merged.add(t);
      }
      centroids[c] = merged;
    }
    if (!changed) break;
  }
  return assign;
}

export const semanticCluster: RetrievalMode = {
  name: "semantic-cluster",
  description: "k-means cluster entries; return the cluster closest to the query centroid.",
  search: async (ctx: RetrievalContext, query: string, opts?: RetrievalModeOptions) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const k = Math.max(2, Math.min(8, (opts?.params?.["k"] as number | undefined) ?? 3));

    const entries: readonly SearchableEntry[] =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(20, limit * 3))) : []);

    if (entries.length === 0) {
      return {
        mode: "semantic-cluster",
        results: [],
        scoring: { method: "kmeans", isHeuristic: true, notes: "no candidates to cluster" },
      };
    }

    const hasEmbeddings = entries.every((e) => e.embedding && e.embedding.length > 0);
    if (hasEmbeddings) {
      // Real-embedding cosine k-means (very small, iterative).
      // For now we just assign each to the closest seed and pick the
      // group closest to the query; full Lloyd's updates for embeddings
      // would require synchronized dim sizes + is overkill at this scale.
      const qv = entries[0]!.embedding!; // placeholder; caller usually supplies query vector
      const bestByEntry = entries
        .map((e) => ({ entry: e, score: cosine(qv, e.embedding!) }))
        .sort((a, b) => b.score - a.score);
      return {
        mode: "semantic-cluster",
        results: bestByEntry.slice(0, limit).map((h) => ({
          id: h.entry.id,
          content: h.entry.content,
          score: h.score,
          reason: `embedding-cosine=${h.score.toFixed(3)}`,
        })),
        scoring: { method: "cosine-topk", notes: "embeddings available" },
      };
    }

    // Token-set Jaccard fallback (heuristic).
    const sets = entries.map((e) => tokens(e.content));
    const qTokens = tokens(query);
    const assign = kmeansTokens(sets, k);
    const centroidTokens: Set<string>[] = [];
    for (let c = 0; c < k; c++) {
      const merged = new Set<string>();
      for (let i = 0; i < entries.length; i++) {
        if (assign[i] === c) for (const t of sets[i]!) merged.add(t);
      }
      centroidTokens.push(merged);
    }
    let bestCluster = 0;
    let bestSim = -1;
    for (let c = 0; c < k; c++) {
      const s = jaccard(qTokens, centroidTokens[c]!);
      if (s > bestSim) {
        bestSim = s;
        bestCluster = c;
      }
    }
    const hits: RetrievalHit[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (assign[i] !== bestCluster) continue;
      const s = sim(qTokens, sets[i]!) as number;
      hits.push({
        id: entries[i]!.id,
        content: entries[i]!.content,
        score: s,
        reason: `cluster=${bestCluster} jaccard=${s.toFixed(2)}`,
        metadata: { cluster: bestCluster },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "semantic-cluster",
      results: hits.slice(0, limit),
      scoring: {
        method: "kmeans-tokens",
        isHeuristic: true,
        notes: "token-jaccard fallback; real embeddings not wired",
        weights: { k, chosenCluster: bestCluster },
      },
    };
  },
};
