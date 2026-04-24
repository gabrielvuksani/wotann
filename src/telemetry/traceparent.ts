/**
 * W3C Trace Context (`traceparent`) helpers — V9 Tier 14.1.
 *
 * Implements the parse + build + propagate primitives for the W3C
 * Trace Context recommendation so WOTANN can participate in
 * distributed traces that cross service boundaries. A caller (HTTP
 * ingress, MCP client, webhook dispatcher) can:
 *
 *   1. Extract an inbound `traceparent` header → TraceContext
 *   2. Open a new child span against that parent
 *   3. Propagate the resulting header to outbound calls
 *
 * This module ONLY ships the pure helpers. The `observability-export.ts`
 * module in this directory owns the OTLP emitter shape; wiring that
 * consumes a TraceContext happens at the call site, not here, to
 * keep this module a zero-I/O pure-string layer.
 *
 * ── Specification ────────────────────────────────────────────────────
 * W3C Trace Context, Section 3.2 (`traceparent` header format):
 *
 *   traceparent = version "-" trace-id "-" parent-id "-" trace-flags
 *
 * where
 *   version     = 2 lowercase hex chars (currently "00"; "ff" is invalid)
 *   trace-id    = 32 lowercase hex chars (all-zero id is invalid)
 *   parent-id   = 16 lowercase hex chars (all-zero id is invalid)
 *   trace-flags = 2 lowercase hex chars (bit 0 = sampled)
 *
 * Example:
 *   00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: every parser returns `null` on malformed
 *    input; callers branch on that instead of catching exceptions.
 *  - QB #7 per-call state: pure module. No module-level caches.
 *  - QB #13 env guard: zero `process.*` reads. All randomness comes
 *    from a pluggable `rng` option so tests can produce deterministic
 *    trace/span ids.
 */

import { randomBytes } from "node:crypto";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * Structured form of a `traceparent` header. All fields are lowercase
 * hex strings matching the W3C byte lengths.
 */
export interface TraceparentFields {
  /** Spec version byte. Today only `"00"` is accepted. */
  readonly version: string;
  /** 32-hex-char trace id. */
  readonly traceId: string;
  /** 16-hex-char span/parent id. */
  readonly parentId: string;
  /** 2-hex-char flags byte. Bit 0 = sampled. */
  readonly flags: string;
}

/**
 * Trace-flags bitfield. The W3C spec reserves bits; today only
 * `SAMPLED` has meaning. Kept as a readonly enum so callers can `|`
 * them together for future flags.
 */
export const TRACE_FLAGS = Object.freeze({
  NONE: 0x00,
  SAMPLED: 0x01,
});

/**
 * Minimal RNG surface — accepts an optional `Uint8Array` filler. The
 * default uses Node's `crypto.randomBytes`, but tests inject a
 * deterministic filler so spans produced by the test suite are
 * byte-identical across runs.
 */
export interface TraceparentRng {
  /** Fill `buf` in place with cryptographically-random bytes. */
  readonly fill: (buf: Uint8Array) => void;
}

// ═══ Constants ════════════════════════════════════════════════════════════

/** Supported W3C Trace Context version(s). */
const SUPPORTED_VERSIONS: ReadonlySet<string> = new Set(["00"]);

/** `ff` is reserved and MUST be rejected per spec. */
const INVALID_VERSION = "ff";

const ALL_ZERO_TRACE_ID = "0".repeat(32);
const ALL_ZERO_SPAN_ID = "0".repeat(16);

const HEX_32_RE = /^[0-9a-f]{32}$/;
const HEX_16_RE = /^[0-9a-f]{16}$/;
const HEX_2_RE = /^[0-9a-f]{2}$/;

// ═══ RNG plumbing ═════════════════════════════════════════════════════════

const defaultRng: TraceparentRng = {
  fill: (buf) => {
    const random = randomBytes(buf.length);
    buf.set(random);
  },
};

function bytesToHex(buf: Uint8Array): string {
  let out = "";
  for (const byte of buf) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// ═══ Validation ═══════════════════════════════════════════════════════════

function isValidVersion(s: string): boolean {
  if (!HEX_2_RE.test(s)) return false;
  if (s === INVALID_VERSION) return false;
  return SUPPORTED_VERSIONS.has(s);
}

function isValidTraceId(s: string): boolean {
  return HEX_32_RE.test(s) && s !== ALL_ZERO_TRACE_ID;
}

function isValidSpanId(s: string): boolean {
  return HEX_16_RE.test(s) && s !== ALL_ZERO_SPAN_ID;
}

function isValidFlags(s: string): boolean {
  return HEX_2_RE.test(s);
}

// ═══ Parsing ══════════════════════════════════════════════════════════════

/**
 * Parse a `traceparent` header value. Returns `null` when the input
 * isn't conformant. Callers check for null and treat that as "no
 * valid upstream trace; start a fresh one".
 *
 * Spec notes honored:
 *  - Version `ff` is rejected
 *  - Unknown versions (other than `00`) are rejected conservatively;
 *    a future upgrade lives here
 *  - All-zero trace or span ids are rejected
 *  - Header value is case-sensitive (lowercase required)
 */
export function parseTraceparent(header: unknown): TraceparentFields | null {
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (trimmed.length !== 55) return null; // 2+1+32+1+16+1+2 = 55
  const parts = trimmed.split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, parentId, flags] = parts as [string, string, string, string];
  if (!isValidVersion(version)) return null;
  if (!isValidTraceId(traceId)) return null;
  if (!isValidSpanId(parentId)) return null;
  if (!isValidFlags(flags)) return null;
  return { version, traceId, parentId, flags };
}

