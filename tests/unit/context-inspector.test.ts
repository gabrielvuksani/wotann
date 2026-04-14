import { describe, it, expect } from "vitest";
import { ContextSourceInspector, estimateTokens } from "../../src/context/inspector.js";

describe("ContextSourceInspector", () => {
  it("records sections and tracks token counts", () => {
    const inspector = new ContextSourceInspector();
    inspector.setMaxTokens(100_000);

    inspector.recordSection("system_prompt", "identity.md", "You are WOTANN...", "bootstrap");
    inspector.recordSection("conversation_history", "turn-1", "User: help me with auth", "runtime");
    inspector.recordSection("tool_result", "read_file", "const x = 1; ...", "tool-executor");

    expect(inspector.getTotalTokens()).toBeGreaterThan(0);
    expect(inspector.getUtilization()).toBeGreaterThan(0);
    expect(inspector.getUtilization()).toBeLessThan(100);
  });

  it("generates snapshots with top consumers", () => {
    const inspector = new ContextSourceInspector();
    inspector.setMaxTokens(100_000);

    inspector.recordSection("system_prompt", "system", "x".repeat(4000), "bootstrap");
    inspector.recordSection("tool_result", "read_file", "x".repeat(20000), "tool");
    inspector.recordSection("conversation_history", "turns", "x".repeat(8000), "runtime");

    const snapshot = inspector.getSnapshot();
    expect(snapshot.sections.length).toBe(3);
    expect(snapshot.topConsumers.length).toBeGreaterThan(0);
    expect(snapshot.topConsumers[0]!.source).toBe("read_file"); // Largest
  });

  it("generates recommendations when context is pressured", () => {
    const inspector = new ContextSourceInspector();
    inspector.setMaxTokens(1000); // Small window

    inspector.recordSection("system_prompt", "system", "x".repeat(3200), "bootstrap");

    const snapshot = inspector.getSnapshot();
    expect(snapshot.utilizationPercent).toBeGreaterThan(75);
    expect(snapshot.recommendations.length).toBeGreaterThan(0);
    expect(snapshot.recommendations.some((r) => r.includes("compaction"))).toBe(true);
  });

  it("formats display output", () => {
    const inspector = new ContextSourceInspector();
    inspector.setMaxTokens(100_000);

    inspector.recordSection("system_prompt", "system", "Hello WOTANN", "bootstrap");

    const display = inspector.formatDisplay();
    expect(display).toContain("Context Inspector");
    expect(display).toContain("system");
  });

  it("clears all sections", () => {
    const inspector = new ContextSourceInspector();
    inspector.recordSection("system_prompt", "system", "content", "bootstrap");
    expect(inspector.getTotalTokens()).toBeGreaterThan(0);

    inspector.clear();
    expect(inspector.getTotalTokens()).toBe(0);
  });

  it("removes sections by type", () => {
    const inspector = new ContextSourceInspector();
    inspector.recordSection("tool_result", "t1", "output1", "tool");
    inspector.recordSection("tool_result", "t2", "output2", "tool");
    inspector.recordSection("system_prompt", "system", "hello", "bootstrap");

    const removed = inspector.removeSectionsByType("tool_result");
    expect(removed).toBe(2);
    expect(inspector.getSectionsByType("tool_result").length).toBe(0);
    expect(inspector.getSectionsByType("system_prompt").length).toBe(1);
  });

  it("filters sections by type", () => {
    const inspector = new ContextSourceInspector();
    inspector.recordSection("memory_injection", "m1", "context", "memory");
    inspector.recordSection("system_prompt", "system", "hello", "bootstrap");
    inspector.recordSection("memory_injection", "m2", "more", "memory");

    expect(inspector.getSectionsByType("memory_injection").length).toBe(2);
    expect(inspector.getSectionsByType("system_prompt").length).toBe(1);
  });
});

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates roughly 4 chars per token", () => {
    const tokens = estimateTokens("Hello world!"); // 12 chars → ~3 tokens
    expect(tokens).toBe(3);
  });

  it("handles long text", () => {
    const text = "x".repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});
