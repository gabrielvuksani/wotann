/**
 * Cursor Stream — WOTANN Phase 3 P1-F2 (dedicated real-time cursor primitives).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S2 and MASTER_PLAN_V8
 * §5 P1-F2 (1 day), F1 already ships `cursor` as part of the session event
 * type union. F2 layers a stateless enrichment pipeline ON TOP of the session
 * store so desktop-control agents physically moving a mouse can stream
 * coordinates to iOS `CursorOverlayView` in real time — without poisoning the
 * session event log with 100+ events per second.
 *
 * Pipeline:
 *   record(event)
 *     │
 *     ├── validate coordinates (NaN / negative / oversize → ErrorInvalidCoordinates)
 *     ├── verify session exists (→ ErrorSessionNotFound)
 *     ├── if action=move: micro-batch at 30fps (coalesceWindowMs, default 33ms)
 *     │     ├── within window → replace pending event with latest (1 emit max)
 *     │     └── no pending → schedule emit at t+coalesceWindowMs
 *     └── if action=click | scroll: emit immediately (discrete, never coalesced)
 *
 * Emit path writes through:
 *   1. `ComputerSessionStore.emitSessionEvent(type="cursor", payload=...)` — the
 *      canonical event log (F1). Tested via fleet-view + session stream RPCs.
 *   2. F11 `UnifiedDispatchPlane.broadcastUnifiedEvent({type:"cursor", ...})` —
 *      multi-surface fan-out for the desktop agents-window HUD + phone overlay.
 *
 * Design principles (session quality bars referenced inline):
 *
 *   QB #6 (honest failures) — invalid coords and missing sessions raise
 *   typed errors (ErrorInvalidCoordinates, ErrorSessionNotFound). No
 *   silent swallowing; callers get a discriminable class.
 *
 *   QB #7 (per-session state) — throttle state lives in a per-instance Map
 *   keyed by sessionId. Multiple daemons/tests get isolated state; no
 *   module globals.
 *
 *   QB #8 (singleton threading) — the KairosRPCHandler owns ONE instance,
 *   threaded via constructor into the handler. Bridges and tests construct
 *   their own via the public constructor.
 *
 *   QB #11 (sibling-site scan) — fleet-view.ts already references
 *   "100 cursor events in a row" as a coalescing target for its debounce
 *   pipeline (separate concern — fleet-view debounces FleetSnapshot
 *   construction, not individual events). This stream adds per-session
 *   event-level coalescing ahead of the session emitter.
 *
 *   QB #12 (deterministic tests) — caller-supplied `now()` + scheduler
 *   functions drive coalescing timing. Default uses Date.now() + setTimeout,
 *   tests swap in a FakeClock + manual drain.
 *
 *   QB #14 (claim verification) — RPC wiring in kairos-rpc.ts is exercised
 *   by end-to-end tests in tests/session/cursor-stream.test.ts.
 */

import type { ComputerSessionStore, Session } from "./computer-session-store.js";
import type { UnifiedEvent } from "../channels/fan-out.js";

// ── Types ──────────────────────────────────────────────────

export type CursorAction = "move" | "click" | "scroll";

/**
 * A cursor sample emitted by a desktop-control agent. Coordinates are in
 * screen-native pixels (iOS applies its own DPR transform on render). `screenId`
 * disambiguates multi-monitor desktops — null for single-display sessions.
 */
export interface CursorSample {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly x: number;
  readonly y: number;
  readonly action: CursorAction;
  readonly screenId?: string | null;
  /** Optional button metadata for click events ("left" | "right" | "middle"). */
  readonly button?: string;
  /** Optional scroll delta for scroll events ({dx, dy}). */
  readonly deltaX?: number;
  readonly deltaY?: number;
}

// ── Errors (QB #6) ─────────────────────────────────────────

