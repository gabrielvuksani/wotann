import { describe, it, expect } from "vitest";
import {
  CompanionServer,
  PairingManager,
  CompanionRPCHandler,
  generateSessionFingerprint,
} from "../../src/desktop/companion-server.js";

describe("PairingManager", () => {
  it("should generate pairing requests", () => {
    const manager = new PairingManager();
    const request = manager.generatePairingRequest();
    expect(request.pin).toHaveLength(6);
    expect(request.requestId).toBeTruthy();
    expect(new Date(request.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("should complete pairing successfully", () => {
    const manager = new PairingManager();
    const request = manager.generatePairingRequest();
    const result = manager.completePairing(
      request.requestId,
      request.pin,
      "iPhone 16 Pro",
      "device-001",
    );
    expect(result.success).toBe(true);
    expect(result.sessionId).toBeTruthy();
  });

  it("should reject invalid pairing request", () => {
    const manager = new PairingManager();
    const result = manager.completePairing("invalid", "000000", "Phone", "dev-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("should enforce max devices limit", () => {
    const manager = new PairingManager(2);

    // Pair two devices
    for (let i = 0; i < 2; i++) {
      const req = manager.generatePairingRequest();
      manager.completePairing(req.requestId, req.pin, `Device ${i}`, `dev-${i}`);
    }

    // Third should fail — upsertDeviceSession throws when max devices exceeded
    const req = manager.generatePairingRequest();
    expect(() => manager.completePairing(req.requestId, req.pin, "Extra", "dev-extra"))
      .toThrow("Maximum");
  });

  it("should unpair devices", () => {
    const manager = new PairingManager();
    const req = manager.generatePairingRequest();
    manager.completePairing(req.requestId, req.pin, "Phone", "dev-1");

    expect(manager.getPairedDevices()).toHaveLength(1);
    expect(manager.unpairDevice("dev-1")).toBe(true);
    expect(manager.getPairedDevices()).toHaveLength(0);
  });

  it("should track active sessions", () => {
    const manager = new PairingManager();
    const req = manager.generatePairingRequest();
    manager.completePairing(req.requestId, req.pin, "Phone", "dev-1");

    const sessions = manager.getActiveSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("active");
  });

  it("should validate sessions", () => {
    const manager = new PairingManager();
    const req = manager.generatePairingRequest();
    const pairing = manager.completePairing(req.requestId, req.pin, "Phone", "dev-1");

    const session = manager.validateSession(pairing.sessionId!);
    expect(session).not.toBeNull();
    expect(session?.device.name).toBe("Phone");

    expect(manager.validateSession("nonexistent")).toBeNull();
  });

  it("should generate QR data", () => {
    const manager = new PairingManager();
    const req = manager.generatePairingRequest();
    const qr = manager.generateQRData(req.requestId, req.pin, "192.168.1.100", 3849);
    expect(qr).toContain("wotann://pair");
    expect(qr).toContain(req.pin);
    expect(qr).toContain("3849");
  });

  it("should update device last-seen", () => {
    const manager = new PairingManager();
    const req = manager.generatePairingRequest();
    manager.completePairing(req.requestId, req.pin, "Phone", "dev-1");

    const before = manager.getPairedDevices()[0]?.lastSeen;
    manager.touchDevice("dev-1");
    const after = manager.getPairedDevices()[0]?.lastSeen;

    // Timestamps should be different or equal (might run in same ms)
    expect(after).toBeTruthy();
    expect(new Date(after!).getTime()).toBeGreaterThanOrEqual(new Date(before!).getTime());
  });
});

describe("CompanionRPCHandler", () => {
  it("should register and handle methods", async () => {
    const handler = new CompanionRPCHandler();
    handler.register("ping", async () => ({ status: "ok" }));

    const response = await handler.handle({
      method: "ping",
      params: {},
      id: "1",
    });

    expect(response.result).toEqual({ status: "ok" });
    expect(response.id).toBe("1");
  });

  it("should return error for unknown methods", async () => {
    const handler = new CompanionRPCHandler();
    const response = await handler.handle({
      method: "unknown_method",
      params: {},
      id: "2",
    });

    expect(response.error).toBeTruthy();
    expect(response.error?.code).toBe(-32601);
  });

  it("should handle errors in handlers", async () => {
    const handler = new CompanionRPCHandler();
    handler.register("ping", async () => {
      throw new Error("Something broke");
    });

    const response = await handler.handle({
      method: "ping",
      params: {},
      id: "3",
    });

    expect(response.error?.message).toBe("Something broke");
  });

  it("should list registered methods", () => {
    const handler = new CompanionRPCHandler();
    handler.register("ping", async () => ({}));
    handler.register("status", async () => ({}));

    expect(handler.getMethods()).toContain("ping");
    expect(handler.getMethods()).toContain("status");
  });
});

describe("CompanionServer", () => {
  it("should start and stop", () => {
    const server = new CompanionServer({ port: 3850 });
    expect(server.isRunning()).toBe(false);

    const info = server.start();
    expect(info.port).toBe(3850);
    expect(server.isRunning()).toBe(true);

    server.stop();
    expect(server.isRunning()).toBe(false);
  });

  it("should generate pairing QR codes", () => {
    const server = new CompanionServer();
    const qr = server.generatePairingQR();
    expect(qr.qrData).toContain("wotann://pair");
    expect(qr.pin).toHaveLength(6);
    expect(qr.expiresAt).toBeTruthy();
  });

  it("should expose pairing manager", () => {
    const server = new CompanionServer();
    expect(server.getPairingManager()).toBeDefined();
  });

  it("should have default RPC handlers", async () => {
    const server = new CompanionServer();
    const handler = server.getRPCHandler();

    const pingResult = await handler.handle({
      method: "ping",
      params: {},
      id: "test-1",
    });
    expect(pingResult.result).toHaveProperty("status", "ok");
  });
});

describe("generateSessionFingerprint", () => {
  it("should generate consistent fingerprints", () => {
    const fp1 = generateSessionFingerprint("dev-1", "2026-04-03");
    const fp2 = generateSessionFingerprint("dev-1", "2026-04-03");
    expect(fp1).toBe(fp2);
  });

  it("should generate different fingerprints for different inputs", () => {
    const fp1 = generateSessionFingerprint("dev-1", "2026-04-03");
    const fp2 = generateSessionFingerprint("dev-2", "2026-04-03");
    expect(fp1).not.toBe(fp2);
  });

  it("should produce 16-char hex strings", () => {
    const fp = generateSessionFingerprint("test", "now");
    expect(fp).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
  });
});
