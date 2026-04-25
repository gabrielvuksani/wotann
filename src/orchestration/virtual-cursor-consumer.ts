/**
 * Virtual-cursor consumer — V9 Tier 11 T11.1 wire (audit fix 2026-04-24).
 *
 * Bridges the existing `src/computer-use/virtual-cursor-pool.ts` (which
 * is otherwise orphan: zero non-test consumers per the audit) to the
 * runtime turn-boundary clock. Each turn the consumer advances the
 * pool's internal motion state by one tick and dispatches the
 * resulting cursor frames through a caller-supplied dispatcher.
 *
 * Wire model
 * ──────────
 *   runtime.onTurnEnd  ── tick ──>  consumer.advance()
 *                                       │
 *                                       └── pool.tick()
 *                                            │
 *                                            └── dispatcher(frames)
 *
 * The dispatcher is whatever surface the desktop / iOS / Watch host
 * wants to render to. Passing `(frames) => emitter.emit("cursor", frames)`
 * fans them out via the existing channel/fan-out registry; passing a
 * stub in tests keeps the consumer pure.
 *
 * Quality bars
 *   - QB #6 honest stubs: dispatcher errors are swallowed but
 *     surfaced via `getDiagnostics()` so the host can see "last
 *     dispatch failed" — never silent.
 *   - QB #7 per-call state: `createVirtualCursorConsumer()` returns
 *     a fresh closure per call. No module-level cache.
 *   - QB #11 sibling-site scan: this is the SOLE non-test consumer
 *     of the pool. Audit verified the pool was orphan; this file
 *     closes that gap.
 */

import type { VirtualCursorPool, VirtualCursor } from "../computer-use/virtual-cursor-pool.js";
import type { CursorFrame } from "../computer-use/cursor-sprite.js";

// ── Public surface ──────────────────────────────────────────

export interface VirtualCursorConsumerOptions {
  /** The pool whose tick advances we drive. Must be created upstream. */
  readonly pool: VirtualCursorPool;
  /**
   * Where to send each tick's frame batch. Called once per advance()
   * even when the batch is empty (so subscribers can render an idle
   * frame). Errors thrown by the dispatcher are caught and stashed
   * in diagnostics.
   */
  readonly dispatcher: (frames: readonly CursorFrame[]) => void | Promise<void>;
  /**
   * Optional logger for debug output. When omitted no logs are
   * emitted — keeping the consumer silent in production by default.
   */
  readonly log?: (msg: string) => void;
}

export interface ConsumerDiagnostics {
  /** Number of times advance() has been invoked. */
  readonly tickCount: number;
  /** Total frames dispatched across all ticks. */
  readonly framesDispatched: number;
  /** The most recent dispatcher error, when present. */
  readonly lastDispatchError: string | null;
  /** ISO timestamp of the most recent successful dispatch. */
  readonly lastDispatchAt: string | null;
}

export interface VirtualCursorConsumer {
  /**
   * Advance the pool by one tick and dispatch the resulting frames.
   * Safe to call back-to-back — each call is one tick. Returns the
   * frame batch that was emitted so synchronous callers can use it
   * directly.
   */
  readonly advance: () => Promise<readonly CursorFrame[]>;
  /**
   * Inspect the current set of cursors without advancing.
   */
  readonly snapshot: () => readonly VirtualCursor[];
  readonly getDiagnostics: () => ConsumerDiagnostics;
  /** Reset diagnostics counters (does not affect pool state). */
  readonly resetDiagnostics: () => void;
}

// ── Implementation ──────────────────────────────────────────

/**
 * Build a consumer that ticks the supplied pool. Per-instance state;
 * pass a fresh consumer per session to keep diagnostics scoped.
 */
export function createVirtualCursorConsumer(
  opts: VirtualCursorConsumerOptions,
): VirtualCursorConsumer {
  if (!opts || typeof opts !== "object") {
    throw new TypeError("createVirtualCursorConsumer: options object required");
  }
  if (!opts.pool || typeof opts.pool.tick !== "function") {
    throw new TypeError("createVirtualCursorConsumer: options.pool with .tick() required");
  }
  if (typeof opts.dispatcher !== "function") {
    throw new TypeError("createVirtualCursorConsumer: options.dispatcher must be a function");
  }

  let tickCount = 0;
  let framesDispatched = 0;
  let lastDispatchError: string | null = null;
  let lastDispatchAt: string | null = null;

  async function advance(): Promise<readonly CursorFrame[]> {
    tickCount += 1;
    let frames: readonly CursorFrame[];
    try {
      frames = opts.pool.tick();
    } catch (err) {
      lastDispatchError = `pool.tick() threw: ${err instanceof Error ? err.message : String(err)}`;
      opts.log?.(lastDispatchError);
      return [];
    }

    try {
      const result = opts.dispatcher(frames);
      if (result instanceof Promise) await result;
      framesDispatched += frames.length;
      lastDispatchAt = new Date().toISOString();
      lastDispatchError = null;
    } catch (err) {
      lastDispatchError = `dispatcher threw: ${err instanceof Error ? err.message : String(err)}`;
      opts.log?.(lastDispatchError);
    }
    return frames;
  }

  return {
    advance,
    snapshot: () => opts.pool.snapshot(),
    getDiagnostics: () => ({
      tickCount,
      framesDispatched,
      lastDispatchError,
      lastDispatchAt,
    }),
    resetDiagnostics: () => {
      tickCount = 0;
      framesDispatched = 0;
      lastDispatchError = null;
      lastDispatchAt = null;
    },
  };
}
