import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runHealthCheck,
  runHealthCheckBatch,
  PROVIDER_CAPABILITY_MATRIX,
  dryRunReportForProvider,
} from "../../src/providers/health-check.js";
import { createOllamaAdapter } from "../../src/providers/ollama-adapter.js";
import type { ProviderAdapter, StreamChunk } from "../../src/providers/types.js";
import type { ProviderName } from "../../src/core/types.js";

/**
 * Phase 6 — per-provider health-check smoke-test battery.
 *
 * The health-check module orchestrates four tests per provider adapter:
 *
 *   1. ping         — adapter.isAvailable()
 *   2. list_models  — adapter.listModels()
 *   3. simple_query — minimal prompt round-trip
 *   4. tool_call    — (conditional) checks Bug #5 stopReason guard
 *
 * These tests mock the adapter directly rather than hitting real provider
 * endpoints so CI can run the full battery offline. The Ollama-specific
 * tests also inject fixture HTTP responses against the real ollama-adapter
 * to pin Bug #5 (the missing `stopReason: "tool_calls"` on tool-use turns).
 */

// ── Helpers ────────────────────────────────────────────────

async function* gen(chunks: readonly StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const c of chunks) yield c;
}

function mockAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: "mock",
    name: "anthropic",
    transport: "anthropic",
    capabilities: {
      supportsComputerUse: false,
      supportsToolCalling: true,
      supportsVision: false,
      supportsStreaming: true,
      supportsThinking: false,
      maxContextWindow: 200_000,
    },
    isAvailable: async () => true,
    listModels: async () => ["model-a", "model-b"],
    // Default query shape: responds well to both simple_query (text + stop)
    // and tool_call (tool_use + stopReason: tool_calls) so the battery
    // returns "ok" unless a test overrides with a specific failure mode.
    query: (opts) => {
      if (opts.tools && opts.tools.length > 0) {
        return gen([
          {
            type: "tool_use",
            content: "{}",
            toolName: "get_time",
            toolInput: {},
            provider: "anthropic",
            model: "model-a",
          },
          {
            type: "done",
            content: "",
            provider: "anthropic",
            model: "model-a",
            tokensUsed: 5,
            stopReason: "tool_calls",
          },
        ]);
      }
      return gen([
        { type: "text", content: "ok", provider: "anthropic", model: "model-a" },
        {
          type: "done",
          content: "",
          provider: "anthropic",
          model: "model-a",
          tokensUsed: 1,
          stopReason: "stop",
        },
      ]);
    },
    ...overrides,
  };
}

// ── Tests: ping ────────────────────────────────────────────

describe("runHealthCheck: ping", () => {
  it("returns fail when isAvailable() is false", async () => {
    const adapter = mockAdapter({ isAvailable: async () => false });
    const report = await runHealthCheck("anthropic", adapter);
    const ping = report.tests.find((t) => t.name === "ping");
    expect(ping?.status).toBe("fail");
    expect(report.status).toBe("fail");
    // When ping fails, the rest of the battery is skipped — the orchestrator
    // returns early with just the ping result.
    expect(report.tests).toHaveLength(1);
  });

  it("returns ok when isAvailable() resolves true", async () => {
    const adapter = mockAdapter();
    const report = await runHealthCheck("anthropic", adapter);
    const ping = report.tests.find((t) => t.name === "ping");
    expect(ping?.status).toBe("ok");
  });

  it("returns fail when isAvailable() throws", async () => {
    const adapter = mockAdapter({
      isAvailable: async () => {
        throw new Error("network unreachable");
      },
    });
    const report = await runHealthCheck("anthropic", adapter);
    const ping = report.tests.find((t) => t.name === "ping");
    expect(ping?.status).toBe("fail");
    expect(ping?.error).toContain("network unreachable");
  });
});

// ── Tests: list_models ─────────────────────────────────────

describe("runHealthCheck: list_models", () => {
  it("ok when the list is non-empty", async () => {
    const report = await runHealthCheck("anthropic", mockAdapter());
    const list = report.tests.find((t) => t.name === "list_models");
    expect(list?.status).toBe("ok");
    expect(list?.detail).toContain("2 models");
  });

  it("degraded when the list is empty (adapter online, no models)", async () => {
    const adapter = mockAdapter({ listModels: async () => [] });
    const report = await runHealthCheck("anthropic", adapter);
    const list = report.tests.find((t) => t.name === "list_models");
    expect(list?.status).toBe("degraded");
    expect(report.status).toBe("degraded");
  });
});

// ── Tests: simple_query ────────────────────────────────────

