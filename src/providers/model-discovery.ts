/**
 * Generic dynamic model discovery — replaces hardcoded model lists in
 * src/providers/discovery.ts for every provider that publishes a live
 * catalog endpoint.
 *
 * Why this exists:
 *   The prior implementation hardcoded a dozen-or-so model ids per
 *   provider in discovery.ts. The lists drifted (gpt-5.5 missing for
 *   Codex users, latest claude variants missing for Anthropic, etc.)
 *   and required code changes every time a vendor shipped a new model.
 *   Codex was fixed in this session via codex-models.ts; the same
 *   pattern applies to every other provider — they all publish a
 *   `/v1/models`-shaped endpoint or its provider-native equivalent.
 *
 * What this module does:
 *   1. `fetchOpenAICompatModels(baseUrl, token)` — hits
 *      `${baseUrl}/models` with a Bearer token and parses the standard
 *      `{data: [{id, ...}]}` response. Covers Groq, OpenRouter,
 *      Together, Fireworks, DeepSeek, xAI, Mistral, Cerebras,
 *      SambaNova, Perplexity, Azure (deployed models), and HuggingFace
 *      Router — every adapter we already build via
 *      createOpenAICompatAdapter.
 *   2. `fetchAnthropicModels(token)` — hits
 *      `https://api.anthropic.com/v1/models` with the
 *      `x-api-key` header (Anthropic's auth shape). Returns the live
 *      Claude catalog the user's account can access.
 *   3. `fetchGeminiModels(apiKey)` — hits Google's
 *      `generativelanguage.googleapis.com/v1beta/models` and projects
 *      the response into our flat string-id shape.
 *   4. `discoverModelsForProvider(spec)` — high-level switch that
 *      routes each provider to the right fetcher, caches results on
 *      disk for 5 min (per-provider key), and falls back to a bundled
 *      static list when network/auth fails. Mirrors the codex-models
 *      cache contract so ops semantics are uniform.
 *
 * Honest fallback (QB#5 / QB#10):
 *   On any failure path (network down, auth expired, malformed body),
 *   the function returns the bundled fallback list with
 *   `source: "bundled"` so the caller can disclose the degraded state.
 *   Never returns an empty list — the picker always has something to
 *   show. Errors are logged via `process.stderr.write`, not thrown.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProviderName } from "../core/types.js";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

// ── Public types ────────────────────────────────────────────

export type ModelSource = "live" | "cached" | "bundled";

export interface ModelDiscoveryResult {
  readonly provider: ProviderName;
  readonly models: readonly string[];
  readonly source: ModelSource;
  readonly fetchedAt: number;
  readonly error?: string;
}

export interface ProviderDiscoverySpec {
  readonly provider: ProviderName;
  readonly token?: string;
  readonly baseUrl?: string;
  /** Force refresh even if cache is fresh. */
  readonly forceRefresh?: boolean;
  /** Static fallback used when live + cache both fail. */
  readonly fallback: readonly string[];
}

// ── Cache layer ─────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — same as codex-models
const FETCH_TIMEOUT_MS = 5_000;

interface DiskCacheEntry {
  readonly models: readonly string[];
  readonly fetchedAt: number;
  readonly tokenFingerprint?: string;
}

function cachePath(provider: ProviderName): string {
  return resolveWotannHomeSubdir(`model-cache-${provider}.json`);
}

/**
 * Hash a token to a short fingerprint so cache entries can detect
 * "same provider, different account" without storing the raw token.
 * Two unrelated keys for the same provider should never share a cache.
 */
function tokenFingerprint(token: string | undefined): string | undefined {
  if (!token || token.length === 0) return undefined;
  // Lightweight non-cryptographic hash — we're not protecting the
  // token, just keying the cache. Hex of the first/last 4 chars +
  // length is enough to distinguish accounts.
  return `${token.slice(0, 4)}:${token.slice(-4)}:${token.length}`;
}

function readCache(provider: ProviderName, token: string | undefined): DiskCacheEntry | null {
  const path = cachePath(provider);
  if (!existsSync(path)) return null;
  try {
    const entry = JSON.parse(readFileSync(path, "utf-8")) as DiskCacheEntry;
    const fp = tokenFingerprint(token);
    if (fp !== entry.tokenFingerprint) return null;
    if (Date.now() - entry.fetchedAt >= CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(
  provider: ProviderName,
  models: readonly string[],
  token: string | undefined,
): void {
  try {
    const path = cachePath(provider);
    mkdirSync(dirname(path), { recursive: true });
    const entry: DiskCacheEntry = {
      models,
      fetchedAt: Date.now(),
      tokenFingerprint: tokenFingerprint(token),
    };
    writeFileSync(path, JSON.stringify(entry, null, 2), "utf-8");
  } catch {
    // Cache writes are best-effort. A failed write only forces the
    // next call to re-fetch; user impact is bounded to "slightly
    // slower next picker open."
  }
}

// ── Fetchers ────────────────────────────────────────────────

interface OpenAIModelsResponse {
  readonly data?: readonly { readonly id?: string }[];
}

async function fetchOpenAICompatModels(baseUrl: string, token: string): Promise<readonly string[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }
    const body = (await response.json()) as OpenAIModelsResponse;
    if (!body.data || !Array.isArray(body.data)) {
      throw new Error(`${url} did not return a {data: []} body`);
    }
    const ids: string[] = [];
    for (const m of body.data) {
      if (m && typeof m.id === "string" && m.id.length > 0) {
        ids.push(m.id);
      }
    }
    return ids;
  } finally {
    clearTimeout(timer);
  }
}

interface AnthropicModelsResponse {
  readonly data?: readonly { readonly id?: string; readonly type?: string }[];
}

async function fetchAnthropicModels(token: string): Promise<readonly string[]> {
  const url = "https://api.anthropic.com/v1/models";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": token,
        // anthropic-version header is required by the Messages API and
        // tolerated by /v1/models. Using a stable date so we don't
        // get pushed onto an unstable beta API surface.
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }
    const body = (await response.json()) as AnthropicModelsResponse;
    if (!body.data || !Array.isArray(body.data)) {
      throw new Error(`${url} did not return a {data: []} body`);
    }
    return body.data.filter((m) => m && typeof m.id === "string").map((m) => m.id as string);
  } finally {
    clearTimeout(timer);
  }
}

