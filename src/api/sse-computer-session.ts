/**
 * V9 T1.2 — SSE producer for `/events/computer-session`.
 *
 * The KAIROS RPC plane already exposes `computer.session.stream` for
 * polling-style JSON-RPC subscribers. This module adds a Server-Sent
 * Events (SSE) producer for the same event stream, so phone/desktop/CLI
 * clients that want a long-lived `text/event-stream` connection (rather
 * than poll-and-buffer) can hold a single TCP connection open and read
 * events as they arrive.
 *
 * Why SSE not WebSocket:
 *   - Computer-session events flow ONLY server -> client. Request payloads
 *     never go the other way (clients use RPC for that). SSE matches this
 *     unidirectional shape exactly.
 *   - SSE is plain HTTP — survives proxies, CDNs, browser back-button
 *     reconnects (built-in `Last-Event-ID` semantics).
 *   - Auto-reconnect is part of the spec (`retry:` field).
 *
 * Design:
 *   - Pure function: `attachComputerSessionSse(req, res, opts)` takes a
 *     Node `IncomingMessage` + `ServerResponse` pair, sets the SSE
 *     headers, subscribes to the store via `subscribeAll`, and writes
 *     each event as a `data:` frame. Disconnect cleans up the
 *     subscription so we don't leak listeners.
 *   - The producer is host-agnostic — it doesn't bind a port, and it
 *     doesn't own the route registration. The daemon's HTTP server
 *     wires the producer to `/events/computer-session`.
 *   - Honest accounting: every produced frame increments a counter
 *     accessible via the returned handle (used by the `/stats` view +
 *     by tests asserting fan-out actually fired).
 *
 * Quality bars:
 *   QB #6  honest stubs       — disconnects unsubscribe; errors propagate
 *   QB #7  per-call state     — each attach returns a fresh handle
 *   QB #13 env via param      — zero process.env reads
 *   QB #14 real-contract test — tests subscribe a real store, emit real
 *                                events, and assert the wire frames
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ComputerSessionStore, SessionEvent } from "../session/computer-session-store.js";

// ── Public types ───────────────────────────────────────────

export interface SseProducerOptions {
  /**
   * The session store to subscribe to. Must be the same store the rest
   * of the daemon uses — typically obtained via
   * `kairosRpc.getComputerSessionStore()`.
   */
  readonly store: ComputerSessionStore;
  /**
   * If supplied, the producer subscribes only to events for THIS session.
   * Replays history before live-tailing (the store's `subscribe` method
   * already does the replay; we do nothing extra). When omitted, the
   * producer subscribes to ALL sessions via `subscribeAll`.
   */
  readonly sessionId?: string;
  /**
   * Optional event-type filter. When set, only events whose `type` is in
   * this set are written. Useful for clients that only care about, say,
   * cursor frames.
   */
  readonly eventTypes?: ReadonlySet<SessionEvent["type"]>;
  /**
   * Maximum events to send per connection. After this many, the producer
   * sends an `event: complete` frame and ends the response. Default is
   * unbounded (Number.POSITIVE_INFINITY).
   */
  readonly maxEvents?: number;
  /**
   * Heartbeat interval in ms. Sends `: keepalive\n\n` (a comment frame
   * per the SSE spec) so reverse proxies don't reap idle connections.
   * Default 15_000. Set to 0 to disable.
   */
  readonly heartbeatMs?: number;
  /**
   * Reconnect hint sent as the SSE `retry:` field. Default 5_000 ms.
   */
  readonly retryMs?: number;
  /**
   * Injected timer factory — defaults to `setInterval`. Tests pass a
   * fake clock so heartbeat assertions don't require real time.
   */
  readonly setInterval?: (cb: () => void, ms: number) => NodeJS.Timeout;
  readonly clearInterval?: (handle: NodeJS.Timeout) => void;
}

export interface SseProducerHandle {
  /** Forces the producer to stop and end the response. Idempotent. */
  readonly close: () => void;
  /** Live count of events written to the wire. Resets per producer. */
  readonly framesWritten: () => number;
  /** Live count of heartbeats sent. */
  readonly heartbeatsSent: () => number;
  /** True until close() runs or the connection drops. */
  readonly isOpen: () => boolean;
}

// ── Defaults ───────────────────────────────────────────────

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_RETRY_MS = 5_000;
const DEFAULT_MAX_EVENTS = Number.POSITIVE_INFINITY;

// ── Producer ───────────────────────────────────────────────

/**
 * Attach an SSE producer to an HTTP request/response pair. Returns a
 * handle the host can use to close, inspect counters, etc.
 *
 * Per QB #7, each call returns a fresh handle with its own counters and
 * subscription. There is no module-global state.
 */
