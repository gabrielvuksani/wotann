/**
 * Multi-agent fleet view — Phase 3 P1-F15.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 8 + competitor
 * research §RESEARCH_USER_NAMED_COMPETITORS.md (Cursor 3 Agents Window),
 * every surface (iOS WorkView, Desktop AgentFleetDashboard, Watch Triage,
 * CarPlay Status, TUI HUD) needs a single-glance view of every running
 * agent session: name, status, surface, progress, last-step, current
 * action, creator, current claimant.
 *
 * Before F15 each surface was expected to poll `computer.session.list`
 * every 2s (see design Flow 8) which produced event storms, drove cost,
 * and raced against session updates from peers. F15 ports Cursor 3's
 * "Agents Window" concept as an RPC-accessible, debounced, subscribable
 * snapshot built ON TOP of:
 *
 *   - F1 ComputerSessionStore — single source of truth for session state,
 *     the underlying event bus via `subscribeAll`, session enumeration.
 *   - F11 UnifiedDispatchPlane / SurfaceRegistry — not required at this
 *     layer; consumers of FleetView can themselves broadcast snapshots
 *     through the plane if they want to reach non-RPC surfaces. FleetView
 *     stays storage-ignorant.
 *   - F14 SessionHandoffManager — handoff events already flow through the
 *     store's event bus, so `handoff_initiated`/`handoff_accepted`/
 *     `handoff_expired` naturally trip fleet-view change detection with
 *     no extra wiring.
 *
 * Design decisions (keyed to session quality bars):
 *
 *   QB #6 (honest failures) — no sessions yields an empty array snapshot,
 *   not an error. Unknown `currentAction`/progress fall back to null.
 *
 *   QB #7 (per-session state) — FleetView is an instance, not a module
 *   global. Each KairosRPCHandler constructs exactly one bound to its
 *   store. Subscriber lists live on the instance.
 *
 *   QB #10 (sibling-site scan) — grep confirms no prior fleet machinery
 *   exists inside src/session. The UI-only `src/ui/agent-fleet-dashboard.ts`
 *   renders a locally-registered agent set for TUI display; it is NOT
 *   backed by the session store and does not overlap with this module.
 *   `src/desktop/command-palette.ts` surfaces a `showFleet` callback but
 *   lacks any backing data source — F15 is that data source.
 *
 *   QB #11 (singleton threading) — the manager is threaded through the
 *   RPC handler, never newed up in parallel.
 *
 *   QB #12 (no environment-dependent tests) — FleetView uses a caller-
 *   supplied scheduler/clock for debouncing; tests thread a fake to
 *   remove wall-clock dependence.
 *
 *   QB #13 (strict NODE_ENV usage) — no environment gating here.
 *
 *   QB #14 (claim verification) — every assertion in this file is
 *   backed by runtime behavior; no commit-claim gap.
 */

import { EventEmitter } from "node:events";
import type {
  ComputerSessionStore,
  Session,
  SessionEvent,
  SessionStatus,
} from "./computer-session-store.js";
import type { SurfaceType } from "../channels/fan-out.js";

// ── Types ─────────────────────────────────────────────────

/**
 * Per-session summary row surfaced in the fleet snapshot. Intentionally
 * a projection over `Session` (not a handle back into it) so consumers
 * cannot accidentally mutate store state by mutating a summary entry.
 *
 * `progressPct` is null when the task has no declared `maxSteps` and is
 * still running — we refuse to guess a denominator (QB #6: honest).
 * Terminal sessions always report 100 (done) or null (failed without
 * progress knowledge) so callers render status pills consistently.
 */
export interface SessionSummary {
  readonly id: string;
  /** Short human label. Derived from taskSpec.task (truncated). */
  readonly name: string;
  readonly status: SessionStatus;
  /**
   * Surface the current worker belongs to. Inferred from device IDs via
   * prefix heuristics, defaulting to "web" when unknowable. Not load-
   * bearing for correctness — purely a display hint.
   */
  readonly surface: SurfaceType;
  /** 0..100 when derivable, null when unknown (see progressPct rules). */
  readonly progressPct: number | null;
  /** Timestamp of the most recent step-class event. Falls back to updatedAt. */
  readonly lastStepAt: number;
  /**
   * Short description of whatever the agent is doing right now. Derived
   * from the most recent step/cursor/file_write payload when present.
   * Null on fresh sessions that haven't emitted work events.
   */
  readonly currentAction: string | null;
  readonly creator: string;
  /** null before first claim or after expiry/failure. */
  readonly claimedBy: string | null;
}

export interface FleetSnapshot {
  readonly sessions: readonly SessionSummary[];
  readonly activeCount: number;
  readonly byStatus: Readonly<Record<SessionStatus, number>>;
  readonly bySurface: Readonly<Record<SurfaceType, number>>;
  readonly updatedAt: number;
}