describe("runHealthCheck: simple_query", () => {
  it("ok when the stream yields text + stopReason", async () => {
    const report = await runHealthCheck("anthropic", mockAdapter());
    const sq = report.tests.find((t) => t.name === "simple_query");
    expect(sq?.status).toBe("ok");
    expect(sq?.detail).toContain("stopReason=stop");
  });

  it("fail when the stream yields an error chunk", async () => {
    const adapter = mockAdapter({
      query: () =>
        gen([{ type: "error", content: "401 Unauthorized", provider: "anthropic" }]),
    });
    const report = await runHealthCheck("anthropic", adapter);
    const sq = report.tests.find((t) => t.name === "simple_query");
    expect(sq?.status).toBe("fail");
    expect(sq?.error).toContain("401");
  });

  it("degraded when the done chunk lacks stopReason", async () => {
    const adapter = mockAdapter({
      query: () =>
        gen([
          { type: "text", content: "ok", provider: "anthropic" },
          { type: "done", content: "", provider: "anthropic", tokensUsed: 1 },
        ]),
    });
    const report = await runHealthCheck("anthropic", adapter);
    const sq = report.tests.find((t) => t.name === "simple_query");
    expect(sq?.status).toBe("degraded");
    expect(sq?.error).toContain("missing stopReason");
  });
});

// ── Tests: tool_call + Bug #5 regression ───────────────────

describe("runHealthCheck: tool_call (Bug #5 guard)", () => {
  it("ok when tool_use chunk fires + done.stopReason === tool_calls", async () => {
    // The mock must switch shape based on whether tools were passed:
    //   - simple_query (no tools) → text response with stopReason: "stop"
    //   - tool_call (has tools)   → tool_use + stopReason: "tool_calls"
    const adapter = mockAdapter({
      query: (opts) => {
        if (opts.tools && opts.tools.length > 0) {
          return gen([
            {
              type: "tool_use",
              content: "{}",
              toolName: "get_time",
              toolInput: {},
              provider: "anthropic",
            },
            {
              type: "done",
              content: "",
              provider: "anthropic",
              stopReason: "tool_calls",
              tokensUsed: 5,
            },
          ]);
        }
        return gen([
          { type: "text", content: "ok", provider: "anthropic" },
          {
            type: "done",
            content: "",
            provider: "anthropic",
            stopReason: "stop",
            tokensUsed: 1,
          },
        ]);
      },
    });
    const report = await runHealthCheck("anthropic", adapter);
    const tc = report.tests.find((t) => t.name === "tool_call");
    expect(tc?.status).toBe("ok");
    expect(report.status).toBe("ok");
  });

  it("degraded (Bug #5 regression) when tool_use fires but stopReason is wrong", async () => {
    // This is the EXACT shape the pre-55b68ff Ollama adapter produced.
    // Flagging this as degraded — not ok — was the whole point of the fix.
    const adapter = mockAdapter({
      query: (opts) => {
        if (opts.tools && opts.tools.length > 0) {
          return gen([
            {
              type: "tool_use",
              content: "{}",
              toolName: "get_time",
              toolInput: {},
              provider: "ollama",
            },
            {
              type: "done",
              content: "",
              provider: "ollama",
              stopReason: "stop", // ← Bug #5: should be "tool_calls"
              tokensUsed: 5,
            },
          ]);
        }
        return gen([
          { type: "text", content: "ok", provider: "ollama" },
          {
            type: "done",
            content: "",
            provider: "ollama",
            stopReason: "stop",
            tokensUsed: 1,
          },
        ]);
      },
    });
    const report = await runHealthCheck("ollama", adapter);
    const tc = report.tests.find((t) => t.name === "tool_call");
    expect(tc?.status).toBe("degraded");
    expect(tc?.error).toContain("Bug #5 regression");
    expect(tc?.error).toContain("expected tool_calls");
    // Overall report status is degraded, not ok.
    expect(report.status).toBe("degraded");
  });

  it("degraded when no tool_use chunk was emitted at all", async () => {
    const adapter = mockAdapter({
      query: () =>
        gen([
          { type: "text", content: "I cannot call tools.", provider: "anthropic" },
          { type: "done", content: "", provider: "anthropic", stopReason: "stop" },
        ]),
    });
    const report = await runHealthCheck("anthropic", adapter);
    const tc = report.tests.find((t) => t.name === "tool_call");
    expect(tc?.status).toBe("degraded");
    expect(tc?.error).toContain("no tool_use chunk");
  });

  it("skipped when the adapter does not declare supportsToolCalling", async () => {
    const adapter = mockAdapter({
      capabilities: {
        ...mockAdapter().capabilities,
        supportsToolCalling: false,
      },
    });
    const report = await runHealthCheck("anthropic", adapter);
    // tool_call test is omitted entirely — not even present in the report.
    const tc = report.tests.find((t) => t.name === "tool_call");
    expect(tc).toBeUndefined();
  });

  it("skipped when caller sets skipToolCall: true", async () => {
    const report = await runHealthCheck("anthropic", mockAdapter(), { skipToolCall: true });
    const tc = report.tests.find((t) => t.name === "tool_call");
    expect(tc).toBeUndefined();
  });
});

