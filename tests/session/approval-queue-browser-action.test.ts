/**
 * T10.4 — BrowserActionPayload variant tests for the approval queue.
 *
 * Covers:
 *  1.  createBrowserActionPayload returns the correct tagged shape
 *  2.  createBrowserActionPayload defaults createdAt to Date.now() when absent
 *  3.  createBrowserActionPayload respects caller-supplied createdAt
 *  4.  Enqueueing a BrowserActionPayload fires the subscribe callback with
 *      type=enqueued and the original payload preserved on the record
 *  5.  Broadcast fires an approval-request UnifiedEvent carrying the payload
 *  6.  Approve transitions the record state to "decided" + decision=allow
 *  7.  Deny transitions the record state to "decided" + decision=deny
 *  8.  Subscribers receive a decided event after decide()
 *  9.  riskLevel="high" flows through the queue + broadcast unchanged
 * 10.  Malformed browser-action payload (missing actionId) throws
 *      ErrorInvalidPayload at validatePayload
 * 11.  Malformed browser-action payload (missing url) throws
 *      ErrorInvalidPayload
 * 12.  Malformed browser-action payload (wrong type discriminator) throws
 *      ErrorInvalidPayload
 * 13.  pendingForSession surfaces the browser-action record and leaves
 *      other sessions unaffected
 *
 * Uses a deterministic FakeClock (QB #12) so TTL windows are reliable.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ApprovalQueue,
  ErrorInvalidPayload,
  createBrowserActionPayload,
  type ApprovalEvent,
  type ApprovalPayload,
  type BrowserActionPayload,
} from "../../src/session/approval-queue.js";
import type { UnifiedEvent } from "../../src/channels/fan-out.js";

// ── Deterministic clock ────────────────────────────────────

class FakeClock {
  t = 2_000_000;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

// ── Helpers ───────────────────────────────────────────────

function samplePayload(
  overrides: Partial<Omit<BrowserActionPayload, "kind" | "type">> = {},
): BrowserActionPayload {
  return createBrowserActionPayload({
    actionId: overrides.actionId ?? "step-1",
    url: overrides.url ?? "https://example.com/doc",
    description: overrides.description ?? "Click continue button",
    riskLevel: overrides.riskLevel ?? "medium",
    createdAt: overrides.createdAt ?? 2_000_000,
  });
}

// ── 1–3. createBrowserActionPayload ───────────────────────

describe("createBrowserActionPayload — factory", () => {
  it("returns a correctly-tagged BrowserActionPayload", () => {
    const p = samplePayload();
    expect(p.kind).toBe("browser-action");
    expect(p.type).toBe("browser.action");
    expect(p.actionId).toBe("step-1");
    expect(p.url).toBe("https://example.com/doc");
    expect(p.description).toBe("Click continue button");
    expect(p.riskLevel).toBe("medium");
    expect(p.createdAt).toBe(2_000_000);
  });

  it("defaults createdAt to Date.now() when caller omits it", () => {
    const before = Date.now();
    const p = createBrowserActionPayload({
      actionId: "a",
      url: "https://x.com",
      description: "",
      riskLevel: "low",
    });
    const after = Date.now();
    expect(p.createdAt).toBeGreaterThanOrEqual(before);
    expect(p.createdAt).toBeLessThanOrEqual(after);
  });

  it("respects a caller-supplied createdAt", () => {
    const p = createBrowserActionPayload({
      actionId: "a",
      url: "https://x.com",
      description: "",
      riskLevel: "low",
      createdAt: 42,
    });
    expect(p.createdAt).toBe(42);
  });
});

// ── 4–9. Queue behavior ───────────────────────────────────

describe("ApprovalQueue — BrowserActionPayload variant", () => {
  let clock: FakeClock;
  let queue: ApprovalQueue;
  let broadcasts: UnifiedEvent[];
  let events: ApprovalEvent[];

  beforeEach(() => {
    clock = new FakeClock();
    broadcasts = [];
    events = [];
    queue = new ApprovalQueue({
      now: clock.now.bind(clock),
      broadcast: (ev) => {
        broadcasts.push(ev);
      },
    });
    queue.subscribe((ev) => events.push(ev));
  });

  it("enqueue fires onEnqueue callback with the browser-action payload", () => {
    const payload = samplePayload();
    const rec = queue.enqueue({
      sessionId: "s1",
      payload,
      summary: "review nav",
      riskLevel: "medium",
    });
    expect(rec.payload.kind).toBe("browser-action");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("enqueued");
    expect(events[0]?.record.payload).toEqual(payload);
  });

  it("broadcast fires approval-request with payload surfaced", () => {
    const payload = samplePayload();
    queue.enqueue({
      sessionId: "s1",
      payload,
      summary: "review",
      riskLevel: "medium",
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe("approval");
    const body = broadcasts[0]?.payload as Record<string, unknown>;
    expect(body["action"]).toBe("approval-request");
    expect(body["payload"]).toEqual(payload);
  });

  it("approve transitions state to decided + decision=allow", () => {
    const rec = queue.enqueue({
      sessionId: "s1",
      payload: samplePayload(),
      summary: "review",
      riskLevel: "medium",
    });
    const decided = queue.decide({
      approvalId: rec.approvalId,
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(decided.state).toBe("decided");
    expect(decided.decision).toBe("allow");
    expect(decided.payload.kind).toBe("browser-action");
  });

  it("deny transitions state to decided + decision=deny", () => {
    const rec = queue.enqueue({
      sessionId: "s1",
      payload: samplePayload(),
      summary: "review",
      riskLevel: "medium",
    });
    const decided = queue.decide({
      approvalId: rec.approvalId,
      decision: "deny",
      deciderDeviceId: "phone-1",
    });
    expect(decided.state).toBe("decided");
    expect(decided.decision).toBe("deny");
  });

  it("subscribers see a decided event after decide()", () => {
    const rec = queue.enqueue({
      sessionId: "s1",
      payload: samplePayload(),
      summary: "review",
      riskLevel: "medium",
    });
    queue.decide({
      approvalId: rec.approvalId,
      decision: "allow",
      deciderDeviceId: "phone-1",
    });
    expect(events.map((e) => e.type)).toEqual(["enqueued", "decided"]);
  });

  it("riskLevel='high' is preserved through enqueue + broadcast (mandatory-approval marker)", () => {
    const payload = samplePayload({ riskLevel: "high" });
    const rec = queue.enqueue({
      sessionId: "s1",
      payload,
      summary: "review",
      riskLevel: "high",
    });
    expect(rec.riskLevel).toBe("high");
    const body = broadcasts[0]?.payload as Record<string, unknown>;
    expect(body["riskLevel"]).toBe("high");
    // The underlying payload also carries the risk tag for surfaces that
    // render from payload alone.
    expect(rec.payload.kind).toBe("browser-action");
    expect((rec.payload as BrowserActionPayload).riskLevel).toBe("high");
  });
});

// ── 10–12. Invalid-payload guardrails ─────────────────────

describe("ApprovalQueue — BrowserActionPayload validation", () => {
  let queue: ApprovalQueue;

  beforeEach(() => {
    queue = new ApprovalQueue();
  });

  it("missing actionId → ErrorInvalidPayload", () => {
    const bad: ApprovalPayload = {
      kind: "browser-action",
      type: "browser.action",
      actionId: "",
      url: "https://x.com",
      description: "desc",
      riskLevel: "medium",
      createdAt: 1,
    };
    expect(() =>
      queue.enqueue({
        sessionId: "s1",
        payload: bad,
        summary: "x",
        riskLevel: "medium",
      }),
    ).toThrow(ErrorInvalidPayload);
  });

  it("missing url → ErrorInvalidPayload", () => {
    const bad: ApprovalPayload = {
      kind: "browser-action",
      type: "browser.action",
      actionId: "a",
      url: "",
      description: "desc",
      riskLevel: "medium",
      createdAt: 1,
    };
    expect(() =>
      queue.enqueue({
        sessionId: "s1",
        payload: bad,
        summary: "x",
        riskLevel: "medium",
      }),
    ).toThrow(ErrorInvalidPayload);
  });

  it("wrong type discriminator → ErrorInvalidPayload", () => {
    // The type field is load-bearing — anything other than "browser.action"
    // breaks the downstream cross-surface contract.
    const bad = {
      kind: "browser-action",
      type: "browser.wrong",
      actionId: "a",
      url: "https://x.com",
      description: "desc",
      riskLevel: "medium",
      createdAt: 1,
    } as unknown as ApprovalPayload;
    expect(() =>
      queue.enqueue({
        sessionId: "s1",
        payload: bad,
        summary: "x",
        riskLevel: "medium",
      }),
    ).toThrow(ErrorInvalidPayload);
  });
});

// ── 13. Session isolation ────────────────────────────────

describe("ApprovalQueue — BrowserActionPayload session isolation", () => {
  it("pendingForSession returns the browser-action record for the right session", () => {
    const queue = new ApprovalQueue();
    queue.enqueue({
      sessionId: "s1",
      payload: samplePayload({ actionId: "a1" }),
      summary: "first",
      riskLevel: "medium",
    });
    queue.enqueue({
      sessionId: "s2",
      payload: samplePayload({ actionId: "a2" }),
      summary: "second",
      riskLevel: "medium",
    });
    const s1 = queue.pendingForSession("s1");
    const s2 = queue.pendingForSession("s2");
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect((s1[0]?.payload as BrowserActionPayload).actionId).toBe("a1");
    expect((s2[0]?.payload as BrowserActionPayload).actionId).toBe("a2");
  });
});
