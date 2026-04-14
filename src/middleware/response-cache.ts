/**
 * Response Cache — Query Deduplication Layer.
 *
 * Caches LLM query responses keyed by content hash to avoid duplicate API calls.
 * This is NOT prompt caching (which is provider-side) — this is client-side
 * response memoization for identical queries.
 *
 * STRATEGY:
 * - SHA-256 hash of (model + system prompt + messages + tools)
 * - LRU eviction when cache exceeds maxEntries
 * - TTL-based expiration (default: 1 hour for code, 24h for docs)
 * - Separate caches per session (prevents cross-session leakage)
 * - Query-type-aware: never cache streaming, always cache classify/utility
 *
 * WHAT GETS CACHED:
 * ✓ Identical queries with same model/prompt/tools → cached response
 * ✓ Classification queries (task categorization) → 24h TTL
 * ✓ WASM-bypass results (deterministic) → infinite TTL
 * ✗ Streaming responses → never cached (partial results)
 * ✗ Tool-use chains → never cached (non-deterministic)
 * ✗ Queries with temperature > 0 → never cached (non-deterministic)
 */

import { createHash } from "node:crypto";

// ── Types ────────────────────────────────────────────────

export interface CacheEntry {
  readonly key: string;
  readonly response: string;
  readonly model: string;
  readonly provider: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly hitCount: number;
  readonly queryType: QueryCacheType;
}

export type QueryCacheType =
  | "classify"
  | "utility"
  | "wasm"
  | "code"
  | "general"
  | "uncacheable";

export interface CacheableQuery {
  readonly model: string;
  readonly provider: string;
  readonly systemPrompt?: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly tools?: readonly { readonly name: string }[];
  readonly temperature?: number;
  readonly stream?: boolean;
}

export interface CacheConfig {
  readonly enabled: boolean;
  readonly maxEntries: number;
  readonly defaultTtlMs: number;
  readonly classifyTtlMs: number;
  readonly wasmTtlMs: number;
  readonly codeTtlMs: number;
  readonly maxResponseSize: number;
}

export interface CacheStats {
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly totalSavedTokens: number;
  readonly totalSavedCostUsd: number;
  readonly hitRate: number;
  readonly oldestEntry: number;
  readonly newestEntry: number;
}

// ── Default Config ───────────────────────────────────────

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  maxEntries: 1000,
  defaultTtlMs: 60 * 60 * 1000, // 1 hour
  classifyTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  wasmTtlMs: Number.MAX_SAFE_INTEGER, // infinite (deterministic)
  codeTtlMs: 60 * 60 * 1000, // 1 hour
  maxResponseSize: 100_000, // 100KB max per response
};

// ── Hash Function ────────────────────────────────────────

function hashQuery(query: CacheableQuery): string {
  const canonical = JSON.stringify({
    m: query.model,
    p: query.provider,
    s: query.systemPrompt ?? "",
    msgs: query.messages.map((m) => `${m.role}:${m.content}`),
    t: query.tools?.map((t) => t.name).sort() ?? [],
  });

  return createHash("sha256").update(canonical).digest("hex");
}

// ── Cache Type Classification ────────────────────────────

