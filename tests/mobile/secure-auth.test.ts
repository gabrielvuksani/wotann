import { describe, it, expect } from "vitest";
import { SecureAuthManager } from "../../src/mobile/secure-auth.js";
import type { PairingRequest } from "../../src/mobile/secure-auth.js";

/**
 * Helper: simulate a device generating its own ECDH key pair.
 * In production the iOS app does this; in tests we use the same manager utility.
 */
function generateDeviceKeyPair(): { readonly publicKey: string; readonly privateKey: string } {
  const device = new SecureAuthManager();
  return device.generateKeyPair();
}

describe("SecureAuthManager", () => {
  // ── Key Generation ───────────────────────────────────

  describe("generateKeyPair", () => {
    it("should generate a key pair with public and private keys", () => {
      const manager = new SecureAuthManager();
      const pair = manager.generateKeyPair();
      expect(pair.publicKey).toBeTruthy();
      expect(pair.privateKey).toBeTruthy();
      expect(pair.publicKey).not.toBe(pair.privateKey);
    });

    it("should generate unique key pairs each time", () => {
      const manager = new SecureAuthManager();
      const pair1 = manager.generateKeyPair();
      const pair2 = manager.generateKeyPair();
      expect(pair1.publicKey).not.toBe(pair2.publicKey);
    });

    it("should generate valid P-256 ECDH keys", () => {
      const manager = new SecureAuthManager();
      const pair = manager.generateKeyPair();
      // P-256 uncompressed public key = 65 bytes = 130 hex chars
      expect(pair.publicKey.length).toBe(130);
      // P-256 private key = 32 bytes = 64 hex chars
      expect(pair.privateKey.length).toBe(64);
    });
  });

  // ── ECDH Key Exchange ───────────────────────────────

  describe("deriveSharedSecret", () => {
    it("should derive identical shared secrets on both sides", () => {
      const manager = new SecureAuthManager();
      const desktopKeys = manager.generateKeyPair();
      const deviceKeys = manager.generateKeyPair();

      const desktopSecret = manager.deriveSharedSecret(desktopKeys.privateKey, deviceKeys.publicKey);
      const deviceSecret = manager.deriveSharedSecret(deviceKeys.privateKey, desktopKeys.publicKey);

      expect(desktopSecret).toBe(deviceSecret);
      expect(desktopSecret.length).toBeGreaterThan(0);
    });
  });

  // ── QR Payload ───────────────────────────────────────

  describe("generateQRPayload", () => {
    it("should generate a valid QR payload", () => {
      const manager = new SecureAuthManager();
      const payload = manager.generateQRPayload("192.168.1.100", 3849);
      expect(payload.host).toBe("192.168.1.100");
      expect(payload.port).toBe(3849);
      expect(payload.pin).toHaveLength(6);
      expect(payload.requestId).toBeTruthy();
      expect(payload.publicKey).toBeTruthy();
      expect(new Date(payload.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("should generate unique payloads each time", () => {
      const manager = new SecureAuthManager();
      const p1 = manager.generateQRPayload("localhost", 3849);
      const p2 = manager.generateQRPayload("localhost", 3849);
      expect(p1.requestId).not.toBe(p2.requestId);
      expect(p1.pin).not.toBe(p2.pin); // statistically near-certain
    });
  });

  // ── Pairing ──────────────────────────────────────────

  describe("verifyPairing", () => {
    it("should successfully pair with valid PIN", () => {
      const manager = new SecureAuthManager();
      const payload = manager.generateQRPayload("localhost", 3849);
      const deviceKeys = generateDeviceKeyPair();

      const request: PairingRequest = {
        deviceId: "iphone-001",
        deviceName: "iPhone 16 Pro",
        devicePublicKey: deviceKeys.publicKey,
        pin: payload.pin,
        requestId: payload.requestId,
      };

      const result = manager.verifyPairing(request);
      expect(result.success).toBe(true);
      expect(result.sessionToken).toBeTruthy();
      expect(result.sharedSecretHash).toBeTruthy();
      expect(result.sharedSecretHash).toHaveLength(16);
      expect(result.error).toBeNull();
    });

    it("should reject invalid request ID", () => {
      const manager = new SecureAuthManager();
      const request: PairingRequest = {
        deviceId: "dev-1",
        deviceName: "Phone",
        devicePublicKey: "key",
        pin: "ABCDEF",
        requestId: "nonexistent-id",
      };
      const result = manager.verifyPairing(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown");
    });

    it("should reject wrong PIN", () => {
      const manager = new SecureAuthManager();
      const payload = manager.generateQRPayload("localhost", 3849);

      const request: PairingRequest = {
        deviceId: "dev-1",
        deviceName: "Phone",
        devicePublicKey: "key",
        pin: "WRONG1",
        requestId: payload.requestId,
      };
      const result = manager.verifyPairing(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid PIN");
    });

    it("should register device on successful pairing", () => {
      const manager = new SecureAuthManager();
      const payload = manager.generateQRPayload("localhost", 3849);
      const deviceKeys = generateDeviceKeyPair();

      const request: PairingRequest = {
        deviceId: "dev-1",
        deviceName: "Phone",
        devicePublicKey: deviceKeys.publicKey,
        pin: payload.pin,
        requestId: payload.requestId,
      };

      expect(manager.getDeviceCount()).toBe(0);
      manager.verifyPairing(request);
      expect(manager.getDeviceCount()).toBe(1);
    });

    it("should not allow reuse of a pairing request", () => {
      const manager = new SecureAuthManager();
      const payload = manager.generateQRPayload("localhost", 3849);
      const deviceKeys = generateDeviceKeyPair();

      const request: PairingRequest = {
        deviceId: "dev-1",
        deviceName: "Phone",
        devicePublicKey: deviceKeys.publicKey,
        pin: payload.pin,
        requestId: payload.requestId,
      };

      manager.verifyPairing(request);
      const second = manager.verifyPairing({ ...request, deviceId: "dev-2" });
      expect(second.success).toBe(false);
    });
  });

  // ── Session Tokens ───────────────────────────────────

  describe("session tokens", () => {
    it("should create and validate session tokens", () => {
      const manager = new SecureAuthManager();
      const token = manager.createSessionToken("dev-1");
      expect(token.token).toBeTruthy();
      expect(token.deviceId).toBe("dev-1");

      const validation = manager.validateSessionToken(token.token);
      expect(validation.valid).toBe(true);
      expect(validation.deviceId).toBe("dev-1");
    });

    it("should reject unknown tokens", () => {
      const manager = new SecureAuthManager();
      const validation = manager.validateSessionToken("nonexistent");
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("not found");
    });

    it("should refresh tokens", () => {
      const manager = new SecureAuthManager();
      const original = manager.createSessionToken("dev-1");
      const refreshed = manager.refreshToken(original.token);

      expect(refreshed).not.toBeNull();
      expect(refreshed?.token).not.toBe(original.token);
      expect(refreshed?.deviceId).toBe("dev-1");

      // Old token should be invalid
      const oldValidation = manager.validateSessionToken(original.token);
      expect(oldValidation.valid).toBe(false);
    });

    it("should return null when refreshing invalid token", () => {
      const manager = new SecureAuthManager();
      expect(manager.refreshToken("bad-token")).toBeNull();
    });
  });

  // ── Device Revocation ────────────────────────────────

  describe("revokeDevice", () => {
    it("should revoke a paired device and its sessions", () => {
      const manager = new SecureAuthManager();
      const payload = manager.generateQRPayload("localhost", 3849);
      const deviceKeys = generateDeviceKeyPair();
      const request: PairingRequest = {
        deviceId: "dev-1",
        deviceName: "Phone",
        devicePublicKey: deviceKeys.publicKey,
        pin: payload.pin,
        requestId: payload.requestId,
      };
      const pairingResult = manager.verifyPairing(request);
      expect(pairingResult.success).toBe(true);

      // Session was created during pairing
      expect(manager.getSessionCount()).toBe(1);

      const revoked = manager.revokeDevice("dev-1");
      expect(revoked).toBe(true);
      expect(manager.getDeviceCount()).toBe(0);
      expect(manager.getSessionCount()).toBe(0);
    });

    it("should return false for unknown device", () => {
      const manager = new SecureAuthManager();
      expect(manager.revokeDevice("nonexistent")).toBe(false);
    });
  });

  // ── Encryption ───────────────────────────────────────

  describe("encrypt / decrypt", () => {
    it("should encrypt and decrypt a message round-trip", () => {
      const manager = new SecureAuthManager();
      const secret = Buffer.from("super-secret-key-for-testing-aes");
      const plaintext = "Hello from WOTANN iOS!";

      const encrypted = manager.encrypt(plaintext, secret);
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.tag).toBeTruthy();

      const decrypted = manager.decrypt(encrypted, secret);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext (random IV)", () => {
      const manager = new SecureAuthManager();
      const secret = Buffer.from("another-secret-key-for-test!!!!!");
      const plaintext = "Same message twice";

      const e1 = manager.encrypt(plaintext, secret);
      const e2 = manager.encrypt(plaintext, secret);
      expect(e1.ciphertext).not.toBe(e2.ciphertext);
      expect(e1.iv).not.toBe(e2.iv);
    });

    it("should fail to decrypt with wrong key", () => {
      const manager = new SecureAuthManager();
      const secret1 = Buffer.from("correct-key-32bytes-long!!!!!!!!");
      const secret2 = Buffer.from("wrong-key-32-bytes-long-here!!!!");

      const encrypted = manager.encrypt("secret data", secret1);
      expect(() => manager.decrypt(encrypted, secret2)).toThrow();
    });

    it("should handle empty string encryption", () => {
      const manager = new SecureAuthManager();
      const secret = Buffer.from("key-for-empty-string-test!!!!!!!");
      const encrypted = manager.encrypt("", secret);
      const decrypted = manager.decrypt(encrypted, secret);
      expect(decrypted).toBe("");
    });

    it("should handle long messages", () => {
      const manager = new SecureAuthManager();
      const secret = Buffer.from("key-for-long-message-test!!!!!!!");
      const long = "A".repeat(10_000);
      const encrypted = manager.encrypt(long, secret);
      const decrypted = manager.decrypt(encrypted, secret);
      expect(decrypted).toBe(long);
    });
  });
});
