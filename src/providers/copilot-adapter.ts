/**
 * GitHub Copilot provider adapter with runtime token exchange.
 *
 * ⚠ EXPERIMENTAL — UNOFFICIAL GITHUB COPILOT USAGE ⚠
 *
 * This adapter exchanges a user-supplied `GH_TOKEN` against
 * `/copilot_internal/v2/token` to obtain a short-lived Copilot API
 * session token, then hits `api.githubcopilot.com` with it. GitHub
 * Community Discussion #178117 (and adjacent threads) indicate this
 * access pattern — non-Microsoft IDE clients driving Copilot via that
 * endpoint — is not the intended integration path and is TOS-violating
 * for third-party clients. Not banned as of V9 T0.3 drafting, but
 * clearly unofficial and subject to change.
 *
 * Plan: migrate to `@github/copilot-sdk` when GitHub GAs an official
 * third-party SDK. Track progress via `/monitor-repos` against
 * `github/copilot-sdk`.
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

/**
 * First-use flag for the experimental banner — printed once per process
 * so CLIs and long-running daemons don't spam the warning on every
 * request. QB #7 per-session state: resets per Node process; no
 * persistent storage.
 */
let _copilotExperimentalBannerShown = false;

function warnCopilotExperimentalOnce(): void {
  if (_copilotExperimentalBannerShown) return;
  _copilotExperimentalBannerShown = true;
  console.warn(
    "[copilot] experimental — unofficial third-party usage of GitHub Copilot via /copilot_internal/v2/token. Migrate to @github/copilot-sdk when GA.",
  );
}

import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";
import { anthropicToOpenAI } from "./format-translator.js";
import { toCopilotTools } from "./tool-serializer.js";

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

interface ChatCompletionToolCallDelta {
  readonly index?: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

interface ChatCompletionChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string;
      readonly tool_calls?: readonly ChatCompletionToolCallDelta[];
      /**
       * Reasoning deltas. Copilot proxies models that emit CoT
       * (o3 / o4-mini / gpt-5.x / Claude Opus / Gemini 2.5 Pro) —
       * depending on the upstream vendor the field name is either
       * `reasoning` or `reasoning_content`. Forwarded as `thinking`
       * chunks so the rest of the harness (reasoning-sandwich,
       * capability-augmenter, UI) treats them identically to
       * Anthropic's `thinking_delta`.
       */
      readonly reasoning?: string;
      readonly reasoning_content?: string;
    };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly total_tokens?: number;
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

interface CachedCopilotAuth {
  token: string;
  expiresAt: number;
  baseUrl: string;
}

interface CopilotCache {
  token: CachedCopilotAuth | null;
  models: readonly string[] | null;
  modelsFetchedAt: number;
}

function createCopilotCache(): CopilotCache {
  return { token: null, models: null, modelsFetchedAt: 0 };
}

/**
 * Exchange a GitHub PAT/OAuth token for a short-lived Copilot API token.
 *
 * Tries multiple known endpoints in order:
 * 1. /copilot_internal/v2/token — used by VS Code Copilot extension
 * 2. github.com/github-copilot/chat/token — used by Copilot Chat
 *
 * The response includes an `endpoints` field with the actual API base URL
 * to use (it may be a regional proxy). We cache this for reuse.
 *
 * `cache` is per-adapter-instance so multiple GitHub identities (test
 * fixtures, multi-tenant daemons, concurrent sessions) never share token
 * state.
 */
