/**
 * Tests for LoopDetector (Crush loop_detection.go port).
 *
 * Coverage:
 * - Detection: hash repeats ≥ threshold inside window
 * - Per-session isolation (Quality Bar #7)
 * - Sliding window eviction
 * - Canonical args hash (key-order independence)
 * - Nudge injection
 * - Pipeline wiring (order 24.5, preserves DoomLoop follow-ups)
 */

import { describe, it, expect } from "vitest";
import {
  LoopDetector,
  DEFAULT_LOOP_CONFIG,
  createLoopDetectionMiddleware,
} from "../../src/middleware/loop-detection.js";
import {
  createDefaultPipeline,
  getDefaultLoopDetector,
  createPipelineWithInstances,
} from "../../src/middleware/pipeline.js";
import type { MiddlewareContext, AgentResult } from "../../src/middleware/types.js";
import { PreCompletionChecklistMiddleware } from "../../src/middleware/pre-completion-checklist.js";
import { SystemNotificationTracker } from "../../src/middleware/system-notifications.js";

// ── Helpers ───────────────────────────────────────────────────

function makeCtx(sessionId = "s1"): MiddlewareContext {
  return {
    sessionId,
    userMessage: "test",
    recentHistory: [],
    workingDir: "/tmp/wotann-test",
  };
}

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    toolName: "Bash",
    content: "",
    success: true,
    ...overrides,
  };
}

// ── Detector ─────────────────────────────────────────────────

describe("LoopDetector — core detection", () => {
  it("defaults to windowSize=10, threshold=3", () => {
    const detector = new LoopDetector();
    expect(detector.getConfig()).toEqual(DEFAULT_LOOP_CONFIG);
  });

  it("accepts partial config overrides", () => {
    const detector = new LoopDetector({ threshold: 5 });
    expect(detector.getConfig()).toEqual({ windowSize: 10, threshold: 5 });
  });

  it("does not trigger below threshold", () => {
    const detector = new LoopDetector();
    const r1 = detector.record("s1", "Read", { path: "/foo" });
    const r2 = detector.record("s1", "Read", { path: "/foo" });
    expect(r1.detected).toBe(false);
    expect(r2.detected).toBe(false);
    expect(r2.count).toBe(2);
  });

  it("triggers at threshold (3 repeats in window)", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Read", { path: "/foo" });
    detector.record("s1", "Read", { path: "/foo" });
    const r3 = detector.record("s1", "Read", { path: "/foo" });
    expect(r3.detected).toBe(true);
    expect(r3.count).toBe(3);
    expect(r3.toolName).toBe("Read");
  });

  it("does not trigger when different tools interleave", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Read", { path: "/a" });
    detector.record("s1", "Edit", { path: "/b" });
    const r = detector.record("s1", "Bash", { cmd: "ls" });
    expect(r.detected).toBe(false);
  });

  it("counts non-consecutive identical hashes inside the window", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Read", { path: "/foo" }); // hash A
    detector.record("s1", "Edit", { path: "/foo" }); // hash B (different tool)
    detector.record("s1", "Read", { path: "/foo" }); // hash A
    const r = detector.record("s1", "Read", { path: "/foo" }); // hash A — 3rd occurrence
    expect(r.detected).toBe(true);
    expect(r.count).toBe(3);
  });
});

describe("LoopDetector — canonical args hash", () => {
  it("treats {a:1,b:2} and {b:2,a:1} as identical", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Bash", { a: 1, b: 2 });
    detector.record("s1", "Bash", { b: 2, a: 1 });
    const r = detector.record("s1", "Bash", { a: 1, b: 2 });
    expect(r.detected).toBe(true);
    expect(r.count).toBe(3);
  });

  it("treats nested object key reorderings as identical", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Bash", { outer: { x: 1, y: 2 } });
    detector.record("s1", "Bash", { outer: { y: 2, x: 1 } });
    const r = detector.record("s1", "Bash", { outer: { x: 1, y: 2 } });
    expect(r.detected).toBe(true);
  });

  it("treats arrays with different order as DIFFERENT (order matters)", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Bash", { args: [1, 2] });
    detector.record("s1", "Bash", { args: [2, 1] });
    const r = detector.record("s1", "Bash", { args: [1, 2] });
    // Only 2 matches of [1,2]; below threshold
    expect(r.detected).toBe(false);
    expect(r.count).toBe(2);
  });

  it("treats different scalar args as different hashes", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Bash", { cmd: "ls" });
    detector.record("s1", "Bash", { cmd: "pwd" });
    const r = detector.record("s1", "Bash", { cmd: "ls" });
    expect(r.detected).toBe(false); // only 2 "ls" calls
    expect(r.count).toBe(2);
  });
});

