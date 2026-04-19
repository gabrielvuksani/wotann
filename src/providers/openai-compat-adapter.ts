/**
 * OpenAI-compatible adapter. Handles OpenAI, Ollama, Copilot, free endpoints,
 * Azure, and any other provider using the /v1/chat/completions endpoint.
 */

import type { ProviderName, TransportType } from "../core/types.js";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";
import { anthropicToOpenAI } from "./format-translator.js";
import { getModelContextConfig } from "../context/limits.js";

interface OpenAICompatConfig {
  readonly provider: ProviderName;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly capabilities: ProviderCapabilities;
  readonly transport?: TransportType;
  readonly headers?: Record<string, string>;
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
      readonly role?: string;
      readonly tool_calls?: readonly ChatCompletionToolCallDelta[];
      readonly reasoning?: string;
      readonly reasoning_content?: string;
    };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

function mapOpenAIFinishReason(
  reason: string | null | undefined,
): "stop" | "tool_calls" | "max_tokens" | "content_filter" {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "content_filter";
    case "stop":
    default:
      return "stop";
  }
}

/**
 * Append `path` to `baseUrl` preserving any pre-existing query string or
 * hash. Crucial for Azure OpenAI, whose baseUrl ends with
 * `?api-version=YYYY-MM-DD`; a naive `${baseUrl}/chat/completions`
 * produces `.../deployments/gpt-4o?api-version=2024-12-01-preview/chat/completions`,
 * which 404s every call because the path gets baked INTO the query
 * string value. Using the URL API avoids that class of bug across all
 * providers.
 */
function appendPath(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const hashIdx = baseUrl.indexOf("#");
  const baseNoHash = hashIdx === -1 ? baseUrl : baseUrl.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : baseUrl.slice(hashIdx);
  const queryIdx = baseNoHash.indexOf("?");
  const basePath = queryIdx === -1 ? baseNoHash : baseNoHash.slice(0, queryIdx);
  const query = queryIdx === -1 ? "" : baseNoHash.slice(queryIdx);
  const trimmed = basePath.replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${normalized}${query}${hash}`;
}

export function createOpenAICompatAdapter(config: OpenAICompatConfig): ProviderAdapter {
  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const model = options.model ?? config.defaultModel;
    const url = appendPath(config.baseUrl, "/chat/completions");
    const authToken = options.authToken ?? config.apiKey;
    const messages: Array<Record<string, unknown>> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

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

    // S1-4: OpenAI-compatible tool schema — { type: "function", function: {...} }
    const openAITools =
      options.tools && options.tools.length > 0
        ? options.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.inputSchema as Record<string, unknown>,
            },
          }))
        : undefined;

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      stream: true,
      // S1-26: Ask the server to include token usage in the final stream chunk.
      // Without this, OpenAI-compat and Copilot always report tokensUsed=0.
      stream_options: { include_usage: true },
      ...(openAITools ? { tools: openAITools, tool_choice: "auto" } : {}),
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          ...config.headers,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: "error",
          content: `${config.provider} API error (${response.status}): ${errorText}`,
          model,
          provider: config.provider,
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: "error", content: "No response body", model, provider: config.provider };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalTokens = 0;
      let stopReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" = "stop";

      // S1-22: accumulate tool-call fragments across chunks keyed by index.
      // OpenAI/compat streams tool_calls as a sparse array where each chunk
      // carries partial fields — name on one chunk, arguments JSON spread
      // across many. We reassemble before emitting a structured tool_use.
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
            if (content) {
              yield {
                type: "text",
                content,
                model,
                provider: config.provider,
              };
            }

            // Reasoning / thinking content — some OpenAI-compat providers
            // (DeepSeek, Gemini 3 via compat) surface CoT under `reasoning`
            // or `reasoning_content`. Forward as thinking chunks.
            const thinking = delta?.reasoning ?? delta?.reasoning_content;
            if (thinking) {
              yield {
                type: "thinking",
                content: thinking,
                model,
                provider: config.provider,
              };
            }

            // Tool call fragments
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
            if (finish) {
              stopReason = mapOpenAIFinishReason(finish);
            }

            if (chunk.usage?.total_tokens) {
              totalTokens = chunk.usage.total_tokens;
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }

      // Emit accumulated tool calls after the stream completes.
      for (const [, state] of toolCallState) {
        if (state.emitted) continue;
        if (!state.name) continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = state.args ? (JSON.parse(state.args) as Record<string, unknown>) : {};
        } catch {
          yield {
            type: "error",
            content: `${config.provider}: malformed tool arguments for ${state.name}`,
            model,
            provider: config.provider,
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
          provider: config.provider,
          stopReason: "tool_calls",
        };
        state.emitted = true;
        stopReason = "tool_calls";
      }

      yield {
        type: "done",
        content: "",
        model,
        provider: config.provider,
        tokensUsed: totalTokens,
        stopReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield {
        type: "error",
        content: `${config.provider} error: ${message}`,
        model,
        provider: config.provider,
      };
    }
  }

  async function listModels(): Promise<readonly string[]> {
    return config.models;
  }

  async function isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(appendPath(config.baseUrl, "/models"), {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...config.headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    id: config.provider,
    name: config.provider,
    transport: config.transport ?? "chat_completions",
    capabilities: config.capabilities,
    query,
    listModels,
    isAvailable,
  };
}

// ── Factory Functions for Specific Providers ────────────────

export function createOpenAIAdapter(apiKey: string): ProviderAdapter {
  const defaultConfig = getModelContextConfig("gpt-5.4", "openai");
  return createOpenAICompatAdapter({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    defaultModel: "gpt-4.1",
    models: ["gpt-5.4", "gpt-5.3-codex", "gpt-4.1"],
    capabilities: {
      supportsComputerUse: false,
      supportsToolCalling: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsThinking: true,
      maxContextWindow: defaultConfig.maxContextTokens,
    },
  });
}

// NOTE: Ollama and Copilot have dedicated adapters in ollama-adapter.ts and
// copilot-adapter.ts respectively. Ollama uses the native /api/chat endpoint
// (not OpenAI compat) for better tool calling support. Copilot requires a
// GitHub PAT → Copilot token exchange that the generic adapter can't handle.
