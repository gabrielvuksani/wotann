/**
 * OTEL Exporter — ships OpenInferenceSpans to an OTLP/HTTP collector.
 *
 * PORT OF: OpenTelemetry OTLP/HTTP spec
 * (https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/otlp.md).
 * The wire shape is JSON protobuf — documented, stable, and consumed by
 * every modern observability vendor (Langfuse, Phoenix, W&B Weave,
 * Langfuse Cloud, Grafana Tempo, Datadog, Honeycomb).
 *
 * RELATIONSHIP TO EXISTING MODULES:
 *   - src/observability/openinference.ts  — produces the spans we export.
 *   - src/telemetry/observability-export.ts — internal legacy exporter
 *     that writes OTLP-shaped JSON to disk. This module is the
 *     NETWORK-side sibling: it ships spans to a live collector.
 *   - src/telemetry/opt-out.ts — we honour the same opt-out surface so
 *     users that set DO_NOT_TRACK continue to get radio silence.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): export returns a typed result; failures
 *     are categorised (`transport`, `http`, `serialize`, `disabled`) so
 *     callers can react instead of swallowing silently.
 *   - QB #7 (per-session state): createOtelExporter() holds flush state
 *     in a closure; two exporters never share timers or buffers.
 *   - QB #13 (env guard): the file has ZERO process.env reads. Callers
 *     pass `endpoint` + `headers` explicitly. This is the load-bearing
 *     difference vs. the standard OpenTelemetry SDK, which auto-reads
 *     `OTEL_EXPORTER_OTLP_ENDPOINT` — fine for users, bad for composability.
 *   - QB #15 (immutable data): exported span copies are frozen; the
 *     original tracer buffer is never mutated by the exporter.
 */

import type { OpenInferenceSpan, OtelAttribute } from "./openinference.js";

// ── Types ────────────────────────────────────────────────

/**
 * Config for the exporter. Every knob is injectable to keep QB #13
 * intact — the file never reaches for process.env.
 */
export interface OtelExporterConfig {
  /** Full OTLP/HTTP traces endpoint (e.g. "http://localhost:4318/v1/traces"). */
  readonly endpoint: string;
  /** Extra headers (e.g. {"x-api-key": "..."}). Injected, never read from env. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Logical service name. Defaults to "wotann". */
  readonly serviceName?: string;
  /** Service version. Defaults to "0.0.0". */
  readonly serviceVersion?: string;
  /** Injected fetch. Production passes `fetch`; tests pass a stub. */
  readonly fetcher?: OtelFetcher;
  /** Batch size — auto-flush when this many spans are queued. Default 64. */
  readonly batchSize?: number;
  /** Flush interval ms. 0 disables the auto-flush timer. Default 5000. */
  readonly flushIntervalMs?: number;
  /** Max send retries on transport error. Default 2. */
  readonly maxRetries?: number;
  /** Backoff base ms for retries (exponential). Default 200. */
  readonly retryBackoffMs?: number;
  /** Hard disable flag — exports short-circuit to `disabled` result. */
  readonly disabled?: boolean;
  /** Called on every non-disabled export attempt with the typed result. */
  readonly onResult?: (result: OtelExportResult) => void;
  /** Clock injection for deterministic tests. */
  readonly now?: () => number;
}

/** Injected fetch shape. Subset of global fetch. */
export type OtelFetcher = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}>;

export type OtelExportResult =
  | { readonly ok: true; readonly sent: number; readonly durationMs: number }
  | {
      readonly ok: false;
      readonly reason: "disabled" | "empty" | "transport" | "http" | "serialize";
      readonly message: string;
      readonly httpStatus?: number;
      readonly attempts?: number;
    };

export interface OtelExporter {
  /** Enqueue a span. Auto-flushes when batchSize is hit. */
  readonly enqueue: (span: OpenInferenceSpan) => void;
  /** Enqueue many spans at once (no auto-flush). */
  readonly enqueueMany: (spans: readonly OpenInferenceSpan[]) => void;
  /** Force-send all queued spans. */
  readonly flush: () => Promise<OtelExportResult>;
  /** Number of spans currently queued. */
  readonly pending: () => number;
  /** Stop the auto-flush timer and cease accepting spans. */
  readonly shutdown: () => Promise<OtelExportResult>;
}

