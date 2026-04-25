/**
 * Observability Export — LangSmith + Langfuse trace export.
 * Every tool call, LLM query, and decision is logged and exportable.
 * DeerFlow-inspired dual observability.
 */

import { writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { isTelemetryOptedOut } from "./opt-out.js";
// V9 T14.1 — W3C Trace Context helpers. Used by the OTLP exporter to
// emit a spec-compliant `traceparent` header alongside each batch and
// to honor inbound parent context when the caller supplies one. This
// makes WOTANN telemetry interoperable with any OpenTelemetry-aware
// collector (Jaeger, Tempo, Datadog, Honeycomb).
import {
  buildTraceparent,
  childOf,
  extractTraceparent,
  formatTraceparent,
  generateTraceId as generateW3cTraceId,
  parseTraceparent,
  type TraceparentFields,
} from "./traceparent.js";

// ── Types ────────────────────────────────────────────────

export interface TraceEvent {
  readonly id: string;
  readonly parentId?: string;
  readonly type: "llm_call" | "tool_call" | "decision" | "error" | "metric";
  readonly name: string;
  readonly input: string;
  readonly output: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly provider?: string;
  readonly model?: string;
  readonly tokensUsed?: number;
  readonly costUsd?: number;
}

export interface TraceSession {
  readonly sessionId: string;
  readonly startTime: number;
  readonly events: readonly TraceEvent[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type ExportFormat = "langsmith" | "langfuse" | "jsonl" | "otlp";

export interface OTLPSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: "INTERNAL" | "CLIENT" | "SERVER";
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OTLPAttribute[];
  readonly status: { readonly code: "OK" | "ERROR"; readonly message?: string };
}

export interface OTLPAttribute {
  readonly key: string;
  readonly value: { readonly stringValue?: string; readonly intValue?: string };
}

export interface ExportConfig {
  readonly format: ExportFormat;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  /**
   * V9 T14.1 — Optional inbound HTTP headers carrying a W3C
   * `traceparent`. When supplied, the OTLP exporter parses + uses
   * the parent's traceId for outbound spans so cross-service traces
   * link up. When absent, a fresh root traceId is generated per flush.
   */
  readonly inboundHeaders?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

// ── Observability Exporter ───────────────────────────────

export class ObservabilityExporter {
  private readonly events: TraceEvent[] = [];
  private readonly config: ExportConfig;
  private readonly logDir: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(wotannDir: string, config?: Partial<ExportConfig>) {
    this.logDir = join(wotannDir, "traces");
    this.config = {
      format: "jsonl",
      batchSize: 100,
      flushIntervalMs: 30_000,
      ...config,
    };

    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    // Auto-flush on interval
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
  }

  /**
   * Record a trace event.
   *
   * Honours the telemetry opt-out gate — if the user set DO_NOT_TRACK=1,
   * WOTANN_NO_TELEMETRY=1, or dropped a ~/.wotann/no-telemetry sentinel,
   * the event is silently dropped. Local JSONL still runs so users keep
   * their own logs; only remote exports are suppressed, but we suppress
   * everything here as a defence in depth.
   */
  record(event: TraceEvent): void {
    if (isTelemetryOptedOut()) return;
    this.events.push(event);

    // Auto-flush when batch is full
    if (this.events.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Record an LLM call.
   */
  recordLLMCall(params: {
    name: string;
    input: string;
    output: string;
    provider: string;
    model: string;
    tokensUsed: number;
    costUsd: number;
    durationMs: number;
    parentId?: string;
  }): void {
    const now = Date.now();
    this.record({
      id: `llm-${now}`,
      parentId: params.parentId,
      type: "llm_call",
      name: params.name,
      input: params.input.slice(0, 1000),
      output: params.output.slice(0, 1000),
      startTime: now - params.durationMs,
      endTime: now,
      metadata: {},
      provider: params.provider,
      model: params.model,
      tokensUsed: params.tokensUsed,
      costUsd: params.costUsd,
    });
  }

  /**
   * Record a tool call.
   */
  recordToolCall(params: {
    name: string;
    args: string;
    result: string;
    success: boolean;
    durationMs: number;
    parentId?: string;
  }): void {
    const now = Date.now();
    this.record({
      id: `tool-${now}`,
      parentId: params.parentId,
      type: "tool_call",
      name: params.name,
      input: params.args.slice(0, 500),
      output: params.result.slice(0, 500),
      startTime: now - params.durationMs,
      endTime: now,
      metadata: { success: params.success },
    });
  }

  /**
   * Record a decision event (architectural, routing, model selection, etc.).
   */
  recordDecision(params: {
    name: string;
    input: string;
    decision: string;
    reasoning: string;
    parentId?: string;
  }): void {
    const now = Date.now();
    this.record({
      id: `decision-${now}`,
      parentId: params.parentId,
      type: "decision",
      name: params.name,
      input: params.input.slice(0, 500),
      output: params.decision.slice(0, 500),
      startTime: now,
      endTime: now,
      metadata: { reasoning: params.reasoning },
    });
  }

  /**
   * Record a metric event (latency, token count, cost, etc.).
   */
  recordMetric(params: {
    name: string;
    value: number;
    unit: string;
    parentId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const now = Date.now();
    this.record({
      id: `metric-${now}`,
      type: "metric",
      name: params.name,
      input: String(params.value),
      output: params.unit,
      startTime: now,
      endTime: now,
      metadata: { ...params.metadata, value: params.value, unit: params.unit },
      parentId: params.parentId,
    });
  }

  /**
   * Get a session snapshot with all pending events.
   */
  getSession(sessionId: string): TraceSession {
    return {
      sessionId,
      startTime: this.events.length > 0 ? this.events[0]!.startTime : Date.now(),
      events: [...this.events],
      metadata: { format: this.config.format },
    };
  }

  /**
   * Flush events to the configured export target.
   */
  flush(): void {
    if (this.events.length === 0) return;

    const batch = this.events.splice(0);

    switch (this.config.format) {
      case "jsonl":
        this.exportJSONL(batch);
        break;
      case "langsmith":
        this.exportLangSmith(batch);
        break;
      case "langfuse":
        this.exportLangfuse(batch);
        break;
      case "otlp":
        this.exportOTLP(batch);
        break;
      default:
        this.exportJSONL(batch);
    }
  }

  /**
   * Stop the exporter and flush remaining events.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /**
   * Get event count (for monitoring).
   */
  getEventCount(): number {
    return this.events.length;
  }

  // ── Export Implementations ──────────────────────────────

  private exportJSONL(events: readonly TraceEvent[]): void {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(this.logDir, `trace-${date}.jsonl`);
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    appendFileSync(filePath, lines, "utf-8");
  }

  private exportLangSmith(events: readonly TraceEvent[]): void {
    // LangSmith format: POST to /api/v1/runs
    // In production, would use fetch() to send to LangSmith API
    // For now, export as LangSmith-compatible JSONL
    const formatted = events.map((e) => ({
      id: e.id,
      parent_run_id: e.parentId,
      name: e.name,
      run_type: e.type === "llm_call" ? "llm" : e.type === "tool_call" ? "tool" : "chain",
      inputs: { input: e.input },
      outputs: { output: e.output },
      start_time: new Date(e.startTime).toISOString(),
      end_time: new Date(e.endTime).toISOString(),
      extra: e.metadata,
    }));
    const filePath = join(this.logDir, `langsmith-${Date.now()}.jsonl`);
    writeFileSync(filePath, formatted.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf-8");
  }

  private exportLangfuse(events: readonly TraceEvent[]): void {
    // Langfuse format: POST to /api/public/ingestion
    const formatted = events.map((e) => ({
      id: e.id,
      type: e.type === "llm_call" ? "generation" : "span",
      name: e.name,
      startTime: new Date(e.startTime).toISOString(),
      endTime: new Date(e.endTime).toISOString(),
      input: e.input,
      output: e.output,
      model: e.model,
      usage: e.tokensUsed ? { totalTokens: e.tokensUsed } : undefined,
      metadata: e.metadata,
    }));
    const filePath = join(this.logDir, `langfuse-${Date.now()}.jsonl`);
    writeFileSync(filePath, formatted.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf-8");
  }

  private exportOTLP(events: readonly TraceEvent[]): void {
    // OpenTelemetry Protocol format — OTLP/JSON
    // In production, would POST to an OTLP collector endpoint.
    // For now, export as OTLP-compatible JSON for file-based collection.
    //
    // V9 T14.1 — Honor inbound W3C `traceparent` for cross-service
    // span linking. When the caller passed `inboundHeaders` carrying a
    // traceparent, parse it and reuse its traceId so the OTLP spans
    // chain up to the upstream parent. Absent headers → generate a
    // fresh W3C-spec traceId.
    const inbound = this.config.inboundHeaders
      ? extractTraceparent(this.config.inboundHeaders)
      : null;
    const traceId = inbound?.traceId ?? generateTraceId();
    // Build the header we'd emit on outbound HTTP for the next hop.
    // Either propagate the inbound parent into a fresh child span, or
    // open a brand-new root traceparent. We don't actually send it
    // (this exporter is file-backed) but we record it on the payload
    // so downstream collectors can correlate.
    const outboundParent: TraceparentFields | null = inbound
      ? childOf(inbound)
      : (parseTraceparent(buildTraceparent({ traceId })) ?? null);
    const outboundHeader = outboundParent ? formatTraceparent(outboundParent) : null;

    const spans: OTLPSpan[] = events.map((e) => {
      const attributes: OTLPAttribute[] = [
        { key: "wotann.event.type", value: { stringValue: e.type } },
        { key: "wotann.event.name", value: { stringValue: e.name } },
      ];

      if (e.provider) {
        attributes.push({ key: "llm.provider", value: { stringValue: e.provider } });
      }
      if (e.model) {
        attributes.push({ key: "llm.model", value: { stringValue: e.model } });
      }
      if (e.tokensUsed !== undefined) {
        attributes.push({ key: "llm.tokens", value: { intValue: String(e.tokensUsed) } });
      }
      if (e.costUsd !== undefined) {
        attributes.push({ key: "llm.cost_usd", value: { stringValue: e.costUsd.toFixed(6) } });
      }

      for (const [key, val] of Object.entries(e.metadata)) {
        attributes.push({
          key: `wotann.meta.${key}`,
          value: { stringValue: String(val) },
        });
      }

      return {
        traceId,
        spanId: e.id
          .replace(/[^a-f0-9]/g, "")
          .slice(0, 16)
          .padEnd(16, "0"),
        parentSpanId: e.parentId
          ?.replace(/[^a-f0-9]/g, "")
          .slice(0, 16)
          .padEnd(16, "0"),
        name: e.name,
        kind: e.type === "llm_call" ? ("CLIENT" as const) : ("INTERNAL" as const),
        startTimeUnixNano: String(e.startTime * 1_000_000),
        endTimeUnixNano: String(e.endTime * 1_000_000),
        attributes,
        status: {
          code: e.type === "error" ? ("ERROR" as const) : ("OK" as const),
          message: e.type === "error" ? e.output : undefined,
        },
      };
    });

    const otlpPayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "wotann" } },
              { key: "service.version", value: { stringValue: "0.1.0" } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "wotann-telemetry", version: "0.1.0" },
              spans,
            },
          ],
        },
      ],
      // V9 T14.1 — outbound W3C traceparent + (when relevant) the
      // inbound parent. Downstream collectors / agents that pick up
      // this file can use the headers to link the trace into a
      // distributed view (Jaeger / Tempo / Datadog).
      ...(outboundHeader ? { traceparent: outboundHeader } : {}),
      ...(inbound ? { _inboundTraceparent: formatTraceparent(inbound) } : {}),
    };

    const filePath = join(this.logDir, `otlp-${Date.now()}.json`);
    writeFileSync(filePath, JSON.stringify(otlpPayload, null, 2), "utf-8");
  }
}

// ── Helpers ──────────────────────────────────────────────

/**
 * V9 T14.1 — Generate a W3C-spec-compliant 32-hex-char trace ID.
 * Delegates to the canonical helper in `traceparent.ts` (which uses
 * crypto.randomBytes and rejects all-zero ids per spec). Kept as a
 * local wrapper so the exportOTLP code reads naturally.
 */
function generateTraceId(): string {
  return generateW3cTraceId();
}

// Legacy weak-random implementation (unreachable, kept for reference).
function _legacyGenerateTraceId(): string {
  const bytes: string[] = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(Math.floor(Math.random() * 16).toString(16));
  }
  return bytes.join("");
}
