/**
 * Native Ollama adapter using /api/chat with tool calling support.
 * Uses Ollama's native endpoint, NOT the OpenAI-compatible shim.
 *
 * Ollama CLI reference:
 *   ollama pull qwen3.5:27b    — download model
 *   ollama list                 — show downloaded models
 *   ollama ps                   — show running models (VRAM usage)
 *   ollama serve                — start daemon (localhost:11434)
 *
 * Best models for coding agents (ranked by agent task scores):
 *   qwen3-coder-next  — 80B MoE (3B active), #1 SWE-rebench, ~18GB VRAM
 *   qwen3-coder:30b   — 96/100 agent score, ~20GB VRAM
 *   devstral:24b      — 94/100 agent score, ~16GB VRAM
 *   qwen3.5:27b       — multimodal, 256K context, ~20GB VRAM
 *   qwen3.5:35b-a3b   — MoE variant, ~16GB VRAM
 *   qwen3-coder:7b    — entry level, ~5GB VRAM
 *   qwen3.5:9b        — entry level, ~8GB VRAM
 *
 * Tool calling: natively supported via /api/chat with `tools` parameter.
 * Best tool-calling models: Llama 3.1, Qwen3 series, hermes-2-pro, mistral:7b.
 */

import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";

interface OllamaModel {
  readonly name: string;
  readonly size: number;
  readonly modified_at: string;
  readonly details?: {
    readonly parameter_size?: string;
    readonly quantization_level?: string;
    readonly family?: string;
  };
}

interface OllamaListResponse {
  readonly models: readonly OllamaModel[];
}

interface OllamaChatChunk {
  readonly message?: {
    readonly role: string;
    readonly content: string;
    readonly tool_calls?: readonly {
      readonly function: {
        readonly name: string;
        readonly arguments: Record<string, unknown>;
      };
    }[];
  };
  readonly done: boolean;
  readonly total_duration?: number;
  readonly eval_count?: number;
  readonly prompt_eval_count?: number;
  /**
   * Ollama 0.5+ reports an explicit reason for termination on the
   * terminal chunk:
   *   "stop"  → natural completion
   *   "length" → hit the output-token ceiling (map to canonical `max_tokens`)
   *   "load"  → model was unloaded mid-turn (rare; treat as `stop`)
   * Older Ollama (≤0.4) omits this field and the adapter falls back
   * to "stop" canonically when no tool_calls fired.
   */
  readonly done_reason?: string;
}

/**
 * Translate Ollama's `done_reason` into the runtime's canonical
 * StopReason vocabulary. Kept small and explicit — unknown values
 * drop to "stop" so a new Ollama version emitting an unfamiliar
 * token doesn't crash the agent loop.
 */
function mapOllamaDoneReason(reason: string | undefined): "stop" | "max_tokens" | "content_filter" {
  switch (reason) {
    case "length":
      return "max_tokens";
    case "content_filter":
      return "content_filter";
    case "stop":
    case "load":
    default:
      return "stop";
  }
}

/**
 * Discover models installed locally via Ollama.
 */
export async function discoverOllamaModels(
  baseUrl: string = "http://localhost:11434",
): Promise<readonly OllamaModel[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = (await response.json()) as OllamaListResponse;
    return data.models;
  } catch {
    return [];
  }
}

/**
 * Get actual context window size for a specific Ollama model via POST /api/show.
 * Falls back to the default (256K) if the model info isn't available.
 * (Pattern from OpenClaw's Ollama provider.)
 */
export async function getOllamaModelContextWindow(
  model: string,
  baseUrl: string = "http://localhost:11434",
): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return 256_000;

    const data = (await response.json()) as Record<string, unknown>;
    const modelInfo = data["model_info"] as Record<string, unknown> | undefined;

    // Search for context_length in model_info (key varies by model architecture)
    if (modelInfo) {
      for (const value of Object.values(modelInfo)) {
        if (typeof value === "object" && value !== null && "context_length" in value) {
          return (value as { context_length: number }).context_length;
        }
      }
    }

    return 256_000;
  } catch {
    return 256_000;
  }
}

/**
 * Map installed Ollama models to routing tiers.
 */
export function mapOllamaModels(models: readonly OllamaModel[]): {
  coding: string | null;
  reasoning: string | null;
  efficient: string | null;
  general: string | null;
  fallback: string | null;
} {
  const names = models.map((m) => m.name);

  return {
    coding:
      names.find(
        (n) => n.includes("qwen3-coder") || n.includes("devstral") || n.includes("coder"),
      ) ?? null,
    reasoning: names.find((n) => n.includes("qwen3.5") || n.includes("qwen3")) ?? null,
    efficient:
      names.find((n) => n.includes("nemotron") || n.includes("glm") || n.includes("hermes")) ??
      null,
    general:
      names.find((n) => n.includes("llama") || n.includes("mistral") || n.includes("minimax")) ??
      null,
    fallback: names[0] ?? null,
  };
}

