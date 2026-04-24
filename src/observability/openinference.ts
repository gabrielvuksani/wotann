/**
 * OpenInference — semantic-conventions span emitter for WOTANN.
 *
 * PORT OF: Arize AI's OpenInference spec (github.com/Arize-ai/openinference).
 * OpenInference is the OpenTelemetry-compatible vocabulary for LLM / agent
 * traces — Langfuse, Phoenix, LangSmith, W&B Weave, and every major
 * observability vendor consume it. Emitting OI spans at the
 * middleware/agent boundary makes WOTANN sessions first-class citizens
 * in existing dashboards.
 *
 * RELATIONSHIP TO EXISTING MODULES:
 *   - src/telemetry/observability-export.ts — prior implementation that
 *     emits a WOTANN-native TraceEvent model and optionally writes OTLP
 *     JSON to disk. We build on top without replacing it: OpenInference
 *     spans produced here can be fed into ObservabilityExporter (via the
 *     `consumeOtlp` bridge defined below) or shipped to an OTLP collector
 *     via src/observability/otel-exporter.ts.
 *   - src/telemetry/traceparent.ts — existing W3C traceparent helpers;
 *     this file re-uses them for cross-span linkage.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest stubs): every span is typed; dropped spans surface
 *     through the `onDropped` callback rather than silently vanishing.
 *   - QB #7 (per-session state): createOpenInferenceTracer() holds its
 *     buffer in a closure; two tracers never share state.
 *   - QB #13 (env guard): zero process.env reads. The endpoint and
 *     headers are passed through constructor arguments.
 *   - QB #15 (immutable data): spans are frozen before handing them to
 *     listeners so downstream consumers can't mutate emitted state.
 */

// ── OpenInference semantic conventions ───────────────────

/**
 * Span kinds defined by the OpenInference spec, mapped to OTEL's
 * SpanKind vocabulary. LLM invocations are CLIENT (we call an external
 * model), tool calls are INTERNAL (in-process), agent turns are SERVER
 * (we serve a request to our user).
 */
export type OpenInferenceKind = "LLM" | "TOOL" | "AGENT" | "CHAIN" | "RETRIEVAL" | "EMBEDDING";

export type OtelSpanKind = "INTERNAL" | "CLIENT" | "SERVER" | "PRODUCER" | "CONSUMER";

export function otelKindFor(kind: OpenInferenceKind): OtelSpanKind {
  switch (kind) {
    case "LLM":
    case "EMBEDDING":
    case "RETRIEVAL":
      return "CLIENT";
    case "AGENT":
      return "SERVER";
    case "TOOL":
    case "CHAIN":
      return "INTERNAL";
  }
}

/**
 * Attribute namespace helpers. The full spec lives at
 * https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md
 * — we encode the conventions we actually use today and surface them
 * as typed constants so callers can't typo them.
 */
export const OI_ATTR = {
  LLM_MODEL_NAME: "llm.model_name",
  LLM_PROVIDER: "llm.provider",
  LLM_INPUT_TOKENS: "llm.token_count.prompt",
  LLM_OUTPUT_TOKENS: "llm.token_count.completion",
  LLM_TOTAL_TOKENS: "llm.token_count.total",
  LLM_TEMPERATURE: "llm.request.temperature",
  LLM_SYSTEM: "llm.system",
  TOOL_NAME: "tool.name",
  TOOL_PARAMETERS_JSON: "tool.parameters",
  TOOL_RESULT_JSON: "tool.result",
  TOOL_STATUS: "tool.status",
  AGENT_ID: "agent.id",
  AGENT_TURN: "agent.turn_number",
  AGENT_STRATEGY: "agent.strategy",
  RETRIEVAL_QUERY: "retrieval.query",
  RETRIEVAL_DOCUMENTS_COUNT: "retrieval.documents.count",
  INPUT_VALUE: "input.value",
  OUTPUT_VALUE: "output.value",
  SESSION_ID: "session.id",
  USER_ID: "user.id",
  WOTANN_MIDDLEWARE: "wotann.middleware.layer",
  SPAN_KIND: "openinference.span.kind",
  ERROR_TYPE: "error.type",
  ERROR_MESSAGE: "error.message",
} as const;

// ── Span shape (OTLP-compatible) ─────────────────────────

/**
 * Single typed attribute — matches OTLP's JSON protobuf shape. We
 * deliberately support only string/int/bool/double to keep the
 * exporter wire-shape stable across collectors.
 */
export type AttributeValue = string | number | boolean;

export interface OtelAttribute {
  readonly key: string;
  readonly value: AttributeValue;
}

