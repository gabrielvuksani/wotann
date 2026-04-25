/**
 * Error handlers — V9 T3.6 Wave 5.
 *
 * The Claude binary surfaces errors via two channels:
 *   1. Process events  — `error` / `close` with exit code
 *   2. stream-json     — `error` / `result` envelopes with subtype field
 *
 * This module is the central translation layer from "raw subprocess
 * outcome" → user-actionable error envelope. The bridge wraps the
 * spawn + stream loop and calls `classify` on every failure. Callers
 * pass the resulting `ClaudeBridgeError` to `renderUserHint` to build
 * the final UI string.
 *
 * Quality bars
 *   - QB #6 honest stubs: every error type carries a non-empty `hint` /
 *     details field. We never return a bare "unknown error".
 *   - QB #14 commit messages are claims: T3.6 integration test matrix
 *     (MASTER_PLAN_V9.md) covers spawn-enoent / auth-expired / rate-limit
 *     / network partition / stream truncation.
 */

import type { ClaudeBridgeError } from "../types.js";

// ── Classification ─────────────────────────────────────────────

export interface RawProcessFailure {
  readonly exitCode?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly stderr?: string;
  readonly bytesBuffered?: number;
  readonly resetAt?: number | null;
  readonly resultSubtype?: string;
}

/**
 * Convert a raw subprocess failure into a typed bridge error. Inspects
 * the various signals (errno, stderr text, stream-json subtype) and
 * returns the most specific match.
 */
export function classify(raw: RawProcessFailure): ClaudeBridgeError {
  // 1) Process-level: ENOENT means the binary isn't on PATH.
  if (raw.errorCode === "ENOENT") {
    return {
      kind: "spawn-enoent",
      hint: 'Install Claude Code: visit https://claude.com/download or run "npm i -g @anthropic-ai/claude-code"',
    };
  }

  // 2) stream-json subtype branches.
  switch (raw.resultSubtype) {
    case "auth_expired":
    case "auth_invalid":
      return classifyAuthExpired(raw);
    case "rate_limit":
    case "quota_exhausted":
      return {
        kind: "rate-limit",
        resetAt: raw.resetAt ?? null,
      };
    case "network_partition":
    case "stream_truncated":
      return {
        kind: "stream-truncated",
        bytesBuffered: raw.bytesBuffered ?? 0,
      };
  }

  // 3) Stderr text fallback.
  const stderr = raw.stderr ?? "";
  if (/login|expired|re-?auth/i.test(stderr)) {
    return classifyAuthExpired(raw);
  }
  if (/rate.?limit|quota/i.test(stderr)) {
    return {
      kind: "rate-limit",
      resetAt: raw.resetAt ?? null,
    };
  }
  if (/network|connection|partition/i.test(stderr)) {
    return {
      kind: "network-partition",
      bytesBuffered: raw.bytesBuffered ?? 0,
    };
  }

  return {
    kind: "unknown",
    message: raw.errorMessage ?? raw.stderr ?? `claude exited with code ${raw.exitCode ?? "?"}`,
  };
}

function classifyAuthExpired(raw: RawProcessFailure): ClaudeBridgeError {
  const text = (raw.stderr ?? "") + " " + (raw.errorMessage ?? "");
  const source = /keychain/i.test(text)
    ? "keychain"
    : /credentials/i.test(text)
      ? "file"
      : "unknown";
  return { kind: "auth-expired", source };
}

// ── Render ──────────────────────────────────────────────────────

/**
 * Build a user-facing hint string for a typed error. Used by the bridge
 * UI (TUI banner / Tauri toast) to surface a single line + a one-line
 * action prompt.
 */
export function renderUserHint(err: ClaudeBridgeError): {
  readonly headline: string;
  readonly action: string;
} {
  switch (err.kind) {
    case "spawn-enoent":
      return {
        headline: "Claude Code is not installed.",
        action: err.hint,
      };
    case "auth-expired":
      return {
        headline: `Claude Code session expired (${err.source}).`,
        action: 'Run "claude login" to re-authenticate.',
      };
    case "rate-limit":
      return {
        headline: "Claude rate limit reached.",
        action: err.resetAt
          ? `Resets at ${new Date(err.resetAt).toLocaleTimeString()}. Or switch to BYOK.`
          : "Try again in a few minutes, or switch to BYOK in Settings.",
      };
    case "network-partition":
      return {
        headline: "Network connection lost mid-session.",
        action: `Buffered ${err.bytesBuffered} bytes; retrying — your prompt is preserved.`,
      };
    case "stream-truncated":
      return {
        headline: "Claude session ended unexpectedly.",
        action: `Stream stopped mid-response after ${err.bytesBuffered} bytes — restart the session.`,
      };
    case "unknown":
      return {
        headline: "Claude Code error.",
        action: err.message,
      };
    default: {
      const _exhaustive: never = err;
      void _exhaustive;
      return {
        headline: "Claude Code error.",
        action: "An unexpected error occurred.",
      };
    }
  }
}

// ── Retry policy ───────────────────────────────────────────────

/**
 * Decide whether a typed error is retriable. Used by the bridge's outer
 * loop to decide between "show user a banner" and "transparently retry
 * with the same prompt".
 */
export function isRetriable(err: ClaudeBridgeError): boolean {
  switch (err.kind) {
    case "network-partition":
    case "stream-truncated":
      return true;
    case "rate-limit":
      // Retriable but only after the reset window — caller backs off.
      return false;
    case "spawn-enoent":
    case "auth-expired":
    case "unknown":
      return false;
    default: {
      const _exhaustive: never = err;
      void _exhaustive;
      return false;
    }
  }
}
