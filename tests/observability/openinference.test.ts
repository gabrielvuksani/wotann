/**
 * Tier 12 T12.10 — OpenInference tracer tests.
 *
 * Covers span lifecycle, trace/span ID generation, parent-child linkage,
 * attribute mutation, status transitions, shutdown cleanup, and W3C
 * traceparent serialisation.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createOpenInferenceTracer,
  traceLlmCall,
  traceToolCall,
  parseTraceparent,
  toTraceparent,
  otelKindFor,
  OI_ATTR,
  type OpenInferenceSpan,
} from "../../src/observability/openinference.js";

// ── Helpers ──────────────────────────────────────────────

function deterministicIdSource() {
  let nTrace = 0;
  let nSpan = 0;
  return {
    traceId: () => `trace${String(nTrace++).padStart(27, "0")}`,
    spanId: () => `span${String(nSpan++).padStart(12, "0")}`,
  };
}

function fakeClock(start = 1_700_000_000_000, stepMs = 10) {
  let t = start;
  return () => {
    const v = t;
    t += stepMs;
    return v;
  };
}

// ── Span lifecycle ───────────────────────────────────────

describe("createOpenInferenceTracer — lifecycle", () => {
  it("creates spans with trace + span ids", () => {
    const tracer = createOpenInferenceTracer({
      idSource: deterministicIdSource(),
      now: fakeClock(),
    });
    const handle = tracer.startSpan({ name: "test", kind: "LLM" });
    expect(handle.traceId).toMatch(/^trace0+0$/);
    expect(handle.spanId).toMatch(/^span0+0$/);
    const span = tracer.endSpan(handle);
    expect(span).not.toBeNull();
    expect(span?.name).toBe("test");
    expect(span?.kind).toBe("CLIENT"); // LLM → CLIENT
  });

  it("endSpan is idempotent", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const handle = tracer.startSpan({ name: "test", kind: "TOOL" });
    const first = tracer.endSpan(handle);
    const second = tracer.endSpan(handle);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("sessionId is propagated to the span", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const handle = tracer.startSpan({
      name: "turn",
      kind: "AGENT",
      sessionId: "sess-123",
    });
    const span = tracer.endSpan(handle);
    expect(span?.sessionId).toBe("sess-123");
    const sessionAttr = span?.attributes.find((a) => a.key === OI_ATTR.SESSION_ID);
    expect(sessionAttr?.value).toBe("sess-123");
  });

  it("emits spans to onSpan listener", () => {
    const onSpan = vi.fn<(span: OpenInferenceSpan) => void>();
    const tracer = createOpenInferenceTracer({
      idSource: deterministicIdSource(),
      onSpan,
    });
    const handle = tracer.startSpan({ name: "test", kind: "LLM" });
    tracer.endSpan(handle);
    expect(onSpan).toHaveBeenCalledTimes(1);
    expect(onSpan.mock.calls[0]?.[0].name).toBe("test");
  });
});

// ── Parent-child linkage ─────────────────────────────────

describe("parent-child linkage", () => {
  it("children inherit traceId from parent", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const parent = tracer.startSpan({ name: "agent", kind: "AGENT" });
    const child = tracer.startSpan({ name: "llm", kind: "LLM", parent });
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.parentSpanId).toBe(parent.spanId);
    tracer.endSpan(child);
    tracer.endSpan(parent);
  });

  it("top-level spans get fresh trace ids", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const a = tracer.startSpan({ name: "a", kind: "AGENT" });
    const b = tracer.startSpan({ name: "b", kind: "AGENT" });
    expect(a.traceId).not.toBe(b.traceId);
    tracer.endSpan(a);
    tracer.endSpan(b);
  });
});

// ── Attributes + status ──────────────────────────────────

describe("attributes and status", () => {
  it("setAttribute replaces existing keys", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const handle = tracer.startSpan({
      name: "t",
      kind: "LLM",
      attributes: [{ key: "llm.model_name", value: "claude-sonnet" }],
    });
    tracer.setAttribute(handle, "llm.model_name", "claude-opus");
    const span = tracer.endSpan(handle);
    const modelAttrs = span?.attributes.filter((a) => a.key === "llm.model_name") ?? [];
    expect(modelAttrs.length).toBe(1);
    expect(modelAttrs[0]?.value).toBe("claude-opus");
  });

  it("setAttribute after endSpan is a no-op", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const handle = tracer.startSpan({ name: "t", kind: "LLM" });
    tracer.endSpan(handle);
    // Should NOT throw or mutate state.
    tracer.setAttribute(handle, "foo", "bar");
    // Snapshot still contains the original span unchanged.
    expect(tracer.snapshot()).toHaveLength(1);
  });

  it("setStatus lands on emitted span", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const handle = tracer.startSpan({ name: "t", kind: "LLM" });
    tracer.setStatus(handle, { code: "ERROR", message: "boom" });
    const span = tracer.endSpan(handle);
    expect(span?.status.code).toBe("ERROR");
    expect(span?.status.message).toBe("boom");
  });
});

// ── Buffer + snapshot ────────────────────────────────────

describe("buffer + snapshot", () => {
  it("snapshot returns frozen copy", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const h = tracer.startSpan({ name: "t", kind: "LLM" });
    tracer.endSpan(h);
    const snap = tracer.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => (snap as unknown as OpenInferenceSpan[]).push({} as OpenInferenceSpan)).toThrow();
  });

  it("drain clears the buffer", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    tracer.endSpan(tracer.startSpan({ name: "t", kind: "LLM" }));
    const drained = tracer.drain();
    expect(drained.length).toBe(1);
    expect(tracer.snapshot().length).toBe(0);
  });

  it("buffer drops oldest when maxBufferedSpans exceeded", () => {
    const dropped: string[] = [];
    const tracer = createOpenInferenceTracer({
      idSource: deterministicIdSource(),
      maxBufferedSpans: 2,
      onDropped: (r) => dropped.push(r),
    });
    tracer.endSpan(tracer.startSpan({ name: "a", kind: "LLM" }));
    tracer.endSpan(tracer.startSpan({ name: "b", kind: "LLM" }));
    tracer.endSpan(tracer.startSpan({ name: "c", kind: "LLM" }));
    const names = tracer.snapshot().map((s) => s.name);
    expect(names).toEqual(["b", "c"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain("name=a");
  });
});

// ── Shutdown ────────────────────────────────────────────

describe("shutdown", () => {
  it("ends in-flight spans on shutdown", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    tracer.startSpan({ name: "a", kind: "AGENT" });
    tracer.startSpan({ name: "b", kind: "LLM" });
    expect(tracer.snapshot().length).toBe(0); // neither ended yet
    tracer.shutdown();
    expect(tracer.snapshot().length).toBe(2);
  });

  it("rejects startSpan after shutdown", () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    tracer.shutdown();
    expect(() => tracer.startSpan({ name: "t", kind: "LLM" })).toThrow(/shut down/);
  });
});

// ── traceLlmCall helper ─────────────────────────────────

describe("traceLlmCall", () => {
  it("auto-captures model + provider + tokens on success", async () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const value = await traceLlmCall(tracer, {
      model: "claude-sonnet",
      provider: "anthropic",
      sessionId: "s1",
      run: async () => ({
        value: "hi",
        inputTokens: 100,
        outputTokens: 50,
      }),
    });
    expect(value).toBe("hi");
    const span = tracer.snapshot()[0];
    expect(span?.kind).toBe("CLIENT");
    expect(span?.attributes.find((a) => a.key === OI_ATTR.LLM_MODEL_NAME)?.value).toBe(
      "claude-sonnet",
    );
    expect(span?.attributes.find((a) => a.key === OI_ATTR.LLM_INPUT_TOKENS)?.value).toBe(100);
    expect(span?.attributes.find((a) => a.key === OI_ATTR.LLM_OUTPUT_TOKENS)?.value).toBe(50);
    expect(span?.attributes.find((a) => a.key === OI_ATTR.LLM_TOTAL_TOKENS)?.value).toBe(150);
    expect(span?.status.code).toBe("OK");
  });

  it("records error + rethrows on failure", async () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    await expect(
      traceLlmCall(tracer, {
        model: "x",
        provider: "y",
        run: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    const span = tracer.snapshot()[0];
    expect(span?.status.code).toBe("ERROR");
    expect(span?.attributes.find((a) => a.key === OI_ATTR.ERROR_MESSAGE)?.value).toBe("boom");
  });
});

// ── traceToolCall helper ─────────────────────────────────

describe("traceToolCall", () => {
  it("wraps tool calls with proper attrs", async () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const v = await traceToolCall(tracer, {
      toolName: "bash",
      parametersJson: '{"cmd": "ls"}',
      run: async () => "out",
    });
    expect(v).toBe("out");
    const span = tracer.snapshot()[0];
    expect(span?.kind).toBe("INTERNAL");
    expect(span?.attributes.find((a) => a.key === OI_ATTR.TOOL_NAME)?.value).toBe("bash");
    expect(span?.attributes.find((a) => a.key === OI_ATTR.TOOL_STATUS)?.value).toBe("success");
  });

  it("flags failure on throw", async () => {
    const tracer = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    await expect(
      traceToolCall(tracer, {
        toolName: "bash",
        run: async () => {
          throw new Error("tool-err");
        },
      }),
    ).rejects.toThrow();
    const span = tracer.snapshot()[0];
    expect(span?.attributes.find((a) => a.key === OI_ATTR.TOOL_STATUS)?.value).toBe("failure");
  });
});

// ── W3C traceparent ──────────────────────────────────────

describe("W3C traceparent", () => {
  it("toTraceparent formats correctly", () => {
    const tp = toTraceparent({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    });
    expect(tp).toBe(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`);
  });

  it("parseTraceparent accepts valid headers", () => {
    const parsed = parseTraceparent(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toBe("a".repeat(32));
    expect(parsed?.spanId).toBe("b".repeat(16));
    expect(parsed?.sampled).toBe(true);
  });

  it("parseTraceparent rejects malformed", () => {
    expect(parseTraceparent("")).toBeNull();
    expect(parseTraceparent("garbage")).toBeNull();
    expect(parseTraceparent("01-abc-def-00")).toBeNull(); // wrong version
    expect(parseTraceparent("00-abc-def-00")).toBeNull(); // wrong lengths
    expect(parseTraceparent(`00-${"z".repeat(32)}-${"b".repeat(16)}-01`)).toBeNull(); // non-hex
  });

  it("parseTraceparent surfaces sampled flag", () => {
    const sampled = parseTraceparent(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`);
    const unsampled = parseTraceparent(`00-${"a".repeat(32)}-${"b".repeat(16)}-00`);
    expect(sampled?.sampled).toBe(true);
    expect(unsampled?.sampled).toBe(false);
  });
});

// ── Kind mapping ────────────────────────────────────────

describe("otelKindFor", () => {
  it("maps all OpenInference kinds to OTEL kinds", () => {
    expect(otelKindFor("LLM")).toBe("CLIENT");
    expect(otelKindFor("EMBEDDING")).toBe("CLIENT");
    expect(otelKindFor("RETRIEVAL")).toBe("CLIENT");
    expect(otelKindFor("AGENT")).toBe("SERVER");
    expect(otelKindFor("TOOL")).toBe("INTERNAL");
    expect(otelKindFor("CHAIN")).toBe("INTERNAL");
  });
});

// ── Per-tracer isolation ────────────────────────────────

describe("per-tracer isolation", () => {
  it("two tracers do not share state", () => {
    const a = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    const b = createOpenInferenceTracer({ idSource: deterministicIdSource() });
    a.endSpan(a.startSpan({ name: "x", kind: "LLM" }));
    expect(a.snapshot().length).toBe(1);
    expect(b.snapshot().length).toBe(0);
  });
});
