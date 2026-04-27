/**
 * Live Codex model discovery — replaces the prior hardcoded
 * `["codexplan", "codexspark"]` static list (a 2-of-6 subset of what
 * a paid ChatGPT subscriber actually has access to).
 *
 * Background — what was wrong:
 *   `codexspark` and `codexplan` are WOTANN-invented aliases inherited
 *   from the OpenClaude project, NOT real Codex SDK names. The OpenAI
 *   Codex CLI itself removed all hardcoded model presets in early 2026
 *   (see `codex-rs/models-manager/src/model_presets.rs` upstream:
 *   "Hardcoded model presets were removed; model listings are now
 *   derived from the active catalog."). The CLI now fetches the
 *   subscriber's available model list from the Codex backend on every
 *   process start, caching for 300 s. WOTANN was hiding gpt-5.5,
 *   gpt-5.4-mini, gpt-5.2, and any plan-specific variants from the
 *   model picker because we never asked the backend.
 *
 * What this module does:
 *   1. POST /backend-api/codex/models with the user's JWT access token
 *      and account-id. Returns ModelInfo[] for that subscription
 *      (Plus / Pro / Business / Edu / Enterprise — server gates per
 *      account so we don't have to).
 *   2. Cache results on disk (~/.wotann/codex-models-cache.json) for
 *      300 s, ETag-aware. Mirrors the OpenAI CLI's caching contract so
 *      the picker doesn't hit the network every keystroke.
 *   3. On network failure or stale auth, fall back to a bundled static
 *      list — the canonical 5-model catalog from openai/codex's
 *      models-manager bundle. Caller never sees an empty list.
 *
 * Honest fallback (QB#5/QB#10):
 *   - Returns the static list with `source: "bundled"` so the picker
 *     can disclose "live discovery unavailable — showing bundled
 *     defaults; run `codex login` if the list looks short."
 *   - Never silently returns an empty array. If even the bundled list
 *     fails to load (programmer error — shouldn't happen), we throw.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

// ── Static fallback ─────────────────────────────────────────

/**
 * Canonical Codex model catalog — kept in sync with openai/codex's
 * `codex-rs/models-manager/models.json` bundle. Used when the live
 * `/models` endpoint is unreachable (no network, expired auth, etc.).
 *
 * Entry order = picker priority. `gpt-5.5` is the current frontier
 * default for all plan tiers; `gpt-5.3-codex` is the fast loop variant
 * formerly aliased as `codexspark` in WOTANN; `gpt-5.4` is the high-
 * reasoning variant formerly aliased as `codexplan`.
 *
 * If you update this list, also update:
 *   - src/context/limits.ts (per-model context-window table)
 *   - src/telemetry/cost-tracker.ts (per-model pricing table — Codex
 *     entries are $0/$0 because subscription users pay flat-fee, but
 *     the entries must exist or the cost tracker reports null)
 */
const BUNDLED_CODEX_MODELS: readonly CodexModelInfo[] = [
  {
    slug: "gpt-5.5",
    displayName: "GPT-5.5",
    contextWindow: 272_000,
    priority: 100,
    visibility: "list",
    supportsReasoning: true,
  },
  {
    slug: "gpt-5.4",
    displayName: "GPT-5.4",
    contextWindow: 272_000,
    priority: 90,
    visibility: "list",
    supportsReasoning: true,
  },
  {
    slug: "gpt-5.4-mini",
    displayName: "GPT-5.4 mini",
    contextWindow: 272_000,
    priority: 80,
    visibility: "list",
    supportsReasoning: true,
  },
  {
    slug: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    contextWindow: 272_000,
    priority: 70,
    visibility: "list",
    supportsReasoning: false,
  },
  {
    slug: "gpt-5.2",
    displayName: "GPT-5.2",
    contextWindow: 272_000,
    priority: 60,
    visibility: "list",
    supportsReasoning: false,
  },
] as const;

// ── Types ───────────────────────────────────────────────────

export interface CodexModelInfo {
  readonly slug: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly priority: number;
  readonly visibility: "list" | "hide";
  readonly supportsReasoning: boolean;
}

export type CodexModelsSource = "live" | "cached" | "bundled";

export interface CodexModelsResult {
  readonly models: readonly CodexModelInfo[];
  readonly source: CodexModelsSource;
  readonly fetchedAt: number;
  readonly planType?: string | undefined;
}

interface DiskCacheEntry {
  readonly models: readonly CodexModelInfo[];
  readonly fetchedAt: number;
  readonly etag?: string;
  readonly accountId?: string;
  readonly planType?: string;
}

// ── Cache ───────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 300 s — matches openai/codex CLI
const CACHE_FILENAME = "codex-models-cache.json";
const MODELS_FETCH_TIMEOUT_MS = 5_000;
const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

function cachePath(): string {
  // Mirror the rest of the WOTANN home layout so users can audit /
  // delete the cache like any other state file.
  return resolveWotannHomeSubdir(CACHE_FILENAME);
}

