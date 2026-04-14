import { describe, it, expect, beforeEach } from "vitest";
import {
  ChannelGateway,
  type ChannelAdapter,
  type ChannelMessage,
  type ChannelType,
} from "../../src/channels/gateway.js";

/** Mock adapter for testing */
function createMockAdapter(type: ChannelType): ChannelAdapter & { sentMessages: { channelId: string; content: string }[]; triggerMessage: (msg: ChannelMessage) => void } {
  let handler: ((message: ChannelMessage) => void) | null = null;
  const sentMessages: { channelId: string; content: string }[] = [];

  return {
    type,
    name: `Mock ${type}`,
    connected: false,
    sentMessages,
    async send(channelId: string, content: string) {
      sentMessages.push({ channelId, content });
      return true;
    },
    onMessage(h) {
      handler = h;
    },
    async connect() {
      (this as { connected: boolean }).connected = true;
      return true;
    },
    async disconnect() {
      (this as { connected: boolean }).connected = false;
    },
    triggerMessage(msg: ChannelMessage) {
      if (handler) handler(msg);
    },
  };
}

describe("Channel Gateway", () => {
  let gateway: ChannelGateway;

  beforeEach(() => {
    gateway = new ChannelGateway({ requirePairing: false });
  });

  describe("adapter registration", () => {
    it("registers adapters", () => {
      const adapter = createMockAdapter("telegram");
      gateway.registerAdapter(adapter);
      expect(gateway.getAdapterCount()).toBe(1);
    });

    it("connects all adapters", async () => {
      const telegram = createMockAdapter("telegram");
      const slack = createMockAdapter("slack");
      gateway.registerAdapter(telegram);
      gateway.registerAdapter(slack);

      const result = await gateway.connectAll();
      expect(result.connected).toContain("telegram");
      expect(result.connected).toContain("slack");
      expect(result.failed.length).toBe(0);
    });

    it("lists connected channels", async () => {
      const adapter = createMockAdapter("discord");
      gateway.registerAdapter(adapter);
      await gateway.connectAll();
      const channels = gateway.getConnectedChannels();
      expect(channels).toContain("discord");
    });
  });

  describe("DM pairing security", () => {
    it("generates pairing codes", () => {
      const pairingGateway = new ChannelGateway({ requirePairing: true });
      const code = pairingGateway.generatePairingCode("user123", "telegram");
      expect(code.code.length).toBe(6);
      expect(code.senderId).toBe("user123");
      expect(code.channelType).toBe("telegram");
    });

    it("verifies valid pairing codes", () => {
      const pairingGateway = new ChannelGateway({ requirePairing: true });
      const code = pairingGateway.generatePairingCode("user123", "telegram");
      expect(pairingGateway.verifyPairingCode(code.code)).toBe(true);
      expect(pairingGateway.isSenderVerified("user123")).toBe(true);
    });

    it("rejects invalid pairing codes", () => {
      const pairingGateway = new ChannelGateway({ requirePairing: true });
      expect(pairingGateway.verifyPairingCode("INVALID")).toBe(false);
    });

    it("rejects expired pairing codes", () => {
      // TTL of -1 ensures the code is already expired when checked
      const pairingGateway = new ChannelGateway({ requirePairing: true, pairingCodeTTL: -1 });
      const code = pairingGateway.generatePairingCode("user123", "telegram");
      expect(pairingGateway.verifyPairingCode(code.code)).toBe(false);
    });

    it("manually verifies senders", () => {
      gateway.verifySender("user456");
      expect(gateway.isSenderVerified("user456")).toBe(true);
    });
  });

  describe("device nodes", () => {
    it("registers device nodes", () => {
      const device = gateway.registerDevice("Phone", "telegram", ["text", "image"]);
      expect(device.name).toBe("Phone");
      expect(device.capabilities).toContain("text");
      expect(device.online).toBe(true);
    });

    it("lists all devices", () => {
      gateway.registerDevice("Phone", "telegram", ["text"]);
      gateway.registerDevice("Desktop", "slack", ["text", "file"]);
      const devices = gateway.getDevices();
      expect(devices.length).toBe(2);
    });
  });

  describe("message routing", () => {
    it("sends messages to specific channels", async () => {
      const adapter = createMockAdapter("telegram");
      gateway.registerAdapter(adapter);
      await gateway.connectAll();

      const sent = await gateway.sendToChannel("telegram", "chat123", "Hello!");
      expect(sent).toBe(true);
      expect(adapter.sentMessages.length).toBe(1);
      expect(adapter.sentMessages[0]!.content).toBe("Hello!");
    });

    it("returns false for disconnected channels", async () => {
      const adapter = createMockAdapter("telegram");
      gateway.registerAdapter(adapter);
      // Don't connect
      const sent = await gateway.sendToChannel("telegram", "chat123", "Hello!");
      expect(sent).toBe(false);
    });

    it("returns false for unregistered channels", async () => {
      const sent = await gateway.sendToChannel("telegram", "chat123", "Hello!");
      expect(sent).toBe(false);
    });

    it("broadcasts to all connected channels", async () => {
      const telegram = createMockAdapter("telegram");
      const slack = createMockAdapter("slack");
      gateway.registerAdapter(telegram);
      gateway.registerAdapter(slack);
      await gateway.connectAll();

      const sent = await gateway.broadcast("Broadcast message");
      expect(sent.length).toBe(2);
      expect(telegram.sentMessages.length).toBe(1);
      expect(slack.sentMessages.length).toBe(1);
    });
  });

  describe("message queue", () => {
    it("starts with empty queue", () => {
      expect(gateway.getMessageQueue().length).toBe(0);
    });
  });

  describe("disconnect", () => {
    it("disconnects all adapters", async () => {
      const adapter = createMockAdapter("telegram");
      gateway.registerAdapter(adapter);
      await gateway.connectAll();
      expect(adapter.connected).toBe(true);

      await gateway.disconnectAll();
      expect(adapter.connected).toBe(false);
    });
  });
});
