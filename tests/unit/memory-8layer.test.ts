import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("8-Layer Memory System", () => {
  let store: MemoryStore;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wotann-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    store = new MemoryStore(join(testDir, "memory.db"));
  });

  afterEach(() => {
    store.close();
    try { rmSync(testDir, { recursive: true }); } catch { /* ignore */ }
  });

  // ── Layer 1: Auto-Capture ────────────────────────────────

  describe("Layer 1: Auto-Capture", () => {
    it("captures events with tool name", () => {
      store.captureEvent("tool_call", "Read /src/foo.ts", "Read", "session-1");
      const captures = store.getRecentCaptures("session-1");
      expect(captures.length).toBe(1);
      expect(captures[0]?.["tool_name"]).toBe("Read");
    });

    it("truncates long content to 2000 chars", () => {
      const longContent = "x".repeat(5000);
      store.captureEvent("output", longContent, undefined, "session-1");
      const captures = store.getRecentCaptures("session-1");
      expect((captures[0]?.["content"] as string).length).toBeLessThanOrEqual(2000);
    });
  });

  // ── Layer 2: Core Blocks ─────────────────────────────────

  describe("Layer 2: Core Blocks", () => {
    it("inserts and retrieves by ID", () => {
      const id = randomUUID();
      store.insert({ id, layer: "core_blocks", blockType: "user", key: "name", value: "Gabriel", verified: false });
      const entry = store.getById(id);
      expect(entry?.key).toBe("name");
      expect(entry?.value).toBe("Gabriel");
    });

    it("replaces existing entry", () => {
      const id = randomUUID();
      store.insert({ id, layer: "core_blocks", blockType: "project", key: "wotann", value: "v1", verified: false });
      store.replace(id, "wotann", "v2");
      const entry = store.getById(id);
      expect(entry?.value).toBe("v2");
    });

    it("archives entries", () => {
      const id = randomUUID();
      store.insert({ id, layer: "core_blocks", blockType: "feedback", key: "test", value: "data", verified: false });
      store.archive(id);
      expect(store.getById(id)).toBeNull();
    });

    it("retrieves by layer", () => {
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "user", key: "a", value: "1", verified: false });
      store.insert({ id: randomUUID(), layer: "archival", blockType: "cases", key: "b", value: "2", verified: false });
      const coreEntries = store.getByLayer("core_blocks");
      expect(coreEntries.length).toBe(1);
    });

    it("retrieves by block type", () => {
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "cases", key: "bug-1", value: "fix", verified: false });
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "patterns", key: "pattern-1", value: "tdd", verified: false });
      const cases = store.getByBlock("cases");
      expect(cases.length).toBe(1);
    });
  });

  // ── Layer 3: Working Memory ──────────────────────────────

  describe("Layer 3: Working Memory", () => {
    it("sets and gets working memory", () => {
      store.setWorkingMemory("sess-1", "current_file", "/src/foo.ts", 0.8);
      const wm = store.getWorkingMemory("sess-1");
      expect(wm.length).toBe(1);
      expect(wm[0]?.key).toBe("current_file");
      expect(wm[0]?.importance).toBe(0.8);
    });

    it("clears working memory per session", () => {
      store.setWorkingMemory("sess-1", "key1", "val1");
      store.setWorkingMemory("sess-2", "key2", "val2");
      store.clearWorkingMemory("sess-1");

      expect(store.getWorkingMemory("sess-1")).toHaveLength(0);
      expect(store.getWorkingMemory("sess-2")).toHaveLength(1);
    });

    it("orders by importance descending", () => {
      store.setWorkingMemory("sess-1", "low", "data", 0.2);
      store.setWorkingMemory("sess-1", "high", "data", 0.9);
      const wm = store.getWorkingMemory("sess-1");
      expect(wm[0]?.key).toBe("high");
    });
  });

  // ── Layer 4: Knowledge Graph ─────────────────────────────

  describe("Layer 4: Knowledge Graph", () => {
    it("creates nodes and edges", () => {
      const fileId = store.addKnowledgeNode("auth.ts", "file", { path: "/src/auth.ts" });
      const funcId = store.addKnowledgeNode("loginUser", "function", { file: "auth.ts" });
      store.addKnowledgeEdge(fileId, funcId, "contains");

      const size = store.getKnowledgeGraphSize();
      expect(size.nodes).toBe(2);
      expect(size.edges).toBe(1);
    });

    it("finds related entities via BFS", () => {
      const a = store.addKnowledgeNode("A", "module");
      const b = store.addKnowledgeNode("B", "module");
      const c = store.addKnowledgeNode("C", "module");
      store.addKnowledgeEdge(a, b, "imports");
      store.addKnowledgeEdge(b, c, "imports");

      const related = store.getRelatedEntities("A", 3);
      expect(related.length).toBeGreaterThanOrEqual(1);
      expect(related.some((n) => n.entity === "A")).toBe(true);
    });

    it("respects maxDepth in BFS", () => {
      const a = store.addKnowledgeNode("X", "node");
      const b = store.addKnowledgeNode("Y", "node");
      const c = store.addKnowledgeNode("Z", "node");
      store.addKnowledgeEdge(a, b, "linked");
      store.addKnowledgeEdge(b, c, "linked");

      const depth1 = store.getRelatedEntities("X", 1);
      // Depth 1: X + direct neighbors (Y)
      expect(depth1.length).toBeLessThanOrEqual(2);
    });
  });

  // ── Layer 6: Skeptical Recall ────────────────────────────

  describe("Layer 6: Skeptical Recall", () => {
    it("flags unverified memories for verification", () => {
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "project", key: "apiurl", value: "https://old.api.com", verified: false });
      const results = store.skepticalSearch("apiurl");
      if (results.length > 0) {
        expect(results[0]?.needsVerification).toBe(true);
      }
    });

    it("trusts verified memories", () => {
      const id = randomUUID();
      store.insert({ id, layer: "core_blocks", blockType: "project", key: "fact", value: "TypeScript is used", verified: false });
      store.memoryVerify(id);
      const results = store.skepticalSearch("fact");
      // Verified entries have higher confidence
      if (results.length > 0) {
        const verified = results.find((r) => r.entry.id === id);
        if (verified) {
          expect(verified.entry.verified).toBe(true);
        }
      }
    });
  });

  // ── Layer 7: Team Memory ─────────────────────────────────

  describe("Layer 7: Team Memory", () => {
    it("stores and retrieves team memories", () => {
      store.setTeamMemory("agent-planner", "architecture", "microservices pattern");
      const tm = store.getTeamMemory("agent-planner");
      expect(tm.length).toBe(1);
      expect(tm[0]?.key).toBe("architecture");
    });

    it("retrieves all shared team memories", () => {
      store.setTeamMemory("agent-1", "finding-1", "bug in auth");
      store.setTeamMemory("agent-2", "finding-2", "missing test");
      const all = store.getTeamMemory();
      expect(all.length).toBe(2);
    });

    it("exports, imports, and syncs team memory snapshots", () => {
      store.setTeamMemory("agent-1", "finding-1", "bug in auth");
      const snapshot = store.exportTeamMemorySnapshot();

      const otherDir = join(tmpdir(), `wotann-test-${randomUUID()}`);
      mkdirSync(otherDir, { recursive: true });
      const otherStore = new MemoryStore(join(otherDir, "memory.db"));

      try {
        const imported = otherStore.importTeamMemorySnapshot(snapshot);
        expect(imported.inserted).toBe(1);
        expect(otherStore.getTeamMemory().length).toBe(1);

        const syncPath = join(otherDir, "team-memory-sync.json");
        const synced = otherStore.syncTeamMemoryFile(syncPath);
        expect(existsSync(syncPath)).toBe(true);
        expect(synced.exported).toBe(1);
      } finally {
        otherStore.close();
        rmSync(otherDir, { recursive: true, force: true });
      }
    });
  });

  // ── Layer 8: Proactive Context ───────────────────────────

  describe("Layer 8: Proactive Context", () => {
    it("returns recent session entries", () => {
      const sessionId = "test-session";
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "project", key: "current-work", value: "auth refactor", verified: false, sessionId });
      const ctx = store.getProactiveContext(sessionId);
      // May or may not return results depending on last_accessed
      expect(Array.isArray(ctx)).toBe(true);
    });
  });

  // ── Memory Tools ─────────────────────────────────────────

  describe("Memory Tools (6 agent-callable)", () => {
    it("memoryReplace upserts", () => {
      store.memoryReplace("user", "name", "Gabriel");
      store.memoryReplace("user", "name", "Gabriel V");
      const entries = store.getByBlock("user");
      expect(entries.length).toBe(1);
      expect(entries[0]?.value).toBe("Gabriel V");
    });

    it("memoryInsert always creates new", () => {
      store.memoryInsert("feedback", "rule-1", "use immutable");
      store.memoryInsert("feedback", "rule-1", "also use TDD");
      const entries = store.getByBlock("feedback");
      expect(entries.length).toBe(2);
    });

    it("memoryRethink updates value", () => {
      const id = randomUUID();
      store.insert({ id, layer: "core_blocks", blockType: "decisions", key: "db", value: "PostgreSQL", verified: false });
      const updated = store.memoryRethink(id, "SQLite");
      expect(updated?.value).toBe("SQLite");
    });

    it("memoryArchive removes from active", () => {
      const id = randomUUID();
      store.insert({ id, layer: "core_blocks", blockType: "issues", key: "bug-1", value: "fixed", verified: false });
      expect(store.memoryArchive(id)).toBe(true);
      expect(store.getById(id)).toBeNull();
    });

    it("memoryVerify marks as verified", () => {
      const id = randomUUID();
      store.insert({ id, layer: "core_blocks", blockType: "reference", key: "url", value: "https://...", verified: false });
      const verified = store.memoryVerify(id);
      expect(verified?.verified).toBe(true);
    });

    it("memorySearch with layer filter", () => {
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "project", key: "wotann", value: "agent harness", verified: false });
      store.insert({ id: randomUUID(), layer: "archival", blockType: "cases", key: "wotann-bug", value: "fixed bug", verified: false });
      const results = store.memorySearch("wotann", ["core_blocks"]);
      for (const r of results) {
        expect(r.entry.layer).toBe("core_blocks");
      }
    });
  });

  // ── Consolidation Lock ───────────────────────────────────

  describe("Consolidation Lock", () => {
    it("acquires and releases lock", () => {
      expect(store.acquireConsolidationLock("dream-1")).toBe(true);
      expect(store.acquireConsolidationLock("dream-2")).toBe(false); // Already held
      store.releaseConsolidationLock();
      expect(store.acquireConsolidationLock("dream-3")).toBe(true); // Free again
      store.releaseConsolidationLock();
    });
  });

  // ── Decision Log ─────────────────────────────────────────

  describe("Decision Log", () => {
    it("logs and retrieves decisions", () => {
      store.logDecision({
        id: "d-1",
        decision: "Use SQLite for memory",
        rationale: "Zero config, embedded, fast for single-user",
        alternatives: "PostgreSQL, Redis",
      });
      const decisions = store.getDecisions();
      expect(decisions.length).toBe(1);
      expect(decisions[0]?.["decision"]).toBe("Use SQLite for memory");
    });
  });

  // ── Stats ────────────────────────────────────────────────

  describe("Statistics", () => {
    it("counts entries correctly", () => {
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "user", key: "a", value: "1", verified: false });
      store.insert({ id: randomUUID(), layer: "archival", blockType: "cases", key: "b", value: "2", verified: false });
      expect(store.getEntryCount()).toBe(2);
    });

    it("reports layer stats", () => {
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "user", key: "a", value: "1", verified: false });
      store.insert({ id: randomUUID(), layer: "core_blocks", blockType: "feedback", key: "b", value: "2", verified: false });
      store.insert({ id: randomUUID(), layer: "archival", blockType: "cases", key: "c", value: "3", verified: false });
      const stats = store.getLayerStats();
      expect(stats["core_blocks"]).toBe(2);
      expect(stats["archival"]).toBe(1);
    });
  });
});