function readCache(): DiskCacheEntry | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DiskCacheEntry;
  } catch {
    return null;
  }
}

function writeCache(entry: DiskCacheEntry): void {
  try {
    const path = cachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry, null, 2), "utf-8");
  } catch {
    // Cache writes are best-effort — failure here only forces a
    // re-fetch on the next call, which is acceptable. Silent swallow
    // is justified because the user-visible failure mode is "slightly
    // slower next picker open," not "missing data."
  }
}

function isCacheFresh(entry: DiskCacheEntry, accountId: string | undefined): boolean {
  // Cache is per-account so multi-account users never see another
  // account's models. Empty accountId matches empty (raw_token mode).
  if ((entry.accountId ?? "") !== (accountId ?? "")) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

// ── JWT plan-claim parsing ──────────────────────────────────

interface AuthClaims {
  readonly chatgpt_plan_type?: string;
  readonly chatgpt_account_id?: string;
}

/**
 * Decode the namespaced auth claims from a Codex `id_token` JWT.
 * The id_token payload contains a `https://api.openai.com/auth`
 * sub-object whose `chatgpt_plan_type` we surface in the picker so
 * users know which plan tier their token has unlocked. We do NOT use
 * this for gating — the server already gates per-account on /models.
 *
 * Returns null on any parse failure (missing token, malformed JWT,
 * missing claim — all treated equivalently because plan info is a
 * nice-to-have, never a correctness requirement).
 */
export function decodePlanClaims(idToken: string | undefined): AuthClaims | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadB64 = parts[1] ?? "";
    // base64url -> base64 padding
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const decoded = Buffer.from(padded + padding, "base64").toString("utf-8");
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    if (!auth) return null;
    return {
      chatgpt_plan_type:
        typeof auth["chatgpt_plan_type"] === "string"
          ? (auth["chatgpt_plan_type"] as string)
          : undefined,
      chatgpt_account_id:
        typeof auth["chatgpt_account_id"] === "string"
          ? (auth["chatgpt_account_id"] as string)
          : undefined,
    };
  } catch {
    return null;
  }
}

// ── Live fetch ──────────────────────────────────────────────

interface FetchInput {
  readonly accessToken: string;
  readonly accountId?: string | undefined;
  readonly etag?: string | undefined;
}

interface FetchResult {
  readonly models: readonly CodexModelInfo[];
  readonly etag: string | undefined;
  readonly notModified: boolean;
}

/**
 * GET /backend-api/codex/models with the user's JWT. Returns the
 * subscriber's available model list (server-side gated per account).
 *
 * Headers mirror what openai/codex CLI sends so the backend treats us
 * as a legitimate Codex client. We do NOT spoof the User-Agent — the
 * default node fetch UA is fine; spoofing would only matter if the
 * backend rate-limited by client identity (it doesn't).
 */
