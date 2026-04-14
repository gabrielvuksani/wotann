import type { WotannRuntime, RuntimeStatus } from "../core/runtime.js";
import type { WotannQueryOptions } from "../core/types.js";
import type { StreamChunk } from "../providers/types.js";

export interface RuntimeQueryHandlers {
  readonly onText?: (chunk: StreamChunk) => void;
  readonly onError?: (chunk: StreamChunk) => void;
}

export interface RuntimeQueryResult {
  readonly output: string;
  readonly errors: readonly string[];
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly provider?: string;
  readonly model?: string;
}

type RuntimeQueryLike = Pick<WotannRuntime, "query" | "getStatus">;

/**
 * Execute a query through WotannRuntime and return aggregated output, errors,
 * token usage, and cost delta for that call. This keeps CLI surfaces on the
 * same harness path as the TUI instead of dropping down to AgentBridge.
 */
export async function runRuntimeQuery(
  runtime: RuntimeQueryLike,
  options: WotannQueryOptions,
  handlers: RuntimeQueryHandlers = {},
): Promise<RuntimeQueryResult> {
  const before = runtime.getStatus();
  let output = "";
  const errors: string[] = [];
  let chunkTokens = 0;
  let provider: string | undefined;
  let model: string | undefined;

  for await (const chunk of runtime.query(options)) {
    if (chunk.type === "text") {
      output += chunk.content;
      handlers.onText?.(chunk);
    } else if (chunk.type === "error") {
      errors.push(chunk.content);
      handlers.onError?.(chunk);
    }

    if (chunk.tokensUsed) chunkTokens = chunk.tokensUsed;
    if (chunk.provider) provider = chunk.provider;
    if (chunk.model) model = chunk.model;
  }

  const after = runtime.getStatus();
  return {
    output,
    errors,
    tokensUsed: deriveDelta(before, after, chunkTokens, "totalTokens"),
    costUsd: deriveDelta(before, after, 0, "totalCost"),
    provider,
    model,
  };
}

function deriveDelta(
  before: RuntimeStatus,
  after: RuntimeStatus,
  fallback: number,
  field: "totalTokens" | "totalCost",
): number {
  const delta = after[field] - before[field];
  if (!Number.isFinite(delta) || delta < 0) {
    return fallback;
  }
  if (delta === 0 && fallback > 0) {
    return fallback;
  }
  return delta;
}
