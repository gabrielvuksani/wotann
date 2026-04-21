/**
 * Phase 3 P1-F9 — File-delivery pipeline tests.
 *
 * Per MASTER_PLAN_V8 §5 P1-F9, F5 writes bytes to disk, F7 serves them on
 * pull, and F9 adds the push layer: when a creation is finalized, the
 * daemon mints a short-lived opaque download token and fans out a
 * `delivery-ready` notification to every registered surface.
 *
 * Tests exercise:
 *
 *   Queue-level (FileDelivery):
 *     1. notify adds a pending delivery visible via pending()
 *     2. notify emits a `delivery-ready` UnifiedEvent via broadcast
 *     3. notify fires a `notified` event on the internal subscriber bus
 *     4. pending() and pendingForSession filter correctly
 *     5. acknowledge updates state + records the device
 *     6. acknowledge emits `delivery-acknowledged` UnifiedEvent
 *     7. acknowledge is idempotent for duplicate deviceId
 *     8. multiple surfaces (distinct deviceIds) all recorded
 *     9. TTL expiration: sweepExpired transitions expired, fires event
 *    10. unknown deliveryId → ErrorDeliveryNotFound
 *    11. acknowledge after TTL → ErrorDeliveryExpired
 *    12. notify with missing creation (via creationExists hook) → ErrorCreationMissing
 *    13. per-session isolation (two sessions don't leak)
 *    14. download token is URL-safe base64 of min length
 *    15. token lookupByToken returns the record
 *    16. token shape validation (isValidTokenShape)
 *    17. notify with caller-supplied token honours the override
 *    18. finalize integration: CreationsStore.finalize → FileDelivery.notify
 *    19. concurrent notify + acknowledge safe (in-memory map)
 *    20. subscribe emits on notify + acknowledge + expire
 *
 *   RPC-level (via KairosRPCHandler):
 *    21. delivery.pending returns empty list initially
 *    22. delivery.notify round-trip surfaces a delivery record
 *    23. delivery.pending returns the notified delivery
 *    24. delivery.acknowledge marks and returns updated record
 *    25. delivery.acknowledge unknown id surfaces ErrorDeliveryNotFound
 *    26. delivery.subscribe seeds + poll drains events
 *
 * Uses a deterministic FakeClock (QB #12 — no wall-clock dependence) so
 * TTL windows are reliable on clean CI.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileDelivery,
  ErrorDeliveryNotFound,
  ErrorDeliveryExpired,
  ErrorCreationMissing,
  ErrorInvalidToken,
  ErrorInvalidPayload,
  isValidTokenShape,
  fingerprintToken,
  type DeliveryEvent,
} from "../../src/session/file-delivery.js";
import { CreationsStore } from "../../src/session/creations.js";
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

describe("FileDelivery — F9 push-to-surface pipeline", () => {
  let clock: FakeClock;
  let delivery: FileDelivery;
  let broadcasts: UnifiedEvent[];

  beforeEach(() => {
    clock = new FakeClock();
    broadcasts = [];
    delivery = new FileDelivery({
      now: clock.now.bind(clock),
      broadcast: (ev) => {
        broadcasts.push(ev);
      },
    });
  });

  // 1. notify adds a pending delivery
  it("notify stores a pending delivery visible via pending()", () => {
    const record = delivery.notify({
      sessionId: "cs-1",
      filename: "report.pdf",
    });
    expect(record.deliveryId).toMatch(/^dl-/);
    expect(record.sessionId).toBe("cs-1");
    expect(record.filename).toBe("report.pdf");
    expect(record.displayName).toBe("report.pdf"); // defaulted
    expect(record.state).toBe("pending");
    expect(record.acknowledgements).toHaveLength(0);
    expect(record.expiresAt).toBeGreaterThan(clock.now());

    const pending = delivery.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.deliveryId).toBe(record.deliveryId);
  });

  // 2. notify fires a delivery-ready UnifiedEvent via broadcast
  it("notify emits a delivery-ready UnifiedEvent via broadcast", () => {
    delivery.notify({
      sessionId: "cs-1",
      filename: "r.pdf",
      displayName: "Quarterly Report",
      description: "Q1 finance summary",
    });
    expect(broadcasts).toHaveLength(1);
    const ev = broadcasts[0]!;
    expect(ev.type).toBe("message"); // F9 rides on message type (fan-out union closed)
    expect(ev.payload["action"]).toBe("delivery-ready");
    expect(ev.payload["sessionId"]).toBe("cs-1");
    expect(ev.payload["filename"]).toBe("r.pdf");
    expect(ev.payload["displayName"]).toBe("Quarterly Report");
    expect(ev.payload["description"]).toBe("Q1 finance summary");
    expect(typeof ev.payload["downloadToken"]).toBe("string");
    expect(typeof ev.payload["expiresAt"]).toBe("number");
  });

  // 3. notify fires a `notified` event on the internal subscriber bus
  it("notify fires a `notified` event on the internal subscriber bus", () => {
    const received: DeliveryEvent[] = [];
    delivery.subscribe((ev) => received.push(ev));
    const record = delivery.notify({ sessionId: "cs-1", filename: "x.md" });
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("notified");
    expect(received[0]?.deliveryId).toBe(record.deliveryId);
  });

  // 4. pending() and pendingForSession filter correctly
  it("pendingForSession returns only that session's deliveries", () => {
    delivery.notify({ sessionId: "cs-1", filename: "a.md" });
    delivery.notify({ sessionId: "cs-1", filename: "b.md" });
    delivery.notify({ sessionId: "cs-2", filename: "c.md" });
    expect(delivery.pending()).toHaveLength(3);
    expect(delivery.pendingForSession("cs-1")).toHaveLength(2);
    expect(delivery.pendingForSession("cs-2")).toHaveLength(1);
    expect(delivery.pendingForSession("cs-missing")).toHaveLength(0);
  });

  // 5. acknowledge updates state + records the device
  it("acknowledge transitions state and records the device", () => {
    const record = delivery.notify({ sessionId: "cs-1", filename: "x.md" });
    clock.advance(500);
    const updated = delivery.acknowledge({
      deliveryId: record.deliveryId,
      deviceId: "phone-1",
    });
    expect(updated.state).toBe("acknowledged");
    expect(updated.acknowledgements).toHaveLength(1);
    expect(updated.acknowledgements[0]?.deviceId).toBe("phone-1");
    expect(updated.acknowledgements[0]?.acknowledgedAt).toBe(clock.now());
  });

  // 6. acknowledge emits delivery-acknowledged UnifiedEvent
  it("acknowledge fires a delivery-acknowledged UnifiedEvent", () => {
    const record = delivery.notify({ sessionId: "cs-1", filename: "x.md" });
    broadcasts.length = 0; // clear notify's event
    delivery.acknowledge({ deliveryId: record.deliveryId, deviceId: "desk-1" });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe("message");
    expect(broadcasts[0]?.payload["action"]).toBe("delivery-acknowledged");
    expect(broadcasts[0]?.payload["deliveryId"]).toBe(record.deliveryId);
    expect(broadcasts[0]?.payload["deviceId"]).toBe("desk-1");
    expect(broadcasts[0]?.payload["acknowledgementCount"]).toBe(1);
  });

  // 7. acknowledge is idempotent for duplicate deviceId
  it("duplicate acknowledge from the same deviceId is a no-op", () => {
    const record = delivery.notify({ sessionId: "cs-1", filename: "x.md" });
    delivery.acknowledge({ deliveryId: record.deliveryId, deviceId: "phone-1" });
    broadcasts.length = 0;
    const second = delivery.acknowledge({
      deliveryId: record.deliveryId,
      deviceId: "phone-1",
    });
    expect(second.acknowledgements).toHaveLength(1);
    // No additional broadcast on duplicate — the idempotent return path.
    expect(broadcasts).toHaveLength(0);
  });

  // 8. multiple distinct devices all recorded
  it("multiple surfaces independently acknowledge the same delivery", () => {
    const record = delivery.notify({ sessionId: "cs-1", filename: "x.md" });
    delivery.acknowledge({ deliveryId: record.deliveryId, deviceId: "phone-1" });
    delivery.acknowledge({ deliveryId: record.deliveryId, deviceId: "desk-1" });
    const after = delivery.acknowledge({
      deliveryId: record.deliveryId,
      deviceId: "watch-1",
    });
    expect(after.acknowledgements.map((a) => a.deviceId).sort()).toEqual([
      "desk-1",
      "phone-1",
      "watch-1",
    ]);
    // Broadcast fires for each non-dup ack (plus the initial notify).
    const ackEvents = broadcasts.filter(
      (b) => b.payload["action"] === "delivery-acknowledged",
    );
    expect(ackEvents).toHaveLength(3);
  });

  // 9. TTL expiration + sweep event
  it("TTL expiration: sweepExpired transitions expired and emits event", () => {
    const record = delivery.notify({
      sessionId: "cs-1",
      filename: "x.md",
      expiresInSec: 5, // 5 seconds
    });
    clock.advance(4_999);
    expect(delivery.sweepExpired()).toHaveLength(0);
    expect(delivery.pending()).toHaveLength(1);

    clock.advance(2);
    broadcasts.length = 0;
    const swept = delivery.sweepExpired();
    expect(swept).toHaveLength(1);
    expect(swept[0]?.deliveryId).toBe(record.deliveryId);
    expect(swept[0]?.state).toBe("expired");
    // pending() excludes expired
    expect(delivery.pending()).toHaveLength(0);
    // expiry broadcast fired
    const expiryEv = broadcasts.find((b) => b.payload["action"] === "delivery-expired");
    expect(expiryEv).toBeDefined();
    expect(expiryEv?.payload["deliveryId"]).toBe(record.deliveryId);
  });

  // 10. unknown deliveryId → ErrorDeliveryNotFound
  it("acknowledge unknown deliveryId throws ErrorDeliveryNotFound", () => {
    expect(() =>
      delivery.acknowledge({ deliveryId: "dl-nope", deviceId: "phone-1" }),
    ).toThrow(ErrorDeliveryNotFound);
  });

  // 11. acknowledge after TTL → ErrorDeliveryExpired
  it("acknowledge after TTL expiry throws ErrorDeliveryExpired", () => {
    const record = delivery.notify({
      sessionId: "cs-1",
      filename: "x.md",
      expiresInSec: 1,
    });
    clock.advance(2_000);
    expect(() =>
      delivery.acknowledge({ deliveryId: record.deliveryId, deviceId: "phone-1" }),
    ).toThrow(ErrorDeliveryExpired);
  });

  // 12. notify with missing creation → ErrorCreationMissing
  it("notify with creationExists hook raises ErrorCreationMissing for ghosts", () => {
    const del = new FileDelivery({
      now: clock.now.bind(clock),
      creationExists: () => false,
    });
    expect(() => del.notify({ sessionId: "cs-1", filename: "ghost.md" })).toThrow(
      ErrorCreationMissing,
    );
  });

  // 13. per-session isolation — sessions do not leak
  it("per-session isolation — two sessions' deliveries don't cross", () => {
    const a = delivery.notify({ sessionId: "cs-1", filename: "a.md" });
    const b = delivery.notify({ sessionId: "cs-2", filename: "b.md" });
    const s1 = delivery.pendingForSession("cs-1");
    const s2 = delivery.pendingForSession("cs-2");
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect(s1[0]?.deliveryId).toBe(a.deliveryId);
    expect(s2[0]?.deliveryId).toBe(b.deliveryId);
  });

  // 14. download token is URL-safe base64 and minimum length
  it("download token is URL-safe base64 and at least 16 chars", () => {
    const record = delivery.notify({ sessionId: "cs-1", filename: "x.md" });
    const tok = record.downloadToken.value;
    expect(tok.length).toBeGreaterThanOrEqual(16);
    // Only [A-Za-z0-9_-]
    expect(/^[A-Za-z0-9_-]+$/.test(tok)).toBe(true);
    // No + / = (URL-safety assertion)
    expect(tok).not.toContain("+");
    expect(tok).not.toContain("/");
    expect(tok).not.toContain("=");
    // fingerprint helper is 12 hex chars
    expect(fingerprintToken(tok)).toMatch(/^[0-9a-f]{12}$/);
  });

  // 15. lookupByToken returns the record
  it("lookupByToken resolves to the delivery record", () => {
    const record = delivery.notify({ sessionId: "cs-1", filename: "x.md" });
    const found = delivery.lookupByToken(record.downloadToken.value);
    expect(found?.deliveryId).toBe(record.deliveryId);
    // Unknown / bogus token
    expect(delivery.lookupByToken("not_a_real_token_value_xxx")).toBeNull();
    // After TTL, lookup returns null
    clock.advance(2 * 60 * 60_000);
    expect(delivery.lookupByToken(record.downloadToken.value)).toBeNull();
  });

  // 16. token shape validation
  it("isValidTokenShape accepts good tokens and rejects obvious garbage", () => {
    expect(isValidTokenShape("abcdefghij0123456789")).toBe(true);
    expect(isValidTokenShape("short")).toBe(false);
    expect(isValidTokenShape("")).toBe(false);
    expect(isValidTokenShape("contains whitespace here")).toBe(false);
    expect(isValidTokenShape("contains!invalidchars")).toBe(false);
    expect(isValidTokenShape("a".repeat(300))).toBe(false); // too long
    expect(isValidTokenShape(null)).toBe(false);
    expect(isValidTokenShape(undefined)).toBe(false);
    expect(isValidTokenShape(12345)).toBe(false);
  });

  // 17. caller-supplied token honoured
  it("notify honours caller-supplied downloadToken when valid", () => {
    const fixed = "fixedtoken0123456789abc-";
    const record = delivery.notify({
      sessionId: "cs-1",
      filename: "x.md",
      downloadToken: fixed,
    });
    expect(record.downloadToken.value).toBe(fixed);
    // bad shape — rejected
    expect(() =>
      delivery.notify({
        sessionId: "cs-1",
        filename: "y.md",
        downloadToken: "short",
      }),
    ).toThrow(ErrorInvalidToken);
  });

  // 18. finalize integration
  it("finalize integration: CreationsStore.finalize → FileDelivery.notify fires", () => {
    const root = mkdtempSync(join(tmpdir(), "wotann-f9-finalize-"));
    try {
      const notifyCalls: Array<{ sessionId: string; filename: string }> = [];
      const store = new CreationsStore({
        rootDir: root,
        finalizeHook: (p) => {
          notifyCalls.push({ sessionId: p.sessionId, filename: p.filename });
          return delivery.notify({
            sessionId: p.sessionId,
            filename: p.filename,
            displayName: p.displayName,
            description: p.description,
            expiresInSec: p.expiresInSec,
          });
        },
      });
      store.save({ sessionId: "cs-final", filename: "out.md", content: "hello" });
      const result = store.finalize({
        sessionId: "cs-final",
        filename: "out.md",
        displayName: "Output",
      });
      // The hook ran exactly once with the expected args.
      expect(notifyCalls).toEqual([{ sessionId: "cs-final", filename: "out.md" }]);
      // The hook's return value flows back to the caller.
      expect(result).not.toBeNull();
      // The delivery is now pending.
      expect(delivery.pendingForSession("cs-final")).toHaveLength(1);
      // And a delivery-ready UnifiedEvent fired.
      const readyEv = broadcasts.find(
        (b) => b.payload["action"] === "delivery-ready",
      );
      expect(readyEv).toBeDefined();
      expect(readyEv?.payload["filename"]).toBe("out.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // 19. concurrent notify + acknowledge safe
  it("concurrent notify + acknowledge interleaved remain consistent", async () => {
    const records = await Promise.all(
      Array.from({ length: 16 }).map((_, i) =>
        Promise.resolve().then(() =>
          delivery.notify({ sessionId: `cs-${i % 4}`, filename: `f-${i}.md` }),
        ),
      ),
    );
    expect(records).toHaveLength(16);
    // Acknowledge half of them, interleaved — should not throw, should
    // leave a consistent map of acknowledgement counts.
    await Promise.all(
      records.slice(0, 8).map((r) =>
        Promise.resolve().then(() =>
          delivery.acknowledge({ deliveryId: r.deliveryId, deviceId: "phone-1" }),
        ),
      ),
    );
    // Size matches total notifies (none pruned yet — clock didn't advance).
    expect(delivery.size()).toBe(16);
    // 8 records acknowledged, 8 still pending — both visible in pending()
    // because it includes both states (only excludes expired).
    expect(delivery.pending()).toHaveLength(16);
    const acked = delivery.pending().filter((r) => r.state === "acknowledged");
    expect(acked).toHaveLength(8);
  });

  // 20. subscribe emits on notify, acknowledge, and expire
  it("subscribe sees notified, acknowledged, and expired events", () => {
    const seen: string[] = [];
    delivery.subscribe((ev) => seen.push(ev.type));
    const r = delivery.notify({
      sessionId: "cs-1",
      filename: "x.md",
      expiresInSec: 1,
    });
    delivery.acknowledge({ deliveryId: r.deliveryId, deviceId: "phone-1" });
    clock.advance(2_000);
    delivery.sweepExpired();
    expect(seen).toEqual(["notified", "acknowledged", "expired"]);
  });

  // Param validation — payload errors
  it("notify rejects empty sessionId / filename with ErrorInvalidPayload", () => {
    expect(() => delivery.notify({ sessionId: "", filename: "x.md" })).toThrow(
      ErrorInvalidPayload,
    );
    expect(() => delivery.notify({ sessionId: "cs-1", filename: "" })).toThrow(
      ErrorInvalidPayload,
    );
  });
});

// ── RPC-level tests (end-to-end via KairosRPCHandler) ──────

describe("delivery.* RPC family (F9)", () => {
  let handler: KairosRPCHandler;
  let nextId = 1;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
  });

  afterEach(() => {
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

  // 21. empty pending
  it("delivery.pending returns empty list initially", async () => {
    const res = await call("delivery.pending", {});
    expect(res.error).toBeUndefined();
    const out = res.result as { pending: unknown[] };
    expect(out.pending).toEqual([]);
  });

  // 22. notify round-trip
  it("delivery.notify surfaces a delivery record over the wire", async () => {
    const res = await call("delivery.notify", {
      sessionId: "cs-rpc",
      filename: "out.md",
      displayName: "Output",
    });
    expect(res.error).toBeUndefined();
    const out = res.result as {
      delivery: {
        deliveryId: string;
        sessionId: string;
        filename: string;
        displayName: string;
        state: string;
        downloadToken: string;
      };
    };
    expect(out.delivery.deliveryId).toMatch(/^dl-/);
    expect(out.delivery.sessionId).toBe("cs-rpc");
    expect(out.delivery.filename).toBe("out.md");
    expect(out.delivery.displayName).toBe("Output");
    expect(out.delivery.state).toBe("pending");
    expect(out.delivery.downloadToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // 23. pending after notify
  it("delivery.pending returns the notified delivery", async () => {
    await call("delivery.notify", { sessionId: "cs-r", filename: "a.md" });
    await call("delivery.notify", { sessionId: "cs-r", filename: "b.md" });
    const res = await call("delivery.pending", { sessionId: "cs-r" });
    expect(res.error).toBeUndefined();
    const out = res.result as {
      pending: Array<{ filename: string; state: string }>;
    };
    expect(out.pending.map((p) => p.filename).sort()).toEqual(["a.md", "b.md"]);
    expect(out.pending.every((p) => p.state === "pending")).toBe(true);
  });

  // 24. acknowledge round-trip
  it("delivery.acknowledge marks and returns the updated record", async () => {
    const notifyRes = await call("delivery.notify", {
      sessionId: "cs-ack",
      filename: "f.md",
    });
    const deliveryId = (notifyRes.result as { delivery: { deliveryId: string } })
      .delivery.deliveryId;
    const ackRes = await call("delivery.acknowledge", {
      deliveryId,
      deviceId: "phone-1",
    });
    expect(ackRes.error).toBeUndefined();
    const out = ackRes.result as {
      delivery: {
        deliveryId: string;
        state: string;
        acknowledgements: Array<{ deviceId: string }>;
      };
    };
    expect(out.delivery.deliveryId).toBe(deliveryId);
    expect(out.delivery.state).toBe("acknowledged");
    expect(out.delivery.acknowledgements).toHaveLength(1);
    expect(out.delivery.acknowledgements[0]?.deviceId).toBe("phone-1");
  });

  // 25. unknown deliveryId surfaces as JSON-RPC error
  it("delivery.acknowledge unknown id surfaces ErrorDeliveryNotFound", async () => {
    const res = await call("delivery.acknowledge", {
      deliveryId: "dl-nope",
      deviceId: "phone-1",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/not found/i);
  });

  // 26. subscribe + poll
  it("delivery.subscribe seeds a subscription and poll drains events", async () => {
    const del = handler.getFileDelivery();
    const subRes = await call("delivery.subscribe", {});
    expect(subRes.error).toBeUndefined();
    const subOut = subRes.result as { subscriptionId: string; events: unknown[] };
    expect(subOut.subscriptionId).toMatch(/^dls-/);
    expect(subOut.events).toEqual([]);

    // Seed a notify AFTER subscribing
    const record = del.notify({ sessionId: "cs-sub", filename: "z.md" });

    const pollRes = await call("delivery.subscribe", {
      subscriptionId: subOut.subscriptionId,
    });
    expect(pollRes.error).toBeUndefined();
    const pollOut = pollRes.result as {
      events: Array<{ type: string; deliveryId: string }>;
    };
    expect(pollOut.events).toHaveLength(1);
    expect(pollOut.events[0]?.type).toBe("notified");
    expect(pollOut.events[0]?.deliveryId).toBe(record.deliveryId);
  });
});