describe("LoopDetector — per-session isolation (Quality Bar #7)", () => {
  it("does NOT cross-contaminate between sessions", () => {
    const detector = new LoopDetector();
    // Session A records 2 identical calls
    detector.record("sessionA", "Read", { path: "/foo" });
    detector.record("sessionA", "Read", { path: "/foo" });
    // Session B records 1 identical call — must NOT trigger
    const rB = detector.record("sessionB", "Read", { path: "/foo" });
    expect(rB.detected).toBe(false);
    expect(rB.count).toBe(1);
  });

  it("tracks multiple sessions independently", () => {
    const detector = new LoopDetector();
    detector.record("A", "Read", { path: "/x" });
    detector.record("A", "Read", { path: "/x" });
    detector.record("B", "Read", { path: "/y" });
    expect(detector.getSessionCount()).toBe(2);
    expect(detector.getWindowLength("A")).toBe(2);
    expect(detector.getWindowLength("B")).toBe(1);
  });

  it("resetSession clears only one session", () => {
    const detector = new LoopDetector();
    detector.record("A", "Read", { path: "/x" });
    detector.record("B", "Read", { path: "/y" });
    detector.resetSession("A");
    expect(detector.getWindowLength("A")).toBe(0);
    expect(detector.getWindowLength("B")).toBe(1);
    expect(detector.getSessionCount()).toBe(1);
  });

  it("resetAll clears every session", () => {
    const detector = new LoopDetector();
    detector.record("A", "Read", { path: "/x" });
    detector.record("B", "Read", { path: "/y" });
    detector.resetAll();
    expect(detector.getSessionCount()).toBe(0);
  });
});

describe("LoopDetector — sliding window", () => {
  it("evicts entries outside windowSize", () => {
    const detector = new LoopDetector({ windowSize: 4, threshold: 3 });
    // Fill window with 2 "Read /foo" then 3 interleavers, then 2 more "Read /foo"
    detector.record("s1", "Read", { path: "/foo" }); // [R1]
    detector.record("s1", "Read", { path: "/foo" }); // [R1,R1]
    detector.record("s1", "Bash", { cmd: "a" }); //    [R1,R1,Ba]
    detector.record("s1", "Bash", { cmd: "b" }); //    [R1,R1,Ba,Bb]
    detector.record("s1", "Bash", { cmd: "c" }); //    [R1,Ba,Bb,Bc]  <- first R1 evicted
    detector.record("s1", "Read", { path: "/foo" }); // [Ba,Bb,Bc,R1] <- only 1 R1 now
    const r = detector.record("s1", "Read", { path: "/foo" }); // [Bb,Bc,R1,R1] — 2 R1 in window
    expect(r.detected).toBe(false);
    expect(r.count).toBe(2);
  });

  it("window holds no more than windowSize entries", () => {
    const detector = new LoopDetector({ windowSize: 3, threshold: 3 });
    for (let i = 0; i < 10; i++) {
      detector.record("s1", "Tool", { i });
    }
    expect(detector.getWindowLength("s1")).toBe(3);
  });
});

describe("LoopDetector — custom thresholds", () => {
  it("respects threshold=5", () => {
    const detector = new LoopDetector({ threshold: 5 });
    for (let i = 0; i < 4; i++) {
      const r = detector.record("s1", "X", {});
      expect(r.detected).toBe(false);
    }
    const r5 = detector.record("s1", "X", {});
    expect(r5.detected).toBe(true);
    expect(r5.count).toBe(5);
  });

  it("respects threshold=2 (strict)", () => {
    const detector = new LoopDetector({ threshold: 2 });
    detector.record("s1", "X", {});
    const r = detector.record("s1", "X", {});
    expect(r.detected).toBe(true);
    expect(r.count).toBe(2);
  });
});

describe("LoopDetector — nudge message", () => {
  it("builds nudge when detected", () => {
    const detector = new LoopDetector();
    detector.record("s1", "Read", { path: "/foo" });
    detector.record("s1", "Read", { path: "/foo" });
    const r = detector.record("s1", "Read", { path: "/foo" });
    const nudge = detector.buildNudge(r);
    expect(nudge).not.toBeNull();
    expect(nudge).toContain("system_reminder");
    expect(nudge).toContain("loop");
    expect(nudge).toContain("Read");
    expect(nudge).toContain("3");
  });

  it("returns null for non-detections", () => {
    const detector = new LoopDetector();
    const r = detector.record("s1", "Read", { path: "/foo" });
    expect(detector.buildNudge(r)).toBeNull();
  });
});

