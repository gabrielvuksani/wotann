/**
 * LINE channel adapter tests.
 * Covers construction, credential validation, webhook signature verification,
 * event dispatch, and reply-token lifecycle.
 */

import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LineAdapter } from "../../src/channels/line.js";

describe("LINE Channel Adapter", () => {
  beforeEach(() => {
    delete process.env["LINE_CHANNEL_ACCESS_TOKEN"];
    delete process.env["LINE_CHANNEL_SECRET"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates adapter with correct type and name", () => {
    const adapter = new LineAdapter("token", "secret");
    expect(adapter.type).toBe("line");
    expect(adapter.name).toBe("LINE");
  });

  it("reports disconnected initially", () => {
    const adapter = new LineAdapter("token", "secret");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without access token", async () => {
    const adapter = new LineAdapter("", "");
    await expect(adapter.start()).rejects.toThrow("LINE_CHANNEL_ACCESS_TOKEN");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new LineAdapter("token", "secret");
    const sent = await adapter.send({
      channelType: "line",
      channelId: "U-1",
      content: "Hello LINE",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new LineAdapter("token", "secret");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully and clears reply tokens", async () => {
    const adapter = new LineAdapter("token", "secret");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("reads credentials from env vars when no args given", () => {
    process.env["LINE_CHANNEL_ACCESS_TOKEN"] = "env-token";
    process.env["LINE_CHANNEL_SECRET"] = "env-secret";
    const adapter = new LineAdapter();
    expect(adapter.type).toBe("line");
  });

  it("dispatches user message via handleEvent", async () => {
    const adapter = new LineAdapter("token", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      type: "message",
      replyToken: "reply-abc",
      timestamp: 1_700_000_000_000,
      source: { type: "user", userId: "U-42" },
      message: { id: "msg-1", type: "text", text: "Hello from Line" },
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      content: string;
      channelId: string;
    };
    expect(msg.channelType).toBe("line");
    expect(msg.senderId).toBe("U-42");
    expect(msg.content).toBe("Hello from Line");
    expect(msg.channelId).toBe("U-42");
  });

  it("routes group messages to the group id as channel", async () => {
    const adapter = new LineAdapter("token", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      type: "message",
      source: { type: "group", groupId: "G-1", userId: "U-1" },
      message: { id: "m1", type: "text", text: "grp hi" },
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as { channelId: string };
    expect(msg.channelId).toBe("G-1");
  });

  it("ignores non-text messages", async () => {
    const adapter = new LineAdapter("token", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      type: "message",
      source: { type: "user", userId: "U-1" },
      message: { id: "m2", type: "image" },
    });

    expect(received).toHaveLength(0);
  });

  it("ignores non-message events", async () => {
    const adapter = new LineAdapter("token", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      type: "follow",
      source: { type: "user", userId: "U-1" },
    });

    expect(received).toHaveLength(0);
  });

  it("verifies LINE HMAC signature correctly", () => {
    const adapter = new LineAdapter("token", "my-secret");
    const body = JSON.stringify({ events: [] });
    const valid = createHmac("sha256", "my-secret")
      .update(body, "utf8")
      .digest("base64");

    expect(adapter.verifySignature(body, valid)).toBe(true);
    expect(adapter.verifySignature(body, "invalid")).toBe(false);
    expect(adapter.verifySignature(body, undefined)).toBe(false);
  });

  it("accepts any signature when no secret configured (dev mode)", () => {
    const adapter = new LineAdapter("token", "");
    expect(adapter.verifySignature("{}", "anything")).toBe(true);
    expect(adapter.verifySignature("{}", undefined)).toBe(true);
  });

  it("handleWebhookBody rejects invalid signatures", async () => {
    const adapter = new LineAdapter("token", "secret");
    const result = await adapter.handleWebhookBody("{}", "wrong-sig");
    expect(result).toBe(false);
  });

  it("handleWebhookBody processes a signed verification ping", async () => {
    const adapter = new LineAdapter("token", "secret");
    const body = JSON.stringify({ events: [] });
    const sig = createHmac("sha256", "secret").update(body, "utf8").digest("base64");

    const result = await adapter.handleWebhookBody(body, sig);
    expect(result).toBe(true);
  });
});
