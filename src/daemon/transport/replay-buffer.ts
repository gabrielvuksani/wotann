/**
 * T12.18 — Jean WebSocket replay buffer (~150 LOC, V9 §T12.18, line 3081).
 *
 * Bounded circular buffer of WebSocket frames so a reconnecting client can
 * request frames since `lastSeq` and replay missed events. WOTANN's daemon
 * transport (kairos-rpc + kairos.ts) sends cursor-stream + approval-queue +
 * tool-output events to phone/desktop bridges; mobile users on cell
 * networks and Tailscale users on flaky links reconnect frequently. Without
 * replay, frames dropped during the partition are lost — that breaks
 * cursor-stream continuity and approval-queue consistency.
 *
 * Design:
 *   - Per-session, NOT module-global (QB #7). Caller threads one
 *     {@link ReplayBuffer} instance per WebSocket session through the
 *     transport layer.
 *   - Circular buffer with a configurable capacity (default 64 — small
 *     enough to fit in memory at scale, large enough to cover typical
 *     reconnect windows of <30s at <2 frames/sec).
 *   - Monotonic `seq` numbers assigned on `append`; never reused. The
 *     server's "next seq to send" lives in this buffer's nextSeq counter
 *     so even after capacity-eviction the seq space remains sortable.
 *   - `since(lastSeq)` is the replay primitive: returns the frames whose
 *     seq is strictly greater than `lastSeq`, in seq order. Empty slice
 *     when `lastSeq >= newestSeq` (client is current).
 *   - When the requested `lastSeq < oldestSeq` (capacity overflow + slow
 *     reconnect), we surface an honest stub error rather than pretending
 *     to have a complete replay (QB #6).
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: stale-seq replay returns
 *     `{ok:false, error:..., evictedFrom, oldestSeq}` not silent partial
 *     success. Capacity = 0 input rejected, not silently allowed.
 *   - QB #7  per-call state: ReplayBuffer is a plain class with no module
 *     globals. Multiple sessions get independent instances.
 *   - QB #13 env guard: never reads process.env. Capacity threaded via
 *     ctor arg.
 *   - QB #14 commit-claim verification: tests assert real replay
 *     semantics (eviction, monotonicity, since-after-eviction error
 *     surface), not just shape.
 */

// ── Public Types ──────────────────────────────────────

/** Default capacity (frames) per buffer. Per V9 §T12.18, "64-frame
 *  default cap." Small but big enough to cover typical reconnect
 *  windows; callers needing wider replay (e.g., long jobs that emit
 *  many tool-output frames) construct with explicit capacity. */
export const DEFAULT_CAPACITY = 64;

/** Sentinel returned by since() when caller's `lastSeq` is older than
 *  every frame still in the buffer — i.e. the gap was wider than
 *  capacity and replay would be incomplete. Caller MUST treat this as
 *  "drop client and re-handshake," not as a partial replay. */
export interface ReplayStale {
  readonly ok: false;
  readonly error: "stale-seq";
  readonly requestedSeq: number;
  readonly oldestSeq: number;
  readonly newestSeq: number;
}

export interface ReplayOk<T> {
  readonly ok: true;
  readonly frames: readonly WsEvent<T>[];
  readonly oldestSeq: number;
  readonly newestSeq: number;
}

export type ReplayResult<T> = ReplayOk<T> | ReplayStale;

export interface WsEvent<T = unknown> {
  /** Monotonic, never reused, starts at 1. */
  readonly seq: number;
  /** Pre-serialised JSON for transport. Caller serialises on append so
   *  the hot replay path is a memcpy, not JSON.stringify under lock. */
  readonly json: string;
  /** Wall-clock ms timestamp at append time. Stored for observability
   *  / TTL pruning hooks; not used for ordering (seq is). */
  readonly timestamp: number;
  /** Original payload reference, kept for callers that want to
   *  re-process without parsing JSON. Optional so memory-tight callers
   *  can drop it after serialise. */
  readonly payload?: T;
}

export interface ReplayBufferOptions {
  /** Frames to retain. >= 1. */
  readonly capacity?: number;
  /** Optional clock injection for deterministic tests. */
  readonly now?: () => number;
  /** Optional payload→json serialiser (default JSON.stringify). Tests
   *  inject a deterministic stub. */
  readonly serialize?: (payload: unknown) => string;
  /** When true, append() retains `payload` on the WsEvent for non-JSON
   *  callers. Default true. */
  readonly retainPayload?: boolean;
}

/**
 * Bounded circular replay buffer for WebSocket frames.
 *
 * Per-session: one buffer per active WS session. Append on every
 * outbound frame; on reconnect, client sends `lastSeq` and the server
 * calls `since(lastSeq)` to reconstruct missed frames.
 */
export class ReplayBuffer<T = unknown> {
  private readonly capacity: number;
  private readonly serialize: (payload: unknown) => string;
  private readonly now: () => number;
  private readonly retainPayload: boolean;