// ── Tests: Ollama adapter live-fixture (Bug #5 pinned on the real adapter) ─

describe("ollama-adapter: Bug #5 stopReason=tool_calls on tool-use turns", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("emits stopReason: 'tool_calls' in the done chunk when tool_calls fire", async () => {
    // Mock an Ollama NDJSON stream where the model calls a tool mid-stream.
    // The adapter must:
    //   1. Yield a tool_use chunk for the tool call.
    //   2. In the terminal `done` chunk, set stopReason: "tool_calls"
    //      (NOT "stop" — that was Bug #5).
    const ndjson = [
      JSON.stringify({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "get_time", arguments: {} } }],
        },
        done: false,
      }),
      JSON.stringify({
        message: { role: "assistant", content: "" },
        done: true,
        eval_count: 5,
        prompt_eval_count: 10,
      }),
      "",
    ].join("\n");

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ndjson));
          controller.close();
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });

    // SB-NEW-2 (QB#15): adapter no longer hardcodes a fallback model. Pass
    // a test model explicitly so the test exercises the stopReason logic
    // independent of which model is "default".
    const adapter = createOllamaAdapter("http://localhost:11434");
    let emittedToolUse = false;
    let doneStopReason: string | undefined;
    for await (const chunk of adapter.query({
      model: "test-model",
      prompt: "get the time",
      tools: [
        {
          name: "get_time",
          description: "get the current time",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
    })) {
      if (chunk.type === "tool_use") emittedToolUse = true;
      if (chunk.type === "done") doneStopReason = chunk.stopReason;
    }

    expect(emittedToolUse).toBe(true);
    // ⚠ If this flips to "stop", Bug #5 has regressed.
    expect(doneStopReason).toBe("tool_calls");
  });

  it("emits stopReason: 'stop' when NO tool_calls fire (regression guard)", async () => {
    // Plain-text Ollama stream — no tool calls. The terminal chunk must
    // report stopReason: "stop" (not "tool_calls"); the previous fix must
    // not have inverted the condition.
    const ndjson = [
      JSON.stringify({ message: { role: "assistant", content: "hi " }, done: false }),
      JSON.stringify({
        message: { role: "assistant", content: "there" },
        done: true,
        eval_count: 2,
        prompt_eval_count: 3,
      }),
      "",
    ].join("\n");

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ndjson));
          controller.close();
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });

    // SB-NEW-2 (QB#15): adapter no longer hardcodes a fallback model. Pass
    // a test model explicitly so the test exercises the stopReason logic
    // independent of which model is "default".
    const adapter = createOllamaAdapter("http://localhost:11434");
    let doneStopReason: string | undefined;
    for await (const chunk of adapter.query({ model: "test-model", prompt: "hi" })) {
      if (chunk.type === "done") doneStopReason = chunk.stopReason;
    }
    expect(doneStopReason).toBe("stop");
  });
});

// ── Tests: dry-run mode ────────────────────────────────────

describe("runHealthCheck: dry-run", () => {
  it("returns a skipped report without hitting the network", async () => {
    const adapter = mockAdapter({
      isAvailable: async () => {
        throw new Error("should not be called");
      },
      query: () => {
        throw new Error("should not be called");
      },
    });
    const report = await runHealthCheck("anthropic", adapter, { dryRun: true });
    expect(report.status).toBe("skipped");
    expect(report.tests.every((t) => t.status === "skipped")).toBe(true);
  });

  it("includes a tool_call test in the dry-run report when capabilities declare toolCalling", async () => {
    const adapter = mockAdapter();
    const report = await runHealthCheck("anthropic", adapter, { dryRun: true });
    expect(report.tests.find((t) => t.name === "tool_call")).toBeDefined();
  });

  it("dryRunReportForProvider builds a report from the static capability matrix", () => {
    const report = dryRunReportForProvider("ollama");
    expect(report.provider).toBe("ollama");
    expect(report.status).toBe("skipped");
    expect(report.capabilities.toolCalls).toBe(true);
    expect(report.capabilities.streaming).toBe(true);
  });
});

// ── Tests: capability projection + cacheControl ────────────

