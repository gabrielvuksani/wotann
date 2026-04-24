/**
 * V9 T11.1 — Virtual Cursor Pool
 *
 * WOTANN's Codex-BG-CU parallel-cursor pattern. Multiple agent
 * sessions + per-session virtual cursors coexist on a single desktop
 * via a single-threaded input arbiter that serializes their motion
 * into a rate the OS + apps can ingest "normally" (apps see one
 * sequential stream of events, even though N sessions are driving).
 *
 * This module is the session manager + arbiter. It owns:
 *
 *   - A bounded table of virtual cursors (default max 8).
 *   - Per-session motion queues (a single pending target per cursor —
 *     the newest enqueue wins, preventing the queue from growing
 *     without bound while a model thinks).
 *   - A deterministic `tick()` function that advances every cursor by
 *     one step per call and returns the frames. At 50 Hz (20 ms
 *     period), 8 cursors = 400 advances/sec, which is well under the
 *     rate real systems drop input at.
 *
 * Deliberate non-goals:
 *
 *   - NO OS input injection. This module manages virtual cursor STATE
 *     and emits per-tick frames. A consumer (Tauri window, Electron
 *     transparent overlay, or native AppKit/NSView) reads the frames
 *     and paints them. Actual mouse injection remains the job of
 *     `platform-bindings.ts::click`/`moveMouse`.
 *
 *   - NO threading. Arbiter is a pull API (the host calls `tick()` on
 *     whatever scheduler it wants). That keeps the module free of
 *     timers that would leak during tests (QB #12).
 *
 * Architecture note: we deliberately re-use the `ScreenRegion` /
 * `SessionPerception` types from `session-scoped-perception.ts` and
 * the `CursorSprite`/`CursorFrame` types from `cursor-sprite.ts`.
 * Cross-module coupling is one-way (pool consumes, helpers stand
 * alone) so the helpers remain unit-testable in isolation.
 */

import { bezierPoint, buildSprite, lerp, wiggle } from "./cursor-sprite.js";
import type { CursorFrame, CursorSprite } from "./cursor-sprite.js";
import { createPerception } from "./session-scoped-perception.js";
import type { ScreenRegion, SessionPerception } from "./session-scoped-perception.js";

// ── Types ──────────────────────────────────────────────────

export interface VirtualCursorPoolOptions {
  /**
   * Arbiter tick rate in Hz. Defaults to 50 — matches the spec's
   * "@50Hz" note. NOT used inside the pool (the host drives `tick()`),
   * but stored on the pool so the host's scheduler can read it back
   * without keeping its own copy.
   */
  readonly tickHz?: number;
  /**
   * Maximum concurrent sessions. Default 8. The Codex pattern showed
   * smooth behavior up to ~12; 8 is conservative and keeps per-tick
   * work bounded.
   */
  readonly maxSessions?: number;
  /**
   * Injected clock — defaults to `Date.now`. Tests pass a fake clock
   * so frame timestamps are reproducible.
   */
  readonly now?: () => number;
}

/**
 * One virtual cursor entry. Deliberately NOT the same type as a
 * queued motion — the pool snapshot returns stable state, while the
 * internal tables carry additional bookkeeping.
 */
export interface VirtualCursor {
  readonly sessionId: string;
  readonly sprite: CursorSprite;
  readonly position: readonly [number, number];
  readonly perception: SessionPerception;
}

export interface VirtualCursorPool {
  readonly spawn: (opts: SpawnOpts) => SpawnResult;
  readonly despawn: (sessionId: string) => boolean;
  readonly enqueueMove: (sessionId: string, target: readonly [number, number]) => boolean;
  readonly tick: () => readonly CursorFrame[];
  readonly snapshot: () => readonly VirtualCursor[];
}

export interface SpawnOpts {
  readonly sessionId: string;
  readonly region: ScreenRegion;
  /**
   * Background color used to pick a contrasting sprite hue. Optional
   * — when omitted, we fall back to a neutral mid-gray so the sprite
   * comes out in a distinct hue regardless. Real callers should pass
   * the output of `extractDominantColors` / `dominantBackgroundColor`.
   */
  readonly backgroundRgb?: readonly [number, number, number];
}