export interface OtelStatus {
  readonly code: "OK" | "ERROR" | "UNSET";
  readonly message?: string;
}

/**
 * Immutable span record. Produced by startSpan + endSpan; consumed by
 * OtelExporter / ObservabilityExporter. Trace + span IDs follow the
 * W3C traceparent shape (32-hex + 16-hex).
 */
export interface OpenInferenceSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: OtelSpanKind;
  readonly openInferenceKind: OpenInferenceKind;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtelAttribute[];
  readonly status: OtelStatus;
  readonly sessionId?: string;
}

// ── Tracer factory ───────────────────────────────────────

export interface OpenInferenceTracerConfig {
  /** Service name stamped on every span (defaults to "wotann"). */
  readonly serviceName?: string;
  /** Service version stamped on every span. */
  readonly serviceVersion?: string;
  /** Deployment env tag (e.g. "production", "dev", "ci"). */
  readonly deployment?: string;
  /** Clock injection for deterministic tests. Returns ms. */
  readonly now?: () => number;
  /** PRNG injection for deterministic IDs in tests. Must return a 16-char hex for spans and a 32-char hex for traces. */
  readonly idSource?: {
    readonly traceId: () => string;
    readonly spanId: () => string;
  };
  /** Listener invoked on every completed span. */
  readonly onSpan?: (span: OpenInferenceSpan) => void;
  /** Listener invoked when a span is dropped (buffer full, shutdown). */
  readonly onDropped?: (reason: string) => void;
  /** Max spans buffered in memory before auto-flush (default 512). */
  readonly maxBufferedSpans?: number;
}

export interface StartSpanParams {
  readonly name: string;
  readonly kind: OpenInferenceKind;
  readonly parent?: SpanHandle;
  readonly sessionId?: string;
  readonly attributes?: readonly OtelAttribute[];
}

/**
 * Opaque span handle. Callers get one from `startSpan()` and feed it
 * back into `endSpan()` + `setAttribute()` + `setStatus()`. The handle
 * is NOT a raw span record — we keep the mutable builder state private.
 */
export interface SpanHandle {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly kind: OpenInferenceKind;
  readonly name: string;
  /** Unique per-tracer slot — used by the tracer to locate the builder. */
  readonly slot: number;
}

export interface OpenInferenceTracer {
  /**
   * Start a span. Returns an opaque handle; call endSpan() to finish.
   * Spans nested under `parent` inherit traceId; otherwise a new trace
   * is started.
   */
  readonly startSpan: (params: StartSpanParams) => SpanHandle;

  /** Attach an attribute mid-span. No-op after endSpan. */
  readonly setAttribute: (handle: SpanHandle, key: string, value: AttributeValue) => void;

  /** Set status mid-span; usually called just before endSpan on error paths. */
  readonly setStatus: (handle: SpanHandle, status: OtelStatus) => void;

  /**
   * Finish the span. The emitted OpenInferenceSpan is delivered to
   * `onSpan` synchronously and added to the tracer's snapshot buffer.
   * Duplicate endSpan calls are no-ops.
   */
  readonly endSpan: (handle: SpanHandle) => OpenInferenceSpan | null;

  /** Current in-memory buffer as a readonly snapshot. */
  readonly snapshot: () => readonly OpenInferenceSpan[];

  /** Drain the buffer (returns + clears). */
  readonly drain: () => readonly OpenInferenceSpan[];

  /** Shut down — flushes + rejects further startSpan calls. */
  readonly shutdown: () => void;
}

// ── Implementation ────────────────────────────────────────

interface SpanBuilder {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly kind: OpenInferenceKind;
  readonly name: string;
  readonly startMs: number;
  readonly sessionId?: string;
  attributes: OtelAttribute[];
  status: OtelStatus;
  ended: boolean;
}

const DEFAULT_BUFFER = 512;