describe("runHealthCheck: capability projection", () => {
  it("reports cacheControl=true for anthropic, openai, codex, copilot, gemini", async () => {
    const cacheProviders: readonly ProviderName[] = [
      "anthropic",
      "openai",
      "codex",
      "copilot",
      "gemini",
    ];
    for (const p of cacheProviders) {
      const report = await runHealthCheck(p, mockAdapter(), { dryRun: true });
      expect(report.capabilities.cacheControl).toBe(true);
    }
  });

  it("reports cacheControl=false for providers without prompt-cache wiring", async () => {
    // Provider consolidation: dropped the 13 long-tail providers that
    // had no prompt-cache wiring. The remaining cache-less first-class
    // providers are ollama (local, no cache layer) and huggingface
    // (router shape, cache-pass-through not implemented).
    const noCacheProviders: readonly ProviderName[] = [
      "ollama",
      "huggingface",
    ];
    for (const p of noCacheProviders) {
      const report = await runHealthCheck(p, mockAdapter(), { dryRun: true });
      expect(report.capabilities.cacheControl).toBe(false);
    }
  });
});

// ── Tests: PROVIDER_CAPABILITY_MATRIX pins all 8 first-class providers ─

describe("PROVIDER_CAPABILITY_MATRIX", () => {
  it("declares all 8 ProviderName values", () => {
    // Provider consolidation: 21 → 8 first-class entries. The matrix
    // mirrors src/core/types.ts so future additions can't slip through.
    const names: readonly ProviderName[] = [
      "anthropic",
      "openai",
      "codex",
      "copilot",
      "ollama",
      "gemini",
      "huggingface",
      "openrouter",
    ];
    for (const n of names) {
      expect(PROVIDER_CAPABILITY_MATRIX[n]).toBeDefined();
      expect(typeof PROVIDER_CAPABILITY_MATRIX[n].supportsStreaming).toBe("boolean");
    }
    expect(Object.keys(PROVIDER_CAPABILITY_MATRIX)).toHaveLength(8);
  });

  it("every provider declares supportsToolCalling=true (Phase 6 coverage)", () => {
    for (const [name, caps] of Object.entries(PROVIDER_CAPABILITY_MATRIX)) {
      expect(caps.supportsToolCalling, `${name} should claim toolCalling`).toBe(true);
    }
  });
});

// ── Tests: batch mode ──────────────────────────────────────

describe("runHealthCheckBatch", () => {
  it("runs health checks for every adapter in the map", async () => {
    const adapters = new Map<ProviderName, ProviderAdapter>([
      ["anthropic", mockAdapter()],
      ["openai", mockAdapter({ isAvailable: async () => false })],
    ]);
    const reports = await runHealthCheckBatch(adapters);
    expect(reports).toHaveLength(2);
    const anthropic = reports.find((r) => r.provider === "anthropic");
    const openai = reports.find((r) => r.provider === "openai");
    expect(anthropic?.status).toBe("ok");
    expect(openai?.status).toBe("fail");
  });
});

// ── Tests: simple_query timeout ────────────────────────────

describe("runHealthCheck: timeout", () => {
  it("reports fail when the stream hangs past timeoutMs", async () => {
    const adapter = mockAdapter({
      query: () =>
        (async function* () {
          // Simulate a hung stream: first chunk arrives, then nothing
          // for longer than the configured timeout.
          yield { type: "text", content: "hi", provider: "anthropic" } as StreamChunk;
          await new Promise<never>(() => {
            /* never resolves */
          });
        })(),
    });
    const report = await runHealthCheck("anthropic", adapter, { timeoutMs: 50 });
    const sq = report.tests.find((t) => t.name === "simple_query");
    expect(sq?.status).toBe("fail");
    expect(sq?.error).toContain("timeout");
  });
});

// ── Tests: rollup status precedence ────────────────────────

describe("runHealthCheck: status rollup", () => {
  beforeEach(() => {
    // nothing to set up
  });

  it("fails overall when any critical test fails", async () => {
    const adapter = mockAdapter({
      listModels: async () => {
        throw new Error("boom");
      },
    });
    const report = await runHealthCheck("anthropic", adapter);
    expect(report.status).toBe("fail");
    expect(report.errors?.some((e) => e.includes("boom"))).toBe(true);
  });

  it("downgrades to degraded when tool_call fails but critical tests pass", async () => {
    // simple_query returns ok, tool_call returns degraded (Bug #5 style) —
    // overall is degraded, not fail.
    const adapter = mockAdapter({
      query: (opts) => {
        if (opts.tools && opts.tools.length > 0) {
          return gen([
            {
              type: "tool_use",
              content: "{}",
              toolName: "get_time",
              toolInput: {},
              provider: "anthropic",
            },
            // Missing stopReason="tool_calls" → Bug #5 regression path.
            { type: "done", content: "", provider: "anthropic", stopReason: "stop" },
          ]);
        }
        return gen([
          { type: "text", content: "ok", provider: "anthropic" },
          { type: "done", content: "", provider: "anthropic", stopReason: "stop" },
        ]);
      },
    });
    const report = await runHealthCheck("anthropic", adapter);
    expect(report.status).toBe("degraded");
  });
});
