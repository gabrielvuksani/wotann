/**
 * Tests for V9 R-06 + R-07 — desktop-app event bridge.
 *
 * The bridge subscribes to three daemon RPC topics (creations.updated,
 * computer.session.events, tool.result) and re-dispatches each as a
 * window CustomEvent (wotann:agent-edit, wotann:dispatch-fired,
 * wotann:mcp-app-mount). These tests pin:
 *
 *   1. The producer-consumer wire: every daemon event of the right
 *      shape produces a window event with the right detail.
 *   2. Defensive coercion: malformed payloads are dropped without
 *      throwing.
 *   3. Lifecycle: dispose() unsubscribes and is idempotent.
 *   4. Failure isolation: when one subscription throws, the others
 *      stay hot.
 *
 * The bridge is exercised against an injected listener factory and
 * an injected EventTarget so the test never needs Tauri / JSDOM.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createEventBridge,
  emitAgentEdit,
  emitDispatchFired,
  emitMcpAppMount,
  DAEMON_TOPIC,
  WINDOW_EVENT,
  type DaemonListenerFactory,
  type AgentEditDetail,
  type DispatchFiredDetail,
  type McpAppMountDetail,
} from "../../desktop-app/src/daemon/event-bridge.js";

// ── Test helpers ────────────────────────────────────────────

/**
 * Build a controllable listener factory. Returns the factory and a
 * `fire(topic, payload)` helper that synchronously delivers the
 * payload to every handler registered for the given topic.
 */
function buildListenerFactory(): {
  readonly factory: DaemonListenerFactory;
  readonly fire: (topic: string, payload: unknown) => void;
  readonly subscriberCount: () => number;
  readonly disposeCount: () => number;
} {
  const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>();
  let totalSubscribed = 0;
  let totalDisposed = 0;
  const factory: DaemonListenerFactory = {
    listen: async (topic, handler) => {
      let bucket = handlers.get(topic);
      if (!bucket) {
        bucket = new Set();
        handlers.set(topic, bucket);
      }
      const wrapped = handler as (event: { payload: unknown }) => void;
      bucket.add(wrapped);
      totalSubscribed += 1;
      return () => {
        bucket?.delete(wrapped);
        totalDisposed += 1;
      };
    },
  };
  return {
    factory,
    fire: (topic, payload) => {
      const bucket = handlers.get(topic);
      if (!bucket) return;
      for (const handler of bucket) {
        handler({ payload });
      }
    },
    subscriberCount: () => totalSubscribed,
    disposeCount: () => totalDisposed,
  };
}

/**
 * Capture every CustomEvent dispatched to a fresh EventTarget.
 * Returns the target and an array that grows in dispatch order.
 */
function buildCapture(): {
  readonly target: EventTarget;
  readonly events: ReadonlyArray<{ readonly type: string; readonly detail: unknown }>;
  readonly attachAll: () => void;
} {
  const target = new EventTarget();
  const events: { readonly type: string; readonly detail: unknown }[] = [];
  const attachAll = (): void => {
    for (const eventName of Object.values(WINDOW_EVENT)) {
      target.addEventListener(eventName, (ev: Event) => {
        events.push({ type: eventName, detail: (ev as CustomEvent).detail });
      });
    }
  };
  return { target, events, attachAll };
}

// ── Tests ───────────────────────────────────────────────────

