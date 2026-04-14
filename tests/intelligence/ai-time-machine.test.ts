import { describe, it, expect, beforeEach } from "vitest";
import { AITimeMachine } from "../../src/intelligence/ai-time-machine.js";
import type { AgentMessage } from "../../src/core/types.js";

describe("AITimeMachine", () => {
  let tm: AITimeMachine;
  const conversationId = "conv-1";

  const messages: readonly AgentMessage[] = [
    { role: "user", content: "Hello, help me with auth" },
    { role: "assistant", content: "Sure, I can help with auth." },
    { role: "user", content: "Use JWT tokens" },
    { role: "assistant", content: "Here is a JWT implementation..." },
    { role: "user", content: "Add refresh tokens" },
    { role: "assistant", content: "Added refresh token logic." },
  ];

  beforeEach(() => {
    tm = new AITimeMachine();
    tm.registerConversation(conversationId, messages);
  });

  describe("createForkPoint", () => {
    it("creates a fork point at a valid index", () => {
      const fp = tm.createForkPoint(conversationId, 1);
      expect(fp.id).toMatch(/^fp_/);
      expect(fp.conversationId).toBe(conversationId);
      expect(fp.messageIndex).toBe(1);
      expect(fp.snapshotMessages).toHaveLength(2);
    });

    it("includes all messages up to and including the index", () => {
      const fp = tm.createForkPoint(conversationId, 3);
      expect(fp.snapshotMessages).toHaveLength(4);
      expect(fp.snapshotMessages[3]?.content).toContain("JWT implementation");
    });

    it("throws for unknown conversation", () => {
      expect(() => tm.createForkPoint("nope", 0)).toThrow("not found");
    });

    it("throws for out-of-range index", () => {
      expect(() => tm.createForkPoint(conversationId, 99)).toThrow("out of range");
    });

    it("accepts a custom label", () => {
      const fp = tm.createForkPoint(conversationId, 0, "Before JWT decision");
      expect(fp.label).toBe("Before JWT decision");
    });
  });

  describe("startAlternateTimeline", () => {
    it("creates a timeline from a fork point with a new prompt", () => {
      const fp = tm.createForkPoint(conversationId, 1);
      const tl = tm.startAlternateTimeline(fp.id, "Use session cookies instead");

      expect(tl.id).toMatch(/^tl_/);
      expect(tl.forkPointId).toBe(fp.id);
      expect(tl.status).toBe("pending");
      expect(tl.messages).toHaveLength(3); // 2 snapshot + 1 new user msg
      expect(tl.messages[2]?.content).toBe("Use session cookies instead");
    });

    it("throws for unknown fork point", () => {
      expect(() => tm.startAlternateTimeline("nope", "test")).toThrow("not found");
    });
  });

  describe("appendToTimeline & completeTimeline", () => {
    it("appends messages and completes a timeline", () => {
      const fp = tm.createForkPoint(conversationId, 1);
      const tl = tm.startAlternateTimeline(fp.id, "Use OAuth");

      const updated = tm.appendToTimeline(tl.id, { role: "assistant", content: "OAuth setup..." });
      expect(updated.messages).toHaveLength(4);
      expect(updated.status).toBe("exploring");

      const completed = tm.completeTimeline(tl.id, 0.9);
      expect(completed.status).toBe("complete");
      expect(completed.qualityScore).toBe(0.9);
    });
  });

  describe("compareTimelines", () => {
    it("compares two timelines from the same fork point", () => {
      const fp = tm.createForkPoint(conversationId, 1);
      const tl1 = tm.startAlternateTimeline(fp.id, "Use JWT");
      const tl2 = tm.startAlternateTimeline(fp.id, "Use OAuth");

      tm.completeTimeline(tl1.id, 0.8);
      tm.completeTimeline(tl2.id, 0.6);

      const comparison = tm.compareTimelines([tl1.id, tl2.id]);
      expect(comparison.timelineIds).toHaveLength(2);
      expect(comparison.sharedPrefixLength).toBe(2); // Same snapshot prefix
      expect(comparison.qualityRankings[0]?.qualityScore).toBe(0.8);
    });

    it("provides divergence descriptions", () => {
      const fp = tm.createForkPoint(conversationId, 1);
      const tl1 = tm.startAlternateTimeline(fp.id, "Use JWT");
      const tl2 = tm.startAlternateTimeline(fp.id, "Use OAuth");

      const comparison = tm.compareTimelines([tl1.id, tl2.id]);
      expect(comparison.divergenceDescriptions).toHaveLength(2);
    });
  });

  describe("mergeBestParts", () => {
    it("merges assistant messages from timelines into conversation", () => {
      const fp = tm.createForkPoint(conversationId, 1);
      const tl1 = tm.startAlternateTimeline(fp.id, "Use JWT");
      tm.appendToTimeline(tl1.id, { role: "assistant", content: "JWT implementation" });
      tm.completeTimeline(tl1.id, 0.9);

      const result = tm.mergeBestParts([tl1.id], conversationId);
      expect(result.success).toBe(true);
      expect(result.mergedMessageCount).toBe(1); // 1 assistant message from divergent part
    });

    it("returns failure for unknown conversation", () => {
      const result = tm.mergeBestParts([], "nope");
      expect(result.success).toBe(false);
    });
  });

  describe("getTimelineTree", () => {
    it("builds a tree with fork points and timelines", () => {
      const fp1 = tm.createForkPoint(conversationId, 1);
      tm.startAlternateTimeline(fp1.id, "Alt 1");
      tm.startAlternateTimeline(fp1.id, "Alt 2");

      const fp2 = tm.createForkPoint(conversationId, 3);
      tm.startAlternateTimeline(fp2.id, "Alt 3");

      const tree = tm.getTimelineTree(conversationId);
      expect(tree.totalForkPoints).toBe(2);
      expect(tree.totalTimelines).toBe(3);
      expect(tree.root.children).toHaveLength(2);
    });

    it("handles conversation with no forks", () => {
      const tree = tm.getTimelineTree(conversationId);
      expect(tree.totalForkPoints).toBe(0);
      expect(tree.totalTimelines).toBe(0);
    });
  });

  describe("getters", () => {
    it("retrieves timelines and fork points by ID", () => {
      const fp = tm.createForkPoint(conversationId, 1);
      const tl = tm.startAlternateTimeline(fp.id, "Test");

      expect(tm.getForkPoint(fp.id)).not.toBeNull();
      expect(tm.getTimeline(tl.id)).not.toBeNull();
      expect(tm.getForkPoint("nonexistent")).toBeNull();
      expect(tm.getTimeline("nonexistent")).toBeNull();
    });
  });
});
