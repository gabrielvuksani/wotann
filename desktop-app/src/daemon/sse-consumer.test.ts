/**
 * sse-consumer.test.ts — unit tests for the pure transport layer.
 *
 * Stubs the EventSource so tests never touch the network and can fire
 * synthetic `message`/`error`/`open` events deterministically.
 *
 * V9 T1.2: `mapServerFrame` + `createSseConsumer` must be exercised
 * along all of:
 *   - happy path (connect, receive, dispatch)
 *   - malformed JSON
 *   - session filter (events for other sessions dropped)
 *   - heartbeats (always delivered)
 *   - error + reconnect with exponential backoff (500, 1000, 2000, ...)
 *   - backoff cap at 30_000ms
 *   - maxReconnectAttempts stop
 *   - disconnect cancels pending reconnect
 *   - double-connect is a no-op (single active EventSource)
 *
 * Each assertion below maps to a single observable behavior. 30+
 * assertions total (20 required by task spec).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSseConsumer,
  mapServerFrame,
  type ComputerSessionEvent,
  type SseConsumer,
} from "./sse-consumer";

// ── Stub EventSource ────────────────────────────────────────

type Listener = (evt: Event | MessageEvent) => void;

/**
 * Minimal EventSource stub that records its constructor URL, captures
 * listeners by event name, and exposes `fire()` helpers so tests can
 * deterministically replay server frames.
 *
 * Every instance is registered in the module-level `stubRegistry` so
 * assertions can walk the full lifecycle — "the first EventSource
 * was closed before the second was created", etc.
 */
class StubEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readyState: number = StubEventSource.CONNECTING;
  closed: boolean = false;
  private readonly listeners: Map<string, Set<Listener>> = new Map();

  constructor(url: string) {
    this.url = url;
    stubRegistry.push(this);
  }

  addEventListener(event: string, handler: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  removeEventListener(event: string, handler: Listener): void {
    this.listeners.get(event)?.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.readyState = StubEventSource.CLOSED;
  }

  /** Fire a `message` event with the given data string (JSON-serialized). */
  fireMessage(data: string): void {
    this.readyState = StubEventSource.OPEN;
    const evt = { data } as MessageEvent;
    this.listeners.get("message")?.forEach((l) => l(evt));
  }

  /** Fire an `open` event; flips readyState to OPEN. */
  fireOpen(): void {
    this.readyState = StubEventSource.OPEN;
    this.listeners.get("open")?.forEach((l) => l({} as Event));
  }

  /** Fire an `error` event. */
  fireError(): void {
    this.listeners.get("error")?.forEach((l) => l({} as Event));
  }
}

let stubRegistry: StubEventSource[] = [];

function makeFactory(): (url: string) => EventSource {
  return (url: string) => new StubEventSource(url) as unknown as EventSource;
}

