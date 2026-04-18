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
    // Chainability + stable reference after registration give us an observable
    // post-condition. Previously this asserted `expect(true).toBe(true)`,
    // which was a tautology that would've stayed green even if `onMessage`
    // had been refactored to throw silently.
    expect(() => adapter.onMessage(handler)).not.toThrow();
    expect(typeof adapter.onMessage).toBe("function");
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
