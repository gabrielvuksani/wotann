/**
 * Provider discovery: auto-detect the supported providers from env vars and local state.
 * Returns immutable ProviderAuth objects for each detected provider.
 *
 * Wave DH-1: scoped per-provider model id consts. Each provider has its own
 * model namespace, so the canonical ids are pinned in dedicated blocks here.
 * Future model bumps update one const, not the dozens of scattered string
 * literals Wave 9 left behind.
 */

// ── Anthropic-native namespace (api.anthropic.com Messages API) ──────────
const ANTHROPIC_OPUS = "claude-opus-4-7";
const ANTHROPIC_SONNET = "claude-sonnet-4-7";
const ANTHROPIC_HAIKU = "claude-haiku-4-5";
const ANTHROPIC_MODELS: readonly string[] = [ANTHROPIC_OPUS, ANTHROPIC_SONNET, ANTHROPIC_HAIKU];

// ── Copilot-proxied namespace (api.githubcopilot.com — dotted versions) ──
const COPILOT_CLAUDE_OPUS = "claude-opus-4.7";
const COPILOT_CLAUDE_SONNET = "claude-sonnet-4.7";
const COPILOT_CLAUDE_HAIKU = "claude-haiku-4.5";

// ── AWS Bedrock namespace (anthropic.* prefix) ────────────────────────────
const BEDROCK_SONNET = "anthropic.claude-sonnet-4-7";
const BEDROCK_HAIKU = "anthropic.claude-haiku-4-5";

// ── Google Vertex namespace (Anthropic publishes to Vertex with -native ids) ─
const VERTEX_SONNET = "claude-sonnet-4-7";

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, totalmem } from "node:os";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import { discoverCodexModelsSync } from "./codex-models.js";
import { discoverModelsForProviderSync } from "./model-discovery.js";
import type { ProviderAuth, ProviderName, ProviderStatus } from "../core/types.js";

/**
 * Resolve a provider's model list by reading the on-disk cache
 * (populated by the runtime warmup at startup) and falling back to a
 * bundled static list when no cache exists. Replaces the prior
 * pattern of hardcoding `models: <CONST>` everywhere — every entry
 * still has its bundled fallback for first-run / offline scenarios,
 * but live entries take priority once the cache is warm.
 *
 * Synchronous because discoverProviders() is sync; the heavy lifting
 * (live HTTP fetches) happens in `warmupProviderModels` from
 * runtime.ts on a fire-and-forget Promise.allSettled.
 */
function resolveModels(
  provider: ProviderName,
  token: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  return discoverModelsForProviderSync({ provider, token, fallback });
}

// ── Codex Auth Reader ───────────────────────────────────────

/**
 * Real Codex auth.json format (created by `npx @openai/codex`):
 * {
 *   "auth_mode": "chatgpt",
 *   "OPENAI_API_KEY": null,
 *   "tokens": {
 *     "id_token": "...",
 *     "access_token": "...",
 *     "refresh_token": "...",
 *     "account_id": "..."
 *   },
 *   "last_refresh": "2026-03-31T04:09:24.331765Z"
 * }
 */
interface CodexAuthFileTokens {
  readonly access_token?: string;
  readonly id_token?: string;
  readonly refresh_token?: string;
  readonly account_id?: string;
}

interface CodexAuthFile {
  readonly auth_mode?: string;
  readonly OPENAI_API_KEY?: string | null;
  readonly tokens?: CodexAuthFileTokens;
  readonly token?: string;
  readonly api_key?: string;
}

