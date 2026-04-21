/**
 * Live Activity Manager — WOTANN Phase 3 P1-F3 (iOS Dynamic Island primitive).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S3 and MASTER_PLAN_V8
 * §5 P1-F3 (2 days), F1 already ships `step` as part of the `SessionEvent`
 * type union AND as a valid `UnifiedEventType`. F3 adds a rate-limited,
 * Live-Activity-shaped marshaling layer so iOS Dynamic Island / Live
 * Activities get a compact progress payload WITHOUT being flooded by
 * raw step events (APNs budget: ~1 push/sec per activity).
 *
 * Scope:
 *   - Compact format for the rolled Dynamic Island: title + progress + icon.
 *   - Expanded format for the full Live Activity: compact + expandedDetail +
 *     firstSeenAt/lastUpdatedAt timestamps (so watch/phone can render
 *     relative ages without a re-fetch).
 *   - Per-session rate limit of 1 update/sec. Bursts keep only the latest
 *     step (newest-wins) — matches the F2 cursor coalescing shape, but
 *     wall-window based instead of scheduler-debounced.
 *   - Batched multi-session dispatch via `flushAll()` and `pending()` —
 *     surfaces pulling state catch up without waiting for the next emit.
 *
 * Design principles (session quality bars referenced inline):
 *
 *   QB #6 (honest failures) — invalid title/progress/unknown session raise
 *   typed errors (ErrorTitleTooLong, ErrorInvalidProgress, ErrorSessionNotFound,
 *   ErrorInvalidTitle, ErrorInvalidIcon, ErrorInvalidExpandedDetail). No
 *   silent swallowing.
 *
 *   QB #7 (per-session state) — per-session rate-limit state + last-step
 *   live in per-instance Maps keyed by sessionId. Multiple daemons/tests
 *   get isolated state; no module globals.
 *
 *   QB #8 (singleton threading) — the KairosRPCHandler owns ONE instance,
 *   threaded in via constructor. Tests/bridges construct their own.
 *
 *   QB #11 (sibling-site scan) — step events flow through F1 via
 *   `session.step()`; F3 sits ABOVE that, only marshaling for the
 *   cross-surface plane. The session event log is left untouched — the
 *   canonical step record is still what F1 writes. F3 only shapes the
 *   APNs-friendly payload for phone/watch rendering.
 *
 *   QB #12 (deterministic tests) — caller-supplied `now()` drives the
 *   rate-limit wall-clock. Default uses Date.now(). Tests inject a fake
 *   clock and advance deterministically; no setTimeout in the hot path so
 *   CI rate-limit assertions don't flake on clean machines.
 *
 *   QB #14 (claim verification) — RPC wiring in kairos-rpc.ts is exercised
 *   by end-to-end tests in tests/session/live-activity.test.ts.
 */

import type { ComputerSessionStore, Session } from "./computer-session-store.js";
import type { UnifiedEvent } from "../channels/fan-out.js";

// ── Types ──────────────────────────────────────────────────

/**
 * One step update for a Live Activity. Title is the 1-line step name
 * ("Running tests", "Searching Google", ...). Progress is 0-1 normalized.
 * icon is an optional SF Symbol id. expandedDetail is 2-3 line text for
 * the full (unfolded) Live Activity view.
 */
export interface StepUpdate {
  readonly sessionId: string;
  readonly title: string;
  readonly progress: number;
  readonly icon?: string;
  readonly expandedDetail?: string;
}

/**
 * Compact format — rolled Dynamic Island state. Minimum renderable
 * payload: just what the OS has room to draw when the activity is
 * idling in the island. icon is passed through verbatim (SF Symbol id);
 * undefined when the caller didn't supply one.
 */
export interface CompactStep {
  readonly sessionId: string;
  readonly title: string;
  readonly progress: number;
  readonly icon: string | undefined;
}

/**
 * Expanded format — full Live Activity render (unrolled). Adds
 * expandedDetail and wall-clock timestamps so the phone can show a
 * relative "X seconds ago" without another RPC round-trip.
 */
export interface ExpandedStep extends CompactStep {
  readonly expandedDetail: string | undefined;
  readonly firstSeenAt: number;
  readonly lastUpdatedAt: number;
}

// ── Errors (QB #6) ─────────────────────────────────────────

