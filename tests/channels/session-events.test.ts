/**
 * Phase 3 P1-F1 — UnifiedDispatchPlane session-event bridge tests.
 *
 * Verifies that ComputerSessionStore events fan out through the dispatch
 * plane to every registered listener (phone, desktop, watch, TUI). Order is
 * preserved and listener errors do not poison the bus (QB #6 — honest failures,
 * QB #11 — sibling-site reuse).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { UnifiedDispatchPlane } from "../../src/channels/unified-dispatch.js";
import {
  ComputerSessionStore,
  type SessionEvent,
} from "../../src/session/computer-session-store.js";

describe("UnifiedDispatchPlane <-> ComputerSessionStore bridge", () => {
  let plane: UnifiedDispatchPlane;
  let store: ComputerSessionStore;

  beforeEach(() => {
    plane = new UnifiedDispatchPlane();
    store = new ComputerSessionStore();
  });

  it("routes session events to a single listener after attach", () => {
    plane.attachComputerSessionStore(store);
    const received: SessionEvent[] = [];
    plane.onComputerSessionEvent((e) => received.push(e));

    const s = store.create({
      creatorDeviceId: "phone",
      taskSpec: { task: "research" },
    });
    store.claim(s.id, "desktop");
    store.step({
      sessionId: s.id,
      deviceId: "desktop",
      step: { action: "browse" },
    });

    expect(received.length).toBe(3);
    expect(received.map((e) => e.type)).toEqual(["created", "claimed", "step"]);
  });

  it("fans out to multiple listeners simultaneously", () => {
    plane.attachComputerSessionStore(store);
    const a: SessionEvent[] = [];
    const b: SessionEvent[] = [];
    const c: SessionEvent[] = [];
    plane.onComputerSessionEvent((e) => a.push(e));
    plane.onComputerSessionEvent((e) => b.push(e));
    plane.onComputerSessionEvent((e) => c.push(e));

    const s = store.create({
      creatorDeviceId: "phone",
      taskSpec: { task: "t" },
    });
    store.claim(s.id, "desktop");

    expect(a.length).toBe(2);
    expect(b.length).toBe(2);
    expect(c.length).toBe(2);
    // Event ordering is preserved per listener.
    expect(a.map((e) => e.seq)).toEqual([0, 1]);
    expect(b.map((e) => e.seq)).toEqual([0, 1]);
    expect(c.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("listener disposer stops further events without affecting others", () => {
    plane.attachComputerSessionStore(store);
    const a: SessionEvent[] = [];
    const b: SessionEvent[] = [];
    const disposeA = plane.onComputerSessionEvent((e) => a.push(e));
    plane.onComputerSessionEvent((e) => b.push(e));

    const s = store.create({ creatorDeviceId: "p", taskSpec: { task: "t" } });
    store.claim(s.id, "d");

    disposeA();

    store.step({ sessionId: s.id, deviceId: "d", step: { action: "x" } });

    expect(a.length).toBe(2);
    expect(b.length).toBe(3);
  });

  it("detach removes all events from flowing through (zero-impact teardown)", () => {
    plane.attachComputerSessionStore(store);
    const a: SessionEvent[] = [];
    plane.onComputerSessionEvent((e) => a.push(e));

    const s = store.create({ creatorDeviceId: "p", taskSpec: { task: "t" } });
    expect(a.length).toBe(1);

    plane.attachComputerSessionStore(null);
    store.claim(s.id, "d");

    // After detach, listener must NOT receive further events from the store.
    expect(a.length).toBe(1);
  });

  it("swapping stores disconnects previous and wires new", () => {
    const storeA = new ComputerSessionStore();
    const storeB = new ComputerSessionStore();
    plane.attachComputerSessionStore(storeA);
    const received: SessionEvent[] = [];
    plane.onComputerSessionEvent((e) => received.push(e));

    storeA.create({ creatorDeviceId: "p", taskSpec: { task: "a" } });
    expect(received.length).toBe(1);
    expect(received[0]!.type).toBe("created");

    // Switch to storeB. StoreA events must no longer fire; storeB events now do.
    plane.attachComputerSessionStore(storeB);
    storeA.create({ creatorDeviceId: "p", taskSpec: { task: "a2" } });
    expect(received.length).toBe(1); // unchanged

    storeB.create({ creatorDeviceId: "p", taskSpec: { task: "b" } });
    expect(received.length).toBe(2);
  });

  it("listener exceptions do not poison the bus (QB #6)", () => {
    plane.attachComputerSessionStore(store);
    const good: SessionEvent[] = [];
    plane.onComputerSessionEvent(() => {
      throw new Error("listener boom");
    });
    plane.onComputerSessionEvent((e) => good.push(e));

    // Would throw and abort if the bus wasn't insulated. Instead the good
    // listener still sees events.
    store.create({ creatorDeviceId: "p", taskSpec: { task: "t" } });

    expect(good.length).toBe(1);
  });

  it("supports approval + close lifecycle events end-to-end", () => {
    plane.attachComputerSessionStore(store);
    const seen: SessionEvent[] = [];
    plane.onComputerSessionEvent((e) => seen.push(e));

    const s = store.create({
      creatorDeviceId: "phone",
      taskSpec: { task: "delete files" },
    });
    store.claim(s.id, "desktop");
    store.step({
      sessionId: s.id,
      deviceId: "desktop",
      step: { action: "scan" },
    });
    store.requestApproval({
      sessionId: s.id,
      deviceId: "desktop",
      summary: "delete 100 files",
      riskLevel: "high",
    });
    store.approve({ sessionId: s.id, deviceId: "phone", decision: "allow" });
    store.close({
      sessionId: s.id,
      deviceId: "desktop",
      outcome: "done",
      result: { deletedCount: 100 },
    });

    const types = seen.map((e) => e.type);
    expect(types).toEqual([
      "created",
      "claimed",
      "step",
      "approval_request",
      "approval_decision",
      "done",
    ]);
    // seqs must be monotonic across all event types.
    const seqs = seen.map((e) => e.seq);
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("getComputerSessionStore returns the attached store (or null)", () => {
    expect(plane.getComputerSessionStore()).toBeNull();
    plane.attachComputerSessionStore(store);
    expect(plane.getComputerSessionStore()).toBe(store);
    plane.attachComputerSessionStore(null);
    expect(plane.getComputerSessionStore()).toBeNull();
  });
});
