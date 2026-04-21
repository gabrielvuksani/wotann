/**
 * Phase 3 P1-F2 — Cursor Stream tests (real-time cursor coordinate events).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S2 and MASTER_PLAN_V8
 * §5 P1-F2 (1 day), F1 already ships `cursor` as a valid `SessionEvent` type.
 * F2 adds a stateless enrichment pipeline (CursorStream) on top of the store
 * so desktop-control agents can emit 100+ move samples/sec without
 * poisoning the event log. Clicks and scrolls pass through immediately.
 *
 * Tests exercise:
 *   Stream-level (CursorStream + deterministic scheduler):
 *     1.  move event coalesces (single pending after record)
 *     2.  click passes through immediately (no coalesce buffer)
 *     3.  scroll passes through immediately
 *     4.  10 moves within the 33ms window → exactly 1 emit (latest-wins)
 *     5.  move after an idle window → new schedule, not merged
 *     6.  NaN x → ErrorInvalidCoordinates
 *     7.  negative y → ErrorInvalidCoordinates
 *     8.  x above maxCoordinate → ErrorInvalidCoordinates
 *     9.  session-not-found → ErrorSessionNotFound
 *    10.  two sessions isolate (independent throttle buffers)
 *    11.  broadcast fires per emit (cursor UnifiedEvent) only after coalesce
 *    12.  terminal session rejects emit with SessionIllegalTransitionError
 *    13.  flush() drains the pending move immediately
 *
 *   RPC-level (via KairosRPCHandler):
 *    14.  cursor.emit full lifecycle: create session → claim → emit → subscribe sees event
 *    15.  cursor.subscribe filters out non-cursor events (step events)
 *    16.  cursor.emit with invalid coords surfaces RPC error
 *    17.  cursor.emit on unknown session surfaces RPC error
 *
 * Uses a FakeScheduler so coalesce windows are reliable on clean CI
 * (QB #12 — no wall-clock dependence).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CursorStream,
  ErrorInvalidCoordinates,
  ErrorSessionNotFound,
  type CursorSample,
  type Scheduler,
} from "../../src/session/cursor-stream.js";
import {
  ComputerSessionStore,
  SessionIllegalTransitionError,
} from "../../src/session/computer-session-store.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";
import type { UnifiedEvent } from "../../src/channels/fan-out.js";

// ── Deterministic scheduler + clock ─────────────────────────

class FakeScheduler implements Scheduler {
  private next = 1;
  private readonly timers = new Map<
    number,
    { fn: () => void; runAt: number }
  >();
  private t = 1_000_000;

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { fn, runAt: this.t + ms });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.timers.delete(handle);
  }

  /** Advance the clock and run any timers whose runAt ≤ the new time. */
  advance(ms: number): void {
    this.t += ms;
    const due = [...this.timers.entries()]
      .filter(([, t]) => t.runAt <= this.t)
      .sort((a, b) => a[1].runAt - b[1].runAt);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.fn();
    }
  }

  pendingCount(): number {
    return this.timers.size;
  }
}

// ── Helpers ───────────────────────────────────────────────

function createSession(store: ComputerSessionStore, deviceId = "desktop-A"): string {
  const session = store.create({
    creatorDeviceId: deviceId,
    taskSpec: { task: "cursor test" },
  });
  return session.id;
}

function makeSample(overrides: Partial<CursorSample> & { sessionId: string }): CursorSample {
  return {
    deviceId: "desktop-A",
    x: 100,
    y: 200,
    action: "move",
    ...overrides,
  };
}

// ── Stream-level tests ────────────────────────────────────