// ── Pipeline Wiring ──────────────────────────────────────────

describe("LoopDetection pipeline middleware", () => {
  it("registers at order 24.5 in the default pipeline", () => {
    const pipeline = createDefaultPipeline();
    const layer = pipeline.getLayer("LoopDetection");
    expect(layer).toBeDefined();
    expect(layer?.order).toBe(24.5);
  });

  it("default pipeline includes LoopDetection immediately after DoomLoop", () => {
    const pipeline = createDefaultPipeline();
    const names = pipeline.getLayerNames();
    const doomIdx = names.indexOf("DoomLoop");
    const loopIdx = names.indexOf("LoopDetection");
    expect(doomIdx).toBeGreaterThanOrEqual(0);
    expect(loopIdx).toBe(doomIdx + 1);
  });

  it("SelfReflection remains the last pipeline layer", () => {
    const pipeline = createDefaultPipeline();
    const names = pipeline.getLayerNames();
    expect(names[names.length - 1]).toBe("SelfReflection");
  });

  it("getDefaultLoopDetector returns a shared LoopDetector instance", () => {
    const d1 = getDefaultLoopDetector();
    const d2 = getDefaultLoopDetector();
    expect(d1).toBe(d2);
  });

  it("createPipelineWithInstances exposes a LoopDetector", () => {
    const checklist = new PreCompletionChecklistMiddleware();
    const notifications = new SystemNotificationTracker();
    const instances = createPipelineWithInstances(checklist, notifications);
    expect(instances.loopDetector).toBeInstanceOf(LoopDetector);
    // Confirm the exposed instance is the one actually wired into the pipeline.
    const layer = instances.pipeline.getLayer("LoopDetection");
    expect(layer).toBeDefined();
  });

  it("adapter injects nudge into followUp on detection", async () => {
    const detector = new LoopDetector({ threshold: 2 }); // lower bar for test speed
    const mw = createLoopDetectionMiddleware(detector);
    const ctx = makeCtx("test-session");

    await mw.after!(ctx, makeResult({ filePath: "/foo.ts" }));
    const second = await mw.after!(ctx, makeResult({ filePath: "/foo.ts" }));

    expect(second.followUp).toBeDefined();
    expect(second.followUp).toContain("loop");
    expect(second.followUp).toContain("Bash");
  });

  it("adapter passes through when no toolName on result", async () => {
    const detector = new LoopDetector({ threshold: 2 });
    const mw = createLoopDetectionMiddleware(detector);
    const ctx = makeCtx("s-no-tool");
    const result = await mw.after!(ctx, {
      content: "noop",
      success: true,
    });
    expect(result.followUp).toBeUndefined();
  });

  it("adapter appends to existing followUp without replacing it", async () => {
    const detector = new LoopDetector({ threshold: 2 });
    const mw = createLoopDetectionMiddleware(detector);
    const ctx = makeCtx("s-append");

    await mw.after!(ctx, makeResult({ filePath: "/foo" }));
    const r = await mw.after!(
      ctx,
      makeResult({ filePath: "/foo", followUp: "PRIOR MESSAGE" }),
    );

    expect(r.followUp).toContain("PRIOR MESSAGE");
    expect(r.followUp).toContain("loop");
    // Order: prior message first, nudge second.
    expect(r.followUp!.indexOf("PRIOR MESSAGE")).toBeLessThan(
      r.followUp!.indexOf("loop"),
    );
  });

  it("adapter respects per-session state — two ctx.sessionIds are isolated", async () => {
    const detector = new LoopDetector({ threshold: 2 });
    const mw = createLoopDetectionMiddleware(detector);
    const ctxA = makeCtx("A");
    const ctxB = makeCtx("B");

    // A fires twice → detection
    await mw.after!(ctxA, makeResult({ filePath: "/foo" }));
    const rA2 = await mw.after!(ctxA, makeResult({ filePath: "/foo" }));
    expect(rA2.followUp).toBeDefined();

    // B fires once with the same args → must NOT trigger
    const rB1 = await mw.after!(ctxB, makeResult({ filePath: "/foo" }));
    expect(rB1.followUp).toBeUndefined();
  });
});
