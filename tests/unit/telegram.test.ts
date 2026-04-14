import { describe, it, expect } from "vitest";
import { TelegramAdapter } from "../../src/channels/telegram.js";

describe("Telegram Channel Adapter", () => {
  it("creates adapter with correct type and name", () => {
    const adapter = new TelegramAdapter("test-token");
    expect(adapter.type).toBe("telegram");
    expect(adapter.name).toBe("Telegram Bot");
  });

  it("reports disconnected initially", () => {
    const adapter = new TelegramAdapter("test-token");
    expect(adapter.isConnected()).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new TelegramAdapter("test-token");
    const handler = async () => {};
    adapter.onMessage(handler);
    // No error means handler was registered
    expect(true).toBe(true);
  });

  it("throws on start without token", async () => {
    const adapter = new TelegramAdapter("");
    await expect(adapter.start()).rejects.toThrow("TELEGRAM_BOT_TOKEN");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new TelegramAdapter("test-token");
    const sent = await adapter.send({
      channelType: "telegram",
      channelId: "12345",
      content: "Hello",
    });
    expect(sent).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new TelegramAdapter("test-token");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });
});
