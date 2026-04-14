/**
 * GitHub Copilot provider adapter with runtime token exchange.
 *
 * Copilot auth flow:
 * 1. User has GH_TOKEN / GITHUB_TOKEN with Copilot permission
 * 2. Exchange GH token for a short-lived Copilot API token (~30min)
 * 3. Use the Copilot token against dynamic endpoint from exchange response
 *
 * Copilot subscription tiers (as of 2026):
 * - Free:  GPT-4.1-mini, Claude 3.5 Haiku (2K completions/mo)
 * - Pro ($10/mo): GPT-4.1, Claude Sonnet 4, Gemini 2.5 Pro, o4-mini
 * - Pro+ ($39/mo): GPT-5, Claude Opus 4, o3, unlimited premium requests
 *
 * Dynamic model listing: GET /models from the Copilot API returns the actual
 * model catalog for the user's subscription tier.
 */

import type { ProviderAdapter, UnifiedQueryOptions, StreamChunk, ProviderCapabilities } from "./types.js";

interface CopilotTokenResponse {
  readonly token: string;
  readonly expires_at: number;
  readonly endpoints?: {
    readonly api?: string;
    readonly "proxy-ep"?: string;
  };
}

interface CopilotModel {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly capabilities?: {
    readonly type?: string;
    readonly family?: string;
  };
}

interface CopilotModelsResponse {
  readonly data?: readonly CopilotModel[];
  readonly models?: readonly CopilotModel[];
}

interface ChatCompletionChunk {
  readonly choices?: readonly {
    readonly delta?: { readonly content?: string };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: { readonly total_tokens?: number };
}

interface CachedCopilotAuth {
  token: string;
  expiresAt: number;
  baseUrl: string;
}

let cachedCopilotToken: CachedCopilotAuth | null = null;
let cachedModelList: readonly string[] | null = null;
let modelListFetchedAt = 0;

/**
 * Exchange a GitHub PAT/OAuth token for a short-lived Copilot API token.
 *
 * Tries multiple known endpoints in order:
 * 1. /copilot_internal/v2/token — used by VS Code Copilot extension
 * 2. github.com/github-copilot/chat/token — used by Copilot Chat
 *
 * The response includes an `endpoints` field with the actual API base URL
 * to use (it may be a regional proxy). We cache this for reuse.
 */
async function getCopilotToken(ghToken: string): Promise<CachedCopilotAuth | null> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedCopilotToken && cachedCopilotToken.expiresAt > Date.now() / 1000 + 60) {
    return cachedCopilotToken;
  }

  // Try each known token endpoint
  const endpoints = [
    "https://api.github.com/copilot_internal/v2/token",
    "https://github.com/github-copilot/chat/token",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${ghToken}`,
          "Accept": "application/json",
          "User-Agent": "wotann-cli/0.1.0",
          "Editor-Version": "WOTANN/0.1.0",
        },
      });

      if (!response.ok) continue;

      const data = (await response.json()) as CopilotTokenResponse;
      if (data.token) {
        // Use the dynamic endpoint from the token exchange response.
        // The proxy-ep endpoint is typically the preferred one (handles routing).
        const proxyEp = data.endpoints?.["proxy-ep"] ?? data.endpoints?.api;
        const baseUrl = proxyEp
          ? proxyEp.replace(/\/$/, "")
          : "https://api.githubcopilot.com";

        cachedCopilotToken = {
          token: data.token,
          expiresAt: data.expires_at,
          baseUrl,
        };
        return cachedCopilotToken;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Fetch the actual model catalog from the Copilot API.
 * This reflects the user's subscription tier — Pro+ gets more models.
 * Caches for 10 minutes to avoid excessive API calls.
 */
async function fetchCopilotModels(auth: CachedCopilotAuth): Promise<readonly string[]> {
  // Return cached list if recent enough (10 min)
  if (cachedModelList && Date.now() - modelListFetchedAt < 600_000) {
    return cachedModelList;
  }

  try {
    const response = await fetch(`${auth.baseUrl}/models`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${auth.token}`,
        "Accept": "application/json",
        "User-Agent": "wotann-cli/0.1.0",
        "Copilot-Integration-Id": "wotann-cli",
      },
    });

    if (!response.ok) {
      return FALLBACK_MODELS;
    }

    const data = (await response.json()) as CopilotModelsResponse;
    const models = (data.data ?? data.models ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (models.length > 0) {
      cachedModelList = models;
      modelListFetchedAt = Date.now();
      return models;
    }
  } catch {
    // Fall through to static list
  }

  return FALLBACK_MODELS;
}

