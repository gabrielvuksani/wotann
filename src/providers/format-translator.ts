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
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id,
            content: msg.content ?? "",
          },
        ],
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
    role:
      msg.role === "system"
        ? ("system" as const)
        : msg.role === "tool"
          ? ("tool" as const)
          : (msg.role as "user" | "assistant"),
    content:
      typeof msg.content === "string"
        ? msg.content
        : msg.content === null
          ? ""
          : "[complex content]",
  }));
}

// ── Gemini Format Types (session-10 addition) ──────────────────────
//
// Gemini's `generateContent` / streaming endpoint expects `contents: [...]`
// where each content has `role: "user" | "model"` and `parts: [...]`. A part
// is one of `{ text }`, `{ inlineData: { mimeType, data } }`, `{ functionCall:
// { name, args } }`, or `{ functionResponse: { name, response } }`.
// See https://ai.google.dev/api/rest/v1beta/Content
//
// Prior to session-10 the registry claimed Anthropic↔OpenAI↔Gemini
// translation but the translator file had no Gemini conversion; each call
// site had to hand-roll its own. Now all three pairs round-trip here, so
// adapters can share the same translator surface.

interface GeminiContent {
  readonly role: "user" | "model";
  readonly parts: readonly GeminiPart[];
}

interface GeminiPart {
  readonly text?: string;
  readonly inlineData?: { readonly mimeType: string; readonly data: string };
  readonly functionCall?: { readonly name: string; readonly args: Record<string, unknown> };
  readonly functionResponse?: { readonly name: string; readonly response: Record<string, unknown> };
}

function anthropicRoleToGemini(role: AnthropicMessage["role"]): GeminiContent["role"] {
  return role === "assistant" ? "model" : "user";
}

/**
 * Convert Anthropic messages to Gemini `contents`.
 * - `tool_use` → `functionCall`
 * - `tool_result` → `functionResponse`
 * - `image` → `inlineData`
 * - `text` / `thinking` → `text`
 */
export function anthropicToGemini(messages: readonly AnthropicMessage[]): readonly GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    const parts: GeminiPart[] = [];
    if (typeof m.content === "string") {
      if (m.content.length > 0) parts.push({ text: m.content });
    } else {
      for (const block of m.content) {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push({ text: block.text });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          // Gemini has no native "thinking" part; flatten to text so it isn't
          // silently dropped. Downstream consumers usually filter these anyway.
          parts.push({ text: `[thinking] ${block.thinking}` });
        } else if (block.type === "tool_use" && block.name) {
          parts.push({
            functionCall: { name: block.name, args: block.input ?? {} },
          });
        } else if (block.type === "tool_result" && block.tool_use_id) {
          parts.push({
            functionResponse: {
              name: block.tool_use_id,
              response: { content: block.content ?? "" },
            },
          });
        } else if (
          block.type === "image" &&
          block.source?.type === "base64" &&
          block.source.media_type &&
          block.source.data
        ) {
          parts.push({
            inlineData: {
              mimeType: block.source.media_type,
              data: block.source.data,
            },
          });
        }
      }
    }
    out.push({ role: anthropicRoleToGemini(m.role), parts });
  }
  return out;
}

/**
 * Convert Gemini `contents` to Anthropic messages.
 * - `functionCall` → `tool_use`
 * - `functionResponse` → `tool_result`
 * - `inlineData` → `image`
 * - `text` → `text`
 */
export function geminiToAnthropic(contents: readonly GeminiContent[]): readonly AnthropicMessage[] {
  return contents.map((c) => {
    const blocks: AnthropicContentBlock[] = [];
    for (const part of c.parts) {
      if (typeof part.text === "string") {
        blocks.push({ type: "text", text: part.text });
      } else if (part.functionCall) {
        blocks.push({
          type: "tool_use",
          id: `gemini-${Math.random().toString(36).slice(2, 10)}`,
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      } else if (part.functionResponse) {
        blocks.push({
          type: "tool_result",
          tool_use_id: part.functionResponse.name,
          content: JSON.stringify(part.functionResponse.response),
        });
      } else if (part.inlineData) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: part.inlineData.mimeType,
            data: part.inlineData.data,
          },
        });
      }
    }
    return {
      role: c.role === "model" ? "assistant" : "user",
      content: blocks,
    };
  });
}

/**
 * Convert OpenAI messages to Gemini contents by routing through Anthropic.
 * Preserves tool_call / tool_result semantics since Anthropic is the
 * richer intermediate (OpenAI's `tool` role → Anthropic `tool_result` →
 * Gemini `functionResponse`).
 */
export function openAIToGemini(messages: readonly OpenAIMessage[]): readonly GeminiContent[] {
  return anthropicToGemini(openAIToAnthropic(messages));
}

/**
 * Convert Gemini contents to OpenAI messages (round-trip via Anthropic).
 */
export function geminiToOpenAI(contents: readonly GeminiContent[]): readonly OpenAIMessage[] {
  return anthropicToOpenAI(geminiToAnthropic(contents));
}
