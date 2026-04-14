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