export function createOllamaAdapter(baseUrl: string = "http://localhost:11434"): ProviderAdapter {
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    // Thinking supported via the <think>…</think> convention used by DeepSeek
    // R1 Distill and the Qwen3-thinking family. See the processContent parser
    // in query() below.
    supportsThinking: true,
    maxContextWindow: 256_000,
  };

  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const model = options.model ?? "qwen3.5";

    // Use Ollama's native /api/chat endpoint (NOT /v1/chat/completions)
    const url = `${baseUrl}/api/chat`;

    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    if (options.messages) {
      for (const msg of options.messages) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: options.prompt });

    // TurboQuant KV cache compression params (injected by runtime when available)
    const ollamaOpts: Record<string, unknown> = {
      temperature: options.temperature ?? 0.2,
      num_predict: options.maxTokens ?? 4096,
    };
    if (options.ollamaParams) {
      ollamaOpts["num_ctx"] = options.ollamaParams.numCtx;
      ollamaOpts["flash_attention"] = options.ollamaParams.flashAttention;
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      options: ollamaOpts,
    };

    // Add tool definitions if provided
    if (options.tools && options.tools.length > 0) {
      body["tools"] = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: "error",
          content: `Ollama error (${response.status}): ${errorText.slice(0, 300)}`,
          model,
          provider: "ollama",
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: "error", content: "No response body from Ollama", model, provider: "ollama" };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalTokens = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let hadToolCalls = false;
      // Latest done_reason observed on a `done: true` chunk. Ollama
      // 0.5+ reports this explicitly (e.g. "length" for token-limit
      // truncation); older versions omit the field, in which case the
      // adapter falls back to the tool_calls / "stop" default path.
      let doneReason: string | undefined;

      // ── Thinking-tag parser state ───────────────────────────
      // DeepSeek R1 Distill and Qwen3-thinking variants emit reasoning between
      // <think>…</think> tags interleaved with the normal text stream. We route
      // content inside the tags to a separate "thinking" StreamChunk so the
      // runtime can preserve it in conversation history and render it
      // differently in the UI without polluting the final text output.
      let insideThink = false;
      let thinkingPending = "";
      let accumulatedThinking = "";

      const flushThinking = function* (): Generator<StreamChunk> {
        if (thinkingPending.length > 0) {
          yield {
            type: "thinking",
            content: thinkingPending,
            model,
            provider: "ollama",
          };
          accumulatedThinking += thinkingPending;
          thinkingPending = "";
        }
      };

      /**
       * Split a text chunk around <think>/</think> markers and yield the
       * appropriate StreamChunk segments in order.
       */
      const processContent = function* (raw: string): Generator<StreamChunk> {
        let remaining = raw;
        while (remaining.length > 0) {
          if (insideThink) {
            const close = remaining.indexOf("</think>");
            if (close === -1) {
              thinkingPending += remaining;
              remaining = "";
            } else {
              thinkingPending += remaining.slice(0, close);
              remaining = remaining.slice(close + "</think>".length);
              insideThink = false;
              yield* flushThinking();
            }
          } else {
            const open = remaining.indexOf("<think>");
            if (open === -1) {
              yield {
                type: "text",
                content: remaining,
                model,
                provider: "ollama",
              };
              remaining = "";
            } else {
              if (open > 0) {
                yield {
                  type: "text",
                  content: remaining.slice(0, open),
                  model,
                  provider: "ollama",
                };
              }
              remaining = remaining.slice(open + "<think>".length);
              insideThink = true;
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // Ollama streams one JSON object per line (not SSE format)
            const chunk = JSON.parse(line) as OllamaChatChunk;

            if (chunk.message?.content) {
              yield* processContent(chunk.message.content);
            }

            // Handle tool calls from models that support them
            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                hadToolCalls = true;
                yield {
                  type: "tool_use",
                  content: JSON.stringify(tc.function.arguments),
                  model,
                  provider: "ollama",
                  toolName: tc.function.name,
                  toolInput: tc.function.arguments,
                };
              }
            }

            if (chunk.done) {
              inputTokens = chunk.prompt_eval_count ?? 0;
              outputTokens = chunk.eval_count ?? 0;
              totalTokens = inputTokens + outputTokens;
              // Capture the explicit reason from Ollama 0.5+. The
              // final `done` chunk is the authoritative source; we
              // overwrite any earlier intermediate value.
              if (chunk.done_reason) doneReason = chunk.done_reason;
            }
          } catch {
            // Skip malformed JSON lines — partial frames are expected while
            // streaming large payloads, and the next iteration will recover.
          }
        }
      }

      // Flush any residual thinking text if the stream ends mid-tag.
      yield* flushThinking();

      yield {
        type: "done",
        content: "",
        model,
        provider: "ollama",
        tokensUsed: totalTokens,
        // Wave 4G: surface split usage. Ollama reports eval_count
        // (output) + prompt_eval_count (input) separately so we can
        // attribute them honestly.
        usage: {
          inputTokens,
          outputTokens,
        },
        // When the model emitted tool_calls this turn, advertise
        // stopReason: "tool_calls" so the runtime's agent loop knows to
        // execute tools and continue. Without this the loop treats the
        // turn as final and dies after one tool call. Tool calls WIN
        // over done_reason: Ollama 0.5+ may report done_reason="stop"
        // alongside tool_calls, and the loop must see tool_calls to
        // keep iterating.
        stopReason: hadToolCalls ? "tool_calls" : mapOllamaDoneReason(doneReason),
        // Thinking transcript for the runtime to preserve in message history
        // so the next call can include the <think>…</think> block.
        ...(accumulatedThinking.length > 0 ? { thinking: accumulatedThinking } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield { type: "error", content: `Ollama error: ${message}`, model, provider: "ollama" };
    }
  }

  async function listModels(): Promise<readonly string[]> {
    const models = await discoverOllamaModels(baseUrl);
    return models.map((m) => m.name);
  }

  async function isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    id: "ollama",
    name: "ollama",
    transport: "chat_completions",
    capabilities,
    query,
    listModels,
    isAvailable,
  };
}