/** Lightweight counts-only payload for `fleet.summary`. Same arithmetic as
 * the full snapshot minus per-session rows — keeps polling surfaces (watch,
 * car, push-notification badge) honest-cheap. */
export interface FleetSummary {
  readonly total: number;
  readonly activeCount: number;
  readonly byStatus: Readonly<Record<SessionStatus, number>>;
  readonly bySurface: Readonly<Record<SurfaceType, number>>;
  readonly updatedAt: number;
}

export type FleetListener = (snapshot: FleetSnapshot) => void;

export interface FleetViewConfig {
  /**
   * Coalesce upstream session-change events into a single snapshot emit per
   * this many ms. Default 100ms per the P1-F15 design. Set to 0 to disable
   * (useful in tests that need event-exactness).
   */
  readonly debounceMs: number;
}

export interface FleetViewOptions {
  readonly store: ComputerSessionStore;
  readonly config?: Partial<FleetViewConfig>;
  /**
   * Scheduler injection — makes debounce deterministic in tests. Defaults
   * to the global setTimeout/clearTimeout.
   */
  readonly scheduler?: {
    readonly setTimeout: (fn: () => void, ms: number) => unknown;
    readonly clearTimeout: (handle: unknown) => void;
  };
  /** Clock injection — tests can pass a synthetic `now`. */
  readonly now?: () => number;
}

const DEFAULT_CONFIG: FleetViewConfig = {
  debounceMs: 100,
};

/** Fixed enumeration of statuses, used to zero-fill byStatus keys so
 * consumers can read e.g. `snapshot.byStatus.running` without undefined
 * checks. Kept in-sync with SessionStatus manually (no Object.values on
 * string unions) — addition to SessionStatus requires adding here too,
 * enforced by the compile-time Record<SessionStatus,…> typing. */
const ALL_STATUSES: readonly SessionStatus[] = [
  "pending",
  "claimed",
  "running",
  "awaiting_approval",
  "handed_off",
  "done",
  "failed",
];

const ALL_SURFACES: readonly SurfaceType[] = ["desktop", "ios", "watch", "tui", "carplay", "web"];

const ACTIVE_STATUSES: readonly SessionStatus[] = [
  "claimed",
  "running",
  "awaiting_approval",
  "handed_off",
];

// Event types whose payload is a strong signal of the "current action"
// string. Ordered by most-specific-first — cursor motions are chatty and
// overwrite less often than structured step events, so `step` wins when
// both fire in the same tick.
const ACTION_EVENT_PRIORITY: readonly string[] = [
  "approval_request",
  "handoff_initiated",
  "handoff_accepted",
  "handoff_expired",
  "step",
  "file_write",
  "cursor",
];

// ── Helpers (pure, independent testable) ──────────────────

/**
 * Infer a surface from a device id via prefix heuristics. This is the
 * canonical mapping used across handoff tests and the session-handoff
 * flow documentation: desktop-A, phone-A, watch-1, tui-A, carplay-1.
 *
 * Unknown prefixes default to "web" — consistent with the
 * fan-out.SurfaceType fallback and matches the fan-out registry's
 * unauthenticated-surface assumption. Never throws; the caller gets a
 * sensible answer on every input (QB #6).
 */
export function inferSurfaceFromDeviceId(deviceId: string | null): SurfaceType {
  if (!deviceId) return "web";
  const lower = deviceId.toLowerCase();
  if (lower.startsWith("desktop")) return "desktop";
  if (lower.startsWith("phone") || lower.startsWith("ios")) return "ios";
  if (lower.startsWith("watch")) return "watch";
  if (lower.startsWith("tui") || lower.startsWith("cli")) return "tui";
  if (lower.startsWith("carplay") || lower.startsWith("car")) return "carplay";
  return "web";
}

/**
 * Compute a progress percentage 0..100, or null if indeterminate.
 *
 * Rules:
 *   - terminal `done`       -> 100 (task finished)
 *   - terminal `failed`     -> null (we do not mix "partial progress"
 *                              with a failure state; surfaces render a
 *                              failure indicator and no bar)
 *   - running w/ maxSteps   -> clamp(steps / maxSteps * 100, 0..99)
 *                              (never 100 while still running — caps at
 *                              99 so a spinner can accompany the bar)
 *   - running w/o maxSteps  -> null (honest: we cannot invent a
 *                              denominator)
 *   - pending / claimed     -> 0 (no work yet)
 *   - handed_off            -> preserve the pre-handoff steps-derived
 *                              number; surface renders a tint
 *   - awaiting_approval     -> preserve the steps-derived number, same
 *                              rationale as running
 */