export function attachComputerSessionSse(
  _req: IncomingMessage,
  res: ServerResponse,
  options: SseProducerOptions,
): SseProducerHandle {
  // We don't currently use `req` beyond the `close` event listener it
  // provides (handled below). Annotated `_req` to keep the contract
  // (caller must thread the request) without a no-unused-vars lint.
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;

  // Per-instance closure state — encapsulated, never exported.
  let frames = 0;
  let heartbeats = 0;
  let open = true;
  let heartbeatHandle: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  // Write SSE preamble. Headers MUST be set before any data write.
  if (!res.headersSent) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable any proxy buffering. Without this, nginx + cloudflare
      // hold the response open until the body closes — defeats the
      // entire point of SSE.
      "X-Accel-Buffering": "no",
    });
  }
  // SSE retry hint — clients honour this when they reconnect.
  res.write(`retry: ${retryMs}\n\n`);

  // ── Helper: write one event frame ──
  const writeFrame = (event: SessionEvent): boolean => {
    if (!open) return false;
    if (options.eventTypes && !options.eventTypes.has(event.type)) {
      // Filtered out — don't count as a frame, don't write.
      return true;
    }
    // SSE frame format:
    //   id: <event-seq>
    //   event: <event-type>
    //   data: <json>
    //   <blank line>
    // The blank line is the frame terminator. Multi-line JSON is fine
    // because each line of `data:` is concatenated client-side per spec.
    const eventId = `${event.sessionId}:${event.seq}`;
    const json = JSON.stringify({
      sessionId: event.sessionId,
      seq: event.seq,
      timestamp: event.timestamp,
      type: event.type,
      payload: event.payload,
    });
    try {
      res.write(`id: ${eventId}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${json}\n\n`);
    } catch {
      // The transport is gone. Mark closed and stop.
      void close();
      return false;
    }
    frames += 1;
    if (frames >= maxEvents) {
      try {
        res.write(`event: complete\ndata: ${JSON.stringify({ frames })}\n\n`);
      } catch {
        // best effort
      }
      void close();
    }
    return true;
  };

  // ── Subscribe ──
  if (options.sessionId !== undefined) {
    unsubscribe = options.store.subscribe(options.sessionId, writeFrame);
  } else {
    unsubscribe = options.store.subscribeAll(writeFrame);
  }

  // ── Heartbeat ──
  if (heartbeatMs > 0) {
    heartbeatHandle = setIntervalFn(() => {
      if (!open) return;
      try {
        res.write(`: keepalive\n\n`);
        heartbeats += 1;
      } catch {
        void close();
      }
    }, heartbeatMs);
  }

  // ── Close logic ──
  function close(): void {
    if (!open) return;
    open = false;
    try {
      unsubscribe?.();
    } catch {
      // never throw out of close — we're already tearing down.
    }
    unsubscribe = null;
    if (heartbeatHandle !== null) {
      clearIntervalFn(heartbeatHandle);
      heartbeatHandle = null;
    }
    try {
      res.end();
    } catch {
      // best effort
    }
  }

  // ── Wire client-disconnect to close ──
  // The `close` event fires when the client TCP socket closes. We rely
  // on it to free the subscription so a flapping client doesn't pile
  // up listeners on the store.
  res.on?.("close", () => close());
  // ServerResponse 'close' fires before 'finish' on abrupt disconnects;
  // `finish` fires when end() completes. Both lead to teardown.
  res.on?.("finish", () => close());

  return {
    close,
    framesWritten: () => frames,
    heartbeatsSent: () => heartbeats,
    isOpen: () => open,
  };
}

/**
 * Convenience wrapper for a Node HTTP route handler.
 *
 *   server.on('request', (req, res) => {
 *     if (req.url === '/events/computer-session') {
 *       handleComputerSessionSseRequest(req, res, { store });
 *       return;
 *     }
 *     ...
 *   });
 *
 * Parses the optional `?session=<id>` query param so callers can scope
 * the subscription. Without it, falls back to subscribeAll.
 */
export function handleComputerSessionSseRequest(
  req: IncomingMessage,
  res: ServerResponse,
  base: { readonly store: ComputerSessionStore } & Omit<SseProducerOptions, "store" | "sessionId">,
): SseProducerHandle {
  const url = req.url ?? "";
  const qIdx = url.indexOf("?");
  let sessionId: string | undefined;
  if (qIdx >= 0) {
    const qs = url.slice(qIdx + 1);
    for (const pair of qs.split("&")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (key === "session" || key === "sessionId") {
        sessionId = decodeURIComponent(value);
      }
    }
  }
  return attachComputerSessionSse(req, res, {
    ...base,
    ...(sessionId !== undefined ? { sessionId } : {}),
  });
}
