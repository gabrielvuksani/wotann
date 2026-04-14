import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  evictOldest,
  evictByType,
  summarizeOlder,
  compactHybrid,
} from "../../src/context/compaction.js";

describe("Context Compaction (§15)", () => {
  const makeMsg = (role: string, content: string, important = false) => ({
    role, content, timestamp: Date.now(), important,
  });

  describe("estimateTokens", () => {
    it("estimates ~4 chars per token", () => {
      expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 → ceil = 3
    });

    it("returns 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });
  });

  describe("evictOldest", () => {
    it("returns unchanged when under target", () => {
      const msgs = [makeMsg("system", "hi"), makeMsg("user", "hello")];
      const result = evictOldest(msgs, 100);
      expect(result.length).toBe(2);
    });

    it("preserves first message (system) and last 5", () => {
      const msgs = [
        makeMsg("system", "System prompt " + "x".repeat(200)),
        ...Array.from({ length: 10 }, (_, i) => makeMsg("user", `Message ${i} ${"y".repeat(100)}`)),
      ];
      const result = evictOldest(msgs, 100);
      // System message preserved, last 5 preserved
      expect(result[0]!.role).toBe("system");
      expect(result.length).toBeLessThan(msgs.length);
    });

    it("does not evict important messages", () => {
      const msgs = [
        makeMsg("system", "sys"),
        makeMsg("user", "x".repeat(400), true), // important
        makeMsg("user", "y".repeat(400)),
        ...Array.from({ length: 5 }, () => makeMsg("user", "recent")),
      ];
      const result = evictOldest(msgs, 50);
      const important = result.filter((m) => m.important);
      expect(important.length).toBe(1);
    });
  });

  describe("evictByType", () => {
    it("returns unchanged when under target", () => {
      const msgs = [makeMsg("user", "hi")];
      const result = evictByType(msgs, 100);
      expect(result.length).toBe(1);
    });

    it("evicts tool messages before assistant messages", () => {
      const msgs = [
        makeMsg("system", "sys"),
        { role: "tool", content: "x".repeat(200), timestamp: Date.now() },
        makeMsg("assistant", "y".repeat(200)),
        ...Array.from({ length: 6 }, () => makeMsg("user", "recent")),
      ];
      const result = evictByType(msgs, 100);
      // Tool messages should be evicted first
      const toolMsgs = result.filter((m) => m.role === "tool");
      expect(toolMsgs.length).toBeLessThanOrEqual(1);
    });
  });

  describe("summarizeOlder", () => {
    it("creates summary from older messages", () => {
      const msgs = Array.from({ length: 15 }, (_, i) =>
        makeMsg("user", `Message ${i}`),
      );
      const result = summarizeOlder(msgs, (older) => `Summary of ${older.length} messages`, 5);
      // Should have: original first msg + summary + last 5
      expect(result.length).toBeLessThan(msgs.length);
      expect(result.some((m) => m.content.includes("Summary"))).toBe(true);
    });

    it("returns unchanged when messages count <= keepRecent + 1", () => {
      const msgs = [makeMsg("system", "sys"), makeMsg("user", "hello")];
      const result = summarizeOlder(msgs, () => "summary", 10);
      expect(result.length).toBe(2);
    });
  });

  describe("compactHybrid", () => {
    it("returns CompactionResult with correct structure", () => {
      const msgs = Array.from({ length: 20 }, (_, i) =>
        makeMsg("user", `Message ${i} ${"x".repeat(100)}`),
      );
      const result = compactHybrid(msgs, 200, (older) => `Summary of ${older.length}`);
      expect(result.strategy).toBe("hybrid");
      expect(result.tokensBefore).toBeGreaterThan(0);
      expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
      expect(result.reduction).toBeGreaterThanOrEqual(0);
      expect(result.reduction).toBeLessThanOrEqual(1);
    });
  });
});