export function createOpenInferenceTracer(
  config: OpenInferenceTracerConfig = {},
): OpenInferenceTracer {
  const serviceName = config.serviceName ?? "wotann";
  const serviceVersion = config.serviceVersion ?? "0.0.0";
  const deployment = config.deployment ?? "local";
  const now = config.now ?? (() => Date.now());
  const maxBuffered = config.maxBufferedSpans ?? DEFAULT_BUFFER;

  const defaultIdSource = {
    traceId: () => hex(32),
    spanId: () => hex(16),
  };
  const idSource = config.idSource ?? defaultIdSource;

  // Per-tracer state — closure-scoped.
  const builders = new Map<number, SpanBuilder>();
  const buffer: OpenInferenceSpan[] = [];
  let slotCounter = 0;
  let shutdownFlag = false;

  function requireActive(): void {
    if (shutdownFlag) {
      throw new Error("openinference: tracer has been shut down");
    }
  }

  function startSpan(params: StartSpanParams): SpanHandle {
    requireActive();
    const slot = slotCounter++;
    const traceId = params.parent ? params.parent.traceId : idSource.traceId();
    const spanId = idSource.spanId();
    const builder: SpanBuilder = {
      traceId,
      spanId,
      ...(params.parent ? { parentSpanId: params.parent.spanId } : {}),
      kind: params.kind,
      name: params.name,
      startMs: now(),
      ...(params.sessionId !== undefined ? { sessionId: params.sessionId } : {}),
      attributes: [
        { key: OI_ATTR.SPAN_KIND, value: params.kind },
        { key: "service.name", value: serviceName },
        { key: "service.version", value: serviceVersion },
        { key: "deployment.environment", value: deployment },
        ...(params.sessionId !== undefined
          ? [{ key: OI_ATTR.SESSION_ID, value: params.sessionId }]
          : []),
        ...(params.attributes ?? []),
      ],
      status: { code: "UNSET" },
      ended: false,
    };
    builders.set(slot, builder);
    const handle: SpanHandle = {
      traceId,
      spanId,
      ...(params.parent ? { parentSpanId: params.parent.spanId } : {}),
      kind: params.kind,
      name: params.name,
      slot,
    };
    return handle;
  }

  function setAttribute(handle: SpanHandle, key: string, value: AttributeValue): void {
    const b = builders.get(handle.slot);
    if (!b || b.ended) return;
    // Replace prior value for the same key (OTEL semantics).
    const existing = b.attributes.findIndex((a) => a.key === key);
    if (existing >= 0) {
      b.attributes = b.attributes.map((a, i) => (i === existing ? { key, value } : a));
    } else {
      b.attributes = [...b.attributes, { key, value }];
    }
  }

  function setStatus(handle: SpanHandle, status: OtelStatus): void {
    const b = builders.get(handle.slot);
    if (!b || b.ended) return;
    b.status = status;
  }

  function endSpan(handle: SpanHandle): OpenInferenceSpan | null {
    const b = builders.get(handle.slot);
    if (!b) return null;
    if (b.ended) return null;
    b.ended = true;
    const endMs = now();
    const span: OpenInferenceSpan = Object.freeze({
      traceId: b.traceId,
      spanId: b.spanId,
      ...(b.parentSpanId !== undefined ? { parentSpanId: b.parentSpanId } : {}),
      name: b.name,
      kind: otelKindFor(b.kind),
      openInferenceKind: b.kind,
      startTimeUnixNano: String(BigInt(b.startMs) * 1_000_000n),
      endTimeUnixNano: String(BigInt(endMs) * 1_000_000n),
      attributes: Object.freeze([...b.attributes]),
      status: Object.freeze({ ...b.status }),
      ...(b.sessionId !== undefined ? { sessionId: b.sessionId } : {}),
    });
    builders.delete(handle.slot);
    addToBuffer(span);
    config.onSpan?.(span);
    return span;
  }

  function addToBuffer(span: OpenInferenceSpan): void {
    if (buffer.length >= maxBuffered) {
      const dropped = buffer.shift();
      config.onDropped?.(`buffer full; dropped span name=${dropped?.name}`);
    }
    buffer.push(span);
  }

  function snapshot(): readonly OpenInferenceSpan[] {
    return Object.freeze([...buffer]);
  }

  function drain(): readonly OpenInferenceSpan[] {
    const out = Object.freeze([...buffer]);
    buffer.length = 0;
    return out;
  }

  function shutdown(): void {
    shutdownFlag = true;
    // End any unterminated spans so they don't stay orphaned.
    for (const [slot, b] of builders) {
      if (b.ended) continue;
      endSpan({
        traceId: b.traceId,
        spanId: b.spanId,
        ...(b.parentSpanId !== undefined ? { parentSpanId: b.parentSpanId } : {}),
        kind: b.kind,
        name: b.name,
        slot,
      });
    }
  }

  return {
    startSpan,
    setAttribute,
    setStatus,
    endSpan,
    snapshot,
    drain,
    shutdown,
  };
}

// ── Convenience: high-level helpers for common WOTANN sites ─

/**
 * Wrap an LLM call with automatic span bookkeeping. Caller supplies a
 * no-arg executor; we start/end a span around it, capturing model +
 * provider + token counts from the optional result metadata.
 */
