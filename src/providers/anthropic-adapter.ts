/**
 * Anthropic provider adapter. Uses @anthropic-ai/sdk for the Messages API.
 * Supports streaming, vision, extended thinking, and tool calling.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter, UnifiedQueryOptions, StreamChunk, ProviderCapabilities } from "./types.js";
import { openAIToAnthropic } from "./format-translator.js";
import { getModelContextConfig, isExtendedContextEnabled } from "../context/limits.js";

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
 */
function buildSystemBlocks(
  systemPrompt: string | undefined,
): string | Anthropic.Messages.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;

  // If the prompt is too short to benefit from caching, send as-is
  if (systemPrompt.length < CACHE_MIN_CHARS) return systemPrompt;

  // Split on double-newline boundaries that often separate logical sections
  // (identity, tool definitions, rules, context). Fall back to a single block.
  const sections = systemPrompt.split(/\n{2,}/).filter((s) => s.trim().length > 0);

  if (sections.length <= 1) {
    // Single large block — cache the entire system prompt
    return [
      {
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ];
  }

  // Multiple sections — mark the first N large blocks for caching.
  // These are typically identity + tools + rules and change rarely.
  let breakpointsUsed = 0;
  return sections.map((text) => {
    const shouldCache =
      breakpointsUsed < MAX_CACHE_BREAKPOINTS && text.length >= CACHE_MIN_CHARS;
    if (shouldCache) breakpointsUsed++;
    return {
      type: "text" as const,
      text,
      ...(shouldCache ? { cache_control: { type: "ephemeral" as const } } : {}),
    };
  });
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
    const contextConfig = getModelContextConfig(model, "anthropic", {
      enableExtendedContext: isExtendedContextEnabled("anthropic", model),
    });

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

    try {
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: systemParam,
        messages,
        temperature: options.temperature,
      });

      let totalTokens = 0;

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta;
          if ("text" in delta) {
            yield {
              type: "text",
              content: delta.text,
              model,
              provider: "anthropic",
            };
          }
        } else if (event.type === "message_stop") {
          const usage = await stream.finalMessage();
          totalTokens = (usage.usage?.input_tokens ?? 0) + (usage.usage?.output_tokens ?? 0);
        }
      }

      yield {
        type: "done",
        content: "",
        model,
        provider: "anthropic",
        tokensUsed: totalTokens,
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
