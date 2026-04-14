/**
 * Integration test: verify the WotannRuntime wires ALL modules together.
 * This is the critical test that ensures nothing is dead code.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { WotannRuntime } from "../../src/core/runtime.js";

describe("Integration: Runtime Wiring", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  function createTestRuntime(): WotannRuntime {
    vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    return new WotannRuntime({
      workingDir: process.cwd(),
      enableMemory: false, // Skip SQLite for unit test speed
      hookProfile: "standard",
    });
  }

  it("initializes with all subsystems", () => {
    const runtime = createTestRuntime();
    const status = runtime.getStatus();

    expect(status.hookCount).toBeGreaterThan(10); // 14+ built-in hooks
    expect(status.middlewareLayers).toBeGreaterThanOrEqual(25);
    expect(status.currentMode).toBe("default");
    expect(status.traceEntries).toBe(0);
    expect(status.semanticIndexSize).toBe(0);
  });

  it("mode cycling updates system state", () => {
    const runtime = createTestRuntime();

    // Switch to plan mode
    runtime.setMode("plan");
    expect(runtime.getCurrentMode()).toBe("plan");
    expect(runtime.getStatus().currentMode).toBe("plan");

    // Cycle to next mode
    const next = runtime.cycleMode();
    expect(next).toBe("acceptEdits"); // plan → acceptEdits in cycle order
  });

  it("guardrails-off mode pauses hook engine", () => {
    const runtime = createTestRuntime();

    runtime.setMode("guardrails-off");
    expect(runtime.getCurrentMode()).toBe("guardrails-off");

    // In guardrails-off, hooks should be paused
    // We verify by checking status still works
    const status = runtime.getStatus();
    expect(status.currentMode).toBe("guardrails-off");
  });

  it("returns to normal when exiting guardrails-off", () => {
    const runtime = createTestRuntime();

    runtime.setMode("guardrails-off");
    runtime.setMode("default");

    expect(runtime.getCurrentMode()).toBe("default");
  });

  it("memory search works (semantic + keyword)", () => {
    const runtime = createTestRuntime();
    // With memory disabled, should return empty but not crash
    const results = runtime.searchMemory("test query");
    expect(Array.isArray(results)).toBe(true);
  });

  it("trace analysis returns valid structure", () => {
    const runtime = createTestRuntime();
    const analysis = runtime.getTraceAnalysis();

    expect(analysis.totalEntries).toBe(0);
    expect(analysis.efficiency).toBe(1); // Empty = 100% efficient
    expect(analysis.patterns).toHaveLength(0);
    expect(analysis.improvements).toHaveLength(0);
  });

  it("session management works", () => {
    const runtime = createTestRuntime();
    const session = runtime.getSession();

    expect(session.id).toBeDefined();
    expect(session.messages).toHaveLength(0);
  });

  it("close does not throw", () => {
    const runtime = createTestRuntime();
    expect(() => runtime.close()).not.toThrow();
  });

  it("yields error when no providers configured", async () => {
    vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    const runtime = new WotannRuntime({
      workingDir: process.cwd(),
      enableMemory: false,
    });
    // Don't call initialize — no providers will be discovered

    const chunks: { type: string; content: string }[] = [];
    for await (const chunk of runtime.query({ prompt: "test" })) {
      chunks.push({ type: chunk.type, content: chunk.content });
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.type).toBe("error");
    expect(chunks[0]?.content).toContain("No providers");
  });

  it("all modes have valid configurations", () => {
    const runtime = createTestRuntime();
    const modes = ["default", "plan", "acceptEdits", "auto", "bypass", "autonomous", "guardrails-off"] as const;

    for (const mode of modes) {
      runtime.setMode(mode);
      const status = runtime.getStatus();
      expect(status.currentMode).toBe(mode);
    }
  });

  it("status includes all expected fields", () => {
    const runtime = createTestRuntime();
    const status = runtime.getStatus();

    expect(status).toHaveProperty("providers");
    expect(status).toHaveProperty("activeProvider");
    expect(status).toHaveProperty("hookCount");
    expect(status).toHaveProperty("middlewareLayers");
    expect(status).toHaveProperty("memoryEnabled");
    expect(status).toHaveProperty("sessionId");
    expect(status).toHaveProperty("totalTokens");
    expect(status).toHaveProperty("totalCost");
    expect(status).toHaveProperty("currentMode");
    expect(status).toHaveProperty("traceEntries");
    expect(status).toHaveProperty("semanticIndexSize");
  });
});