export type SpawnResult =
  | { readonly ok: true; readonly cursor: VirtualCursor }
  | { readonly ok: false; readonly error: "duplicate-session" | "max-sessions-exceeded" };

// ── Internal mutable-per-session state ────────────────────
//
// Kept in a Map for O(1) lookup + stable iteration order (Map iterates
// in insertion order which matches the spawn order, so the arbiter's
// per-tick frames come out in the order sessions joined — deterministic
// tests, deterministic UI z-ordering).

interface CursorState {
  readonly sprite: CursorSprite;
  readonly perception: SessionPerception;
  position: [number, number];
  /** The target the cursor is moving toward. `null` = at rest. */
  target: [number, number] | null;
  /**
   * Progress along the current (position → target) leg in `[0, 1]`.
   * Resets to 0 when a new target is enqueued.
   */
  progress: number;
  /**
   * Tick counter, monotonically increasing. Used as the `wiggle` seed
   * so cursor jitter differs across ticks but is reproducible.
   */
  tickCount: number;
  /** Short motion trail for overlay fade-out. */
  trail: { x: number; y: number; age: number }[];
}

// ── Constants (tunable if the spec evolves) ───────────────

/** Per-tick fraction of remaining distance to a target (linear leg). */
const LERP_STEP_PER_TICK = 0.25;

/** Max consecutive trail samples we retain. Older samples get dropped. */
const TRAIL_MAX_SAMPLES = 8;

/** Pixels — when the cursor is within this of its target we snap and stop. */
const ARRIVE_PIXELS = 0.75;

/**
 * Amplitude (pixels) of the natural wiggle applied on top of each
 * motion sample. Zero when at rest — we only wiggle while the cursor
 * is actively in motion, so idle cursors stay stationary instead of
 * jittering under a user's nose.
 */
const WIGGLE_AMPLITUDE = 0.6;

// ── Helpers ────────────────────────────────────────────────

