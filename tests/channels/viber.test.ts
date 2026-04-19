/**
 * Viber channel adapter tests.
 * Covers construction, credential validation, signature verification,
 * and event dispatch.
 */

import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ViberAdapter } from "../../src/channels/viber.js";

describe("Viber Channel Adapter", () => {
  beforeEach(() => {
    delete process.env["VIBER_AUTH_TOKEN"];
    delete process.env["VIBER_SENDER_NAME"];
    delete process.env["VIBER_SENDER_AVATAR"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates adapter with correct type and name", () => {
    const adapter = new ViberAdapter("token");
    expect(adapter.type).toBe("viber");
    expect(adapter.name).toBe("Viber");
  });

  it("reports disconnected initially", () => {
    const adapter = new ViberAdapter("token");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without auth token", async () => {
    const adapter = new ViberAdapter("");
    await expect(adapter.start()).rejects.toThrow("VIBER_AUTH_TOKEN");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new ViberAdapter("token");
    const sent = await adapter.send({
      channelType: "viber",
      channelId: "user-id",
      content: "Hello Viber",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new ViberAdapter("token");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new ViberAdapter("token");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("reads credentials from env vars when no args given", () => {
    process.env["VIBER_AUTH_TOKEN"] = "env-token";
    process.env["VIBER_SENDER_NAME"] = "env-sender";
    const adapter = new ViberAdapter();
    expect(adapter.type).toBe("viber");
  });

  it("dispatches text message via handleEvent", async () => {
    const adapter = new ViberAdapter("token");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      event: "message",
      timestamp: 1_700_000_000_000,
      message_token: 123,
      sender: { id: "viber-user-1", name: "Alice" },
      message: { type: "text", text: "Hello from Viber" },
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      senderName: string;
      content: string;
      channelId: string;
    };
    expect(msg.channelType).toBe("viber");
    expect(msg.senderId).toBe("viber-user-1");
    expect(msg.senderName).toBe("Alice");
    expect(msg.content).toBe("Hello from Viber");
    expect(msg.channelId).toBe("viber-user-1");
  });

  it("ignores non-message events", async () => {
    const adapter = new ViberAdapter("token");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      event: "subscribed",
      sender: { id: "u1" },
    });

    expect(received).toHaveLength(0);
  });

  it("ignores non-text message types", async () => {
    const adapter = new ViberAdapter("token");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      event: "message",
      sender: { id: "u1" },
      message: { type: "picture" },
    });

    expect(received).toHaveLength(0);
  });

  it("verifies Viber HMAC signature correctly", () => {
    const adapter = new ViberAdapter("my-token");
    const body = JSON.stringify({ event: "message" });
    const valid = createHmac("sha256", "my-token").update(body, "utf8").digest("hex");

    expect(adapter.verifySignature(body, valid)).toBe(true);
    expect(adapter.verifySignature(body, "deadbeef")).toBe(false);
    expect(adapter.verifySignature(body, undefined)).toBe(false);
  });

  it("handleWebhookBody rejects invalid signatures", async () => {
    const adapter = new ViberAdapter("token");
    const result = await adapter.handleWebhookBody("{}", "bad-sig");
    expect(result).toBe(false);
  });

  it("handleWebhookBody accepts valid signatures", async () => {
    const adapter = new ViberAdapter("token");
    const body = JSON.stringify({ event: "subscribed", sender: { id: "u1" } });
    const sig = createHmac("sha256", "token").update(body, "utf8").digest("hex");
    const result = await adapter.handleWebhookBody(body, sig);
    expect(result).toBe(true);
  });

  it("handleWebhookBody can skip signature in dev mode", async () => {
    const adapter = new ViberAdapter("token");
    const body = JSON.stringify({ event: "subscribed", sender: { id: "u1" } });
    const result = await adapter.handleWebhookBody(body, undefined, { skipSignature: true });
    expect(result).toBe(true);
  });
});
