/**
 * V9 T10.4 — ChromeBridge.subscribeTabEvents tests.
 *
 * Covers translation of CDP `Target.*` messages into TabEvents, the
 * unsubscribe path, and the honest-failure path when the underlying
 * WebSocket cannot be obtained.
 *
 * Quality bars under test:
 *   QB #6 — honest failures: no WebSocket → unsubscribe is a harmless
 *           no-op; events are never fabricated.
 *   QB #7 — per-call state: each test owns its socket instance.
 *   QB #13 — no process.env reads.
 */

import { describe, expect, it, vi } from "vitest";

import {
  ChromeBridge,
  type TabEvent,
  type TabSubscribeSocket,
} from "../../src/browser/chrome-bridge.js";

/**
 * Build a fake TabSubscribeSocket that records sends, lets the test
 * drive `onopen`/`onmessage`, and tracks whether `close()` ran. Each
 * call to `makeFakeSocket()` returns a fresh socket (QB #7).
 */
function makeFakeSocket(): {
  readonly socket: TabSubscribeSocket;
  readonly sends: string[];
  readonly isClosed: () => boolean;
  readonly receive: (method: string, params: Record<string, unknown>) => void;
} {
  const sends: string[] = [];
  let closed = false;
  const socket: TabSubscribeSocket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (data: string) => {
      sends.push(data);
    },
    close: () => {
      closed = true;
    },
  };
  return {
    socket,
    sends,
    isClosed: () => closed,
    receive: (method: string, params: Record<string, unknown>) => {
      const handler = socket.onmessage;
      if (handler) handler({ data: JSON.stringify({ method, params }) });
    },
  };
}

/** Await one microtask so the async IIFE in subscribeTabEvents runs. */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ChromeBridge.subscribeTabEvents", () => {
  it("emits 'attached' for Target.attachedToTarget", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    const events: TabEvent[] = [];
    bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://localhost:9222/devtools/browser/x",
      wsFactory: () => fake.socket,
      now: () => 42,
    });
    await flush();
    fake.socket.onopen?.();
    fake.receive("Target.attachedToTarget", {
      targetInfo: { targetId: "T1", url: "https://a.com/", title: "A", type: "page" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "attached",
      targetId: "T1",
      url: "https://a.com/",
      title: "A",
      timestamp: 42,
    });
  });

  it("emits 'destroyed' for Target.targetDestroyed", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    const events: TabEvent[] = [];
    bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => fake.socket,
      now: () => 7,
    });
    await flush();
    fake.receive("Target.targetDestroyed", { targetId: "T9" });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("destroyed");
    expect(events[0]?.targetId).toBe("T9");
    expect(events[0]?.timestamp).toBe(7);
  });

  it("emits 'info-changed' for Target.targetInfoChanged", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    const events: TabEvent[] = [];
    bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => fake.socket,
    });
    await flush();
    fake.receive("Target.targetInfoChanged", {
      targetInfo: { targetId: "T2", url: "https://b.com/", title: "B", type: "page" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("info-changed");
    expect(events[0]?.url).toBe("https://b.com/");
  });

  it("sends Target.setDiscoverTargets on open", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    bridge.subscribeTabEvents(() => undefined, {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => fake.socket,
    });
    await flush();
    fake.socket.onopen?.();
    expect(fake.sends).toHaveLength(1);
    const payload = JSON.parse(fake.sends[0] ?? "{}") as { method: string; params: { discover: boolean } };
    expect(payload.method).toBe("Target.setDiscoverTargets");
    expect(payload.params.discover).toBe(true);
  });

  it("unsubscribe closes the socket and stops event emission", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    const events: TabEvent[] = [];
    const unsubscribe = bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => fake.socket,
    });
    await flush();
    unsubscribe();
    expect(fake.isClosed()).toBe(true);
    // Any inbound frames delivered after unsubscribe are silently dropped.
    fake.receive("Target.targetDestroyed", { targetId: "T-late" });
    expect(events).toHaveLength(0);
  });

  it("filters out non-page target types (workers, service-workers, etc.)", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    const events: TabEvent[] = [];
    bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => fake.socket,
    });
    await flush();
    fake.receive("Target.attachedToTarget", {
      targetInfo: { targetId: "W1", url: "", title: "", type: "service_worker" },
    });
    expect(events).toHaveLength(0);
    fake.receive("Target.attachedToTarget", {
      targetInfo: { targetId: "P1", url: "https://a.com/", title: "A", type: "page" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.targetId).toBe("P1");
  });

  it("ignores malformed frames (bad JSON) without throwing", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    const events: TabEvent[] = [];
    bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => fake.socket,
    });
    await flush();
    // Not valid JSON — should not throw, should not emit.
    expect(() => fake.socket.onmessage?.({ data: "not-json{{" })).not.toThrow();
    expect(events).toHaveLength(0);
  });

  it("returns a no-op unsubscribe when fetchBrowserEndpoint resolves null (honest failure)", async () => {
    const bridge = new ChromeBridge();
    const events: TabEvent[] = [];
    const wsFactory = vi.fn(() => makeFakeSocket().socket);
    const unsubscribe = bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => null,
      wsFactory,
    });
    await flush();
    // We never called wsFactory because the endpoint was unresolvable.
    expect(wsFactory).not.toHaveBeenCalled();
    // Unsubscribe is harmless.
    expect(() => unsubscribe()).not.toThrow();
    expect(events).toHaveLength(0);
  });

  it("returns a no-op unsubscribe when wsFactory throws", async () => {
    const bridge = new ChromeBridge();
    const events: TabEvent[] = [];
    const unsubscribe = bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => {
        throw new Error("ws boom");
      },
    });
    await flush();
    expect(() => unsubscribe()).not.toThrow();
    expect(events).toHaveLength(0);
  });

  it("does not emit events when the targetId is missing", async () => {
    const bridge = new ChromeBridge();
    const fake = makeFakeSocket();
    const events: TabEvent[] = [];
    bridge.subscribeTabEvents((e) => events.push(e), {
      fetchBrowserEndpoint: async () => "ws://x",
      wsFactory: () => fake.socket,
    });
    await flush();
    fake.receive("Target.attachedToTarget", { targetInfo: { url: "https://a.com/" } });
    fake.receive("Target.targetDestroyed", {});
    expect(events).toHaveLength(0);
  });

  it("independent subscriptions don't share state (QB #7)", async () => {
    const bridgeA = new ChromeBridge();
    const bridgeB = new ChromeBridge();
    const fakeA = makeFakeSocket();
    const fakeB = makeFakeSocket();
    const eventsA: TabEvent[] = [];
    const eventsB: TabEvent[] = [];
    bridgeA.subscribeTabEvents((e) => eventsA.push(e), {
      fetchBrowserEndpoint: async () => "ws://A",
      wsFactory: () => fakeA.socket,
    });
    bridgeB.subscribeTabEvents((e) => eventsB.push(e), {
      fetchBrowserEndpoint: async () => "ws://B",
      wsFactory: () => fakeB.socket,
    });
    await flush();
    fakeA.receive("Target.attachedToTarget", {
      targetInfo: { targetId: "T-A", url: "https://a.com/", type: "page" },
    });
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(0);
  });
});