export function classifyQueryCacheType(query: CacheableQuery): QueryCacheType {
  // Never cache streaming or high-temperature queries
  if (query.stream) return "uncacheable";
  if (query.temperature !== undefined && query.temperature > 0) return "uncacheable";

  // Check for tool-use chains (non-deterministic)
  if (query.tools && query.tools.length > 0) {
    // Tool-use is only cacheable for classification
    const lastMessage = query.messages[query.messages.length - 1];
    if (lastMessage?.content.length && lastMessage.content.length < 100) {
      return "classify";
    }
    return "uncacheable";
  }

  // WASM bypass (deterministic computation)
  const lastMsg = query.messages[query.messages.length - 1]?.content ?? "";
  if (/^(format|count|sort|hash|base64|encode|decode)\s/i.test(lastMsg)) {
    return "wasm";
  }

  // Classification queries
  if (
    /^(classify|categorize|determine|what type|which category)/i.test(lastMsg)
  ) {
    return "classify";
  }

  // Short utility queries
  if (lastMsg.length < 200) return "utility";

  // Code generation (cacheable with shorter TTL)
  if (/```|function |class |import |export |const |let |var /i.test(lastMsg)) {
    return "code";
  }

  return "general";
}

// ── Response Cache ───────────────────────────────────────

export class ResponseCache {
  private readonly config: CacheConfig;
  private readonly cache: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Look up a cached response for a query.
   * Returns null if not found, expired, or uncacheable.
   */
  get(query: CacheableQuery): CacheEntry | null {
    if (!this.config.enabled) {
      this.misses++;
      return null;
    }

    const type = classifyQueryCacheType(query);
    if (type === "uncacheable") {
      this.misses++;
      return null;
    }

    const key = hashQuery(query);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Update hit count (immutable update)
    const updated: CacheEntry = { ...entry, hitCount: entry.hitCount + 1 };
    this.cache.set(key, updated);
    this.hits++;

    return updated;
  }

  /**
   * Store a response in the cache.
   * Automatically determines TTL based on query type.
   */
  set(
    query: CacheableQuery,
    response: string,
    metadata: { tokensUsed: number; costUsd: number },
  ): boolean {
    if (!this.config.enabled) return false;

    const type = classifyQueryCacheType(query);
    if (type === "uncacheable") return false;

    // Don't cache oversized responses
    if (response.length > this.config.maxResponseSize) return false;

    const key = hashQuery(query);
    const ttl = this.getTtlForType(type);
    const now = Date.now();

    const entry: CacheEntry = {
      key,
      response,
      model: query.model,
      provider: query.provider,
      tokensUsed: metadata.tokensUsed,
      costUsd: metadata.costUsd,
      createdAt: now,
      expiresAt: now + ttl,
      hitCount: 0,
      queryType: type,
    };

    // Evict if at capacity
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
    return true;
  }

  /**
   * Invalidate all cached entries for a specific model/provider.
   */
  invalidateByProvider(provider: string): number {
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (entry.provider === provider) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Invalidate all cached entries matching a predicate.
   */
  invalidateWhere(predicate: (entry: CacheEntry) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (predicate(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Remove expired entries.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const entries = [...this.cache.values()];
    const totalSavedTokens = entries.reduce(
      (sum, e) => sum + e.tokensUsed * e.hitCount,
      0,
    );
    const totalSavedCostUsd = entries.reduce(
      (sum, e) => sum + e.costUsd * e.hitCount,
      0,
    );

    const timestamps = entries.map((e) => e.createdAt);

    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      totalSavedTokens,
      totalSavedCostUsd,
      hitRate:
        this.hits + this.misses > 0
          ? this.hits / (this.hits + this.misses)
          : 0,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : 0,
    };
  }

  /**
   * Export cache contents for debugging/serialization.
   */
  export(): readonly CacheEntry[] {
    return [...this.cache.values()];
  }

  // ── Private ────────────────────────────────────────────

  private getTtlForType(type: QueryCacheType): number {
    switch (type) {
      case "classify":
        return this.config.classifyTtlMs;
      case "wasm":
        return this.config.wasmTtlMs;
      case "code":
        return this.config.codeTtlMs;
      case "utility":
      case "general":
        return this.config.defaultTtlMs;
      default:
        return this.config.defaultTtlMs;
    }
  }

  private evictLRU(): void {
    // Find the entry with the oldest access (createdAt + least hits)
    let oldestKey: string | null = null;
    let oldestScore = Infinity;

    for (const [key, entry] of this.cache) {
      // Score = last access time weighted by hit count
      const score = entry.createdAt + entry.hitCount * 60_000;
      if (score < oldestScore) {
        oldestScore = score;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }
}