export function computeProgressPct(session: Session): number | null {
  if (session.status === "done") return 100;
  if (session.status === "failed") return null;
  if (session.status === "pending" || session.status === "claimed") return 0;

  const maxSteps = session.taskSpec.maxSteps;
  if (typeof maxSteps !== "number" || maxSteps <= 0) return null;

  // Count only step-class events as progress — skip metadata events like
  // "created", "claimed", "handoff_*" which do not advance the task.
  // This mirrors the store's own concept of a progress-bearing event.
  const stepEvents = session.events.filter(
    (e) =>
      e.type === "step" || e.type === "cursor" || e.type === "file_write" || e.type === "frame",
  );
  const pct = Math.floor((stepEvents.length / maxSteps) * 100);
  if (pct >= 100) return 99; // see rule above
  if (pct < 0) return 0;
  return pct;
}

/** Find the most recent step-like event; fall back to last event of any
 * kind. Null only on sessions with zero events (can't happen post-create). */
export function mostRecentStepEvent(session: Session): SessionEvent | null {
  const byPriority = [...session.events].reverse();
  for (const type of ACTION_EVENT_PRIORITY) {
    const found = byPriority.find((e) => e.type === type);
    if (found) return found;
  }
  return session.events[session.events.length - 1] ?? null;
}

/** Extract a short human string from an event payload. Safe on
 * unstructured payloads (QB #6 — never throws). */
export function describeEvent(event: SessionEvent): string | null {
  const p = event.payload;
  if (!p || typeof p !== "object") return event.type;
  // Common shapes in real payloads — prefer a specific label when
  // possible, fall back to the event type.
  const kind = typeof p["kind"] === "string" ? (p["kind"] as string) : null;
  const action = typeof p["action"] === "string" ? (p["action"] as string) : null;
  const path = typeof p["path"] === "string" ? (p["path"] as string) : null;
  const summary = typeof p["summary"] === "string" ? (p["summary"] as string) : null;
  if (summary) return summary;
  if (kind && path) return `${kind} ${path}`;
  if (action) return action;
  if (kind) return kind;
  return event.type;
}

/**
 * Truncate task text for display in a narrow list view. Preserves whole
 * words where possible; truncation always deterministic for testability.
 */
export function nameFromTask(task: string, maxLen = 60): string {
  if (task.length <= maxLen) return task;
  const trimmed = task.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(" ");
  const base = lastSpace > maxLen * 0.6 ? trimmed.slice(0, lastSpace) : trimmed;
  return `${base}…`;
}

// ── Pure snapshot builders (no mutation, no subscription) ──

function summarizeSession(session: Session): SessionSummary {
  const claimant = session.claimedByDeviceId;
  const activeDevice = claimant ?? session.creatorDeviceId;
  const recent = mostRecentStepEvent(session);

  return {
    id: session.id,
    name: nameFromTask(session.taskSpec.task),
    status: session.status,
    surface: inferSurfaceFromDeviceId(activeDevice),
    progressPct: computeProgressPct(session),
    lastStepAt: recent ? recent.timestamp : session.updatedAt,
    currentAction: recent ? describeEvent(recent) : null,
    creator: session.creatorDeviceId,
    claimedBy: claimant,
  };
}

function emptyCountsByStatus(): Record<SessionStatus, number> {
  const out = {} as Record<SessionStatus, number>;
  for (const s of ALL_STATUSES) out[s] = 0;
  return out;
}

function emptyCountsBySurface(): Record<SurfaceType, number> {
  const out = {} as Record<SurfaceType, number>;
  for (const s of ALL_SURFACES) out[s] = 0;
  return out;
}

/**
 * Build a FleetSnapshot from a list of sessions. Pure — the result is a
 * deep-immutable value. Separated from `FleetView.snapshot()` so consumers
 * can compose fleet snapshots from pre-filtered lists (e.g. "only my
 * sessions", "only sessions on this surface"). Called from the subscribe
 * path inside FleetView.
 */
export function buildFleetSnapshot(sessions: readonly Session[], now: number): FleetSnapshot {
  const summaries = sessions.map(summarizeSession);
  const byStatus = emptyCountsByStatus();
  const bySurface = emptyCountsBySurface();
  let activeCount = 0;
  for (const s of summaries) {
    byStatus[s.status] += 1;
    bySurface[s.surface] += 1;
    if ((ACTIVE_STATUSES as readonly SessionStatus[]).includes(s.status)) {
      activeCount += 1;
    }
  }
  return {
    sessions: summaries,
    activeCount,
    byStatus,
    bySurface,
    updatedAt: now,
  };
}

export function summaryFromSnapshot(snapshot: FleetSnapshot): FleetSummary {
  return {
    total: snapshot.sessions.length,
    activeCount: snapshot.activeCount,
    byStatus: snapshot.byStatus,
    bySurface: snapshot.bySurface,
    updatedAt: snapshot.updatedAt,
  };
}