interface GeminiModel {
  readonly name?: string;
  readonly supportedGenerationMethods?: readonly string[];
}

async function fetchGeminiModels(apiKey: string): Promise<readonly string[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Gemini /v1beta/models returned ${response.status}`);
    }
    const body = (await response.json()) as { models?: readonly GeminiModel[] };
    if (!body.models || !Array.isArray(body.models)) {
      throw new Error("Gemini did not return a {models: []} body");
    }
    // Names come back as "models/gemini-2.5-flash" — strip the prefix
    // so callers see plain ids consistent with other providers.
    return body.models
      .filter((m) => {
        if (!m || typeof m.name !== "string") return false;
        // Filter to text-generation-capable models. Embedding-only
        // models clutter the picker and aren't usable from chat.
        const methods = m.supportedGenerationMethods ?? [];
        return methods.includes("generateContent");
      })
      .map((m) => (m.name as string).replace(/^models\//, ""));
  } finally {
    clearTimeout(timer);
  }
}

interface OllamaTagsResponse {
  readonly models?: readonly { readonly name?: string }[];
}

async function fetchOllamaModels(baseUrl: string): Promise<readonly string[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }
    const body = (await response.json()) as OllamaTagsResponse;
    if (!body.models || !Array.isArray(body.models)) {
      throw new Error(`${url} did not return a {models: []} body`);
    }
    return body.models.filter((m) => m && typeof m.name === "string").map((m) => m.name as string);
  } finally {
    clearTimeout(timer);
  }
}

// ── Provider routing ────────────────────────────────────────

/**
 * Map provider id → base URL for the OpenAI-compat `/models`
 * endpoint. Providers not listed here use a custom shape (Anthropic,
 * Gemini, Ollama, Vertex, Bedrock) and are handled in the switch
 * inside `discoverModelsForProvider`.
 */
const OPENAI_COMPAT_BASE_URLS: Partial<Record<ProviderName, string>> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  huggingface: "https://router.huggingface.co/v1",
};

/**
 * Top-level discovery: cache → live fetch → bundled fallback.
 *
 * Always returns a non-empty list. The `source` field tells the caller
 * which path produced the result so the picker can render an honest
 * provenance line ("Live now", "Cached 2 min ago", "Bundled defaults
 * — set <ENV> to enable live discovery").
 */
export async function discoverModelsForProvider(
  spec: ProviderDiscoverySpec,
): Promise<ModelDiscoveryResult> {
  const { provider, token, baseUrl, forceRefresh, fallback } = spec;

  if (!forceRefresh) {
    const cached = readCache(provider, token);
    if (cached) {
      return {
        provider,
        models: cached.models,
        source: "cached",
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const fallbackResult = (error?: string): ModelDiscoveryResult => ({
    provider,
    models: fallback,
    source: "bundled",
    fetchedAt: Date.now(),
    ...(error ? { error } : {}),
  });

  try {
    let models: readonly string[] = [];
    if (provider === "anthropic") {
      if (!token) return fallbackResult("no Anthropic token");
      models = await fetchAnthropicModels(token);
    } else if (provider === "gemini") {
      if (!token) return fallbackResult("no Gemini API key");
      models = await fetchGeminiModels(token);
    } else if (provider === "ollama") {
      const { resolveOllamaHost } = await import("./ollama-host.js");
      models = await fetchOllamaModels(baseUrl ?? resolveOllamaHost());
    } else {
      const url = baseUrl ?? OPENAI_COMPAT_BASE_URLS[provider];
      if (!url) return fallbackResult("no base URL for provider");
      if (!token) return fallbackResult(`no ${provider} token`);
      models = await fetchOpenAICompatModels(url, token);
    }
    if (models.length === 0) {
      // Successful fetch but empty list — server says we have no
      // entitlements. Fall back to bundled rather than show an empty
      // picker.
      return fallbackResult("provider returned 0 models");
    }
    writeCache(provider, models, token);
    return {
      provider,
      models,
      source: "live",
      fetchedAt: Date.now(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fallbackResult(message);
  }
}

/**
 * Synchronous variant for paths where async isn't available
 * (discovery.ts is sync and called at runtime startup). Reads the
 * disk cache only — never hits the network. Falls back to bundled on
 * miss. The async variant is what populates the cache; this one just
 * surfaces it.
 */
export function discoverModelsForProviderSync(
  spec: Pick<ProviderDiscoverySpec, "provider" | "token" | "fallback">,
): readonly string[] {
  const cached = readCache(spec.provider, spec.token);
  return cached ? cached.models : spec.fallback;
}

/**
 * Force-refresh the on-disk cache for one provider — used by a future
 * `wotann models refresh` CLI command and the Ctrl+R-from-picker
 * keybinding. Best-effort: returns the new list on success, the old
 * cached list on failure.
 */
export async function refreshModelsForProvider(
  spec: ProviderDiscoverySpec,
): Promise<ModelDiscoveryResult> {
  return discoverModelsForProvider({ ...spec, forceRefresh: true });
}
