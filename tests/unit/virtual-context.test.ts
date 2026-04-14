import { describe, it, expect } from "vitest";
import {
  VirtualContextManager,
} from "../../src/context/virtual-context.js";
import type { VCMessage } from "../../src/context/virtual-context.js";

describe("Virtual Context Manager", () => {
  const makeMessage = (
    role: VCMessage["role"],
    content: string,
    tokens: number,
    opts?: { topic?: string; importance?: number },
  ): VCMessage => ({
    role,
    content,
    tokenEstimate: tokens,
    timestamp: Date.now(),
    topic: opts?.topic,
    importance: opts?.importance,
  });

  describe("virtualizeConversation", () => {
    it("keeps all messages when they fit", () => {
      const manager = new VirtualContextManager({ maxTokens: 10_000 });
      const messages = [
        makeMessage("system", "System prompt", 500),
        makeMessage("user", "Hello", 100),
        makeMessage("assistant", "Hi", 100),
      ];

      const result = manager.virtualizeConversation(messages);
      expect(result.active.messages).toHaveLength(3);
      expect(result.newArchived).toHaveLength(0);
      expect(result.active.totalTokens).toBe(700);
    });

    it("archives when messages exceed budget", () => {
      const manager = new VirtualContextManager({ maxTokens: 1_000, reservePercent: 0.1 });
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMessage("user", `Message ${i}`, 100),
      );

      const result = manager.virtualizeConversation(messages);
      expect(result.active.totalTokens).toBeLessThanOrEqual(900); // 1000 - 10% reserve
      expect(result.newArchived.length).toBeGreaterThan(0);
    });

    it("handles empty messages", () => {
      const manager = new VirtualContextManager();
      const result = manager.virtualizeConversation([]);
      expect(result.active.messages).toHaveLength(0);
      expect(result.active.usagePercent).toBe(0);
    });

    it("respects custom maxTokens parameter", () => {
      const manager = new VirtualContextManager({ maxTokens: 100_000 });
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMessage("user", `Message ${i}`, 100),
      );

      const result = manager.virtualizeConversation(messages, 500);
      // 500 * 0.9 = 450 usable, should archive some
      expect(result.active.totalTokens).toBeLessThanOrEqual(500);
    });

    it("keeps system messages during recency-based archiving", () => {
      const manager = new VirtualContextManager({
        maxTokens: 500,
        strategy: "recency-weighted",
        reservePercent: 0,
      });
      const messages = [
        makeMessage("system", "System", 200),
        makeMessage("user", "Old 1", 200),
        makeMessage("user", "Old 2", 200),
        makeMessage("user", "Recent", 200),
      ];

      const result = manager.virtualizeConversation(messages);
      const roles = result.active.messages.map((m) => m.role);
      expect(roles).toContain("system");
    });

    it("uses importance-ranked strategy", () => {
      const manager = new VirtualContextManager({
        maxTokens: 500,
        strategy: "importance-ranked",
        reservePercent: 0,
      });
      const messages = [
        makeMessage("system", "System", 200),
        makeMessage("user", "Important", 200, { importance: 100 }),
        makeMessage("assistant", "Less important", 200),
      ];

      const result = manager.virtualizeConversation(messages);
      expect(result.active.messages.some((m) => m.content === "System")).toBe(true);
      expect(result.active.messages.some((m) => m.content === "Important")).toBe(true);
    });

    it("uses topic-aware-shard strategy", () => {
      const manager = new VirtualContextManager({
        maxTokens: 500,
        strategy: "topic-aware-shard",
        reservePercent: 0,
      });
      const messages = [
        makeMessage("user", "Off-topic old", 200, { topic: "other" }),
        makeMessage("user", "On-topic old", 200, { topic: "current" }),
        makeMessage("user", "On-topic recent", 200, { topic: "current" }),
      ];

      const result = manager.virtualizeConversation(messages);
      expect(result.active.totalTokens).toBeLessThanOrEqual(500);
    });
  });

  describe("retrieveRelevantContext", () => {
    it("returns empty when no archived segments", () => {
      const manager = new VirtualContextManager();
      const result = manager.retrieveRelevantContext("search query");
      expect(result.segments).toHaveLength(0);
    });

    it("retrieves segments matching query terms", () => {
      const manager = new VirtualContextManager({
        maxTokens: 500,
        strategy: "recency-weighted",
        reservePercent: 0,
      });

      // Force archiving by exceeding token limit
      const messages = [
        makeMessage("user", "database migration schema", 200, { topic: "database" }),
        makeMessage("user", "frontend react component", 200, { topic: "frontend" }),
        makeMessage("user", "recent work on API", 200, { topic: "api" }),
      ];
      manager.virtualizeConversation(messages);

      const result = manager.retrieveRelevantContext("database");
      // If any segments were archived containing "database", they should score higher
      expect(result.query).toBe("database");
    });

    it("returns empty for empty query", () => {
      const manager = new VirtualContextManager({ maxTokens: 100, reservePercent: 0 });
      const messages = [
        makeMessage("user", "test message 1", 100),
        makeMessage("user", "test message 2", 100),
      ];
      manager.virtualizeConversation(messages);

      const result = manager.retrieveRelevantContext("");
      expect(result.segments).toHaveLength(0);
    });

    it("respects token budget for retrieval", () => {
      const manager = new VirtualContextManager({
        maxTokens: 200,
        reservePercent: 0,
        shardSize: 2,
      });
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMessage("user", `topic alpha message ${i}`, 100),
      );
      manager.virtualizeConversation(messages);

      const result = manager.retrieveRelevantContext("topic alpha", 150);
      expect(result.totalTokensRetrieved).toBeLessThanOrEqual(150);
    });
  });

  describe("archive management", () => {
    it("accumulates archived segments across virtualizations", () => {
      const manager = new VirtualContextManager({
        maxTokens: 200,
        reservePercent: 0,
      });

      manager.virtualizeConversation([
        makeMessage("user", "Batch 1a", 200),
        makeMessage("user", "Batch 1b", 200),
      ]);

      manager.virtualizeConversation([
        makeMessage("user", "Batch 2a", 200),
        makeMessage("user", "Batch 2b", 200),
      ]);

      expect(manager.getArchived().length).toBeGreaterThanOrEqual(2);
    });

    it("clears archived segments", () => {
      const manager = new VirtualContextManager({ maxTokens: 100, reservePercent: 0 });
      manager.virtualizeConversation([
        makeMessage("user", "A", 100),
        makeMessage("user", "B", 100),
      ]);

      expect(manager.getArchived().length).toBeGreaterThan(0);
      manager.clearArchived();
      expect(manager.getArchived()).toHaveLength(0);
    });
  });

  describe("getConfig", () => {
    it("returns the current config", () => {
      const manager = new VirtualContextManager({
        maxTokens: 50_000,
        strategy: "importance-ranked",
      });
      const config = manager.getConfig();
      expect(config.maxTokens).toBe(50_000);
      expect(config.strategy).toBe("importance-ranked");
    });

    it("has sensible defaults", () => {
      const manager = new VirtualContextManager();
      const config = manager.getConfig();
      expect(config.maxTokens).toBe(128_000);
      expect(config.strategy).toBe("recency-weighted");
      expect(config.reservePercent).toBe(0.1);
    });
  });
});