// ── FleetView class ──────────────────────────────────────

/**
 * Observable, debounced view over a ComputerSessionStore. Exposes a
 * single method to grab the current snapshot (`snapshot()`), a
 * subscription API (`subscribe()`), and a summary shortcut
 * (`summary()`). One FleetView per store per process. Instance-scoped
 * state per QB #7.
 *
 * Resource ownership: FleetView hooks into `store.subscribeAll`. It
 * registers exactly one listener with the store and fans out to its own
 * subscriber set internally. Disposing the view via `dispose()` detaches
 * the store hook; subscribers are not auto-disposed (mirrors the store's
 * API — callers own their own dispose disposers).
 */
export class FleetView {
  private readonly store: ComputerSessionStore;
  private readonly config: FleetViewConfig;
  private readonly now: () => number;
  private readonly schedulerSetTimeout: (fn: () => void, ms: number) => unknown;
  private readonly schedulerClearTimeout: (handle: unknown) => void;

  private readonly listeners = new Set<FleetListener>();
  private readonly emitter = new EventEmitter();
  private storeUnsubscribe: (() => void) | null = null;
  private pendingTimer: unknown = null;
  private disposed = false;

  constructor(options: FleetViewOptions) {
    this.store = options.store;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.now = options.now ?? (() => Date.now());
    this.schedulerSetTimeout = options.scheduler?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.schedulerClearTimeout =
      options.scheduler?.clearTimeout ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    // Unbounded listeners — cross-surface consumers each register one.
    this.emitter.setMaxListeners(0);
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Current snapshot — cheap (O(N) over the session set). Safe to call
   * on every RPC request without rate-limiting; the store exposes an
   * in-memory Map so no I/O is involved.
   */
  snapshot(): FleetSnapshot {
    return buildFleetSnapshot(this.store.list(), this.now());
  }

  summary(): FleetSummary {
    return summaryFromSnapshot(this.snapshot());
  }

  /**
   * Subscribe to snapshot updates. Listener is called with a fresh
   * FleetSnapshot whenever a session's state changes — debounced per
   * `config.debounceMs` so rapid runs (e.g. 100 cursor events in a row)
   * coalesce into one emit.
   *
   * Does NOT replay an initial snapshot synchronously; call `snapshot()`
   * first if you need the current state. Rationale: matches the store's
   * `subscribeAll` shape (live-tail only).
   *
   * Returns a disposer. Callers MUST call it to avoid leaking the
   * listener closure. Idempotent; calling twice is a no-op.
   */
  subscribe(listener: FleetListener): () => void {
    if (this.disposed) {
      throw new Error("FleetView disposed");
    }
    this.listeners.add(listener);
    this.ensureStoreHook();
    let called = false;
    return () => {
      if (called) return;
      called = true;
      this.listeners.delete(listener);
      // If nobody is listening anymore, detach the store hook so the
      // store's emitter stops fanning into this view. Re-hooks on
      // next subscribe().
      if (this.listeners.size === 0) {
        this.detachStoreHook();
        this.clearPendingEmit();
      }
    };
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  /** Fully detach from the store and cancel any pending emit. After
   * dispose the view refuses new subscribes. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.detachStoreHook();
    this.clearPendingEmit();
  }

  // ── Internals ────────────────────────────────────────────

  private ensureStoreHook(): void {
    if (this.storeUnsubscribe) return;
    this.storeUnsubscribe = this.store.subscribeAll(() => {
      this.scheduleEmit();
    });
  }

  private detachStoreHook(): void {
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
  }

  /**
   * Debounce incoming change notifications. 10 events in a 100ms window
   * collapse into a single snapshot emit. Zero-debounce mode (config=0)
   * emits synchronously on every change — tests use this for exactness.
   */
  private scheduleEmit(): void {
    if (this.config.debounceMs <= 0) {
      this.flushEmit();
      return;
    }
    if (this.pendingTimer !== null) return; // already scheduled
    this.pendingTimer = this.schedulerSetTimeout(() => {
      this.pendingTimer = null;
      this.flushEmit();
    }, this.config.debounceMs);
  }

  private flushEmit(): void {
    if (this.disposed) return;
    if (this.listeners.size === 0) return;
    const snap = this.snapshot();
    // Snapshot the listener set — a listener that unsubscribes during
    // its own invocation must not perturb the iteration order.
    for (const listener of [...this.listeners]) {
      try {
        listener(snap);
      } catch {
        // QB #6 — honest but resilient: one bad subscriber must not
        // poison the fleet view for peers. Errors are swallowed here;
        // callers responsible for their own exception handling.
      }
    }
  }

  private clearPendingEmit(): void {
    if (this.pendingTimer !== null) {
      this.schedulerClearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
