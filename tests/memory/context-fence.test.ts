/**
 * Tests for Context Fencing — prevents recursive memory pollution.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ContextFence } from "../../src/memory/context-fence.js";

describe("ContextFence", () => {
  let fence: ContextFence;

  beforeEach(() => {
    fence = new ContextFence();
  });

  it("should fence recalled content and block re-capture", () => {
    const content = "The user prefers TypeScript for all new projects";
    fence.fenceRecalledContent(content, ["mem-1", "mem-2"], "session-1");

    expect(fence.shouldBlock(content)).toBe(true);
  });

  it("should not block content that was never fenced", () => {
    expect(fence.shouldBlock("Some new observation")).toBe(false);
  });

  it("should detect substantial overlap with fenced content", () => {
    const original = "The user prefers TypeScript for all new projects and uses strict mode";
    fence.fenceRecalledContent(original, ["mem-1"], "session-1");

    // Slightly different but substantially overlapping
    const similar = "The user prefers TypeScript for all new projects";
    expect(fence.shouldBlock(similar)).toBe(true);
  });

  it("should not block content with low overlap", () => {
    fence.fenceRecalledContent("TypeScript strict mode configuration", ["mem-1"], "session-1");
    expect(fence.shouldBlock("Python virtual environment setup")).toBe(false);
  });

  it("should fence a batch of items", () => {
    const items = [
      { content: "Fact one about the project", memoryIds: ["m1"] },
      { content: "Fact two about preferences", memoryIds: ["m2"] },
    ];
    const fingerprints = fence.fenceBatch(items, "session-1");

    expect(fingerprints.length).toBe(2);
    expect(fence.shouldBlock("Fact one about the project")).toBe(true);
    expect(fence.shouldBlock("Fact two about preferences")).toBe(true);
  });

  it("should clear fences for a specific session", () => {
    // Use completely distinct content to avoid trigram overlap between sessions
    fence.fenceRecalledContent("The TypeScript compiler requires strict mode always", ["m1"], "session-1");
    fence.fenceRecalledContent("PostgreSQL database migration uses flyway toolkit", ["m2"], "session-2");

    const cleared = fence.clearSession("session-1");
    expect(cleared).toBe(1);
    expect(fence.shouldBlock("The TypeScript compiler requires strict mode always")).toBe(false);
    expect(fence.shouldBlock("PostgreSQL database migration uses flyway toolkit")).toBe(true);
  });

  it("should track stats correctly", () => {
    fence.fenceRecalledContent("Content A", ["m1"], "s1");
    fence.fenceRecalledContent("Content B", ["m2"], "s1");

    // Trigger some blocks
    fence.shouldBlock("Content A");
    fence.shouldBlock("Content A");

    const stats = fence.getStats();
    expect(stats.activeFences).toBe(2);
    expect(stats.totalBlocked).toBe(2);
  });

  it("should reset all fences", () => {
    fence.fenceRecalledContent("Content", ["m1"], "s1");
    fence.reset();

    expect(fence.shouldBlock("Content")).toBe(false);
    const stats = fence.getStats();
    expect(stats.activeFences).toBe(0);
    expect(stats.totalBlocked).toBe(0);
  });

  it("should expire old fences", () => {
    // Create fence with 1ms max age
    const shortFence = new ContextFence(1);
    shortFence.fenceRecalledContent("Old content", ["m1"], "s1");

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    expect(shortFence.shouldBlock("Old content")).toBe(false);
  });
});