/**
 * Format a `TraceparentFields` back into the wire header string.
 * Throws only on programmer error (fields not pre-validated) — never
 * on user input, because `parseTraceparent` already rejects bad
 * input. Use `buildTraceparent` with fresh ids for outbound calls.
 */
export function formatTraceparent(fields: TraceparentFields): string {
  if (!isValidVersion(fields.version)) {
    throw new Error(`formatTraceparent: invalid version "${fields.version}"`);
  }
  if (!isValidTraceId(fields.traceId)) {
    throw new Error(`formatTraceparent: invalid traceId`);
  }
  if (!isValidSpanId(fields.parentId)) {
    throw new Error(`formatTraceparent: invalid parentId`);
  }
  if (!isValidFlags(fields.flags)) {
    throw new Error(`formatTraceparent: invalid flags`);
  }
  return `${fields.version}-${fields.traceId}-${fields.parentId}-${fields.flags}`;
}

// ═══ ID generation ════════════════════════════════════════════════════════

function generateHexId(byteLength: number, rng: TraceparentRng): string {
  // Retry if crypto happens to produce all-zero bytes — the spec
  // rejects those, and retrying is astronomically unlikely to loop.
  for (let attempt = 0; attempt < 4; attempt++) {
    const buf = new Uint8Array(byteLength);
    rng.fill(buf);
    const hex = bytesToHex(buf);
    const allZero = byteLength === 16 ? hex === ALL_ZERO_TRACE_ID : hex === ALL_ZERO_SPAN_ID;
    if (!allZero) return hex;
  }
  // Defensive: if the RNG is broken, flip the last byte to 1 so we
  // still return a spec-valid id rather than an invalid all-zero one.
  const buf = new Uint8Array(byteLength);
  buf[byteLength - 1] = 0x01;
  return bytesToHex(buf);
}

export function generateTraceId(rng: TraceparentRng = defaultRng): string {
  return generateHexId(16, rng);
}

export function generateSpanId(rng: TraceparentRng = defaultRng): string {
  return generateHexId(8, rng);
}

// ═══ Build + child span ══════════════════════════════════════════════════

export interface BuildTraceparentOptions {
  /** Optional pre-existing trace id. When absent, a fresh one is generated. */
  readonly traceId?: string;
  /** Optional pre-existing parent/span id. When absent, generated. */
  readonly parentId?: string;
  /** Flags byte (default `"01"` = sampled). */
  readonly flags?: string;
  /** Test-injectable RNG. */
  readonly rng?: TraceparentRng;
}

/**
 * Build a new `traceparent` header. Typically used when originating a
 * new trace (no inbound parent). For propagation (have a parent),
 * prefer `childOf(parent, ...)`.
 */
export function buildTraceparent(options: BuildTraceparentOptions = {}): string {
  const rng = options.rng ?? defaultRng;
  const traceId = options.traceId ?? generateTraceId(rng);
  const parentId = options.parentId ?? generateSpanId(rng);
  const flags = options.flags ?? "01";
  return formatTraceparent({
    version: "00",
    traceId,
    parentId,
    flags,
  });
}

/**
 * Open a new child span anchored to an inbound parent. The child
 * inherits the trace id, samples according to the inbound flags, and
 * receives a freshly-generated span id.
 *
 * Returns `null` when the parent can't be parsed — callers typically
 * fall back to `buildTraceparent(opts)` to start a new trace.
 */
export function childOf(
  parent: TraceparentFields | string,
  rng: TraceparentRng = defaultRng,
): TraceparentFields | null {
  const parsed = typeof parent === "string" ? parseTraceparent(parent) : parent;
  if (!parsed) return null;
  return {
    version: parsed.version,
    traceId: parsed.traceId,
    parentId: generateSpanId(rng),
    flags: parsed.flags,
  };
}

// ═══ Header propagation ═══════════════════════════════════════════════════

/**
 * Case-insensitive header lookup. Returns the first value under any
 * key that matches `traceparent` regardless of case.
 */
export function extractTraceparent(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): TraceparentFields | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "traceparent") continue;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== "string") continue;
    return parseTraceparent(raw);
  }
  return null;
}

/**
 * Return a new headers object with `traceparent` set to the given
 * field bundle. Existing headers are preserved; the `traceparent`
 * key is normalized to lowercase. Never mutates the input.
 */
export function injectTraceparent<T extends Record<string, unknown>>(
  headers: T,
  fields: TraceparentFields,
): T & { traceparent: string } {
  const next: Record<string, unknown> = { ...headers };
  // Drop any existing case-variant of the header so we don't end up
  // with two (`Traceparent` + `traceparent`) and ambiguous ordering.
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "traceparent") delete next[key];
  }
  next["traceparent"] = formatTraceparent(fields);
  return next as T & { traceparent: string };
}

// ═══ Convenience ═════════════════════════════════════════════════════════

/**
 * Bitwise check: is this trace marked sampled? Callers use the flag
 * to short-circuit expensive observability work when the trace isn't
 * going to be recorded downstream.
 */
export function isSampled(fields: TraceparentFields): boolean {
  const flags = parseInt(fields.flags, 16);
  if (!Number.isFinite(flags)) return false;
  return (flags & TRACE_FLAGS.SAMPLED) === TRACE_FLAGS.SAMPLED;
}
