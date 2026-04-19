/**
 * Web search providers — Phase 4 Sprint B2 item 15.
 *
 * Several benchmarks (GAIA, SimpleQA, SearchBench, SWE-bench-Live) need
 * fresh web search, not just model knowledge. WOTANN ships two free-tier
 * providers plus a pass-through cache:
 *
 *   - BraveSearchProvider   — free: 2000 queries/month, 1/sec
 *                             (env BRAVE_API_KEY)
 *   - TavilySearchProvider  — free: 1000 queries/month, AI-summaries
 *                             (env TAVILY_API_KEY)
 *   - fallbackSearchProvider([...]) — chain them: try A, fall back to B
 *                                     on error or zero-result
 *   - cachingSearchProvider(p, {ttlMs, maxEntries})
 *                           — in-memory LRU wrapper. Critical: benchmark
 *                             runs repeat queries across turns; caching
 *                             saves dollars AND speeds up scoring.
 *
 * Reuses SearchHit type from deep-research.ts so providers feed directly
 * into the existing research engine.
 *
 * No external deps. Uses global fetch (Node ≥ 18).
 */

import type { SearchHit } from "./deep-research.js";

// ── Types ──────────────────────────────────────────────

export interface WebSearchProvider {
  readonly name: string;
  readonly search: (query: string, maxResults?: number) => Promise<readonly SearchHit[]>;
}

export interface SearchProviderOptions {
  /** Override API key (otherwise reads from env). */
  readonly apiKey?: string;
  /** Override API endpoint (otherwise uses the service's default). */
  readonly endpoint?: string;
  /** Request timeout in ms. Default 15_000. */
  readonly timeoutMs?: number;
  /** Custom fetch (for testing). Default globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface CacheOptions {
  /** Time-to-live in ms for cached results. Default 3_600_000 (1h). */
  readonly ttlMs?: number;
  /** Max entries before LRU eviction. Default 500. */
  readonly maxEntries?: number;
  /** Inject time source (for testing). Default Date.now. */
  readonly now?: () => number;
}

// ── Brave ──────────────────────────────────────────────

const BRAVE_DEFAULT_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/**
 * Brave Search provider (2000 queries/month free, 1/sec rate limit).
 * Docs: https://api.search.brave.com/app/documentation/web-search/get-started
 */
export function createBraveSearchProvider(options: SearchProviderOptions = {}): WebSearchProvider {
  const apiKey = options.apiKey ?? process.env.BRAVE_API_KEY ?? "";
  const endpoint = options.endpoint ?? BRAVE_DEFAULT_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    name: "brave",
    search: async (query, maxResults = 10) => {
      if (!apiKey) throw new Error("BraveSearchProvider: BRAVE_API_KEY is required");
      if (!query.trim()) return [];
      const url = `${endpoint}?q=${encodeURIComponent(query)}&count=${Math.max(1, Math.min(20, maxResults))}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
          },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(`Brave Search returned ${res.status}: ${await res.text()}`);
        }
        const json = (await res.json()) as {
          web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
        };
        const results = json.web?.results ?? [];
        return results.slice(0, maxResults).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.description ?? "",
        }));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Tavily ─────────────────────────────────────────────

const TAVILY_DEFAULT_ENDPOINT = "https://api.tavily.com/search";

/**
 * Tavily Search provider (1000 queries/month free). Returns AI-summarised
 * content — better for RAG-style benchmarks but slightly slower.
 * Docs: https://docs.tavily.com/docs/rest-api/api-reference
 */
export function createTavilySearchProvider(options: SearchProviderOptions = {}): WebSearchProvider {
  const apiKey = options.apiKey ?? process.env.TAVILY_API_KEY ?? "";
  const endpoint = options.endpoint ?? TAVILY_DEFAULT_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    name: "tavily",
    search: async (query, maxResults = 10) => {
      if (!apiKey) throw new Error("TavilySearchProvider: TAVILY_API_KEY is required");
      if (!query.trim()) return [];
      const body = {
        api_key: apiKey,
        query,
        max_results: Math.max(1, Math.min(20, maxResults)),
        search_depth: "basic" as const,
        include_answer: false,
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(`Tavily Search returned ${res.status}: ${await res.text()}`);
        }
        const json = (await res.json()) as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const results = json.results ?? [];
        return results.slice(0, maxResults).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.content ?? "",
        }));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Fallback chain ─────────────────────────────────────

/**
 * Chain multiple providers: try in order, use first non-empty result.
 * On error, fall through to the next. If all fail, throws the last error.
 */
export function fallbackSearchProvider(providers: readonly WebSearchProvider[]): WebSearchProvider {
  if (providers.length === 0) {
    throw new Error("fallbackSearchProvider: at least one provider required");
  }
  return {
    name: `fallback(${providers.map((p) => p.name).join("+")})`,
    search: async (query, maxResults) => {
      let lastError: unknown = null;
      for (const p of providers) {
        try {
          const hits = await p.search(query, maxResults);
          if (hits.length > 0) return hits;
        } catch (e) {
          lastError = e;
        }
      }
      if (lastError) throw lastError;
      return [];
    },
  };
}

// ── Cache ──────────────────────────────────────────────

interface CacheEntry {
  readonly value: readonly SearchHit[];
  readonly expiresAt: number;
}

/**
 * In-memory LRU cache with TTL. Normalizes the query (trim + lowercase)
 * so "Foo " and "foo" share an entry.
 */
export function cachingSearchProvider(
  provider: WebSearchProvider,
  options: CacheOptions = {},
): WebSearchProvider {
  const ttlMs = options.ttlMs ?? 3_600_000;
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? Date.now;
  // Map keeps insertion order → we evict the oldest on overflow (simple LRU)
  const cache = new Map<string, CacheEntry>();

  const keyOf = (query: string, maxResults: number | undefined): string =>
    `${query.trim().toLowerCase()}\0${maxResults ?? 10}`;

  return {
    name: `cache(${provider.name})`,
    search: async (query, maxResults) => {
      const key = keyOf(query, maxResults);
      const existing = cache.get(key);
      if (existing && existing.expiresAt > now()) {
        // Re-insert to refresh LRU position
        cache.delete(key);
        cache.set(key, existing);
        return existing.value;
      }
      if (existing) cache.delete(key); // expired
      const value = await provider.search(query, maxResults);
      cache.set(key, { value, expiresAt: now() + ttlMs });
      // Evict oldest if over cap
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return value;
    },
  };
}

// ── Factory convenience ────────────────────────────────

/**
 * Convenience factory: build a Brave→Tavily fallback chain with caching.
 * Picks up BRAVE_API_KEY and TAVILY_API_KEY from env. Gracefully skips
 * any provider without an API key — returns null if none configured.
 */
export function createDefaultWebSearchProvider(
  options: { readonly cache?: CacheOptions } = {},
): WebSearchProvider | null {
  const providers: WebSearchProvider[] = [];
  if (process.env.BRAVE_API_KEY) {
    providers.push(createBraveSearchProvider());
  }
  if (process.env.TAVILY_API_KEY) {
    providers.push(createTavilySearchProvider());
  }
  if (providers.length === 0) return null;
  const base = providers.length === 1 ? providers[0]! : fallbackSearchProvider(providers);
  return cachingSearchProvider(base, options.cache ?? {});
}