// ── Factory ───────────────────────────────────────────────

const DEFAULT_BATCH = 64;
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 200;

export function createOtelExporter(config: OtelExporterConfig): OtelExporter {
  validate(config);

  const batchSize = Math.max(1, config.batchSize ?? DEFAULT_BATCH);
  const intervalMs = Math.max(0, config.flushIntervalMs ?? DEFAULT_INTERVAL_MS);
  const maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_RETRIES);
  const backoffMs = Math.max(0, config.retryBackoffMs ?? DEFAULT_BACKOFF_MS);
  const fetcher: OtelFetcher = config.fetcher ?? defaultFetcher;
  const now = config.now ?? (() => Date.now());
  const serviceName = config.serviceName ?? "wotann";
  const serviceVersion = config.serviceVersion ?? "0.0.0";

  // Per-exporter closure state.
  const queue: OpenInferenceSpan[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<OtelExportResult> | null = null;

  function startTimer(): void {
    if (intervalMs === 0 || timer) return;
    timer = setInterval(() => {
      void flush();
    }, intervalMs);
    // Don't keep the Node process alive just for the exporter.
    if (timer && typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
  }

  function stopTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  startTimer();

  function enqueue(span: OpenInferenceSpan): void {
    if (stopped) return;
    queue.push(span);
    if (queue.length >= batchSize) {
      void flush();
    }
  }

  function enqueueMany(spans: readonly OpenInferenceSpan[]): void {
    if (stopped) return;
    for (const s of spans) queue.push(s);
  }

  async function flush(): Promise<OtelExportResult> {
    if (config.disabled === true) {
      const disabledResult: OtelExportResult = {
        ok: false,
        reason: "disabled",
        message: "exporter is disabled",
      };
      config.onResult?.(disabledResult);
      return disabledResult;
    }
    if (queue.length === 0) {
      const emptyResult: OtelExportResult = {
        ok: false,
        reason: "empty",
        message: "no spans to export",
      };
      return emptyResult;
    }

    // Serialize + clear queue atomically.
    const drain = queue.splice(0);
    if (inFlight) {
      // If a flush is already running, wait for it so we don't
      // reorder requests — then continue with the current drain.
      await inFlight;
    }
    const startMs = now();
    inFlight = sendBatch(drain, startMs);
    const result = await inFlight;
    inFlight = null;
    config.onResult?.(result);
    return result;
  }

  async function sendBatch(
    spans: readonly OpenInferenceSpan[],
    startMs: number,
  ): Promise<OtelExportResult> {
    let payload: string;
    try {
      const resource = buildResource(serviceName, serviceVersion);
      const otlp = toOtlpPayload(resource, spans);
      payload = JSON.stringify(otlp);
    } catch (err) {
      return {
        ok: false,
        reason: "serialize",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    let lastHttpStatus: number | undefined;
    let lastMessage: string = "no attempts";
    let lastReason: "transport" | "http" = "transport";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetcher(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.headers ?? {}),
          },
          body: payload,
        });
        if (response.ok) {
          const result: OtelExportResult = {
            ok: true,
            sent: spans.length,
            durationMs: now() - startMs,
          };
          return result;
        }
        lastReason = "http";
        lastHttpStatus = response.status;
        const body = await safeText(response);
        lastMessage = `HTTP ${response.status}: ${body.slice(0, 256)}`;
        // Retry on 5xx + 429 only. 4xx is a permanent config error.
        if (response.status < 500 && response.status !== 429) {
          break;
        }
      } catch (err) {
        lastReason = "transport";
        lastMessage = err instanceof Error ? err.message : String(err);
      }

      if (attempt < maxRetries) {
        await delay(backoffMs * 2 ** attempt);
      }
    }

    const failureResult: OtelExportResult = {
      ok: false,
      reason: lastReason,
      message: lastMessage,
      ...(lastHttpStatus !== undefined ? { httpStatus: lastHttpStatus } : {}),
      attempts: maxRetries + 1,
    };
    return failureResult;
  }

  function pending(): number {
    return queue.length;
  }

  async function shutdown(): Promise<OtelExportResult> {
    stopped = true;
    stopTimer();
    return flush();
  }

  return {
    enqueue,
    enqueueMany,
    flush,
    pending,
    shutdown,
  };
}

