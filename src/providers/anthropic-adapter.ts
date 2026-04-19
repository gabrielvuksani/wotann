/**
 * Anthropic provider adapter. Uses @anthropic-ai/sdk for the Messages API.
 * Supports streaming, vision, extended thinking, and tool calling.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";
import { openAIToAnthropic } from "./format-translator.js";
import { getModelContextConfig } from "../context/limits.js";
import {
  annotatePromptForCaching,
  CacheHitTracker,
  type CacheStrategy,
} from "./prompt-cache-warmup.js";

/**
 * Minimum token length for a system block to be worth caching.
 * Anthropic requires at least 1024 tokens in the cached prefix, so we
 * only tag blocks whose character count suggests they cross that threshold
 * (rough heuristic: 4 chars per token).
 */
const CACHE_MIN_CHARS = 4096;

/**
 * Maximum number of cache breakpoints Anthropic allows per request.
 * We mark at most this many blocks with `cache_control`.
 */
const MAX_CACHE_BREAKPOINTS = 4;

/**
 * Split system prompt into content blocks and apply `cache_control: { type: "ephemeral" }`
 * to stable, large blocks (identity, tools, rules). Small or absent prompts pass through
 * as a plain string so we do not add overhead for trivial cases.
 *
 * Flow:
 *   1. Prompts below `CACHE_MIN_CHARS` pass through as-is (no overhead).
 *   2. Prompts with 2+ logical sections use the adapter's per-section
 *      cache-control placement (preserves existing behavior on multi-
 *      section system prompts with tool descriptions).
 *   3. Single-section large prompts delegate to
 *      `annotatePromptForCaching` from `prompt-cache-warmup.ts` so the
 *      shared warmup/annotation policy stays the single source of truth
 *      for cache_control placement.
 */
