/**
 * Session Handoff Manager — WOTANN Phase 3 P1-F14 (cross-session resume).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §7 — phone start,
 * desktop continue, TUI finish. A session claimed on one surface can be
 * handed off to another; source loses write permission the moment the
 * handoff is initiated, target gains write permission on accept.
 *
 * This module is a thin policy/orchestration layer ON TOP of the
 * ComputerSessionStore. The store owns the session state machine and
 * audit trail; this manager adds:
 *
 *   - TTL enforcement via a timer the caller can cancel/deterministically
 *     drive in tests (no `setTimeout` reliance for tests that use
 *     `acceptHandoff(..., { now: ... })`).
 *   - UnifiedEvent broadcasting (F11 pattern): every initiate/accept/expire
 *     fans out via `broadcastUnifiedEvent` so surfaces not subscribed via
 *     F1's session-event bridge (e.g. push-notification surfaces registered
 *     through SurfaceRegistry) still observe the handoff.
 *   - Device registry integration: a constructor-injected predicate
 *     decides whether a target device is known. Default predicate accepts
 *     everything (test-friendly); production callers wire this to the
 *     channel gateway's device registry.
 *
 * Per QB #7 this is per-session state — instantiate one manager per
 * ComputerSessionStore, never as a module global.
 *
 * Per QB #6 every failure path raises a typed error; no silent swallowing.
 *
 * Per QB #11 we did a sibling-site scan for existing handoff machinery
 * before writing: `grep -rn "handoff\|hand-off"` in src/session and
 * src/daemon found only the unrelated Continuity-camera (iOS frame)
 * plumbing in kairos-rpc.ts:5728. The cross-session-resume surface is
 * fresh ground.
 */

import type { ComputerSessionStore, HandoffRecord, Session } from "./computer-session-store.js";
import type { UnifiedEvent } from "../channels/fan-out.js";

// ── Config ──────────────────────────────────────────────

export interface HandoffManagerConfig {
  /** Milliseconds before a pending handoff auto-expires. Default 60s. */
  readonly defaultTtlMs: number;
}

const DEFAULT_CONFIG: HandoffManagerConfig = {
  defaultTtlMs: 60_000,
};

// ── Dependencies ─────────────────────────────────────────

/**
 * Validates that a target device is currently registered / reachable. Kept
 * as a predicate rather than a concrete DeviceRegistry import so the
 * session layer does not take a channel-layer dependency.
 */
export type DeviceRegisteredPredicate = (deviceId: string) => boolean;

/**
 * Fan-out hook. When wired (typically to UnifiedDispatchPlane.broadcastUnifiedEvent
 * per F11), each handoff lifecycle step reaches every registered surface.
 * Silently tolerated if undefined — tests and minimal daemons can run
 * without a dispatch plane.
 */
export type BroadcastFn = (event: UnifiedEvent) => void | Promise<void>;

export interface HandoffManagerOptions {
  readonly store: ComputerSessionStore;
  readonly isTargetRegistered?: DeviceRegisteredPredicate;
  readonly broadcast?: BroadcastFn;
  readonly config?: Partial<HandoffManagerConfig>;
  /**
   * Override for setTimeout/clearTimeout — makes tests deterministic.
   * Default uses global setTimeout.
   */
  readonly scheduler?: {
    readonly setTimeout: (fn: () => void, ms: number) => unknown;
    readonly clearTimeout: (handle: unknown) => void;
  };
}

// ── Manager ──────────────────────────────────────────────

/**
 * Threads a ComputerSessionStore through the F14 handoff lifecycle.
 *
 * Usage:
 *   const mgr = new SessionHandoffManager({
 *     store,
 *     isTargetRegistered: (id) => gateway.hasDevice(id),
 *     broadcast: (ev) => plane.broadcastUnifiedEvent(ev),
 *   });
 *   const { handoff } = mgr.initiate({
 *     sessionId, fromDeviceId, toDeviceId, reason: "moving to desktop",
 *   });
 *   // ... target device receives the handoff via its surface ...
 *   await mgr.accept({ sessionId, handoffId: handoff.id, deviceId: desktopId });
 */
export class SessionHandoffManager {
  private readonly store: ComputerSessionStore;
  private isTargetRegistered: DeviceRegisteredPredicate;
  private broadcast: BroadcastFn | null;
  private readonly config: HandoffManagerConfig;
  private readonly schedulerSetTimeout: (fn: () => void, ms: number) => unknown;
  private readonly schedulerClearTimeout: (handle: unknown) => void;
  private readonly timers = new Map<string, unknown>();