/**
 * Static fallback model list — used when the /models endpoint is unavailable.
 * Sourced from GitHub Copilot docs (2026-04):
 * https://docs.github.com/en/copilot/reference/ai-models/supported-models
 *
 * GA models across all Copilot tiers:
 * - Free: GPT-4.1, GPT-5 mini, Claude Haiku 4.5, Claude Sonnet 4.6, Grok Code Fast 1
 * - Pro ($10/mo): + Claude Sonnet 4/4.5, Claude Opus 4.5/4.6, Gemini 2.5 Pro, GPT-5.x
 * - Pro+ ($39/mo): All models + unlimited premium requests
 *
 * Premium request multipliers: Claude Opus = 3x, most others = 1x,
 * Claude Haiku/Grok = 0.25-0.33x (cheaper), GPT-4.1/GPT-5-mini = 0x (included)
 */
const FALLBACK_MODELS: readonly string[] = [
  // OpenAI models (via Copilot)
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "o4-mini",
  "o3",
  "o3-mini",
  // Anthropic models (via Copilot)
  "claude-sonnet-4",
  "claude-sonnet-4.5",
  "claude-sonnet-4.6",
  "claude-opus-4.5",
  "claude-opus-4.6",
  "claude-haiku-4.5",
  // Google models (via Copilot)
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3-flash",
  "gemini-3.1-pro",
  // xAI models (via Copilot)
  "grok-code-fast-1",
];

export function createCopilotAdapter(ghToken: string): ProviderAdapter {
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true, // GPT-4.1 and Claude Sonnet support vision via Copilot
    supportsStreaming: true,
    supportsThinking: false,
    maxContextWindow: 128_000,
  };

  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const auth = await getCopilotToken(ghToken);
    if (!auth) {
      yield {
        type: "error",
        content: "GitHub Copilot token exchange failed. Ensure GH_TOKEN has Copilot access.\n" +
          "Check: https://github.com/settings/copilot\n" +
          "Fix: export GH_TOKEN=$(gh auth token)",
        provider: "copilot",
      };
      return;
    }

    const model = options.model ?? "gpt-4.1";
    const url = `${auth.baseUrl}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    if (options.messages) {
      for (const msg of options.messages) messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: "user", content: options.prompt });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${auth.token}`,
          "X-GitHub-Api-Version": "2025-04-01",
          "Copilot-Integration-Id": "wotann-cli",
          "Editor-Version": "WOTANN/0.1.0",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options.maxTokens ?? 4096,
          temperature: options.temperature ?? 0.7,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // If 401, the token may have expired — clear cache and suggest retry
        if (response.status === 401) {
          cachedCopilotToken = null;
          yield {
            type: "error",
            content: "Copilot token expired. Retrying with fresh token...",
            model,
            provider: "copilot",
          };
          return;
        }

        yield { type: "error", content: `Copilot error (${response.status}): ${errorText.slice(0, 300)}`, model, provider: "copilot" };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) { yield { type: "error", content: "No response body", model, provider: "copilot" }; return; }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data) as ChatCompletionChunk;
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) yield { type: "text", content, model, provider: "copilot" };
            if (chunk.usage?.total_tokens) totalTokens = chunk.usage.total_tokens;
          } catch { /* skip malformed */ }
        }
      }

      yield { type: "done", content: "", model, provider: "copilot", tokensUsed: totalTokens };
    } catch (error) {
      yield { type: "error", content: `Copilot error: ${error instanceof Error ? error.message : "unknown"}`, model, provider: "copilot" };
    }
  }

  async function listModels(): Promise<readonly string[]> {
    const auth = await getCopilotToken(ghToken);
    if (!auth) return FALLBACK_MODELS;
    return fetchCopilotModels(auth);
  }

  async function isAvailable(): Promise<boolean> {
    const auth = await getCopilotToken(ghToken);
    return auth !== null;
  }

  return { id: "copilot", name: "copilot", transport: "chat_completions", capabilities, query, listModels, isAvailable };
}