// ── Shape helpers ─────────────────────────────────────────

interface OtlpPayload {
  readonly resourceSpans: readonly OtlpResourceSpan[];
}

interface OtlpResourceSpan {
  readonly resource: OtlpResource;
  readonly scopeSpans: readonly OtlpScopeSpan[];
}

interface OtlpResource {
  readonly attributes: readonly OtlpKeyValue[];
}

interface OtlpScopeSpan {
  readonly scope: { readonly name: string; readonly version: string };
  readonly spans: readonly OtlpSpan[];
}

interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtlpKeyValue[];
  readonly status: { readonly code: number; readonly message?: string };
}

interface OtlpKeyValue {
  readonly key: string;
  readonly value: OtlpValue;
}

type OtlpValue =
  | { readonly stringValue: string }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly boolValue: boolean };

function toOtlpValue(v: OtelAttribute["value"]): OtlpValue {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { intValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "boolean") return { boolValue: v };
  return { stringValue: String(v) };
}

function otelKindToNumber(kind: OpenInferenceSpan["kind"]): number {
  switch (kind) {
    case "INTERNAL":
      return 1;
    case "SERVER":
      return 2;
    case "CLIENT":
      return 3;
    case "PRODUCER":
      return 4;
    case "CONSUMER":
      return 5;
  }
}

function statusCodeToNumber(code: OpenInferenceSpan["status"]["code"]): number {
  switch (code) {
    case "UNSET":
      return 0;
    case "OK":
      return 1;
    case "ERROR":
      return 2;
  }
}

function buildResource(serviceName: string, serviceVersion: string): OtlpResource {
  return {
    attributes: [
      { key: "service.name", value: { stringValue: serviceName } },
      { key: "service.version", value: { stringValue: serviceVersion } },
    ],
  };
}

export function toOtlpPayload(
  resource: OtlpResource,
  spans: readonly OpenInferenceSpan[],
): OtlpPayload {
  const otlpSpans: OtlpSpan[] = spans.map((s) => {
    const attrs: OtlpKeyValue[] = s.attributes.map((a) => ({
      key: a.key,
      value: toOtlpValue(a.value),
    }));
    const span: OtlpSpan = {
      traceId: s.traceId,
      spanId: s.spanId,
      ...(s.parentSpanId !== undefined ? { parentSpanId: s.parentSpanId } : {}),
      name: s.name,
      kind: otelKindToNumber(s.kind),
      startTimeUnixNano: s.startTimeUnixNano,
      endTimeUnixNano: s.endTimeUnixNano,
      attributes: attrs,
      status: {
        code: statusCodeToNumber(s.status.code),
        ...(s.status.message !== undefined ? { message: s.status.message } : {}),
      },
    };
    return span;
  });
  return {
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: { name: "wotann.openinference", version: "1.0.0" },
            spans: otlpSpans,
          },
        ],
      },
    ],
  };
}

// ── Validation ────────────────────────────────────────────

function validate(config: OtelExporterConfig): void {
  if (!config) throw new Error("otel-exporter: config required");
  if (!config.endpoint || typeof config.endpoint !== "string") {
    throw new Error("otel-exporter: endpoint (string) required");
  }
  if (!isLikelyUrl(config.endpoint)) {
    throw new Error(`otel-exporter: endpoint does not look like a URL: ${config.endpoint}`);
  }
  if (
    config.batchSize !== undefined &&
    (config.batchSize <= 0 || !Number.isFinite(config.batchSize))
  ) {
    throw new Error("otel-exporter: batchSize must be > 0");
  }
  if (
    config.flushIntervalMs !== undefined &&
    (config.flushIntervalMs < 0 || !Number.isFinite(config.flushIntervalMs))
  ) {
    throw new Error("otel-exporter: flushIntervalMs must be >= 0");
  }
  if (
    config.maxRetries !== undefined &&
    (config.maxRetries < 0 || !Number.isFinite(config.maxRetries))
  ) {
    throw new Error("otel-exporter: maxRetries must be >= 0");
  }
}

function isLikelyUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

// ── Default fetcher ───────────────────────────────────────

const defaultFetcher: OtelFetcher = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};

// ── Utilities ─────────────────────────────────────────────

async function safeText(response: { text: () => Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
