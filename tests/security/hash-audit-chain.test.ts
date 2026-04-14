import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import {
  HashAuditChain,
  type AuditEntry,
  type ChainVerificationResult,
} from "../../src/security/hash-audit-chain.js";

describe("HashAuditChain", () => {
  let chain: HashAuditChain;

  beforeEach(() => {
    chain = new HashAuditChain();
  });

  // ── Basic Operations ──────────────────────────────────

  describe("append", () => {
    it("appends an entry with correct fields", () => {
      const entry = chain.append("login", "user-1", { ip: "192.168.1.1" });

      expect(entry.action).toBe("login");
      expect(entry.actor).toBe("user-1");
      expect(entry.data).toEqual({ ip: "192.168.1.1" });
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.hash).toBeDefined();
      expect(entry.previousHash).toBeDefined();
    });

    it("links entries via previous hash", () => {
      const first = chain.append("action-1", "actor-1");
      const second = chain.append("action-2", "actor-1");

      expect(second.previousHash).toBe(first.hash);
    });

    it("first entry has genesis previous hash", () => {
      const first = chain.append("genesis-action", "system");
      // Genesis hash is all zeros
      expect(first.previousHash).toMatch(/^0+$/);
    });

    it("increments length on each append", () => {
      expect(chain.getLength()).toBe(0);
      chain.append("a", "x");
      expect(chain.getLength()).toBe(1);
      chain.append("b", "x");
      expect(chain.getLength()).toBe(2);
    });
  });

  // ── Chain Verification ────────────────────────────────

  describe("verify", () => {
    it("verifies empty chain as valid", () => {
      const result = chain.verify();
      expect(result.valid).toBe(true);
      expect(result.length).toBe(0);
      expect(result.brokenAt).toBeNull();
    });

    it("verifies single-entry chain", () => {
      chain.append("action-1", "actor-1");
      const result = chain.verify();
      expect(result.valid).toBe(true);
      expect(result.length).toBe(1);
    });

    it("verifies multi-entry chain", () => {
      chain.append("action-1", "actor-1");
      chain.append("action-2", "actor-2");
      chain.append("action-3", "actor-3");

      const result = chain.verify();
      expect(result.valid).toBe(true);
      expect(result.length).toBe(3);
    });

    it("detects tampered data", () => {
      chain.append("action-1", "actor-1");
      chain.append("action-2", "actor-2");

      // Tamper with an entry by accessing internal state
      const entries = chain.getEntries();
      const tampered = {
        ...entries[0]!,
        action: "tampered-action",
      };

      // Create a new chain with tampered data
      const tamperedChain = new HashAuditChain();
      // Use Object.defineProperty to inject tampered entries
      (tamperedChain as unknown as { entries: AuditEntry[] }).entries = [
        tampered,
        entries[1]!,
      ];

      const result = tamperedChain.verify();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
    });
  });

  // ── Export ────────────────────────────────────────────

  describe("exportChain", () => {
    it("exports chain with correct structure", () => {
      chain.append("action-1", "actor-1");
      chain.append("action-2", "actor-2");

      const exported = chain.exportChain();

      expect(exported.version).toBe("1.0.0");
      expect(exported.createdAt).toBeGreaterThan(0);
      expect(exported.exportedAt).toBeGreaterThanOrEqual(exported.createdAt);
      expect(exported.entryCount).toBe(2);
      expect(exported.valid).toBe(true);
      expect(exported.entries).toHaveLength(2);
    });

    it("toJSON returns valid JSON string", () => {
      chain.append("action-1", "actor-1");
      const json = chain.toJSON();
      const parsed = JSON.parse(json);
      expect(parsed.entryCount).toBe(1);
    });
  });

  // ── File Persistence ──────────────────────────────────

  describe("file persistence", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "hash-audit-"));
    });

    it("saves and loads chain from file", () => {
      chain.append("action-1", "actor-1", { key: "value" });
      chain.append("action-2", "actor-2");

      const filePath = join(tmpDir, "chain.json");
      chain.saveToFile(filePath);

      const loadedChain = new HashAuditChain();
      const success = loadedChain.loadFromFile(filePath);

      expect(success).toBe(true);
      expect(loadedChain.getLength()).toBe(2);
      expect(loadedChain.verify().valid).toBe(true);
    });

    it("returns false for non-existent file", () => {
      const loadedChain = new HashAuditChain();
      expect(loadedChain.loadFromFile("/nonexistent/path.json")).toBe(false);
    });

    it("returns false for invalid JSON", () => {
      const filePath = join(tmpDir, "bad.json");
      require("node:fs").writeFileSync(filePath, "not json");

      const loadedChain = new HashAuditChain();
      expect(loadedChain.loadFromFile(filePath)).toBe(false);
    });

    // Cleanup
    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });
  });

  // ── Query Methods ─────────────────────────────────────

  describe("query methods", () => {
    beforeEach(() => {
      chain.append("login", "alice", { ip: "10.0.0.1" });
      chain.append("edit", "bob", { file: "main.ts" });
      chain.append("login", "charlie", { ip: "10.0.0.2" });
      chain.append("deploy", "alice", { env: "prod" });
    });

    it("getEntriesByAction filters correctly", () => {
      const logins = chain.getEntriesByAction("login");
      expect(logins).toHaveLength(2);
      expect(logins.every((e) => e.action === "login")).toBe(true);
    });

    it("getEntriesByActor filters correctly", () => {
      const aliceEntries = chain.getEntriesByActor("alice");
      expect(aliceEntries).toHaveLength(2);
      expect(aliceEntries.every((e) => e.actor === "alice")).toBe(true);
    });

    it("getLastEntry returns the most recent entry", () => {
      const last = chain.getLastEntry();
      expect(last).not.toBeNull();
      expect(last!.action).toBe("deploy");
      expect(last!.actor).toBe("alice");
    });

    it("getLastEntry returns null for empty chain", () => {
      const emptyChain = new HashAuditChain();
      expect(emptyChain.getLastEntry()).toBeNull();
    });

    it("getEntriesInRange filters by timestamp", () => {
      const entries = chain.getEntries();
      const start = entries[1]!.timestamp;
      const end = entries[2]!.timestamp;

      const ranged = chain.getEntriesInRange(start, end);
      expect(ranged.length).toBeGreaterThanOrEqual(1);
      expect(ranged.every((e) => e.timestamp >= start && e.timestamp <= end)).toBe(true);
    });
  });

  // ── Chain ID ──────────────────────────────────────────

  describe("chain ID", () => {
    it("has a unique chain ID", () => {
      const chain2 = new HashAuditChain();
      expect(chain.getChainId()).not.toBe(chain2.getChainId());
    });

    it("chain ID is a valid UUID format", () => {
      const id = chain.getChainId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  // ── Immutability ──────────────────────────────────────

  describe("immutability", () => {
    it("getEntries returns a copy, not the internal array", () => {
      chain.append("action-1", "actor-1");
      const entries1 = chain.getEntries();
      chain.append("action-2", "actor-2");
      const entries2 = chain.getEntries();

      // entries1 should not reflect the second append
      expect(entries1).toHaveLength(1);
      expect(entries2).toHaveLength(2);
    });
  });
});
