/**
 * Tests for `src/connectors/connector-webhook-server.ts` — V9 T12.8
 * inbound webhook server with per-connector HMAC verification.
 *
 * Why these tests:
 *   - verifyHmacSignature — pure function. Tests both correct + wrong
 *     signatures + the optional `prefix` strip used by Stripe/GitHub.
 *   - Server lifecycle — start() must bind a port (we use port:0 so
 *     the OS picks a free one), stop() must release it cleanly.
 *   - Valid HMAC dispatch — POST /webhook with a correct sha256 hex
 *     signature and Content-Type: application/json must invoke the
 *     dispatcher with the parsed payload.
 *   - Wrong HMAC rejection — POST with a bogus signature returns 401
 *     and the dispatcher MUST NOT be called (verified via vi.fn).
 *   - Stats — counters accumulate across received/accepted/rejected
 *     calls so monitoring can surface a per-connector failure rate.
 *
 * Constraints:
 *   - All requests stay on 127.0.0.1; no public surface.
 *   - Each test starts/stops its own server in beforeEach/afterEach
 *     so port leaks across runs are impossible.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  createConnectorWebhookServer,
  verifyHmacSignature,
  type ConnectorSecret,
  type ConnectorWebhookServer,
  type EventDispatcher,
} from "../../src/connectors/connector-webhook-server.js";

describe("verifyHmacSignature", () => {
  it("returns true for the correct sha256 HMAC of the body", () => {
    const body = Buffer.from('{"hello":"world"}');
    const secret = "shared-secret-123";
    const sig = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyHmacSignature(body, secret, sig, undefined)).toBe(true);
  });

  it("returns false for a wrong signature of the same length", () => {
    const body = Buffer.from('{"hello":"world"}');
    const secret = "shared-secret-123";
    // Wrong digest of the same hex length (64 chars).
    const wrong = "0".repeat(64);

    expect(verifyHmacSignature(body, secret, wrong, undefined)).toBe(false);
  });

  it("strips the supplied prefix before comparing (e.g. 'sha256=')", () => {
    const body = Buffer.from('{"hi":1}');
    const secret = "k";
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    const withPrefix = `sha256=${digest}`;

    expect(verifyHmacSignature(body, secret, withPrefix, "sha256=")).toBe(true);
    // Without the prefix arg it should fail (the leading "sha256=" is non-hex).
    expect(verifyHmacSignature(body, secret, withPrefix, undefined)).toBe(false);
  });

  it("returns false for non-hex / odd-length signatures (defensive)", () => {
    const body = Buffer.from("payload");
    expect(verifyHmacSignature(body, "k", "not-hex!!", undefined)).toBe(false);
    expect(verifyHmacSignature(body, "k", "abc", undefined)).toBe(false); // odd length
  });

  it("returns false when the digest length doesn't match (length attack defense)", () => {
    const body = Buffer.from("p");
    // Valid hex, but wrong length (16 chars vs. 64-char sha256 hex).
    expect(verifyHmacSignature(body, "k", "aabbccddeeff0011", undefined)).toBe(false);
  });
});

describe("createConnectorWebhookServer — start/stop lifecycle", () => {
  let server: ConnectorWebhookServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("start() binds an OS-assigned port and stop() releases it", async () => {
    const dispatcher: EventDispatcher = vi.fn(async () => ({ accepted: true }));
    server = createConnectorWebhookServer({
      port: 0, // OS-assigned
      secrets: {},
      dispatcher,
    });

    const bound = await server.start();
    expect(bound.host).toBe("127.0.0.1");
    expect(bound.port).toBeGreaterThan(0);

    await server.stop();
    server = null; // mark stopped so afterEach doesn't double-stop
  });

  it("stop() on a never-started server resolves cleanly", async () => {
    server = createConnectorWebhookServer({
      port: 0,
      secrets: {},
      dispatcher: vi.fn(async () => ({ accepted: true })),
    });
    // Should not throw.
    await server.stop();
    server = null;
  });
});

describe("createConnectorWebhookServer — HMAC dispatch end-to-end", () => {
  let server: ConnectorWebhookServer;
  let dispatcher: ReturnType<typeof vi.fn>;
  let baseUrl: string;
  const secret: ConnectorSecret = {
    connectorId: "linear-prod",
    kind: "linear",
    secret: "super-secret-token",
    signatureHeader: "x-linear-signature",
  };

  beforeEach(async () => {
    dispatcher = vi.fn(async () => ({ accepted: true }));
    server = createConnectorWebhookServer({
      port: 0,
      secrets: { [secret.connectorId]: secret },
      dispatcher: dispatcher as unknown as EventDispatcher,
    });
    const bound = await server.start();
    baseUrl = `http://${bound.host}:${bound.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("POST /webhook/<connectorId> with valid HMAC dispatches the event", async () => {
    const body = JSON.stringify({ id: "evt-1", action: "create", data: { issue: 42 } });
    const signature = createHmac("sha256", secret.secret).update(body).digest("hex");

    const res = await fetch(`${baseUrl}/webhook/${secret.connectorId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [secret.signatureHeader]: signature,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { accepted: boolean; eventId: string };
    expect(json.accepted).toBe(true);
    expect(json.eventId).toBe("evt-1");

    expect(dispatcher).toHaveBeenCalledTimes(1);
    const event = dispatcher.mock.calls[0]![0] as { connectorId: string; payload: unknown };
    expect(event.connectorId).toBe("linear-prod");
    expect(event.payload).toEqual({ id: "evt-1", action: "create", data: { issue: 42 } });
  });

  it("POST with WRONG HMAC returns 401 and the dispatcher is NOT called", async () => {
    const body = JSON.stringify({ id: "evt-2" });
    const wrongSig = "0".repeat(64);

    const res = await fetch(`${baseUrl}/webhook/${secret.connectorId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [secret.signatureHeader]: wrongSig,
      },
      body,
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("bad_signature");

    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("POST with a missing signature header returns 401 (missing_signature)", async () => {
    const body = JSON.stringify({ id: "evt-3" });
    const res = await fetch(`${baseUrl}/webhook/${secret.connectorId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("missing_signature");
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("POST to an unregistered connectorId returns 404", async () => {
    const body = JSON.stringify({ id: "evt-x" });
    const sig = createHmac("sha256", "anything").update(body).digest("hex");

    const res = await fetch(`${baseUrl}/webhook/ghost-connector`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [secret.signatureHeader]: sig,
      },
      body,
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("connector_not_registered");
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("non-POST methods return 405 method_not_allowed", async () => {
    const res = await fetch(`${baseUrl}/webhook/${secret.connectorId}`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("stats accumulate received/accepted/rejected counts across requests", async () => {
    // 1 valid call → received++ + accepted++
    const body1 = JSON.stringify({ id: "evt-a" });
    const sig1 = createHmac("sha256", secret.secret).update(body1).digest("hex");
    await fetch(`${baseUrl}/webhook/${secret.connectorId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [secret.signatureHeader]: sig1,
      },
      body: body1,
    });

    // 1 bad-sig call → received++ + rejectedBadSignature++
    await fetch(`${baseUrl}/webhook/${secret.connectorId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [secret.signatureHeader]: "0".repeat(64),
      },
      body: JSON.stringify({ id: "evt-b" }),
    });

    // 1 unknown-connector call → received++ + rejectedMissingConnector++
    await fetch(`${baseUrl}/webhook/ghost`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [secret.signatureHeader]: sig1 },
      body: body1,
    });

    const stats = server.stats();
    expect(stats.received).toBe(3);
    expect(stats.accepted).toBe(1);
    expect(stats.rejectedBadSignature).toBe(1);
    expect(stats.rejectedMissingConnector).toBe(1);
  });
});
