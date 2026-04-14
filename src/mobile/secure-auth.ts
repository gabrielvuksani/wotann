/**
 * Secure Authentication for iOS <-> Desktop pairing.
 *
 * Flow:
 * 1. Desktop generates QR code with: host, port, one-time PIN, public key
 * 2. iOS scans QR -> extracts pairing info
 * 3. iOS sends pairing request with its public key + PIN
 * 4. Desktop verifies PIN -> ECDH key exchange -> shared secret
 * 5. All subsequent communication encrypted with AES-256-GCM
 * 6. Session tokens for reconnection without re-pairing
 *
 * All types are immutable (readonly). Functions return new objects.
 */

import {
  randomUUID,
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  createECDH,
} from "node:crypto";

// ── Types ──────────────────────────────────────────────

export interface KeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

export interface QRPayload {
  readonly requestId: string;
  readonly pin: string;
  readonly host: string;
  readonly port: number;
  readonly publicKey: string;
  readonly expiresAt: string;
}

export interface PairingRequest {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly devicePublicKey: string;
  readonly pin: string;
  readonly requestId: string;
}

export interface PairingResult {
  readonly success: boolean;
  readonly sessionToken: string | null;
  readonly sharedSecretHash: string | null;
  readonly error: string | null;
}

export interface SessionToken {
  readonly token: string;
  readonly deviceId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface TokenValidation {
  readonly valid: boolean;
  readonly deviceId: string | null;
  readonly error: string | null;
}

export interface EncryptedPayload {
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
}

interface StoredPairing {
  readonly requestId: string;
  readonly pin: string;
  readonly publicKey: string;
  readonly privateKey: string;
  readonly expiresAt: string;
}

interface StoredDevice {
  readonly deviceId: string;
  readonly sharedSecret: string;
  readonly registeredAt: string;
}

// ── SecureAuthManager ──────────────────────────────────

export class SecureAuthManager {
  private readonly pendingPairings: Map<string, StoredPairing> = new Map();
  private readonly sessionTokens: Map<string, SessionToken> = new Map();
  private readonly devices: Map<string, StoredDevice> = new Map();
  private readonly sessionDurationMs: number;

  constructor(sessionDurationMs: number = 24 * 60 * 60_000) {
    this.sessionDurationMs = sessionDurationMs;
  }

  /**
   * Generate a real ECDH key pair on the prime256v1 (P-256) curve.
   * Returns hex-encoded public and private keys.
   */
  generateKeyPair(): KeyPair {
    const ecdh = createECDH("prime256v1");
    const publicKey = ecdh.generateKeys("hex");
    // P-256 private key is 32 bytes; OpenSSL drops leading zero bytes
    // in hex form (occasional 62/60 chars instead of 64). Pad to fixed
    // 64-char length so callers can rely on the size invariant.
    const privateKey = ecdh.getPrivateKey("hex").padStart(64, "0");
    return { publicKey, privateKey };
  }

  /**
   * Derive a shared secret from our private key and their public key
   * using ECDH on prime256v1. Returns the hex-encoded shared secret.
   */
  deriveSharedSecret(ourPrivateKey: string, theirPublicKey: string): string {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(ourPrivateKey, "hex");
    return ecdh.computeSecret(theirPublicKey, "hex", "hex");
  }

  /**
   * Generate QR payload containing everything the iOS app needs to pair.
   */
  generateQRPayload(host: string, port: number): QRPayload {
    const keyPair = this.generateKeyPair();
    const pin = randomBytes(3).toString("hex").toUpperCase();
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    this.pendingPairings.set(requestId, {
      requestId,
      pin,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      expiresAt,
    });

    return { requestId, pin, host, port, publicKey: keyPair.publicKey, expiresAt };
  }

  /**
   * Verify a pairing request from the iOS device.
   * Checks PIN, expiry, and registers the device on success.
   */
  verifyPairing(request: PairingRequest): PairingResult {
    const pending = this.pendingPairings.get(request.requestId);
    if (!pending) {
      return {
        success: false,
        sessionToken: null,
        sharedSecretHash: null,
        error: "Unknown pairing request",
      };
    }

    if (new Date(pending.expiresAt) < new Date()) {
      this.pendingPairings.delete(request.requestId);
      return {
        success: false,
        sessionToken: null,
        sharedSecretHash: null,
        error: "Pairing request expired",
      };
    }

    if (pending.pin !== request.pin) {
      return { success: false, sessionToken: null, sharedSecretHash: null, error: "Invalid PIN" };
    }

    // Derive shared secret via real ECDH key exchange on prime256v1
    const sharedSecret = this.deriveSharedSecret(pending.privateKey, request.devicePublicKey);

    this.devices.set(request.deviceId, {
      deviceId: request.deviceId,
      sharedSecret,
      registeredAt: new Date().toISOString(),
    });

    this.pendingPairings.delete(request.requestId);

    const token = this.createSessionToken(request.deviceId);
    return {
      success: true,
      sessionToken: token.token,
      sharedSecretHash: sharedSecret.slice(0, 16),
      error: null,
    };
  }

  /**
   * Create a session token for a paired device.
   */
  createSessionToken(deviceId: string): SessionToken {
    const token: SessionToken = {
      token: randomUUID(),
      deviceId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.sessionDurationMs).toISOString(),
    };
    this.sessionTokens.set(token.token, token);
    return token;
  }

  /**
   * Validate an existing session token.
   */
  validateSessionToken(token: string): TokenValidation {
    const session = this.sessionTokens.get(token);
    if (!session) {
      return { valid: false, deviceId: null, error: "Token not found" };
    }
    if (new Date(session.expiresAt) < new Date()) {
      this.sessionTokens.delete(token);
      return { valid: false, deviceId: null, error: "Token expired" };
    }
    return { valid: true, deviceId: session.deviceId, error: null };
  }

  /**
   * Revoke a paired device and all its sessions.
   */
  revokeDevice(deviceId: string): boolean {
    const existed = this.devices.delete(deviceId);
    for (const [tokenKey, session] of this.sessionTokens) {
      if (session.deviceId === deviceId) {
        this.sessionTokens.delete(tokenKey);
      }
    }
    return existed;
  }

  /**
   * Refresh a session token, returning a new one and invalidating the old.
   */
  refreshToken(oldToken: string): SessionToken | null {
    const validation = this.validateSessionToken(oldToken);
    if (!validation.valid || !validation.deviceId) {
      return null;
    }
    this.sessionTokens.delete(oldToken);
    return this.createSessionToken(validation.deviceId);
  }

  /**
   * Encrypt a string using AES-256-GCM with the given shared secret.
   */
  encrypt(data: string, sharedSecret: Buffer): EncryptedPayload {
    const key = createHash("sha256").update(sharedSecret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
    };
  }

  /**
   * Decrypt an AES-256-GCM payload using the shared secret.
   */
  decrypt(payload: EncryptedPayload, sharedSecret: Buffer): string {
    const key = createHash("sha256").update(sharedSecret).digest();
    const iv = Buffer.from(payload.iv, "base64");
    const tag = Buffer.from(payload.tag, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  /** Expose device count for testing. */
  getDeviceCount(): number {
    return this.devices.size;
  }

  /** Expose active session count for testing. */
  getSessionCount(): number {
    return this.sessionTokens.size;
  }
}