function buildSystemBlocks(
  systemPrompt: string | undefined,
  strategy: CacheStrategy = "auto",
): string | Anthropic.Messages.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;

  // If the prompt is too short to benefit from caching, send as-is
  if (systemPrompt.length < CACHE_MIN_CHARS) return systemPrompt;

  // Split on double-newline boundaries that often separate logical sections
  // (identity, tool definitions, rules, context). Fall back to a single block.
  const sections = systemPrompt.split(/\n{2,}/).filter((s) => s.trim().length > 0);

  if (sections.length <= 1) {
    // Single-section path — delegate to the shared annotation policy so
    // there is exactly one authority on how caching markers are placed.
    const annotated = annotatePromptForCaching(systemPrompt, strategy);
    return annotated.blocks.map((b) => ({
      type: "text" as const,
      text: b.text,
      ...(b.cache_control ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
  }

  // Multiple sections — mark the first N large blocks for caching.
  // These are typically identity + tools + rules and change rarely.
  let breakpointsUsed = 0;
  return sections.map((text) => {
    const shouldCache = breakpointsUsed < MAX_CACHE_BREAKPOINTS && text.length >= CACHE_MIN_CHARS;
    if (shouldCache) breakpointsUsed++;
    return {
      type: "text" as const,
      text,
      ...(shouldCache ? { cache_control: { type: "ephemeral" as const } } : {}),
    };
  });
}

/**
 * Shared cache-hit tracker for the Anthropic adapter. Instances that
 * need isolated telemetry can create their own; callers that just want
 * adapter-wide stats read this singleton via `getAnthropicCacheTracker()`.
 */
const anthropicCacheTracker = new CacheHitTracker();

/**
 * Access the cache tracker for the Anthropic adapter. Callers (daemon,
 * TUI cost overlay) read stats after each turn to surface hit rate.
 */
export function getAnthropicCacheTracker(): CacheHitTracker {
  return anthropicCacheTracker;
}

export function createAnthropicAdapter(apiKey: string): ProviderAdapter {
  const defaultConfig = getModelContextConfig("claude-sonnet-4-6", "anthropic");
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: true,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: defaultConfig.maxContextTokens,
  };

  function createClient(authToken?: string): Anthropic {
    return new Anthropic({ apiKey: authToken ?? apiKey });
  }

  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const model = options.model ?? "claude-sonnet-4-6";
    const maxTokens = options.maxTokens ?? 4096;
    const client = createClient(options.authToken);
    // NOTE: per-query context config is read at adapter construction
    // time (defaultConfig, line 76) so we don't need a per-query lookup
    // here. The prior `contextConfig = getModelContextConfig(...)` call
    // was dead work that computed the same value for every request.

    const messages: Anthropic.MessageParam[] = [];

    // Use the shared format translator so tool results survive provider switches.
    if (options.messages) {
      const translated = openAIToAnthropic(
        options.messages
          .filter((msg) => msg.role !== "system")
          .map((msg) =>
            msg.role === "tool"
              ? {
                  role: "tool" as const,
                  content: msg.content,
                  tool_call_id: msg.toolCallId,
                }
              : {
                  role: msg.role,
                  content: msg.content,
                },
          ),
      );

      for (const msg of translated) {
        messages.push(msg as Anthropic.MessageParam);
      }
    }

    // Add current prompt
    messages.push({ role: "user", content: options.prompt });

    // Build system prompt blocks with cache control breakpoints.
    // The system prompt (identity, tools, rules) is large and stable across turns,
    // so we mark it for Anthropic's prompt caching to avoid re-processing.
    const systemParam = buildSystemBlocks(options.systemPrompt);

    // S1-3: Forward tool definitions into the request body. Anthropic's schema
    // expects `{ name, description, input_schema }` — our UnifiedQueryOptions
    // stores them in the same shape under `inputSchema`, so just map the key.
    const anthropicTools =
      options.tools && options.tools.length > 0
        ? options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Record<string, unknown>,
          }))
        : undefined;

    try {
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: systemParam,
        messages,
        temperature: options.temperature,
        ...(anthropicTools ? { tools: anthropicTools as unknown as never } : {}),
      });

      // S1-21: Parse the full content-block lifecycle.
      // Anthropic streaming sends:
      //   content_block_start { content_block: { type: "tool_use" | "text" | "thinking", ... } }
      //   content_block_delta { delta: { type: "text_delta"|"input_json_delta"|"thinking_delta", ... } }
      //   content_block_stop
      // For tool_use blocks, the `name` and `id` arrive in content_block_start,
      // and the argument JSON is streamed as input_json_delta fragments that
      // must be concatenated before JSON.parse.
      let totalTokens = 0;
      let stopReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" = "stop";

      // Per-block accumulators keyed by Anthropic's content block index.
      const blockState = new Map<
        number,
        {
          kind: "text" | "tool_use" | "thinking" | "redacted_thinking" | "other";
          toolName?: string;
          toolId?: string;
          partialJson: string;
          thinkingText: string;
        }
      >();

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          const index = event.index;
          if (block.type === "tool_use") {
            blockState.set(index, {
              kind: "tool_use",
              toolName: block.name,
              toolId: block.id,
              partialJson: "",
              thinkingText: "",
            });
          } else if (block.type === "thinking") {
            blockState.set(index, {
              kind: "thinking",
              partialJson: "",
              thinkingText: "",
            });
          } else if (block.type === "text") {
            blockState.set(index, {
              kind: "text",
              partialJson: "",
              thinkingText: "",
            });
          } else {
            blockState.set(index, {
              kind: "other",
              partialJson: "",
              thinkingText: "",
            });
          }
        } else if (event.type === "content_block_delta") {
          const index = event.index;
          const state = blockState.get(index);
          const delta = event.delta as {
            type?: string;
            text?: string;
            partial_json?: string;
            thinking?: string;
          };

          if (delta.type === "text_delta" && typeof delta.text === "string") {
            yield {
              type: "text",
              content: delta.text,
              model,
              provider: "anthropic",
            };
          } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
            if (state) state.thinkingText += delta.thinking;
            yield {
              type: "thinking",
              content: delta.thinking,
              model,
              provider: "anthropic",
            };
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            if (state) state.partialJson += delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const index = event.index;
          const state = blockState.get(index);
          if (state?.kind === "tool_use") {
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput =
                state.partialJson.length > 0
                  ? (JSON.parse(state.partialJson) as Record<string, unknown>)
                  : {};
            } catch {
              // Malformed tool arguments — surface as an error chunk so the
              // caller can decide to retry vs. hand raw text to the model.
              yield {
                type: "error",
                content: `Anthropic: malformed tool_use arguments for ${state.toolName ?? "unknown"}`,
                model,
                provider: "anthropic",
              };
              continue;
            }
            yield {
              type: "tool_use",
              content: state.partialJson,
              toolName: state.toolName,
              toolCallId: state.toolId,
              toolInput: parsedInput,
              model,
              provider: "anthropic",
              stopReason: "tool_calls",
            };
            stopReason = "tool_calls";
          }
        } else if (event.type === "message_delta") {
          // message_delta carries the final stop_reason and usage for this turn.
          const delta = event as unknown as {
            delta?: { stop_reason?: string };
            usage?: { output_tokens?: number };
          };
          const reason = delta.delta?.stop_reason;
          if (reason === "tool_use") stopReason = "tool_calls";
          else if (reason === "max_tokens") stopReason = "max_tokens";
          else if (reason === "end_turn" || reason === "stop_sequence") stopReason = "stop";
        } else if (event.type === "message_stop") {
          const usage = await stream.finalMessage();
          totalTokens = (usage.usage?.input_tokens ?? 0) + (usage.usage?.output_tokens ?? 0);

          // Record cache telemetry — Anthropic returns two fields on
          // usage when prompt-caching is active:
          //   cache_read_input_tokens     → hit (cached read)
          //   cache_creation_input_tokens → miss (wrote to cache)
          const u = usage.usage as
            | {
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              }
            | undefined;
          if (u?.cache_read_input_tokens && u.cache_read_input_tokens > 0) {
            anthropicCacheTracker.recordHit(u.cache_read_input_tokens);
          }
          if (u?.cache_creation_input_tokens && u.cache_creation_input_tokens > 0) {
            anthropicCacheTracker.recordMiss(u.cache_creation_input_tokens);
          }
        }
      }

      yield {
        type: "done",
        content: "",
        model,
        provider: "anthropic",
        tokensUsed: totalTokens,
        stopReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield {
        type: "error",
        content: `Anthropic API error: ${message}`,
        model,
        provider: "anthropic",
      };
    }
  }

  async function listModels(): Promise<readonly string[]> {
    return ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];
  }

  async function isAvailable(): Promise<boolean> {
    try {
      // Quick health check — list models
      const client = createClient();
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  return {
    id: "anthropic",
    name: "anthropic",
    transport: "anthropic",
    capabilities,
    query,
    listModels,
    isAvailable,
  };
}
