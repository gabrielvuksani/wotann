/**
 * Feishu/Lark channel adapter tests.
 * Covers construction, credential validation, receive-id classification,
 * and event envelope dispatch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeishuAdapter, classifyReceiveIdType } from "../../src/channels/feishu.js";

describe("Feishu Channel Adapter", () => {
  beforeEach(() => {
    delete process.env["FEISHU_APP_ID"];
    delete process.env["FEISHU_APP_SECRET"];
    delete process.env["FEISHU_DOMAIN"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates adapter with correct type and name", () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    expect(adapter.type).toBe("feishu");
    expect(adapter.name).toBe("Feishu");
  });

  it("reports disconnected initially", () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without app id", async () => {
    const adapter = new FeishuAdapter("", "secret");
    await expect(adapter.start()).rejects.toThrow("FEISHU_APP_ID");
  });

  it("throws on start without app secret", async () => {
    const adapter = new FeishuAdapter("app-id", "");
    await expect(adapter.start()).rejects.toThrow("FEISHU_APP_ID");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    const sent = await adapter.send({
      channelType: "feishu",
      channelId: "oc_chat",
      content: "Hello Feishu",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully and clears token state", async () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("reads credentials from env vars when no args given", () => {
    process.env["FEISHU_APP_ID"] = "env-app";
    process.env["FEISHU_APP_SECRET"] = "env-secret";
    const adapter = new FeishuAdapter();
    expect(adapter.type).toBe("feishu");
  });

  it("supports switching to Lark international domain", () => {
    const adapter = new FeishuAdapter("app-id", "secret", "larksuite.com");
    expect(adapter.type).toBe("feishu");
  });

  it("dispatches text message via handleEvent", async () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      schema: "2.0",
      header: {
        event_type: "im.message.receive_v1",
        event_id: "e-1",
        create_time: "1700000000000",
      },
      event: {
        sender: {
          sender_id: { open_id: "ou_alice", user_id: "user-1" },
          sender_type: "user",
        },
        message: {
          message_id: "om_1",
          chat_id: "oc_chat_1",
          message_type: "text",
          content: JSON.stringify({ text: "Hello from Feishu" }),
          create_time: "1700000000000",
        },
      },
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      content: string;
      channelId: string;
    };
    expect(msg.channelType).toBe("feishu");
    expect(msg.senderId).toBe("ou_alice");
    expect(msg.content).toBe("Hello from Feishu");
    expect(msg.channelId).toBe("oc_chat_1");
  });

  it("ignores non-message event types", async () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      header: { event_type: "contact.user.deleted_v3" },
      event: {
        sender: { sender_id: { open_id: "ou_x" } },
        message: {
          message_id: "om_1",
          chat_id: "oc_chat",
          message_type: "text",
          content: JSON.stringify({ text: "ignored" }),
        },
      },
    });

    expect(received).toHaveLength(0);
  });

  it("ignores non-text message payloads", async () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_x" } },
        message: {
          message_id: "om_1",
          chat_id: "oc_chat",
          message_type: "image",
        },
      },
    });

    expect(received).toHaveLength(0);
  });

  it("gracefully handles malformed JSON content", async () => {
    const adapter = new FeishuAdapter("app-id", "secret");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleEvent({
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_x" } },
        message: {
          message_id: "om_1",
          chat_id: "oc_chat",
          message_type: "text",
          content: "{malformed",
        },
      },
    });

    expect(received).toHaveLength(0);
  });
});

describe("classifyReceiveIdType", () => {
  it("classifies chat_id by oc_ prefix", () => {
    expect(classifyReceiveIdType("oc_abc123")).toBe("chat_id");
  });

  it("classifies open_id by ou_ prefix", () => {
    expect(classifyReceiveIdType("ou_abc123")).toBe("open_id");
  });

  it("classifies union_id by on_ prefix", () => {
    expect(classifyReceiveIdType("on_abc123")).toBe("union_id");
  });

  it("falls back to user_id for unknown prefixes", () => {
    expect(classifyReceiveIdType("custom-id")).toBe("user_id");
    expect(classifyReceiveIdType("")).toBe("user_id");
  });
});
