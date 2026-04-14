/**
 * Hash Audit Chain -- immutable hash-chain audit trail.
 *
 * Each entry is linked to the previous via SHA-256 hashing, creating a
 * tamper-evident log. If any entry is modified after the fact, the
 * chain verification will fail.
 *
 * Features:
 * - Append-only chain with SHA-256 integrity
 * - Full chain verification (detects tampering at any point)
 * - JSON export for compliance reporting
 * - File persistence (load/save)
 * - No external dependencies (uses node:crypto + node:fs)
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── Types ────────────────────────────────────────────────

export interface AuditEntry {
  readonly timestamp: number;
  readonly action: string;
  readonly actor: string;
  readonly data: Record<string, unknown>;
  readonly previousHash: string;
  readonly hash: string;
}

export interface ChainVerificationResult {
  readonly valid: boolean;
  readonly length: number;
  readonly brokenAt: number | null;
  readonly message: string;
}

export interface ChainExport {
  readonly version: string;
  readonly createdAt: number;
  readonly exportedAt: number;
  readonly entryCount: number;
  readonly valid: boolean;
  readonly entries: readonly AuditEntry[];
}

// ── Constants ────────────────────────────────────────────

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const CHAIN_VERSION = "1.0.0";

// ── Hash Computation ─────────────────────────────────────

function computeHash(
  timestamp: number,
  action: string,
  actor: string,
  data: Record<string, unknown>,
  previousHash: string,
): string {
  const payload = JSON.stringify({ timestamp, action, actor, data, previousHash });
  return createHash("sha256").update(payload).digest("hex");
}

// ── HashAuditChain Class ─────────────────────────────────

export class HashAuditChain {
  private entries: AuditEntry[] = [];
  private readonly createdAt: number;
  private readonly chainId: string;

  constructor() {
    this.createdAt = Date.now();
    this.chainId = randomUUID();
  }

  /**
   * Append a new entry to the chain.
   * The entry is hashed with the previous entry's hash for integrity.
   */
  append(action: string, actor: string, data: Record<string, unknown> = {}): AuditEntry {
    const timestamp = Date.now();
    const previousHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1]!.hash
      : GENESIS_HASH;

    const hash = computeHash(timestamp, action, actor, data, previousHash);

    const entry: AuditEntry = {
      timestamp,
      action,
      actor,
      data: { ...data },
      previousHash,
      hash,
    };

    this.entries = [...this.entries, entry];
    return entry;
  }

  /**
   * Verify the entire chain integrity.
   * Returns a detailed result including where the chain broke (if at all).
   */
  verify(): ChainVerificationResult {
    if (this.entries.length === 0) {
      return { valid: true, length: 0, brokenAt: null, message: "Empty chain is valid" };
    }

    let previousHash = GENESIS_HASH;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;

      // Check previous hash linkage
      if (entry.previousHash !== previousHash) {
        return {
          valid: false,
          length: this.entries.length,
          brokenAt: i,
          message: `Chain broken at entry ${i}: previousHash mismatch`,
        };
      }

      // Recompute and check hash
      const expectedHash = computeHash(
        entry.timestamp,
        entry.action,
        entry.actor,
        entry.data,
        previousHash,
      );

      if (entry.hash !== expectedHash) {
        return {
          valid: false,
          length: this.entries.length,
          brokenAt: i,
          message: `Chain broken at entry ${i}: hash mismatch (data tampered)`,
        };
      }

      previousHash = entry.hash;
    }

    return {
      valid: true,
      length: this.entries.length,
      brokenAt: null,
      message: `Chain valid: ${this.entries.length} entries verified`,
    };
  }

  /**
   * Export the entire chain as a JSON compliance report.
   */
  exportChain(): ChainExport {
    const verification = this.verify();
    return {
      version: CHAIN_VERSION,
      createdAt: this.createdAt,
      exportedAt: Date.now(),
      entryCount: this.entries.length,
      valid: verification.valid,
      entries: [...this.entries],
    };
  }

  /**
   * Export to JSON string for file persistence.
   */
  toJSON(): string {
    return JSON.stringify(this.exportChain(), null, 2);
  }

  /**
   * Save the chain to a file.
   */
  saveToFile(path: string): void {
    writeFileSync(path, this.toJSON(), "utf-8");
  }

  /**
   * Load a chain from a file. Returns false if the file doesn't exist
   * or the loaded chain fails integrity verification.
   */
  loadFromFile(path: string): boolean {
    if (!existsSync(path)) return false;

    try {
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content) as ChainExport;

      if (!Array.isArray(parsed.entries)) return false;

      // Validate each entry has the required fields
      for (const entry of parsed.entries) {
        if (
          typeof entry.timestamp !== "number" ||
          typeof entry.action !== "string" ||
          typeof entry.actor !== "string" ||
          typeof entry.previousHash !== "string" ||
          typeof entry.hash !== "string"
        ) {
          return false;
        }
      }

      this.entries = parsed.entries as AuditEntry[];

      // Verify integrity after loading
      const verification = this.verify();
      if (!verification.valid) {
        this.entries = [];
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all entries in the chain.
   */
  getEntries(): readonly AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get the number of entries in the chain.
   */
  getLength(): number {
    return this.entries.length;
  }

  /**
   * Get the chain ID.
   */
  getChainId(): string {
    return this.chainId;
  }

  /**
   * Get the last entry in the chain, or null if empty.
   */
  getLastEntry(): AuditEntry | null {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1]! : null;
  }

  /**
   * Get entries filtered by action type.
   */
  getEntriesByAction(action: string): readonly AuditEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  /**
   * Get entries filtered by actor.
   */
  getEntriesByActor(actor: string): readonly AuditEntry[] {
    return this.entries.filter((e) => e.actor === actor);
  }

  /**
   * Get entries within a time range.
   */
  getEntriesInRange(startMs: number, endMs: number): readonly AuditEntry[] {
    return this.entries.filter((e) => e.timestamp >= startMs && e.timestamp <= endMs);
  }
}
