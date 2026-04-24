/**
 * Tier 12 T12.10 — OTEL Exporter tests.
 *
 * Covers validation, batch flush, retry + backoff, transport + HTTP
 * error categories, disabled + empty fast paths, and the OTLP JSON
 * payload shape.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createOtelExporter,
  toOtlpPayload,
  type OpenInferenceSpan,
  type OtelExporterConfig,
  type OtelFetcher,
  type OtelExportResult,
} from "../../src/observability/otel-exporter.js";

// ── Helpers ──────────────────────────────────────────────

function makeSpan(n: number, overrides: Partial<OpenInferenceSpan> = {}): OpenInferenceSpan {
  return {
    traceId: "a".repeat(32).slice(0, 32),
    spanId: `s${String(n).padStart(15, "0")}`,
    name: `span-${n}`,
    kind: "INTERNAL",
    openInferenceKind: "TOOL",
    startTimeUnixNano: String(BigInt(1_700_000_000_000 + n) * 1_000_000n),
    endTimeUnixNano: String(BigInt(1_700_000_000_001 + n) * 1_000_000n),
    attributes: [{ key: "x", value: "y" }],
    status: { code: "OK" },
    ...overrides,
  };
}

function okFetcher(): OtelFetcher {
  return async (_url, _init) => ({
    ok: true,
    status: 200,
    text: async () => "",
  });
}

function failFetcher(status = 500, message = "server error"): OtelFetcher {
  return async (_url, _init) => ({
    ok: false,
    status,
    text: async () => message,
  });
}

function baseConfig(overrides: Partial<OtelExporterConfig> = {}): OtelExporterConfig {
  return {
    endpoint: "http://localhost:4318/v1/traces",
    fetcher: okFetcher(),
    flushIntervalMs: 0, // disable auto-flush for deterministic tests
    ...overrides,
  };
}

// ── Validation ────────────────────────────────────────────

describe("createOtelExporter — validation", () => {
  it("rejects missing endpoint", () => {
    expect(() => createOtelExporter({} as OtelExporterConfig)).toThrow(/endpoint/);
  });

  it("rejects non-URL endpoint", () => {
    expect(() => createOtelExporter({ endpoint: "not-a-url" })).toThrow(/URL/);
  });

  it("accepts valid http and https endpoints", () => {
    expect(() =>
      createOtelExporter({ endpoint: "http://localhost:4318/v1/traces", flushIntervalMs: 0 }),
    ).not.toThrow();
    expect(() =>
      createOtelExporter({
        endpoint: "https://cloud.langfuse.com/api/public/otel/v1/traces",
        flushIntervalMs: 0,
      }),
    ).not.toThrow();
  });

  it("rejects invalid batchSize", () => {
    expect(() =>
      createOtelExporter({
        endpoint: "http://localhost:4318/v1/traces",
        batchSize: 0,
        flushIntervalMs: 0,
      }),
    ).toThrow(/batchSize/);
  });

  it("rejects negative flushIntervalMs", () => {
    expect(() =>
      createOtelExporter({
        endpoint: "http://localhost:4318/v1/traces",
        flushIntervalMs: -1,
      }),
    ).toThrow(/flushIntervalMs/);
  });
});

// ── Empty + disabled fast paths ─────────────────────────

describe("flush — fast paths", () => {
  it("returns ok:false reason=empty when queue is empty", async () => {
    const e = createOtelExporter(baseConfig());
    const r = await e.flush();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("short-circuits when disabled", async () => {
    const e = createOtelExporter(baseConfig({ disabled: true }));
    e.enqueue(makeSpan(1));
    const r = await e.flush();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });
});

// ── Happy path ──────────────────────────────────────────

describe("flush — happy path", () => {
  it("sends enqueued spans and returns ok result", async () => {
    const fetcher = vi.fn<OtelFetcher>(okFetcher());
    const e = createOtelExporter(baseConfig({ fetcher }));
    e.enqueue(makeSpan(1));
    e.enqueue(makeSpan(2));
    const r = await e.flush();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sent).toBe(2);
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("http://localhost:4318/v1/traces");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("clears queue after successful flush", async () => {
    const e = createOtelExporter(baseConfig());
    e.enqueue(makeSpan(1));
    expect(e.pending()).toBe(1);
    await e.flush();
    expect(e.pending()).toBe(0);
  });

  it("auto-flushes when batchSize is reached", async () => {
    const fetcher = vi.fn<OtelFetcher>(okFetcher());
    const e = createOtelExporter(baseConfig({ fetcher, batchSize: 2 }));
    e.enqueue(makeSpan(1));
    e.enqueue(makeSpan(2));
    // Auto-flush is scheduled asynchronously — give microtask a chance.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).toHaveBeenCalled();
  });

  it("custom headers are forwarded", async () => {
    const fetcher = vi.fn<OtelFetcher>(okFetcher());
    const e = createOtelExporter(
      baseConfig({ fetcher, headers: { "x-api-key": "secret" } }),
    );
    e.enqueue(makeSpan(1));
    await e.flush();
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.headers["x-api-key"]).toBe("secret");
  });
});

// ── Retry + backoff ──────────────────────────────────────

describe("flush — retry", () => {
  it("retries on 500 then succeeds", async () => {
    let calls = 0;
    const fetcher: OtelFetcher = async () => {
      calls++;
      if (calls < 2) {
        return { ok: false, status: 500, text: async () => "transient" };
      }
      return { ok: true, status: 200, text: async () => "" };
    };
    const e = createOtelExporter(baseConfig({ fetcher, maxRetries: 2, retryBackoffMs: 1 }));
    e.enqueue(makeSpan(1));
    const r = await e.flush();
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("retries on 429", async () => {
    let calls = 0;
    const fetcher: OtelFetcher = async () => {
      calls++;
      if (calls === 1) {
        return { ok: false, status: 429, text: async () => "rate limit" };
      }
      return { ok: true, status: 200, text: async () => "" };
    };
    const e = createOtelExporter(baseConfig({ fetcher, maxRetries: 1, retryBackoffMs: 1 }));
    e.enqueue(makeSpan(1));
    const r = await e.flush();
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("does NOT retry on 4xx (other than 429)", async () => {
    let calls = 0;
    const fetcher: OtelFetcher = async () => {
      calls++;
      return { ok: false, status: 400, text: async () => "bad" };
    };
    const e = createOtelExporter(baseConfig({ fetcher, maxRetries: 3, retryBackoffMs: 1 }));
    e.enqueue(makeSpan(1));
    const r = await e.flush();
    expect(r.ok).toBe(false);
    expect(calls).toBe(1); // no retries on 4xx
    if (!r.ok) {
      expect(r.reason).toBe("http");
      expect(r.httpStatus).toBe(400);
    }
  });

  it("gives up after maxRetries on persistent 500", async () => {
    let calls = 0;
    const fetcher: OtelFetcher = async () => {
      calls++;
      return { ok: false, status: 500, text: async () => "down" };
    };
    const e = createOtelExporter(baseConfig({ fetcher, maxRetries: 2, retryBackoffMs: 1 }));
    e.enqueue(makeSpan(1));
    const r = await e.flush();
    expect(r.ok).toBe(false);
    expect(calls).toBe(3); // initial + 2 retries
    if (!r.ok) {
      expect(r.reason).toBe("http");
      expect(r.attempts).toBe(3);
    }
  });
});

// ── Transport errors ─────────────────────────────────────

describe("flush — transport errors", () => {
  it("surfaces transport errors with reason=transport", async () => {
    const fetcher: OtelFetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const e = createOtelExporter(baseConfig({ fetcher, maxRetries: 0 }));
    e.enqueue(makeSpan(1));
    const r = await e.flush();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("transport");
      expect(r.message).toContain("ECONNREFUSED");
    }
  });

  it("retries transport errors", async () => {
    let calls = 0;
    const fetcher: OtelFetcher = async () => {
      calls++;
      if (calls < 2) throw new Error("timeout");
      return { ok: true, status: 200, text: async () => "" };
    };
    const e = createOtelExporter(baseConfig({ fetcher, maxRetries: 2, retryBackoffMs: 1 }));
    e.enqueue(makeSpan(1));
    const r = await e.flush();
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });
});

// ── onResult listener ────────────────────────────────────

describe("onResult listener", () => {
  it("fires on successful flush", async () => {
    const onResult = vi.fn<(r: OtelExportResult) => void>();
    const e = createOtelExporter(baseConfig({ onResult }));
    e.enqueue(makeSpan(1));
    await e.flush();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0].ok).toBe(true);
  });

  it("fires on failed flush", async () => {
    const onResult = vi.fn<(r: OtelExportResult) => void>();
    const e = createOtelExporter(
      baseConfig({ fetcher: failFetcher(400), onResult, maxRetries: 0 }),
    );
    e.enqueue(makeSpan(1));
    await e.flush();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0].ok).toBe(false);
  });

  it("fires with disabled reason", async () => {
    const onResult = vi.fn<(r: OtelExportResult) => void>();
    const e = createOtelExporter(baseConfig({ disabled: true, onResult }));
    e.enqueue(makeSpan(1));
    await e.flush();
    const result = onResult.mock.calls[0]?.[0];
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.reason).toBe("disabled");
  });
});

// ── shutdown ────────────────────────────────────────────

describe("shutdown", () => {
  it("flushes queued spans", async () => {
    const fetcher = vi.fn<OtelFetcher>(okFetcher());
    const e = createOtelExporter(baseConfig({ fetcher }));
    e.enqueue(makeSpan(1));
    await e.shutdown();
    expect(fetcher).toHaveBeenCalled();
  });

  it("rejects further enqueue after shutdown", async () => {
    const fetcher = vi.fn<OtelFetcher>(okFetcher());
    const e = createOtelExporter(baseConfig({ fetcher }));
    await e.shutdown();
    e.enqueue(makeSpan(999));
    expect(e.pending()).toBe(0);
  });
});

// ── OTLP payload shape ───────────────────────────────────

describe("toOtlpPayload", () => {
  it("produces spec-compliant structure", () => {
    const resource = {
      attributes: [{ key: "service.name", value: { stringValue: "wotann" } } as const],
    };
    const span = makeSpan(1, { name: "invoke", kind: "CLIENT" });
    const payload = toOtlpPayload(resource, [span]);
    expect(payload.resourceSpans).toHaveLength(1);
    const rs = payload.resourceSpans[0]!;
    expect(rs.scopeSpans[0]?.scope.name).toBe("wotann.openinference");
    const serialized = rs.scopeSpans[0]!.spans[0];
    expect(serialized?.name).toBe("invoke");
    expect(serialized?.kind).toBe(3); // CLIENT
    expect(serialized?.status.code).toBe(1); // OK
  });

  it("encodes number attributes as intValue when integer", () => {
    const span = makeSpan(1, {
      attributes: [{ key: "tokens", value: 42 }],
    });
    const payload = toOtlpPayload(
      { attributes: [] },
      [span],
    );
    const attrs = payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes;
    const tokens = attrs.find((a) => a.key === "tokens");
    expect(tokens?.value).toEqual({ intValue: "42" });
  });

  it("encodes number attributes as doubleValue when non-integer", () => {
    const span = makeSpan(1, {
      attributes: [{ key: "latency", value: 3.14 }],
    });
    const payload = toOtlpPayload({ attributes: [] }, [span]);
    const attrs = payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes;
    const latency = attrs.find((a) => a.key === "latency");
    expect(latency?.value).toEqual({ doubleValue: 3.14 });
  });

  it("encodes bool attributes correctly", () => {
    const span = makeSpan(1, {
      attributes: [{ key: "sampled", value: true }],
    });
    const payload = toOtlpPayload({ attributes: [] }, [span]);
    const sampled = payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes.find(
      (a) => a.key === "sampled",
    );
    expect(sampled?.value).toEqual({ boolValue: true });
  });

  it("status codes map correctly", () => {
    const err = makeSpan(1, { status: { code: "ERROR", message: "x" } });
    const unset = makeSpan(2, { status: { code: "UNSET" } });
    const payload = toOtlpPayload({ attributes: [] }, [err, unset]);
    const spans = payload.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans[0]?.status.code).toBe(2); // ERROR
    expect(spans[1]?.status.code).toBe(0); // UNSET
  });
});

// ── Per-exporter isolation ───────────────────────────────

describe("per-exporter isolation", () => {
  it("two exporters do not share queues", () => {
    const a = createOtelExporter(baseConfig());
    const b = createOtelExporter(baseConfig());
    a.enqueue(makeSpan(1));
    expect(a.pending()).toBe(1);
    expect(b.pending()).toBe(0);
  });
});
