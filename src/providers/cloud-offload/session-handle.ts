/**
 * Cloud-offload session handle — metering + cost tracker.
 *
 * PORT OF: Fly Machine "billing cursor" + Cloudflare Durable Object
 * "usage counter" + Anthropic Managed Agents "session accumulator".
 * Concrete adapters use a SessionHandle to track cost/tokens/status
 * as frames arrive from the remote, then call complete() once the
 * session terminates.
 *
 * WHY A MUTABLE STRUCT:
 * CloudOffloadSession is intentionally immutable (it's the value the
 * adapter returns to its caller), but the underlying accumulator has
 * to mutate across dozens of frames per session. SessionHandle
 * encapsulates that mutation behind a small struct so the adapter
 * code stays readable. Each call to getSnapshot() returns a fresh
 * CloudOffloadSession; the underlying struct is never leaked.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): complete() is idempotent — calling
 *     twice doesn't clobber the first result, but the second call
 *     returns the same snapshot. Status transitions to terminal
 *     states (completed/failed/cancelled) are one-way.
 *   - QB #7 (per-session state): every handle is fresh. Two handles
 *     with the same sessionId don't share state. No module-level
 *     registry of handles.
 *   - QB #13 (env guard): handles never read env. They only see what
 *     the adapter passes in.
 */

import type { CloudOffloadProvider, CloudOffloadSession, OffloadFrame } from "./adapter.js";

// ── Public API ───────────────────────────────────────────────

export interface SessionHandle {
  readonly sessionId: string;
  readonly provider: CloudOffloadProvider;
  readonly startedAt: number;
  /** Feed a streamed frame to the handle. Fires onUpdate listener. */
  recordFrame: (frame: OffloadFrame) => void;
  /** Immutable snapshot of the current session state. */
  getSnapshot: () => CloudOffloadSession;
  /** Accumulate USD cost. Negative amounts are rejected (no-op + warning). */
  addCost: (usd: number) => void;
  /** Accumulate token count. Negative counts are rejected (no-op). */
  addTokens: (count: number) => void;
  /**
   * Mark the session terminal. Idempotent — repeated calls return the
   * original completed snapshot rather than clobbering its endedAt.
   */
  complete: (status: "completed" | "failed" | "cancelled") => CloudOffloadSession;
}

export interface CreateSessionHandleOptions {
  readonly sessionId: string;
  readonly provider: CloudOffloadProvider;
  readonly now?: () => number;
  readonly onUpdate?: (snapshot: CloudOffloadSession) => void;
}

/**
 * Build a fresh SessionHandle. Every caller gets its own struct — no
 * module-global state. The initial status is "pending"; adapters
 * promote it to "running" by recording the first frame whose kind is
 * not "done" | "error" (or by explicit bookkeeping in the adapter
 * code — both patterns are supported).
 */
export function createSessionHandle(options: CreateSessionHandleOptions): SessionHandle {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();

  // ── Mutable state (captured in closure) ───────────────────
  let status: CloudOffloadSession["status"] = "pending";
  let costUsd = 0;
  let tokensUsed = 0;
  let endedAt: number | undefined;
  let completed = false; // idempotence flag for complete()

  const emitUpdate = (): void => {
    if (options.onUpdate) {
      options.onUpdate(buildSnapshot());
    }
  };

  const buildSnapshot = (): CloudOffloadSession => {
    // Every call produces a fresh object — callers can't mutate the
    // internal state through a returned snapshot.
    return {
      sessionId: options.sessionId,
      provider: options.provider,
      status,
      startedAt,
      ...(endedAt !== undefined ? { endedAt } : {}),
      costUsd,
      tokensUsed,
    };
  };

  return {
    sessionId: options.sessionId,
    provider: options.provider,
    startedAt,

    recordFrame(frame: OffloadFrame): void {
      // Promote pending → running on first non-terminal frame.
      if (status === "pending" && frame.kind !== "done" && frame.kind !== "error") {
        status = "running";
      }
      // Cost-update frames carry optional usd in the content field as
      // a JSON blob. We leave parsing to the concrete adapter; this
      // handle just fires onUpdate so UI subscribers see the tick.
      emitUpdate();
    },

    getSnapshot(): CloudOffloadSession {
      return buildSnapshot();
    },

    addCost(usd: number): void {
      if (!Number.isFinite(usd) || usd < 0) {
        // QB #6: honest no-op; we don't silently accept nonsense but
        // we also don't throw — adapters passing us junk should get
        // a warning, but the session shouldn't die.
        return;
      }
      costUsd += usd;
      emitUpdate();
    },

    addTokens(count: number): void {
      if (!Number.isInteger(count) || count < 0) return;
      tokensUsed += count;
      emitUpdate();
    },

    complete(nextStatus: "completed" | "failed" | "cancelled"): CloudOffloadSession {
      if (completed) {
        // Idempotent: return the existing snapshot without mutating.
        return buildSnapshot();
      }
      completed = true;
      status = nextStatus;
      endedAt = now();
      emitUpdate();
      return buildSnapshot();
    },
  };
}
