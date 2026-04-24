/**
 * useComputerSession — React 19 hook that subscribes to a WOTANN
 * computer-use session SSE stream and exposes a bounded, immutable
 * snapshot of lifecycle events for the UI layer.
 *
 * V9 T1.2: desktop-app consumer for the F1 session event stream.
 * T1.1 wired the upstream producer (`computer.session.step` routes
 * through `executeDesktopAction` and emits `SessionEvent`s via the
 * `ComputerSessionStore`); this hook is the React-layer subscriber
 * for that stream.
 *
 * Boundary: this file is the ONLY React code in the T1.2 vertical.
 * All transport / parsing / reconnect logic lives in
 * `../daemon/sse-consumer.ts` (pure TS, testable without a DOM).
 *
 * Bounded buffer: the hook retains at most `MAX_RETAINED_EVENTS`
 * events in state — older events are dropped FIFO. Long sessions
 * (hours of cursor updates) would otherwise leak memory and slow
 * rendering to a crawl.
 *
 * Reconnect-on-sessionId-change: when the caller passes a new
 * `sessionId`, the hook tears down the old consumer and rebuilds
 * against the new id so stale events don't bleed between sessions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSseConsumer,
  type ComputerSessionEvent,
  type SseConsumer,
} from "../daemon/sse-consumer";

/** Maximum events retained in state. Drops FIFO beyond this. */
const MAX_RETAINED_EVENTS = 500;

/** Default daemon base URL — overridable via options. */
const DEFAULT_BASE_URL = "http://localhost:7531";

/** Path on the daemon that serves the computer-session SSE stream. */
const SSE_PATH = "/events/computer-session";

export interface UseComputerSessionOptions {
  /**
   * Base URL for the WOTANN daemon. Defaults to
   * `http://localhost:7531` (the standard Engine port). Override
   * when connecting to a remote daemon.
   */
  readonly baseUrl?: string;
}

export interface UseComputerSessionResult {
  /** `true` iff the EventSource is currently open. */
  readonly connected: boolean;
  /**
   * Immutable buffer of events received for this session, oldest
   * first. Bounded to `MAX_RETAINED_EVENTS` (500).
   */
  readonly events: readonly ComputerSessionEvent[];
  /**
   * Most recent non-heartbeat event, or `null` if none received
   * yet. Convenient for rendering "last action" indicators without
   * walking the full buffer.
   */
  readonly lastAction: ComputerSessionEvent | null;
  /**
   * Most recent transport or parse error message, or `null` when
   * the stream is healthy.
   */
  readonly errorMessage: string | null;
  /**
   * Manually trigger a reconnect. The current consumer is
   * disconnected and a fresh one is created for the same session.
   */
  readonly reconnect: () => void;
}

/**
 * Subscribe to a computer-use session's event stream.
 *
 * @param sessionId  The session id to subscribe to. Passing a
 *                   different id across renders tears down the old
 *                   stream and opens a new one.
 * @param options    Optional overrides; see `UseComputerSessionOptions`.
 */
export function useComputerSession(
  sessionId: string,
  options?: UseComputerSessionOptions,
): UseComputerSessionResult {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  // React 19 + StrictMode runs effects twice in dev; a counter lets us
  // force a fresh consumer when the caller calls `reconnect()` without
  // having to track the consumer ref from the render body.
  const [reconnectCounter, setReconnectCounter] = useState(0);
  const [events, setEvents] = useState<readonly ComputerSessionEvent[]>([]);
  const [lastAction, setLastAction] = useState<ComputerSessionEvent | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The consumer ref survives re-renders but is recreated when the
  // effect below re-runs (on sessionId/baseUrl/reconnectCounter
  // change). Keeping it in a ref lets `reconnect()` access the live
  // instance without adding the consumer itself to dependency lists.
  const consumerRef = useRef<SseConsumer | null>(null);

  const url = useMemo(
    () => `${baseUrl}${SSE_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
    [baseUrl, sessionId],
  );

  useEffect(() => {
    if (!sessionId) return undefined;

    // Fresh buffers for a fresh subscription. Done here (not in the
    // render body) so the hook's public surface stays stable across
    // re-renders that don't actually change sessionId.
    setEvents([]);
    setLastAction(null);
    setErrorMessage(null);
    setConnected(false);

    const consumer = createSseConsumer({
      url,
      sessionId,
      onEvent: (event) => {
        setEvents((prev) => {
          // Immutable append with FIFO cap. Creating a new array
          // rather than mutating keeps React's change detection
          // reliable (we rely on reference equality for memo checks
          // downstream).
          const next =
            prev.length >= MAX_RETAINED_EVENTS
              ? [...prev.slice(prev.length - MAX_RETAINED_EVENTS + 1), event]
              : [...prev, event];
          return next;
        });
        if (event.kind !== "heartbeat") {
          setLastAction(event);
        }
        // Heartbeats imply the stream is alive, but we don't want to
        // flip `connected` on every heartbeat — it's already true
        // after the first successful frame. Only set if needed.
        setConnected((wasConnected) => {
          if (wasConnected) return true;
          // The consumer's isConnected() reflects readyState; we use
          // it rather than trusting the heartbeat alone because a
          // heartbeat could theoretically arrive during a race with
          // a transport failure.
          return consumer.isConnected();
        });
      },
      onError: (err) => {
        setErrorMessage(err.message);
      },
      onReconnect: (attempt) => {
        setConnected(false);
        setErrorMessage(`reconnecting (attempt ${attempt})`);
      },
    });
    consumerRef.current = consumer;
    consumer.connect();

    // Poll-once to reflect the actual socket state a tick after
    // `connect()` resolves. This is cheap and avoids exposing an
    // extra callback from the pure consumer just for "I opened".
    const openCheck = setTimeout(() => {
      if (consumer.isConnected()) {
        setConnected(true);
      }
    }, 0);

    return () => {
      clearTimeout(openCheck);
      consumer.disconnect();
      consumerRef.current = null;
    };
    // `reconnectCounter` is intentionally in deps: bumping it
    // forces the effect to tear down + restart against the same
    // URL/sessionId. This is the idiomatic React 19 pattern for
    // "re-run this effect on demand".
  }, [url, sessionId, reconnectCounter]);

  const reconnect = useCallback((): void => {
    setReconnectCounter((n) => n + 1);
  }, []);

  return {
    connected,
    events,
    lastAction,
    errorMessage,
    reconnect,
  };
}
