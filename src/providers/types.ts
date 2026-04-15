/**
 * Provider-specific types for the multi-provider engine.
 */

import type { ProviderName, TransportType, AgentMessage } from "../core/types.js";

export interface ProviderCapabilities {
  readonly supportsComputerUse: boolean;
  readonly supportsToolCalling: boolean;
  readonly supportsVision: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsThinking: boolean;
  readonly maxContextWindow: number;
}

export interface UnifiedQueryOptions {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly messages?: readonly AgentMessage[];
  readonly model?: string;
  readonly authToken?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly stream?: boolean;
  readonly tools?: readonly ToolSchema[];
  /** TurboQuant KV cache compression params for Ollama (injected by runtime). */
  readonly ollamaParams?: {
    readonly numCtx: number;
    readonly kvCacheType: string;
    readonly flashAttention: boolean;
  };
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/**
 * Reason the model stopped generating. Normalised across providers so
 * downstream code (autonomous loops, tool executors, UI) can key off a single
 * vocabulary. Added by S1-27 alongside the tool-serialization fix — without
 * it there's no way to distinguish "stop because natural end" from "stop
 * because the model requested a tool call".
 *
 * Provider mappings:
 *   Anthropic:     end_turn → "stop", tool_use → "tool_calls",
 *                   max_tokens → "max_tokens", stop_sequence → "stop"
 *   OpenAI/compat: stop → "stop", tool_calls/function_call → "tool_calls",
 *                   length → "max_tokens", content_filter → "content_filter"
 *   Codex:         similar to OpenAI
 *   Ollama:        stop → "stop"; tool_calls inferred from response
 */
export type StopReason = "stop" | "tool_calls" | "max_tokens" | "content_filter" | "error";

export interface StreamChunk {
  readonly type: "text" | "tool_use" | "thinking" | "done" | "error";
  readonly content: string;
  readonly model?: string;
  readonly provider?: ProviderName;
  readonly tokensUsed?: number;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  /**
   * Accumulated thinking transcript attached to the terminal "done" chunk so
   * the runtime can preserve the full reasoning block in conversation history
   * (used by Ollama adapters that emit <think>…</think> segments inline).
   */
  readonly thinking?: string;
  /**
   * Normalised reason the model stopped generating. Present on "done" chunks;
   * "error" chunks set it to "error". See StopReason for the vocabulary.
   */
  readonly stopReason?: StopReason;
  /**
   * Opaque tool call identifier from the provider (OpenAI's call_id / Anthropic's
   * tool_use id). Needed so tool-result messages can reference the originating
   * call when the model makes multiple parallel tool calls in one turn.
   */
  readonly toolCallId?: string;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly name: ProviderName;
  readonly transport: TransportType;
  readonly capabilities: ProviderCapabilities;

  query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk>;
  listModels(): Promise<readonly string[]>;
  isAvailable(): Promise<boolean>;
}

export interface ProviderHealthScore {
  latencyMs: number;
  avgLatencyMs: number;
  healthy: boolean;
  errorRate: number;
  requestCount: number;
  errorCount: number;
  costPer1kTokens: number;
}

export interface RateLimitState {
  limited: boolean;
  resetAt: Date;
  provider: ProviderName;
  retryAfterMs: number;
}
