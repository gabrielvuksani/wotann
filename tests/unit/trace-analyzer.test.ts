import { describe, it, expect } from "vitest";
import { TraceAnalyzer } from "../../src/intelligence/trace-analyzer.js";

describe("Trace Analyzer (TerminalBench)", () => {
  it("records and counts entries", () => {
    const ta = new TraceAnalyzer();
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Read", content: "", tokensUsed: 100, durationMs: 50 });
    ta.record({ timestamp: Date.now(), type: "tool_result", content: "file content", tokensUsed: 200, durationMs: 10 });
    expect(ta.size()).toBe(2);
  });

  it("detects doom loops (3+ identical calls)", () => {
    const ta = new TraceAnalyzer();
    const args = { path: "/src/foo.ts" };
    for (let i = 0; i < 4; i++) {
      ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Read", toolArgs: args, content: "", tokensUsed: 100, durationMs: 50 });
    }

    const analysis = ta.analyze();
    const doomLoop = analysis.patterns.find((p) => p.type === "doom-loop");
    expect(doomLoop).toBeDefined();
    expect(doomLoop?.occurrences).toBe(4);
  });

  it("detects repeated errors", () => {
    const ta = new TraceAnalyzer();
    ta.record({ timestamp: Date.now(), type: "error", content: "TypeError: Cannot read undefined", tokensUsed: 0, durationMs: 0 });
    ta.record({ timestamp: Date.now(), type: "error", content: "TypeError: Cannot read undefined", tokensUsed: 0, durationMs: 0 });

    const analysis = ta.analyze();
    expect(analysis.patterns.some((p) => p.type === "repeated-error")).toBe(true);
  });

  it("detects tool misuse (Bash for file reading)", () => {
    const ta = new TraceAnalyzer();
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Bash", toolArgs: { command: "cat /src/foo.ts" }, content: "", tokensUsed: 100, durationMs: 50 });
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Bash", toolArgs: { command: "head -20 /src/bar.ts" }, content: "", tokensUsed: 100, durationMs: 50 });

    const analysis = ta.analyze();
    expect(analysis.patterns.some((p) => p.type === "tool-misuse")).toBe(true);
  });

  it("tracks tool usage counts", () => {
    const ta = new TraceAnalyzer();
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Read", content: "", tokensUsed: 100, durationMs: 50 });
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Read", content: "", tokensUsed: 100, durationMs: 50 });
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Write", content: "", tokensUsed: 100, durationMs: 50 });

    const analysis = ta.analyze();
    expect(analysis.toolUsage.get("Read")).toBe(2);
    expect(analysis.toolUsage.get("Write")).toBe(1);
  });

  it("computes token breakdown by type", () => {
    const ta = new TraceAnalyzer();
    ta.record({ timestamp: Date.now(), type: "thinking", content: "reasoning...", tokensUsed: 500, durationMs: 100 });
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Read", content: "", tokensUsed: 200, durationMs: 50 });
    ta.record({ timestamp: Date.now(), type: "text", content: "response", tokensUsed: 300, durationMs: 30 });

    const analysis = ta.analyze();
    expect(analysis.tokenBreakdown.thinking).toBe(500);
    expect(analysis.tokenBreakdown.toolCalls).toBe(200);
    expect(analysis.tokenBreakdown.text).toBe(300);
  });

  it("generates improvement proposals for detected patterns", () => {
    const ta = new TraceAnalyzer();
    // Create a doom loop
    for (let i = 0; i < 5; i++) {
      ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Edit", toolArgs: { file: "x.ts" }, content: "", tokensUsed: 100, durationMs: 50 });
    }

    const analysis = ta.analyze();
    expect(analysis.improvements.length).toBeGreaterThan(0);
    expect(analysis.improvements[0]?.area).toBe("middleware");
  });

  it("computes efficiency score", () => {
    const ta = new TraceAnalyzer();
    ta.record({ timestamp: Date.now(), type: "tool_call", toolName: "Read", content: "", tokensUsed: 100, durationMs: 50 });
    ta.record({ timestamp: Date.now(), type: "tool_result", content: "success", tokensUsed: 50, durationMs: 10 });

    const analysis = ta.analyze();
    expect(analysis.efficiency).toBeGreaterThan(0);
    expect(analysis.efficiency).toBeLessThanOrEqual(1);
  });

  it("clears trace buffer", () => {
    const ta = new TraceAnalyzer();
    ta.record({ timestamp: Date.now(), type: "text", content: "hello", tokensUsed: 10, durationMs: 5 });
    expect(ta.size()).toBe(1);
    ta.clear();
    expect(ta.size()).toBe(0);
  });

  it("handles empty trace gracefully", () => {
    const ta = new TraceAnalyzer();
    const analysis = ta.analyze();
    expect(analysis.totalEntries).toBe(0);
    expect(analysis.efficiency).toBe(1); // Empty trace = 100% efficient (no waste)
  });
});
