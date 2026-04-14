import { describe, it, expect } from "vitest";
import { SlackAdapter } from "../../src/channels/slack.js";
import { DiscordAdapter } from "../../src/channels/discord.js";

describe("Slack Channel Adapter", () => {
  it("creates adapter with correct type and name", () => {
    const adapter = new SlackAdapter("xoxb-test", "xapp-test");
    expect(adapter.type).toBe("slack");
    expect(adapter.name).toBe("Slack");
  });

  it("reports disconnected initially", () => {
    const adapter = new SlackAdapter("xoxb-test", "xapp-test");
    expect(adapter.isConnected()).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new SlackAdapter("xoxb-test", "xapp-test");
    adapter.onMessage(async () => {});
    expect(adapter.isConnected()).toBe(false); // Still not started
  });

  it("throws on start without tokens", async () => {
    const adapter = new SlackAdapter("", "");
    await expect(adapter.start()).rejects.toThrow("SLACK_BOT_TOKEN");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new SlackAdapter("xoxb-test", "xapp-test");
    const sent = await adapter.send({
      channelType: "slack",
      channelId: "C12345",
      content: "Hello",
    });
    expect(sent).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new SlackAdapter("xoxb-test", "xapp-test");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });
});

describe("Discord Channel Adapter", () => {
  it("creates adapter with correct type and name", () => {
    const adapter = new DiscordAdapter("test-token");
    expect(adapter.type).toBe("discord");
    expect(adapter.name).toBe("Discord Bot");
  });

  it("reports disconnected initially", () => {
    const adapter = new DiscordAdapter("test-token");
    expect(adapter.isConnected()).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new DiscordAdapter("test-token");
    adapter.onMessage(async () => {});
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without token", async () => {
    const adapter = new DiscordAdapter("");
    await expect(adapter.start()).rejects.toThrow("DISCORD_BOT_TOKEN");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new DiscordAdapter("test-token");
    const sent = await adapter.send({
      channelType: "discord",
      channelId: "987654321",
      content: "Hello Discord!",
    });
    expect(sent).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new DiscordAdapter("test-token");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });
});
