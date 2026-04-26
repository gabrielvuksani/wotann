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
  resolveCacheTtl,
  type CacheStrategy,
  type CacheTtl,
} from "./prompt-cache-warmup.js";
import { toAnthropicTools } from "./tool-serializer.js";
import { authExpiredMessage, getProviderService } from "./provider-service.js";

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
  ttl: CacheTtl = "5m",
): string | Anthropic.Messages.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;

  // If the prompt is too short to benefit from caching, send as-is
  if (systemPrompt.length < CACHE_MIN_CHARS) return systemPrompt;

  // V9 T14.1b — explicit 1h markers include `ttl`; 5m (default) omits
  // the field entirely to preserve the pre-T14.1b wire format.
  const markerFor = (
    shouldCache: boolean,
  ): { cache_control: { type: "ephemeral"; ttl?: "1h" } } | Record<string, never> => {
    if (!shouldCache) return {};
    return ttl === "1h"
      ? { cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }
      : { cache_control: { type: "ephemeral" as const } };
  };

  // Split on double-newline boundaries that often separate logical sections
  // (identity, tool definitions, rules, context). Fall back to a single block.
  const sections = systemPrompt.split(/\n{2,}/).filter((s) => s.trim().length > 0);

  if (sections.length <= 1) {
    // Single-section path — delegate to the shared annotation policy so
    // there is exactly one authority on how caching markers are placed.
    const annotated = annotatePromptForCaching(systemPrompt, strategy, ttl);
    return annotated.blocks.map((b) => ({
      type: "text" as const,
      text: b.text,
      ...markerFor(!!b.cache_control),
    })) as Anthropic.Messages.TextBlockParam[];
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
      ...markerFor(shouldCache),
    };
  }) as Anthropic.Messages.TextBlockParam[];
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
  const defaultConfig = getModelContextConfig("claude-sonnet-4-7", "anthropic");
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
    const model = options.model ?? "claude-sonnet-4-7";
    const maxTokens = options.maxTokens ?? 4096;
    // V9 Wave 6-MM: track the active token so a mid-stream 401 can flag
    // it as expired (and key rotation can avoid handing back the same
    // bearer that just failed).
    const activeToken = options.authToken ?? apiKey;
    const client = createClient(activeToken);
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
    //
    // V9 T14.1b — resolve the active cache TTL from the process env snapshot.
    // When `ENABLE_PROMPT_CACHING_1H=1`, we tag blocks with the 1h tier
    // AND attach the required `extended-cache-ttl-2025-04-11` beta header
    // below. The env snapshot is passed explicitly so this file stays
    // env-guard clean (QB #13) — tests inject a fixture via options.envOverride.
    const envSnapshot =
      (
        options as UnifiedQueryOptions & {
          readonly envOverride?: Readonly<Record<string, string | undefined>>;
        }
      ).envOverride ?? process.env;
    const cacheTtl = resolveCacheTtl(envSnapshot);
    const systemParam = buildSystemBlocks(options.systemPrompt, "auto", cacheTtl);

    // S1-3 + P0-4: Forward tool definitions into the request body via the
    // shared tool-serializer (Hermes `convert_tools_to_anthropic` pattern).
    // The serializer renames `inputSchema` → `input_schema` while preserving
    // nested objects, arrays-of-objects, additionalProperties, required, and
    // enums verbatim. It also rejects `$ref`-bearing schemas with a clean
    // error rather than letting them reach the API as opaque 400s.
    const anthropicTools =
      options.tools && options.tools.length > 0 ? toAnthropicTools(options.tools) : undefined;

    // V9 Wave 6-MM — wrap stream construction in a helper so a
    // mid-stream 401 can transparently rotate to the next configured
    // credential (one retry only) before surfacing auth_expired.
    const buildStream = (token: string): ReturnType<typeof client.messages.stream> => {
      const c = token === activeToken ? client : createClient(token);
      return c.messages.stream({
        model,
        max_tokens: maxTokens,
        system: systemParam,
        messages,
        temperature: options.temperature,
        ...(anthropicTools ? { tools: anthropicTools as unknown as never } : {}),
        // V9 T14.1b — opt into the 1h cache TTL by surfacing the Anthropic
        // beta flag. Harmless to include when ttl=5m too, but we only emit
        // it on the 1h path so the request stays minimal otherwise.
        ...(cacheTtl === "1h"
          ? { betas: ["extended-cache-ttl-2025-04-11"] as unknown as never }
          : {}),
      });
    };

    // V9 Wave 6-MM — outer rotation loop. Runs at most twice: once
    // with the current token, then once more with the rotated token
    // if (a) the first attempt throws a 401 BEFORE any chunk is
    // emitted and (b) WOTANN_KEY_ROTATION=1 surfaces an alternate.
    //
    // We deliberately do NOT rotate after a partial stream because
    // the model has already emitted output the caller is now
    // appending — restarting would duplicate text and tool calls.
    // QB#6: when rotation can't help, surface auth_expired clearly.
    let currentToken = activeToken;
    let attempt = 0;
    let yieldedAnyChunk = false;
    rotationLoop: while (true) {
      attempt++;
      try {
        let stream = buildStream(currentToken);

        // S1-21: Parse the full content-block lifecycle.
        // Anthropic streaming sends:
        //   content_block_start { content_block: { type: "tool_use" | "text" | "thinking", ... } }
        //   content_block_delta { delta: { type: "text_delta"|"input_json_delta"|"thinking_delta", ... } }
        //   content_block_stop
        // For tool_use blocks, the `name` and `id` arrive in content_block_start,
        // and the argument JSON is streamed as input_json_delta fragments that
        // must be concatenated before JSON.parse.
        let totalTokens = 0;
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;
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
              yieldedAnyChunk = true;
              yield {
                type: "text",
                content: delta.text,
                model,
                provider: "anthropic",
              };
            } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
              if (state) state.thinkingText += delta.thinking;
              yieldedAnyChunk = true;
              yield {
                type: "thinking",
                content: delta.thinking,
                model,
                provider: "anthropic",
              };
            } else if (
              delta.type === "input_json_delta" &&
              typeof delta.partial_json === "string"
            ) {
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
              yieldedAnyChunk = true;
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
            inputTokens = usage.usage?.input_tokens ?? 0;
            outputTokens = usage.usage?.output_tokens ?? 0;
            totalTokens = inputTokens + outputTokens;

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
              cacheReadTokens = u.cache_read_input_tokens;
            }
            if (u?.cache_creation_input_tokens && u.cache_creation_input_tokens > 0) {
              anthropicCacheTracker.recordMiss(u.cache_creation_input_tokens);
              cacheWriteTokens = u.cache_creation_input_tokens;
            }
          }
        }

        yield {
          type: "done",
          content: "",
          model,
          provider: "anthropic",
          tokensUsed: totalTokens,
          usage: {
            inputTokens,
            outputTokens,
            ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
          },
          stopReason,
        };
        // Successful drain — exit the rotation loop cleanly.
        break rotationLoop;
      } catch (error) {
        // V9 Wave 6-MM — detect Anthropic SDK 401 (AuthenticationError or
        // generic APIError with status 401). The SDK's instanceof check
        // is brittle across versions, so we duck-type on the `status`
        // property which APIError always carries.
        const status = (error as { status?: number } | null)?.status;
        const isAuthErr = status === 401;

        if (isAuthErr) {
          // Mark this token expired so future requests don't re-try it
          // and so the UI can surface a re-auth prompt.
          try {
            getProviderService().markCredentialExpired("anthropic", currentToken);
          } catch {
            /* provider-service init is best-effort here */
          }

          // Only attempt rotation if we have NOT already streamed any
          // chunks (otherwise restarting would duplicate output) and
          // this is the first attempt. WOTANN_KEY_ROTATION must be on.
          if (!yieldedAnyChunk && attempt === 1) {
            const alt = (() => {
              try {
                return getProviderService().getAlternateCredential("anthropic", currentToken);
              } catch {
                return null;
              }
            })();
            if (alt) {
              currentToken = alt.token;
              continue rotationLoop;
            }
          }

          yield {
            type: "error",
            content: authExpiredMessage("anthropic"),
            code: "auth_expired",
            model,
            provider: "anthropic",
            stopReason: "error",
          };
          break rotationLoop;
        }

        const message = error instanceof Error ? error.message : "Unknown error";
        yield {
          type: "error",
          content: `Anthropic API error: ${message}`,
          model,
          provider: "anthropic",
        };
        break rotationLoop;
      }
    } // end rotationLoop
  }

  async function listModels(): Promise<readonly string[]> {
    return ["claude-opus-4-7", "claude-sonnet-4-7", "claude-haiku-4-5"];
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
