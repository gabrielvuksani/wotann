/**
 * Phase 3 P1-F14 — Cross-session resume (handoff) tests.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §7, a session claimed on
 * one surface (phone) can be handed off to another (desktop), preserving
 * full state plus recent context. These tests exercise:
 *
 *   1. basic handoff — A claims, A hands off to B, B owns
 *   2. write permission transfer — B can step, A cannot
 *   3. audit trail — both claim + handoff are persisted
 *   4. error taxonomy (QB #6):
 *        - ErrorNotClaimed
 *        - ErrorDeviceNotRegistered
 *        - ErrorHandoffInFlight (double-handoff race)
 *        - ErrorHandoffExpired (late accept)
 *   5. RPC endpoints — computer.session.handoff + acceptHandoff + expireHandoff
 *   6. fan-out — handoff events broadcast via UnifiedDispatchPlane (F11 pattern)
 *   7. lifecycle — close from target works after handoff
 *   8. per-session isolation (QB #7) — two concurrent handoffs don't cross
 *
 * Uses the injectable scheduler in SessionHandoffManager so TTL expiry is
 * deterministic without waiting on real timers.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ComputerSessionStore,
  ErrorDeviceNotRegistered,
  ErrorHandoffExpired,
  ErrorHandoffInFlight,
  ErrorHandoffNotFound,
  ErrorNotClaimed,
  SessionIllegalTransitionError,
  SessionUnauthorizedError,
} from "../../src/session/computer-session-store.js";
import { SessionHandoffManager } from "../../src/session/session-handoff.js";
import { UnifiedDispatchPlane } from "../../src/channels/unified-dispatch.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";
import type { UnifiedEvent } from "../../src/channels/fan-out.js";

// ── Deterministic scheduler for TTL tests ───────────────

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

  /** Advance virtual time; fire any timers whose deadline elapsed. */
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

// ── Store-level tests ───────────────────────────────────

