import { describe, it, expect } from "vitest";
import {
  InMemoryProvider,
  MultiTurnMemory,
  calculateFreshness,
  detectContradiction,
  registerMemoryProvider,
  setActiveMemoryProvider,
  getActiveMemoryProvider,
  getRegisteredProviders,
} from "../../src/memory/pluggable-provider.js";
import type { MemoryEntry } from "../../src/memory/store.js";

describe("InMemoryProvider", () => {
  it("initializes and passes health check", async () => {
    const provider = new InMemoryProvider();
    await provider.initialize();
    expect(await provider.healthCheck()).toBe(true);
  });

  it("inserts and retrieves entries", async () => {
    const provider = new InMemoryProvider();
    await provider.initialize();

    await provider.insert({
      id: "test-1",
      layer: "core_blocks",
      blockType: "cases",
      key: "auth-fix",
      value: "Fixed authentication by adding token refresh",
      verified: true,
      confidence: 0.9,
    });

    const entry = await provider.getById("test-1");
    expect(entry).not.toBeNull();
    expect(entry!.key).toBe("auth-fix");
    expect(entry!.value).toContain("token refresh");
  });

  it("searches by text", async () => {
    const provider = new InMemoryProvider();
    await provider.initialize();

    await provider.insert({
      id: "mem-1", layer: "core_blocks", blockType: "patterns",
      key: "react", value: "Use React hooks for state management", verified: true,
    });
    await provider.insert({
      id: "mem-2", layer: "core_blocks", blockType: "patterns",
      key: "database", value: "Always use parameterized queries", verified: true,
    });

    const results = await provider.search("React hooks");
    expect(results.length).toBe(1);
    expect(results[0]!.entry.key).toBe("react");
  });

  it("archives entries (soft delete)", async () => {
    const provider = new InMemoryProvider();
    await provider.initialize();

    await provider.insert({
      id: "del-1", layer: "core_blocks", blockType: "issues",
      key: "stale-bug", value: "Old bug", verified: false,
    });

    await provider.archive("del-1");
    const entry = await provider.getById("del-1");
    expect(entry).toBeNull();

    const count = await provider.count();
    expect(count).toBe(0);
  });

  it("filters by layer", async () => {
    const provider = new InMemoryProvider();
    await provider.initialize();

    await provider.insert({ id: "l-1", layer: "working", blockType: "user", key: "k1", value: "v1", verified: false });
    await provider.insert({ id: "l-2", layer: "core_blocks", blockType: "user", key: "k2", value: "v2", verified: false });
    await provider.insert({ id: "l-3", layer: "working", blockType: "user", key: "k3", value: "v3", verified: false });

    const working = await provider.getByLayer("working");
    expect(working.length).toBe(2);
  });
});

describe("MultiTurnMemory", () => {
  it("records entries across turns", () => {
    const mem = new MultiTurnMemory();
    mem.record("auth", "User prefers JWT", 0.8);
    mem.nextTurn();
    mem.record("db", "Postgres preferred", 0.5);

    const all = mem.getAll();
    expect(all.length).toBe(2);
    expect(all[0]!.key).toBe("auth"); // Higher importance first
  });

  it("marks high-importance entries as compaction-safe", () => {
    const mem = new MultiTurnMemory();
    mem.record("critical", "Never delete user data", 0.9);
    mem.record("trivial", "Formatting preference", 0.2);

    const safe = mem.getCompactionSafe();
    expect(safe.length).toBe(1);
    expect(safe[0]!.key).toBe("critical");
  });

  it("evicts low-importance entries when over limit", () => {
    const mem = new MultiTurnMemory(3);
    mem.record("a", "val-a", 0.3);
    mem.record("b", "val-b", 0.8);
    mem.record("c", "val-c", 0.5);
    mem.record("d", "val-d", 0.9); // Should evict the lowest

    const all = mem.getAll();
    expect(all.length).toBe(3);
    // 'a' (0.3) should be evicted
    expect(all.every((e) => e.key !== "a")).toBe(true);
  });

  it("serializes and restores", () => {
    const mem = new MultiTurnMemory();
    mem.record("key1", "val1", 0.8);
    mem.record("key2", "val2", 0.9);

    const serialized = mem.serialize();
    const restored = new MultiTurnMemory();
    restored.restore(serialized);

    expect(restored.getAll().length).toBe(2);
  });

  it("filters by turn", () => {
    const mem = new MultiTurnMemory();
    mem.record("t0-a", "val", 0.5);
    mem.nextTurn();
    mem.record("t1-a", "val", 0.5);
    mem.record("t1-b", "val", 0.5);

    expect(mem.getByTurn(0).length).toBe(1);
    expect(mem.getByTurn(1).length).toBe(2);
  });
});

describe("Provider Registry", () => {
  it("registers and activates providers", () => {
    const provider = new InMemoryProvider();
    registerMemoryProvider(provider);

    expect(getRegisteredProviders()).toContain("in-memory");

    const activated = setActiveMemoryProvider("in-memory");
    expect(activated).toBe(true);

    const active = getActiveMemoryProvider();
    expect(active).not.toBeNull();
    expect(active!.name).toBe("in-memory");
  });

  it("returns false for non-existent provider", () => {
    expect(setActiveMemoryProvider("non-existent-provider")).toBe(false);
  });
});

describe("calculateFreshness", () => {
  it("returns high freshness for recent verified entries", () => {
    const freshness = calculateFreshness(0.9, new Date().toISOString(), true);
    expect(freshness).toBeGreaterThan(0.8);
  });

  it("decays for old unverified entries", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const freshness = calculateFreshness(0.9, twoWeeksAgo, false);
    expect(freshness).toBeLessThan(0.5);
  });

  it("verification boost slows decay", () => {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const unverified = calculateFreshness(0.9, oneWeekAgo, false);
    const verified = calculateFreshness(0.9, oneWeekAgo, true);
    expect(verified).toBeGreaterThan(unverified);
  });
});

describe("detectContradiction", () => {
  const existingEntries: MemoryEntry[] = [
    { id: "e1", layer: "core_blocks", blockType: "decisions", key: "auth", value: "Always use JWT tokens", createdAt: "", updatedAt: "", verified: true },
    { id: "e2", layer: "core_blocks", blockType: "decisions", key: "testing", value: "Never skip unit tests", createdAt: "", updatedAt: "", verified: true },
  ];

  it("detects direct contradiction (same key, different value)", () => {
    const contradictions = detectContradiction("auth", "Use session cookies instead", existingEntries);
    expect(contradictions.length).toBe(1);
    expect(contradictions[0]!.conflictType).toBe("direct");
  });

  it("returns empty for non-contradicting entries", () => {
    const contradictions = detectContradiction("deployment", "Use Docker for deployment", existingEntries);
    expect(contradictions.length).toBe(0);
  });
});
