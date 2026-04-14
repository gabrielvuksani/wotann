import { describe, it, expect, beforeEach } from "vitest";
import { ContextShardManager } from "../../src/context/context-sharding.js";

describe("Context Sharding", () => {
  let manager: ContextShardManager;

  beforeEach(() => {
    manager = new ContextShardManager({
      maxActiveShards: 3,
      maxTokensPerShard: 10_000,
      totalTokenBudget: 50_000,
      autoSplitThreshold: 8_000,
      dormantAfterMinutes: 1,
    });
  });

  describe("shard lifecycle", () => {
    it("creates a new shard with topic", () => {
      const id = manager.createShard("Authentication refactor", 7);
      expect(id).toBeTruthy();
      expect(manager.getActiveShardId()).toBe(id);
    });

    it("adds messages to the active shard", () => {
      manager.createShard("Test topic");
      manager.addMessage({ role: "user", content: "Hello world", timestamp: Date.now() });
      const messages = manager.getActiveContext();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("Hello world");
    });

    it("estimates token count for messages", () => {
      manager.createShard("Test topic");
      manager.addMessage({ role: "user", content: "A".repeat(400), timestamp: Date.now() });
      const stats = manager.getStats();
      expect(stats.totalTokensUsed).toBe(100); // 400 chars / 4
    });

    it("switches between shards by topic", () => {
      const id1 = manager.createShard("Auth work");
      const id2 = manager.createShard("Database migration");

      expect(manager.getActiveShardId()).toBe(id2);
      const switched = manager.switchToShard("Auth");
      expect(switched).toBe(true);
      expect(manager.getActiveShardId()).toBe(id1);
    });

    it("returns false when switching to non-existent topic", () => {
      manager.createShard("Auth work");
      const switched = manager.switchToShard("nonexistent");
      expect(switched).toBe(false);
    });
  });

  describe("shard limits", () => {
    it("dormants oldest shards when exceeding max active", () => {
      manager.createShard("Shard 1", 3);
      manager.createShard("Shard 2", 3);
      manager.createShard("Shard 3", 3);
      manager.createShard("Shard 4", 3); // should dormant shard 1

      const shards = manager.listShards();
      const states = shards.map((s) => s.state);
      expect(states.filter((s) => s === "active").length).toBeLessThanOrEqual(3);
    });
  });

  describe("topic shift detection", () => {
    it("detects when message topic shifts from current shard", () => {
      manager.createShard("TypeScript type system");
      // Add context about TypeScript
      for (let i = 0; i < 5; i++) {
        manager.addMessage({
          role: "user",
          content: `TypeScript generics and type inference patterns for utility types`,
          timestamp: Date.now(),
        });
      }

      // A completely different topic
      const shifted = manager.detectTopicShift("How do I deploy to Kubernetes with Helm charts?");
      expect(shifted).toBe(true);
    });

    it("does not flag shift for related messages", () => {
      manager.createShard("TypeScript type system");
      for (let i = 0; i < 5; i++) {
        manager.addMessage({
          role: "user",
          content: `TypeScript generics and type inference patterns for utility types`,
          timestamp: Date.now(),
        });
      }

      const shifted = manager.detectTopicShift("What about TypeScript conditional types?");
      expect(shifted).toBe(false);
    });
  });

  describe("cross-shard context", () => {
    it("includes summaries from dormant shards", () => {
      const id1 = manager.createShard("Old work");
      manager.addMessage({ role: "user", content: "Old context about auth", timestamp: Date.now() });

      const id2 = manager.createShard("New work", 5);
      manager.addMessage({ role: "user", content: "New context about API", timestamp: Date.now() });

      // Run maintenance to dormant old shard
      manager.maintenance();

      const context = manager.getCrossShardContext(50_000);
      expect(context.messages.length).toBeGreaterThan(0);
    });
  });

  describe("statistics", () => {
    it("returns accurate stats", () => {
      manager.createShard("Topic 1");
      manager.addMessage({ role: "user", content: "Hello", timestamp: Date.now() });
      manager.createShard("Topic 2");

      const stats = manager.getStats();
      expect(stats.totalShards).toBe(2);
      expect(stats.totalTokenBudget).toBe(50_000);
      expect(stats.utilizationPercent).toBeGreaterThanOrEqual(0);
    });
  });
});
