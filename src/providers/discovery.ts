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
import type { ProviderAuth, ProviderName, ProviderStatus } from "../core/types.js";

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

  if (oauthToken || claudeCliAvailable) {
    providers.push({
      provider: "anthropic",
      method: "oauth-token",
      token: oauthToken ?? "claude-cli-session",
      billing: "subscription",
      label: "Claude Subscription",
      priority: 1,
      transport: "anthropic",
      models: ANTHROPIC_MODELS,
    });
  }

  // ANTHROPIC: API key
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  if (anthropicKey) {
    providers.push({
      provider: "anthropic",
      method: "api-key",
      token: anthropicKey,
      billing: "api-key",
      label: "Claude API",
      priority: oauthToken ? 2 : 1,
      transport: "anthropic",
      models: ANTHROPIC_MODELS,
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
      models: ["gpt-5.4", "gpt-5.3-codex", "gpt-4.1"],
    });
  }

  // CHATGPT CODEX: JWT from ~/.codex/auth.json or CODEX_API_KEY env var
  const codexKey = process.env["CODEX_API_KEY"];
  const codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  const codexAuthPath = process.env["CODEX_AUTH_JSON_PATH"] ?? join(codexHome, "auth.json");
  const codexAuth = codexKey ?? readCodexAuth(codexAuthPath);
  if (codexAuth) {
    providers.push({
      provider: "codex",
      method: "codex-jwt",
      token: codexAuth,
      billing: "subscription",
      transport: "codex_responses",
      label: "ChatGPT Codex",
      models: ["codexplan", "codexspark"],
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
      // Dynamic model list — the adapter fetches actual models from the API at runtime.
      // This static list covers GA models across Copilot Free/Pro/Pro+ tiers.
      // V14.3: dropped bare "claude-sonnet-4" (retires June 15, 2026); bumped 4.6 → 4.7.
      models: [
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
      ],
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
      models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
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
      models: [
        "meta-llama/Llama-3.3-70B-Instruct",
        "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "deepseek-ai/DeepSeek-R1",
      ],
    });
  }

  // FREE ENDPOINTS: Community APIs
  const freeEndpoints = await discoverFreeEndpoints();
  if (freeEndpoints.length > 0) {
    providers.push({
      provider: "free",
      method: "api-key",
      token: "",
      billing: "free",
      label: "Free Endpoints",
      transport: "chat_completions",
      models: freeEndpoints.map((e) => e.model),
    });
  }

  // AZURE OPENAI
  const azureKey = process.env["AZURE_OPENAI_API_KEY"];
  const azureEndpoint = process.env["AZURE_OPENAI_ENDPOINT"];
  if (azureKey && azureEndpoint) {
    providers.push({
      provider: "azure",
      method: "api-key",
      token: azureKey,
      billing: "api-key",
      label: "Azure OpenAI",
      transport: "chat_completions",
      models: ["gpt-4o", "gpt-4-turbo"],
    });
  }

  // AWS BEDROCK
  const bedrockRegion = process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"];
  const bedrockAccess = process.env["AWS_ACCESS_KEY_ID"];
  if (bedrockRegion && bedrockAccess) {
    providers.push({
      provider: "bedrock",
      method: "aws-iam",
      token: bedrockAccess,
      billing: "api-key",
      label: "AWS Bedrock",
      transport: "chat_completions",
      models: [BEDROCK_SONNET, BEDROCK_HAIKU],
    });
  }

  // GOOGLE VERTEX AI
  const vertexProject = process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCLOUD_PROJECT"];
  const vertexCreds = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (vertexProject && vertexCreds) {
    providers.push({
      provider: "vertex",
      method: "gcp-sa",
      token: vertexCreds,
      billing: "api-key",
      label: "Google Vertex AI",
      transport: "chat_completions",
      models: [VERTEX_SONNET, "gemini-2.5-pro"],
    });
  }

  // MISTRAL
  const mistralKey = process.env["MISTRAL_API_KEY"];
  if (mistralKey) {
    providers.push({
      provider: "mistral",
      method: "api-key",
      token: mistralKey,
      billing: "api-key",
      label: "Mistral AI",
      transport: "chat_completions",
      models: ["mistral-large-latest", "mistral-medium", "codestral-latest"],
    });
  }

  // DEEPSEEK
  const deepseekKey = process.env["DEEPSEEK_API_KEY"];
  if (deepseekKey) {
    providers.push({
      provider: "deepseek",
      method: "api-key",
      token: deepseekKey,
      billing: "api-key",
      label: "DeepSeek",
      transport: "chat_completions",
      models: ["deepseek-chat", "deepseek-reasoner"],
    });
  }

  // PERPLEXITY
  const perplexityKey = process.env["PERPLEXITY_API_KEY"];
  if (perplexityKey) {
    providers.push({
      provider: "perplexity",
      method: "api-key",
      token: perplexityKey,
      billing: "api-key",
      label: "Perplexity",
      transport: "chat_completions",
      models: ["sonar", "sonar-pro", "sonar-reasoning-pro"],
    });
  }

  // XAI / GROK
  const xaiKey = process.env["XAI_API_KEY"];
  if (xaiKey) {
    providers.push({
      provider: "xai",
      method: "api-key",
      token: xaiKey,
      billing: "api-key",
      label: "xAI Grok",
      transport: "chat_completions",
      models: ["grok-2", "grok-3", "grok-3-mini"],
    });
  }

  // TOGETHER.AI
  const togetherKey = process.env["TOGETHER_API_KEY"];
  if (togetherKey) {
    providers.push({
      provider: "together",
      method: "api-key",
      token: togetherKey,
      billing: "api-key",
      label: "Together AI",
      transport: "chat_completions",
      models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-Coder-32B-Instruct"],
    });
  }

  // FIREWORKS.AI
  const fireworksKey = process.env["FIREWORKS_API_KEY"];
  if (fireworksKey) {
    providers.push({
      provider: "fireworks",
      method: "api-key",
      token: fireworksKey,
      billing: "api-key",
      label: "Fireworks AI",
      transport: "chat_completions",
      models: [
        "accounts/fireworks/models/llama-v3p3-70b-instruct",
        "accounts/fireworks/models/qwen2p5-coder-32b-instruct",
      ],
    });
  }

  // SAMBANOVA
  const sambanovaKey = process.env["SAMBANOVA_API_KEY"];
  if (sambanovaKey) {
    providers.push({
      provider: "sambanova",
      method: "api-key",
      token: sambanovaKey,
      billing: "api-key",
      label: "SambaNova",
      transport: "chat_completions",
      models: ["Meta-Llama-3.3-70B-Instruct", "Qwen2.5-Coder-32B-Instruct"],
    });
  }

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

// Gap-7 fix: prior list was missing groq + openrouter, so `wotann doctor`
// showed "no providers available" entries for active env vars and never
// listed Groq/OpenRouter as inactive options when the user had no key.
// Now mirrors src/core/types.ts ProviderName union (minus the synthetic
// "free" pseudo-provider which is rolled into the explicit groq entry).
const ALL_PROVIDERS: readonly ProviderName[] = [
  "anthropic",
  "openai",
  "codex",
  "copilot",
  "ollama",
  "gemini",
  "huggingface",
  "free",
  "azure",
  "bedrock",
  "vertex",
  "mistral",
  "deepseek",
  "perplexity",
  "xai",
  "together",
  "fireworks",
  "sambanova",
  "groq",
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
