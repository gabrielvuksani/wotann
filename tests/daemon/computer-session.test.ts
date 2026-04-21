/**
 * Phase 3 P1-F1 — `computer.session` RPC family tests.
 *
 * Keystone cross-surface workflow: phone creates -> desktop claims -> phone watches.
 * These tests verify the lifecycle + error semantics through the KairosRPCHandler
 * so callers on any surface (iOS, TUI, desktop app, watch) get identical behavior.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";

// ── Helpers ─────────────────────────────────────────────

let nextId = 1;
function makeRequest(
  method: string,
  params?: Record<string, unknown>,
): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id: nextId++ });
}

async function call(
  handler: KairosRPCHandler,
  method: string,
  params?: Record<string, unknown>,
): Promise<RPCResponse> {
  const raw = makeRequest(method, params);
  const res = await handler.handleMessage(raw);
  // Computer-session handlers are non-streaming; they always resolve to RPCResponse.
  return res as RPCResponse;
}

type SessionDto = {
  id: string;
  creatorDeviceId: string;
  claimedByDeviceId: string | null;
  status:
    | "pending"
    | "claimed"
    | "running"
    | "awaiting_approval"
    | "done"
    | "failed";
  taskSpec: { task: string };
  eventCount: number;
  pendingApprovalId: string | null;
  result: Record<string, unknown> | null;
};

type EventDto = {
  sessionId: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
};

type StreamDto = {
  subscriptionId: string;
  events: EventDto[];
  more: boolean;
  closed: boolean;
};

// ── Tests ──────────────────────────────────────────────

describe("computer.session RPC family (Phase 3 P1-F1 keystone)", () => {
  let handler: KairosRPCHandler;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
  });

  // ── 1. Happy-path lifecycle ──────────────────────────

  it("supports the full phone->desktop->phone workflow (create, claim, step, close)", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-abc",
      taskSpec: { task: "research quantum sensors", mode: "research" },
    });
    const session = created.result as SessionDto;
    expect(session.id).toMatch(/^cs-/);
    expect(session.status).toBe("pending");
    expect(session.creatorDeviceId).toBe("phone-abc");
    expect(session.claimedByDeviceId).toBeNull();

    const claimed = await call(handler, "computer.session.claim", {
      sessionId: session.id,
      deviceId: "desktop-xyz",
    });
    expect((claimed.result as SessionDto).status).toBe("claimed");
    expect((claimed.result as SessionDto).claimedByDeviceId).toBe("desktop-xyz");

    const stepped = await call(handler, "computer.session.step", {
      sessionId: session.id,
      deviceId: "desktop-xyz",
      step: { action: "browse.open", description: "opening google.com", index: 0 },
    });
    expect((stepped.result as SessionDto).status).toBe("running");

    const closed = await call(handler, "computer.session.close", {
      sessionId: session.id,
      deviceId: "desktop-xyz",
      outcome: "done",
      result: { creationPath: "~/wotann/creations/quantum-sensors.md" },
    });
    const final = closed.result as SessionDto;
    expect(final.status).toBe("done");
    expect(final.result).toMatchObject({
      creationPath: "~/wotann/creations/quantum-sensors.md",
    });
  });

  // ── 2. Double-claim rejection ────────────────────────

  it("rejects double-claim with SESSION_ALREADY_CLAIMED", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-1",
      taskSpec: { task: "do a thing" },
    });
    const { id } = created.result as SessionDto;

    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "desktop-1" });
    const doubleClaim = await call(handler, "computer.session.claim", {
      sessionId: id,
      deviceId: "desktop-2",
    });
    expect(doubleClaim.error).toBeDefined();
    expect(doubleClaim.error?.message).toMatch(/already claimed/i);

    // But same device re-claiming is idempotent.
    const reclaim = await call(handler, "computer.session.claim", {
      sessionId: id,
      deviceId: "desktop-1",
    });
    expect(reclaim.result).toBeDefined();
    expect((reclaim.result as SessionDto).claimedByDeviceId).toBe("desktop-1");
  });

  // ── 3. Stream replays history then tails ─────────────

  it("stream replays history then delivers new events in order", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-1",
      taskSpec: { task: "any task" },
    });
    const { id } = created.result as SessionDto;

    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "desktop-1" });
    await call(handler, "computer.session.step", {
      sessionId: id,
      deviceId: "desktop-1",
      step: { action: "step-1" },
    });

    // Subscribe AFTER two events already happened — should replay both.
    const sub = await call(handler, "computer.session.stream", { sessionId: id });
    const sub1 = sub.result as StreamDto;
    expect(sub1.events.length).toBeGreaterThanOrEqual(3);
    const types = sub1.events.map((e) => e.type);
    expect(types).toContain("created");
    expect(types).toContain("claimed");
    expect(types).toContain("step");

    // Emit a new event after subscription — polling should see it.
    await call(handler, "computer.session.step", {
      sessionId: id,
      deviceId: "desktop-1",
      step: { action: "step-2" },
    });

    const tail = await call(handler, "computer.session.stream", {
      subscriptionId: sub1.subscriptionId,
    });
    const tail1 = tail.result as StreamDto;
    expect(tail1.events.length).toBeGreaterThanOrEqual(4);

    // Event sequence numbers must be monotonic.
    const seqs = tail1.events.map((e) => e.seq);
    const sortedSeqs = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sortedSeqs);
  });

  // ── 4. Approve with deny terminates session ──────────

  it("approve with decision=deny terminates the session as failed", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-1",
      taskSpec: { task: "delete tmp files" },
    });
    const { id } = created.result as SessionDto;

    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "desktop-1" });
    await call(handler, "computer.session.step", {
      sessionId: id,
      deviceId: "desktop-1",
      step: { action: "listing" },
    });

    await call(handler, "computer.session.requestApproval", {
      sessionId: id,
      deviceId: "desktop-1",
      summary: "Delete /tmp/*",
      riskLevel: "high",
    });

    const denied = await call(handler, "computer.session.approve", {
      sessionId: id,
      deviceId: "phone-1",
      decision: "deny",
    });
    const session = denied.result as SessionDto;
    expect(session.status).toBe("failed");
    expect(session.result).toMatchObject({ reason: "approval_denied" });
  });

  // ── 5. Approve allow resumes running ─────────────────

  it("approve with decision=allow returns to running", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-1",
      taskSpec: { task: "sensitive thing" },
    });
    const { id } = created.result as SessionDto;
    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "desktop-1" });
    await call(handler, "computer.session.step", {
      sessionId: id,
      deviceId: "desktop-1",
      step: { action: "pre-approval" },
    });
    await call(handler, "computer.session.requestApproval", {
      sessionId: id,
      deviceId: "desktop-1",
      summary: "Write file",
      riskLevel: "low",
    });

    const allowed = await call(handler, "computer.session.approve", {
      sessionId: id,
      deviceId: "phone-1",
      decision: "allow",
    });
    expect((allowed.result as SessionDto).status).toBe("running");
  });

  // ── 6. Wrong device on approve rejected ──────────────

  it("rejects approve from non-creator device with SESSION_UNAUTHORIZED", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-creator",
      taskSpec: { task: "task" },
    });
    const { id } = created.result as SessionDto;
    await call(handler, "computer.session.claim", {
      sessionId: id,
      deviceId: "desktop-claimant",
    });
    await call(handler, "computer.session.step", {
      sessionId: id,
      deviceId: "desktop-claimant",
      step: { action: "step" },
    });
    await call(handler, "computer.session.requestApproval", {
      sessionId: id,
      deviceId: "desktop-claimant",
      summary: "risky",
      riskLevel: "high",
    });
    const unauthorized = await call(handler, "computer.session.approve", {
      sessionId: id,
      // Desktop (claimant) is NOT creator — must NOT be able to self-approve.
      deviceId: "desktop-claimant",
      decision: "allow",
    });
    expect(unauthorized.error).toBeDefined();
    expect(unauthorized.error?.message).toMatch(/unauthorized/i);
  });

  // ── 7. Session-not-found returns explicit error ──────

  it("returns explicit error (not silent empty) for unknown sessionId", async () => {
    const res = await call(handler, "computer.session.claim", {
      sessionId: "cs-does-not-exist",
      deviceId: "desktop-1",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/Session not found/i);

    const stream = await call(handler, "computer.session.stream", {
      sessionId: "cs-ghost",
    });
    expect(stream.error).toBeDefined();
  });

  // ── 8. Status transitions validated ──────────────────

  it("rejects illegal transitions (step on a done session)", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-1",
      taskSpec: { task: "t" },
    });
    const { id } = created.result as SessionDto;
    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "desktop-1" });
    await call(handler, "computer.session.close", {
      sessionId: id,
      deviceId: "desktop-1",
      outcome: "done",
    });
    const illegal = await call(handler, "computer.session.step", {
      sessionId: id,
      deviceId: "desktop-1",
      step: { action: "after-done" },
    });
    expect(illegal.error).toBeDefined();
    expect(illegal.error?.message).toMatch(/Illegal transition|done/i);
  });

  // ── 9. Event ordering preserved across subscribers ───

  it("preserves event ordering across two concurrent subscribers", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-1",
      taskSpec: { task: "t" },
    });
    const { id } = created.result as SessionDto;

    const subA = (
      await call(handler, "computer.session.stream", { sessionId: id })
    ).result as StreamDto;
    const subB = (
      await call(handler, "computer.session.stream", { sessionId: id })
    ).result as StreamDto;

    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "desktop-1" });
    for (let i = 0; i < 5; i++) {
      await call(handler, "computer.session.step", {
        sessionId: id,
        deviceId: "desktop-1",
        step: { action: `step-${i}` },
      });
    }

    const tailA = (
      await call(handler, "computer.session.stream", {
        subscriptionId: subA.subscriptionId,
      })
    ).result as StreamDto;
    const tailB = (
      await call(handler, "computer.session.stream", {
        subscriptionId: subB.subscriptionId,
      })
    ).result as StreamDto;

    const seqsA = tailA.events.map((e) => e.seq);
    const seqsB = tailB.events.map((e) => e.seq);
    expect(seqsA).toEqual(seqsB);
    expect(seqsA).toEqual([...seqsA].sort((a, b) => a - b));
  });

  // ── 10. Eviction policy ──────────────────────────────

  it("eviction: when size exceeds limit, oldest terminal session evicted first", async () => {
    // Use direct store access (cap is 1000 default; override by new instance for speed).
    const { ComputerSessionStore } = await import(
      "../../src/session/computer-session-store.js"
    );
    const store = new ComputerSessionStore({ maxSessions: 3 });

    const s1 = store.create({ creatorDeviceId: "d", taskSpec: { task: "t1" } });
    // Terminate s1 so it's the preferred eviction candidate.
    store.claim(s1.id, "runner");
    store.close({ sessionId: s1.id, deviceId: "runner", outcome: "done" });

    const s2 = store.create({ creatorDeviceId: "d", taskSpec: { task: "t2" } });
    const s3 = store.create({ creatorDeviceId: "d", taskSpec: { task: "t3" } });

    expect(store.size()).toBe(3);

    // This should push s1 out (terminal, oldest).
    const s4 = store.create({ creatorDeviceId: "d", taskSpec: { task: "t4" } });

    expect(store.size()).toBe(3);
    expect(store.getOrNull(s1.id)).toBeNull();
    expect(store.getOrNull(s2.id)).not.toBeNull();
    expect(store.getOrNull(s3.id)).not.toBeNull();
    expect(store.getOrNull(s4.id)).not.toBeNull();
  });

  // ── 11. Concurrent reads safe under writer ───────────

  it("concurrent subscribers all see the same events (two readers + one writer)", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone-1",
      taskSpec: { task: "t" },
    });
    const { id } = created.result as SessionDto;

    const readerA = (
      await call(handler, "computer.session.stream", { sessionId: id })
    ).result as StreamDto;
    const readerB = (
      await call(handler, "computer.session.stream", { sessionId: id })
    ).result as StreamDto;

    // Parallel writer: claim + 10 steps.
    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "desktop-1" });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        call(handler, "computer.session.step", {
          sessionId: id,
          deviceId: "desktop-1",
          step: { action: `step-${i}` },
        }),
      ),
    );

    const tailA = (
      await call(handler, "computer.session.stream", {
        subscriptionId: readerA.subscriptionId,
      })
    ).result as StreamDto;
    const tailB = (
      await call(handler, "computer.session.stream", {
        subscriptionId: readerB.subscriptionId,
      })
    ).result as StreamDto;

    // Both readers saw the full set. Step ordering is whatever Promise.all scheduled,
    // but total count is deterministic: 1 created + 1 claimed + 10 steps = 12.
    expect(tailA.events.length).toBe(12);
    expect(tailB.events.length).toBe(12);
  });

  // ── 12. List filter ──────────────────────────────────

  it("list filters by status", async () => {
    const a = (
      await call(handler, "computer.session.create", {
        creatorDeviceId: "d",
        taskSpec: { task: "a" },
      })
    ).result as SessionDto;
    const b = (
      await call(handler, "computer.session.create", {
        creatorDeviceId: "d",
        taskSpec: { task: "b" },
      })
    ).result as SessionDto;
    await call(handler, "computer.session.claim", { sessionId: b.id, deviceId: "r" });

    const pendingOnly = (await call(handler, "computer.session.list", { status: "pending" }))
      .result as SessionDto[];
    const claimedOnly = (await call(handler, "computer.session.list", { status: "claimed" }))
      .result as SessionDto[];

    expect(pendingOnly.map((s) => s.id)).toContain(a.id);
    expect(pendingOnly.map((s) => s.id)).not.toContain(b.id);
    expect(claimedOnly.map((s) => s.id)).toContain(b.id);
  });

  // ── 13. Input validation ─────────────────────────────

  it("rejects create with missing creatorDeviceId or empty task", async () => {
    const r1 = await call(handler, "computer.session.create", {
      taskSpec: { task: "x" },
    });
    expect(r1.error).toBeDefined();

    const r2 = await call(handler, "computer.session.create", {
      creatorDeviceId: "phone",
      taskSpec: { task: "" },
    });
    expect(r2.error).toBeDefined();
  });

  // ── 14. Grep-verifiable: RPC methods registered ──────

  it("exposes all 7 computer.session.* methods via getMethods()", async () => {
    const methods = handler.getMethods();
    expect(methods).toContain("computer.session.create");
    expect(methods).toContain("computer.session.claim");
    expect(methods).toContain("computer.session.step");
    expect(methods).toContain("computer.session.stream");
    expect(methods).toContain("computer.session.approve");
    expect(methods).toContain("computer.session.close");
    expect(methods).toContain("computer.session.requestApproval");
    expect(methods).toContain("computer.session.list");
  });

  // ── 15. Stream close releases buffer ─────────────────

  it("stream close releases the subscription buffer", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "p",
      taskSpec: { task: "t" },
    });
    const { id } = created.result as SessionDto;
    const sub = (
      await call(handler, "computer.session.stream", { sessionId: id })
    ).result as StreamDto;

    const closed = await call(handler, "computer.session.stream", {
      subscriptionId: sub.subscriptionId,
      close: true,
    });
    expect((closed.result as StreamDto).closed).toBe(true);

    // Second poll on the same id must now fail — subscription was released.
    const followup = await call(handler, "computer.session.stream", {
      subscriptionId: sub.subscriptionId,
    });
    expect(followup.error).toBeDefined();
    expect(followup.error?.message).toMatch(/subscription not found/i);
  });

  // ── 16. `since` filter on continuation returns only newer ──

  it("stream continuation with `since` filters to new events only", async () => {
    const created = await call(handler, "computer.session.create", {
      creatorDeviceId: "p",
      taskSpec: { task: "t" },
    });
    const { id } = created.result as SessionDto;
    const sub = (
      await call(handler, "computer.session.stream", { sessionId: id })
    ).result as StreamDto;
    await call(handler, "computer.session.claim", { sessionId: id, deviceId: "d" });
    await call(handler, "computer.session.step", {
      sessionId: id,
      deviceId: "d",
      step: { action: "x" },
    });

    const tailNewOnly = (
      await call(handler, "computer.session.stream", {
        subscriptionId: sub.subscriptionId,
        since: 1, // skip "created" (seq 0), keep claimed (1) + step (2)
      })
    ).result as StreamDto;

    expect(tailNewOnly.events.map((e) => e.seq)).toEqual([1, 2]);
  });
});