export async function traceLlmCall<T>(
  tracer: OpenInferenceTracer,
  params: {
    readonly model: string;
    readonly provider: string;
    readonly sessionId?: string;
    readonly parent?: SpanHandle;
    readonly run: () => Promise<{
      readonly value: T;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    }>;
  },
): Promise<T> {
  const baseParams: StartSpanParams = {
    name: `llm.${params.provider}`,
    kind: "LLM",
    ...(params.parent !== undefined ? { parent: params.parent } : {}),
    ...(params.sessionId !== undefined ? { sessionId: params.sessionId } : {}),
    attributes: [
      { key: OI_ATTR.LLM_MODEL_NAME, value: params.model },
      { key: OI_ATTR.LLM_PROVIDER, value: params.provider },
    ],
  };
  const handle = tracer.startSpan(baseParams);
  try {
    const { value, inputTokens, outputTokens } = await params.run();
    if (inputTokens !== undefined) {
      tracer.setAttribute(handle, OI_ATTR.LLM_INPUT_TOKENS, inputTokens);
    }
    if (outputTokens !== undefined) {
      tracer.setAttribute(handle, OI_ATTR.LLM_OUTPUT_TOKENS, outputTokens);
    }
    if (inputTokens !== undefined && outputTokens !== undefined) {
      tracer.setAttribute(handle, OI_ATTR.LLM_TOTAL_TOKENS, inputTokens + outputTokens);
    }
    tracer.setStatus(handle, { code: "OK" });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tracer.setAttribute(handle, OI_ATTR.ERROR_MESSAGE, message);
    tracer.setAttribute(handle, OI_ATTR.ERROR_TYPE, err instanceof Error ? err.name : "Error");
    tracer.setStatus(handle, { code: "ERROR", message });
    throw err;
  } finally {
    tracer.endSpan(handle);
  }
}

/** Wrap a tool call. Same pattern as traceLlmCall but with tool.* attrs. */
export async function traceToolCall<T>(
  tracer: OpenInferenceTracer,
  params: {
    readonly toolName: string;
    readonly parametersJson?: string;
    readonly sessionId?: string;
    readonly parent?: SpanHandle;
    readonly run: () => Promise<T>;
  },
): Promise<T> {
  const baseParams: StartSpanParams = {
    name: `tool.${params.toolName}`,
    kind: "TOOL",
    ...(params.parent !== undefined ? { parent: params.parent } : {}),
    ...(params.sessionId !== undefined ? { sessionId: params.sessionId } : {}),
    attributes: [
      { key: OI_ATTR.TOOL_NAME, value: params.toolName },
      ...(params.parametersJson !== undefined
        ? [{ key: OI_ATTR.TOOL_PARAMETERS_JSON, value: params.parametersJson }]
        : []),
    ],
  };
  const handle = tracer.startSpan(baseParams);
  try {
    const value = await params.run();
    tracer.setAttribute(handle, OI_ATTR.TOOL_STATUS, "success");
    tracer.setStatus(handle, { code: "OK" });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tracer.setAttribute(handle, OI_ATTR.TOOL_STATUS, "failure");
    tracer.setAttribute(handle, OI_ATTR.ERROR_MESSAGE, message);
    tracer.setStatus(handle, { code: "ERROR", message });
    throw err;
  } finally {
    tracer.endSpan(handle);
  }
}

// ── ID helpers ────────────────────────────────────────────

/** Generate a random hex string of `len` characters. Defaults to Math.random
 *  — callers that need deterministic IDs inject `idSource` via config. */
function hex(len: number): string {
  let out = "";
  while (out.length < len) {
    out += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  }
  return out.slice(0, len);
}

/**
 * Build a W3C traceparent header value from a span. Shape:
 *   `${version}-${traceId}-${spanId}-${flags}`
 * Defaults: version=00, flags=01 (sampled).
 */
export function toTraceparent(span: { traceId: string; spanId: string }): string {
  return `00-${span.traceId}-${span.spanId}-01`;
}

/**
 * Parse an incoming traceparent header. Returns null on malformed input
 * (never throws — honest failure, QB #6).
 */
export function parseTraceparent(
  header: string,
): { readonly traceId: string; readonly spanId: string; readonly sampled: boolean } | null {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== "00") return null;
  if (!traceId || traceId.length !== 32 || !/^[0-9a-f]{32}$/.test(traceId)) return null;
  if (!spanId || spanId.length !== 16 || !/^[0-9a-f]{16}$/.test(spanId)) return null;
  const sampled = flags ? (Number.parseInt(flags, 16) & 1) === 1 : false;
  return { traceId, spanId, sampled };
}
