/**
 * Phase 3 P1-F15 — Multi-agent fleet view tests.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 8 and Cursor 3
 * Agents Window competitive parity (RESEARCH_USER_NAMED_COMPETITORS.md).
 *
 * What gets exercised:
 *
 *   1. empty store — snapshot is well-formed, zero sessions
 *   2. snapshot with N sessions — counts match, names truncated
 *   3. progress calculation — maxSteps-backed + null fallbacks
 *   4. subscribe fires on session mutation
 *   5. unsubscribe detaches listener
 *   6. debouncing — 10 rapid events within window collapse to 1 emit
 *   7. RPC fleet.list — returns a FleetSnapshot over handler boundary
 *   8. RPC fleet.watch — start + poll + close lifecycle
 *   9. RPC fleet.summary — counts-only payload
 *  10. bySurface counts — device-id heuristic drives surface bucket
 *  11. byStatus counts — lifecycle transitions reflected
 *  12. handoff event reaches fleet view (F14 composition)
 *  13. listener exceptions don't poison the fleet view
 *  14. multiple subscribers each receive the same snapshot
 *  15. dispose tears everything down
 *
 * Uses an injectable scheduler (same pattern as handoff tests) so debounce
 * semantics are deterministic without sleeping real time.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ComputerSessionStore } from "../../src/session/computer-session-store.js";
import {
  FleetView,
  buildFleetSnapshot,
  computeProgressPct,
  describeEvent,
  inferSurfaceFromDeviceId,
  mostRecentStepEvent,
  nameFromTask,
  summaryFromSnapshot,
  type FleetSnapshot,
} from "../../src/session/fleet-view.js";
import { SessionHandoffManager } from "../../src/session/session-handoff.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";

// ── Deterministic scheduler (same pattern as handoff tests) ──

interface Timer {
  readonly id: number;
  readonly fireAt: number;
  readonly fn: () => void;
  fired: boolean;
}

class FakeScheduler {
  private timers: Timer[] = [];
  private nextId = 1;
  now = 0;

  setTimeout(fn: () => void, ms: number): unknown {
    const timer: Timer = {
      id: this.nextId++,
      fireAt: this.now + ms,
      fn,
      fired: false,
    };
    this.timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number;
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  advance(ms: number): void {
    this.now += ms;
    const due = this.timers.filter((t) => !t.fired && t.fireAt <= this.now);
    for (const t of due) {
      t.fired = true;
      t.fn();
    }
    this.timers = this.timers.filter((t) => !t.fired);
  }

  pending(): number {
    return this.timers.length;
  }
}

// ── Pure helper tests ───────────────────────────────────────

describe("fleet-view pure helpers", () => {
  it("inferSurfaceFromDeviceId — maps known prefixes, defaults unknown to web", () => {
    expect(inferSurfaceFromDeviceId("desktop-A")).toBe("desktop");
    expect(inferSurfaceFromDeviceId("phone-A")).toBe("ios");
    expect(inferSurfaceFromDeviceId("ios-123")).toBe("ios");
    expect(inferSurfaceFromDeviceId("watch-1")).toBe("watch");
    expect(inferSurfaceFromDeviceId("tui-A")).toBe("tui");
    expect(inferSurfaceFromDeviceId("cli-7")).toBe("tui");
    expect(inferSurfaceFromDeviceId("carplay-A")).toBe("carplay");
    expect(inferSurfaceFromDeviceId("car-1")).toBe("carplay");
    expect(inferSurfaceFromDeviceId("unknown-X")).toBe("web");
    expect(inferSurfaceFromDeviceId(null)).toBe("web");
    expect(inferSurfaceFromDeviceId("")).toBe("web");
  });

  it("nameFromTask — truncates long strings with ellipsis, preserves whole words where possible", () => {
    expect(nameFromTask("short task")).toBe("short task");
    const long = "research quantum sensors and write a 10k-word report with citations and code";
    const name = nameFromTask(long, 40);
    expect(name.length).toBeLessThanOrEqual(41); // up to 40 chars + ellipsis
    expect(name.endsWith("…")).toBe(true);
  });

  it("describeEvent — prefers summary > kind+path > action > kind > type", () => {
    expect(
      describeEvent({
        sessionId: "x",
        seq: 0,
        timestamp: 0,
        type: "step",
        payload: { kind: "write", path: "/app.tsx" },
      }),
    ).toBe("write /app.tsx");

    expect(
      describeEvent({
        sessionId: "x",
        seq: 0,
        timestamp: 0,
        type: "step",
        payload: { summary: "planning the refactor" },
      }),
    ).toBe("planning the refactor");

    expect(
      describeEvent({
        sessionId: "x",
        seq: 0,
        timestamp: 0,
        type: "step",
        payload: { action: "plan" },
      }),
    ).toBe("plan");

    // Empty payload falls back to event type
    expect(
      describeEvent({
        sessionId: "x",
        seq: 0,
        timestamp: 0,
        type: "cursor",
        payload: {},
      }),
    ).toBe("cursor");
  });
});

// ── FleetView class tests ──────────────────────────────────

describe("FleetView — snapshot() and helpers", () => {
  let store: ComputerSessionStore;
  let fleet: FleetView;
  let scheduler: FakeScheduler;

  beforeEach(() => {
    store = new ComputerSessionStore();
    scheduler = new FakeScheduler();
    fleet = new FleetView({
      store,
      scheduler: {
        setTimeout: scheduler.setTimeout.bind(scheduler),
        clearTimeout: scheduler.clearTimeout.bind(scheduler),
      },
      now: () => scheduler.now,
    });
  });

  // 1. empty store — well-formed snapshot
  it("empty store produces a well-formed snapshot with zero sessions", () => {
    const snap = fleet.snapshot();
    expect(snap.sessions).toHaveLength(0);
    expect(snap.activeCount).toBe(0);
    // All status/surface keys present and zero-filled
    expect(snap.byStatus.pending).toBe(0);
    expect(snap.byStatus.running).toBe(0);
    expect(snap.byStatus.done).toBe(0);
    expect(snap.bySurface.desktop).toBe(0);
    expect(snap.bySurface.ios).toBe(0);
  });

  // 2. N sessions — counts match, rows generated
  it("snapshot with multiple sessions carries a row per session", () => {
    const s1 = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "research sensors" },
    });
    store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "refactor auth module with TDD" },
    });
    store.claim(s1.id, "desktop-B");

    const snap = fleet.snapshot();
    expect(snap.sessions).toHaveLength(2);
    expect(snap.activeCount).toBe(1); // s1 is claimed; the other is pending (not active)
    // Names carry task text
    expect(snap.sessions.some((r) => r.name.includes("research sensors"))).toBe(true);
    expect(snap.sessions.some((r) => r.name.includes("refactor auth"))).toBe(true);
  });

  // 3. progress calculation — maxSteps-backed, fallbacks
  it("progressPct — done=100, failed=null, with maxSteps derives %", () => {
    const done = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "t1", maxSteps: 10 },
    });
    store.claim(done.id, "desktop-A");
    store.close({ sessionId: done.id, deviceId: "desktop-A", outcome: "done" });
    expect(computeProgressPct(store.get(done.id))).toBe(100);

    const failed = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "t2", maxSteps: 10 },
    });
    store.claim(failed.id, "desktop-A");
    store.close({
      sessionId: failed.id,
      deviceId: "desktop-A",
      outcome: "failed",
      error: "boom",
    });
    expect(computeProgressPct(store.get(failed.id))).toBeNull();

    // Running with maxSteps
    const running = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "t3", maxSteps: 10 },
    });
    store.claim(running.id, "desktop-A");
    for (let i = 0; i < 5; i++) {
      store.step({
        sessionId: running.id,
        deviceId: "desktop-A",
        step: { kind: "plan" },
      });
    }
    const pct = computeProgressPct(store.get(running.id));
    expect(pct).toBeGreaterThanOrEqual(40);
    expect(pct).toBeLessThanOrEqual(60);

    // Without maxSteps — honest null
    const unbounded = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "t4" },
    });
    store.claim(unbounded.id, "desktop-A");
    store.step({
      sessionId: unbounded.id,
      deviceId: "desktop-A",
      step: { kind: "plan" },
    });
    expect(computeProgressPct(store.get(unbounded.id))).toBeNull();

    // Caps at 99 while still running (never 100 while in flight)
    const overflow = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "t5", maxSteps: 2 },
    });
    store.claim(overflow.id, "desktop-A");
    for (let i = 0; i < 5; i++) {
      store.step({
        sessionId: overflow.id,
        deviceId: "desktop-A",
        step: { kind: "plan" },
      });
    }
    expect(computeProgressPct(store.get(overflow.id))).toBe(99);
  });

  // 4. currentAction derivation + lastStepAt
  it("currentAction + lastStepAt derive from the most recent step-class event", () => {
    const s = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "build it", maxSteps: 5 },
    });
    store.claim(s.id, "desktop-A");
    store.step({
      sessionId: s.id,
      deviceId: "desktop-A",
      step: { kind: "write", path: "/app.tsx" },
    });

    const updated = store.get(s.id);
    const evt = mostRecentStepEvent(updated);
    expect(evt?.type).toBe("step");
    expect(describeEvent(evt!)).toBe("write /app.tsx");

    const snap = fleet.snapshot();
    const row = snap.sessions.find((r) => r.id === s.id);
    expect(row?.currentAction).toBe("write /app.tsx");
    expect(row?.lastStepAt).toBe(evt!.timestamp);
  });

  // 10. bySurface counts match inferred surfaces
  it("bySurface counts aggregate per surface from the active device id", () => {
    store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "d1" } });
    store.create({ creatorDeviceId: "desktop-B", taskSpec: { task: "d2" } });
    store.create({ creatorDeviceId: "phone-A", taskSpec: { task: "p1" } });
    store.create({ creatorDeviceId: "watch-1", taskSpec: { task: "w1" } });
    store.create({ creatorDeviceId: "tui-A", taskSpec: { task: "t1" } });

    const snap = fleet.snapshot();
    expect(snap.bySurface.desktop).toBe(2);
    expect(snap.bySurface.ios).toBe(1);
    expect(snap.bySurface.watch).toBe(1);
    expect(snap.bySurface.tui).toBe(1);
    expect(snap.bySurface.carplay).toBe(0);
    expect(snap.bySurface.web).toBe(0);
  });

  // 11. byStatus counts reflect lifecycle transitions
  it("byStatus counts reflect every lifecycle state", () => {
    // pending (unclaimed)
    store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "pending-1" } });

    // claimed
    const claimed = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "claimed-1" },
    });
    store.claim(claimed.id, "desktop-A");

    // running
    const running = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "running-1" },
    });
    store.claim(running.id, "desktop-A");
    store.step({ sessionId: running.id, deviceId: "desktop-A", step: { kind: "plan" } });

    // awaiting_approval
    const approval = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "approval-1" },
    });
    store.claim(approval.id, "desktop-A");
    store.step({ sessionId: approval.id, deviceId: "desktop-A", step: { kind: "plan" } });
    store.requestApproval({
      sessionId: approval.id,
      deviceId: "desktop-A",
      summary: "rm -rf",
      riskLevel: "high",
    });

    // done
    const done = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "done-1" },
    });
    store.claim(done.id, "desktop-A");
    store.close({ sessionId: done.id, deviceId: "desktop-A", outcome: "done" });

    // failed
    const failed = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "failed-1" },
    });
    store.claim(failed.id, "desktop-A");
    store.close({
      sessionId: failed.id,
      deviceId: "desktop-A",
      outcome: "failed",
      error: "boom",
    });

    const snap = fleet.snapshot();
    expect(snap.byStatus.pending).toBe(1);
    expect(snap.byStatus.claimed).toBe(1);
    expect(snap.byStatus.running).toBe(1);
    expect(snap.byStatus.awaiting_approval).toBe(1);
    expect(snap.byStatus.done).toBe(1);
    expect(snap.byStatus.failed).toBe(1);
    expect(snap.activeCount).toBe(3); // claimed + running + awaiting_approval
  });
});

describe("FleetView — subscribe / debounce / dispose", () => {
  let store: ComputerSessionStore;
  let fleet: FleetView;
  let scheduler: FakeScheduler;

  beforeEach(() => {
    store = new ComputerSessionStore();
    scheduler = new FakeScheduler();
    fleet = new FleetView({
      store,
      scheduler: {
        setTimeout: scheduler.setTimeout.bind(scheduler),
        clearTimeout: scheduler.clearTimeout.bind(scheduler),
      },
      now: () => scheduler.now,
      config: { debounceMs: 100 },
    });
  });

  // 4. subscribe fires on session mutation
  it("subscribe fires on any session state change", () => {
    const snaps: FleetSnapshot[] = [];
    fleet.subscribe((snap) => {
      snaps.push(snap);
    });

    // Before any event, no emit
    expect(snaps).toHaveLength(0);

    // Create triggers an event. Debounce is 100ms — advance time to flush.
    store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "one" } });
    expect(snaps).toHaveLength(0); // still inside debounce window
    scheduler.advance(100);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.sessions).toHaveLength(1);
  });

  // 5. unsubscribe detaches
  it("unsubscribe removes the listener", () => {
    const snaps: FleetSnapshot[] = [];
    const unsubscribe = fleet.subscribe((snap) => {
      snaps.push(snap);
    });
    expect(fleet.listenerCount()).toBe(1);

    unsubscribe();
    expect(fleet.listenerCount()).toBe(0);

    // New activity — no emission
    store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "post-unsub" } });
    scheduler.advance(200);
    expect(snaps).toHaveLength(0);
  });

  // 6. debounce — 10 rapid changes in 100ms collapse to 1 emit
  it("debounces rapid changes into a single emit", () => {
    const snaps: FleetSnapshot[] = [];
    fleet.subscribe((snap) => {
      snaps.push(snap);
    });

    const s = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "rapid", maxSteps: 100 },
    });
    store.claim(s.id, "desktop-A");

    // Fire 10 step events within the debounce window. No time advances in
    // between — everything lands within the same 100ms bucket.
    for (let i = 0; i < 10; i++) {
      store.step({ sessionId: s.id, deviceId: "desktop-A", step: { seq: i } });
    }

    // Still inside window — no emit.
    expect(snaps).toHaveLength(0);

    // Advance past the debounce window — single emit.
    scheduler.advance(100);
    expect(snaps).toHaveLength(1);

    // The single snapshot reflects the cumulative state.
    const row = snaps[0]?.sessions.find((r) => r.id === s.id);
    expect(row?.status).toBe("running");
  });

  // 12. handoff event reaches fleet view
  it("F14 handoff events propagate through FleetView", () => {
    const mgr = new SessionHandoffManager({
      store,
      scheduler: {
        setTimeout: scheduler.setTimeout.bind(scheduler),
        clearTimeout: scheduler.clearTimeout.bind(scheduler),
      },
    });
    const snaps: FleetSnapshot[] = [];
    fleet.subscribe((snap) => {
      snaps.push(snap);
    });

    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "handoff demo" },
    });
    store.claim(s.id, "desktop-A");

    // Flush creation + claim emits so subsequent assertions isolate the
    // handoff-driven emit.
    scheduler.advance(100);
    snaps.length = 0;

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    mgr.accept({
      sessionId: s.id,
      handoffId: handoff.id,
      deviceId: "desktop-B",
    });

    scheduler.advance(100);
    expect(snaps.length).toBeGreaterThan(0);
    const last = snaps[snaps.length - 1]!;
    const row = last.sessions.find((r) => r.id === s.id);
    expect(row?.claimedBy).toBe("desktop-B");
    expect(row?.surface).toBe("desktop");
  });

  // 13. listener exceptions don't poison the view
  it("a listener that throws does not break peer listeners", () => {
    const good: FleetSnapshot[] = [];
    fleet.subscribe(() => {
      throw new Error("boom");
    });
    fleet.subscribe((snap) => {
      good.push(snap);
    });

    store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "x" } });
    scheduler.advance(100);

    // Peer still received the snapshot.
    expect(good).toHaveLength(1);
    // Registry still has both listeners (swallowing errors does not drop them).
    expect(fleet.listenerCount()).toBe(2);
  });

  // 14. multiple subscribers each receive the same snapshot
  it("two subscribers each receive the same snapshot on emit", () => {
    const a: FleetSnapshot[] = [];
    const b: FleetSnapshot[] = [];
    fleet.subscribe((snap) => a.push(snap));
    fleet.subscribe((snap) => b.push(snap));

    store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "dup" } });
    scheduler.advance(100);

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // Same snapshot instance — FleetView builds once per flush and fans
    // out the same reference.
    expect(a[0]).toBe(b[0]);
  });

  // 15. dispose tears everything down
  it("dispose tears down subscribers and cancels pending emits", () => {
    const snaps: FleetSnapshot[] = [];
    fleet.subscribe((snap) => snaps.push(snap));

    store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "pre-dispose" } });

    fleet.dispose();
    // New subscribes after dispose should throw
    expect(() => fleet.subscribe(() => undefined)).toThrow(/disposed/i);

    // Advancing time should not flush anything
    scheduler.advance(500);
    expect(snaps).toHaveLength(0);

    // Idempotent: disposing again is a no-op.
    expect(() => fleet.dispose()).not.toThrow();
  });

  // Extra: buildFleetSnapshot + summaryFromSnapshot reuse pure helpers
  it("buildFleetSnapshot + summaryFromSnapshot are composable pure functions", () => {
    const s1 = store.create({
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "a" },
    });
    const s2 = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "b" },
    });
    store.claim(s1.id, "desktop-B");
    store.claim(s2.id, "phone-A");

    const snap = buildFleetSnapshot(store.list(), 1234);
    expect(snap.updatedAt).toBe(1234);
    expect(snap.sessions).toHaveLength(2);

    const summary = summaryFromSnapshot(snap);
    expect(summary.total).toBe(2);
    expect(summary.bySurface.desktop).toBe(1);
    expect(summary.bySurface.ios).toBe(1);
  });
});

// ── Store-level query helpers (added for F15) ──────────────

describe("ComputerSessionStore — listByActiveDevice + countByStatus", () => {
  it("listByActiveDevice filters by predicate over claimant-or-creator", () => {
    const store = new ComputerSessionStore();
    const s1 = store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "a" } });
    store.create({ creatorDeviceId: "phone-A", taskSpec: { task: "b" } });
    const s3 = store.create({ creatorDeviceId: "phone-B", taskSpec: { task: "c" } });
    store.claim(s1.id, "desktop-A");
    store.claim(s3.id, "desktop-B"); // claimant overrides creator

    const desktopRows = store.listByActiveDevice((d) => d.startsWith("desktop"));
    expect(desktopRows).toHaveLength(2);
    expect(desktopRows.some((r) => r.id === s1.id)).toBe(true);
    expect(desktopRows.some((r) => r.id === s3.id)).toBe(true);

    const phoneRows = store.listByActiveDevice((d) => d.startsWith("phone"));
    expect(phoneRows).toHaveLength(1);
  });

  it("countByStatus zero-fills every status bucket", () => {
    const store = new ComputerSessionStore();
    const counts = store.countByStatus();
    expect(counts.pending).toBe(0);
    expect(counts.claimed).toBe(0);
    expect(counts.running).toBe(0);
    expect(counts.awaiting_approval).toBe(0);
    expect(counts.handed_off).toBe(0);
    expect(counts.done).toBe(0);
    expect(counts.failed).toBe(0);

    const s = store.create({ creatorDeviceId: "desktop-A", taskSpec: { task: "x" } });
    store.claim(s.id, "desktop-A");
    const after = store.countByStatus();
    expect(after.claimed).toBe(1);
    expect(after.pending).toBe(0);
  });
});

// ── RPC-level tests ───────────────────────────────────────

describe("fleet.list / fleet.summary / fleet.watch RPC (F15)", () => {
  let handler: KairosRPCHandler;
  let nextId = 1;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
  });

  async function call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<RPCResponse> {
    const raw = JSON.stringify({ jsonrpc: "2.0", method, params, id: nextId++ });
    const res = await handler.handleMessage(raw);
    return res as RPCResponse;
  }

  // 7. RPC fleet.list
  it("fleet.list returns a FleetSnapshot across the RPC boundary", async () => {
    await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "do it" },
    });
    const res = await call("fleet.list");
    const snap = res.result as FleetSnapshot;
    expect(snap).toBeDefined();
    expect(Array.isArray(snap.sessions)).toBe(true);
    expect(snap.sessions).toHaveLength(1);
    expect(snap.byStatus.pending).toBe(1);
    expect(snap.bySurface.desktop).toBe(1);
  });

  // 9. RPC fleet.summary
  it("fleet.summary returns counts-only payload", async () => {
    await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "a" },
    });
    await call("computer.session.create", {
      creatorDeviceId: "phone-A",
      taskSpec: { task: "b" },
    });

    const res = await call("fleet.summary");
    const sum = res.result as {
      total: number;
      byStatus: Record<string, number>;
      bySurface: Record<string, number>;
    };
    expect(sum.total).toBe(2);
    expect(sum.byStatus.pending).toBe(2);
    expect(sum.bySurface.desktop).toBe(1);
    expect(sum.bySurface.ios).toBe(1);
    // Summary payload has no sessions array by design.
    expect((sum as { sessions?: unknown[] }).sessions).toBeUndefined();
  });

  // 8. RPC fleet.watch — subscribe + poll + close lifecycle
  it("fleet.watch start+poll+close lifecycle works end-to-end", async () => {
    // Start subscription; initial snapshot seeded (even if empty).
    const start = await call("fleet.watch", { subscribe: true });
    const { subscriptionId, snapshots } = start.result as {
      subscriptionId: string;
      snapshots: FleetSnapshot[];
    };
    expect(subscriptionId).toMatch(/^fs-/);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.sessions).toHaveLength(0);

    // Create a session — poll should drain the snapshot(s) emitted since.
    await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "watched" },
    });
    // Debounce in default FleetView is 100ms real — wait past it.
    await new Promise((r) => setTimeout(r, 130));

    const poll = await call("fleet.watch", { subscriptionId });
    const { snapshots: pollSnaps } = poll.result as { snapshots: FleetSnapshot[] };
    expect(pollSnaps.length).toBeGreaterThan(0);
    const last = pollSnaps[pollSnaps.length - 1]!;
    expect(last.sessions).toHaveLength(1);

    // Second poll drains — should now be empty.
    const drained = await call("fleet.watch", { subscriptionId });
    expect((drained.result as { snapshots: FleetSnapshot[] }).snapshots).toHaveLength(0);

    // Close releases the buffer.
    const closed = await call("fleet.watch", { subscriptionId, close: true });
    expect((closed.result as { closed: boolean }).closed).toBe(true);

    // Subsequent poll on the closed id is an error.
    const err = await call("fleet.watch", { subscriptionId });
    expect(err.error).toBeDefined();
    expect(err.error?.message).toMatch(/not found/i);
  });

  // Misuse path: fleet.watch without subscribe and without id is a clear error.
  it("fleet.watch without subscribe=true or subscriptionId raises an error", async () => {
    const res = await call("fleet.watch");
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/subscribe=true|subscriptionId/i);
  });
});
