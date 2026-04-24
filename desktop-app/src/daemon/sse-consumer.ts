/**
 * SSE Consumer — WOTANN desktop-app.
 *
 * Pure TypeScript (no React) transport layer that subscribes to the
 * WOTANN daemon's `computer.session.*` event stream over Server-Sent
 * Events, parses frames, filters by session, and dispatches typed
 * `ComputerSessionEvent`s to a caller-provided `onEvent` handler.
 *
 * V9 T1.2 owns this file. T1.1 (upstream) wired `computer.session.step`
 * through `executeDesktopAction(...)` in `src/daemon/kairos-rpc.ts:5430`
 * and pushes per-step lifecycle events onto `ComputerSessionStore`. The
 * server emits each event serialized as:
 *
 *   { sessionId, seq, timestamp, type, payload }
 *
 * where `type` is the discriminator (see
 * `src/session/computer-session-store.ts:34-47` for the canonical
 * `SessionEventType` union). This consumer translates that wire shape
 * into a desktop-app-friendly discriminated union keyed on `kind`,
 * matching the task spec. Translation is done here (not on the server)
 * so the daemon's event log format can evolve without breaking the
 * React layer, and so the consumer can tolerate unknown `type`s
 * instead of crashing.
 *
 * Transport notes:
 *   - The server currently exposes a polling subscription via
 *     `computer.session.stream` (JSON-RPC, not HTTP SSE). A native
 *     `text/event-stream` endpoint is scheduled for a follow-up wire;
 *     this consumer is built against the EventSource API so it slots in
 *     with no React changes once the endpoint lands. For now, callers
 *     pass `eventSourceFactory` to inject their own polling-to-frame
 *     adapter (production will default to `globalThis.EventSource`).
 *   - Reconnect uses exponential backoff capped at 30_000ms per the
 *     task spec. `disconnect()` is idempotent and cancels any pending
 *     reconnect timer.
 *
 * Forbidden: React imports. The hook lives in
 * `desktop-app/src/hooks/useComputerSession.ts` and wraps this consumer.
 *
 * Types are inlined here because `desktop-app/src/types/` does not
 * exist and the task prompt forbids creating an empty directory.
 */

// ── Shared type definitions ─────────────────────────────────

/**
 * Discriminated union representing a single event in a
 * computer-use session as consumed by the desktop-app. Each variant
 * carries the minimal data the UI needs to render a step.
 *
 * Mapped from the server's `{ type, payload }` wire shape (see
 * `src/session/computer-session-store.ts:77-83` for the source
 * contract). Unknown `type`s are dropped silently — this lets the
 * server add new event kinds without breaking older desktop-app
 * builds.
 */
export type ComputerSessionEvent =
  | {
      readonly kind: "session-started";
      readonly sessionId: string;
      readonly timestamp: number;
    }
  | {
      readonly kind: "action-dispatched";
      readonly sessionId: string;
      readonly action: unknown;
      readonly step: number;
      readonly timestamp: number;
    }
  | {
      readonly kind: "action-result";
      readonly sessionId: string;
      readonly step: number;
      readonly result: unknown;
      readonly durationMs: number;
      readonly timestamp: number;
    }
  | {
      readonly kind: "action-error";
      readonly sessionId: string;
      readonly step: number;
      readonly error: string;
      readonly timestamp: number;
    }
  | {
      readonly kind: "session-ended";
      readonly sessionId: string;
      readonly reason: "complete" | "cancelled" | "error";
      readonly timestamp: number;
    }
  | {
      readonly kind: "heartbeat";
      readonly timestamp: number;
    };

/**
 * Raw server-side frame shape. Public only so that test fixtures and
 * future upstream translators can reuse the exact contract without
 * redeclaring it. Never construct this in UI code — construct
 * `ComputerSessionEvent` directly and let the consumer handle the
 * inverse.
 */