function readCodexAuth(authPath: string): string | null {
  if (!existsSync(authPath)) return null;

  try {
    const raw = readFileSync(authPath, "utf-8");
    const parsed = JSON.parse(raw) as CodexAuthFile;

    // ChatGPT OAuth flow stores tokens.access_token
    if (parsed.tokens?.access_token) {
      return parsed.tokens.access_token;
    }

    // Direct API key in the file
    if (parsed.OPENAI_API_KEY) {
      return parsed.OPENAI_API_KEY;
    }

    // Legacy format
    return parsed.token ?? parsed.api_key ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the full Codex auth payload (vs `readCodexAuth` which extracts
 * only the bearer string). Used by the model-discovery layer to read
 * the `account_id` for the `chatgpt-account-id` request header and the
 * `id_token` for plan-claim parsing.
 *
 * Mirrors the resilient lookup pattern from codex-adapter.ts so legacy
 * auth.json shapes from older Codex CLI builds still work.
 */
function readCodexAuthPayload(
  authPath: string,
): { accessToken: string; accountId?: string; idToken?: string } | null {
  if (!existsSync(authPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf-8")) as CodexAuthFile;
    const accessToken =
      parsed.tokens?.access_token ?? parsed.OPENAI_API_KEY ?? parsed.token ?? parsed.api_key;
    if (!accessToken) return null;
    const result: { accessToken: string; accountId?: string; idToken?: string } = {
      accessToken,
    };
    if (parsed.tokens?.account_id) result.accountId = parsed.tokens.account_id;
    if (parsed.tokens?.id_token) result.idToken = parsed.tokens.id_token;
    return result;
  } catch {
    return null;
  }
}

// ── Ollama Discovery ────────────────────────────────────────

interface OllamaModel {
  readonly name: string;
  readonly size: number;
  readonly modified_at: string;
}

interface OllamaListResponse {
  readonly models: readonly OllamaModel[];
}

/**
 * Gemma 4 capability profile — used when Ollama reports a gemma4 model.
 * HumanEval 94.1%, Apache 2.0, native tool calling + vision + audio.
 */
export const GEMMA4_CAPABILITIES = {
  toolCalling: "native" as const,
  vision: true,
  audio: true,
  contextWindow: 128_000,
  codingTier: 1, // Tier 1 = best for coding
  reasoningTier: 1,
  multimodal: true,
  license: "Apache-2.0",
  variants: {
    gemma4: { activeParams: "4.5B", ramQ4: "5GB", bestFor: "8GB+ Macs" },
    "gemma4:e2b": { activeParams: "2.3B", ramQ4: "1.5GB", bestFor: "mobile/iPhone" },
    "gemma4:26b": { activeParams: "3.8B (MoE)", ramQ4: "18GB", bestFor: "32GB+ Macs" },
    "gemma4:31b": { activeParams: "31B", ramQ4: "20GB", bestFor: "64GB+ Macs" },
  },
} as const;

/** Check if a model name is a Gemma 4 variant */
export function isGemma4(modelName: string): boolean {
  return modelName.startsWith("gemma4") || modelName.startsWith("gemma-4");
}

/**
 * Auto-select the best local model based on available system RAM.
 * Returns the recommended model identifier, variant, and a human-readable reason.
 */
export function autoSelectLocalModel(): { model: string; variant: string; reason: string } {
  const totalRAM = totalmem() / 1024 ** 3; // Convert bytes to GB
  const rounded = Math.round(totalRAM);

  if (totalRAM >= 32) {
    return {
      model: "gemma4:26b",
      variant: "26b",
      reason: `${rounded}GB RAM detected — using full 26B model`,
    };
  }
  if (totalRAM >= 16) {
    return {
      model: "gemma4:e4b",
      variant: "e4b",
      reason: `${rounded}GB RAM — using efficient 4B model`,
    };
  }
  if (totalRAM >= 8) {
    return {
      model: "gemma4:e4b",
      variant: "e4b",
      reason: `${rounded}GB RAM — using efficient 4B model (may be slow)`,
    };
  }
  return {
    model: "gemma3:2b",
    variant: "2b",
    reason: `${rounded}GB RAM — using smallest available model`,
  };
}

export async function discoverOllamaModels(
  baseUrl: string = "http://localhost:11434",
): Promise<readonly string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = (await response.json()) as OllamaListResponse;
    return data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Check whether Ollama is reachable at the given base URL.
 * Returns true when the /api/version endpoint responds.
 */
export async function isOllamaReachable(
  baseUrl: string = "http://localhost:11434",
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${baseUrl}/api/version`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Auto-pull the default local model when Ollama is reachable but has no models
 * installed (S0-12). Non-blocking: returns immediately once the pull is
 * *initiated* so callers don't stall discovery. The chosen variant adapts to
 * available system RAM via `autoSelectLocalModel()`.
 *
 * Side effect: kicks off a streaming POST to /api/pull.
 */
export async function autoPullDefaultLocalModel(
  baseUrl: string = "http://localhost:11434",
): Promise<{ initiated: boolean; model: string; reason: string }> {
  const { model, reason } = autoSelectLocalModel();
  try {
    // Fire the pull request; don't await the full stream — Ollama will continue
    // downloading in the background.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { initiated: res.ok || res.status === 202, model, reason };
  } catch {
    // AbortError is expected — the pull takes minutes, we just wanted to start it.
    return { initiated: true, model, reason };
  }
}

// ── Free Endpoint Discovery ─────────────────────────────────

interface FreeEndpoint {
  readonly name: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly rateLimit: string;
}

const FREE_ENDPOINTS: readonly FreeEndpoint[] = [
  {
    name: "Cerebras",
    model: "llama-4-scout-17b-16e",
    baseUrl: "https://api.cerebras.ai/v1",
    rateLimit: "1M tokens/day",
  },
  {
    name: "Groq",
    model: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai/v1",
    rateLimit: "14.4K requests/day",
  },
  // Google Gemini is now a dedicated provider (see "gemini" in discoverProviders)
  {
    name: "OpenRouter Free",
    model: "meta-llama/llama-4-scout:free",
    baseUrl: "https://openrouter.ai/api/v1",
    rateLimit: "200 requests/day",
  },
];

async function discoverFreeEndpoints(): Promise<readonly FreeEndpoint[]> {
  const available: FreeEndpoint[] = [];
  if (process.env["CEREBRAS_API_KEY"]) {
    const e = FREE_ENDPOINTS.find((ep) => ep.name === "Cerebras");
    if (e) available.push(e);
  }
  if (process.env["GROQ_API_KEY"]) {
    const e = FREE_ENDPOINTS.find((ep) => ep.name === "Groq");
    if (e) available.push(e);
  }
  // Google Gemini now has its own provider — no longer in free endpoints
  if (process.env["OPENROUTER_API_KEY"]) {
    const e = FREE_ENDPOINTS.find((ep) => ep.name === "OpenRouter Free");
    if (e) available.push(e);
  }
  return available;
}

// ── Claude CLI Detection ───────────────────────────────────

/**
 * Check if the `claude` CLI is installed and authenticated.
 * Extracted as a named export so tests can mock it without mocking child_process.
 */
export function isClaudeCliAvailable(): boolean {
  // Allow tests to suppress CLI detection via env var
  if (process.env["WOTANN_SKIP_CLI_CHECK"] === "1") return false;

  try {
    execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ── Main Discovery ──────────────────────────────────────────

export interface DiscoveryOptions {
  /** Override Claude CLI detection (for testing). Defaults to actual check. */
  readonly checkClaudeCli?: () => boolean;
}

export async function discoverProviders(
  options?: DiscoveryOptions,
): Promise<readonly ProviderAuth[]> {
  const providers: ProviderAuth[] = [];

  // ANTHROPIC: Subscription via Claude CLI (per V9 T0.1 — WOTANN no
  // longer holds its own copy of the subscription token; detection is
  // purely "is `claude` on PATH and logged in").
  // Detected if:
  // 1. CLAUDE_CODE_OAUTH_TOKEN env var is set, OR
  // 2. The `claude` CLI is installed and authenticated.
  const oauthToken = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
  const checkCli = options?.checkClaudeCli ?? isClaudeCliAvailable;
  const claudeCliAvailable = checkCli();

  // Read both Anthropic auth sources up-front so both code paths can
  // pick the better token for live-model discovery (api-key works
  // against /v1/models, the OAuth subscription token does not).
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  if (oauthToken || claudeCliAvailable) {
    providers.push({
      provider: "anthropic",
      method: "oauth-token",
      token: oauthToken ?? "claude-cli-session",
      billing: "subscription",
      label: "Claude Subscription",
      priority: 1,
      transport: "anthropic",
      models: resolveModels("anthropic", anthropicKey, ANTHROPIC_MODELS),
    });
  }

  // ANTHROPIC: API key
  if (anthropicKey) {
    providers.push({
      provider: "anthropic",
      method: "api-key",
      token: anthropicKey,
      billing: "api-key",
      label: "Claude API",
      priority: oauthToken ? 2 : 1,
      transport: "anthropic",
      models: resolveModels("anthropic", oauthToken ?? anthropicKey, ANTHROPIC_MODELS),
    });
  }

  // OPENAI: API key
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (openaiKey) {
    providers.push({
      provider: "openai",
      method: "api-key",
      token: openaiKey,
      billing: "api-key",
      transport: "chat_completions",
      models: resolveModels("openai", openaiKey, ["gpt-5.4", "gpt-5.3-codex", "gpt-4.1"]),
    });
  }

  // CHATGPT CODEX: JWT from ~/.codex/auth.json or CODEX_API_KEY env var
  const codexKey = process.env["CODEX_API_KEY"];
  const codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  const codexAuthPath = process.env["CODEX_AUTH_JSON_PATH"] ?? join(codexHome, "auth.json");
  const codexAuth = codexKey ?? readCodexAuth(codexAuthPath);
  if (codexAuth) {
    // Codex multi-model gap fix: prior implementation hardcoded a
    // 2-of-6 subset of what a paid ChatGPT subscriber actually has
    // access to (`["codexplan", "codexspark"]` — both WOTANN-invented
    // aliases). The real model list lives at
    // `https://chatgpt.com/backend-api/codex/models` and is gated
    // server-side by plan tier (Plus/Pro/Business/Edu/Enterprise).
    //
    // We use the SYNC variant here because discoverProviders() is
    // sync — it reads the on-disk cache (refreshed on a 300 s TTL by
    // the codex-adapter at request time) and falls back to a bundled
    // 5-model list when no cache exists. The picker stays responsive
    // because the live fetch happens in the background.
    //
    // Legacy aliases (`codexspark`/`codexplan`/`codexmini`) are
    // preserved at the *adapter* layer (codex-adapter.ts:182-191)
    // so existing user scripts that say `--model codexspark` keep
    // working — they just resolve to the underlying real slug
    // (`gpt-5.3-codex`/`gpt-5.4`/`gpt-5.4-mini`).
    const payload = codexKey ? null : readCodexAuthPayload(codexAuthPath);
    const codexModelsResult = discoverCodexModelsSync(payload?.accountId);
    const realSlugs = codexModelsResult.models.map((m) => m.slug);
    // Keep the legacy aliases reachable so muscle-memory CLI flags
    // (`--model codexspark`) continue to resolve, but real slugs are
    // listed first so the picker shows them top-of-list.
    const fullModels: string[] = [...realSlugs];
    for (const alias of ["codexspark", "codexplan", "codexmini"]) {
      if (!fullModels.includes(alias)) fullModels.push(alias);
    }
    providers.push({
      provider: "codex",
      method: "codex-jwt",
      token: codexAuth,
      billing: "subscription",
      transport: "codex_responses",
      label: "ChatGPT Codex",
      models: fullModels,
    });
  }

  // GITHUB COPILOT: PAT (env vars) or saved token from `wotann login copilot`
  let ghToken =
    process.env["COPILOT_GITHUB_TOKEN"] ?? process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
  if (!ghToken) {
    // Check for saved token from wotann login
    const savedTokenPath = resolveWotannHomeSubdir("copilot-token.json");
    if (existsSync(savedTokenPath)) {
      try {
        const saved = JSON.parse(readFileSync(savedTokenPath, "utf-8")) as { token?: string };
        if (saved.token) ghToken = saved.token;
      } catch {
        /* ignore corrupt file */
      }
    }
  }
  if (ghToken) {
    providers.push({
      provider: "copilot",
      method: "github-pat",
      token: ghToken,
      billing: "subscription",
      subscription: "copilot-pro",
      transport: "chat_completions",
      // Dynamic model list — Copilot's adapter exposes /models via the
      // GitHub Copilot proxy, which is OpenAI-compat-shaped and works
      // through resolveModels. Static fallback covers GA models across
      // Free/Pro/Pro+ tiers when the cache is cold.
      models: resolveModels("copilot", ghToken, [
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-5",
        "gpt-5.4",
        "o4-mini",
        "o3",
        COPILOT_CLAUDE_SONNET,
        COPILOT_CLAUDE_OPUS,
        COPILOT_CLAUDE_HAIKU,
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "grok-code-fast-1",
      ]),
    });
  }

  // OLLAMA: Local (free)
  const ollamaUrl =
    process.env["OLLAMA_URL"] ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  const ollamaModels = await discoverOllamaModels(ollamaUrl);
  if (ollamaModels.length > 0) {
    providers.push({
      provider: "ollama",
      method: "local",
      token: ollamaUrl,
      billing: "free",
      label: "Ollama Local",
      transport: "chat_completions",
      models: ollamaModels,
    });
  } else if (
    process.env["WOTANN_AUTO_PULL_GEMMA"] !== "0" &&
    (await isOllamaReachable(ollamaUrl))
  ) {
    // S0-12: Ollama is running but has no models installed. Kick off a
    // background pull of the recommended default (sized to host RAM) so the
    // user's first query doesn't fail with "no models available". Opt out via
    // WOTANN_AUTO_PULL_GEMMA=0 when running in restricted environments.
    const pulled = await autoPullDefaultLocalModel(ollamaUrl);
    if (pulled.initiated) {
      providers.push({
        provider: "ollama",
        method: "local",
        token: ollamaUrl,
        billing: "free",
        label: `Ollama Local (pulling ${pulled.model}…)`,
        transport: "chat_completions",
        models: [pulled.model],
      });
    }
  }

  // GOOGLE GEMINI: AI Studio API (generous free tier: 1.5M tokens/day for Flash)
  const geminiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_AI_API_KEY"];
  if (geminiKey) {
    providers.push({
      provider: "gemini",
      method: "api-key",
      token: geminiKey,
      billing: "free",
      label: "Google Gemini",
      transport: "chat_completions",
      models: resolveModels("gemini", geminiKey, [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
      ]),
    });
  }

  // HUGGINGFACE INFERENCE: open-model access via the router API
  const huggingFaceKey =
    process.env["HF_TOKEN"] ??
    process.env["HUGGINGFACE_API_KEY"] ??
    process.env["HUGGING_FACE_HUB_TOKEN"];
  if (huggingFaceKey) {
    providers.push({
      provider: "huggingface",
      method: "api-key",
      token: huggingFaceKey,
      billing: "free",
      label: "HuggingFace Inference",
      transport: "chat_completions",
      models: resolveModels("huggingface", huggingFaceKey, [
        "meta-llama/Llama-3.3-70B-Instruct",
        "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "deepseek-ai/DeepSeek-R1",
      ]),
    });
  }

  // Provider consolidation note: free, azure, bedrock, vertex,
  // mistral, deepseek, perplexity, xai, together, fireworks,
  // sambanova, groq, cerebras dropped from the first-class set.
  // Users with raw API keys for those reach the underlying models
  // through OpenRouter (`<vendor>/<model>` slugs) — see the
  // OpenRouter block below.

  return providers;
}

// ── Status Formatting ───────────────────────────────────────

export function formatProviderStatus(
  providers: readonly ProviderAuth[],
): readonly ProviderStatus[] {
  return providers.map((p) => ({
    provider: p.provider,
    available: true,
    authMethod: p.method,
    billing: p.billing,
    models: p.models,
    label: p.label ?? p.provider,
  }));
}

// ALL_PROVIDERS = the eight first-class entries (mirrors the
// ProviderName union in src/core/types.ts). The picker, install
// detection, and `wotann doctor` enumerate this list.
const ALL_PROVIDERS: readonly ProviderName[] = [
  "anthropic",
  "openai",
  "codex",
  "copilot",
  "ollama",
  "gemini",
  "huggingface",
  "openrouter",
];

export function formatFullStatus(detected: readonly ProviderAuth[]): readonly ProviderStatus[] {
  const detectedNames = new Set(detected.map((p) => p.provider));

  const active = formatProviderStatus(detected);
  const inactive: ProviderStatus[] = ALL_PROVIDERS.filter((name) => !detectedNames.has(name)).map(
    (name) => ({
      provider: name,
      available: false,
      authMethod: "api-key" as const,
      billing: "api-key" as const,
      models: [],
      label: name,
      error: "Not configured",
    }),
  );

  return [...active, ...inactive];
}

// ── Variant Tag Preservation ───────────────────────────────────

/**
 * OpenRouter model IDs can have variant tags like `:free`, `:extended`, `:fast`.
 * When the model router switches models, these tags should be preserved so
 * users don't accidentally lose their variant preference.
 *
 * If originalModel has a variant tag (e.g., "claude-opus-4-6:free"),
 * and newModel doesn't have one, append the original's tag to newModel.
 * If newModel already has a tag, keep newModel's tag.
 */
export function preserveVariantTag(originalModel: string, newModel: string): string {
  const originalTag = extractVariantTag(originalModel);
  const newTag = extractVariantTag(newModel);

  // newModel already has its own tag — keep it
  if (newTag !== null) return newModel;

  // originalModel has a tag, newModel doesn't — transfer it
  if (originalTag !== null) return `${newModel}:${originalTag}`;

  // Neither has a tag — return as-is
  return newModel;
}

/**
 * Extract the variant tag from a model ID, if present.
 * Variant tags appear after the last colon that is NOT part of a version number.
 *
 * Examples:
 *   "claude-opus-4-6:free" → "free"
 *   "meta-llama/llama-4-scout:free" → "free"
 *   "gemini-2.5-pro:extended" → "extended"
 *   "claude-opus-4-6" → null (no tag)
 *   "gemma4:26b" → null (numeric variant, not a tag)
 */
function extractVariantTag(model: string): string | null {
  const colonIndex = model.lastIndexOf(":");
  if (colonIndex === -1 || colonIndex === model.length - 1) return null;

  const tag = model.slice(colonIndex + 1);

  // Skip purely numeric variants (e.g., "gemma4:26b" is a size, not a preference tag)
  if (/^\d+[bBmMkK]?$/.test(tag)) return null;

  // Known variant tags used by OpenRouter and other providers
  const KNOWN_TAGS = new Set([
    "free",
    "extended",
    "fast",
    "beta",
    "nitro",
    "preview",
    "thinking",
    "online",
    "latest",
    "turbo",
    "mini",
  ]);

  if (KNOWN_TAGS.has(tag.toLowerCase())) return tag;

  // Accept any non-numeric tag that looks like a variant
  if (/^[a-zA-Z][\w-]*$/.test(tag)) return tag;

  return null;
}
