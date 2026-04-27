/**
 * Per-provider health-check system.
 *
 * Runs a battery of smoke tests against a provider adapter to verify
 * end-to-end liveness, capability claims, and stop-reason semantics.
 *
 * Tests (in order of cost):
 *   1. `ping`         — connect to the provider endpoint (auth-aware); 0 tokens.
 *   2. `list_models`  — confirm the adapter's listModels() works; 0 tokens.
 *   3. `simple_query` — send a minimal 1-token prompt; verifies streaming, auth,
 *                       and the `done` stopReason handshake.
 *   4. `tool_call`    — (only if `supportsToolCalling` is true) inject a simple
 *                       tool and assert the adapter emits `stopReason: "tool_calls"`
 *                       on tool-use turns. Guards Ollama Bug #5 regression.
 *
 * Design rules (from WOTANN quality bars):
 *   - Honest "degraded" state when a real call partially succeeds (e.g. ping
 *     works but simple_query 401s). Never fabricate success.
 *   - `--dry-run` mode runs the test battery against the static capability
 *     matrix without hitting the network, so CI + offline environments can
 *     produce a health report without real daemons/keys. Dry-run still
 *     exposes Bug #5 regressions via the unit-level fixture tests.
 *   - No `any` types — every failure mode is a typed error variant.
 */

import type { ProviderName } from "../core/types.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  StreamChunk,
  ToolSchema,
  UnifiedQueryOptions,
} from "./types.js";

export type HealthStatus = "ok" | "degraded" | "fail" | "skipped";

export interface HealthCheckOptions {
  /** Skip expensive tests (simple_query, tool_call). Useful for CI. */
  readonly dryRun?: boolean;
  /** Override the query payload for simple_query. */
  readonly prompt?: string;
  /** Per-test timeout in ms. Default 10s. */
  readonly timeoutMs?: number;
  /** Skip tool_call test even if capability claims toolCalling. */
  readonly skipToolCall?: boolean;
}

export interface HealthCheckResult {
  readonly name: "ping" | "list_models" | "simple_query" | "tool_call";
  readonly status: HealthStatus;
  readonly durationMs: number;
  readonly error?: string;
  /** Test-specific detail (e.g. model count, token count, emitted stopReason). */
  readonly detail?: string;
}

export interface HealthReport {
  readonly provider: ProviderName;
  readonly status: HealthStatus;
  readonly durationMs: number;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly toolCalls: boolean;
    readonly vision: boolean;
    readonly cacheControl: boolean;
    readonly thinking: boolean;
    readonly computerUse: boolean;
  };
  readonly tests: readonly HealthCheckResult[];
  readonly errors?: readonly string[];
  /** Generated at the top of runHealthCheck(). ISO-8601. */
  readonly generatedAt: string;
}

// ── Capability fingerprint ──────────────────────────────────

/**
 * Map a provider's declared ProviderCapabilities to the health-report shape.
 *
 * We surface `cacheControl` separately because not every adapter wires
 * prompt-cache breakpoints; it's computed from provider family rather than
 * the capability struct (capabilities struct doesn't model it today).
 */
function projectCapabilities(
  provider: ProviderName,
  caps: ProviderCapabilities,
): HealthReport["capabilities"] {
  // Prompt-cache support: Anthropic + OpenAI + Codex + Copilot (the four
  // providers currently honoring cache-control breakpoints in the format
  // translator layer). Others receive a graceful degradation.
  const cacheProviders: ReadonlySet<ProviderName> = new Set([
    "anthropic",
    "openai",
    "codex",
    "copilot",
    "gemini",
  ]);
  return {
    streaming: caps.supportsStreaming,
    toolCalls: caps.supportsToolCalling,
    vision: caps.supportsVision,
    cacheControl: cacheProviders.has(provider),
    thinking: caps.supportsThinking,
    computerUse: caps.supportsComputerUse,
  };
}

// ── Individual tests ────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - start };
}

