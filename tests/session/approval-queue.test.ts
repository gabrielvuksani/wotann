/**
 * Phase 3 P1-F6 — Approval subscription channel tests.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S6 and MASTER_PLAN_V8
 * §5 P1-F6 (1 day), F1 landed `computer.session.approve` lifecycle. F6 adds a
 * dedicated subscription channel so phones/watches can RECEIVE approval
 * requests and respond, independent of the full session stream. It also adds
 * typed approval payloads (shell-exec, file-write, destructive, custom) for
 * per-surface UI rendering.
 *
 * Tests exercise:
 *   Queue-level (ApprovalQueue):
 *     1.  enqueue pending approval
 *     2.  pendingForSession returns only that session's approvals
 *     3.  decide resolves + emits decided event
 *     4.  TTL expiration auto-denies and emits expiration event
 *     5.  subscribe emits on enqueue + decide
 *     6.  typed payload — shell-exec requires non-empty command
 *     7.  typed payload — file-write requires path and preview
 *     8.  typed payload — destructive requires operation + target + reason
 *     9.  typed payload — custom requires schemaId
 *    10.  unknown approvalId decide → ErrorApprovalNotFound
 *    11.  already-decided decide → ErrorAlreadyDecided
 *    12.  expired decide → ErrorExpired
 *    13.  two sessions' approvals don't leak (per-session filter)
 *    14.  broadcast fires on enqueue (approval-request) + decide (approval-decided)
 *    15.  broadcast fires on auto-expire (approval-expired)
 *    16.  file-write preview trimmed to 1 KiB
 *    17.  pending() returns all queued approvals, no terminal ones
 *
 *   RPC-level (via KairosRPCHandler):
 *    18.  approvals.pending returns empty list initially
 *    19.  approvals.subscribe seeds a subscription + poll drains events
 *    20.  approvals.decide full cycle (enqueue → subscribe → decide → event visible)
 *    21.  approvals.decide surfaces ErrorApprovalNotFound as RPC error
 *
 * Uses a deterministic FakeClock (QB #12 — no wall-clock dependence) so TTL
 * windows are reliable on clean CI.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ApprovalQueue,
  ErrorApprovalNotFound,
  ErrorAlreadyDecided,
  ErrorExpired,
  ErrorInvalidPayload,
  type ApprovalPayload,
} from "../../src/session/approval-queue.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";
import type { UnifiedEvent } from "../../src/channels/fan-out.js";

// ── Deterministic clock ────────────────────────────────────

class FakeClock {
  t = 1_000_000;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

// ── Queue-level tests ──────────────────────────────────────

describe("ApprovalQueue — F6 typed approval + subscription", () => {
  let clock: FakeClock;
  let queue: ApprovalQueue;
  let broadcasts: UnifiedEvent[];

  beforeEach(() => {
    clock = new FakeClock();
    broadcasts = [];
    queue = new ApprovalQueue({
      now: clock.now.bind(clock),
      broadcast: (ev) => {
        broadcasts.push(ev);
      },
    });
  });

  // 1. enqueue + basic retrieval
  it("enqueue stores a pending approval visible via pending()", () => {
    const payload: ApprovalPayload = {
      kind: "shell-exec",
      command: "rm -rf /tmp/foo",
      cwd: "/tmp",
    };
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload,
      summary: "delete temp",
      riskLevel: "medium",
      ttlMs: 60_000,
    });
    expect(record.approvalId).toMatch(/^ap-/);
    expect(record.sessionId).toBe("cs-1");
    expect(record.state).toBe("pending");
    expect(record.payload).toEqual(payload);
    expect(record.expiresAt).toBe(clock.now() + 60_000);

    const list = queue.pending();
    expect(list).toHaveLength(1);
    expect(list[0]?.approvalId).toBe(record.approvalId);
  });

  // 2. per-session filtering
  it("pendingForSession returns only that session's approvals", () => {
    queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "ls", cwd: "/" },
      summary: "ls",
      riskLevel: "low",
    });
    queue.enqueue({
      sessionId: "cs-2",
      payload: { kind: "shell-exec", command: "pwd", cwd: "/" },
      summary: "pwd",
      riskLevel: "low",
    });
    const s1 = queue.pendingForSession("cs-1");
    const s2 = queue.pendingForSession("cs-2");
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect(s1[0]?.sessionId).toBe("cs-1");
    expect(s2[0]?.sessionId).toBe("cs-2");
  });

  // 3. decide emits decided event + removes from pending
  it("decide resolves pending approval and emits decided event", () => {
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "whoami", cwd: "/" },
      summary: "whoami",
      riskLevel: "low",
    });
    const events: Array<{ type: string; approvalId: string; decision?: string }> = [];
    queue.subscribe((ev) => {
      events.push({ type: ev.type, approvalId: ev.approvalId, decision: ev.decision });
    });
    const decided = queue.decide({
      approvalId: record.approvalId,
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(decided.state).toBe("decided");
    expect(decided.decision).toBe("allow");
    expect(decided.deciderDeviceId).toBe("phone-1");
    expect(decided.decidedAt).toBe(clock.now());

    // pending list no longer contains it
    expect(queue.pending()).toHaveLength(0);

    // subscriber saw the decided event
    expect(events.map((e) => e.type)).toContain("decided");
    const decidedEv = events.find((e) => e.type === "decided");
    expect(decidedEv?.approvalId).toBe(record.approvalId);
    expect(decidedEv?.decision).toBe("allow");
  });

  // 4. TTL auto-expire
  it("TTL expiration marks approval as expired with decision=deny", () => {
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "sleep", cwd: "/" },
      summary: "sleep",
      riskLevel: "low",
      ttlMs: 5_000,
    });
    // Before expiry: still pending
    clock.advance(4_999);
    expect(queue.sweepExpired()).toHaveLength(0);
    expect(queue.pending()).toHaveLength(1);

    // After expiry: sweep returns the expired record, state=expired,
    // decision auto-set to deny so callers that poll see a terminal
    // resolution with clear semantics.
    clock.advance(2);
    const swept = queue.sweepExpired();
    expect(swept).toHaveLength(1);
    expect(swept[0]?.approvalId).toBe(record.approvalId);
    expect(swept[0]?.state).toBe("expired");
    expect(swept[0]?.decision).toBe("deny");
    expect(queue.pending()).toHaveLength(0);
  });

  // 5. subscribe receives enqueue + decide events
  it("subscribe emits events for enqueue and decide", () => {
    const types: string[] = [];
    queue.subscribe((ev) => {
      types.push(ev.type);
    });
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "ls", cwd: "/" },
      summary: "ls",
      riskLevel: "low",
    });
    queue.decide({
      approvalId: record.approvalId,
      decision: "deny",
      deciderDeviceId: "phone-1",
    });
    expect(types).toEqual(["enqueued", "decided"]);
  });

  // 6. shell-exec validation
  it("shell-exec payload without command → ErrorInvalidPayload", () => {
    expect(() =>
      queue.enqueue({
        sessionId: "cs-1",
        payload: { kind: "shell-exec", command: "", cwd: "/" },
        summary: "bad",
        riskLevel: "low",
      }),
    ).toThrow(ErrorInvalidPayload);
  });

  // 7. file-write validation
  it("file-write payload without path → ErrorInvalidPayload", () => {
    expect(() =>
      queue.enqueue({
        sessionId: "cs-1",
        payload: { kind: "file-write", path: "", preview: "hi" },
        summary: "bad",
        riskLevel: "low",
      }),
    ).toThrow(ErrorInvalidPayload);
  });

  // 8. destructive validation
  it("destructive payload missing operation/target/reason → ErrorInvalidPayload", () => {
    expect(() =>
      queue.enqueue({
        sessionId: "cs-1",
        payload: { kind: "destructive", operation: "", target: "x", reason: "y" },
        summary: "bad",
        riskLevel: "high",
      }),
    ).toThrow(ErrorInvalidPayload);
    expect(() =>
      queue.enqueue({
        sessionId: "cs-1",
        payload: { kind: "destructive", operation: "drop", target: "", reason: "y" },
        summary: "bad",
        riskLevel: "high",
      }),
    ).toThrow(ErrorInvalidPayload);
    expect(() =>
      queue.enqueue({
        sessionId: "cs-1",
        payload: { kind: "destructive", operation: "drop", target: "db", reason: "" },
        summary: "bad",
        riskLevel: "high",
      }),
    ).toThrow(ErrorInvalidPayload);
  });

  // 9. custom validation
  it("custom payload missing schemaId → ErrorInvalidPayload", () => {
    expect(() =>
      queue.enqueue({
        sessionId: "cs-1",
        payload: { kind: "custom", schemaId: "", data: {} },
        summary: "bad",
        riskLevel: "low",
      }),
    ).toThrow(ErrorInvalidPayload);
  });

  // 10. unknown approvalId
  it("decide unknown approvalId → ErrorApprovalNotFound", () => {
    expect(() =>
      queue.decide({
        approvalId: "ap-nonexistent",
        decision: "allow",
        deciderDeviceId: "phone-1",
      }),
    ).toThrow(ErrorApprovalNotFound);
  });

  // 11. already decided
  it("decide already-decided approvalId → ErrorAlreadyDecided", () => {
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "pwd", cwd: "/" },
      summary: "pwd",
      riskLevel: "low",
    });
    queue.decide({
      approvalId: record.approvalId,
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(() =>
      queue.decide({
        approvalId: record.approvalId,
        decision: "deny",
        deciderDeviceId: "phone-1",
      }),
    ).toThrow(ErrorAlreadyDecided);
  });

  // 12. decide after expiry
  it("decide after TTL expiry → ErrorExpired", () => {
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "uptime", cwd: "/" },
      summary: "uptime",
      riskLevel: "low",
      ttlMs: 1_000,
    });
    clock.advance(2_000);
    expect(() =>
      queue.decide({
        approvalId: record.approvalId,
        decision: "allow",
        deciderDeviceId: "phone-1",
      }),
    ).toThrow(ErrorExpired);
  });

  // 13. per-session isolation
  it("approvals from two sessions do not leak", () => {
    const r1 = queue.enqueue({
      sessionId: "cs-A",
      payload: { kind: "shell-exec", command: "ls", cwd: "/" },
      summary: "A",
      riskLevel: "low",
    });
    const r2 = queue.enqueue({
      sessionId: "cs-B",
      payload: { kind: "shell-exec", command: "ls", cwd: "/" },
      summary: "B",
      riskLevel: "low",
    });
    // Deciding A does NOT affect B
    queue.decide({
      approvalId: r1.approvalId,
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(queue.pendingForSession("cs-A")).toHaveLength(0);
    expect(queue.pendingForSession("cs-B")).toHaveLength(1);
    expect(queue.pendingForSession("cs-B")[0]?.approvalId).toBe(r2.approvalId);
  });

  // 14. broadcast on enqueue + decide
  it("broadcast fires on enqueue (approval-request) and decide (approval-decided)", () => {
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "ls", cwd: "/" },
      summary: "ls",
      riskLevel: "low",
    });
    queue.decide({
      approvalId: record.approvalId,
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]?.type).toBe("approval");
    expect((broadcasts[0]?.payload as Record<string, unknown>)["action"]).toBe("approval-request");
    expect(broadcasts[1]?.type).toBe("approval");
    expect((broadcasts[1]?.payload as Record<string, unknown>)["action"]).toBe("approval-decided");
  });

  // 15. broadcast on auto-expire
  it("broadcast fires on sweepExpired (approval-expired)", () => {
    queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "ls", cwd: "/" },
      summary: "ls",
      riskLevel: "low",
      ttlMs: 1_000,
    });
    broadcasts.length = 0; // clear enqueue broadcast
    clock.advance(2_000);
    queue.sweepExpired();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe("approval");
    expect((broadcasts[0]?.payload as Record<string, unknown>)["action"]).toBe("approval-expired");
  });

  // 16. file-write preview trimmed
  it("file-write preview is trimmed to 1 KiB", () => {
    const bigPreview = "x".repeat(2_000);
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "file-write", path: "/tmp/big.txt", preview: bigPreview },
      summary: "big",
      riskLevel: "low",
    });
    const payload = record.payload as ApprovalPayload & { kind: "file-write" };
    expect(payload.kind).toBe("file-write");
    expect(payload.preview.length).toBeLessThanOrEqual(1024);
  });

  // 17. pending() excludes decided approvals
  it("pending() returns pending only; decided records are excluded", () => {
    const r1 = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "a", cwd: "/" },
      summary: "a",
      riskLevel: "low",
    });
    queue.enqueue({
      sessionId: "cs-2",
      payload: { kind: "shell-exec", command: "b", cwd: "/" },
      summary: "b",
      riskLevel: "low",
    });
    expect(queue.pending()).toHaveLength(2);
    queue.decide({
      approvalId: r1.approvalId,
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(queue.pending()).toHaveLength(1);
  });
});

// ── RPC-level tests (end-to-end via KairosRPCHandler) ──────

describe("approvals.* RPC family (F6)", () => {
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

  // 18. empty pending
  it("approvals.pending returns empty list initially", async () => {
    const res = await call("approvals.pending", {});
    expect(res.error).toBeUndefined();
    const out = res.result as { pending: unknown[] };
    expect(out.pending).toEqual([]);
  });

  // 19. subscribe + poll drain
  it("approvals.subscribe seeds a subscription + poll drains events", async () => {
    // Seed an approval via the queue accessor
    const queue = handler.getApprovalQueue();
    const subscribeRes = await call("approvals.subscribe", {});
    expect(subscribeRes.error).toBeUndefined();
    const subOut = subscribeRes.result as { subscriptionId: string; events: unknown[] };
    expect(subOut.subscriptionId).toMatch(/^aps-/);
    expect(subOut.events).toEqual([]);

    // Enqueue AFTER subscribing so the subscriber sees the event live
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "shell-exec", command: "pwd", cwd: "/" },
      summary: "pwd",
      riskLevel: "low",
    });

    // Poll drains the enqueued event
    const pollRes = await call("approvals.subscribe", {
      subscriptionId: subOut.subscriptionId,
    });
    expect(pollRes.error).toBeUndefined();
    const pollOut = pollRes.result as {
      events: Array<{ type: string; approvalId: string }>;
    };
    expect(pollOut.events).toHaveLength(1);
    expect(pollOut.events[0]?.type).toBe("enqueued");
    expect(pollOut.events[0]?.approvalId).toBe(record.approvalId);
  });

  // 20. full cycle: enqueue → pending → decide
  it("approvals.decide full cycle resolves + surfaces via pending", async () => {
    const queue = handler.getApprovalQueue();
    const record = queue.enqueue({
      sessionId: "cs-1",
      payload: { kind: "destructive", operation: "drop", target: "prod_db", reason: "cleanup" },
      summary: "drop prod",
      riskLevel: "high",
    });

    // pending reflects it
    const pendRes = await call("approvals.pending", {});
    const pendOut = pendRes.result as { pending: Array<{ approvalId: string }> };
    expect(pendOut.pending).toHaveLength(1);
    expect(pendOut.pending[0]?.approvalId).toBe(record.approvalId);

    // decide
    const decideRes = await call("approvals.decide", {
      approvalId: record.approvalId,
      decision: "deny",
      deciderDeviceId: "phone-1",
    });
    expect(decideRes.error).toBeUndefined();
    const decideOut = decideRes.result as { approval: { state: string; decision: string } };
    expect(decideOut.approval.state).toBe("decided");
    expect(decideOut.approval.decision).toBe("deny");

    // pending now empty
    const pendRes2 = await call("approvals.pending", {});
    const pendOut2 = pendRes2.result as { pending: unknown[] };
    expect(pendOut2.pending).toHaveLength(0);
  });

  // 21. unknown approvalId surfaces as JSON-RPC error
  it("approvals.decide surfaces ErrorApprovalNotFound as RPC error", async () => {
    const res = await call("approvals.decide", {
      approvalId: "ap-nope",
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/not found/i);
  });
});
