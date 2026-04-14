import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../../src/memory/store.js";

describe("MemoryStore", () => {
  let store: MemoryStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-mem-test-"));
    store = new MemoryStore(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("insert and retrieve", () => {
    it("inserts and retrieves an entry", () => {
      store.insert({
        id: "test-1",
        layer: "core_blocks",
        blockType: "user",
        key: "name",
        value: "Gabriel",
        verified: false,
      });

      const entry = store.getById("test-1");
      expect(entry).not.toBeNull();
      expect(entry!.key).toBe("name");
      expect(entry!.value).toBe("Gabriel");
      expect(entry!.blockType).toBe("user");
    });

    it("returns null for non-existent entry", () => {
      const entry = store.getById("nonexistent");
      expect(entry).toBeNull();
    });
  });

  describe("replace", () => {
    it("updates existing entry", () => {
      store.insert({
        id: "test-1",
        layer: "core_blocks",
        blockType: "user",
        key: "role",
        value: "Developer",
        verified: false,
      });

      store.replace("test-1", "role", "Senior Developer");
      const entry = store.getById("test-1");
      expect(entry!.value).toBe("Senior Developer");
    });
  });

  describe("archive", () => {
    it("hides archived entries from queries", () => {
      store.insert({
        id: "test-1",
        layer: "core_blocks",
        blockType: "project",
        key: "status",
        value: "active",
        verified: false,
      });

      store.archive("test-1");
      const entry = store.getById("test-1");
      expect(entry).toBeNull();
    });
  });

  describe("layer queries", () => {
    it("retrieves entries by layer", () => {
      store.insert({ id: "a", layer: "core_blocks", blockType: "user", key: "k1", value: "v1", verified: false });
      store.insert({ id: "b", layer: "working", blockType: "project", key: "k2", value: "v2", verified: false });
      store.insert({ id: "c", layer: "core_blocks", blockType: "feedback", key: "k3", value: "v3", verified: false });

      const coreBlocks = store.getByLayer("core_blocks");
      expect(coreBlocks).toHaveLength(2);

      const working = store.getByLayer("working");
      expect(working).toHaveLength(1);
    });

    it("retrieves entries by block type", () => {
      store.insert({ id: "a", layer: "core_blocks", blockType: "user", key: "k1", value: "v1", verified: false });
      store.insert({ id: "b", layer: "core_blocks", blockType: "user", key: "k2", value: "v2", verified: false });
      store.insert({ id: "c", layer: "core_blocks", blockType: "feedback", key: "k3", value: "v3", verified: false });

      const users = store.getByBlock("user");
      expect(users).toHaveLength(2);
    });
  });

  describe("FTS5 search", () => {
    it("finds entries by keyword", () => {
      store.insert({ id: "a", layer: "core_blocks", blockType: "cases", key: "auth bug", value: "Fixed authentication token expiry issue", verified: false });
      store.insert({ id: "b", layer: "core_blocks", blockType: "cases", key: "deploy script", value: "Updated deployment pipeline", verified: false });

      const results = store.search("authentication");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.entry.key).toBe("auth bug");
    });

    it("returns empty for no matches", () => {
      store.insert({ id: "a", layer: "core_blocks", blockType: "user", key: "name", value: "Gabriel", verified: false });

      const results = store.search("nonexistent");
      expect(results).toHaveLength(0);
    });
  });

  describe("memory tools", () => {
    it("memoryReplace creates if not exists", () => {
      store.memoryReplace("user", "timezone", "EST");

      const entries = store.getByBlock("user");
      expect(entries).toHaveLength(1);
      expect(entries[0]!.value).toBe("EST");
    });

    it("memoryReplace updates existing", () => {
      store.memoryReplace("user", "role", "Developer");
      store.memoryReplace("user", "role", "Senior Dev");

      const entries = store.getByBlock("user");
      expect(entries).toHaveLength(1);
      expect(entries[0]!.value).toBe("Senior Dev");
    });

    it("memoryInsert always adds", () => {
      store.memoryInsert("feedback", "tip", "Use immutable patterns");
      store.memoryInsert("feedback", "tip", "Write tests first");

      const entries = store.getByBlock("feedback");
      expect(entries).toHaveLength(2);
    });

    it("memoryVerify marks entry as verified", () => {
      store.insert({ id: "v1", layer: "core_blocks", blockType: "patterns", key: "pattern", value: "Use hooks", verified: false });

      const verified = store.memoryVerify("v1");
      expect(verified!.verified).toBe(true);
    });
  });

  describe("decision log", () => {
    it("logs and retrieves decisions", () => {
      store.logDecision({
        id: "d1",
        decision: "Use SQLite for memory",
        rationale: "Zero config, local-first, FTS5 support",
        alternatives: "Postgres, MongoDB",
        constraints: "Must work offline",
      });

      const decisions = store.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!["decision"]).toBe("Use SQLite for memory");
    });
  });

  describe("entry count", () => {
    it("counts non-archived entries", () => {
      store.insert({ id: "a", layer: "core_blocks", blockType: "user", key: "k", value: "v", verified: false });
      store.insert({ id: "b", layer: "core_blocks", blockType: "user", key: "k2", value: "v2", verified: false });
      store.archive("b");

      expect(store.getEntryCount()).toBe(1);
    });
  });
});