async function runPing(adapter: ProviderAdapter): Promise<HealthCheckResult> {
  try {
    const { value, durationMs } = await timed(() => adapter.isAvailable());
    return {
      name: "ping",
      status: value ? "ok" : "fail",
      durationMs,
      detail: value ? "reachable" : "unreachable",
      ...(value ? {} : { error: "isAvailable() returned false" }),
    };
  } catch (e) {
    return {
      name: "ping",
      status: "fail",
      durationMs: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runListModels(adapter: ProviderAdapter): Promise<HealthCheckResult> {
  try {
    const { value, durationMs } = await timed(() => adapter.listModels());
    return {
      name: "list_models",
      status: value.length > 0 ? "ok" : "degraded",
      durationMs,
      detail: `${value.length} models`,
      ...(value.length === 0 ? { error: "empty model list" } : {}),
    };
  } catch (e) {
    return {
      name: "list_models",
      status: "fail",
      durationMs: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Consume an async generator of StreamChunks and collect terminal state.
 * Bounded by `timeoutMs` to prevent hung streams from blocking health checks.
 */
async function consumeStream(
  gen: AsyncGenerator<StreamChunk>,
  timeoutMs: number,
): Promise<{
  text: string;
  stopReason?: string;
  toolCallEmitted: boolean;
  error?: string;
  tokens: number;
}> {
  let text = "";
  let stopReason: string | undefined;
  let toolCallEmitted = false;
  let error: string | undefined;
  let tokens = 0;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`stream timeout after ${timeoutMs}ms`)), timeoutMs),
  );

  const consume = async (): Promise<void> => {
    for await (const chunk of gen) {
      if (chunk.type === "text") text += chunk.content;
      if (chunk.type === "tool_use") toolCallEmitted = true;
      if (chunk.type === "error") error = chunk.content;
      if (chunk.type === "done") {
        stopReason = chunk.stopReason;
        tokens = chunk.tokensUsed ?? 0;
      }
    }
  };

  await Promise.race([consume(), timeoutPromise]);
  return { text, stopReason, toolCallEmitted, error, tokens };
}

async function runSimpleQuery(
  adapter: ProviderAdapter,
  opts: HealthCheckOptions,
): Promise<HealthCheckResult> {
  const prompt = opts.prompt ?? "Reply with just the word 'ok'.";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const start = Date.now();
  try {
    const gen = adapter.query({
      prompt,
      maxTokens: 10,
      temperature: 0,
    });
    const result = await consumeStream(gen, timeoutMs);
    const durationMs = Date.now() - start;

    if (result.error) {
      return {
        name: "simple_query",
        status: "fail",
        durationMs,
        error: result.error,
      };
    }
    if (!result.text.trim()) {
      return {
        name: "simple_query",
        status: "degraded",
        durationMs,
        error: "empty response",
        detail: `stopReason=${result.stopReason ?? "none"}`,
      };
    }
    if (result.stopReason === undefined) {
      return {
        name: "simple_query",
        status: "degraded",
        durationMs,
        error: "missing stopReason on done chunk",
        detail: `text=${result.text.slice(0, 30)}`,
      };
    }
    return {
      name: "simple_query",
      status: "ok",
      durationMs,
      detail: `${result.tokens} tokens, stopReason=${result.stopReason}`,
    };
  } catch (e) {
    return {
      name: "simple_query",
      status: "fail",
      durationMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runToolCallTest(
  adapter: ProviderAdapter,
  opts: HealthCheckOptions,
): Promise<HealthCheckResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const tool: ToolSchema = {
    name: "get_time",
    description: "Returns the current UTC time as an ISO-8601 string.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  };
  const start = Date.now();
  try {
    const queryOpts: UnifiedQueryOptions = {
      prompt:
        "Call the get_time tool to get the current time. Do not respond with text — only call the tool.",
      maxTokens: 100,
      temperature: 0,
      tools: [tool],
    };
    const gen = adapter.query(queryOpts);
    const result = await consumeStream(gen, timeoutMs);
    const durationMs = Date.now() - start;

    if (result.error) {
      return {
        name: "tool_call",
        status: "fail",
        durationMs,
        error: result.error,
      };
    }
    if (!result.toolCallEmitted) {
      return {
        name: "tool_call",
        status: "degraded",
        durationMs,
        error: "no tool_use chunk emitted",
        detail: `text=${result.text.slice(0, 40)}`,
      };
    }
    // Bug #5 guard: when the model emits a tool call, the `done` chunk must
    // carry stopReason: "tool_calls" — otherwise the agent loop terminates
    // after one hop.
    if (result.stopReason !== "tool_calls") {
      return {
        name: "tool_call",
        status: "degraded",
        durationMs,
        error: `Bug #5 regression: stopReason=${result.stopReason ?? "none"} (expected tool_calls)`,
        detail: "tool_use emitted but done chunk reports wrong stopReason",
      };
    }
    return {
      name: "tool_call",
      status: "ok",
      durationMs,
      detail: "tool_use emitted + stopReason=tool_calls",
    };
  } catch (e) {
    return {
      name: "tool_call",
      status: "fail",
      durationMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Dry-run mode ────────────────────────────────────────────

/**
 * Produce a synthetic report from the static capability matrix without any
 * network calls. Used by `wotann health --dry-run` for offline audits.
 */
function dryRunReport(provider: ProviderName, caps: ProviderCapabilities): HealthReport {
  const tests: HealthCheckResult[] = [
    {
      name: "ping",
      status: "skipped",
      durationMs: 0,
      detail: "dry-run: skipped network reachability",
    },
    {
      name: "list_models",
      status: "skipped",
      durationMs: 0,
      detail: "dry-run: capability-matrix only",
    },
    {
      name: "simple_query",
      status: "skipped",
      durationMs: 0,
      detail: "dry-run: no network calls",
    },
  ];
  if (caps.supportsToolCalling) {
    tests.push({
      name: "tool_call",
      status: "skipped",
      durationMs: 0,
      detail: "dry-run: declared capability — live test needed to verify Bug #5 guard",
    });
  }
  return {
    provider,
    status: "skipped",
    durationMs: 0,
    capabilities: projectCapabilities(provider, caps),
    tests,
    generatedAt: new Date().toISOString(),
  };
}

// ── Orchestrator ────────────────────────────────────────────

/**
 * Aggregate a list of test results into the top-level report status.
 *   - any "fail" in ping / list_models / simple_query → "fail"
 *   - any "degraded" (and no fail) → "degraded"
 *   - all "ok" → "ok"
 *   - all "skipped" → "skipped" (dry-run)
 */
function rollUpStatus(tests: readonly HealthCheckResult[]): HealthStatus {
  if (tests.every((t) => t.status === "skipped")) return "skipped";
  const critical = tests.filter((t) => t.name !== "tool_call");
  if (critical.some((t) => t.status === "fail")) return "fail";
  if (tests.some((t) => t.status === "fail")) return "degraded";
  if (tests.some((t) => t.status === "degraded")) return "degraded";
  if (tests.every((t) => t.status === "ok")) return "ok";
  return "degraded";
}

/**
 * Run the full health-check battery for a single provider adapter.
 */
export async function runHealthCheck(
  provider: ProviderName,
  adapter: ProviderAdapter,
  opts: HealthCheckOptions = {},
): Promise<HealthReport> {
  const generatedAt = new Date().toISOString();
  const caps = adapter.capabilities;

  if (opts.dryRun) {
    return dryRunReport(provider, caps);
  }

  const start = Date.now();
  const tests: HealthCheckResult[] = [];

  // 1. Ping (cheap, always run).
  const ping = await runPing(adapter);
  tests.push(ping);

  // If ping fails and we have no cached adapter metadata, skip the rest —
  // running listModels / simple_query against an unreachable endpoint just
  // produces duplicate noise in the report.
  if (ping.status === "fail") {
    return {
      provider,
      status: "fail",
      durationMs: Date.now() - start,
      capabilities: projectCapabilities(provider, caps),
      tests,
      errors: [`ping failed: ${ping.error ?? "unreachable"}`],
      generatedAt,
    };
  }

  // 2. List models.
  tests.push(await runListModels(adapter));

  // 3. Simple query.
  tests.push(await runSimpleQuery(adapter, opts));

  // 4. Tool call (optional).
  if (caps.supportsToolCalling && !opts.skipToolCall) {
    tests.push(await runToolCallTest(adapter, opts));
  }

  const errors = tests
    .filter((t) => t.error !== undefined)
    .map((t) => `${t.name}: ${t.error ?? "unknown"}`);

  return {
    provider,
    status: rollUpStatus(tests),
    durationMs: Date.now() - start,
    capabilities: projectCapabilities(provider, caps),
    tests,
    ...(errors.length > 0 ? { errors } : {}),
    generatedAt,
  };
}

/**
 * Run health checks against a set of provider adapters. Runs all in parallel
 * (each adapter's tests are sequential internally, but different providers
 * don't block each other).
 */
export async function runHealthCheckBatch(
  adapters: ReadonlyMap<ProviderName, ProviderAdapter>,
  opts: HealthCheckOptions = {},
): Promise<readonly HealthReport[]> {
  const entries = [...adapters.entries()];
  return Promise.all(entries.map(([name, adapter]) => runHealthCheck(name, adapter, opts)));
}

// ── Declared capabilities for all 19 providers ──────────────

/**
 * Static capability matrix used by `--dry-run` mode when no real adapter
 * is instantiable (e.g. no env var, no daemon running).
 *
 * Each entry mirrors the `capabilities` struct inside createXxxAdapter().
 * If an adapter's capabilities drift, update this table too — the tests
 * in tests/providers/health-check.test.ts pin the expected shape.
 */
export const PROVIDER_CAPABILITY_MATRIX: Readonly<Record<ProviderName, ProviderCapabilities>> = {
  anthropic: {
    supportsComputerUse: true,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 200_000,
  },
  openai: {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 200_000,
  },
  codex: {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 200_000,
  },
  copilot: {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 128_000,
  },
  ollama: {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 256_000,
  },
  gemini: {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 2_000_000,
  },
  huggingface: {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 131_072,
  },
  openrouter: {
    supportsComputerUse: false,
    supportsToolCalling: true,
    // Vision is per-model on OpenRouter; treat the conservative default as
    // false since users may pick text-only models. Capability augmenter
    // upgrades this when a vision-capable model is selected.
    supportsVision: false,
    supportsStreaming: true,
    supportsThinking: false,
    maxContextWindow: 200_000,
  },
};

/**
 * Dry-run report for a provider that has no live adapter — used by
 * `wotann health --dry-run` to produce a full 19-provider report even
 * without any real credentials configured.
 */
export function dryRunReportForProvider(provider: ProviderName): HealthReport {
  return dryRunReport(provider, PROVIDER_CAPABILITY_MATRIX[provider]);
}