describe("ComputerSessionStore — F14 handoff state machine", () => {
  let store: ComputerSessionStore;
  let mgr: SessionHandoffManager;
  let scheduler: FakeScheduler;

  beforeEach(() => {
    store = new ComputerSessionStore();
    scheduler = new FakeScheduler();
    mgr = new SessionHandoffManager({
      store,
      scheduler: {
        setTimeout: scheduler.setTimeout.bind(scheduler),
        clearTimeout: scheduler.clearTimeout.bind(scheduler),
      },
    });
  });

  // 1. basic handoff — A claims, A hands off, B accepts, B owns
  it("transfers claim from fromDevice to toDevice on accept", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "research quantum sensors" },
    });
    store.claim(s.id, "desktop-A");

    const { handoff, session: mid } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
      reason: "moving upstairs",
    });
    expect(mid.status).toBe("handed_off");
    expect(mid.claimedByDeviceId).toBe("desktop-A"); // unchanged until accept

    const after = mgr.accept({
      sessionId: s.id,
      handoffId: handoff.id,
      deviceId: "desktop-B",
    });
    expect(after.status).toBe("claimed"); // resume to pre-handoff status
    expect(after.claimedByDeviceId).toBe("desktop-B");
    expect(after.pendingHandoffId).toBeNull();

    // Audit: one accepted record
    const audit = after.handoffs.find((h) => h.id === handoff.id);
    expect(audit?.state).toBe("accepted");
    expect(audit?.fromDeviceId).toBe("desktop-A");
    expect(audit?.toDeviceId).toBe("desktop-B");
    expect(audit?.acceptedAt).toBeTypeOf("number");
  });

  // 2. write permission transfer — B can step, A cannot
  it("B can emit steps after accept; A can no longer step", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "build landing page" },
    });
    store.claim(s.id, "desktop-A");
    store.step({ sessionId: s.id, deviceId: "desktop-A", step: { kind: "plan" } });

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    mgr.accept({ sessionId: s.id, handoffId: handoff.id, deviceId: "desktop-B" });

    // B succeeds
    const next = store.step({
      sessionId: s.id,
      deviceId: "desktop-B",
      step: { kind: "write", path: "/app.tsx" },
    });
    expect(next.status).toBe("running");

    // A is now unauthorized (B owns the claim)
    expect(() =>
      store.step({ sessionId: s.id, deviceId: "desktop-A", step: { kind: "write" } }),
    ).toThrow(SessionUnauthorizedError);
  });

  // 3. audit trail — initiate + accept are both in the timeline
  it("records both claim + handoff events in the session timeline", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    const after = mgr.accept({
      sessionId: s.id,
      handoffId: handoff.id,
      deviceId: "desktop-B",
    });
    const types = after.events.map((e) => e.type);
    expect(types).toContain("created");
    expect(types).toContain("claimed");
    expect(types).toContain("handoff_initiated");
    expect(types).toContain("handoff_accepted");
    // Chain of custody in audit trail
    expect(after.handoffs).toHaveLength(1);
    expect(after.handoffs[0]?.state).toBe("accepted");
  });

  // 4a. error: unregistered target device
  it("rejects handoff to an unregistered device with ErrorDeviceNotRegistered", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");

    // Custom registry — only knows desktop-A
    const strictMgr = new SessionHandoffManager({
      store,
      isTargetRegistered: (d) => d === "desktop-A",
      scheduler: {
        setTimeout: scheduler.setTimeout.bind(scheduler),
        clearTimeout: scheduler.clearTimeout.bind(scheduler),
      },
    });
    expect(() =>
      strictMgr.initiate({
        sessionId: s.id,
        fromDeviceId: "desktop-A",
        toDeviceId: "ghost-device",
      }),
    ).toThrow(ErrorDeviceNotRegistered);
  });

  // 4b. error: cannot hand off a session that was never claimed
  it("rejects handoff on a never-claimed session with ErrorNotClaimed", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    expect(() =>
      mgr.initiate({
        sessionId: s.id,
        fromDeviceId: "desktop-A",
        toDeviceId: "desktop-B",
      }),
    ).toThrow(ErrorNotClaimed);
  });

  // 4c. error: double-handoff in flight
  it("rejects a second handoff while one is pending with ErrorHandoffInFlight", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");

    mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    expect(() =>
      mgr.initiate({
        sessionId: s.id,
        fromDeviceId: "desktop-A",
        toDeviceId: "desktop-C",
      }),
    ).toThrow(ErrorHandoffInFlight);
  });

  // 4d. error: late accept after TTL expires
  it("late accept throws ErrorHandoffExpired and rolls back the session", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    store.step({ sessionId: s.id, deviceId: "desktop-A", step: { kind: "plan" } });

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
      ttlMs: 1000,
    });

    // Advance past TTL
    scheduler.advance(1500);

    // Session should have rolled back to running (pre-handoff status)
    const rolled = store.get(s.id);
    expect(rolled.status).toBe("running");
    expect(rolled.claimedByDeviceId).toBe("desktop-A");
    expect(rolled.pendingHandoffId).toBeNull();
    expect(rolled.handoffs[0]?.state).toBe("expired");

    // Late accept — the handoff is no longer pending, so rejection is via
    // the "not in handed_off state" path: the store surfaces
    // SessionIllegalTransitionError (handoff already resolved, expire path
    // already ran). Verify the accept attempt correctly fails loudly.
    expect(() =>
      mgr.accept({ sessionId: s.id, handoffId: handoff.id, deviceId: "desktop-B" }),
    ).toThrow(SessionIllegalTransitionError);
  });

  // 4e. accept path also fires ErrorHandoffExpired when expire hasn't fired yet
  it("acceptHandoff detects expiry via now timestamp even if timer hasn't fired", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
      ttlMs: 1000,
    });
    const expiresAt = handoff.expiresAt;

    // Skip scheduler entirely — call accept with a now beyond expiresAt
    expect(() =>
      store.acceptHandoff({
        sessionId: s.id,
        handoffId: handoff.id,
        deviceId: "desktop-B",
        now: expiresAt + 500,
      }),
    ).toThrow(ErrorHandoffExpired);

    // After the expiry detection, session should be rolled back
    const rolled = store.get(s.id);
    expect(rolled.status).toBe("claimed");
    expect(rolled.claimedByDeviceId).toBe("desktop-A");
    expect(rolled.handoffs[0]?.state).toBe("expired");
  });

  // 4f. error: wrong target device cannot accept
  it("rejects accept by a non-target device with SessionUnauthorizedError", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    expect(() =>
      mgr.accept({
        sessionId: s.id,
        handoffId: handoff.id,
        deviceId: "imposter-X",
      }),
    ).toThrow(SessionUnauthorizedError);
  });

  // 4g. error: unknown handoff id
  it("acceptHandoff with unknown id throws ErrorHandoffNotFound", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });

    expect(() =>
      store.acceptHandoff({
        sessionId: s.id,
        handoffId: "ho-does-not-exist",
        deviceId: "desktop-B",
      }),
    ).toThrow(ErrorHandoffNotFound);
  });

  // Non-claimant attempts handoff initiation — unauthorized
  it("rejects initiate from a device that is not the current claimant", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    expect(() =>
      mgr.initiate({
        sessionId: s.id,
        fromDeviceId: "desktop-Z", // not the claimant
        toDeviceId: "desktop-B",
      }),
    ).toThrow(SessionUnauthorizedError);
  });

  // Explicit expire cancels the pending handoff
  it("explicit expire rolls back to pre-handoff status", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    store.step({ sessionId: s.id, deviceId: "desktop-A", step: { kind: "plan" } });

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    const after = mgr.expire({ sessionId: s.id, handoffId: handoff.id });
    expect(after.status).toBe("running");
    expect(after.claimedByDeviceId).toBe("desktop-A");
    expect(after.handoffs[0]?.state).toBe("expired");
  });

  // 8. per-session isolation (QB #7) — two concurrent handoffs don't cross
  it("two concurrent sessions don't cross-contaminate handoffs", () => {
    const s1 = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "alpha" },
    });
    const s2 = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "beta" },
    });
    store.claim(s1.id, "desktop-A");
    store.claim(s2.id, "desktop-B");

    const { handoff: h1 } = mgr.initiate({
      sessionId: s1.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-C",
    });
    const { handoff: h2 } = mgr.initiate({
      sessionId: s2.id,
      fromDeviceId: "desktop-B",
      toDeviceId: "desktop-D",
    });

    expect(h1.id).not.toBe(h2.id);

    // Accept s1's handoff — s2 must be unaffected
    mgr.accept({ sessionId: s1.id, handoffId: h1.id, deviceId: "desktop-C" });
    expect(store.get(s1.id).claimedByDeviceId).toBe("desktop-C");
    expect(store.get(s2.id).claimedByDeviceId).toBe("desktop-B"); // still
    expect(store.get(s2.id).status).toBe("handed_off"); // still in-flight
  });

  // Full lifecycle end-to-end — close from target device works
  it("target device can close the session after accepting the handoff", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    mgr.accept({ sessionId: s.id, handoffId: handoff.id, deviceId: "desktop-B" });

    const closed = store.close({
      sessionId: s.id,
      deviceId: "desktop-B",
      outcome: "done",
      result: { summary: "landed" },
    });
    expect(closed.status).toBe("done");
    expect(closed.claimedByDeviceId).toBe("desktop-B");

    // The original claimant can't close a closed session in any case — but
    // the critical claim is that the NEW claimant's close worked end-to-end.
    expect(closed.handoffs[0]?.state).toBe("accepted");
  });

  // 4h. initiate requires that we can resume from running/awaiting_approval
  it("can hand off during awaiting_approval and return there on accept", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    store.step({ sessionId: s.id, deviceId: "desktop-A", step: { kind: "plan" } });
    store.requestApproval({
      sessionId: s.id,
      deviceId: "desktop-A",
      summary: "about to rm -rf",
      riskLevel: "high",
    });
    expect(store.get(s.id).status).toBe("awaiting_approval");

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    const after = mgr.accept({
      sessionId: s.id,
      handoffId: handoff.id,
      deviceId: "desktop-B",
    });
    expect(after.status).toBe("awaiting_approval"); // preserved
    expect(after.claimedByDeviceId).toBe("desktop-B");
  });

  // Chain of handoffs (phone -> desktop -> TUI) — full audit trail preserved
  it("supports chained handoffs with full audit trail", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "3-surface sprint" },
    });
    store.claim(s.id, "phone-A");

    // Hop 1: phone -> desktop
    const r1 = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "phone-A",
      toDeviceId: "desktop-A",
    });
    mgr.accept({ sessionId: s.id, handoffId: r1.handoff.id, deviceId: "desktop-A" });

    // Hop 2: desktop -> TUI
    const r2 = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "tui-A",
    });
    mgr.accept({ sessionId: s.id, handoffId: r2.handoff.id, deviceId: "tui-A" });

    const final = store.get(s.id);
    expect(final.claimedByDeviceId).toBe("tui-A");
    expect(final.handoffs).toHaveLength(2);
    expect(final.handoffs.map((h) => `${h.fromDeviceId}->${h.toDeviceId}`)).toEqual([
      "phone-A->desktop-A",
      "desktop-A->tui-A",
    ]);
  });

  // Handoff manager drops its TTL timers after accept
  it("accept cancels the scheduled TTL timer", () => {
    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");
    expect(mgr.pendingTimerCount()).toBe(0);

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    expect(mgr.pendingTimerCount()).toBe(1);

    mgr.accept({ sessionId: s.id, handoffId: handoff.id, deviceId: "desktop-B" });
    expect(mgr.pendingTimerCount()).toBe(0);
  });
});