describe("CursorStream — F2 coalescing + validation", () => {
  let store: ComputerSessionStore;
  let scheduler: FakeScheduler;
  let stream: CursorStream;
  let broadcasts: UnifiedEvent[];
  let sessionId: string;

  beforeEach(() => {
    store = new ComputerSessionStore();
    scheduler = new FakeScheduler();
    broadcasts = [];
    stream = new CursorStream({
      store,
      now: scheduler.now.bind(scheduler),
      scheduler,
      broadcast: (ev) => {
        broadcasts.push(ev);
      },
    });
    sessionId = createSession(store);
  });

  afterEach(() => {
    stream.close();
  });

  // 1. move event coalesces
  it("single move event is coalesced (not emitted) until the window elapses", () => {
    const outcome = stream.record(makeSample({ sessionId, x: 10, y: 20 }));
    expect(outcome).toBe("coalesced");
    expect(stream.pendingSessionCount()).toBe(1);

    // Nothing on the session event log yet
    const session = store.get(sessionId);
    const cursorEvents = session.events.filter((e) => e.type === "cursor");
    expect(cursorEvents).toHaveLength(0);

    // No broadcast either
    expect(broadcasts).toHaveLength(0);
  });

  // 2. click passes through immediately
  it("click event emits immediately — no coalesce buffer", () => {
    const outcome = stream.record(
      makeSample({ sessionId, x: 10, y: 20, action: "click", button: "left" }),
    );
    expect(outcome).toBe("emitted");
    expect(stream.pendingSessionCount()).toBe(0);

    const session = store.get(sessionId);
    const cursorEvents = session.events.filter((e) => e.type === "cursor");
    expect(cursorEvents).toHaveLength(1);
    expect((cursorEvents[0]?.payload as Record<string, unknown>)["action"]).toBe("click");
    expect((cursorEvents[0]?.payload as Record<string, unknown>)["button"]).toBe("left");
  });

  // 3. scroll passes through immediately
  it("scroll event emits immediately — no coalesce buffer", () => {
    const outcome = stream.record(
      makeSample({ sessionId, x: 10, y: 20, action: "scroll", deltaX: 0, deltaY: -120 }),
    );
    expect(outcome).toBe("emitted");
    expect(stream.pendingSessionCount()).toBe(0);

    const session = store.get(sessionId);
    const cursorEvents = session.events.filter((e) => e.type === "cursor");
    expect(cursorEvents).toHaveLength(1);
    expect((cursorEvents[0]?.payload as Record<string, unknown>)["action"]).toBe("scroll");
    expect((cursorEvents[0]?.payload as Record<string, unknown>)["deltaY"]).toBe(-120);
  });

  // 4. 10 moves within the 33ms window → exactly 1 emit (latest-wins)
  it("coalesces 10 rapid moves into 1 emit at window close (latest coordinate wins)", () => {
    for (let i = 0; i < 10; i++) {
      stream.record(makeSample({ sessionId, x: i * 10, y: i * 5 }));
      // Stay inside the coalesce window across all samples.
      scheduler.advance(2);
    }
    // Still one pending — no timer fired yet.
    expect(stream.pendingSessionCount()).toBe(1);

    const session = store.get(sessionId);
    expect(session.events.filter((e) => e.type === "cursor")).toHaveLength(0);

    // Fast-forward past the coalesce window — timer fires once.
    scheduler.advance(100);

    const updated = store.get(sessionId);
    const cursorEvents = updated.events.filter((e) => e.type === "cursor");
    expect(cursorEvents).toHaveLength(1);
    // Latest sample (i=9) should be the surviving coordinate.
    const payload = cursorEvents[0]?.payload as Record<string, unknown>;
    expect(payload["x"]).toBe(90);
    expect(payload["y"]).toBe(45);

    // Exactly one broadcast.
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe("cursor");
  });

  // 5. move after an idle window → new schedule, not merged
  it("moves separated by > coalesce window produce two separate emits", () => {
    stream.record(makeSample({ sessionId, x: 1, y: 1 }));
    scheduler.advance(50); // past 33ms window — flush fires
    stream.record(makeSample({ sessionId, x: 2, y: 2 }));
    scheduler.advance(50); // past 33ms — flush fires again

    const session = store.get(sessionId);
    const cursorEvents = session.events.filter((e) => e.type === "cursor");
    expect(cursorEvents).toHaveLength(2);
    expect((cursorEvents[0]?.payload as Record<string, unknown>)["x"]).toBe(1);
    expect((cursorEvents[1]?.payload as Record<string, unknown>)["x"]).toBe(2);
  });

  // 6. NaN x → ErrorInvalidCoordinates
  it("NaN x coordinate → ErrorInvalidCoordinates", () => {
    expect(() =>
      stream.record(makeSample({ sessionId, x: Number.NaN, y: 10 })),
    ).toThrow(ErrorInvalidCoordinates);
  });

  // 7. negative y → ErrorInvalidCoordinates
  it("negative y coordinate → ErrorInvalidCoordinates", () => {
    expect(() => stream.record(makeSample({ sessionId, x: 10, y: -1 }))).toThrow(
      ErrorInvalidCoordinates,
    );
  });

  // 8. x above maxCoordinate → ErrorInvalidCoordinates
  it("x above maxCoordinate → ErrorInvalidCoordinates", () => {
    expect(() =>
      stream.record(makeSample({ sessionId, x: 99_999, y: 10 })),
    ).toThrow(ErrorInvalidCoordinates);
  });

  // 9. session-not-found → ErrorSessionNotFound
  it("unknown sessionId → ErrorSessionNotFound", () => {
    expect(() =>
      stream.record(makeSample({ sessionId: "cs-nope", x: 10, y: 10 })),
    ).toThrow(ErrorSessionNotFound);
  });

  // 10. two sessions isolate
  it("throttle buffers are isolated per-session", () => {
    const s2 = createSession(store, "desktop-B");
    stream.record(makeSample({ sessionId, x: 1, y: 1 }));
    stream.record(makeSample({ sessionId: s2, deviceId: "desktop-B", x: 2, y: 2 }));
    expect(stream.pendingSessionCount()).toBe(2);

    scheduler.advance(100);

    // Each session gets exactly one cursor event; coordinates don't leak.
    const sA = store.get(sessionId);
    const sB = store.get(s2);
    const cursorA = sA.events.filter((e) => e.type === "cursor");
    const cursorB = sB.events.filter((e) => e.type === "cursor");
    expect(cursorA).toHaveLength(1);
    expect(cursorB).toHaveLength(1);
    expect((cursorA[0]?.payload as Record<string, unknown>)["x"]).toBe(1);
    expect((cursorB[0]?.payload as Record<string, unknown>)["x"]).toBe(2);
  });

  // 11. broadcast fires per emit (cursor UnifiedEvent)
  it("broadcast fires per emit, not per record (move path coalesces first)", () => {
    // Five move samples inside the window — zero broadcasts during.
    for (let i = 0; i < 5; i++) {
      stream.record(makeSample({ sessionId, x: i, y: i }));
      scheduler.advance(2);
    }
    expect(broadcasts).toHaveLength(0);

    scheduler.advance(100);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe("cursor");
    const payload = broadcasts[0]?.payload as Record<string, unknown>;
    expect(payload["sessionId"]).toBe(sessionId);
    expect(payload["action"]).toBe("move");
  });

  // 12. terminal session rejects emit
  it("emits on a terminal session throw SessionIllegalTransitionError via the store", () => {
    // Terminalize by claim + close(done)
    store.claim(sessionId, "desktop-A");
    store.close({ sessionId, deviceId: "desktop-A", outcome: "done" });

    // Record() validates the session exists (pre-emit) — but the store
    // will reject the actual emit since the session is terminal.
    // Click bypasses coalesce so we see the error synchronously.
    expect(() =>
      stream.record(
        makeSample({ sessionId, x: 5, y: 5, action: "click" }),
      ),
    ).toThrow(SessionIllegalTransitionError);
  });

  // 13. flush() drains immediately
  it("flush() drains the pending coalesced move immediately", () => {
    stream.record(makeSample({ sessionId, x: 42, y: 99 }));
    expect(stream.pendingSessionCount()).toBe(1);

    stream.flush(sessionId);

    expect(stream.pendingSessionCount()).toBe(0);
    const session = store.get(sessionId);
    const cursorEvents = session.events.filter((e) => e.type === "cursor");
    expect(cursorEvents).toHaveLength(1);
    expect((cursorEvents[0]?.payload as Record<string, unknown>)["x"]).toBe(42);
  });
});

