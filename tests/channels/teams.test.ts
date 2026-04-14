import { describe, it, expect, vi } from "vitest";
import { TeamsAdapter } from "../../src/channels/teams.js";

describe("Microsoft Teams Channel Adapter", () => {
  it("creates adapter with correct type and name", () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    expect(adapter.type).toBe("teams");
    expect(adapter.name).toBe("Microsoft Teams");
  });

  it("reports disconnected initially", () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without credentials", async () => {
    const adapter = new TeamsAdapter("", "");
    await expect(adapter.start()).rejects.toThrow("TEAMS_APP_ID");
  });

  it("throws on start with appId but no password", async () => {
    const adapter = new TeamsAdapter("app-id", "");
    await expect(adapter.start()).rejects.toThrow("TEAMS_APP_ID");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    const sent = await adapter.send({
      channelType: "teams",
      channelId: "https://service.url|conversation-id",
      content: "Hello Teams!",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully and clears token", async () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("processes incoming Bot Framework activity", async () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    const received: unknown[] = [];

    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleActivity({
      type: "message",
      id: "activity-1",
      timestamp: new Date().toISOString(),
      channelId: "msteams",
      from: { id: "user-1", name: "Test User" },
      conversation: { id: "conv-1" },
      text: "Hello from Teams",
      serviceUrl: "https://smba.trafficmanager.net/teams",
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      senderName: string;
      content: string;
      channelId: string;
    };
    expect(msg.channelType).toBe("teams");
    expect(msg.senderId).toBe("user-1");
    expect(msg.senderName).toBe("Test User");
    expect(msg.content).toBe("Hello from Teams");
    expect(msg.channelId).toBe("https://smba.trafficmanager.net/teams|conv-1");
  });

  it("ignores non-message activities", async () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    const received: unknown[] = [];

    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleActivity({
      type: "typing",
      id: "activity-2",
      timestamp: new Date().toISOString(),
      channelId: "msteams",
      from: { id: "user-1", name: "Test User" },
      conversation: { id: "conv-1" },
      serviceUrl: "https://smba.trafficmanager.net/teams",
    });

    expect(received).toHaveLength(0);
  });

  it("ignores activities without text", async () => {
    const adapter = new TeamsAdapter("app-id", "app-password");
    const received: unknown[] = [];

    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleActivity({
      type: "message",
      id: "activity-3",
      timestamp: new Date().toISOString(),
      channelId: "msteams",
      from: { id: "user-1", name: "Test User" },
      conversation: { id: "conv-1" },
      serviceUrl: "https://smba.trafficmanager.net/teams",
    });

    expect(received).toHaveLength(0);
  });

  it("handles activity when no handler registered", async () => {
    const adapter = new TeamsAdapter("app-id", "app-password");

    // Should not throw
    await adapter.handleActivity({
      type: "message",
      id: "activity-4",
      timestamp: new Date().toISOString(),
      channelId: "msteams",
      from: { id: "user-1", name: "Test User" },
      conversation: { id: "conv-1" },
      text: "Hello",
      serviceUrl: "https://smba.trafficmanager.net/teams",
    });
  });
});
