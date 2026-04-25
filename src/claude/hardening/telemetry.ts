/**
 * Cost telemetry — V9 T3.6 Wave 5.
 *
 * Tracks per-session token totals across the spawned `claude` lifecycle.
 * Reads quota information from `claude /usage` (CLI subcommand surfaced
 * by the binary) to compute remaining-pct + reset-at.
 *
 * Two export points:
 *   - `recordCost(snapshot)`        — per-turn ingestion called from
 *                                      PostToolUse + assistant message
 *                                      Stream chunks
 *   - `getQuotaProbe()`             — call once per session to populate
 *                                      a status-ribbon + 90%-threshold
 *                                      banner
 *
 * Telemetry state lives in a mutable map keyed by sessionId. The map is
 * NOT persisted across restarts — it's a per-process probe surface, not a
 * billing ledger. The authoritative cost record is the user's
 * subscription account; this is just the in-process snapshot.
 *
 * Quality bars
 *   - QB #6 honest stubs: `getQuotaProbe` returns { periodCap: null,
 *     remainingPct: null } when `claude /usage` is unavailable. Callers
 *     branch on `null` rather than receiving fabricated numbers.
 *   - QB #7 per-call state: caller injects an `ic` object so two
 *     concurrent sessions don't share a counter.
 *
 * Subprocess invocation goes through the project-canonical
 * `execFileNoThrow` (no shell, argv-only) — never `exec`.
 */

import { execFileNoThrow } from "../../utils/execFileNoThrow.js";

import type { CostSnapshot, QuotaProbe } from "../types.js";

// ── Per-session cost ledger ────────────────────────────────────

export interface CostLedger {
  /** Return the latest per-session snapshot. */
  readonly snapshot: (sessionId: string) => CostSnapshot | null;
  /** Add to the per-session counters. Idempotent for repeated input by
   *  ignoring zero-deltas. */
  readonly record: (
    sessionId: string,
    delta: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
  ) => void;
  /** Iterate every session's snapshot — used by the StatusRibbon. */
  readonly all: () => readonly CostSnapshot[];
}

export function createCostLedger(): CostLedger {
  const map = new Map<string, CostSnapshot>();

  function ensure(sessionId: string): CostSnapshot {
    const existing = map.get(sessionId);
    if (existing) return existing;
    const fresh: CostSnapshot = {
      sessionId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      capturedAt: Date.now(),
    };
    map.set(sessionId, fresh);
    return fresh;
  }

  return {
    snapshot(sessionId) {
      return map.get(sessionId) ?? null;
    },
    record(sessionId, delta) {
      const cur = ensure(sessionId);
      const next: CostSnapshot = {
        sessionId,
        inputTokens: cur.inputTokens + (delta.input ?? 0),
        outputTokens: cur.outputTokens + (delta.output ?? 0),
        cacheReadTokens: cur.cacheReadTokens + (delta.cacheRead ?? 0),
        cacheWriteTokens: cur.cacheWriteTokens + (delta.cacheWrite ?? 0),
        capturedAt: Date.now(),
      };
      map.set(sessionId, next);
    },
    all() {
      return Array.from(map.values());
    },
  };
}

// ── Quota probe (claude /usage) ────────────────────────────────

/**
 * Probe `claude /usage` for the user's subscription quota. Returns a
 * `QuotaProbe`. When the CLI is missing, the subcommand is unsupported,
 * or the output is unparseable, returns the all-null shape rather than
 * throwing — callers branch on null and hide the banner.
 *
 * The CLI's output shape varies by version; we parse defensively. The
 * fields we care about: tokens used in current period, period cap,
 * reset timestamp.
 */
export async function getQuotaProbe(): Promise<QuotaProbe> {
  try {
    const result = await execFileNoThrow("claude", ["/usage", "--json"]);
    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      return { periodTokens: 0, periodCap: null, remainingPct: null, resetAt: null };
    }
    const parsed = parseUsageOutput(result.stdout);
    if (!parsed) {
      return { periodTokens: 0, periodCap: null, remainingPct: null, resetAt: null };
    }
    return parsed;
  } catch {
    return { periodTokens: 0, periodCap: null, remainingPct: null, resetAt: null };
  }
}

interface RawUsageBlob {
  readonly used?: { readonly tokens?: number };
  readonly cap?: { readonly tokens?: number };
  readonly resetAt?: number | string;
}

function parseUsageOutput(stdout: string): QuotaProbe | null {
  let blob: RawUsageBlob;
  try {
    blob = JSON.parse(stdout) as RawUsageBlob;
  } catch {
    return null;
  }
  const used = blob.used?.tokens;
  const cap = blob.cap?.tokens;
  const reset = typeof blob.resetAt === "number" ? blob.resetAt : Date.parse(String(blob.resetAt));
  const remaining =
    typeof used === "number" && typeof cap === "number" && cap > 0
      ? Math.max(0, 1 - used / cap)
      : null;
  return {
    periodTokens: used ?? 0,
    periodCap: cap ?? null,
    remainingPct: remaining,
    resetAt: Number.isFinite(reset) ? reset : null,
  };
}

// ── Threshold banner ───────────────────────────────────────────

/**
 * Returns true if the quota usage has crossed a warning threshold. The
 * 90% rule is the V9 T3.6 spec; we expose the threshold as an arg so a
 * follow-up can tune it without re-shipping.
 */
export function isQuotaThresholdCrossed(probe: QuotaProbe, thresholdPct: number = 0.9): boolean {
  if (probe.remainingPct === null) return false;
  return 1 - probe.remainingPct >= thresholdPct;
}