export interface ServerSessionFrame {
  readonly sessionId?: string;
  readonly seq?: number;
  readonly timestamp?: number;
  readonly type?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface SseConsumerOptions {
  /**
   * HTTP SSE endpoint URL (e.g. the forthcoming
   * `http://localhost:7531/events/computer-session`).
   */
  readonly url: string;
  /**
   * Session id to filter to. Events whose `sessionId` does not match
   * are silently dropped. Heartbeats (which have no `sessionId`) are
   * always delivered.
   */
  readonly sessionId: string;
  /**
   * Handler invoked for every matching event, already typed as a
   * discriminated union. Must not throw — exceptions propagate to
   * `onError` if present, else are swallowed to keep the reader loop
   * alive.
   */
  readonly onEvent: (event: ComputerSessionEvent) => void;
  /**
   * Optional handler invoked on transport errors and on JSON-parse
   * failures. The consumer continues running (reconnect is scheduled
   * automatically).
   */
  readonly onError?: (error: Error) => void;
  /**
   * Invoked with a 1-based attempt number each time the consumer
   * schedules a reconnect (before the backoff elapses). Useful for
   * UI "reconnecting in Ns" indicators.
   */
  readonly onReconnect?: (attempt: number) => void;
  /**
   * Injected `EventSource` factory — production callers should leave
   * this undefined, tests supply a stub. The factory must return an
   * object that implements the `EventSource`-shaped surface the
   * consumer uses (`addEventListener`, `close`, `readyState`).
   */
  readonly eventSourceFactory?: (url: string) => EventSource;
  /**
   * Maximum reconnect attempts before giving up. Default is
   * `Number.POSITIVE_INFINITY` (keep trying forever). When exceeded,
   * the consumer stops and does NOT fire `onReconnect` again.
   */
  readonly maxReconnectAttempts?: number;
  /**
   * Base backoff in milliseconds. Default 500. Real delay =
   * `backoffMs * 2^(attempt - 1)` capped at 30_000 ms.
   */
  readonly backoffMs?: number;
}

export interface SseConsumer {
  /**
   * Open an `EventSource` against `options.url`. Idempotent: calling
   * `connect()` while already connected is a no-op — this prevents
   * duplicate sockets if a caller double-fires the effect in React
   * StrictMode.
   */
  readonly connect: () => void;
  /**
   * Close the active `EventSource` (if any) and cancel any pending
   * reconnect timer. Idempotent.
   */
  readonly disconnect: () => void;
  /**
   * `true` iff the underlying `EventSource` has `readyState === 1`
   * (OPEN). Returns `false` when the consumer is connecting, closed,
   * or has never been started.
   */
  readonly isConnected: () => boolean;
  /**
   * Number of times the consumer has scheduled a reconnect (including
   * the one currently pending, if any). Resets to 0 on a successful
   * `open` event.
   */
  readonly reconnectAttemptCount: () => number;
}

// ── Internal constants ──────────────────────────────────────

const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

// `EventSource.OPEN === 1` per the HTML Living Standard. Hardcoding
// the numeric avoids a runtime coupling with `globalThis.EventSource`,
// which doesn't exist in Node/jsdom where unit tests run.
const EVENT_SOURCE_OPEN = 1;

// ── Mapping: server frame -> typed event ────────────────────

/**
 * Translate a `ServerSessionFrame` into the typed discriminated union
 * used by the desktop-app. Returns `null` when the frame is missing
 * required fields OR the `type` is unknown — the caller is expected
 * to drop nulls silently (see QB #12: unknown types are not errors,
 * they are forward-compat).
 *
 * Mapping rules (source: `src/session/computer-session-store.ts` +
 * `src/daemon/kairos-rpc.ts:231`):
 *
 *   type "created" | "claimed" -> "session-started"
 *   type "step"                -> "action-dispatched" (and later
 *                                 "action-result"/"action-error"
 *                                 based on payload.ok)
 *   type "done" | "error"      -> "session-ended"
 *   type "heartbeat"           -> "heartbeat"
 *   (others — cursor/frame/file_write/approval/handoff — ignored for
 *    T1.2 which is a minimal viable consumer; a follow-up can add
 *    richer variants without breaking the union — they'll just be
 *    new `kind`s.)
 */
export function mapServerFrame(
  frame: ServerSessionFrame,
): ComputerSessionEvent | null {
  const { type } = frame;
  if (typeof type !== "string") return null;

  if (type === "heartbeat") {
    return {
      kind: "heartbeat",
      timestamp: typeof frame.timestamp === "number" ? frame.timestamp : Date.now(),
    };
  }

  if (typeof frame.sessionId !== "string") return null;
  const sessionId = frame.sessionId;
  const timestamp = typeof frame.timestamp === "number" ? frame.timestamp : Date.now();
  const payload = frame.payload ?? {};

  switch (type) {
    case "created":
    case "claimed":
      return { kind: "session-started", sessionId, timestamp };

    case "step": {
      const step = typeof frame.seq === "number" ? frame.seq : 0;
      // The server currently emits a single `step` event per call.
      // `payload.ok === false` or a truthy `payload.error` indicates
      // execution failure and maps to `action-error`. `payload.result`
      // (set by the recordStepResult path) maps to `action-result`.
      // No `result` AND no `error` = the step was just dispatched
      // and execution is still in flight.
      const error = payload["error"];
      const ok = payload["ok"];
      if (typeof error === "string" || ok === false) {
        return {
          kind: "action-error",
          sessionId,
          step,
          error: typeof error === "string" ? error : "step failed",
          timestamp,
        };
      }
      if ("result" in payload) {
        const durationMs =
          typeof payload["durationMs"] === "number" ? (payload["durationMs"] as number) : 0;
        return {
          kind: "action-result",
          sessionId,
          step,
          result: payload["result"],
          durationMs,
          timestamp,
        };
      }
      return {
        kind: "action-dispatched",
        sessionId,
        action: payload["action"] ?? payload,
        step,
        timestamp,
      };
    }

    case "done": {
      return {
        kind: "session-ended",
        sessionId,
        reason: "complete",
        timestamp,
      };
    }

    case "error": {
      return {
        kind: "session-ended",
        sessionId,
        reason: "error",
        timestamp,
      };
    }

    default:
      // Unknown type — silently drop. Forward-compat with any new
      // server event kinds (cursor/frame/file_write/handoff_*) that
      // the desktop-app doesn't yet render.
      return null;
  }
}

// ── Consumer factory ────────────────────────────────────────

/**
 * Construct a new `SseConsumer`. The returned object is immutable
 * (the factory closes over mutable internals); callers interact only
 * through the exposed methods.
 *
 * Behavioral contract:
 *   - `connect()` opens an `EventSource`. Subsequent calls while open
 *     are no-ops.
 *   - Incoming `message` events are parsed as JSON. Malformed JSON
 *     fires `onError` (if provided) without advancing the event
 *     handler.
 *   - Parsed frames are routed through `mapServerFrame`; only
 *     frames that pass both the mapping AND the session filter
 *     (or are heartbeats) reach `onEvent`.
 *   - Transport errors fire `onError` and schedule a reconnect with
 *     exponential backoff. `backoffMs * 2^(attempt - 1)` capped at
 *     `MAX_BACKOFF_MS`.
 *   - `disconnect()` cancels the pending reconnect timer and closes
 *     the EventSource.
 *
 * IMMUTABILITY: every returned method is a frozen bound closure, so
 * the caller cannot mutate the consumer's internal state.
 */
export function createSseConsumer(options: SseConsumerOptions): SseConsumer {
  const {
    url,
    sessionId,
    onEvent,
    onError,
    onReconnect,
    eventSourceFactory,
    maxReconnectAttempts = Number.POSITIVE_INFINITY,
    backoffMs = DEFAULT_BACKOFF_MS,
  } = options;

  // Internal mutable state — kept strictly inside the closure so the
  // exposed API is immutable. Following QB #7 (per-session state,
  // not module-global) each call to `createSseConsumer` gets its
  // own independent state; the factory is reentrant.
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let disposed = false;

  const factory: (u: string) => EventSource =
    eventSourceFactory ??
    ((u: string): EventSource => {
      // Production path. Referenced through `globalThis` so that this
      // file can still typecheck on a Node build — the Tauri webview
      // provides `EventSource` at runtime.
      const ctor = (globalThis as unknown as {
        EventSource?: new (u: string) => EventSource;
      }).EventSource;
      if (!ctor) {
        throw new Error(
          "EventSource is not available in this runtime — supply options.eventSourceFactory",
        );
      }
      return new ctor(u);
    });

  function safeOnError(err: Error): void {
    if (!onError) return;
    try {
      onError(err);
    } catch {
      // Never let caller's onError throw kill the reader loop.
    }
  }

  function safeOnEvent(event: ComputerSessionEvent): void {
    try {
      onEvent(event);
    } catch (err) {
      safeOnError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function handleMessage(raw: MessageEvent): void {
    const data = raw.data;
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      safeOnError(
        err instanceof Error ? err : new Error("SSE: malformed JSON frame"),
      );
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const frame = parsed as ServerSessionFrame;
    const typed = mapServerFrame(frame);
    if (typed === null) return;

    // Heartbeats are global — never filtered by sessionId.
    if (typed.kind === "heartbeat") {
      safeOnEvent(typed);
      return;
    }

    // Session filter. typed always has a sessionId here because
    // mapServerFrame returns null for non-heartbeat frames without
    // one (see the early return in that function).
    if (typed.sessionId !== sessionId) return;
    safeOnEvent(typed);
  }

  function handleOpen(): void {
    // Successful connection — reset the backoff ladder so a later
    // transient failure starts over at attempt 1 rather than picking
    // up from wherever the previous disconnect left off.
    reconnectAttempts = 0;
  }

  function handleError(rawEvt: Event): void {
    // An `error` event on EventSource means either (a) the connection
    // failed before opening, or (b) the server closed the stream. The
    // browser will attempt to reconnect itself, but we close + rebuild
    // explicitly so we control the backoff and don't stack reconnects.
    safeOnError(new Error("SSE: transport error"));
    // Silence unused-variable lint — the Event carries no info we need.
    void rawEvt;
    if (disposed) return;
    closeCurrentSource();
    scheduleReconnect();
  }

  function closeCurrentSource(): void {
    if (es !== null) {
      try {
        es.close();
      } catch {
        // Some stub EventSources throw on double-close; we don't care.
      }
      es = null;
    }
  }

  function scheduleReconnect(): void {
    if (disposed) return;
    if (reconnectAttempts >= maxReconnectAttempts) return;
    // Cancel any already-scheduled timer so we never end up with two
    // pending reconnects (could happen if handleError fires after a
    // manual call to connect() that failed synchronously).
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts += 1;
    const delay = Math.min(
      backoffMs * Math.pow(2, reconnectAttempts - 1),
      MAX_BACKOFF_MS,
    );
    if (onReconnect) {
      try {
        onReconnect(reconnectAttempts);
      } catch (err) {
        safeOnError(err instanceof Error ? err : new Error(String(err)));
      }
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (disposed) return;
      openSource();
    }, delay);
  }

  function openSource(): void {
    // Idempotent — if a socket is already open, do nothing. Matches the
    // spec "Multiple connect() calls -> only one active EventSource".
    if (es !== null) return;
    try {
      es = factory(url);
    } catch (err) {
      safeOnError(err instanceof Error ? err : new Error(String(err)));
      scheduleReconnect();
      return;
    }
    // Use addEventListener (not onmessage) because the task spec
    // requires the test stub to capture listeners by name.
    try {
      es.addEventListener("message", handleMessage as EventListener);
      es.addEventListener("open", handleOpen);
      es.addEventListener("error", handleError);
    } catch (err) {
      safeOnError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  const connect = (): void => {
    disposed = false;
    openSource();
  };

  const disconnect = (): void => {
    disposed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    closeCurrentSource();
  };

  const isConnected = (): boolean => {
    return es !== null && es.readyState === EVENT_SOURCE_OPEN;
  };

  const reconnectAttemptCount = (): number => reconnectAttempts;

  return Object.freeze({
    connect,
    disconnect,
    isConnected,
    reconnectAttemptCount,
  });
}
