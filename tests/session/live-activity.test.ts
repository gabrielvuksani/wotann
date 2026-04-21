/**
 * Phase 3 P1-F3 — Live Activity Manager tests (iOS Dynamic Island primitive).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S3 and MASTER_PLAN_V8
 * §5 P1-F3 (2 days), F1 already ships `step` as a valid `SessionEvent` type
 * AND a valid `UnifiedEventType`. F3 adds a rate-limited marshaling layer
 * (LiveActivityManager) that shapes step updates into the compact / expanded
 * Live Activity payload and enforces the 1-per-second-per-session APNs budget.
 *
 * Tests exercise:
 *   Manager-level (LiveActivityManager + FakeClock — QB #12 deterministic):
 *     1.  step() with valid input emits + records `pending()`
 *     2.  5 rapid steps inside 500ms → 1 emit (first), 4 coalesced (latest in stash)
 *     3.  5 steps each >1s apart → 5 emits (per-session rate limit resets)
 *     4.  title > 120 chars → ErrorTitleTooLong
 *     5.  title empty → ErrorInvalidTitle
 *     6.  progress > 1 → ErrorInvalidProgress
 *     7.  progress < 0 → ErrorInvalidProgress
 *     8.  progress NaN → ErrorInvalidProgress
 *     9.  unknown sessionId (store provided) → ErrorSessionNotFound
 *    10.  pendingAll returns latest per-session (isolation test)
 *    11.  compact vs expanded serialization shapes differ correctly
 *    12.  subscribe fires per dispatched step, disposer stops fan-out
 *    13.  per-session isolation (two sessions, interleaved updates)
 *    14.  icon passthrough (compact + expanded preserve it)
 *    15.  expandedDetail optional (omit → expanded.expandedDetail undefined)
 *    16.  flush drains stashed burst immediately (bypasses rate-limit)
 *    17.  flushAll drains every stashed burst across sessions
 *    18.  drop(sessionId) clears per-session state (done → no more pending)
 *    19.  invalid icon (too long) → ErrorInvalidIcon
 *    20.  invalid expandedDetail (too long) → ErrorInvalidExpandedDetail
 *    21.  broadcast hook fires per emit (not per coalesced record)
 *    22.  subscriber error does not block other subscribers
 *
 *   RPC-level (via KairosRPCHandler):
 *    23.  liveActivity.step full lifecycle (create → step → pending sees it)
 *    24.  liveActivity.step with invalid progress surfaces RPC error
 *    25.  liveActivity.pending returns all when sessionId omitted
 *    26.  liveActivity.subscribe polling returns buffered events
 *
 * Uses a FakeClock (not a FakeScheduler — no timers in the LiveActivityManager
 * hot path) to control wall-clock deterministically per QB #12.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LiveActivityManager,
  ErrorTitleTooLong,
  ErrorInvalidTitle,
  ErrorInvalidProgress,
  ErrorInvalidIcon,
  ErrorInvalidExpandedDetail,
  ErrorSessionNotFound as LiveActivitySessionNotFound,
  type ExpandedStep,
  type StepUpdate,
} from "../../src/session/live-activity.js";
import { ComputerSessionStore } from "../../src/session/computer-session-store.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";
import type { UnifiedEvent } from "../../src/channels/fan-out.js";

// ── Deterministic fake clock ──────────────────────────────

class FakeClock {
  private t: number;
  constructor(initial = 1_000_000) {
    this.t = initial;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

// ── Helpers ───────────────────────────────────────────────

function createSession(store: ComputerSessionStore, deviceId = "desktop-A"): string {
  const session = store.create({
    creatorDeviceId: deviceId,
    taskSpec: { task: "live activity test" },
  });
  return session.id;
}

function makeStep(overrides: Partial<StepUpdate> & { sessionId: string }): StepUpdate {
  return {
    title: "Running tests",
    progress: 0.5,
    ...overrides,
  };
}

// ── Manager-level tests ───────────────────────────────────

describe("LiveActivityManager — F3 rate-limit + validation", () => {
  let store: ComputerSessionStore;
  let clock: FakeClock;
  let manager: LiveActivityManager;
  let broadcasts: UnifiedEvent[];
  let sessionId: string;

  beforeEach(() => {
    store = new ComputerSessionStore();
    clock = new FakeClock();
    broadcasts = [];
    manager = new LiveActivityManager({
      store,
      now: clock.now.bind(clock),
      broadcast: (ev) => {
        broadcasts.push(ev);
      },
    });
    sessionId = createSession(store);
  });

  // 1. happy path: step emits + pending records
  it("step with valid input emits and records pending", () => {
    const outcome = manager.step(
      makeStep({ sessionId, title: "Searching Google", progress: 0.2 }),
    );
    expect(outcome).toBe("emitted");
    const pending = manager.pending(sessionId);
    expect(pending).not.toBeNull();
    expect(pending?.title).toBe("Searching Google");
    expect(pending?.progress).toBe(0.2);
    expect(pending?.firstSeenAt).toBe(clock.now());
    expect(pending?.lastUpdatedAt).toBe(clock.now());
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe("step");
  });

  // 2. 5 rapid steps inside 500ms → 1 emit (latest stashed)
  it("coalesces 5 rapid steps inside the rate-limit window into 1 emit + 1 stash", () => {
    // First step at t=1_000_000 — emits immediately.
    manager.step(makeStep({ sessionId, title: "Step 1", progress: 0.1 }));
    // Four more within the 1000ms window — all coalesce.
    for (let i = 2; i <= 5; i++) {
      clock.advance(100);
      const outcome = manager.step(
        makeStep({
          sessionId,
          title: `Step ${i}`,
          progress: i / 10,
        }),
      );
      expect(outcome).toBe("coalesced");
    }
    // Only 1 broadcast.
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe("step");

    // pending() reflects the FIRST emit (what's on-wire).
    const pending = manager.pending(sessionId);
    expect(pending?.title).toBe("Step 1");
    expect(pending?.progress).toBe(0.1);

    // pendingStashed() reflects the latest-wins of the bursts.
    const stashed = manager.pendingStashed(sessionId);
    expect(stashed?.title).toBe("Step 5");
    expect(stashed?.progress).toBe(0.5);
  });

  // 3. 5 steps each >1s apart → 5 emits (rate limit resets per window)
  it("5 steps with > minGap gap produce 5 emits", () => {
    for (let i = 1; i <= 5; i++) {
      const outcome = manager.step(
        makeStep({
          sessionId,
          title: `Step ${i}`,
          progress: i / 10,
        }),
      );
      expect(outcome).toBe("emitted");
      clock.advance(1100); // > minGapMs default 1000
    }
    expect(broadcasts).toHaveLength(5);
    expect(manager.pending(sessionId)?.title).toBe("Step 5");
  });

  // 4. title too long → ErrorTitleTooLong
  it("title > 120 chars → ErrorTitleTooLong", () => {
    const longTitle = "a".repeat(121);
    expect(() => manager.step(makeStep({ sessionId, title: longTitle }))).toThrow(
      ErrorTitleTooLong,
    );
  });

  // 5. empty title → ErrorInvalidTitle
  it("empty title → ErrorInvalidTitle", () => {
    expect(() => manager.step(makeStep({ sessionId, title: "" }))).toThrow(ErrorInvalidTitle);
    expect(() => manager.step(makeStep({ sessionId, title: "   " }))).toThrow(
      ErrorInvalidTitle,
    );
  });

  // 6. progress > 1 → ErrorInvalidProgress
  it("progress > 1 → ErrorInvalidProgress", () => {
    expect(() => manager.step(makeStep({ sessionId, progress: 1.5 }))).toThrow(
      ErrorInvalidProgress,
    );
  });

  // 7. progress < 0 → ErrorInvalidProgress
  it("progress < 0 → ErrorInvalidProgress", () => {
    expect(() => manager.step(makeStep({ sessionId, progress: -0.1 }))).toThrow(
      ErrorInvalidProgress,
    );
  });

  // 8. progress NaN → ErrorInvalidProgress
  it("progress NaN → ErrorInvalidProgress", () => {
    expect(() => manager.step(makeStep({ sessionId, progress: Number.NaN }))).toThrow(
      ErrorInvalidProgress,
    );
  });

  // 9. unknown sessionId (store provided) → ErrorSessionNotFound
  it("unknown sessionId with store configured → ErrorSessionNotFound", () => {
    expect(() => manager.step(makeStep({ sessionId: "cs-nope" }))).toThrow(
      LiveActivitySessionNotFound,
    );
  });

  // 10. pendingAll returns latest per session
  it("pendingAll returns the current dispatched step per session", () => {
    const s2 = createSession(store, "desktop-B");
    manager.step(makeStep({ sessionId, title: "A1", progress: 0.1 }));
    manager.step(makeStep({ sessionId: s2, title: "B1", progress: 0.3 }));
    const all = manager.pendingAll();
    expect(all).toHaveLength(2);
    const titles = all.map((s) => s.title).sort();
    expect(titles).toEqual(["A1", "B1"]);
  });

  // 11. compact vs expanded serialization shapes
  it("toCompact strips expandedDetail + timestamps; toExpanded preserves all", () => {
    manager.step(
      makeStep({
        sessionId,
        title: "Hello",
        progress: 0.5,
        icon: "terminal.fill",
        expandedDetail: "Running pytest suite...",
      }),
    );
    const pending = manager.pending(sessionId);
    expect(pending).not.toBeNull();
    if (!pending) return;

    const compact = LiveActivityManager.toCompact(pending);
    expect(compact).toEqual({
      sessionId,
      title: "Hello",
      progress: 0.5,
      icon: "terminal.fill",
    });
    // Compact never exposes expandedDetail / timestamps.
    expect(Object.prototype.hasOwnProperty.call(compact, "expandedDetail")).toBe(false);

    const expanded = LiveActivityManager.toExpanded(pending);
    expect(expanded.title).toBe("Hello");
    expect(expanded.expandedDetail).toBe("Running pytest suite...");
    expect(expanded.firstSeenAt).toBe(clock.now());
    expect(expanded.lastUpdatedAt).toBe(clock.now());
    expect(expanded.icon).toBe("terminal.fill");
  });

  // 12. subscribe lifecycle
  it("subscribe fires per dispatched step, disposer stops fan-out", () => {
    const received: ExpandedStep[] = [];
    const dispose = manager.subscribe((step) => {
      received.push(step);
    });
    manager.step(makeStep({ sessionId, title: "a", progress: 0.1 }));
    clock.advance(1100);
    manager.step(makeStep({ sessionId, title: "b", progress: 0.2 }));
    expect(received.map((s) => s.title)).toEqual(["a", "b"]);

    dispose();
    clock.advance(1100);
    manager.step(makeStep({ sessionId, title: "c", progress: 0.3 }));
    // Receiver stopped hearing after disposer.
    expect(received.map((s) => s.title)).toEqual(["a", "b"]);
  });

  // 13. per-session isolation
  it("per-session rate limit buffers are isolated", () => {
    const s2 = createSession(store, "desktop-B");
    // First step on each → both emit.
    manager.step(makeStep({ sessionId, title: "A1", progress: 0.1 }));
    manager.step(makeStep({ sessionId: s2, title: "B1", progress: 0.1 }));
    expect(broadcasts).toHaveLength(2);

    // Second step on each within the window → both coalesce.
    clock.advance(100);
    manager.step(makeStep({ sessionId, title: "A2", progress: 0.2 }));
    manager.step(makeStep({ sessionId: s2, title: "B2", progress: 0.2 }));
    expect(broadcasts).toHaveLength(2);

    // pending still reflects FIRST emit per session.
    expect(manager.pending(sessionId)?.title).toBe("A1");
    expect(manager.pending(s2)?.title).toBe("B1");
    // stashed reflects the coalesced latest per session.
    expect(manager.pendingStashed(sessionId)?.title).toBe("A2");
    expect(manager.pendingStashed(s2)?.title).toBe("B2");
  });

  // 14. icon passthrough
  it("icon passes through to compact + expanded + broadcast payload", () => {
    manager.step(
      makeStep({ sessionId, title: "Compiling", progress: 0.3, icon: "hammer.fill" }),
    );
    const pending = manager.pending(sessionId);
    expect(pending?.icon).toBe("hammer.fill");
    const payload = broadcasts[0]?.payload as {
      compact: { icon: string };
      expanded: { icon: string };
    };
    expect(payload.compact.icon).toBe("hammer.fill");
    expect(payload.expanded.icon).toBe("hammer.fill");
  });

  // 15. expandedDetail optional
  it("expandedDetail omitted → pending.expandedDetail is undefined", () => {
    manager.step(makeStep({ sessionId, title: "Starting", progress: 0.05 }));
    const pending = manager.pending(sessionId);
    expect(pending?.expandedDetail).toBeUndefined();
    const payload = broadcasts[0]?.payload as {
      expanded: Record<string, unknown>;
    };
    // Broadcast payload for expanded carries expandedDetail: undefined (not
    // present as an own-property would be nicer, but vitest's toEqual treats
    // missing === undefined).
    expect(payload.expanded["expandedDetail"]).toBeUndefined();
  });

  // 16. flush drains stashed burst immediately (bypass rate-limit)
  it("flush(sessionId) drains stashed burst immediately, bypassing rate-limit", () => {
    manager.step(makeStep({ sessionId, title: "First", progress: 0.1 }));
    clock.advance(100);
    const coalesced = manager.step(makeStep({ sessionId, title: "Second", progress: 0.2 }));
    expect(coalesced).toBe("coalesced");
    expect(broadcasts).toHaveLength(1);

    const outcome = manager.flush(sessionId);
    expect(outcome).toBe("emitted");
    expect(broadcasts).toHaveLength(2);
    // After flush, pending reflects the most recent emit.
    expect(manager.pending(sessionId)?.title).toBe("Second");
    expect(manager.pendingStashed(sessionId)).toBeNull();

    // No stash → flush is a no-op.
    const second = manager.flush(sessionId);
    expect(second).toBe("none");
    expect(broadcasts).toHaveLength(2);
  });

  // 17. flushAll drains every stashed burst
  it("flushAll drains every session's stashed burst", () => {
    const s2 = createSession(store, "desktop-B");
    manager.step(makeStep({ sessionId, title: "A1", progress: 0.1 }));
    manager.step(makeStep({ sessionId: s2, title: "B1", progress: 0.1 }));
    clock.advance(100);
    manager.step(makeStep({ sessionId, title: "A2", progress: 0.2 }));
    manager.step(makeStep({ sessionId: s2, title: "B2", progress: 0.2 }));
    expect(broadcasts).toHaveLength(2);

    const drained = manager.flushAll();
    expect(drained).toBe(2);
    expect(broadcasts).toHaveLength(4);
    expect(manager.pending(sessionId)?.title).toBe("A2");
    expect(manager.pending(s2)?.title).toBe("B2");
  });

  // 18. drop clears per-session state
  it("drop(sessionId) removes per-session state", () => {
    manager.step(makeStep({ sessionId, title: "X", progress: 0.5 }));
    expect(manager.pending(sessionId)).not.toBeNull();
    expect(manager.activeSessionCount()).toBe(1);

    manager.drop(sessionId);
    expect(manager.pending(sessionId)).toBeNull();
    expect(manager.activeSessionCount()).toBe(0);

    // Idempotent — calling drop on a dropped session is a no-op.
    expect(() => manager.drop(sessionId)).not.toThrow();
  });

  // 19. invalid icon (too long)
  it("icon > maxIconLength → ErrorInvalidIcon", () => {
    const longIcon = "a".repeat(65);
    expect(() => manager.step(makeStep({ sessionId, icon: longIcon }))).toThrow(
      ErrorInvalidIcon,
    );
  });

  // 20. invalid expandedDetail (too long)
  it("expandedDetail > maxExpandedDetailLength → ErrorInvalidExpandedDetail", () => {
    const longDetail = "a".repeat(513);
    expect(() =>
      manager.step(makeStep({ sessionId, expandedDetail: longDetail })),
    ).toThrow(ErrorInvalidExpandedDetail);
  });

  // 21. broadcast fires per emit, not per coalesced record
  it("broadcast fires per emit, not per coalesced record", () => {
    for (let i = 0; i < 10; i++) {
      manager.step(makeStep({ sessionId, title: `t${i}`, progress: i / 10 }));
      clock.advance(50);
    }
    // Only the FIRST emitted — 9 coalesced into stash.
    expect(broadcasts).toHaveLength(1);
  });

  // 22. subscriber error doesn't block others
  it("subscriber error does not block other subscribers", () => {
    const received: string[] = [];
    manager.subscribe(() => {
      throw new Error("bad subscriber");
    });
    manager.subscribe((step) => {
      received.push(step.title);
    });
    manager.step(makeStep({ sessionId, title: "Hello", progress: 0.5 }));
    // Second subscriber still got called.
    expect(received).toEqual(["Hello"]);
  });
});

// ── Without-store mode ──────────────────────────────────

describe("LiveActivityManager — no-store mode", () => {
  it("without store, step() skips session-exists check", () => {
    const clock = new FakeClock();
    const manager = new LiveActivityManager({
      now: clock.now.bind(clock),
    });
    const outcome = manager.step({
      sessionId: "cs-anything",
      title: "no store mode",
      progress: 0.25,
    });
    expect(outcome).toBe("emitted");
    expect(manager.pending("cs-anything")?.title).toBe("no store mode");
  });
});

// ── RPC-level tests ───────────────────────────────────────

describe("liveActivity.* RPC family (F3)", () => {
  let handler: KairosRPCHandler;
  let nextId = 1;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
  });

  afterEach(() => {
    // Drop any per-session state to prevent cross-test leakage.
    const mgr = handler.getLiveActivity();
    for (const step of mgr.pendingAll()) {
      mgr.drop(step.sessionId);
    }
  });

  async function call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<RPCResponse> {
    const raw = JSON.stringify({ jsonrpc: "2.0", method, params, id: nextId++ });
    const res = await handler.handleMessage(raw);
    return res as RPCResponse;
  }

  // 23. full lifecycle
  it("liveActivity.step + pending full lifecycle", async () => {
    const created = await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "research" },
    });
    const sessionId = (created.result as { id: string }).id;

    const stepRes = await call("liveActivity.step", {
      sessionId,
      title: "Searching Google",
      progress: 0.15,
      icon: "magnifyingglass",
      expandedDetail: "Pulled first 10 search results",
    });
    expect(stepRes.error).toBeUndefined();
    expect((stepRes.result as { outcome: string }).outcome).toBe("emitted");

    const pending = await call("liveActivity.pending", { sessionId });
    const pendingOut = pending.result as {
      pending: Array<{
        sessionId: string;
        compact: { title: string; progress: number; icon?: string };
        expanded: {
          title: string;
          progress: number;
          icon?: string;
          expandedDetail?: string;
          firstSeenAt: number;
          lastUpdatedAt: number;
        };
      }>;
    };
    expect(pendingOut.pending).toHaveLength(1);
    expect(pendingOut.pending[0]?.sessionId).toBe(sessionId);
    expect(pendingOut.pending[0]?.compact.title).toBe("Searching Google");
    expect(pendingOut.pending[0]?.compact.progress).toBe(0.15);
    expect(pendingOut.pending[0]?.compact.icon).toBe("magnifyingglass");
    expect(pendingOut.pending[0]?.expanded.expandedDetail).toBe(
      "Pulled first 10 search results",
    );
    expect(typeof pendingOut.pending[0]?.expanded.firstSeenAt).toBe("number");
    expect(typeof pendingOut.pending[0]?.expanded.lastUpdatedAt).toBe("number");
  });

  // 24. invalid progress surfaces RPC error
  it("liveActivity.step with progress > 1 surfaces LIVE_ACTIVITY_INVALID_PROGRESS", async () => {
    const created = await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "bad progress" },
    });
    const sessionId = (created.result as { id: string }).id;

    const res = await call("liveActivity.step", {
      sessionId,
      title: "ok",
      progress: 2.5,
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/progress 2\.5 invalid/);
  });

  // 25. pending returns all when sessionId omitted
  it("liveActivity.pending returns all active sessions when sessionId omitted", async () => {
    const s1 = (
      await call("computer.session.create", {
        creatorDeviceId: "desktop-A",
        taskSpec: { task: "s1" },
      })
    ).result as { id: string };
    const s2 = (
      await call("computer.session.create", {
        creatorDeviceId: "desktop-B",
        taskSpec: { task: "s2" },
      })
    ).result as { id: string };

    await call("liveActivity.step", {
      sessionId: s1.id,
      title: "A",
      progress: 0.1,
    });
    await call("liveActivity.step", {
      sessionId: s2.id,
      title: "B",
      progress: 0.2,
    });

    const res = await call("liveActivity.pending", {});
    const out = res.result as {
      pending: Array<{ sessionId: string; compact: { title: string } }>;
    };
    expect(out.pending).toHaveLength(2);
    const titles = out.pending.map((p) => p.compact.title).sort();
    expect(titles).toEqual(["A", "B"]);
  });

  // 26. subscribe polling
  it("liveActivity.subscribe returns buffered events via polling", async () => {
    const seed = await call("liveActivity.subscribe", {});
    expect(seed.error).toBeUndefined();
    const subId = (seed.result as { subscriptionId: string }).subscriptionId;
    expect(subId).toMatch(/^las-/);

    const created = await call("computer.session.create", {
      creatorDeviceId: "desktop-A",
      taskSpec: { task: "sub test" },
    });
    const sessionId = (created.result as { id: string }).id;

    await call("liveActivity.step", {
      sessionId,
      title: "Step 1",
      progress: 0.1,
    });

    const drain = await call("liveActivity.subscribe", { subscriptionId: subId });
    const out = drain.result as {
      subscriptionId: string;
      events: Array<{ sessionId: string; compact: { title: string } }>;
      more: boolean;
      closed: boolean;
    };
    expect(out.subscriptionId).toBe(subId);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]?.compact.title).toBe("Step 1");
    expect(out.closed).toBe(false);

    // Close the subscription.
    const close = await call("liveActivity.subscribe", {
      subscriptionId: subId,
      close: true,
    });
    expect((close.result as { closed: boolean }).closed).toBe(true);
  });
});
