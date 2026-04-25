/**
 * V9 T1.2 — Tests for the SSE producer.
 *
 * The producer is decoupled from the daemon's HTTP server, so tests stand
 * up a real `ComputerSessionStore`, build fake req/res objects, attach the
 * producer, and assert:
 *   - SSE preamble headers are written
 *   - subscribe() history is replayed
 *   - subsequent emits are forwarded as `data:` frames
 *   - heartbeat ticks fire on the injected timer
 *   - close() unsubscribes and ends the response
 *   - eventTypes filter excludes unwanted types
 *   - maxEvents terminates with `event: complete`
 *
 * QB #14 — assertions inspect the actual bytes written to the wire, not
 * just call counts. This catches the regression where a "wired" producer
 * returns a Handle but never writes a frame.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  attachComputerSessionSse,
  handleComputerSessionSseRequest,
} from "../../src/api/sse-computer-session.js";
import { ComputerSessionStore } from "../../src/session/computer-session-store.js";

// ── Fake req/res ───────────────────────────────────────────

function fakeReq(url: string = "/events/computer-session"): any {
  const ee = new EventEmitter();
  return Object.assign(ee, { url, method: "GET", headers: {} });
}

interface RecordedRes {
  readonly statusCalls: { code: number; headers: Record<string, string> }[];
  readonly writes: string[];
  readonly endCalls: number;
  headersSent: boolean;
  ended: boolean;
}

function fakeRes() {
  const recorded: RecordedRes = {
    statusCalls: [],
    writes: [],
    endCalls: 0,
    headersSent: false,
    ended: false,
  };
  const closeListeners: Array<() => void> = [];
  const finishListeners: Array<() => void> = [];

  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      recorded.statusCalls.push({ code, headers: headers ?? {} });
      recorded.headersSent = true;
      return res;
    },
    write(chunk: string): boolean {
      recorded.writes.push(chunk);
      return true;
    },
    end(chunk?: string): typeof res {
      if (chunk !== undefined) recorded.writes.push(chunk);
      recorded.endCalls += 1;
      recorded.ended = true;
      for (const l of finishListeners.splice(0)) l();
      return res;
    },
    on(event: string, cb: () => void) {
      if (event === "close") closeListeners.push(cb);
      if (event === "finish") finishListeners.push(cb);
      return res;
    },
    get headersSent(): boolean {
      return recorded.headersSent;
    },
    set headersSent(v: boolean) {
      recorded.headersSent = v;
    },
    triggerClose() {
      for (const l of closeListeners.splice(0)) l();
    },
  };
  return { res, recorded };
}

// ── Helpers ────────────────────────────────────────────────

function makeSession(store: ComputerSessionStore) {
  return store.create({
    creatorDeviceId: "phone-1",
    taskSpec: { task: "demo task" },
  });
}

// ── Preamble ───────────────────────────────────────────────

describe("attachComputerSessionSse — preamble", () => {
  it("writes SSE headers + retry hint", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
      retryMs: 7777,
    });
    expect(recorded.statusCalls).toHaveLength(1);
    expect(recorded.statusCalls[0]!.code).toBe(200);
    expect(recorded.statusCalls[0]!.headers["Content-Type"]).toBe("text/event-stream");
    expect(recorded.writes.some((w) => w.startsWith("retry: 7777"))).toBe(true);
    handle.close();
  });

  it("returns isOpen true initially", () => {
    const store = new ComputerSessionStore();
    const { res } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
    });
    expect(handle.isOpen()).toBe(true);
    handle.close();
    expect(handle.isOpen()).toBe(false);
  });
});

// ── Subscription ───────────────────────────────────────────

describe("attachComputerSessionSse — events subscribe + replay", () => {
  it("replays per-session history when sessionId given", () => {
    const store = new ComputerSessionStore();
    const session = makeSession(store);
    // Add a step so there's history when we attach.
    store.claim(session.id, "desktop-1");
    store.step({
      sessionId: session.id,
      deviceId: "desktop-1",
      step: { kind: "tick", n: 1 },
    });

    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      sessionId: session.id,
      heartbeatMs: 0,
    });

    // Look at frames written (filter to data: lines).
    const dataFrames = recorded.writes.filter((w) => w.startsWith("data: "));
    expect(dataFrames.length).toBeGreaterThanOrEqual(2);
    // Frame structure: `data: {json}\n\n`
    const first = dataFrames[0]!;
    expect(first).toContain('"type":"created"');
    expect(handle.framesWritten()).toBeGreaterThanOrEqual(2);
    handle.close();
  });

  it("subscribeAll forwards events from any session live", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
    });
    // No history before attach, so frame count is 0.
    expect(handle.framesWritten()).toBe(0);

    const session = makeSession(store);
    store.claim(session.id, "desktop-1");

    const dataFrames = recorded.writes.filter((w) => w.startsWith("data: "));
    expect(dataFrames.length).toBe(2); // created + claimed
    expect(handle.framesWritten()).toBe(2);
    handle.close();
  });

  it("includes id and event SSE fields", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
    });
    const session = makeSession(store);
    void session;

    const idLine = recorded.writes.find((w) => w.startsWith("id: "));
    const eventLine = recorded.writes.find((w) => w.startsWith("event: "));
    expect(idLine).toMatch(/^id: cs-[a-f0-9-]+:0\n$/);
    expect(eventLine).toBe("event: created\n");
  });

  it("filters by eventTypes when set", () => {
    const store = new ComputerSessionStore();
    const session = makeSession(store);
    store.claim(session.id, "desktop-1");
    store.step({
      sessionId: session.id,
      deviceId: "desktop-1",
      step: { kind: "tick" },
    });

    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      sessionId: session.id,
      eventTypes: new Set(["step"] as const),
      heartbeatMs: 0,
    });
    // Should have replayed only the step event (created/claimed filtered out).
    const dataFrames = recorded.writes.filter((w) => w.startsWith("data: "));
    expect(dataFrames.length).toBe(1);
    expect(dataFrames[0]!).toContain('"type":"step"');
    expect(handle.framesWritten()).toBe(1);
    handle.close();
  });
});

// ── Heartbeat ──────────────────────────────────────────────

describe("attachComputerSessionSse — heartbeat", () => {
  it("emits keepalive comment frames on injected timer", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    let registered: (() => void) | null = null;
    const fakeSetInterval = vi.fn((cb: () => void) => {
      registered = cb;
      return 42 as unknown as NodeJS.Timeout;
    });
    const fakeClearInterval = vi.fn();

    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 100,
      setInterval: fakeSetInterval,
      clearInterval: fakeClearInterval,
    });

    expect(fakeSetInterval).toHaveBeenCalledOnce();
    expect(registered).not.toBeNull();
    registered!();
    registered!();
    expect(handle.heartbeatsSent()).toBe(2);
    expect(recorded.writes.filter((w) => w === ": keepalive\n\n").length).toBe(2);

    handle.close();
    expect(fakeClearInterval).toHaveBeenCalledOnce();
  });

  it("disabled when heartbeatMs is 0", () => {
    const store = new ComputerSessionStore();
    const { res } = fakeRes();
    const fakeSetInterval = vi.fn();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
      setInterval: fakeSetInterval,
    });
    expect(fakeSetInterval).not.toHaveBeenCalled();
    handle.close();
  });
});

// ── Close lifecycle ────────────────────────────────────────

describe("attachComputerSessionSse — close lifecycle", () => {
  it("close() unsubscribes from store and ends response", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
    });
    const before = handle.framesWritten();
    handle.close();
    expect(handle.isOpen()).toBe(false);
    expect(recorded.endCalls).toBe(1);

    // Subsequent store events do NOT produce more frames.
    makeSession(store);
    expect(handle.framesWritten()).toBe(before);
  });

  it("client disconnect triggers close", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
    });
    expect(handle.isOpen()).toBe(true);
    (res as any).triggerClose();
    expect(handle.isOpen()).toBe(false);
    expect(recorded.ended).toBe(true);
  });

  it("close() is idempotent", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
    });
    handle.close();
    handle.close();
    expect(recorded.endCalls).toBe(1);
  });
});

// ── maxEvents ──────────────────────────────────────────────

describe("attachComputerSessionSse — maxEvents", () => {
  it("emits 'complete' frame and closes after maxEvents", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    const handle = attachComputerSessionSse(fakeReq(), res as any, {
      store,
      heartbeatMs: 0,
      maxEvents: 1,
    });
    makeSession(store);
    expect(handle.isOpen()).toBe(false);
    expect(recorded.writes.some((w) => w.startsWith("event: complete"))).toBe(true);
  });
});

// ── handleComputerSessionSseRequest URL parsing ────────────

describe("handleComputerSessionSseRequest — URL parsing", () => {
  it("extracts session= from query string", () => {
    const store = new ComputerSessionStore();
    const session = makeSession(store);
    store.claim(session.id, "desktop-1");

    const { res, recorded } = fakeRes();
    const req = fakeReq(`/events/computer-session?session=${encodeURIComponent(session.id)}`);
    const handle = handleComputerSessionSseRequest(req, res as any, {
      store,
      heartbeatMs: 0,
    });
    // Session-scoped subscribe replays both events for that session.
    const dataFrames = recorded.writes.filter((w) => w.startsWith("data: "));
    expect(dataFrames.length).toBe(2);
    expect(handle.framesWritten()).toBe(2);
    handle.close();
  });

  it("falls back to subscribeAll when no session query", () => {
    const store = new ComputerSessionStore();
    const { res, recorded } = fakeRes();
    const handle = handleComputerSessionSseRequest(fakeReq("/events/computer-session"), res as any, {
      store,
      heartbeatMs: 0,
    });
    expect(handle.framesWritten()).toBe(0);
    makeSession(store); // global subscribe should pick this up
    const dataFrames = recorded.writes.filter((w) => w.startsWith("data: "));
    expect(dataFrames.length).toBe(1);
    handle.close();
  });
});

// ── QB #7 isolation ────────────────────────────────────────

describe("attachComputerSessionSse — per-call state (QB #7)", () => {
  it("two attached producers maintain independent counters", () => {
    const store = new ComputerSessionStore();
    const a = fakeRes();
    const b = fakeRes();
    const ha = attachComputerSessionSse(fakeReq(), a.res as any, {
      store,
      heartbeatMs: 0,
    });
    const hb = attachComputerSessionSse(fakeReq(), b.res as any, {
      store,
      heartbeatMs: 0,
    });
    makeSession(store);
    expect(ha.framesWritten()).toBe(1);
    expect(hb.framesWritten()).toBe(1);
    ha.close();
    makeSession(store);
    expect(ha.framesWritten()).toBe(1); // closed → no further frames
    expect(hb.framesWritten()).toBe(2);
    hb.close();
  });
});
