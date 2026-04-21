/**
 * Phase 3 P1-F11 — Multi-surface fan-out via UnifiedDispatchPlane.
 *
 * Covers:
 *   - register/unregister lifecycle
 *   - broadcast reaches all registered surfaces
 *   - broadcast with excludeSurface skips that surface
 *   - per-surface filter (only subscribed types delivered)
 *   - listener throws → error event emitted, other surfaces unaffected
 *   - concurrent broadcasts maintain per-surface ordering
 *   - re-register replaces listener (no duplicates)
 *   - unregister during broadcast: in-flight completes, future skips
 *   - invalid event type → InvalidEventTypeError synchronously
 *   - per-session isolation (QB #7): separate planes, separate surface lists
 */
import { describe, it, expect, beforeEach } from "vitest";
import { UnifiedDispatchPlane } from "../../src/channels/unified-dispatch.js";
import {
  InvalidEventTypeError,
  SurfaceRegistry,
  VALID_EVENT_TYPES,
  type UnifiedEvent,
  type UnifiedEventType,
} from "../../src/channels/fan-out.js";

describe("UnifiedDispatchPlane multi-surface fan-out (F11)", () => {
  let plane: UnifiedDispatchPlane;

  beforeEach(() => {
    plane = new UnifiedDispatchPlane();
  });

  // ── Lifecycle ────────────────────────────────────────────

  it("registerSurface returns a disposer that unregisters", () => {
    const dispose = plane.registerSurface("phone-1", "ios", () => {});
    expect(plane.getRegisteredSurfaces()).toHaveLength(1);
    dispose();
    expect(plane.getRegisteredSurfaces()).toHaveLength(0);
  });

  it("unregisterSurface returns true when removed, false when not present", () => {
    plane.registerSurface("desktop-1", "desktop", () => {});
    expect(plane.unregisterSurface("desktop-1")).toBe(true);
    expect(plane.unregisterSurface("desktop-1")).toBe(false);
    expect(plane.unregisterSurface("never-registered")).toBe(false);
  });

  it("rejects empty surface id", () => {
    expect(() => plane.registerSurface("", "ios", () => {})).toThrow(/surfaceId/);
    expect(() => plane.registerSurface("   ", "ios", () => {})).toThrow(/surfaceId/);
  });

  // ── Basic broadcast ──────────────────────────────────────

  it("broadcast reaches every registered surface", async () => {
    const desktop: UnifiedEvent[] = [];
    const phone: UnifiedEvent[] = [];
    const watch: UnifiedEvent[] = [];
    const tui: UnifiedEvent[] = [];

    plane.registerSurface("desktop-1", "desktop", (e) => desktop.push(e));
    plane.registerSurface("phone-1", "ios", (e) => phone.push(e));
    plane.registerSurface("watch-1", "watch", (e) => watch.push(e));
    plane.registerSurface("tui-1", "tui", (e) => tui.push(e));

    const ev: UnifiedEvent = {
      type: "mention",
      timestamp: Date.now(),
      sourceSurface: "slack-bridge",
      payload: { text: "@wotann build me a report" },
    };
    await plane.broadcastUnifiedEvent(ev);

    expect(desktop).toEqual([ev]);
    expect(phone).toEqual([ev]);
    expect(watch).toEqual([ev]);
    expect(tui).toEqual([ev]);
  });

  it("broadcast with excludeSurface skips only that surface", async () => {
    const desktop: UnifiedEvent[] = [];
    const phone: UnifiedEvent[] = [];
    const watch: UnifiedEvent[] = [];

    plane.registerSurface("desktop-1", "desktop", (e) => desktop.push(e));
    plane.registerSurface("phone-1", "ios", (e) => phone.push(e));
    plane.registerSurface("watch-1", "watch", (e) => watch.push(e));

    const ev: UnifiedEvent = {
      type: "approval",
      timestamp: Date.now(),
      payload: { actionId: "rm-rf" },
    };
    // Phone approved; don't echo back to phone.
    await plane.broadcastUnifiedEvent(ev, { excludeSurface: "phone-1" });

    expect(desktop).toEqual([ev]);
    expect(phone).toEqual([]);
    expect(watch).toEqual([ev]);
  });

  // ── Filters ──────────────────────────────────────────────

  it("surface with filter receives only events of subscribed types", async () => {
    const mentionsOnly: UnifiedEvent[] = [];
    const approvalsOnly: UnifiedEvent[] = [];
    const allEvents: UnifiedEvent[] = [];

    plane.registerSurface(
      "desktop-mentions",
      "desktop",
      (e) => mentionsOnly.push(e),
      new Set<UnifiedEventType>(["mention"]),
    );
    plane.registerSurface(
      "watch-approvals",
      "watch",
      (e) => approvalsOnly.push(e),
      new Set<UnifiedEventType>(["approval"]),
    );
    plane.registerSurface("tui-all", "tui", (e) => allEvents.push(e));

    await plane.broadcastUnifiedEvent({
      type: "mention",
      timestamp: 1,
      payload: { who: "@gabe" },
    });
    await plane.broadcastUnifiedEvent({
      type: "approval",
      timestamp: 2,
      payload: { id: "a1" },
    });
    await plane.broadcastUnifiedEvent({
      type: "message",
      timestamp: 3,
      payload: { text: "hi" },
    });

    expect(mentionsOnly).toHaveLength(1);
    expect(mentionsOnly[0]!.type).toBe("mention");
    expect(approvalsOnly).toHaveLength(1);
    expect(approvalsOnly[0]!.type).toBe("approval");
    expect(allEvents).toHaveLength(3);
  });

  // ── Error propagation ────────────────────────────────────

  it("listener throws → error event emitted, other surfaces still receive", async () => {
    const errors: UnifiedEvent[] = [];
    const good: UnifiedEvent[] = [];

    plane.onSurfaceError((e) => errors.push(e));

    plane.registerSurface("bad-surface", "desktop", () => {
      throw new Error("listener boom");
    });
    plane.registerSurface("good-surface", "ios", (e) => good.push(e));

    const ev: UnifiedEvent = {
      type: "mention",
      timestamp: 42,
      payload: { x: 1 },
    };
    await plane.broadcastUnifiedEvent(ev);

    // Good surface still received.
    expect(good).toEqual([ev]);
    // Error listener received an "error" UnifiedEvent with origin info.
    expect(errors).toHaveLength(1);
    expect(errors[0]!.type).toBe("error");
    expect(errors[0]!.sourceSurface).toBe("bad-surface");
    const errPayload = errors[0]!.payload as Record<string, unknown>;
    expect(errPayload["originalType"]).toBe("mention");
    expect(errPayload["message"]).toBe("listener boom");
    expect(errPayload["surfaceId"]).toBe("bad-surface");
    expect(errPayload["surfaceType"]).toBe("desktop");
  });

  it("async listener that rejects is handled without poisoning others", async () => {
    const errors: UnifiedEvent[] = [];
    const good: UnifiedEvent[] = [];
    plane.onSurfaceError((e) => errors.push(e));

    plane.registerSurface("rejecter", "watch", async () => {
      await Promise.resolve();
      throw new Error("async boom");
    });
    plane.registerSurface("good", "tui", (e) => good.push(e));

    await plane.broadcastUnifiedEvent({
      type: "cost",
      timestamp: 1,
      payload: { todayUsd: 0.12 },
    });

    expect(good).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.type).toBe("error");
    expect((errors[0]!.payload as Record<string, unknown>)["message"]).toBe("async boom");
  });

  // ── Concurrent ordering (per-surface FIFO) ───────────────

  it("concurrent broadcasts maintain per-surface ordering", async () => {
    const received: number[] = [];
    plane.registerSurface("tui", "tui", async (e) => {
      // Simulate work so the await ensures interleaving is possible.
      await new Promise((r) => setTimeout(r, 0));
      received.push((e.payload as Record<string, number>)["seq"]!);
    });

    // Kick off 10 broadcasts in rapid succession. Per-surface FIFO must keep
    // them in order.
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        plane.broadcastUnifiedEvent({
          type: "message",
          timestamp: i,
          payload: { seq: i },
        }),
      );
    }
    await Promise.all(promises);

    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("each surface gets its own FIFO — surfaces don't block each other", async () => {
    const slow: number[] = [];
    const fast: number[] = [];

    plane.registerSurface("slow", "desktop", async (e) => {
      await new Promise((r) => setTimeout(r, 15));
      slow.push((e.payload as Record<string, number>)["seq"]!);
    });
    plane.registerSurface("fast", "ios", (e) => {
      fast.push((e.payload as Record<string, number>)["seq"]!);
    });

    const start = Date.now();
    await Promise.all([
      plane.broadcastUnifiedEvent({ type: "message", timestamp: 0, payload: { seq: 0 } }),
      plane.broadcastUnifiedEvent({ type: "message", timestamp: 1, payload: { seq: 1 } }),
      plane.broadcastUnifiedEvent({ type: "message", timestamp: 2, payload: { seq: 2 } }),
    ]);
    const elapsed = Date.now() - start;

    // Both surfaces got all 3 events in order, but the 3 broadcasts to the
    // fast surface ran in parallel with the slow one (total ~45ms for slow,
    // not 3x sequential).
    expect(slow).toEqual([0, 1, 2]);
    expect(fast).toEqual([0, 1, 2]);
    // Sanity: under parallel dispatch across surfaces, elapsed should be
    // bounded near the slow surface's cumulative queue time (~45ms), not 3x.
    // Generous upper bound to avoid CI flakiness.
    expect(elapsed).toBeLessThan(500);
  });

  // ── Re-register replaces, no duplicates ──────────────────

  it("re-registering with the same surfaceId replaces the listener (no duplicates)", async () => {
    const first: UnifiedEvent[] = [];
    const second: UnifiedEvent[] = [];

    plane.registerSurface("phone", "ios", (e) => first.push(e));
    plane.registerSurface("phone", "ios", (e) => second.push(e));

    // Only one surface registered despite two register calls.
    expect(plane.getRegisteredSurfaces()).toHaveLength(1);

    await plane.broadcastUnifiedEvent({
      type: "mention",
      timestamp: 1,
      payload: {},
    });

    expect(first).toHaveLength(0); // the first listener was replaced
    expect(second).toHaveLength(1);
  });

  // ── Unregister during broadcast ──────────────────────────

  it("unregister between broadcasts: future broadcasts skip", async () => {
    const received: UnifiedEvent[] = [];
    plane.registerSurface("phone", "ios", (e) => received.push(e));

    await plane.broadcastUnifiedEvent({
      type: "message",
      timestamp: 1,
      payload: { n: 1 },
    });
    expect(received).toHaveLength(1);

    plane.unregisterSurface("phone");

    await plane.broadcastUnifiedEvent({
      type: "message",
      timestamp: 2,
      payload: { n: 2 },
    });
    expect(received).toHaveLength(1); // unchanged
  });

  it("unregister during in-flight broadcast: in-flight completes, subsequent skip", async () => {
    const received: UnifiedEvent[] = [];
    let blocker: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      blocker = resolve;
    });
    let entered: () => void = () => {};
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });

    plane.registerSurface("phone", "ios", async (e) => {
      // Signal that the listener has actually been entered (in-flight), THEN
      // wait on the blocker. This is what distinguishes "in-flight" (listener
      // started) from "queued" (not yet reached the listener).
      entered();
      await gate;
      received.push(e);
    });

    // Fire broadcast #1; it stalls inside the listener until we release the gate.
    const p1 = plane.broadcastUnifiedEvent({
      type: "message",
      timestamp: 1,
      payload: { n: 1 },
    });

    // Wait until the listener has been entered — NOW the call is truly in-flight.
    await enteredGate;

    // Unregister mid-flight. The listener is already executing; it must still
    // complete. Any broadcasts enqueued AFTER this call skip the surface.
    plane.unregisterSurface("phone");

    // Fire broadcast #2 — the surface is unregistered so this call sees an
    // empty surface list and is a no-op for that surface.
    await plane.broadcastUnifiedEvent({
      type: "message",
      timestamp: 2,
      payload: { n: 2 },
    });

    // Now release the gate, the in-flight #1 completes.
    blocker();
    await p1;

    expect(received).toHaveLength(1);
    expect((received[0]!.payload as Record<string, number>)["n"]).toBe(1);
  });

  it("unregister while delivery queued (but not yet started) skips that delivery", async () => {
    // Complementary to the in-flight test: this is the "queued but not started"
    // case. If the surface has slow listeners and many broadcasts are queued,
    // unregistering should skip the queued ones — only in-flight completes.
    const received: UnifiedEvent[] = [];
    let blocker: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      blocker = resolve;
    });

    plane.registerSurface("phone", "ios", async (e) => {
      await gate;
      received.push(e);
    });

    // Queue up 3 deliveries. First is in-flight (awaiting gate), the next two
    // are queued in the surface's FIFO chain.
    const p1 = plane.broadcastUnifiedEvent({ type: "message", timestamp: 1, payload: { n: 1 } });
    const p2 = plane.broadcastUnifiedEvent({ type: "message", timestamp: 2, payload: { n: 2 } });
    const p3 = plane.broadcastUnifiedEvent({ type: "message", timestamp: 3, payload: { n: 3 } });

    // Unregister before releasing the gate. Deliveries 2 and 3 haven't yet
    // invoked the listener — they must skip.
    plane.unregisterSurface("phone");

    blocker();
    await Promise.all([p1, p2, p3]);

    // Once the in-flight resolves, subsequent deliveries check `active` and
    // return early. Expected: only #1 ran (and even that is uncertain — it
    // depends on whether the first microtask already entered the listener).
    // In practice, since `broadcast` schedules `.then(() => deliver(...))` and
    // `unregisterSurface` flips `active=false` synchronously AFTER the first
    // broadcast but BEFORE the microtask queue flushes, delivery #1 may or
    // may not have entered. The contract is just: nothing post-in-flight.
    expect(received.length).toBeLessThanOrEqual(1);
  });

  // ── Event type taxonomy ──────────────────────────────────

  it("invalid event type throws InvalidEventTypeError synchronously", async () => {
    plane.registerSurface("phone", "ios", () => {});
    await expect(
      plane.broadcastUnifiedEvent({
        // @ts-expect-error — deliberately invalid at the caller
        type: "totally-made-up",
        timestamp: 1,
        payload: {},
      }),
    ).rejects.toBeInstanceOf(InvalidEventTypeError);
  });

  it("all declared VALID_EVENT_TYPES successfully broadcast", async () => {
    const received: UnifiedEvent[] = [];
    plane.registerSurface("tui", "tui", (e) => received.push(e));

    for (const t of VALID_EVENT_TYPES) {
      await plane.broadcastUnifiedEvent({
        type: t,
        timestamp: 1,
        payload: {},
      });
    }

    expect(received.map((e) => e.type)).toEqual([...VALID_EVENT_TYPES]);
  });

  // ── Per-instance isolation (QB #7) ───────────────────────

  it("two planes have separate surface lists (per-coordinator isolation)", async () => {
    const planeA = new UnifiedDispatchPlane();
    const planeB = new UnifiedDispatchPlane();

    const a: UnifiedEvent[] = [];
    const b: UnifiedEvent[] = [];

    planeA.registerSurface("shared-id", "ios", (e) => a.push(e));
    planeB.registerSurface("shared-id", "ios", (e) => b.push(e));

    await planeA.broadcastUnifiedEvent({
      type: "mention",
      timestamp: 1,
      payload: { where: "A" },
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0); // B must not receive A's broadcast
  });

  // ── Introspection ───────────────────────────────────────

  it("getRegisteredSurfaces returns all registrations", () => {
    plane.registerSurface("d", "desktop", () => {});
    plane.registerSurface("p", "ios", () => {}, new Set<UnifiedEventType>(["cost"]));
    const surfaces = plane.getRegisteredSurfaces();
    expect(surfaces.map((s) => s.surfaceId).sort()).toEqual(["d", "p"]);
    const phone = surfaces.find((s) => s.surfaceId === "p");
    expect(phone?.surfaceType).toBe("ios");
    expect(phone?.filter?.has("cost")).toBe(true);
  });

  it("getSurfaceRegistry returns the same registry instance across calls", () => {
    const reg = plane.getSurfaceRegistry();
    expect(reg).toBeInstanceOf(SurfaceRegistry);
    expect(plane.getSurfaceRegistry()).toBe(reg);
  });

  // ── excludeSurface edge cases ────────────────────────────

  it("excludeSurface pointing at an unregistered id is a no-op (others still fire)", async () => {
    const seen: UnifiedEvent[] = [];
    plane.registerSurface("phone", "ios", (e) => seen.push(e));

    await plane.broadcastUnifiedEvent(
      { type: "message", timestamp: 1, payload: {} },
      { excludeSurface: "ghost-surface" },
    );

    expect(seen).toHaveLength(1);
  });

  it("error listener dispose stops further error notifications", async () => {
    const errors: UnifiedEvent[] = [];
    const dispose = plane.onSurfaceError((e) => errors.push(e));

    plane.registerSurface("bad", "desktop", () => {
      throw new Error("err");
    });

    await plane.broadcastUnifiedEvent({ type: "mention", timestamp: 1, payload: {} });
    expect(errors).toHaveLength(1);

    dispose();
    await plane.broadcastUnifiedEvent({ type: "mention", timestamp: 2, payload: {} });
    expect(errors).toHaveLength(1);
  });
});