describe("createEventBridge — daemon → window CustomEvent fan-out", () => {
  it("subscribes to all three daemon topics on construction", async () => {
    const { factory, subscriberCount } = buildListenerFactory();
    const { target } = buildCapture();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;
    expect(subscriberCount()).toBe(3);
    bridge.dispose();
  });

  it("forwards `creations.updated` payload as wotann:agent-edit", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.creationsUpdated, {
      action: "creation-saved",
      path: "/workspace/foo.ts",
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(WINDOW_EVENT.agentEdit);
    const detail = events[0]!.detail as AgentEditDetail;
    expect(detail.path).toBe("/workspace/foo.ts");
    expect(detail.kind).toBe("created");

    bridge.dispose();
  });

  it("derives `deleted` kind from a deleted=true payload", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.creationsUpdated, {
      path: "/workspace/gone.ts",
      deleted: true,
    });

    expect(events).toHaveLength(1);
    const detail = events[0]!.detail as AgentEditDetail;
    expect(detail.kind).toBe("deleted");

    bridge.dispose();
  });

  it("falls back to `modified` kind when payload is ambiguous", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.creationsUpdated, { path: "/workspace/edited.ts" });

    expect(events).toHaveLength(1);
    expect((events[0]!.detail as AgentEditDetail).kind).toBe("modified");

    bridge.dispose();
  });

  it("drops creation payloads without a path", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.creationsUpdated, { action: "creation-saved" });
    fire(DAEMON_TOPIC.creationsUpdated, null);
    fire(DAEMON_TOPIC.creationsUpdated, "not-an-object");

    expect(events).toHaveLength(0);

    bridge.dispose();
  });

  it("forwards a `step` session event as wotann:dispatch-fired", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.computerSessionEvents, {
      type: "step",
      sessionId: "sess-42",
      seq: 3,
      payload: { from: { x: 10, y: 20 }, to: { x: 100, y: 200 } },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(WINDOW_EVENT.dispatchFired);
    const detail = events[0]!.detail as DispatchFiredDetail;
    expect(detail.id).toBe("sess-42-3");
    expect(detail.from).toEqual({ x: 10, y: 20 });
    expect(detail.to).toEqual({ x: 100, y: 200 });

    bridge.dispose();
  });

  it("drops non-step session events (created, claimed, done, error, heartbeat)", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    for (const t of ["created", "claimed", "done", "error", "heartbeat", "unknown"]) {
      fire(DAEMON_TOPIC.computerSessionEvents, { type: t, sessionId: "s" });
    }

    expect(events).toHaveLength(0);

    bridge.dispose();
  });

  it("forwards a tool.result with _meta.ui.resourceUri as wotann:mcp-app-mount", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.toolResult, {
      _meta: { ui: { resourceUri: "ui://wotann/cost-preview" } },
      title: "Cost Preview",
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(WINDOW_EVENT.mcpAppMount);
    const detail = events[0]!.detail as McpAppMountDetail;
    expect(detail.resourceUri).toBe("ui://wotann/cost-preview");
    expect(detail.title).toBe("Cost Preview");

    bridge.dispose();
  });

  it("supports nested {result: {_meta: ui}} envelopes", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.toolResult, {
      result: {
        _meta: { ui: { resourceUri: "ui://x/inside-result" } },
      },
    });

    expect(events).toHaveLength(1);
    expect((events[0]!.detail as McpAppMountDetail).resourceUri).toBe(
      "ui://x/inside-result",
    );

    bridge.dispose();
  });

  it("drops tool.result payloads without _meta.ui.resourceUri", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.toolResult, { result: { ok: true } });
    fire(DAEMON_TOPIC.toolResult, { _meta: { other: 1 } });
    fire(DAEMON_TOPIC.toolResult, { _meta: { ui: { wrong: "field" } } });
    fire(DAEMON_TOPIC.toolResult, { _meta: { ui: { resourceUri: "" } } });

    expect(events).toHaveLength(0);

    bridge.dispose();
  });

  it("dispose() unsubscribes every daemon listener", async () => {
    const { factory, fire, disposeCount } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    bridge.dispose();
    expect(bridge.isDisposed()).toBe(true);
    expect(disposeCount()).toBe(3);

    // After dispose, the bucket entries are gone — even if a stray
    // payload sneaks through, the safeDispatch guard short-circuits.
    fire(DAEMON_TOPIC.creationsUpdated, { path: "/x" });
    expect(events).toHaveLength(0);
  });

  it("dispose() is idempotent (second call is a no-op)", async () => {
    const { factory } = buildListenerFactory();
    const { target } = buildCapture();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    bridge.dispose();
    bridge.dispose();
    expect(bridge.isDisposed()).toBe(true);
  });

  it("logs and continues when one daemon subscription rejects", async () => {
    const logger = vi.fn();
    const failingFactory: DaemonListenerFactory = {
      listen: async (topic, handler) => {
        if (topic === DAEMON_TOPIC.creationsUpdated) {
          throw new Error("simulated subscribe failure");
        }
        return buildListenerFactory().factory.listen(topic, handler);
      },
    };
    const { target } = buildCapture();
    const bridge = createEventBridge({
      listenerFactory: failingFactory,
      emitTarget: target,
      logger,
    });
    await bridge.ready;

    expect(logger).toHaveBeenCalled();
    const firstCall = logger.mock.calls[0]!;
    expect(firstCall[0]).toContain("listen subscription failed");
    bridge.dispose();
  });

  it("counts increment per topic on every successful dispatch", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, attachAll } = buildCapture();
    attachAll();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });
    await bridge.ready;

    fire(DAEMON_TOPIC.creationsUpdated, { path: "/a" });
    fire(DAEMON_TOPIC.creationsUpdated, { path: "/b" });
    fire(DAEMON_TOPIC.computerSessionEvents, { type: "step", sessionId: "s", seq: 1 });
    fire(DAEMON_TOPIC.toolResult, { _meta: { ui: { resourceUri: "ui://x" } } });

    const counts = bridge.getCounts();
    expect(counts[WINDOW_EVENT.agentEdit]).toBe(2);
    expect(counts[WINDOW_EVENT.dispatchFired]).toBe(1);
    expect(counts[WINDOW_EVENT.mcpAppMount]).toBe(1);

    bridge.dispose();
  });

  it("handler exceptions do not poison the rest of the bridge", async () => {
    const { factory, fire } = buildListenerFactory();
    const { target, events, attachAll } = buildCapture();
    attachAll();
    const logger = vi.fn();

    // EventTarget that throws on the agent-edit dispatch only.
    const trickyTarget: EventTarget = {
      dispatchEvent: (ev: Event) => {
        if (ev.type === WINDOW_EVENT.agentEdit) {
          throw new Error("dispatch failed");
        }
        return target.dispatchEvent(ev);
      },
    } as EventTarget;

    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: trickyTarget,
      logger,
    });
    await bridge.ready;

    // First fire goes to the tricky target — bridge logs + drops.
    fire(DAEMON_TOPIC.creationsUpdated, { path: "/poison" });
    // Second fire on a different topic should still land.
    fire(DAEMON_TOPIC.toolResult, { _meta: { ui: { resourceUri: "ui://ok" } } });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(WINDOW_EVENT.mcpAppMount);
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("dispatch threw"),
      expect.any(Object),
    );

    bridge.dispose();
  });

  it("dispose() before subscriptions resolve still tears down the late ones", async () => {
    // Use a factory whose listen() returns a never-yet-resolved
    // promise so we can inspect the race-with-dispose behaviour.
    let resolveOne: ((dispose: () => void) => void) | null = null;
    let lateDisposeCalled = false;
    const factory: DaemonListenerFactory = {
      listen: async (topic) => {
        if (topic === DAEMON_TOPIC.creationsUpdated) {
          return new Promise<() => void>((res) => {
            resolveOne = (dispose) => res(dispose);
          });
        }
        return () => {};
      },
    };
    const { target } = buildCapture();
    const bridge = createEventBridge({
      listenerFactory: factory,
      emitTarget: target,
      logger: () => {},
    });

    // Dispose before the slow subscription resolves.
    bridge.dispose();
    expect(bridge.isDisposed()).toBe(true);

    // Now resolve the slow listen() call. Bridge should immediately
    // call its dispose because the bridge already considers itself
    // disposed.
    resolveOne!(() => {
      lateDisposeCalled = true;
    });

    await bridge.ready;
    expect(lateDisposeCalled).toBe(true);
  });
});