export class ErrorInvalidCoordinates extends Error {
  readonly code = "CURSOR_INVALID_COORDINATES";
  readonly x: number;
  readonly y: number;
  readonly reason: string;
  constructor(x: number, y: number, reason: string) {
    super(`Invalid cursor coordinates (${x}, ${y}): ${reason}`);
    this.name = "ErrorInvalidCoordinates";
    this.x = x;
    this.y = y;
    this.reason = reason;
  }
}

export class ErrorSessionNotFound extends Error {
  readonly code = "CURSOR_SESSION_NOT_FOUND";
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Cursor session not found: ${sessionId}`);
    this.name = "ErrorSessionNotFound";
    this.sessionId = sessionId;
  }
}

// ── Config ────────────────────────────────────────────────

export interface CursorStreamConfig {
  /**
   * Coalescing window for `move` events. Two moves within this span for the
   * same session keep only the latest. Default 33ms ≈ 30fps — matches
   * CursorOverlayView's display-refresh budget on ProMotion iPhones.
   */
  readonly coalesceWindowMs: number;
  /**
   * Upper bound on coordinate values — rejected beyond this. 16384 covers
   * 4x 4K-ish displays stacked; anything larger is surely a unit error
   * (the classic "received inches instead of pixels" bug).
   */
  readonly maxCoordinate: number;
}

const DEFAULT_CONFIG: CursorStreamConfig = {
  coalesceWindowMs: 33,
  maxCoordinate: 16384,
};

/**
 * Optional broadcast hook. When wired (typically via
 * UnifiedDispatchPlane.broadcastUnifiedEvent per F11), each emitted cursor
 * sample fans out to every registered surface so the iOS CursorOverlayView
 * + desktop agents-window can render in lock-step. Best-effort — failures
 * never roll back the session emit.
 */
export type BroadcastFn = (event: UnifiedEvent) => void | Promise<void>;

/**
 * Scheduler for the coalesce flush timer. Production uses setTimeout /
 * clearTimeout; tests inject a deterministic scheduler that exposes
 * `runAll()` / `advance(ms)` for step-through control.
 */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const DEFAULT_SCHEDULER: Scheduler = {
  setTimeout: (fn, ms) => {
    const h = globalThis.setTimeout(fn, ms);
    // Ensure timers don't keep the Node event loop alive during tests — the
    // handler is a daemon primitive, not a critical-path worker.
    if (typeof (h as { unref?: () => void }).unref === "function") {
      (h as { unref: () => void }).unref();
    }
    return h;
  },
  clearTimeout: (handle) => {
    if (handle !== null && handle !== undefined) {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    }
  },
};

export interface CursorStreamOptions {
  readonly store: ComputerSessionStore;
  readonly now?: () => number;
  readonly scheduler?: Scheduler;
  readonly broadcast?: BroadcastFn;
  readonly coalesceWindowMs?: number;
  readonly maxCoordinate?: number;
}

// ── Per-session throttle state ────────────────────────────

interface ThrottleState {
  /** Most recently received move sample; null if no move pending flush. */
  pending: CursorSample | null;
  /** Scheduler handle for the pending flush timer. */
  handle: unknown;
  /** Timestamp (from clock()) at which the next flush is scheduled. */
  flushAt: number;
}

// ── Stream ────────────────────────────────────────────────

/**
 * Enrichment + coalescing layer for cursor samples. Stateless at the type
 * level — only the per-session flush state lives here, never business
 * logic. Callers (desktop-control agents, RPC handlers, tests) invoke
 * `record(sample)` and the pipeline handles validation, throttling, and
 * fan-out.
 */
export class CursorStream {
  private readonly store: ComputerSessionStore;
  private readonly clock: () => number;
  private readonly scheduler: Scheduler;
  private broadcast: BroadcastFn | null;
  private readonly config: CursorStreamConfig;
  /** Per-session throttle state. Keyed by sessionId — QB #7 per-instance. */
  private readonly throttle = new Map<string, ThrottleState>();

  constructor(options: CursorStreamOptions) {
    if (!options.store) {
      throw new Error("CursorStream requires a ComputerSessionStore");
    }
    this.store = options.store;
    this.clock = options.now ?? (() => Date.now());
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.broadcast = options.broadcast ?? null;
    this.config = {
      coalesceWindowMs: options.coalesceWindowMs ?? DEFAULT_CONFIG.coalesceWindowMs,
      maxCoordinate: options.maxCoordinate ?? DEFAULT_CONFIG.maxCoordinate,
    };
  }

  /**
   * Attach (or replace / detach with null) the broadcast hook after
   * construction. Needed because the dispatch plane is set by the daemon
   * AFTER the RPC handler creates the stream.
   */
  setBroadcast(fn: BroadcastFn | null): void {
    this.broadcast = fn;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Ingest a cursor sample. Validates, verifies session, then either
   * coalesces (moves) or emits immediately (clicks / scrolls). Returns
   * `"emitted"` if the sample hit the wire, `"coalesced"` if it was
   * merged into a pending flush. Throws on invalid input.
   */
  record(sample: CursorSample): "emitted" | "coalesced" {
    const validated = this.validateSample(sample);
    this.requireSession(validated.sessionId);

    if (validated.action === "move") {
      return this.recordMove(validated);
    }
    // click / scroll — discrete, never coalesced (QB #6: honest semantics).
    this.emit(validated);
    return "emitted";
  }

  /**
   * Drop any pending flushes and clear per-session state. Called on
   * shutdown (daemon stop) so outstanding timers don't keep Node alive.
   * Idempotent.
   */
  close(): void {
    for (const state of this.throttle.values()) {
      this.scheduler.clearTimeout(state.handle);
    }
    this.throttle.clear();
  }

  /**
   * Flush any pending coalesced move for a specific session immediately.
   * Useful on session close so the final coordinate lands before the
   * session transitions to terminal. No-op if nothing pending.
   */
  flush(sessionId: string): void {
    const state = this.throttle.get(sessionId);
    if (!state || !state.pending) return;
    this.scheduler.clearTimeout(state.handle);
    const sample = state.pending;
    this.throttle.delete(sessionId);
    this.emit(sample);
  }

  /**
   * Flush every pending coalesced move across every session. Called on
   * shutdown so the last known coordinate per session lands.
   */
  flushAll(): void {
    const ids = [...this.throttle.keys()];
    for (const id of ids) {
      this.flush(id);
    }
  }

  /** Count of sessions currently holding a pending coalesced move. */
  pendingSessionCount(): number {
    let n = 0;
    for (const state of this.throttle.values()) {
      if (state.pending) n += 1;
    }
    return n;
  }

  // ── Internal ──────────────────────────────────────────

  /**
   * Micro-batch move events per session. If a prior move is still within
   * the coalesce window, replace the pending sample (latest-wins) and
   * let the existing flush timer carry it through. If no prior pending,
   * schedule a flush `coalesceWindowMs` in the future.
   */
  private recordMove(sample: CursorSample): "emitted" | "coalesced" {
    const sessionId = sample.sessionId;
    const existing = this.throttle.get(sessionId);

    // No prior pending: start a new coalesce window. First move under a
    // fresh window is held until the timer fires; this is CHEAPER than
    // firing immediately and then debouncing — a single 30fps flush vs
    // an immediate + a coalesced delayed flush is smoother for the UI.
    if (!existing || !existing.pending) {
      const flushAt = this.clock() + this.config.coalesceWindowMs;
      const state: ThrottleState = {
        pending: sample,
        flushAt,
        handle: this.scheduler.setTimeout(
          () => this.onFlushTimer(sessionId),
          this.config.coalesceWindowMs,
        ),
      };
      this.throttle.set(sessionId, state);
      return "coalesced";
    }

    // Pending move exists: replace with latest (newest-wins) and keep the
    // already-scheduled flush timer. No new timer needed — the existing
    // timer will pick up the replaced sample when it fires.
    existing.pending = sample;
    return "coalesced";
  }

  private onFlushTimer(sessionId: string): void {
    const state = this.throttle.get(sessionId);
    if (!state || !state.pending) return;
    const sample = state.pending;
    // Drop the state BEFORE emit so any recursive emit-triggered record
    // (shouldn't happen, but be defensive) sees a clean slate.
    this.throttle.delete(sessionId);
    this.emit(sample);
  }

  /**
   * Emit through both sinks: the session event log (F1) and the dispatch
   * plane (F11). Broadcast failures are swallowed — the session log is
   * the canonical record, and cross-surface fan-out is best-effort.
   */
  private emit(sample: CursorSample): void {
    const payload: Record<string, unknown> = {
      deviceId: sample.deviceId,
      x: sample.x,
      y: sample.y,
      action: sample.action,
    };
    if (sample.screenId !== undefined && sample.screenId !== null) {
      payload["screenId"] = sample.screenId;
    }
    if (sample.button !== undefined) payload["button"] = sample.button;
    if (sample.deltaX !== undefined) payload["deltaX"] = sample.deltaX;
    if (sample.deltaY !== undefined) payload["deltaY"] = sample.deltaY;

    // Session-log side: writes into F1's event stream via the dedicated
    // cursor emit API. Failures here propagate — the caller asked for a
    // session emit and we must be honest if the session rejects it.
    this.store.emitCursorEvent({ sessionId: sample.sessionId, payload });

    // Cross-surface side: broadcast a UnifiedEvent{type:"cursor"} for F11
    // registered surfaces. Best-effort — see class docstring.
    if (this.broadcast) {
      const event: UnifiedEvent = {
        type: "cursor",
        timestamp: this.clock(),
        payload: {
          sessionId: sample.sessionId,
          ...payload,
        },
      };
      try {
        const result = this.broadcast(event);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {
            // Broadcast failures must not roll back the session emit.
          });
        }
      } catch {
        // Same reasoning — best-effort fan-out.
      }
    }
  }

  private validateSample(sample: CursorSample): CursorSample {
    if (!sample || typeof sample !== "object") {
      throw new Error("sample must be an object");
    }
    if (typeof sample.sessionId !== "string" || sample.sessionId.trim() === "") {
      throw new Error("sample.sessionId (non-empty string) required");
    }
    if (typeof sample.deviceId !== "string" || sample.deviceId.trim() === "") {
      throw new Error("sample.deviceId (non-empty string) required");
    }
    if (sample.action !== "move" && sample.action !== "click" && sample.action !== "scroll") {
      throw new Error("sample.action must be one of move|click|scroll");
    }
    // Coordinates: finite, non-negative, within maxCoordinate. The upper
    // cap guards against accidental unit errors (inches vs pixels) and
    // prevents integer-overflow mischief downstream.
    if (!Number.isFinite(sample.x)) {
      throw new ErrorInvalidCoordinates(sample.x, sample.y, "x is not finite");
    }
    if (!Number.isFinite(sample.y)) {
      throw new ErrorInvalidCoordinates(sample.x, sample.y, "y is not finite");
    }
    if (sample.x < 0) {
      throw new ErrorInvalidCoordinates(sample.x, sample.y, "x is negative");
    }
    if (sample.y < 0) {
      throw new ErrorInvalidCoordinates(sample.x, sample.y, "y is negative");
    }
    if (sample.x > this.config.maxCoordinate) {
      throw new ErrorInvalidCoordinates(
        sample.x,
        sample.y,
        `x exceeds maxCoordinate ${this.config.maxCoordinate}`,
      );
    }
    if (sample.y > this.config.maxCoordinate) {
      throw new ErrorInvalidCoordinates(
        sample.x,
        sample.y,
        `y exceeds maxCoordinate ${this.config.maxCoordinate}`,
      );
    }
    return sample;
  }

  private requireSession(sessionId: string): Session {
    const session = this.store.getOrNull(sessionId);
    if (!session) {
      throw new ErrorSessionNotFound(sessionId);
    }
    return session;
  }
}