export class ErrorSessionNotFound extends Error {
  readonly code = "LIVE_ACTIVITY_SESSION_NOT_FOUND";
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Live activity session not found: ${sessionId}`);
    this.name = "ErrorSessionNotFound";
    this.sessionId = sessionId;
  }
}

export class ErrorTitleTooLong extends Error {
  readonly code = "LIVE_ACTIVITY_TITLE_TOO_LONG";
  readonly length: number;
  readonly maxLength: number;
  constructor(length: number, maxLength: number) {
    super(`Live activity title too long: ${length} > ${maxLength}`);
    this.name = "ErrorTitleTooLong";
    this.length = length;
    this.maxLength = maxLength;
  }
}

export class ErrorInvalidTitle extends Error {
  readonly code = "LIVE_ACTIVITY_INVALID_TITLE";
  constructor(reason: string) {
    super(`Live activity title invalid: ${reason}`);
    this.name = "ErrorInvalidTitle";
  }
}

export class ErrorInvalidProgress extends Error {
  readonly code = "LIVE_ACTIVITY_INVALID_PROGRESS";
  readonly progress: number;
  readonly reason: string;
  constructor(progress: number, reason: string) {
    super(`Live activity progress ${progress} invalid: ${reason}`);
    this.name = "ErrorInvalidProgress";
    this.progress = progress;
    this.reason = reason;
  }
}

export class ErrorInvalidIcon extends Error {
  readonly code = "LIVE_ACTIVITY_INVALID_ICON";
  constructor(reason: string) {
    super(`Live activity icon invalid: ${reason}`);
    this.name = "ErrorInvalidIcon";
  }
}

export class ErrorInvalidExpandedDetail extends Error {
  readonly code = "LIVE_ACTIVITY_INVALID_EXPANDED_DETAIL";
  constructor(reason: string) {
    super(`Live activity expandedDetail invalid: ${reason}`);
    this.name = "ErrorInvalidExpandedDetail";
  }
}

// ── Config ────────────────────────────────────────────────

export interface LiveActivityConfig {
  /**
   * Minimum gap (ms) between emits for the same session. Default 1000ms
   * matches the practical APNs Live Activity update budget (one per
   * second per activity). Bursts within this window keep only the latest
   * step; the timer-less design means the "latest" step only lands when
   * the NEXT `step()` call arrives after the window closes OR `flush()` /
   * `flushAll()` is called explicitly.
   */
  readonly minGapMs: number;
  /**
   * Upper bound on title length — anything longer is rejected. 120 covers
   * a comfortable 1-line SF Pro in the Dynamic Island compact view; APNs
   * payload size pressure makes longer titles hostile to the device.
   */
  readonly maxTitleLength: number;
  /**
   * Upper bound on expandedDetail length. 512 is generous enough for a
   * 2-3 line multi-paragraph summary but still small enough that a
   * cumulative burst of expanded updates stays under the APNs 4KB cap.
   */
  readonly maxExpandedDetailLength: number;
  /**
   * Upper bound on SF Symbol id length. 64 matches Apple's practical
   * limit for symbol ids used in Live Activities (e.g.
   * "terminal.fill", "arrow.triangle.2.circlepath").
   */
  readonly maxIconLength: number;
}

const DEFAULT_CONFIG: LiveActivityConfig = {
  minGapMs: 1000,
  maxTitleLength: 120,
  maxExpandedDetailLength: 512,
  maxIconLength: 64,
};

/**
 * Optional broadcast hook. When wired (typically via
 * UnifiedDispatchPlane.broadcastUnifiedEvent per F11), each rate-limited
 * step update fans out as a `step` UnifiedEvent so every registered
 * surface (iOS Live Activity, Watch complication, TUI HUD) renders the
 * same compact/expanded payload. Best-effort — failures never roll
 * back the store-side last-step memory.
 */
export type BroadcastFn = (event: UnifiedEvent) => void | Promise<void>;

export interface LiveActivityOptions {
  /**
   * Optional session store. When supplied, step() validates the session
   * id before enqueueing (unknown id → ErrorSessionNotFound). Tests/
   * lightweight callers can omit this — the manager still works, just
   * without session-existence checks (the caller then owns ensuring
   * sessionId is valid before calling).
   */
  readonly store?: ComputerSessionStore;
  readonly now?: () => number;
  readonly broadcast?: BroadcastFn;
  readonly minGapMs?: number;
  readonly maxTitleLength?: number;
  readonly maxExpandedDetailLength?: number;
  readonly maxIconLength?: number;
}

// ── Per-session state ──────────────────────────────────────

interface SessionState {
  /**
   * Current step — the last step that has been DISPATCHED (emitted via
   * broadcast + stored as pending). Null until the first step() lands.
   */
  current: ExpandedStep | null;
  /**
   * Timestamp (from now()) when the most recent DISPATCHED step went out.
   * Used by the rate limiter to decide whether to emit immediately or
   * stash the burst for the next window.
   */
  lastEmitAt: number;
  /**
   * Stashed "pending" burst update — set when step() arrives within the
   * minGap and the caller hasn't explicitly flushed. Newest-wins: repeated
   * bursts just overwrite this slot. A subsequent step() call after the
   * window expires picks this up and emits it alongside (or in place of)
   * the new step. `flush()` / `flushAll()` also drains this slot.
   */
  stashed: StepUpdate | null;
  /**
   * First time the manager saw this session. Populated on the very first
   * dispatch; preserved across subsequent updates so expanded renders can
   * show "started X ago".
   */
  firstSeenAt: number;
}

// ── Manager ────────────────────────────────────────────────

/**
 * Rate-limited step marshaler for iOS Live Activity / Dynamic Island.
 *
 * Stateless per the type level — all per-session state lives in the
 * per-instance `state` Map. Callers (desktop agents, RPC handlers, tests)
 * invoke `step(update)` and the manager handles validation, rate
 * limiting, and fan-out.
 *
 * Rate-limit semantics (one-per-second-per-session):
 *   - If no prior emit within minGapMs for this session → emit immediately
 *     and record `lastEmitAt`.
 *   - If a prior emit is still within minGapMs → stash the update; the
 *     next step() AFTER the window closes picks it up (newest-wins) OR an
 *     explicit `flush(sessionId)` / `flushAll()` drains it.
 *
 * There is deliberately NO timer. APNs is pull-sharded on the carrier
 * side — we don't need a per-session flush timer keeping Node awake,
 * AND deterministic tests read cleaner without setTimeout in the hot
 * path. The tradeoff is that bursts end on "quiet intervals" rather
 * than exactly minGapMs after the last-latest sample; the caller
 * (daemon) picks up the slack by calling `flushAll()` on shutdown or
 * during FleetView snapshot broadcasts.
 */
export class LiveActivityManager {
  private readonly store: ComputerSessionStore | null;
  private readonly clock: () => number;
  private broadcast: BroadcastFn | null;
  private readonly config: LiveActivityConfig;
  private readonly state = new Map<string, SessionState>();
  private readonly listeners = new Set<(step: ExpandedStep) => void>();

  constructor(options: LiveActivityOptions = {}) {
    this.store = options.store ?? null;
    this.clock = options.now ?? (() => Date.now());
    this.broadcast = options.broadcast ?? null;
    this.config = {
      minGapMs: options.minGapMs ?? DEFAULT_CONFIG.minGapMs,
      maxTitleLength: options.maxTitleLength ?? DEFAULT_CONFIG.maxTitleLength,
      maxExpandedDetailLength:
        options.maxExpandedDetailLength ?? DEFAULT_CONFIG.maxExpandedDetailLength,
      maxIconLength: options.maxIconLength ?? DEFAULT_CONFIG.maxIconLength,
    };
  }

  /**
   * Attach (or replace / detach with null) the broadcast hook after
   * construction. Needed because the dispatch plane is set by the daemon
   * AFTER the RPC handler creates the manager.
   */
  setBroadcast(fn: BroadcastFn | null): void {
    this.broadcast = fn;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Record a step update for a session. Validates inputs, enforces the
   * per-session 1-per-second rate limit, emits through broadcast + fires
   * subscribers. Returns "emitted" if the update hit the wire or
   * "coalesced" if it was stashed as a burst (newest-wins within the
   * current rate-limit window).
   *
   * Throws:
   *   - ErrorInvalidTitle / ErrorTitleTooLong — title empty or > maxTitleLength
   *   - ErrorInvalidProgress             — progress NaN / <0 / >1
   *   - ErrorInvalidIcon                 — icon wrong type or too long
   *   - ErrorInvalidExpandedDetail       — expandedDetail wrong type or too long
   *   - ErrorSessionNotFound             — store provided + unknown sessionId
   */
  step(update: StepUpdate): "emitted" | "coalesced" {
    const validated = this.validate(update);
    if (this.store !== null) {
      this.requireSession(validated.sessionId);
    }

    const now = this.clock();
    const existing = this.state.get(validated.sessionId);

    if (!existing || now - existing.lastEmitAt >= this.config.minGapMs) {
      // Rate-limit window OPEN (or first-ever update): emit immediately.
      // The incoming update is newest-wins relative to any waiting stash —
      // emit() overwrites the `current` slot and clears `stashed` so the
      // old burst doesn't double-emit on a later call.
      this.emit(validated, existing, now);
      return "emitted";
    }

    // Rate-limit window CLOSED: stash the update. A subsequent step() after
    // the window expires will pick it up OR flush() will drain it.
    existing.stashed = validated;
    return "coalesced";
  }

  /**
   * Return the current DISPATCHED step for a session, or null if none.
   * Note: this returns the LAST EMITTED step, not a stashed burst.
   * Callers that want to see what WOULD flush should also check
   * `pendingStashed(sessionId)`.
   */
  pending(sessionId: string): ExpandedStep | null {
    const state = this.state.get(sessionId);
    return state?.current ?? null;
  }

  /**
   * Return the stashed (not-yet-emitted) burst update for a session, or
   * null if none. Useful for tests and for surface-side "what would
   * happen on next flush" previews. The stashed payload is a `StepUpdate`,
   * not an `ExpandedStep`, because it hasn't been dispatched yet —
   * `firstSeenAt` / `lastUpdatedAt` are only populated by `emit()`.
   */
  pendingStashed(sessionId: string): StepUpdate | null {
    const state = this.state.get(sessionId);
    return state?.stashed ?? null;
  }

  /**
   * Return the current DISPATCHED step for every session that has one.
   * Used for bulk snapshots (watch complication pull, CarPlay status tile).
   * Returns a new array; callers may keep it past later updates.
   */
  pendingAll(): readonly ExpandedStep[] {
    const out: ExpandedStep[] = [];
    for (const state of this.state.values()) {
      if (state.current !== null) out.push(state.current);
    }
    return out;
  }

  /**
   * Subscribe to every dispatched step across every session. Returns a
   * disposer; callers MUST invoke it to avoid leaking the listener.
   * Subscribers are fired after broadcast — the same exact `ExpandedStep`
   * that went over the wire. Listener errors are swallowed so one bad
   * surface doesn't break the fan-out. The listener set is per-instance
   * (QB #7), so multiple daemons/tests have isolated subscribers.
   */
  subscribe(listener: (step: ExpandedStep) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Drain the stashed burst for a specific session, emitting it if
   * present. No-op if nothing stashed. Bypasses the rate-limit window
   * (the caller explicitly asked for a flush). Used on session close,
   * FleetView snapshot broadcasts, and explicit user "Refresh" actions.
   */
  flush(sessionId: string): "emitted" | "none" {
    const state = this.state.get(sessionId);
    if (!state || state.stashed === null) return "none";
    const stashed = state.stashed;
    state.stashed = null;
    const now = this.clock();
    this.emit(stashed, state, now);
    return "emitted";
  }

  /**
   * Drain the stashed burst for every session. Used on daemon shutdown
   * and for explicit bulk-refresh surfaces (watch face pull, fleet snapshot).
   * Emits each session's stashed update via broadcast + subscribers.
   * Returns the count of sessions that actually had a stash to drain.
   */
  flushAll(): number {
    let n = 0;
    const now = this.clock();
    for (const state of this.state.values()) {
      if (state.stashed !== null) {
        const stashed = state.stashed;
        state.stashed = null;
        this.emit(stashed, state, now);
        n += 1;
      }
    }
    return n;
  }

  /**
   * Drop a session's per-session state entirely. Called when the session
   * terminates (done/failed) so stale ExpandedSteps don't linger in
   * `pendingAll()`. Idempotent.
   */
  drop(sessionId: string): void {
    this.state.delete(sessionId);
  }

  /** Count of sessions holding live (dispatched) state. */
  activeSessionCount(): number {
    return this.state.size;
  }

  // ── Serialization ──────────────────────────────────────

  /**
   * Project an ExpandedStep into the compact rolled-Dynamic-Island
   * format. Pure function — no state mutation. Exposed for serialization
   * symmetry with `toExpanded` (so surfaces can round-trip the same
   * ExpandedStep without re-running step-validate).
   */
  static toCompact(step: ExpandedStep): CompactStep {
    return {
      sessionId: step.sessionId,
      title: step.title,
      progress: step.progress,
      icon: step.icon,
    };
  }

  /**
   * Pass-through projection for the full expanded view. Exposed for
   * symmetry with `toCompact` — external callers receive an `ExpandedStep`
   * already, this method is here for the intent-declaring use site
   * (`manager.toExpanded(...)` reads cleanly in mobile-side code).
   */
  static toExpanded(step: ExpandedStep): ExpandedStep {
    return step;
  }

  // ── Internal ──────────────────────────────────────────

  /**
   * Emit an update: build the ExpandedStep, record it as `current`,
   * stamp `lastEmitAt`, broadcast the UnifiedEvent, and notify
   * subscribers. Best-effort broadcast + subscriber failures are swallowed
   * (see class docstring for rationale) — the canonical record is the
   * `current` slot, and callers may re-poll via `pending()` if needed.
   */
  private emit(update: StepUpdate, prior: SessionState | undefined, now: number): void {
    const firstSeenAt = prior?.firstSeenAt ?? now;
    const expanded: ExpandedStep = {
      sessionId: update.sessionId,
      title: update.title,
      progress: update.progress,
      icon: update.icon,
      expandedDetail: update.expandedDetail,
      firstSeenAt,
      lastUpdatedAt: now,
    };

    const nextState: SessionState = {
      current: expanded,
      lastEmitAt: now,
      stashed: null,
      firstSeenAt,
    };
    this.state.set(update.sessionId, nextState);

    // Broadcast — best-effort cross-surface fan-out. Compact + expanded
    // shapes both land in the payload so each surface picks the render
    // it needs. Failures swallowed (QB #6: store-side record is
    // canonical; surfaces can re-poll via pending()).
    if (this.broadcast) {
      const event: UnifiedEvent = {
        type: "step",
        timestamp: now,
        payload: {
          sessionId: expanded.sessionId,
          compact: {
            sessionId: expanded.sessionId,
            title: expanded.title,
            progress: expanded.progress,
            icon: expanded.icon,
          },
          expanded: {
            sessionId: expanded.sessionId,
            title: expanded.title,
            progress: expanded.progress,
            icon: expanded.icon,
            expandedDetail: expanded.expandedDetail,
            firstSeenAt: expanded.firstSeenAt,
            lastUpdatedAt: expanded.lastUpdatedAt,
          },
        },
      };
      try {
        const result = this.broadcast(event);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {
            // Broadcast failures never roll back the store-side record.
          });
        }
      } catch {
        // Same reasoning — best-effort fan-out.
      }
    }

    // Subscribers — fire synchronously after broadcast. Errors are
    // swallowed per-listener so one bad surface doesn't kill the fan-out.
    for (const listener of this.listeners) {
      try {
        listener(expanded);
      } catch {
        // Listener errors must not break delivery to other subscribers.
      }
    }
  }

  private validate(update: StepUpdate): StepUpdate {
    if (!update || typeof update !== "object") {
      throw new ErrorInvalidTitle("update must be an object");
    }
    if (typeof update.sessionId !== "string" || update.sessionId.trim() === "") {
      throw new ErrorInvalidTitle("sessionId (non-empty string) required");
    }
    if (typeof update.title !== "string") {
      throw new ErrorInvalidTitle("title (string) required");
    }
    if (update.title.trim() === "") {
      throw new ErrorInvalidTitle("title must not be empty or whitespace");
    }
    if (update.title.length > this.config.maxTitleLength) {
      throw new ErrorTitleTooLong(update.title.length, this.config.maxTitleLength);
    }
    if (typeof update.progress !== "number" || !Number.isFinite(update.progress)) {
      throw new ErrorInvalidProgress(update.progress as number, "progress must be a finite number");
    }
    if (update.progress < 0) {
      throw new ErrorInvalidProgress(update.progress, "progress must be >= 0");
    }
    if (update.progress > 1) {
      throw new ErrorInvalidProgress(update.progress, "progress must be <= 1");
    }
    if (update.icon !== undefined) {
      if (typeof update.icon !== "string") {
        throw new ErrorInvalidIcon("icon must be a string when provided");
      }
      if (update.icon.length > this.config.maxIconLength) {
        throw new ErrorInvalidIcon(
          `icon length ${update.icon.length} > max ${this.config.maxIconLength}`,
        );
      }
    }
    if (update.expandedDetail !== undefined) {
      if (typeof update.expandedDetail !== "string") {
        throw new ErrorInvalidExpandedDetail("expandedDetail must be a string when provided");
      }
      if (update.expandedDetail.length > this.config.maxExpandedDetailLength) {
        throw new ErrorInvalidExpandedDetail(
          `expandedDetail length ${update.expandedDetail.length} > max ${this.config.maxExpandedDetailLength}`,
        );
      }
    }
    return update;
  }

  private requireSession(sessionId: string): Session {
    if (this.store === null) {
      throw new Error("internal: requireSession called without store");
    }
    const session = this.store.getOrNull(sessionId);
    if (!session) {
      throw new ErrorSessionNotFound(sessionId);
    }
    return session;
  }
}
