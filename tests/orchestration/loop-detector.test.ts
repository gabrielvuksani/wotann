import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOOP_DETECTOR,
  extractSignature,
  makeLoopDetector,
} from "../../src/orchestration/loop-detector.js";

describe("loop-detector — extractSignature", () => {
  it("buckets overlapping read_file line ranges to the same signature", () => {
    const a = extractSignature("read_file", {
      path: "src/foo.ts",
      lineStart: 200,
    });
    const b = extractSignature("read_file", {
      path: "src/foo.ts",
      lineStart: 350,
    });
    const c = extractSignature("read_file", {
      path: "src/foo.ts",
      lineStart: 399,
    });
    // 200, 350, 399 all fall into the [200, 400) bucket at default bucket=200.
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("separates read_file ranges that fall in different buckets", () => {
    const a = extractSignature("read_file", {
      path: "src/foo.ts",
      lineStart: 100,
    });
    const b = extractSignature("read_file", {
      path: "src/foo.ts",
      lineStart: 400,
    });
    expect(a).not.toBe(b);
  });

  it("collapses edit_file with different content but same path", () => {
    const a = extractSignature("edit_file", {
      path: "src/foo.ts",
      content: "v1",
    });
    const b = extractSignature("edit_file", {
      path: "src/foo.ts",
      content: "v2",
    });
    expect(a).toBe(b);
  });

  it("strips query string from web_fetch URLs", () => {
    const a = extractSignature("web_fetch", { url: "https://x.com/a?ts=1" });
    const b = extractSignature("web_fetch", { url: "https://x.com/a?ts=2" });
    expect(a).toBe(b);
  });

  it("trims whitespace in bash commands", () => {
    const a = extractSignature("bash", { command: "  ls -la  " });
    const b = extractSignature("bash", { command: "ls -la" });
    expect(a).toBe(b);
  });

  it("uses pattern+path for grep", () => {
    const a = extractSignature("grep", { pattern: "TODO", path: "src" });
    const b = extractSignature("grep", { pattern: "TODO", path: "src" });
    const c = extractSignature("grep", { pattern: "FIXME", path: "src" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("uses stable sorted JSON for unknown tools", () => {
    const a = extractSignature("custom_tool", { b: 2, a: 1 });
    const b = extractSignature("custom_tool", { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("caps default-fallback signature length", () => {
    const big = "x".repeat(10_000);
    const sig = extractSignature("custom_tool", { payload: big });
    expect(sig.length).toBeLessThan(400);
  });
});

describe("loop-detector — makeLoopDetector", () => {
  it("returns ok for the first occurrence", () => {
    const d = makeLoopDetector();
    const v = d.observe({ name: "read_file", args: { path: "a.ts" } });
    expect(v.type).toBe("ok");
  });

  it("warns at exactly repeatWarnThreshold reps (default 3)", () => {
    const d = makeLoopDetector();
    d.observe({ name: "read_file", args: { path: "a.ts" } });
    d.observe({ name: "read_file", args: { path: "a.ts" } });
    const v = d.observe({ name: "read_file", args: { path: "a.ts" } });
    expect(v.type).toBe("warn");
    if (v.type !== "ok") expect(v.details.reps).toBe(3);
  });

  it("force-stops at repeatStopThreshold reps (default 5)", () => {
    const d = makeLoopDetector();
    let v;
    for (let i = 0; i < 5; i++) {
      v = d.observe({ name: "read_file", args: { path: "a.ts" } });
    }
    expect(v).toBeDefined();
    expect(v?.type).toBe("stop");
  });

  it("treats overlapping read_file ranges as the same bucket (content-aware)", () => {
    const d = makeLoopDetector();
    // Three calls with different line offsets but all in the [0, 200) bucket.
    d.observe({ name: "read_file", args: { path: "a.ts", lineStart: 0 } });
    d.observe({ name: "read_file", args: { path: "a.ts", lineStart: 50 } });
    const v = d.observe({
      name: "read_file",
      args: { path: "a.ts", lineStart: 199 },
    });
    expect(v.type).toBe("warn");
  });

  it("does not warn when reads are in different buckets", () => {
    const d = makeLoopDetector();
    d.observe({ name: "read_file", args: { path: "a.ts", lineStart: 0 } });
    d.observe({ name: "read_file", args: { path: "a.ts", lineStart: 200 } });
    const v = d.observe({
      name: "read_file",
      args: { path: "a.ts", lineStart: 400 },
    });
    expect(v.type).toBe("ok");
  });

  it("warns at perToolWarnThreshold (30) distinct calls of same tool", () => {
    const d = makeLoopDetector();
    let v;
    for (let i = 0; i < 30; i++) {
      // Different paths -> different signatures, but same tool.
      v = d.observe({ name: "grep", args: { pattern: `p${i}`, path: "src" } });
    }
    expect(v?.type).toBe("warn");
  });

  it("force-stops at perToolStopThreshold (50) distinct calls of same tool", () => {
    const d = makeLoopDetector({ windowSize: 200 });
    let v;
    for (let i = 0; i < 50; i++) {
      v = d.observe({ name: "grep", args: { pattern: `p${i}`, path: "src" } });
    }
    expect(v?.type).toBe("stop");
  });

  it("respects per-instance state — two detectors are independent", () => {
    const a = makeLoopDetector();
    const b = makeLoopDetector();
    for (let i = 0; i < 5; i++) {
      a.observe({ name: "read_file", args: { path: "a.ts" } });
    }
    const vb = b.observe({ name: "read_file", args: { path: "a.ts" } });
    expect(vb.type).toBe("ok");
  });

  it("reset() clears window state", () => {
    const d = makeLoopDetector();
    for (let i = 0; i < 4; i++) {
      d.observe({ name: "read_file", args: { path: "a.ts" } });
    }
    d.reset();
    const v = d.observe({ name: "read_file", args: { path: "a.ts" } });
    expect(v.type).toBe("ok");
  });

  it("evicts old entries past windowSize", () => {
    const d = makeLoopDetector({ windowSize: 4 });
    // Two of the same signature, then push 4 different ones to flush.
    d.observe({ name: "read_file", args: { path: "x.ts" } });
    d.observe({ name: "read_file", args: { path: "x.ts" } });
    for (let i = 0; i < 4; i++) {
      d.observe({ name: "grep", args: { pattern: `p${i}`, path: "." } });
    }
    // Window now contains 4 grep calls; the two reads are evicted.
    const v = d.observe({ name: "read_file", args: { path: "x.ts" } });
    expect(v.type).toBe("ok");
  });

  it("exact-signature stop wins over per-tool warn", () => {
    const d = makeLoopDetector();
    // 5 identical reads -> exact-signature stop, not a frequency warn.
    let v;
    for (let i = 0; i < 5; i++) {
      v = d.observe({ name: "read_file", args: { path: "a.ts" } });
    }
    expect(v?.type).toBe("stop");
    if (v?.type === "stop") {
      expect(v.details.reps).toBe(5);
    }
  });

  it("DEFAULT_LOOP_DETECTOR has expected thresholds", () => {
    expect(DEFAULT_LOOP_DETECTOR.windowSize).toBe(50);
    expect(DEFAULT_LOOP_DETECTOR.repeatWarnThreshold).toBe(3);
    expect(DEFAULT_LOOP_DETECTOR.repeatStopThreshold).toBe(5);
    expect(DEFAULT_LOOP_DETECTOR.perToolWarnThreshold).toBe(30);
    expect(DEFAULT_LOOP_DETECTOR.perToolStopThreshold).toBe(50);
    expect(DEFAULT_LOOP_DETECTOR.readFileLineBucket).toBe(200);
  });
});
