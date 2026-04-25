/**
 * T12.18 closure — Per-session ReplayBuffer registry for the daemon
 * transport layer (V9 §T12.18).
 *
 * The {@link ReplayBuffer} primitive in `./replay-buffer.ts` is bounded
 * and per-session by design (QB #7) — it holds no module state. The
 * daemon transport layer therefore needs a small registry that:
 *
 *   1. Mints a new ReplayBuffer when a WebSocket session opens.
 *   2. Lets emit sites tap a single `append(sessionId, payload)` call
 *      so every outgoing frame is captured for later replay.
 *   3. Exposes `getReplayBuffer(sessionId)` so reconnect logic can
 *      call `since(lastSeq)` to drain missed frames.
 *   4. Releases the buffer on session close.
 *
 * This file is the missing wiring point that makes `replay-buffer.ts`
 * a real importer outside its own module — the V9 audit flagged it as
 * orphaned because no transport-side code held a ReplayBuffer instance.
 *
 * Quality bars honoured:
 *   - QB #6  honest failures: append-before-register and replay-after-
 *     close return structured `{ok:false, ...}` envelopes, not silent
 *     drops or thrown errors.
 *   - QB #7  per-call state: `createReplayRegistry()` returns a fresh
 *     closure-scoped registry. No module-level singletons.
 *   - QB #10 sibling-site safety: every emit site that captures a
 *     buffer calls the same `append(sessionId, payload)` API; no
 *     parallel construction of `new ReplayBuffer()` elsewhere is
 *     required.
 *   - QB #13 env guard: never reads `process.env`. Capacity / clock /
 *     serializer are threaded via {@link ReplayRegistryOptions}.
 *   - QB #14 commit-claim verification: the registry surface is the
 *     real wiring point; a runtime test can assert `append` ->
 *     `getReplayBuffer().since(0)` round-trips an event.
 */

import {
  DEFAULT_CAPACITY,
  ReplayBuffer,
  type ReplayBufferOptions,
  type ReplayResult,
  type WsEvent,
} from "./replay-buffer.js";

// ── Public types ────────────────────────────────────────────

export type AppendErrorReason = "session-not-registered" | "session-closed" | "registry-disposed";

export interface AppendOk<T> {
  readonly ok: true;
  readonly event: WsEvent<T>;
}

export interface AppendFail {
  readonly ok: false;
  readonly reason: AppendErrorReason;
  readonly error: string;
}

export type AppendResult<T> = AppendOk<T> | AppendFail;

export interface ReplayRegistryOptions {
  /** Default capacity for newly-registered buffers. Defaults to 64. */
  readonly defaultCapacity?: number;
  /** Optional clock injection for deterministic tests. */
  readonly now?: () => number;
  /** Optional payload→json serialiser. Defaults to JSON.stringify. */
  readonly serialize?: (payload: unknown) => string;
  /**
   * When true, retain the original payload reference on each WsEvent.
   * Defaults to true; set false for memory-tight callers that only
   * replay JSON.
   */
  readonly retainPayload?: boolean;
}

export interface RegisterOptions extends ReplayBufferOptions {
  /** Optional override of the registry's defaultCapacity for this session. */
  readonly capacity?: number;
}

export type DeregisterFn = () => void;

export interface ReplayRegistry {
  /**
   * Open a session-bound ReplayBuffer. Returns a deregister function
   * the caller must invoke on session close. Re-registering the same
   * `sessionId` while the prior buffer is still live discards the
   * prior buffer (graceful reconnect after WS hiccup).
   */
  register(sessionId: string, opts?: RegisterOptions): DeregisterFn;

  /**
   * Append an outgoing frame to the session's buffer. Returns the
   * stored event on success, or a structured failure when the session
   * is unknown / closed / the registry was disposed.
   */
  append<T>(sessionId: string, payload: T): AppendResult<T>;

  /**
   * Accessor for the ReplayBuffer of a given session. Returns null
   * when the session is unknown or already deregistered.
   *
   * Reconnect logic should call `getReplayBuffer(sessionId)?.since(
   * lastSeq)` to drain the frames the client missed.
   */
  getReplayBuffer<T = unknown>(sessionId: string): ReplayBuffer<T> | null;

