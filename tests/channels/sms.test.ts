import { describe, it, expect, vi } from "vitest";
import { SMSAdapter } from "../../src/channels/sms.js";

describe("SMS Channel Adapter (Twilio)", () => {
  it("creates adapter with correct type and name", () => {
    const adapter = new SMSAdapter("sid", "token", "+1234567890");
    expect(adapter.type).toBe("sms");
    expect(adapter.name).toBe("SMS (Twilio)");
  });

  it("reports disconnected initially", () => {
    const adapter = new SMSAdapter("sid", "token", "+1234567890");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without credentials", async () => {
    const adapter = new SMSAdapter("", "", "");
    await expect(adapter.start()).rejects.toThrow("TWILIO_ACCOUNT_SID");
  });

  it("throws on start with partial credentials", async () => {
    const adapter = new SMSAdapter("sid-only", "", "");
    await expect(adapter.start()).rejects.toThrow("TWILIO_ACCOUNT_SID");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new SMSAdapter("sid", "token", "+1234567890");
    const sent = await adapter.send({
      channelType: "sms",
      channelId: "+0987654321",
      content: "Hello via SMS",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new SMSAdapter("sid", "token", "+1234567890");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new SMSAdapter("sid", "token", "+1234567890");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("processes incoming webhook payload", async () => {
    const adapter = new SMSAdapter("sid", "token", "+1234567890");
    const received: unknown[] = [];

    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleWebhook({
      MessageSid: "SM123",
      From: "+15551234567",
      To: "+1234567890",
      Body: "Hello from SMS",
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      content: string;
    };
    expect(msg.channelType).toBe("sms");
    expect(msg.senderId).toBe("+15551234567");
    expect(msg.content).toBe("Hello from SMS");
  });

  it("ignores webhook when no handler registered", async () => {
    const adapter = new SMSAdapter("sid", "token", "+1234567890");

    // Should not throw
    await adapter.handleWebhook({
      MessageSid: "SM123",
      From: "+15551234567",
      To: "+1234567890",
      Body: "Hello",
    });
  });
});