beforeEach(() => {
  stubRegistry = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── mapServerFrame: pure translation ────────────────────────

describe("mapServerFrame", () => {
  it("returns null for frames without a `type` string", () => {
    expect(mapServerFrame({})).toBeNull();
    expect(mapServerFrame({ type: 42 as unknown as string })).toBeNull();
  });

  it("returns null for non-heartbeat frames without a sessionId", () => {
    expect(mapServerFrame({ type: "step" })).toBeNull();
  });

  it("maps a `created` server frame to kind=session-started", () => {
    const evt = mapServerFrame({
      type: "created",
      sessionId: "s1",
      timestamp: 1000,
    });
    expect(evt).toEqual({
      kind: "session-started",
      sessionId: "s1",
      timestamp: 1000,
    });
  });

  it("maps a `claimed` server frame to kind=session-started", () => {
    const evt = mapServerFrame({
      type: "claimed",
      sessionId: "s1",
      timestamp: 1001,
    });
    expect(evt?.kind).toBe("session-started");
  });

  it("maps a plain `step` frame to kind=action-dispatched", () => {
    const evt = mapServerFrame({
      type: "step",
      sessionId: "s1",
      seq: 3,
      timestamp: 1234,
      payload: { action: "click" },
    });
    expect(evt).toEqual({
      kind: "action-dispatched",
      sessionId: "s1",
      action: "click",
      step: 3,
      timestamp: 1234,
    });
  });

  it("maps a `step` frame with `result` to kind=action-result", () => {
    const evt = mapServerFrame({
      type: "step",
      sessionId: "s1",
      seq: 4,
      timestamp: 2000,
      payload: { result: { output: "ok" }, durationMs: 42 },
    });
    expect(evt).toEqual({
      kind: "action-result",
      sessionId: "s1",
      step: 4,
      result: { output: "ok" },
      durationMs: 42,
      timestamp: 2000,
    });
  });

  it("maps a `step` frame with `error` to kind=action-error", () => {
    const evt = mapServerFrame({
      type: "step",
      sessionId: "s1",
      seq: 5,
      timestamp: 3000,
      payload: { error: "boom" },
    });
    expect(evt).toEqual({
      kind: "action-error",
      sessionId: "s1",
      step: 5,
      error: "boom",
      timestamp: 3000,
    });
  });

  it("maps a `done` frame to session-ended/complete", () => {
    const evt = mapServerFrame({
      type: "done",
      sessionId: "s1",
      timestamp: 9000,
    });
    expect(evt).toEqual({
      kind: "session-ended",
      sessionId: "s1",
      reason: "complete",
      timestamp: 9000,
    });
  });

  it("maps a server `error` frame to session-ended/error", () => {
    const evt = mapServerFrame({
      type: "error",
      sessionId: "s1",
      timestamp: 9100,
    });
    expect(evt?.kind).toBe("session-ended");
    if (evt?.kind === "session-ended") {
      expect(evt.reason).toBe("error");
    }
  });

  it("drops unknown server frame types silently (returns null)", () => {
    expect(
      mapServerFrame({ type: "file_write", sessionId: "s1", timestamp: 1 }),
    ).toBeNull();
    expect(
      mapServerFrame({ type: "cursor", sessionId: "s1", timestamp: 1 }),
    ).toBeNull();
  });

  it("maps a heartbeat frame without requiring a sessionId", () => {
    const evt = mapServerFrame({ type: "heartbeat", timestamp: 1500 });
    expect(evt).toEqual({ kind: "heartbeat", timestamp: 1500 });
  });
});

// ── createSseConsumer: transport behaviour ──────────────────

describe("createSseConsumer", () => {
  it("connect() invokes the factory with the configured URL", () => {
    const factory = vi.fn(makeFactory());
    const consumer = createSseConsumer({
      url: "http://example.test/stream",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: factory,
    });
    consumer.connect();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith("http://example.test/stream");
    expect(stubRegistry).toHaveLength(1);
    expect(stubRegistry[0]?.url).toBe("http://example.test/stream");
  });

  it("disconnect() calls close() on the active EventSource", () => {
    const consumer = createSseConsumer({
      url: "http://example.test/x",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    const es = stubRegistry[0]!;
    expect(es.closed).toBe(false);
    consumer.disconnect();
    expect(es.closed).toBe(true);
  });

  it("delivers a valid JSON message through onEvent as a typed event", () => {
    const received: ComputerSessionEvent[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: (e) => received.push(e),
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    const es = stubRegistry[0]!;
    es.fireMessage(
      JSON.stringify({
        sessionId: "s1",
        seq: 1,
        timestamp: 100,
        type: "step",
        payload: { action: "click" },
      }),
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      kind: "action-dispatched",
      sessionId: "s1",
      step: 1,
      action: "click",
    });
  });

  it("fires onError for malformed JSON and does NOT fire onEvent", () => {
    const received: ComputerSessionEvent[] = [];
    const errors: Error[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: (e) => received.push(e),
      onError: (e) => errors.push(e),
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    stubRegistry[0]!.fireMessage("this is not json");
    expect(received).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it("drops events for a different sessionId", () => {
    const received: ComputerSessionEvent[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: (e) => received.push(e),
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    const es = stubRegistry[0]!;
    es.fireMessage(
      JSON.stringify({
        sessionId: "DIFFERENT",
        seq: 1,
        timestamp: 100,
        type: "step",
        payload: { action: "click" },
      }),
    );
    expect(received).toHaveLength(0);
  });

  it("always delivers heartbeat events (no session filter)", () => {
    const received: ComputerSessionEvent[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: (e) => received.push(e),
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    stubRegistry[0]!.fireMessage(
      JSON.stringify({ type: "heartbeat", timestamp: 500 }),
    );
    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe("heartbeat");
  });

  it("isConnected() reflects EventSource.readyState", () => {
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
    });
    expect(consumer.isConnected()).toBe(false);
    consumer.connect();
    expect(consumer.isConnected()).toBe(false); // still CONNECTING
    stubRegistry[0]!.fireOpen();
    expect(consumer.isConnected()).toBe(true);
    consumer.disconnect();
    expect(consumer.isConnected()).toBe(false);
  });

  it("on error, calls onError and schedules a reconnect", () => {
    const errors: Error[] = [];
    const reconnects: number[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      onError: (e) => errors.push(e),
      onReconnect: (attempt) => reconnects.push(attempt),
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    stubRegistry[0]!.fireError();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(reconnects).toEqual([1]);
    // The old EventSource has been closed.
    expect(stubRegistry[0]!.closed).toBe(true);
  });

  it("maxReconnectAttempts stops further reconnects when reached", () => {
    const reconnects: number[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      onReconnect: (attempt) => reconnects.push(attempt),
      eventSourceFactory: makeFactory(),
      maxReconnectAttempts: 2,
      backoffMs: 100,
    });
    consumer.connect();
    // Attempt 1
    stubRegistry[0]!.fireError();
    expect(reconnects).toEqual([1]);
    vi.advanceTimersByTime(100);
    // Attempt 2
    stubRegistry[1]!.fireError();
    expect(reconnects).toEqual([1, 2]);
    vi.advanceTimersByTime(200);
    // Third error must NOT schedule another reconnect
    stubRegistry[2]!.fireError();
    expect(reconnects).toEqual([1, 2]);
  });

  it("backoff doubles per attempt starting at backoffMs", () => {
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
      backoffMs: 500,
    });
    consumer.connect();
    expect(stubRegistry).toHaveLength(1);
    stubRegistry[0]!.fireError();
    // First reconnect is scheduled at 500ms.
    vi.advanceTimersByTime(499);
    expect(stubRegistry).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(stubRegistry).toHaveLength(2);

    stubRegistry[1]!.fireError();
    // Second reconnect at 1000ms.
    vi.advanceTimersByTime(999);
    expect(stubRegistry).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(stubRegistry).toHaveLength(3);

    stubRegistry[2]!.fireError();
    // Third reconnect at 2000ms.
    vi.advanceTimersByTime(1999);
    expect(stubRegistry).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(stubRegistry).toHaveLength(4);
  });

  it("backoff caps at 30_000ms regardless of attempt count", () => {
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
      backoffMs: 1000,
    });
    consumer.connect();
    // Fire errors until backoff would exceed 30_000 (1000 * 2^n).
    // attempt 1: 1000, 2: 2000, 3: 4000, 4: 8000, 5: 16000, 6: 32000 -> cap 30_000
    for (let i = 0; i < 6; i++) {
      stubRegistry[i]!.fireError();
      vi.advanceTimersByTime(30_000);
    }
    expect(stubRegistry).toHaveLength(7);
    // Now trigger another error — delay should cap at 30_000, not grow beyond.
    stubRegistry[6]!.fireError();
    // At 29_999ms the 8th reconnect should NOT have occurred.
    vi.advanceTimersByTime(29_999);
    expect(stubRegistry).toHaveLength(7);
    vi.advanceTimersByTime(1);
    expect(stubRegistry).toHaveLength(8);
  });

  it("reconnectAttemptCount() reflects the attempts counter", () => {
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
      backoffMs: 100,
    });
    expect(consumer.reconnectAttemptCount()).toBe(0);
    consumer.connect();
    stubRegistry[0]!.fireError();
    expect(consumer.reconnectAttemptCount()).toBe(1);
    vi.advanceTimersByTime(100);
    stubRegistry[1]!.fireError();
    expect(consumer.reconnectAttemptCount()).toBe(2);
  });

  it("onReconnect is invoked once per scheduled attempt", () => {
    const reconnects: number[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      onReconnect: (attempt) => reconnects.push(attempt),
      eventSourceFactory: makeFactory(),
      backoffMs: 50,
    });
    consumer.connect();
    stubRegistry[0]!.fireError();
    vi.advanceTimersByTime(50);
    stubRegistry[1]!.fireError();
    vi.advanceTimersByTime(100);
    stubRegistry[2]!.fireError();
    expect(reconnects).toEqual([1, 2, 3]);
  });

  it("disconnect() during a scheduled reconnect cancels the reconnect", () => {
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
      backoffMs: 500,
    });
    consumer.connect();
    stubRegistry[0]!.fireError();
    expect(stubRegistry).toHaveLength(1);
    consumer.disconnect();
    // Advance well past when the reconnect would have fired.
    vi.advanceTimersByTime(10_000);
    expect(stubRegistry).toHaveLength(1);
  });

  it("multiple connect() calls produce only one active EventSource", () => {
    const factory = vi.fn(makeFactory());
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: factory,
    });
    consumer.connect();
    consumer.connect();
    consumer.connect();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(stubRegistry).toHaveLength(1);
  });

  it("onOpen resets the reconnect counter", () => {
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
      backoffMs: 50,
    });
    consumer.connect();
    stubRegistry[0]!.fireError();
    vi.advanceTimersByTime(50);
    expect(consumer.reconnectAttemptCount()).toBe(1);
    // New EventSource opens successfully — counter resets.
    stubRegistry[1]!.fireOpen();
    expect(consumer.reconnectAttemptCount()).toBe(0);
  });

  it("silently ignores non-object JSON payloads", () => {
    const received: ComputerSessionEvent[] = [];
    const errors: Error[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: (e) => received.push(e),
      onError: (e) => errors.push(e),
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    stubRegistry[0]!.fireMessage("42");
    stubRegistry[0]!.fireMessage('"a string"');
    stubRegistry[0]!.fireMessage("null");
    expect(received).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("silently drops frames with unknown `type`", () => {
    const received: ComputerSessionEvent[] = [];
    const consumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: (e) => received.push(e),
      eventSourceFactory: makeFactory(),
    });
    consumer.connect();
    stubRegistry[0]!.fireMessage(
      JSON.stringify({
        type: "cursor",
        sessionId: "s1",
        timestamp: 1,
        payload: {},
      }),
    );
    expect(received).toHaveLength(0);
  });

  it("freezes the returned consumer (immutability contract)", () => {
    const consumer: SseConsumer = createSseConsumer({
      url: "http://x/y",
      sessionId: "s1",
      onEvent: () => {},
      eventSourceFactory: makeFactory(),
    });
    expect(Object.isFrozen(consumer)).toBe(true);
  });
});
