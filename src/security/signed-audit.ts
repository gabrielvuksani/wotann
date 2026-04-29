/**
 * Signed audit log — port of protect-mcp's Ed25519 audit signing layer.
 *
 * Existing module `hash-audit-chain.ts` already provides a tamper-
 * evident SHA-256 chain. This module *adds* a public-key signature on
 * each entry so a third party can verify that the entries came from a
 * specific signer (not just that the chain wasn't modified after the
 * fact). Use cases:
 *
 *   - Multi-agent teams where you want to prove which agent emitted
 *     which audit line.
 *   - Compliance: regulators want non-repudiation, not just integrity.
 *
 * Implementation notes:
 *   - We use Node's built-in Ed25519 (sign/verify via `node:crypto`)
 *     so there's no native binding or extra dep.
 *   - Keys live at ~/.wotann/audit-keys/<id>.{pub,sec}; permissions are
 *     tightened to 0600. The .sec is the only secret; .pub can be
 *     shared widely for verification.
 *   - The signed envelope wraps an arbitrary record. We sign the
 *     canonical JSON of that record so any field reordering still
 *     produces the same signature.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

const KEY_DIR_NAME = "audit-keys";

export interface SignedRecord<T = Record<string, unknown>> {
  readonly keyId: string;
  readonly recordCanonical: string;
  readonly signature: string; // base64
  readonly record: T;
  readonly signedAt: string;
}

export interface AuditKey {
  readonly id: string;
  readonly publicPem: string;
  readonly privatePem: string;
}

function keyDir(): string {
  const dir = resolveWotannHomeSubdir(KEY_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function generateAuditKey(id: string): AuditKey {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`Invalid key id "${id}"`);
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const dir = keyDir();
  writeFileSync(join(dir, `${id}.pub`), publicPem, { encoding: "utf8", mode: 0o644 });
  writeFileSync(join(dir, `${id}.sec`), privatePem, { encoding: "utf8", mode: 0o600 });
  return { id, publicPem, privatePem };
}

export function loadAuditKey(id: string): AuditKey | null {
  const dir = keyDir();
  const pubPath = join(dir, `${id}.pub`);
  const secPath = join(dir, `${id}.sec`);
  if (!existsSync(pubPath) || !existsSync(secPath)) return null;
  return {
    id,
    publicPem: readFileSync(pubPath, "utf8"),
    privatePem: readFileSync(secPath, "utf8"),
  };
}

export function getOrCreateKey(id = "default"): AuditKey {
  return loadAuditKey(id) ?? generateAuditKey(id);
}

/**
 * Canonical JSON: sorted keys at every level. This is what we sign so
 * that two semantically-equal records always produce the same digest.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]));
  return "{" + parts.join(",") + "}";
}

export function signRecord<T extends Record<string, unknown>>(
  record: T,
  key: AuditKey,
): SignedRecord<T> {
  const recordCanonical = canonicalize(record);
  const privateKey = createPrivateKey({ key: key.privatePem });
  const sig = cryptoSign(null, Buffer.from(recordCanonical, "utf8"), privateKey);
  return {
    keyId: key.id,
    recordCanonical,
    signature: sig.toString("base64"),
    record,
    signedAt: new Date().toISOString(),
  };
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly reason: string;
}

export function verifyRecord(envelope: SignedRecord, publicPem?: string): VerifyResult {
  const pem = publicPem ?? loadAuditKey(envelope.keyId)?.publicPem;
  if (!pem) {
    return { valid: false, reason: `No public key for keyId "${envelope.keyId}"` };
  }
  try {
    const publicKey = createPublicKey({ key: pem });
    const ok = cryptoVerify(
      null,
      Buffer.from(envelope.recordCanonical, "utf8"),
      publicKey,
      Buffer.from(envelope.signature, "base64"),
    );
    if (!ok) return { valid: false, reason: "Signature verification failed" };
    if (canonicalize(envelope.record) !== envelope.recordCanonical) {
      return { valid: false, reason: "Record content does not match its canonical form" };
    }
    return { valid: true, reason: "ok" };
  } catch (err) {
    return {
      valid: false,
      reason: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