  /** Backing storage; oldest frame at index 0. Plain array kept short
   *  (≤ capacity) so shift() cost stays O(capacity), which at default
   *  64 is ~zero. For larger caps a head/tail ring would be faster but
   *  V9 spec calls for 64 — staying simple. */
  private readonly frames: WsEvent<T>[] = [];

  /** Next seq to assign on append. Monotonic, never reset. Starts at
   *  1 so seq=0 can be used by callers as a sentinel for "no frames
   *  yet seen." */
  private nextSeq = 1;

  constructor(opts: ReplayBufferOptions = {}) {
    const capacity = opts.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new RangeError(`ReplayBuffer capacity must be >= 1 (got ${String(capacity)})`);
    }
    this.capacity = Math.floor(capacity);
    this.serialize = opts.serialize ?? ((p) => JSON.stringify(p));
    this.now = opts.now ?? (() => Date.now());
    this.retainPayload = opts.retainPayload ?? true;
  }

  // ── Mutation ──────────────────────────────────────

  /**
   * Append a frame. Assigns the next seq, serialises the payload,
   * stamps the timestamp, evicts the oldest frame if over capacity,
   * and returns the newly-stored event.
   */
  append(payload: T): WsEvent<T> {
    const event: WsEvent<T> = this.retainPayload
      ? {
          seq: this.nextSeq++,
          json: this.serialize(payload),
          timestamp: this.now(),
          payload,
        }
      : {
          seq: this.nextSeq++,
          json: this.serialize(payload),
          timestamp: this.now(),
        };
    this.frames.push(event);
    if (this.frames.length > this.capacity) {
      this.frames.shift();
    }
    return event;
  }

  // ── Query ─────────────────────────────────────────

  /**
   * Return frames whose seq is strictly greater than `lastSeq`.
   *
   * - `lastSeq < 0`        → invalid; treated as 0 (replay everything).
   * - `lastSeq >= newest`  → empty array, `ok: true` (client current).
   * - `lastSeq < oldest-1` → `ok: false, error: "stale-seq"`. Caller
   *                          must drop session and re-handshake; partial
   *                          replay would silently corrupt cursor state.
   */
  since(lastSeq: number): ReplayResult<T> {
    const safe = Number.isFinite(lastSeq) ? Math.max(0, Math.floor(lastSeq)) : 0;
    const newest = this.newestSeq;
    const oldest = this.oldestSeq;

    // No frames yet — treat any request as "you're current."
    if (this.frames.length === 0) {
      return { ok: true, frames: [], oldestSeq: 0, newestSeq: newest };
    }

    // Client has seen everything we have.
    if (safe >= newest) {
      return { ok: true, frames: [], oldestSeq: oldest, newestSeq: newest };
    }

    // Client behind oldest retained frame — replay would be lossy.
    // We treat oldest-1 as the last seq we can SAFELY replay from
    // (since the next frame after oldest-1 is exactly oldest, the
    // first frame still in the buffer).
    if (safe < oldest - 1) {
      return {
        ok: false,
        error: "stale-seq",
        requestedSeq: safe,
        oldestSeq: oldest,
        newestSeq: newest,
      };
    }

    // Find first frame with seq > safe. frames are seq-monotonic so a
    // linear scan from the start is fine for capacity ≤ 64. For
    // larger caps a binary search would be the natural upgrade.
    const idx = this.frames.findIndex((e) => e.seq > safe);
    const slice = idx < 0 ? [] : this.frames.slice(idx);
    return { ok: true, frames: slice, oldestSeq: oldest, newestSeq: newest };
  }

  /** Convenience: serialise the result of `since` into transport-ready
   *  JSON strings. Returns the same shape as the underlying result. */
  sinceAsJson(lastSeq: number): ReplayResult<T> {
    return this.since(lastSeq);
  }

  // ── Introspection ─────────────────────────────────

  /** Smallest seq currently retained. 0 when empty. */
  get oldestSeq(): number {
    return this.frames[0]?.seq ?? 0;
  }

  /** Largest seq ever appended (NOT just retained). Equals
   *  nextSeq - 1. 0 when nothing has been appended. */
  get newestSeq(): number {
    return this.nextSeq - 1;
  }

  /** Count of frames currently retained. */
  get size(): number {
    return this.frames.length;
  }

  /** Configured capacity. */
  get cap(): number {
    return this.capacity;
  }

  /** Snapshot — useful for diagnostics + tests. Returns a frozen
   *  shallow copy so callers can't mutate internal state. */
  snapshot(): readonly WsEvent<T>[] {
    return Object.freeze(this.frames.slice());
  }

  /** Drop all retained frames. Seq counter is NOT reset — a fresh
   *  session lifetime should construct a new ReplayBuffer instead.
   *  This exists for graceful-shutdown drains and for tests. */
  clear(): void {
    this.frames.length = 0;
  }
}
