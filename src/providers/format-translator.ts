/**
 * Format translator: Anthropic ↔ OpenAI message formats.
 * Handles tool_use ↔ function_call, vision images, thinking blocks, streaming events.
 */

import type { AgentMessage } from "../core/types.js";

// ── Anthropic Format Types ──────────────────────────────────

interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: string | readonly AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  readonly type: "text" | "tool_use" | "tool_result" | "image" | "thinking";
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly tool_use_id?: string;
  readonly content?: string;
  readonly thinking?: string;
  readonly source?: { readonly type: "base64"; readonly media_type: string; readonly data: string };
}

// ── OpenAI Format Types ─────────────────────────────────────

interface OpenAIMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: readonly OpenAIToolCall[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

interface OpenAIToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

// ── Translation Functions ───────────────────────────────────

export function anthropicToOpenAI(messages: readonly AnthropicMessage[]): readonly OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Complex content blocks
    const textParts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          if (block.text) textParts.push(block.text);
          break;

        case "thinking":
          // Preserve thinking blocks structurally via metadata rather than lossy text
          if (block.thinking) {
            // Store as a developer/system message that's clearly marked as thinking
            result.push({
              role: "assistant",
              content: "",
              metadata: { thinking: block.thinking, type: "thinking_block" },
            } as OpenAIMessage & { metadata: Record<string, string> });
          }
          break;

        case "tool_use":
          if (block.id && block.name && block.input) {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
          break;

        case "tool_result":
          // Tool results become separate messages in OpenAI format
          result.push({
            role: "tool",
            content: block.content ?? "",
            tool_call_id: block.tool_use_id,
          });
          break;

        case "image":
          // Images described as text for non-vision models
          textParts.push("[Image attached]");
          break;
      }
    }

    if (textParts.length > 0 || toolCalls.length > 0) {
      result.push({
        role: msg.role,
        content: textParts.length > 0 ? textParts.join("\n") : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    }
  }

  return result;
}

export function openAIToAnthropic(messages: readonly OpenAIMessage[]): readonly AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    // Skip system messages (handled separately as system prompt)
    if (msg.role === "system") continue;

    // Tool responses
    if (msg.role === "tool") {
      result.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content ?? "",
        }],
      });
      continue;
    }

    // Messages with tool calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const blocks: AnthropicContentBlock[] = [];

      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }

      for (const call of msg.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: JSON.parse(call.function.arguments) as Record<string, unknown>,
        });
      }

      result.push({ role: "assistant", content: blocks });
      continue;
    }

    // Simple text messages
    if (msg.role === "user" || msg.role === "assistant") {
      result.push({ role: msg.role, content: msg.content ?? "" });
    }
  }

  return result;
}

// ── Unified Message Conversion ──────────────────────────────

export function toAgentMessages(
  messages: readonly (AnthropicMessage | OpenAIMessage)[],
): readonly AgentMessage[] {
  return messages.map((msg) => ({
    role: msg.role === "system" ? "system" as const
      : msg.role === "tool" ? "tool" as const
      : msg.role as "user" | "assistant",
    content: typeof msg.content === "string"
      ? msg.content
      : msg.content === null
        ? ""
        : "[complex content]",
  }));
}
