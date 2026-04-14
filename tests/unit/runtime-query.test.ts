import { describe, expect, it, vi } from "vitest";
import { runRuntimeQuery } from "../../src/cli/runtime-query.js";
import type { RuntimeStatus } from "../../src/core/runtime.js";
import type { StreamChunk } from "../../src/providers/types.js";

describe("runRuntimeQuery", () => {
  function createStatus(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
    return {
      providers: [],
      activeProvider: "anthropic",
      hookCount: 14,
      middlewareLayers: 18,
      memoryEnabled: true,
      sessionId: "session-1",
      totalTokens: 0,
      totalCost: 0,
      currentMode: "default",
      traceEntries: 0,
      semanticIndexSize: 0,
      skillCount: 18,
      ...overrides,
    };
  }

  it("aggregates output and derives token/cost deltas from runtime status", async () => {
    const chunks: readonly StreamChunk[] = [
      { type: "text", content: "Hello ", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "text", content: "world", provider: "anthropic", model: "claude-sonnet-4-6", tokensUsed: 33 },
    ];
    const statuses = [
      createStatus({ totalTokens: 120, totalCost: 0.4 }),
      createStatus({ totalTokens: 153, totalCost: 0.46 }),
    ];

    const runtime = {
      getStatus: vi.fn(() => statuses.shift() ?? createStatus({ totalTokens: 153, totalCost: 0.46 })),
      query: vi.fn(async function* () {
        for (const chunk of chunks) yield chunk;
      }),
    };

    const textSink = vi.fn();
    const result = await runRuntimeQuery(runtime as never, { prompt: "hello" }, {
      onText: textSink,
    });

    expect(result.output).toBe("Hello world");
    expect(result.errors).toEqual([]);
    expect(result.tokensUsed).toBe(33);
    expect(result.costUsd).toBeCloseTo(0.06, 6);
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(textSink).toHaveBeenCalledTimes(2);
  });

  it("captures error chunks and falls back to chunk token usage when status delta is unchanged", async () => {
    const runtime = {
      getStatus: vi.fn(() => createStatus({ totalTokens: 10, totalCost: 0.02 })),
      query: vi.fn(async function* () {
        yield { type: "error", content: "No providers configured", provider: "anthropic" } satisfies StreamChunk;
        yield { type: "text", content: "partial", tokensUsed: 9, provider: "anthropic" } satisfies StreamChunk;
      }),
    };

    const errorSink = vi.fn();
    const result = await runRuntimeQuery(runtime as never, { prompt: "hello" }, {
      onError: errorSink,
    });

    expect(result.output).toBe("partial");
    expect(result.errors).toEqual(["No providers configured"]);
    expect(result.tokensUsed).toBe(9);
    expect(result.costUsd).toBe(0);
    expect(errorSink).toHaveBeenCalledTimes(1);
  });
});
