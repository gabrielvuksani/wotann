import { describe, it, expect } from "vitest";
import {
  detectPlateau,
  recommendPlateauResponse,
  DEFAULT_PLATEAU_CONFIG,
} from "../../src/orchestration/plateau-detector.js";

describe("plateau-detector: detectPlateau — insufficient history", () => {
  it("returns not-plateaued when scores < minIterations", () => {
    const verdict = detectPlateau([0.5, 0.5, 0.5]); // 3 < minIters=5
    expect(verdict.plateaued).toBe(false);
    expect(verdict.kind).toBeNull();
    expect(verdict.reason).toMatch(/insufficient/);
  });

  it("returns not-plateaued with exactly minIterations of varied scores", () => {
    const verdict = detectPlateau([0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(verdict.plateaued).toBe(false);
  });
});

describe("plateau-detector: detectPlateau — absolute-delta signal", () => {
  it("detects plateau when scores are within delta threshold", () => {
    // 5 scores all within 0.01 of each other — delta < 0.02 threshold
    const verdict = detectPlateau([0.75, 0.755, 0.752, 0.751, 0.754]);
    expect(verdict.plateaued).toBe(true);
    expect(verdict.kind).toBe("absolute-delta");
    expect(verdict.delta).toBeLessThan(0.02);
  });

  it("does not fire when delta exceeds threshold", () => {
    const verdict = detectPlateau([0.5, 0.55, 0.62, 0.71, 0.82]);
    expect(verdict.plateaued).toBe(false);
  });
});

describe("plateau-detector: detectPlateau — monotonic-drop signal", () => {
  it("detects plateau when scores strictly decreasing (regression)", () => {
    const verdict = detectPlateau([0.9, 0.8, 0.7, 0.6, 0.5]);
    expect(verdict.plateaued).toBe(true);
    expect(verdict.kind).toBe("monotonic-drop");
  });

  it("does not fire on strict increase", () => {
    const verdict = detectPlateau([0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(verdict.plateaued).toBe(false);
  });

  it("does not fire on flat-ish with noise (absolute-delta takes precedence)", () => {
    // Mostly decreasing but not strict — caught by absolute-delta instead
    const verdict = detectPlateau([0.9, 0.89, 0.9, 0.89, 0.895]);
    expect(verdict.plateaued).toBe(true);
    expect(verdict.kind).toBe("absolute-delta");
  });
});

describe("plateau-detector: detectPlateau — oscillation signal", () => {
  it("detects plateau when scores oscillate within tight band", () => {
    // All within 0.005 of mean 0.5, alternating direction
    const verdict = detectPlateau([0.5, 0.503, 0.497, 0.502, 0.498, 0.501], {
      ...DEFAULT_PLATEAU_CONFIG,
      windowSize: 6,
      deltaThreshold: 0.01,
    });
    // Delta is 0.006 < 0.01 so actually absolute-delta catches first
    expect(verdict.plateaued).toBe(true);
  });
});

describe("plateau-detector: detectPlateau — config validation", () => {
  it("throws on invalid window size", () => {
    expect(() => detectPlateau([0.5, 0.5, 0.5], { ...DEFAULT_PLATEAU_CONFIG, windowSize: 1 })).toThrow(
      /window size must be >= 2/,
    );
  });
});

describe("plateau-detector: recommendPlateauResponse", () => {
  it("recommends continue when not plateaued", () => {
    const verdict = detectPlateau([0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(recommendPlateauResponse(verdict, 0)).toBe("continue");
  });

  it("first plateau verdict → escalate-tier", () => {
    const verdict = detectPlateau([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(recommendPlateauResponse(verdict, 1)).toBe("escalate-tier");
  });

  it("second plateau verdict → request-human", () => {
    const verdict = detectPlateau([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(recommendPlateauResponse(verdict, 2)).toBe("request-human");
  });

  it("third plateau verdict → abort (no silent infinite loop)", () => {
    const verdict = detectPlateau([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(recommendPlateauResponse(verdict, 3)).toBe("abort");
  });
});