  /**
   * Convenience: drain replay frames for the session in one call.
   * Returns the {@link ReplayResult} from `since(lastSeq)`, or a
   * registry-side failure when the session is unknown.
   */
  since<T = unknown>(sessionId: string, lastSeq: number): ReplayResult<T> | AppendFail;

  /** Whether `sessionId` currently has a live buffer. */
  has(sessionId: string): boolean;

  /** Live session ids — for dashboards / stale-sweep tooling. */
  list(): readonly string[];

  /**
   * Tear down every session and forbid further mutation. After
   * `disposeAll()` the registry instance returns
   * `{ok:false, reason:"registry-disposed"}` for any append.
   */
  disposeAll(): void;
}

// ── Implementation ──────────────────────────────────────────

/**
 * Create a fresh per-instance registry. Callers should hold one
 * registry per daemon instance and pass the same reference to every
 * emit site so all outgoing frames flow through a single capture point.
 */
export function createReplayRegistry(registryOpts: ReplayRegistryOptions = {}): ReplayRegistry {
  const defaultCapacity = registryOpts.defaultCapacity ?? DEFAULT_CAPACITY;
  if (!Number.isFinite(defaultCapacity) || defaultCapacity < 1) {
    throw new RangeError(
      `createReplayRegistry: defaultCapacity must be >= 1 (got ${String(defaultCapacity)})`,
    );
  }

  // Per-session buffer storage. Generic over `unknown` here so the
  // registry can hold buffers for heterogeneous payload shapes; each
  // append call narrows the type at its own call site.
  const buffers = new Map<string, ReplayBuffer<unknown>>();
  let disposed = false;

  function register(sessionId: string, opts?: RegisterOptions): DeregisterFn {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("ReplayRegistry.register: sessionId must be a non-empty string");
    }
    if (disposed) {
      throw new Error("ReplayRegistry.register: registry is disposed");
    }

    const capacity = opts?.capacity ?? defaultCapacity;
    const buffer = new ReplayBuffer<unknown>({
      capacity,
      now: opts?.now ?? registryOpts.now,
      serialize: opts?.serialize ?? registryOpts.serialize,
      retainPayload: opts?.retainPayload ?? registryOpts.retainPayload ?? true,
    });
    buffers.set(sessionId, buffer);

    let deregistered = false;
    return () => {
      if (deregistered) return;
      deregistered = true;
      // Only drop if THIS exact buffer is still current — a re-register
      // mid-flight must not be clobbered by the previous deregister.
      if (buffers.get(sessionId) === buffer) {
        buffers.delete(sessionId);
      }
    };
  }

  function append<T>(sessionId: string, payload: T): AppendResult<T> {
    if (disposed) {
      return {
        ok: false,
        reason: "registry-disposed",
        error: "replay registry has been disposed",
      };
    }
    const buffer = buffers.get(sessionId) as ReplayBuffer<T> | undefined;
    if (buffer === undefined) {
      return {
        ok: false,
        reason: "session-not-registered",
        error: `replay session not registered: ${sessionId}`,
      };
    }
    return { ok: true, event: buffer.append(payload) };
  }

  function getReplayBuffer<T = unknown>(sessionId: string): ReplayBuffer<T> | null {
    const buffer = buffers.get(sessionId);
    return (buffer as ReplayBuffer<T> | undefined) ?? null;
  }

  function since<T = unknown>(sessionId: string, lastSeq: number): ReplayResult<T> | AppendFail {
    if (disposed) {
      return {
        ok: false,
        reason: "registry-disposed",
        error: "replay registry has been disposed",
      };
    }
    const buffer = buffers.get(sessionId) as ReplayBuffer<T> | undefined;
    if (buffer === undefined) {
      return {
        ok: false,
        reason: "session-not-registered",
        error: `replay session not registered: ${sessionId}`,
      };
    }
    return buffer.since(lastSeq);
  }

  function has(sessionId: string): boolean {
    return buffers.has(sessionId);
  }

  function list(): readonly string[] {
    return [...buffers.keys()];
  }

  function disposeAll(): void {
    if (disposed) return;
    disposed = true;
    for (const buffer of buffers.values()) {
      buffer.clear();
    }
    buffers.clear();
  }

  return { register, append, getReplayBuffer, since, has, list, disposeAll };
}