function dist(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Midpoint between two points — used as the implicit Bezier control
 * handle. The spec says the overlay uses 3-point Bezier; we derive
 * P1 geometrically so the host doesn't need to supply it. A slight
 * perpendicular offset would produce more natural curves, but that
 * adds directional state (which way to bow) and the mid-point curve
 * is already a noticeable improvement on pure linear motion.
 */
function bezierControl(
  p0: readonly [number, number],
  p2: readonly [number, number],
): [number, number] {
  return [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
}

/**
 * Clamp a point into a region. Used at enqueue time: a session cannot
 * enqueue a move outside its region (would violate strict isolation
 * and cause the overlay to paint into another session's space).
 */
function clampToRegion(target: readonly [number, number], region: ScreenRegion): [number, number] {
  const x = Math.max(region.x, Math.min(region.x + region.width, target[0]));
  const y = Math.max(region.y, Math.min(region.y + region.height, target[1]));
  return [x, y];
}

/** Center of a region — the default starting position of a new cursor. */
function regionCenter(region: ScreenRegion): [number, number] {
  return [region.x + region.width / 2, region.y + region.height / 2];
}

// ── Pool factory ──────────────────────────────────────────

export function createVirtualCursorPool(options: VirtualCursorPoolOptions = {}): VirtualCursorPool {
  const tickHz = options.tickHz ?? 50;
  const maxSessions = options.maxSessions ?? 8;
  const now = options.now ?? Date.now;

  if (tickHz <= 0) {
    throw new Error(`createVirtualCursorPool: tickHz must be positive (got ${tickHz})`);
  }
  if (maxSessions <= 0) {
    throw new Error(`createVirtualCursorPool: maxSessions must be positive (got ${maxSessions})`);
  }

  // State lives in this closure so the returned pool has no public
  // mutable fields. Per Gabriel's immutability rule, consumers get
  // frozen snapshots via `snapshot()` and the state stays private.
  const cursors = new Map<string, CursorState>();

  const spawn = (opts: SpawnOpts): SpawnResult => {
    if (!opts.sessionId || opts.sessionId.trim() === "") {
      throw new Error("spawn: sessionId required");
    }
    if (cursors.has(opts.sessionId)) {
      return { ok: false, error: "duplicate-session" };
    }
    if (cursors.size >= maxSessions) {
      return { ok: false, error: "max-sessions-exceeded" };
    }

    const perception = createPerception(opts.sessionId, opts.region, true);
    const bg = opts.backgroundRgb ?? [128, 128, 128];
    const sprite = buildSprite(opts.sessionId, bg);
    const start = regionCenter(opts.region);

    const state: CursorState = {
      sprite,
      perception,
      position: [start[0], start[1]],
      target: null,
      progress: 0,
      tickCount: 0,
      trail: [],
    };
    cursors.set(opts.sessionId, state);

    const cursor: VirtualCursor = {
      sessionId: opts.sessionId,
      sprite,
      position: [start[0], start[1]],
      perception,
    };
    return { ok: true, cursor };
  };

  const despawn = (sessionId: string): boolean => {
    return cursors.delete(sessionId);
  };

  const enqueueMove = (sessionId: string, target: readonly [number, number]): boolean => {
    const state = cursors.get(sessionId);
    if (!state) return false;
    if (!Number.isFinite(target[0]) || !Number.isFinite(target[1])) {
      // Non-finite targets are a caller bug; refuse rather than
      // silently defaulting (QB #6).
      return false;
    }
    const clamped = clampToRegion(target, state.perception.region);
    // Newest target wins. A more elaborate design would queue N
    // waypoints, but that adds latency (cursor visits stale spots)
    // and the model is driving — it can re-enqueue if a situation
    // changed. Simple + predictable.
    state.target = clamped;
    state.progress = 0;
    return true;
  };

  const tick = (): readonly CursorFrame[] => {
    const timestamp = now();
    const frames: CursorFrame[] = [];

    for (const [sessionId, state] of cursors) {
      state.tickCount += 1;

      if (state.target) {
        const start = state.position;
        const target = state.target;
        const remaining = dist(start, target);

        if (remaining <= ARRIVE_PIXELS) {
          // Arrived — snap to avoid perpetual sub-pixel drift.
          state.position = [target[0], target[1]];
          state.target = null;
          state.progress = 0;
        } else {
          // Advance `progress` by LERP_STEP_PER_TICK. We compute the
          // Bezier point along the (start, control, target) curve at
          // `progress`, then fold in a small wiggle for realism.
          state.progress = Math.min(1, state.progress + LERP_STEP_PER_TICK);
          const control = bezierControl(start, target);
          const [bx, by] = bezierPoint(start, control, target, state.progress);
          const [wx, wy] = wiggle([bx, by], WIGGLE_AMPLITUDE, state.tickCount);

          // Double-lerp smooths the step: we blend the wiggled point
          // with the raw current position by `progress` so the
          // cursor doesn't teleport. Without this a `progress=1`
          // advance would land exactly on the target and any
          // remaining linear interp semantics disappear.
          const nx = lerp(start[0], wx, LERP_STEP_PER_TICK);
          const ny = lerp(start[1], wy, LERP_STEP_PER_TICK);
          state.position = [nx, ny];
        }
      }

      // Update trail (most-recent-first). Every cursor gets a trail
      // entry per tick regardless of whether it moved — lets the
      // overlay fade motion smoothly instead of only painting trails
      // while motion is in progress.
      const newTrailEntry = {
        x: state.position[0],
        y: state.position[1],
        age: 0,
      };
      const agedTrail = state.trail.map((t) => ({ x: t.x, y: t.y, age: t.age + 1 }));
      const nextTrail = [newTrailEntry, ...agedTrail].slice(0, TRAIL_MAX_SAMPLES);
      state.trail = nextTrail;

      frames.push({
        sessionId,
        x: state.position[0],
        y: state.position[1],
        timestamp,
        trail: nextTrail.map((t) => ({ x: t.x, y: t.y, age: t.age })),
      });
    }

    return frames;
  };

  const snapshot = (): readonly VirtualCursor[] => {
    const out: VirtualCursor[] = [];
    for (const [sessionId, state] of cursors) {
      // Every public cursor object is freshly built so the caller
      // can't later mutate internals by holding onto a reference.
      out.push({
        sessionId,
        sprite: state.sprite,
        position: [state.position[0], state.position[1]],
        perception: state.perception,
      });
    }
    return out;
  };

  return {
    spawn,
    despawn,
    enqueueMove,
    tick,
    snapshot,
  };
}