// ── Convenience emitters ────────────────────────────────────

describe("convenience emitters", () => {
  it("emitAgentEdit dispatches a wotann:agent-edit event", () => {
    const seen: AgentEditDetail[] = [];
    const handler = (ev: Event): void => {
      seen.push((ev as CustomEvent).detail as AgentEditDetail);
    };
    if (typeof globalThis.window === "undefined") {
      // Synthesise a window stub for this test only.
      (globalThis as { window?: EventTarget }).window = new EventTarget();
    }
    const target = (globalThis as { window: EventTarget }).window;
    target.addEventListener(WINDOW_EVENT.agentEdit, handler);
    try {
      const ok = emitAgentEdit({ path: "/x", kind: "modified" });
      expect(ok).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.path).toBe("/x");
    } finally {
      target.removeEventListener(WINDOW_EVENT.agentEdit, handler);
    }
  });

  it("emitDispatchFired dispatches a wotann:dispatch-fired event", () => {
    const seen: DispatchFiredDetail[] = [];
    const handler = (ev: Event): void => {
      seen.push((ev as CustomEvent).detail as DispatchFiredDetail);
    };
    if (typeof globalThis.window === "undefined") {
      (globalThis as { window?: EventTarget }).window = new EventTarget();
    }
    const target = (globalThis as { window: EventTarget }).window;
    target.addEventListener(WINDOW_EVENT.dispatchFired, handler);
    try {
      const ok = emitDispatchFired({ id: "abc" });
      expect(ok).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.id).toBe("abc");
    } finally {
      target.removeEventListener(WINDOW_EVENT.dispatchFired, handler);
    }
  });

  it("emitMcpAppMount dispatches a wotann:mcp-app-mount event", () => {
    const seen: McpAppMountDetail[] = [];
    const handler = (ev: Event): void => {
      seen.push((ev as CustomEvent).detail as McpAppMountDetail);
    };
    if (typeof globalThis.window === "undefined") {
      (globalThis as { window?: EventTarget }).window = new EventTarget();
    }
    const target = (globalThis as { window: EventTarget }).window;
    target.addEventListener(WINDOW_EVENT.mcpAppMount, handler);
    try {
      const ok = emitMcpAppMount({ resourceUri: "ui://x" });
      expect(ok).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.resourceUri).toBe("ui://x");
    } finally {
      target.removeEventListener(WINDOW_EVENT.mcpAppMount, handler);
    }
  });
});