  constructor(options: HandoffManagerOptions) {
    this.store = options.store;
    this.isTargetRegistered = options.isTargetRegistered ?? (() => true);
    this.broadcast = options.broadcast ?? null;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.schedulerSetTimeout = options.scheduler?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.schedulerClearTimeout =
      options.scheduler?.clearTimeout ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /**
   * Attach (or replace, or detach with null) the UnifiedDispatch broadcast
   * hook after construction. Needed because the dispatch plane is set by
   * the daemon/runtime wiring AFTER the RPC handler creates the manager.
   */
  setBroadcast(fn: BroadcastFn | null): void {
    this.broadcast = fn;
  }

  /**
   * Swap the device-registration predicate post-construction. Used when
   * the RPC handler gets the device-registry instance only after wiring
   * up the runtime. Null/undefined resets to the permissive default.
   */
  setDeviceRegistryPredicate(fn: DeviceRegisteredPredicate | null): void {
    this.isTargetRegistered = fn ?? (() => true);
  }

  // ── Lifecycle ──────────────────────────────────────────

  /**
   * Initiate a handoff. Schedules a TTL timer; on fire, expires the
   * handoff and restores the original claimant. Any subsequent accept
   * arriving after expiry throws ErrorHandoffExpired via the store.
   */
  initiate(params: {
    readonly sessionId: string;
    readonly fromDeviceId: string;
    readonly toDeviceId: string;
    readonly reason?: string | null;
    readonly ttlMs?: number;
  }): { readonly session: Session; readonly handoff: HandoffRecord } {
    const ttlMs = params.ttlMs ?? this.config.defaultTtlMs;
    const result = this.store.initiateHandoff({
      sessionId: params.sessionId,
      fromDeviceId: params.fromDeviceId,
      toDeviceId: params.toDeviceId,
      reason: params.reason,
      ttlMs,
      isTargetRegistered: this.isTargetRegistered,
    });

    // Schedule TTL. When fired, attempt expire — may race with a late
    // accept; either outcome is observable and audit-logged via the store.
    const timerHandle = this.schedulerSetTimeout(() => {
      this.timers.delete(result.handoff.id);
      try {
        this.store.expireHandoff({
          sessionId: params.sessionId,
          handoffId: result.handoff.id,
        });
        this.emit({
          type: "session",
          timestamp: Date.now(),
          payload: {
            action: "handoff_expired",
            sessionId: params.sessionId,
            handoffId: result.handoff.id,
            fromDeviceId: params.fromDeviceId,
            toDeviceId: params.toDeviceId,
          },
        });
      } catch {
        // Handoff was already accepted/expired — expected race. The store
        // emits its own audit event from whichever path resolved first.
      }
    }, ttlMs);
    this.timers.set(result.handoff.id, timerHandle);

    this.emit({
      type: "session",
      timestamp: Date.now(),
      payload: {
        action: "handoff_initiated",
        sessionId: params.sessionId,
        handoffId: result.handoff.id,
        fromDeviceId: params.fromDeviceId,
        toDeviceId: params.toDeviceId,
        reason: result.handoff.reason,
        expiresAt: result.handoff.expiresAt,
      },
    });

    return result;
  }

  /**
   * Target accepts. Cancels the TTL timer. Caller should pass `now` in
   * tests if they want deterministic late-accept exercise.
   */
  accept(params: {
    readonly sessionId: string;
    readonly handoffId: string;
    readonly deviceId: string;
    readonly now?: number;
  }): Session {
    const session = this.store.acceptHandoff(params);
    this.cancelTimer(params.handoffId);
    this.emit({
      type: "session",
      timestamp: Date.now(),
      payload: {
        action: "handoff_accepted",
        sessionId: params.sessionId,
        handoffId: params.handoffId,
        toDeviceId: params.deviceId,
      },
    });
    return session;
  }

  /**
   * Explicitly expire a handoff (e.g. user dismissal). Cancels the TTL
   * timer. If the handoff is already accepted/expired, the store's error
   * surfaces to the caller.
   */
  expire(params: {
    readonly sessionId: string;
    readonly handoffId: string;
    readonly now?: number;
  }): Session {
    const session = this.store.expireHandoff(params);
    this.cancelTimer(params.handoffId);
    this.emit({
      type: "session",
      timestamp: Date.now(),
      payload: {
        action: "handoff_expired",
        sessionId: params.sessionId,
        handoffId: params.handoffId,
      },
    });
    return session;
  }

  /** Returns the number of pending timers. Exposed for tests only. */
  pendingTimerCount(): number {
    return this.timers.size;
  }

  /**
   * Release all pending timers. Call on daemon shutdown to avoid
   * unreferenced Node timer handles leaking.
   */
  dispose(): void {
    for (const handle of this.timers.values()) {
      this.schedulerClearTimeout(handle);
    }
    this.timers.clear();
  }

  // ── Internal ──────────────────────────────────────────

  private cancelTimer(handoffId: string): void {
    const handle = this.timers.get(handoffId);
    if (handle !== undefined) {
      this.schedulerClearTimeout(handle);
      this.timers.delete(handoffId);
    }
  }

  private emit(event: UnifiedEvent): void {
    if (!this.broadcast) return;
    try {
      const result = this.broadcast(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          // Broadcast failures do not block the handoff lifecycle — the
          // store event stream remains the canonical record.
        });
      }
    } catch {
      // Same reasoning — broadcast is best-effort.
    }
  }
}