// ── RPC-level tests ───────────────────────────────────────

describe("cursor.* RPC family (F2)", () => {
  let handler: KairosRPCHandler;
  let nextId = 1;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
  });

  afterEach(() => {
    handler.getCursorStream().close();
  });

  async function call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<RPCResponse> {
    const raw = JSON.stringify({ jsonrpc: "2.0", method, params, id: nextId++ });
    const res = await handler.handleMessage(raw);
    return res as RPCResponse;
  }

  // 14. cursor.emit full lifecycle
  it("cursor.emit + cursor.subscribe full lifecycle", async () => {
    const created = await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "research quantum sensors" },
    });
    const sessionId = (created.result as { id: string }).id;

    // Click event (no coalesce) — test the full round-trip cleanly without
    // needing to wait on a real 33ms timer.
    const emit = await call("cursor.emit", {
      sessionId,
      deviceId: "desktop-A",
      action: "click",
      x: 150,
      y: 300,
      button: "left",
    });
    expect(emit.error).toBeUndefined();
    expect((emit.result as { outcome: string }).outcome).toBe("emitted");

    // Subscribe — fresh, sees the one cursor event in history.
    const sub = await call("cursor.subscribe", { sessionId });
    expect(sub.error).toBeUndefined();
    const subOut = sub.result as {
      subscriptionId: string;
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    };
    expect(subOut.subscriptionId).toMatch(/^cs-cursor-/);
    expect(subOut.events).toHaveLength(1);
    expect(subOut.events[0]?.type).toBe("cursor");
    expect(subOut.events[0]?.payload["x"]).toBe(150);
    expect(subOut.events[0]?.payload["action"]).toBe("click");
  });

  // 15. cursor.subscribe filters out non-cursor events
  it("cursor.subscribe filters out non-cursor events (step events hidden)", async () => {
    const created = await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "filter test" },
    });
    const sessionId = (created.result as { id: string }).id;

    // Claim so we can step
    await call("computer.session.claim", {
      sessionId,
      deviceId: "desktop-A",
    });

    // Mix step + cursor events
    await call("computer.session.step", {
      sessionId,
      deviceId: "desktop-A",
      step: { action: "scroll-app" },
    });
    await call("cursor.emit", {
      sessionId,
      deviceId: "desktop-A",
      action: "click",
      x: 10,
      y: 20,
    });
    await call("computer.session.step", {
      sessionId,
      deviceId: "desktop-A",
      step: { action: "type-text" },
    });
    await call("cursor.emit", {
      sessionId,
      deviceId: "desktop-A",
      action: "scroll",
      x: 30,
      y: 40,
      deltaY: 100,
    });

    const sub = await call("cursor.subscribe", { sessionId });
    const out = sub.result as {
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    };
    // Only cursor events — no step events.
    expect(out.events.length).toBe(2);
    for (const e of out.events) {
      expect(e.type).toBe("cursor");
    }
    expect(out.events[0]?.payload["action"]).toBe("click");
    expect(out.events[1]?.payload["action"]).toBe("scroll");
  });

  // 16. invalid coords surfaces RPC error
  it("cursor.emit with invalid coordinates surfaces CURSOR_INVALID_COORDINATES", async () => {
    const created = await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "bad coords" },
    });
    const sessionId = (created.result as { id: string }).id;

    const res = await call("cursor.emit", {
      sessionId,
      deviceId: "desktop-A",
      action: "click",
      x: -5,
      y: 10,
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/Invalid cursor coordinates/);
  });

  // 17. unknown session surfaces RPC error
  it("cursor.emit on unknown sessionId surfaces CURSOR_SESSION_NOT_FOUND", async () => {
    const res = await call("cursor.emit", {
      sessionId: "cs-does-not-exist",
      deviceId: "desktop-A",
      action: "click",
      x: 10,
      y: 10,
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/Cursor session not found/);
  });
});