async function getCopilotToken(
  ghToken: string,
  cache: CopilotCache,
  opts: { forceRefresh?: boolean } = {},
): Promise<CachedCopilotAuth | null> {
  if (!opts.forceRefresh && cache.token && cache.token.expiresAt > Date.now() / 1000 + 60) {
    return cache.token;
  }
  if (opts.forceRefresh) cache.token = null;

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
          Authorization: `Bearer ${ghToken}`,
          Accept: "application/json",
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
        const baseUrl = proxyEp ? proxyEp.replace(/\/$/, "") : "https://api.githubcopilot.com";

        cache.token = {
          token: data.token,
          expiresAt: data.expires_at,
          baseUrl,
        };
        return cache.token;
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
 * Caches for 10 minutes in a per-adapter `cache` object.
 */
async function fetchCopilotModels(
  auth: CachedCopilotAuth,
  cache: CopilotCache,
): Promise<readonly string[]> {
  if (cache.models && Date.now() - cache.modelsFetchedAt < 600_000) {
    return cache.models;
  }

  try {
    const response = await fetch(`${auth.baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/json",
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
      cache.models = models;
      cache.modelsFetchedAt = Date.now();
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
  warnCopilotExperimentalOnce();
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true, // GPT-4.1 and Claude Sonnet support vision via Copilot
    supportsStreaming: true,
    supportsThinking: false,
    maxContextWindow: 128_000,
  };

  // Per-adapter cache. Holds the exchanged Copilot token + fetched model
  // catalog. Scoped to this adapter instance (not module-global) so tests,
  // multi-tenant daemons, or concurrent sessions with different GitHub
  // identities never observe each other's bearer tokens.
  const cache: CopilotCache = createCopilotCache();

  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const auth = await getCopilotToken(ghToken, cache);
    if (!auth) {
      yield {
        type: "error",
        content:
          "GitHub Copilot token exchange failed. Ensure GH_TOKEN has Copilot access.\n" +
          "Check: https://github.com/settings/copilot\n" +
          "Fix: export GH_TOKEN=$(gh auth token)",
        provider: "copilot",
      };
      return;
    }

    const model = options.model ?? "gpt-4.1";
    const url = `${auth.baseUrl}/chat/completions`;

    // OpenAI Chat-Completions-compatible messages array. Previously this
    // adapter flattened every message to `{role, content: string}` which
    // broke multi-turn tool loops — OpenAI's schema requires
    // `tool_call_id` + `name` on tool results and `tool_calls` on
    // assistant turns. The Opus audit found that any conversation with a
    // prior tool call would desync on the next turn. Now we route through
    // the same anthropicToOpenAI translator the openai-compat adapter
    // uses, preserving tool-call metadata across turns.
    const messages: Array<Record<string, unknown>> = [];
    if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    if (options.messages) {
      const translated = anthropicToOpenAI(
        options.messages
          .filter((msg) => msg.role !== "system")
          .map((msg) =>
            msg.role === "tool"
              ? {
                  role: "user" as const,
                  content: [
                    {
                      type: "tool_result" as const,
                      tool_use_id: msg.toolCallId,
                      content: msg.content,
                    },
                  ],
                }
              : {
                  role: msg.role === "assistant" ? ("assistant" as const) : ("user" as const),
                  content: msg.content,
                },
          ),
      );
      for (const msg of translated) {
        messages.push({
          role: msg.role,
          content: msg.content,
          tool_calls: msg.tool_calls,
          tool_call_id: msg.tool_call_id,
          name: msg.name,
        });
      }
    }
    messages.push({ role: "user", content: options.prompt });

    // S1-5 + P0-4: Copilot uses the OpenAI Chat Completions wire format, so
    // it routes through the shared tool-serializer's `toCopilotTools` (an
    // alias for `toOpenAITools`). Schema preserved verbatim; `$ref` rejected
    // up front. Also S1-26: ask for usage on final chunk.
    const copilotTools =
      options.tools && options.tools.length > 0 ? toCopilotTools(options.tools) : undefined;

    const body = JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
      ...(copilotTools ? { tools: copilotTools, tool_choice: "auto" } : {}),
    });
    const buildHeaders = (bearer: string): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
      "X-GitHub-Api-Version": "2025-04-01",
      "Copilot-Integration-Id": "wotann-cli",
      "Editor-Version": "WOTANN/0.1.0",
    });

    try {
      let currentAuth = auth;
      let response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(currentAuth.token),
        body,
      });

      // Transparent single retry on 401: refresh the Copilot token (the
      // cached one likely expired in-flight or GitHub rotated it) and
      // re-send. Previous behavior was to yield a "Retrying…" message and
      // return without actually retrying — a false-honest stub.
      if (response.status === 401) {
        const refreshed = await getCopilotToken(ghToken, cache, { forceRefresh: true });
        if (refreshed) {
          currentAuth = refreshed;
          response = await fetch(url, {
            method: "POST",
            headers: buildHeaders(currentAuth.token),
            body,
          });
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        const hint =
          response.status === 401
            ? " (token refresh also failed — check GH_TOKEN has active Copilot entitlement)"
            : "";
        yield {
          type: "error",
          content: `Copilot error (${response.status}): ${errorText.slice(0, 300)}${hint}`,
          model,
          provider: "copilot",
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: "error", content: "No response body", model, provider: "copilot" };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let stopReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" = "stop";

      // S1-24: accumulate tool-call fragments (same pattern as OpenAI-compat).
      const toolCallState = new Map<
        number,
        { id: string; name: string; args: string; emitted: boolean }
      >();

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
            const delta = chunk.choices?.[0]?.delta;
            const content = delta?.content;
            if (content) yield { type: "text", content, model, provider: "copilot" };

            // Reasoning / thinking — Copilot proxies models that emit CoT
            // under either `reasoning` or `reasoning_content`. Forward them
            // as `thinking` chunks so the rest of the harness handles them
            // uniformly across providers.
            const thinking = delta?.reasoning ?? delta?.reasoning_content;
            if (thinking) {
              yield { type: "thinking", content: thinking, model, provider: "copilot" };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const existing = toolCallState.get(idx) ?? {
                  id: "",
                  name: "",
                  args: "",
                  emitted: false,
                };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
                toolCallState.set(idx, existing);
              }
            }

            const finish = chunk.choices?.[0]?.finish_reason;
            if (finish === "tool_calls" || finish === "function_call") stopReason = "tool_calls";
            else if (finish === "length") stopReason = "max_tokens";
            else if (finish === "content_filter") stopReason = "content_filter";
            else if (finish === "stop") stopReason = "stop";

            if (chunk.usage?.total_tokens) totalTokens = chunk.usage.total_tokens;
            if (chunk.usage?.prompt_tokens && chunk.usage.prompt_tokens > 0) {
              promptTokens = chunk.usage.prompt_tokens;
            }
            if (chunk.usage?.completion_tokens && chunk.usage.completion_tokens > 0) {
              completionTokens = chunk.usage.completion_tokens;
            }
          } catch {
            /* skip malformed */
          }
        }
      }

      // Emit any accumulated tool calls.
      for (const [, state] of toolCallState) {
        if (state.emitted || !state.name) continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = state.args ? (JSON.parse(state.args) as Record<string, unknown>) : {};
        } catch {
          yield {
            type: "error",
            content: `Copilot: malformed tool arguments for ${state.name}`,
            model,
            provider: "copilot",
          };
          state.emitted = true;
          continue;
        }
        yield {
          type: "tool_use",
          content: state.args,
          toolName: state.name,
          toolCallId: state.id,
          toolInput: parsedArgs,
          model,
          provider: "copilot",
          stopReason: "tool_calls",
        };
        state.emitted = true;
        stopReason = "tool_calls";
      }

      // Wave 4G: surface split usage for honest cost attribution.
      const finalInput = promptTokens > 0 ? promptTokens : Math.floor(totalTokens / 2);
      const finalOutput =
        completionTokens > 0 ? completionTokens : Math.max(0, totalTokens - finalInput);
      yield {
        type: "done",
        content: "",
        model,
        provider: "copilot",
        tokensUsed: totalTokens,
        usage: {
          inputTokens: finalInput,
          outputTokens: finalOutput,
        },
        stopReason,
      };
    } catch (error) {
      yield {
        type: "error",
        content: `Copilot error: ${error instanceof Error ? error.message : "unknown"}`,
        model,
        provider: "copilot",
      };
    }
  }

  async function listModels(): Promise<readonly string[]> {
    const auth = await getCopilotToken(ghToken, cache);
    if (!auth) return FALLBACK_MODELS;
    return fetchCopilotModels(auth, cache);
  }

  async function isAvailable(): Promise<boolean> {
    const auth = await getCopilotToken(ghToken, cache);
    return auth !== null;
  }

  return {
    id: "copilot",
    name: "copilot",
    transport: "chat_completions",
    capabilities,
    query,
    listModels,
    isAvailable,
  };
}
