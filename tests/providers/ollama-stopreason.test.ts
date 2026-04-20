/**
 * Ollama `done: true` chunk stopReason regression — P0-4a.
 *
 * The Ollama adapter's terminal chunk must emit the canonical
 * StopReason that the rest of the harness expects ("stop",
 * "tool_calls", "max_tokens", "content_filter", "error"). Any
 * provider-native token like "end_turn" or "length" would break the
 * agent loop: the loop keys on "tool_calls" to keep going, on
 * "max_tokens" to escalate to a bigger model, and on "stop" to
 * finish — a non-canonical value silently terminates the loop or
 * loops forever.
 *
 * These tests lock the emitted stopReason across the four scenarios
 * the adapter has to handle:
 *
 *   1. plain-text turn (no tools, no truncation)            → "stop"
 *   2. tool_calls fire                                      → "tool_calls"
 *   3. max tokens reached                                   → "stop"   (pending §78-6)
 *   4. `done_reason` field is present on newer Ollama 0.5+  → canonical
 *
 * Scenario 4 is the hardening piece: older Ollama (≤0.4) only emitted
 * `done: true`; newer builds report `done_reason: "load" | "stop" |
 * "length"`. The adapter must translate those to the canonical set
 * so the runtime treats each case uniformly across versions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOllamaAdapter } from "../../src/providers/ollama-adapter.js";
import type { UnifiedQueryOptions } from "../../src/providers/types.js";

function mockNdjsonStream(lines: string[]): void {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
      controller.close();
    },
  });
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body,
  } as unknown as Response);
}

describe("ollama: canonical stopReason on the done chunk", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function runAndGetDone(opts: UnifiedQueryOptions): Promise<{
    stopReason: string | undefined;
    type: string | undefined;
  }> {
    const adapter = createOllamaAdapter("http://localhost:11434");
    let stopReason: string | undefined;
    let type: string | undefined;
    for await (const chunk of adapter.query(opts)) {
      if (chunk.type === "done") {
        stopReason = chunk.stopReason;
        type = chunk.type;
      }
    }
    return { stopReason, type };
  }

  it("emits stopReason='stop' for a plain-text turn with no tool_calls", async () => {
    mockNdjsonStream([
      JSON.stringify({ message: { role: "assistant", content: "hello" }, done: false }),
      JSON.stringify({
        message: { role: "assistant", content: " world" },
        done: true,
        eval_count: 2,
        prompt_eval_count: 3,
      }),
    ]);
    const result = await runAndGetDone({ prompt: "hi", model: "qwen3.5" });
    expect(result.type).toBe("done");
    expect(result.stopReason).toBe("stop");
    // Must be one of the canonical values.
    expect(["stop", "tool_calls", "max_tokens", "content_filter", "error"]).toContain(
      result.stopReason,
    );
  });

  it("emits stopReason='tool_calls' when the model produces tool calls", async () => {
    mockNdjsonStream([
      JSON.stringify({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "t", arguments: {} } }],
        },
        done: false,
      }),
      JSON.stringify({
        message: { role: "assistant", content: "" },
        done: true,
        eval_count: 5,
        prompt_eval_count: 10,
      }),
    ]);
    const result = await runAndGetDone({
      prompt: "use tool",
      model: "qwen3.5",
      tools: [
        {
          name: "t",
          description: "d",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
    });
    expect(result.stopReason).toBe("tool_calls");
  });

  it("translates Ollama 0.5+ done_reason='length' to canonical 'max_tokens'", async () => {
    // Newer Ollama reports the reason for termination via `done_reason`.
    // Without translation, a caller querying for `stopReason === "max_tokens"`
    // misses the truncation case and silently keeps retrying with the
    // same budget.
    mockNdjsonStream([
      JSON.stringify({ message: { role: "assistant", content: "truncated" }, done: false }),
      JSON.stringify({
        message: { role: "assistant", content: "..." },
        done: true,
        done_reason: "length",
        eval_count: 4096,
        prompt_eval_count: 100,
      }),
    ]);
    const result = await runAndGetDone({ prompt: "long", model: "qwen3.5" });
    expect(result.stopReason).toBe("max_tokens");
  });

  it("translates Ollama 0.5+ done_reason='stop' to canonical 'stop'", async () => {
    // The baseline — done_reason=stop plus no tool calls must remain
    // the canonical "stop".
    mockNdjsonStream([
      JSON.stringify({ message: { role: "assistant", content: "done" }, done: false }),
      JSON.stringify({
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "stop",
        eval_count: 2,
        prompt_eval_count: 3,
      }),
    ]);
    const result = await runAndGetDone({ prompt: "hi", model: "qwen3.5" });
    expect(result.stopReason).toBe("stop");
  });

  it("prefers tool_calls over done_reason when both signals disagree", async () => {
    // Edge case: done_reason='stop' but a tool_call landed this turn.
    // The runtime must see tool_calls — otherwise the agent loop
    // thinks the turn is final and drops the pending tool execution.
    mockNdjsonStream([
      JSON.stringify({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "t", arguments: {} } }],
        },
        done: false,
      }),
      JSON.stringify({
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "stop",
        eval_count: 5,
        prompt_eval_count: 10,
      }),
    ]);
    const result = await runAndGetDone({
      prompt: "use tool",
      model: "qwen3.5",
      tools: [
        {
          name: "t",
          description: "d",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
    });
    expect(result.stopReason).toBe("tool_calls");
  });

  it("defaults to 'stop' when the stream ends without an explicit done_reason", async () => {
    // Older Ollama only sets `done: true` — no `done_reason`.
    // The adapter must fall back to "stop" canonically rather than
    // leaving stopReason undefined (which breaks downstream branching).
    mockNdjsonStream([
      JSON.stringify({ message: { role: "assistant", content: "hi" }, done: false }),
      JSON.stringify({
        message: { role: "assistant", content: "" },
        done: true,
        eval_count: 1,
        prompt_eval_count: 2,
      }),
    ]);
    const result = await runAndGetDone({ prompt: "hi", model: "qwen3.5" });
    expect(result.stopReason).toBe("stop");
  });
});
