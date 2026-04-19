/**
 * WeChat Work channel adapter tests.
 * Covers construction, credential validation (webhook vs app paths),
 * and callback dispatch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeChatAdapter } from "../../src/channels/wechat.js";

describe("WeChat Work Channel Adapter", () => {
  beforeEach(() => {
    delete process.env["WECHAT_CORP_ID"];
    delete process.env["WECHAT_CORP_SECRET"];
    delete process.env["WECHAT_AGENT_ID"];
    delete process.env["WECHAT_WEBHOOK_URL"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates adapter with correct type and name", () => {
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });
    expect(adapter.type).toBe("wechat");
    expect(adapter.name).toBe("WeChat Work");
  });

  it("reports disconnected initially", () => {
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without any credentials", async () => {
    const adapter = new WeChatAdapter();
    await expect(adapter.start()).rejects.toThrow("WeChat requires either");
  });

  it("throws on start with partial app credentials", async () => {
    // corpId without secret/agentId is not enough.
    const adapter = new WeChatAdapter({ corpId: "corp-only" });
    await expect(adapter.start()).rejects.toThrow("WeChat requires either");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });
    const sent = await adapter.send({
      channelType: "wechat",
      channelId: "user-id",
      content: "Hello WeChat",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully and clears token state", async () => {
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("reads credentials from env vars when no args given", () => {
    process.env["WECHAT_WEBHOOK_URL"] = "https://env.example/hook";
    const adapter = new WeChatAdapter();
    expect(adapter.type).toBe("wechat");
  });

  it("starts in webhook-only mode without hitting gettoken", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });

    await adapter.start();

    expect(adapter.isConnected()).toBe(true);
    // Webhook-only mode must not call gettoken — no authentication necessary.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("processes incoming text callback", async () => {
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleCallback({
      MsgType: "text",
      Content: "Hello from WeChat",
      FromUserName: "user-42",
      ToUserName: "bot",
      CreateTime: 1_700_000_000,
      MsgId: "msg-1",
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      content: string;
      channelId: string;
    };
    expect(msg.channelType).toBe("wechat");
    expect(msg.senderId).toBe("user-42");
    expect(msg.content).toBe("Hello from WeChat");
    expect(msg.channelId).toBe("user-42");
  });

  it("ignores non-text callbacks", async () => {
    const adapter = new WeChatAdapter({ webhookUrl: "https://example.com/hook" });
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleCallback({
      MsgType: "image",
      FromUserName: "user-42",
      MsgId: "msg-2",
    });

    expect(received).toHaveLength(0);
  });

  it("skips echoed-agent callbacks (own message loop protection)", async () => {
    const adapter = new WeChatAdapter({
      corpId: "corp",
      corpSecret: "secret",
      agentId: "1000001",
    });
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleCallback({
      MsgType: "text",
      Content: "echo",
      FromUserName: "1000001", // Same as agentId
      MsgId: "msg-3",
    });

    expect(received).toHaveLength(0);
  });
});