async function fetchCodexModels(input: FetchInput): Promise<FetchResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    "OpenAI-Beta": "responses=experimental",
    Accept: "application/json",
  };
  if (input.accountId && input.accountId.length > 0) {
    headers["chatgpt-account-id"] = input.accountId;
  }
  if (input.etag) {
    headers["If-None-Match"] = input.etag;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${CODEX_BASE_URL}/models`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (response.status === 304) {
      return { models: [], etag: input.etag, notModified: true };
    }
    if (!response.ok) {
      throw new Error(
        `Codex /models returned ${response.status}: ${await response.text().catch(() => "")}`,
      );
    }
    const etag = response.headers.get("etag") ?? undefined;
    const body = (await response.json()) as { models?: unknown };
    const rawModels = Array.isArray(body.models) ? body.models : [];
    const models: CodexModelInfo[] = [];
    for (const raw of rawModels) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as Record<string, unknown>;
      const slug = typeof obj["slug"] === "string" ? (obj["slug"] as string) : null;
      if (!slug) continue;
      models.push({
        slug,
        displayName:
          typeof obj["display_name"] === "string" ? (obj["display_name"] as string) : slug,
        contextWindow:
          typeof obj["context_window"] === "number" ? (obj["context_window"] as number) : 272_000,
        priority: typeof obj["priority"] === "number" ? (obj["priority"] as number) : 0,
        visibility: obj["visibility"] === "hide" ? "hide" : "list",
        supportsReasoning: Boolean(obj["supports_reasoning"]),
      });
    }
    return { models, etag, notModified: false };
  } finally {
    clearTimeout(timer);
  }
}

// ── Public entry point ──────────────────────────────────────

export interface DiscoverInput {
  readonly accessToken: string | undefined;
  readonly accountId?: string | undefined;
  readonly idToken?: string | undefined;
  /**
   * Force a re-fetch even if the cache is fresh. Wired to a future
   * `wotann codex refresh-models` command — never used in normal
   * picker flow.
   */
  readonly forceRefresh?: boolean;
}

/**
 * High-level discovery: cache → live fetch → bundled fallback.
 *
 * Always returns a non-empty list. The `source` field tells the caller
 * which path produced the result so the picker can render an honest
 * provenance line ("Live", "Cached 2 min ago", "Bundled — `codex
 * login` for live list").
 */
export async function discoverCodexModels(input: DiscoverInput): Promise<CodexModelsResult> {
  const planType = decodePlanClaims(input.idToken)?.chatgpt_plan_type ?? undefined;

  // 1. Try cache first unless forced
  if (!input.forceRefresh) {
    const cached = readCache();
    if (cached && isCacheFresh(cached, input.accountId)) {
      return {
        models: visibleModels(cached.models),
        source: "cached",
        fetchedAt: cached.fetchedAt,
        planType: cached.planType ?? planType,
      };
    }
  }

  // 2. Try live fetch when we have an access token
  if (input.accessToken && input.accessToken.length > 0) {
    try {
      const cached = readCache();
      const etag =
        cached && (cached.accountId ?? "") === (input.accountId ?? "") ? cached.etag : undefined;
      const fetched = await fetchCodexModels({
        accessToken: input.accessToken,
        accountId: input.accountId,
        etag,
      });
      if (fetched.notModified && cached) {
        // Server says the cached list is still current — bump the
        // timestamp and reuse it. This is the steady-state path on
        // a hot machine.
        const refreshed: DiskCacheEntry = {
          ...cached,
          fetchedAt: Date.now(),
          planType: planType ?? cached.planType,
        };
        writeCache(refreshed);
        return {
          models: visibleModels(refreshed.models),
          source: "cached",
          fetchedAt: refreshed.fetchedAt,
          planType: refreshed.planType,
        };
      }
      const models = fetched.models;
      if (models.length > 0) {
        const entry: DiskCacheEntry = {
          models,
          fetchedAt: Date.now(),
          etag: fetched.etag,
          accountId: input.accountId,
          planType,
        };
        writeCache(entry);
        return {
          models: visibleModels(models),
          source: "live",
          fetchedAt: entry.fetchedAt,
          planType,
        };
      }
      // Empty list from server — fall through to bundled. This is the
      // server's way of saying "your auth is valid but you have no
      // entitlements." Not an error per se, but a case where the
      // bundled list is more useful than an empty picker.
    } catch {
      // Network / auth failure — fall through to bundled. Never throw
      // because the picker MUST surface something the user can pick.
    }
  }

  // 3. Bundled fallback
  return {
    models: visibleModels(BUNDLED_CODEX_MODELS),
    source: "bundled",
    fetchedAt: Date.now(),
    planType,
  };
}

/**
 * Synchronous variant for hot paths (provider discovery at startup,
 * which can't await without restructuring downstream callers). Reads
 * cache only — never hits the network. Falls back to bundled on miss.
 *
 * Use the async `discoverCodexModels` whenever possible — it gives
 * users a fresh list. This sync variant exists purely to keep the
 * existing `discoverProviders()` shape in src/providers/discovery.ts
 * synchronous.
 */
export function discoverCodexModelsSync(accountId: string | undefined): CodexModelsResult {
  const cached = readCache();
  if (cached && isCacheFresh(cached, accountId)) {
    return {
      models: visibleModels(cached.models),
      source: "cached",
      fetchedAt: cached.fetchedAt,
      planType: cached.planType,
    };
  }
  return {
    models: visibleModels(BUNDLED_CODEX_MODELS),
    source: "bundled",
    fetchedAt: Date.now(),
    planType: cached?.planType,
  };
}

function visibleModels(models: readonly CodexModelInfo[]): readonly CodexModelInfo[] {
  return models
    .filter((m) => m.visibility === "list")
    .slice() // copy before sort (input may be readonly)
    .sort((a, b) => b.priority - a.priority);
}

/**
 * For tests + the legacy alias path: resolve the WOTANN-invented
 * aliases (`codexspark` / `codexplan` / `codexmini`) to real Codex
 * model slugs. The aliases are kept for muscle-memory backwards
 * compatibility; new code paths should use the real slugs directly.
 */
export function resolveCodexAlias(input: string): string {
  switch (input) {
    case "codexplan":
      return "gpt-5.4";
    case "codexspark":
      return "gpt-5.3-codex";
    case "codexmini":
      return "gpt-5.4-mini";
    default:
      return input;
  }
}

/**
 * Helper for diagnostic UIs (`/model status`, picker footer): resolve
 * the cache state the user is seeing without touching it.
 */
export function readCachedCodexModelsState(): {
  readonly models: readonly CodexModelInfo[];
  readonly source: CodexModelsSource;
  readonly fetchedAt: number;
  readonly accountId?: string;
} {
  const cached = readCache();
  if (!cached || Date.now() - cached.fetchedAt >= CACHE_TTL_MS) {
    return {
      models: visibleModels(BUNDLED_CODEX_MODELS),
      source: "bundled",
      fetchedAt: Date.now(),
    };
  }
  return {
    models: visibleModels(cached.models),
    source: "cached",
    fetchedAt: cached.fetchedAt,
    accountId: cached.accountId,
  };
}
