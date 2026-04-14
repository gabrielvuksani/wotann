/**
 * Bridge to @anthropic-ai/claude-agent-sdk.
 *
 * When the Anthropic provider is active, delegates to the official SDK's
 * query() function — the same agentic loop powering Claude Code. This gives
 * WOTANN users the full Claude Code experience (tools, streaming, sessions)
 * while WOTANN adds value via multi-provider routing, memory, hooks, and skills.
 *
 * For non-Anthropic providers, the custom AgentBridge in agent-bridge.ts is used.
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { StreamChunk } from "../providers/types.js";

export interface ClaudeSDKQueryOptions {
  readonly prompt: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly systemPrompt?: string;
  readonly permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
  readonly maxTurns?: number;
  readonly abortController?: AbortController;
  readonly allowedTools?: readonly string[];
}

/**
 * Execute a query via the official Claude Agent SDK.
 * Yields StreamChunk objects compatible with our AgentBridge interface.
 */
export async function* queryViaClaudeSDK(
  options: ClaudeSDKQueryOptions,
): AsyncGenerator<StreamChunk> {
  const startTime = Date.now();

  try {
    const q = sdkQuery({
      prompt: options.prompt,
      options: {
        model: options.model,
        cwd: options.cwd ?? process.cwd(),
        permissionMode: options.permissionMode ?? "bypassPermissions",
        maxTurns: options.maxTurns ?? 10,
        abortController: options.abortController,
        allowedTools: options.allowedTools ? [...options.allowedTools] : undefined,
        systemPrompt: options.systemPrompt,
      },
    });

    let totalTokens = 0;

    for await (const message of q) {
      switch (message.type) {
        case "assistant": {
          // Full assistant message with BetaMessage content blocks
          const betaMsg = message.message;
          for (const block of betaMsg.content) {
            if (block.type === "text") {
              yield {
                type: "text",
                content: block.text,
                model: betaMsg.model,
                provider: "anthropic",
              };
            } else if (block.type === "tool_use") {
              yield {
                type: "tool_use",
                content: JSON.stringify(block.input),
                model: betaMsg.model,
                provider: "anthropic",
                toolName: block.name,
                toolInput: block.input as Record<string, unknown>,
              };
            } else if (block.type === "thinking") {
              yield {
                type: "thinking",
                content: (block as { thinking: string }).thinking ?? "",
                model: betaMsg.model,
                provider: "anthropic",
              };
            }
          }
          if (betaMsg.usage) {
            totalTokens = betaMsg.usage.input_tokens + betaMsg.usage.output_tokens;
          }
          break;
        }

        case "stream_event": {
          // Partial streaming — content_block_delta events
          const event = message.event;
          if (event.type === "content_block_delta" && "delta" in event) {
            const delta = event.delta as { type: string; text?: string };
            if (delta.type === "text_delta" && delta.text) {
              yield {
                type: "text",
                content: delta.text,
                provider: "anthropic",
              };
            }
          }
          break;
        }

        case "result": {
          // Final result — session complete
          if (message.subtype === "success") {
            totalTokens = message.usage?.input_tokens
              ? message.usage.input_tokens + (message.usage?.output_tokens ?? 0)
              : totalTokens;
            yield {
              type: "done",
              content: message.result ?? "",
              provider: "anthropic",
              tokensUsed: totalTokens,
            };
          } else {
            yield {
              type: "error",
              content: `Claude SDK error: ${(message as { error?: string }).error ?? "unknown"}`,
              provider: "anthropic",
            };
          }
          break;
        }

        // Other message types (system, status, auth) are informational
        default:
          break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    yield {
      type: "error",
      content: `Claude SDK error: ${message}`,
      provider: "anthropic",
    };
  }
}

/**
 * Check if the Claude Agent SDK is available and authenticated.
 */
export async function isClaudeSDKAvailable(): Promise<boolean> {
  try {
    // The SDK requires Claude Code to be installed and authenticated
    const { query: q } = await import("@anthropic-ai/claude-agent-sdk");
    return typeof q === "function";
  } catch {
    return false;
  }
}
