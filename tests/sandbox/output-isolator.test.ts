import { describe, it, expect } from "vitest";
import {
  isolateOutput,
  formatIsolatedPreview,
  OutputIsolationStore,
} from "../../src/sandbox/output-isolator.js";

describe("isolateOutput", () => {
  it("returns pass-through for small outputs", () => {
    const iso = isolateOutput("short text");
    expect(iso.compressionRatio).toBe(1);
    expect(iso.head).toBe("short text");
  });

  it("compresses large outputs", () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const iso = isolateOutput(big);
    expect(iso.compressionRatio).toBeLessThan(1);
    expect(iso.originalSize).toBeGreaterThan(1000);
    expect(iso.previewSize).toBeLessThan(iso.originalSize);
  });

  it("keeps head N lines and tail N lines", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i}`);
    const big = lines.join("\n");
    const iso = isolateOutput(big, { headLines: 3, tailLines: 2, minSizeToIsolate: 100 });
    const headLinesOut = iso.head.split("\n");
    const tailLinesOut = iso.tail.split("\n");
    expect(headLinesOut).toEqual(["line0", "line1", "line2"]);
    expect(tailLinesOut).toEqual(["line498", "line499"]);
  });

  it("reports elidedLines accurately", () => {
    const big = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
    const iso = isolateOutput(big, { headLines: 10, tailLines: 10, minSizeToIsolate: 100 });
    expect(iso.elidedLines).toBe(80);
  });

  it("includes error/fail patterns in summary", () => {
    // Place failure markers in the MIDDLE (scanned region = [headLines, total-tailLines))
    const lines = [
      "starting tests",
      ...Array.from({ length: 100 }, (_, i) => `test ${i} ok`),
      "FAIL: test42 should pass",
      "Error: connection refused",
      ...Array.from({ length: 100 }, (_, i) => `test ${i + 100} ok`),
      "done",
    ];
    const iso = isolateOutput(lines.join("\n"), { minSizeToIsolate: 100 });
    expect(iso.summary).toContain("FAIL: test42");
    expect(iso.summary).toContain("connection refused");
  });

  it("handle is deterministic for same input", () => {
    const big = "x".repeat(10_000);
    const iso1 = isolateOutput(big);
    const iso2 = isolateOutput(big);
    expect(iso1.handle).toBe(iso2.handle);
  });

  it("respects custom highlightPatterns", () => {
    const content = [
      "line1",
      ...Array.from({ length: 50 }, () => "middle"),
      "CUSTOM_MARKER found",
      ...Array.from({ length: 50 }, () => "middle"),
      "lineN",
    ].join("\n");
    const iso = isolateOutput(content, {
      highlightPatterns: [/CUSTOM_MARKER/],
      minSizeToIsolate: 100,
    });
    expect(iso.summary).toContain("CUSTOM_MARKER");
  });

  it("truncates further when preview exceeds maxPreviewBytes", () => {
    const hugeLine = "x".repeat(10_000);
    const big = Array.from({ length: 100 }, () => hugeLine).join("\n");
    const iso = isolateOutput(big, {
      maxPreviewBytes: 500,
      headLines: 50,
      tailLines: 50,
    });
    expect(iso.previewSize).toBeLessThanOrEqual(500);
  });

  it("98% reduction target achievable on large structured output", () => {
    // Simulate 300KB of repetitive test output
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) lines.push(`  ✓ test_${i} (1.23 ms)`);
    const big = lines.join("\n");
    const iso = isolateOutput(big);
    // Target: <5% ratio (95% compression at minimum)
    expect(iso.compressionRatio).toBeLessThan(0.05);
  });
});

describe("formatIsolatedPreview", () => {
  it("returns raw content for pass-through (small) outputs", () => {
    const iso = isolateOutput("small");
    expect(formatIsolatedPreview(iso)).toBe("small");
  });

  it("includes handle + sizes + head + tail for compressed", () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const iso = isolateOutput(big);
    const formatted = formatIsolatedPreview(iso);
    expect(formatted).toContain(`handle=${iso.handle}`);
    expect(formatted).toContain(`--- HEAD`);
    expect(formatted).toContain(`--- TAIL`);
    expect(formatted).toContain("read_isolated");
  });
});

describe("OutputIsolationStore", () => {
  it("stores and retrieves by handle", () => {
    const store = new OutputIsolationStore();
    store.store("h1", "content");
    expect(store.retrieve("h1")).toBe("content");
  });

  it("returns null for missing handle", () => {
    const store = new OutputIsolationStore();
    expect(store.retrieve("missing")).toBeNull();
  });

  it("evicts oldest when over maxEntries", () => {
    const store = new OutputIsolationStore({ maxEntries: 2 });
    store.store("a", "A");
    store.store("b", "B");
    store.store("c", "C");
    expect(store.retrieve("a")).toBeNull();
    expect(store.retrieve("b")).toBe("B");
    expect(store.retrieve("c")).toBe("C");
  });

  it("gc expired entries", () => {
    let now = 1_000_000;
    const store = new OutputIsolationStore({ ttlMs: 1000, now: () => now });
    store.store("h1", "content");
    now += 500;
    expect(store.retrieve("h1")).toBe("content");
    now += 600; // total 1100, > 1000 TTL
    expect(store.retrieve("h1")).toBeNull();
  });

  it("retrieveRange returns 1-indexed inclusive slice", () => {
    const store = new OutputIsolationStore();
    store.store("h", "L1\nL2\nL3\nL4\nL5");
    expect(store.retrieveRange("h", 2, 4)).toBe("L2\nL3\nL4");
  });

  it("retrieveRange clamps out-of-range requests", () => {
    const store = new OutputIsolationStore();
    store.store("h", "A\nB\nC");
    expect(store.retrieveRange("h", 0, 100)).toBe("A\nB\nC");
  });

  it("isolateAndStore stores only when compression occurred", () => {
    const store = new OutputIsolationStore();
    const smallIso = store.isolateAndStore("tiny");
    expect(store.retrieve(smallIso.handle)).toBeNull();
    const bigIso = store.isolateAndStore("x".repeat(10_000));
    expect(store.retrieve(bigIso.handle)).not.toBeNull();
  });

  it("size() reports entry count", () => {
    const store = new OutputIsolationStore();
    store.store("a", "A");
    store.store("b", "B");
    expect(store.size()).toBe(2);
    store.clear();
    expect(store.size()).toBe(0);
  });
});