// ── UnifiedDispatchPlane broadcast integration (F11 pattern) ──

describe("SessionHandoffManager — UnifiedDispatchPlane broadcast (F11)", () => {
  it("broadcasts handoff_initiated and handoff_accepted as UnifiedEvents via the plane", async () => {
    const plane = new UnifiedDispatchPlane();
    const events: UnifiedEvent[] = [];
    plane.registerSurface("watch-1", "watch", (ev) => {
      events.push(ev);
    });

    const store = new ComputerSessionStore();
    const mgr = new SessionHandoffManager({
      store,
      broadcast: async (ev) => {
        await plane.broadcastUnifiedEvent(ev);
      },
    });

    const s = store.create({
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    store.claim(s.id, "desktop-A");

    const { handoff } = mgr.initiate({
      sessionId: s.id,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
      reason: "lunch",
    });

    // Let the async broadcast settle.
    await new Promise((r) => setImmediate(r));

    mgr.accept({
      sessionId: s.id,
      handoffId: handoff.id,
      deviceId: "desktop-B",
    });
    await new Promise((r) => setImmediate(r));

    expect(events.length).toBeGreaterThanOrEqual(2);
    const actions = events.map((e) => e.payload.action).filter(Boolean);
    expect(actions).toContain("handoff_initiated");
    expect(actions).toContain("handoff_accepted");
    // Every event is a "session" UnifiedEvent (reuses existing taxonomy)
    expect(events.every((e) => e.type === "session")).toBe(true);
  });
});

// ── RPC-level tests (end-to-end via KairosRPCHandler) ───

describe("computer.session.handoff RPC family (F14)", () => {
  let handler: KairosRPCHandler;
  let nextId = 1;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
  });

  async function call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<RPCResponse> {
    const raw = JSON.stringify({ jsonrpc: "2.0", method, params, id: nextId++ });
    const res = await handler.handleMessage(raw);
    return res as RPCResponse;
  }

  it("computer.session.handoff + acceptHandoff transfers claim end-to-end", async () => {
    const createRes = await call("computer.session.create", {
      creatorDeviceId: "phone-A",
      taskSpec: { task: "build landing page" },
    });
    const sessionId = (createRes.result as { id: string }).id;

    await call("computer.session.claim", {
      sessionId,
      deviceId: "desktop-A",
    });

    const handoffRes = await call("computer.session.handoff", {
      sessionId,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
      reason: "moving upstairs",
    });
    const { handoff, session: midSession } = handoffRes.result as {
      handoff: { id: string };
      session: { status: string; claimedByDeviceId: string; pendingHandoffId: string };
    };
    expect(midSession.status).toBe("handed_off");
    expect(midSession.pendingHandoffId).toBe(handoff.id);
    expect(midSession.claimedByDeviceId).toBe("desktop-A");

    const acceptRes = await call("computer.session.acceptHandoff", {
      sessionId,
      handoffId: handoff.id,
      deviceId: "desktop-B",
    });
    const final = acceptRes.result as {
      status: string;
      claimedByDeviceId: string;
      handoffs: Array<{ state: string }>;
      pendingHandoffId: string | null;
    };
    expect(final.status).toBe("claimed");
    expect(final.claimedByDeviceId).toBe("desktop-B");
    expect(final.pendingHandoffId).toBeNull();
    expect(final.handoffs[0]?.state).toBe("accepted");
  });

  it("RPC rejects handoff of an un-claimed session (ErrorNotClaimed)", async () => {
    const createRes = await call("computer.session.create", {
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    const sessionId = (createRes.result as { id: string }).id;

    const res = await call("computer.session.handoff", {
      sessionId,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/not claimed/i);
  });

  it("RPC rejects double-handoff in flight (ErrorHandoffInFlight)", async () => {
    const createRes = await call("computer.session.create", {
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    const sessionId = (createRes.result as { id: string }).id;
    await call("computer.session.claim", { sessionId, deviceId: "desktop-A" });
    await call("computer.session.handoff", {
      sessionId,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    const dup = await call("computer.session.handoff", {
      sessionId,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-C",
    });
    expect(dup.error).toBeDefined();
    expect(dup.error?.message).toMatch(/in-flight/i);
  });

  it("RPC exposes expireHandoff and rolls back to prior status", async () => {
    const createRes = await call("computer.session.create", {
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    const sessionId = (createRes.result as { id: string }).id;
    await call("computer.session.claim", { sessionId, deviceId: "desktop-A" });

    const handoffRes = await call("computer.session.handoff", {
      sessionId,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    const handoffId = (handoffRes.result as { handoff: { id: string } }).handoff.id;

    const expired = await call("computer.session.expireHandoff", {
      sessionId,
      handoffId,
    });
    const after = expired.result as {
      status: string;
      claimedByDeviceId: string;
      pendingHandoffId: string | null;
    };
    // Pre-handoff status was "claimed" (no steps yet) — that's what we
    // resume to. Original claimant retained.
    expect(after.status).toBe("claimed");
    expect(after.claimedByDeviceId).toBe("desktop-A");
    expect(after.pendingHandoffId).toBeNull();
  });

  it("RPC accept from wrong device is rejected", async () => {
    const createRes = await call("computer.session.create", {
      creatorDeviceId: "phone-A",
      taskSpec: { task: "demo" },
    });
    const sessionId = (createRes.result as { id: string }).id;
    await call("computer.session.claim", { sessionId, deviceId: "desktop-A" });
    const h = await call("computer.session.handoff", {
      sessionId,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    const handoffId = (h.result as { handoff: { id: string } }).handoff.id;

    const wrong = await call("computer.session.acceptHandoff", {
      sessionId,
      handoffId,
      deviceId: "imposter-device",
    });
    expect(wrong.error).toBeDefined();
    expect(wrong.error?.message).toMatch(/handoff target/i);
  });

  it("RPC end-to-end: close after handoff accept works for target device", async () => {
    const createRes = await call("computer.session.create", {
      creatorDeviceId: "phone-A",
      taskSpec: { task: "lifecycle" },
    });
    const sessionId = (createRes.result as { id: string }).id;

    await call("computer.session.claim", { sessionId, deviceId: "desktop-A" });
    const h = await call("computer.session.handoff", {
      sessionId,
      fromDeviceId: "desktop-A",
      toDeviceId: "desktop-B",
    });
    const handoffId = (h.result as { handoff: { id: string } }).handoff.id;
    await call("computer.session.acceptHandoff", {
      sessionId,
      handoffId,
      deviceId: "desktop-B",
    });

    const closeRes = await call("computer.session.close", {
      sessionId,
      deviceId: "desktop-B",
      outcome: "done",
      result: { ok: true },
    });
    const closed = closeRes.result as { status: string; claimedByDeviceId: string };
    expect(closed.status).toBe("done");
    expect(closed.claimedByDeviceId).toBe("desktop-B");
  });
});
