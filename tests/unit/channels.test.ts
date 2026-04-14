import { afterEach, describe, it, expect } from "vitest";
import { DMPairingManager, NodeRegistry, WebChatAdapter } from "../../src/channels/adapter.js";
import { KairosDaemon } from "../../src/daemon/kairos.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Multi-Channel Messaging (Phase 13)", () => {
  let cleanupDir: string | null = null;

  afterEach(() => {
    if (cleanupDir) {
      rmSync(cleanupDir, { recursive: true, force: true });
      cleanupDir = null;
    }
  });

  describe("DMPairingManager", () => {
    it("generates pairing codes", () => {
      const mgr = new DMPairingManager();
      const entry = mgr.requestPairing("user123", "telegram");

      expect(entry.pairingCode).toHaveLength(6);
      expect(entry.approved).toBe(false);
    });

    it("blocks unknown senders", () => {
      const mgr = new DMPairingManager();
      expect(mgr.isApproved("unknown-user")).toBe(false);
    });

    it("approves pairing with correct code", () => {
      const mgr = new DMPairingManager();
      const entry = mgr.requestPairing("user123", "telegram");

      const approved = mgr.approvePairing("user123", "telegram", entry.pairingCode);
      expect(approved).toBe(true);
      expect(mgr.isApproved("user123")).toBe(true);
    });

    it("rejects pairing with wrong code", () => {
      const mgr = new DMPairingManager();
      mgr.requestPairing("user123", "telegram");

      const approved = mgr.approvePairing("user123", "telegram", "WRONG!");
      expect(approved).toBe(false);
      expect(mgr.isApproved("user123")).toBe(false);
    });

    it("returns same code for duplicate requests", () => {
      const mgr = new DMPairingManager();
      const first = mgr.requestPairing("user123", "telegram");
      const second = mgr.requestPairing("user123", "telegram");

      expect(first.pairingCode).toBe(second.pairingCode);
    });

    it("lists pending pairings", () => {
      const mgr = new DMPairingManager();
      mgr.requestPairing("user1", "telegram");
      mgr.requestPairing("user2", "slack");

      const pending = mgr.getPendingPairings();
      expect(pending).toHaveLength(2);
    });

    it("revokes pairing", () => {
      const mgr = new DMPairingManager();
      const entry = mgr.requestPairing("user123", "telegram");
      mgr.approvePairing("user123", "telegram", entry.pairingCode);

      expect(mgr.isApproved("user123")).toBe(true);
      mgr.revokePairing("user123");
      expect(mgr.isApproved("user123")).toBe(false);
    });
  });

  describe("NodeRegistry", () => {
    it("registers and retrieves nodes", () => {
      const registry = new NodeRegistry();
      registry.register({
        id: "node-1",
        name: "MacBook",
        platform: "darwin",
        capabilities: {
          camera: true, screenRecording: true, location: false,
          notifications: true, clipboard: true, microphone: true, fileSystem: true,
        },
        lastSeen: new Date(),
      });

      expect(registry.getNode("node-1")).toBeDefined();
      expect(registry.getNodeCount()).toBe(1);
    });

    it("finds nodes with specific capabilities", () => {
      const registry = new NodeRegistry();
      registry.register({
        id: "mac", name: "MacBook", platform: "darwin",
        capabilities: { camera: true, screenRecording: true, location: false, notifications: true, clipboard: true, microphone: true, fileSystem: true },
        lastSeen: new Date(),
      });
      registry.register({
        id: "server", name: "Server", platform: "linux",
        capabilities: { camera: false, screenRecording: false, location: false, notifications: false, clipboard: false, microphone: false, fileSystem: true },
        lastSeen: new Date(),
      });

      const withCamera = registry.getNodesWithCapability("camera");
      expect(withCamera).toHaveLength(1);
      expect(withCamera[0]?.id).toBe("mac");
    });

    it("unregisters nodes", () => {
      const registry = new NodeRegistry();
      registry.register({
        id: "temp", name: "Temp", platform: "linux",
        capabilities: { camera: false, screenRecording: false, location: false, notifications: false, clipboard: false, microphone: false, fileSystem: false },
        lastSeen: new Date(),
      });

      registry.unregister("temp");
      expect(registry.getNode("temp")).toBeUndefined();
    });
  });

  describe("WebChatAdapter", () => {
    it("starts and stops", async () => {
      const adapter = new WebChatAdapter();

      expect(adapter.isConnected()).toBe(false);
      await adapter.start();
      expect(adapter.isConnected()).toBe(true);
      await adapter.stop();
      expect(adapter.isConnected()).toBe(false);
    });

    it("receives messages via handler", async () => {
      const adapter = new WebChatAdapter();
      const received: string[] = [];

      adapter.onMessage(async (msg) => {
        received.push(msg.content);
      });

      await adapter.start();
      await adapter.receiveMessage({
        channelType: "webchat",
        channelId: "test",
        senderId: "user1",
        senderName: "Test User",
        content: "Hello!",
        timestamp: new Date(),
      });

      expect(received).toEqual(["Hello!"]);
    });
  });

  describe("Channel gateway integration", () => {
    it("receives and responds to a webchat message end-to-end", async () => {
      cleanupDir = mkdtempSync(join(tmpdir(), "wotann-channels-"));
      const daemon = new KairosDaemon(join(cleanupDir, "logs"));
      const gateway = await daemon.startChannelGateway(
        async (message) => `Echo: ${message.content}`,
        {
          webchat: true,
          telegram: false,
          slack: false,
          discord: false,
          requirePairing: false,
          webchatPort: 0,
          webchatHost: "127.0.0.1",
        },
      );

      try {
        const adapter = gateway.getAdapter("webchat") as { getPort: () => number } | undefined;
        expect(adapter).toBeDefined();
        const port = adapter?.getPort() ?? 0;
        expect(port).toBeGreaterThan(0);

        const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello gateway", senderId: "webchat-user" }),
        });
        const payload = await response.json() as { response: string };

        expect(response.ok).toBe(true);
        expect(payload.response).toBe("Echo: Hello gateway");
      } finally {
        await gateway.disconnectAll();
      }
    });
  });
});
