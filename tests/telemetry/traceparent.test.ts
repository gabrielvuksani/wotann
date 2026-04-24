/**
 * V9 T14.1 — W3C traceparent tests.
 *
 * Cover parse / format / build / childOf / extract / inject / sampled
 * against the W3C Trace Context recommendation rules.
 */

import { describe, expect, it } from "vitest";
import {
  TRACE_FLAGS,
  buildTraceparent,
  childOf,
  extractTraceparent,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  injectTraceparent,
  isSampled,
  parseTraceparent,
  type TraceparentFields,
  type TraceparentRng,
} from "../../src/telemetry/traceparent.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const VALID_HEADER = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const VALID_FIELDS: TraceparentFields = {
  version: "00",
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  parentId: "00f067aa0ba902b7",
  flags: "01",
};

/** Deterministic RNG that fills buffer with a repeating byte pattern. */
function rngBytes(pattern: number): TraceparentRng {
  return {
    fill: (buf) => {
      for (let i = 0; i < buf.length; i++) {
        buf[i] = (pattern + i) & 0xff;
      }
    },
  };
}

// ── parseTraceparent ─────────────────────────────────────────────────────

describe("parseTraceparent", () => {
  it("parses a canonical W3C header", () => {
    expect(parseTraceparent(VALID_HEADER)).toEqual(VALID_FIELDS);
  });

  it("trims leading/trailing whitespace", () => {
    expect(parseTraceparent("  " + VALID_HEADER + "  ")).toEqual(VALID_FIELDS);
  });

  it("rejects non-string input", () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(42)).toBeNull();
    expect(parseTraceparent({})).toBeNull();
  });

  it("rejects wrong total length", () => {
    expect(parseTraceparent(VALID_HEADER + "x")).toBeNull();
    expect(parseTraceparent(VALID_HEADER.slice(0, -1))).toBeNull();
  });

  it("rejects version ff (reserved per spec)", () => {
    const bad = "ff-" + VALID_FIELDS.traceId + "-" + VALID_FIELDS.parentId + "-01";
    expect(parseTraceparent(bad)).toBeNull();
  });

  it("rejects unsupported versions (e.g. 01 is future)", () => {
    const bad = "01-" + VALID_FIELDS.traceId + "-" + VALID_FIELDS.parentId + "-01";
    expect(parseTraceparent(bad)).toBeNull();
  });

  it("rejects all-zero trace id", () => {
    const bad = "00-" + "0".repeat(32) + "-" + VALID_FIELDS.parentId + "-01";
    expect(parseTraceparent(bad)).toBeNull();
  });

  it("rejects all-zero span id", () => {
    const bad = "00-" + VALID_FIELDS.traceId + "-" + "0".repeat(16) + "-01";
    expect(parseTraceparent(bad)).toBeNull();
  });

  it("rejects uppercase hex (spec requires lowercase)", () => {
    const bad = "00-" + VALID_FIELDS.traceId.toUpperCase() + "-" + VALID_FIELDS.parentId + "-01";
    expect(parseTraceparent(bad)).toBeNull();
  });

  it("rejects non-hex characters", () => {
    const bad = "00-" + "z".repeat(32) + "-" + VALID_FIELDS.parentId + "-01";
    expect(parseTraceparent(bad)).toBeNull();
  });
});

// ── formatTraceparent ────────────────────────────────────────────────────

describe("formatTraceparent", () => {
  it("round-trips parse → format", () => {
    const parsed = parseTraceparent(VALID_HEADER);
    expect(parsed).not.toBeNull();
    expect(formatTraceparent(parsed!)).toBe(VALID_HEADER);
  });

  it("throws on invalid fields (programmer error)", () => {
    expect(() =>
      formatTraceparent({ ...VALID_FIELDS, version: "ff" }),
    ).toThrow(/version/);
    expect(() =>
      formatTraceparent({ ...VALID_FIELDS, traceId: "0".repeat(32) }),
    ).toThrow(/traceId/);
    expect(() =>
      formatTraceparent({ ...VALID_FIELDS, parentId: "0".repeat(16) }),
    ).toThrow(/parentId/);
    expect(() =>
      formatTraceparent({ ...VALID_FIELDS, flags: "xx" }),
    ).toThrow(/flags/);
  });
});

// ── ID generation ────────────────────────────────────────────────────────

