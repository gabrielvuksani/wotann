import { describe, it, expect, vi, beforeEach } from "vitest";
import { KairosIPCServer, KairosIPCClient, type IPCServerConfig } from "../../src/daemon/kairos-ipc.js";
import { KairosRPCHandler, type RPCStreamEvent } from "../../src/daemon/kairos-rpc.js";

// ── Mock node:net and node:fs ──────────────────────────────

vi.mock("node:net", () => {
  const mockSocket = {
    on: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
    destroyed: false,
    setTimeout: vi.fn(),
  };

  const mockServer = {
    listen: vi.fn((_path: string, cb?: () => void) => {
      cb?.();
    }),
    close: vi.fn(),
    on: vi.fn(),
    maxConnections: 10,
    listening: true,
  };

  return {
    createServer: vi.fn((_handler: unknown) => mockServer),
    createConnection: vi.fn(),
    __mockSocket: mockSocket,
    __mockServer: mockServer,
  };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
  // Session-token file helpers (B1) — tests don't exercise the token path.
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return {
    ...actual,
    join: (...args: string[]) => args.join("/"),
  };
});

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

// ── Tests ──────────────────────────────────────────────────

describe("KairosIPCServer", () => {
  let rpcHandler: KairosRPCHandler;
  let server: KairosIPCServer;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcHandler = new KairosRPCHandler();
    server = new KairosIPCServer(rpcHandler, {
      socketPath: "/tmp/test-kairos.sock",
      maxConnections: 5,
      keepAliveMs: 30_000,
    });
  });

  describe("constructor", () => {
    it("creates server with custom config", () => {
      expect(server.getSocketPath()).toBe("/tmp/test-kairos.sock");
    });

    it("uses default config when not provided", () => {
      const defaultServer = new KairosIPCServer(rpcHandler);
      // Default socket path is homedir + .wotann/kairos.sock
      expect(defaultServer.getSocketPath()).toContain("kairos.sock");
    });
  });

  describe("start / stop", () => {
    it("starts the server without throwing", () => {
      expect(() => server.start()).not.toThrow();
    });

    it("cleans up stale socket file on start", async () => {
      const { existsSync } = await import("node:fs");
      vi.mocked(existsSync).mockReturnValueOnce(true);

      server.start();

      const { unlinkSync } = await import("node:fs");
      expect(unlinkSync).toHaveBeenCalled();
    });

    it("stops the server without throwing", () => {
      server.start();
      expect(() => server.stop()).not.toThrow();
    });

    it("stop is safe to call when not started", () => {
      expect(() => server.stop()).not.toThrow();
    });
  });

  describe("isRunning", () => {
    it("returns false before start", () => {
      expect(server.isRunning()).toBe(false);
    });

    it("returns true after start", () => {
      server.start();
      expect(server.isRunning()).toBe(true);
    });

    it("returns false after stop", () => {
      server.start();
      server.stop();
      expect(server.isRunning()).toBe(false);
    });
  });

  describe("getConnections", () => {
    it("returns empty array when no clients connected", () => {
      expect(server.getConnections()).toEqual([]);
    });
  });

  describe("broadcast", () => {
    it("does not throw when no clients connected", () => {
      const event: RPCStreamEvent = {
        jsonrpc: "2.0",
        method: "stream",
        params: {
          type: "text",
          content: "hello",
          sessionId: "s1",
        },
      };

      expect(() => server.broadcast(event)).not.toThrow();
    });
  });

  describe("send", () => {
    it("does not throw for unknown connection ID", () => {
      expect(() =>
        server.send("nonexistent", {
          jsonrpc: "2.0",
          result: "ok",
          id: 1,
        }),
      ).not.toThrow();
    });
  });

  describe("getSocketPath", () => {
    it("returns the configured socket path", () => {
      expect(server.getSocketPath()).toBe("/tmp/test-kairos.sock");
    });
  });
});

describe("KairosIPCClient", () => {
  describe("constructor", () => {
    it("uses default socket path when none provided", () => {
      const client = new KairosIPCClient();
      // Client is created without errors
      expect(client).toBeTruthy();
    });

    it("accepts custom socket path", () => {
      const client = new KairosIPCClient("/tmp/custom.sock");
      expect(client).toBeTruthy();
    });
  });

  describe("isConnected", () => {
    it("returns false before connecting", () => {
      const client = new KairosIPCClient();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("disconnect", () => {
    it("is safe to call when not connected", () => {
      const client = new KairosIPCClient();
      expect(() => client.disconnect()).not.toThrow();
    });
  });

  describe("call", () => {
    it("throws when not connected", async () => {
      const client = new KairosIPCClient();
      await expect(client.call("ping")).rejects.toThrow("Not connected to KAIROS daemon");
    });
  });

  describe("isDaemonRunning (static)", () => {
    it("returns false when socket file does not exist", async () => {
      const { existsSync } = await import("node:fs");
      vi.mocked(existsSync).mockReturnValueOnce(false);

      expect(KairosIPCClient.isDaemonRunning("/tmp/no.sock")).toBe(false);
    });

    it("returns true when socket file exists", async () => {
      const { existsSync } = await import("node:fs");
      vi.mocked(existsSync).mockReturnValueOnce(true);

      expect(KairosIPCClient.isDaemonRunning("/tmp/yes.sock")).toBe(true);
    });

    it("uses default path when none provided", async () => {
      const { existsSync } = await import("node:fs");
      vi.mocked(existsSync).mockReturnValueOnce(false);

      KairosIPCClient.isDaemonRunning();
      expect(existsSync).toHaveBeenCalled();
    });
  });

  describe("onStream", () => {
    it("registers a stream callback without throwing", () => {
      const client = new KairosIPCClient();
      expect(() =>
        client.onStream("session-1", (_event) => {
          // no-op
        }),
      ).not.toThrow();
    });
  });

  describe("connect", () => {
    it("returns false when socket file does not exist", async () => {
      const { existsSync } = await import("node:fs");
      vi.mocked(existsSync).mockReturnValueOnce(false);

      const client = new KairosIPCClient("/tmp/missing.sock");
      const connected = await client.connect();
      expect(connected).toBe(false);
    });
  });
});
