/**
 * Semantic response cache — cache LLM responses by query similarity.
 *
 * Exact-match caches only hit on identical prompts. Semantic caches
 * hit on SIMILAR prompts — if a user asks "what's the capital of
 * France?" and later asks "Which city is France's capital?", both
 * hit the same cache entry.
 *
 * Uses cosine similarity over caller-supplied embeddings. Hit
 * threshold is tunable (default 0.95 — very strict; 0.85 is common
 * for production).
 *
 * Ships:
 *   - SemanticCache class with get/set/stats/clear
 *   - TTL-based expiration + LRU eviction
 *   - Injectable embed function (caller owns the model)
 */

// ── Types ──────────────────────────────────────────────

export interface CacheEntry<V> {
  readonly key: string;
  readonly embedding: readonly number[];
  readonly value: V;
  readonly insertedAt: number;
  readonly hits: number;
}

export interface SemanticCacheOptions {
  /** Similarity threshold for a hit. 0-1, higher = stricter. Default 0.95. */
  readonly similarityThreshold?: number;
  /** Max entries before LRU eviction. Default 500. */
  readonly maxEntries?: number;
  /** TTL in ms. Default 3_600_000 (1h). */
  readonly ttlMs?: number;
  /** Embed function — caller supplies. */
  readonly embed: (text: string) => Promise<readonly number[]>;
  /** Inject time. Default Date.now. */
  readonly now?: () => number;
}

export interface CacheStats {
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly evictions: number;
}

// ── Cache ──────────────────────────────────────────────

export class SemanticCache<V> {
  private readonly entries: Map<string, CacheEntry<V>> = new Map();
  private readonly options: Required<Omit<SemanticCacheOptions, "embed" | "now">> & {
    embed: (text: string) => Promise<readonly number[]>;
    now: () => number;
  };
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: SemanticCacheOptions) {
    this.options = {
      similarityThreshold: options.similarityThreshold ?? 0.95,
      maxEntries: options.maxEntries ?? 500,
      ttlMs: options.ttlMs ?? 3_600_000,
      embed: options.embed,
      now: options.now ?? (() => Date.now()),
    };
  }

  /**
   * Look up a value by query. Returns null on miss.
   * Checks embeddings via cosine similarity ≥ threshold.
   */
  async get(query: string): Promise<V | null> {
    this.pruneExpired();
    if (this.entries.size === 0) {
      this.misses++;
      return null;
    }

    const queryEmbedding = await this.options.embed(query);

    let bestSim = -Infinity;
    let bestKey: string | null = null;
    for (const [key, entry] of this.entries) {
      const sim = cosine(queryEmbedding, entry.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestKey = key;
      }
    }

    if (bestSim >= this.options.similarityThreshold && bestKey !== null) {
      const entry = this.entries.get(bestKey)!;
      // Move to most-recently-used by re-inserting
      this.entries.delete(bestKey);
      this.entries.set(bestKey, { ...entry, hits: entry.hits + 1 });
      this.hits++;
      return entry.value;
    }

    this.misses++;
    return null;
  }

  /** Store a value. Embeds the key + associates with value. */
  async set(key: string, value: V): Promise<void> {
    const embedding = await this.options.embed(key);
    this.entries.delete(key); // remove if exists (preserves LRU semantics)
    this.entries.set(key, {
      key,
      embedding,
      value,
      insertedAt: this.options.now(),
      hits: 0,
    });
    this.pruneExpired();
    this.evictIfOver();
  }

  /**
   * Memoize a fetcher. If query matches cached entry, return cached
   * value; else call fetcher + cache. Common use: wrap an LLM call.
   */
  async memoize(query: string, fetcher: () => Promise<V>): Promise<V> {
    const cached = await this.get(query);
    if (cached !== null) return cached;
    const value = await fetcher();
    await this.set(query, value);
    return value;
  }

  size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  stats(): CacheStats {
    this.pruneExpired();
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
    };
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  private pruneExpired(): void {
    const cutoff = this.options.now() - this.options.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.insertedAt < cutoff) {
        this.entries.delete(key);
        this.evictions++;
      }
    }
  }

  private evictIfOver(): void {
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
  }
}

// ── Helpers ────────────────────────────────────────────

/**
 * Phase 13 Wave-3C — char-bigram surrogate embedding for self-contained
 * semantic cache dedup. 128-dim by default, L2-normalized so cosine is
 * well-defined. Not a real semantic embedding but detects near-duplicate
 * prompts without requiring an ML dep. Deterministic — same input
 * always produces the same vector.
 */
export function bigramEmbedding(text: string, dim: number = 128): readonly number[] {
  const vec = new Float32Array(dim);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length - 1; i++) {
    const bg = normalized.charCodeAt(i) * 256 + normalized.charCodeAt(i + 1);
    const idx = Math.abs(bg) % dim;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  let mag = 0;
  for (const v of vec) mag += v * v;
  mag = Math.sqrt(mag);
  if (mag === 0) return Array.from(vec);
  const out: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) out[i] = (vec[i] ?? 0) / mag;
  return out;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