describe("generateTraceId / generateSpanId", () => {
  it("produces 32-char hex trace ids", () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces 16-char hex span ids", () => {
    const id = generateSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("honors injected RNG for determinism", () => {
    const rng = rngBytes(0x01);
    const id = generateSpanId(rng);
    // Fixed pattern → byte-identical id
    expect(generateSpanId(rng)).toBe(id);
  });

  it("never produces the all-zero id (RNG returns zeros → flips byte)", () => {
    const zeroRng: TraceparentRng = { fill: (buf) => buf.fill(0) };
    const traceId = generateTraceId(zeroRng);
    const spanId = generateSpanId(zeroRng);
    expect(traceId).not.toBe("0".repeat(32));
    expect(spanId).not.toBe("0".repeat(16));
  });
});

// ── buildTraceparent ─────────────────────────────────────────────────────

describe("buildTraceparent", () => {
  it("produces a parseable header when called with no args", () => {
    const header = buildTraceparent();
    expect(parseTraceparent(header)).not.toBeNull();
  });

  it("defaults flags to sampled (01)", () => {
    const header = buildTraceparent();
    const parsed = parseTraceparent(header);
    expect(parsed?.flags).toBe("01");
  });

  it("accepts pre-existing traceId + parentId", () => {
    const header = buildTraceparent({
      traceId: VALID_FIELDS.traceId,
      parentId: VALID_FIELDS.parentId,
    });
    expect(header).toBe(VALID_HEADER);
  });
});

// ── childOf ──────────────────────────────────────────────────────────────

describe("childOf", () => {
  it("inherits traceId from parent string", () => {
    const child = childOf(VALID_HEADER);
    expect(child?.traceId).toBe(VALID_FIELDS.traceId);
  });

  it("generates a fresh parentId distinct from source", () => {
    const child = childOf(VALID_HEADER);
    expect(child?.parentId).not.toBe(VALID_FIELDS.parentId);
    expect(child?.parentId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("preserves flags from parent", () => {
    const child = childOf(VALID_HEADER);
    expect(child?.flags).toBe(VALID_FIELDS.flags);
  });

  it("accepts a fields object directly", () => {
    const child = childOf(VALID_FIELDS);
    expect(child?.traceId).toBe(VALID_FIELDS.traceId);
  });

  it("returns null when parent string is malformed", () => {
    expect(childOf("garbage")).toBeNull();
  });
});

// ── extractTraceparent ───────────────────────────────────────────────────

describe("extractTraceparent", () => {
  it("finds the header regardless of case", () => {
    expect(extractTraceparent({ traceparent: VALID_HEADER })).toEqual(VALID_FIELDS);
    expect(extractTraceparent({ Traceparent: VALID_HEADER })).toEqual(VALID_FIELDS);
    expect(extractTraceparent({ TRACEPARENT: VALID_HEADER })).toEqual(VALID_FIELDS);
  });

  it("handles array values by taking the first", () => {
    expect(extractTraceparent({ traceparent: [VALID_HEADER, "ignored"] })).toEqual(VALID_FIELDS);
  });

  it("returns null when no header present", () => {
    expect(extractTraceparent({})).toBeNull();
    expect(extractTraceparent({ other: "x" })).toBeNull();
  });

  it("returns null when header is malformed", () => {
    expect(extractTraceparent({ traceparent: "not-valid" })).toBeNull();
  });
});

// ── injectTraceparent ────────────────────────────────────────────────────

describe("injectTraceparent", () => {
  it("adds traceparent to the headers (lowercase key)", () => {
    const out = injectTraceparent({}, VALID_FIELDS);
    expect(out["traceparent"]).toBe(VALID_HEADER);
  });

  it("preserves other headers", () => {
    const out = injectTraceparent({ foo: "bar", baz: 42 }, VALID_FIELDS);
    expect(out.foo).toBe("bar");
    expect(out.baz).toBe(42);
  });

  it("removes case-variant duplicates", () => {
    const out = injectTraceparent(
      { Traceparent: "old-value", TRACEPARENT: "also-old" } as Record<string, unknown>,
      VALID_FIELDS,
    );
    const keys = Object.keys(out).filter((k) => k.toLowerCase() === "traceparent");
    expect(keys).toEqual(["traceparent"]);
    expect(out["traceparent"]).toBe(VALID_HEADER);
  });

  it("does not mutate the input", () => {
    const headers = { foo: "bar" };
    injectTraceparent(headers, VALID_FIELDS);
    expect(headers).toEqual({ foo: "bar" });
  });
});

// ── isSampled ────────────────────────────────────────────────────────────

describe("isSampled", () => {
  it("returns true when SAMPLED bit is set", () => {
    expect(isSampled({ ...VALID_FIELDS, flags: "01" })).toBe(true);
    expect(isSampled({ ...VALID_FIELDS, flags: "03" })).toBe(true); // 0b11 — sampled + future
  });

  it("returns false when SAMPLED bit is clear", () => {
    expect(isSampled({ ...VALID_FIELDS, flags: "00" })).toBe(false);
    expect(isSampled({ ...VALID_FIELDS, flags: "02" })).toBe(false);
  });

  it("TRACE_FLAGS exports the expected constants", () => {
    expect(TRACE_FLAGS.SAMPLED).toBe(0x01);
    expect(TRACE_FLAGS.NONE).toBe(0x00);
  });
});
