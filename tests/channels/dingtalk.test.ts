/**
 * DingTalk channel adapter tests.
 * Covers construction, credential validation, signed webhook URL generation,
 * and enterprise-bot callback dispatch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DingTalkAdapter } from "../../src/channels/dingtalk.js";

describe("DingTalk Channel Adapter", () => {
  beforeEach(() => {
    delete process.env["DINGTALK_WEBHOOK_URL"];
    delete process.env["DINGTALK_SECRET"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates adapter with correct type and name", () => {
    const adapter = new DingTalkAdapter("https://oapi.dingtalk.com/robot/send?access_token=abc");
    expect(adapter.type).toBe("dingtalk");
    expect(adapter.name).toBe("DingTalk");
  });

  it("reports disconnected initially", () => {
    const adapter = new DingTalkAdapter("https://example.com/hook");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without webhook URL", async () => {
    const adapter = new DingTalkAdapter("");
    await expect(adapter.start()).rejects.toThrow("DINGTALK_WEBHOOK_URL");
  });

  it("starts without performing a network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = new DingTalkAdapter("https://example.com/hook");
    await adapter.start();
    expect(adapter.isConnected()).toBe(true);
    // The webhook URL is opaque and rate-limited; start should not probe.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails to send when disconnected", async () => {
    const adapter = new DingTalkAdapter("https://example.com/hook");
    const sent = await adapter.send({
      channelType: "dingtalk",
      channelId: "conv-1",
      content: "Hello DingTalk",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new DingTalkAdapter("https://example.com/hook");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new DingTalkAdapter("https://example.com/hook");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("reads credentials from env vars when no args given", () => {
    process.env["DINGTALK_WEBHOOK_URL"] = "https://env.example/hook";
    process.env["DINGTALK_SECRET"] = "env-secret";
    const adapter = new DingTalkAdapter();
    expect(adapter.type).toBe("dingtalk");
  });

  it("signs outgoing requests when secret is configured", async () => {
    const seenUrl: { url: string | null } = { url: null };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seenUrl.url = String(url);
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    });

    const adapter = new DingTalkAdapter(
      "https://oapi.dingtalk.com/robot/send?access_token=abc",
      "secret-xyz",
    );
    await adapter.start();
    const sent = await adapter.send({
      channelType: "dingtalk",
      channelId: "conv-1",
      content: "hi",
    });

    expect(sent).toBe(true);
    expect(seenUrl.url).toBeTruthy();
    expect(seenUrl.url).toContain("timestamp=");
    expect(seenUrl.url).toContain("sign=");
  });

  it("does not sign URL when no secret configured", async () => {
    const seenUrl: { url: string | null } = { url: null };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seenUrl.url = String(url);
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    });

    const adapter = new DingTalkAdapter(
      "https://oapi.dingtalk.com/robot/send?access_token=abc",
      "",
    );
    await adapter.start();
    await adapter.send({
      channelType: "dingtalk",
      channelId: "conv-1",
      content: "hi",
    });

    expect(seenUrl.url).toBe("https://oapi.dingtalk.com/robot/send?access_token=abc");
  });

  it("returns false when DingTalk returns non-zero errcode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errcode: 130101, errmsg: "signature invalid" }), {
        status: 200,
      }),
    );

    const adapter = new DingTalkAdapter("https://example.com/hook");
    await adapter.start();
    const sent = await adapter.send({
      channelType: "dingtalk",
      channelId: "conv-1",
      content: "hi",
    });
    expect(sent).toBe(false);
  });

  it("processes enterprise-bot callback payload", async () => {
    const adapter = new DingTalkAdapter("https://example.com/hook");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleCallback({
      msgtype: "text",
      text: { content: "hello from dingtalk" },
      senderId: "user-123",
      senderNick: "Alice",
      conversationId: "conv-1",
      msgId: "m-1",
      createAt: 1_700_000_000,
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      senderName: string;
      content: string;
      channelId: string;
    };
    expect(msg.channelType).toBe("dingtalk");
    expect(msg.senderId).toBe("user-123");
    expect(msg.senderName).toBe("Alice");
    expect(msg.content).toBe("hello from dingtalk");
    expect(msg.channelId).toBe("conv-1");
  });

  it("ignores non-text callbacks", async () => {
    const adapter = new DingTalkAdapter("https://example.com/hook");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleCallback({
      msgtype: "image",
      senderId: "user-1",
      conversationId: "conv-1",
    });

    expect(received).toHaveLength(0);
  });
});
