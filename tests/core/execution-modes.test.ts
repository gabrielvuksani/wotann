/**
 * Tests for src/core/execution-modes.ts (T12.19).
 *
 * Asserts:
 *   - Catalog shape: 5 modes with stable ids
 *   - Each descriptor has the documented fields and frozen sub-objects
 *   - getExecutionMode honours QB #6 honest-stub posture
 *   - modePermits implements the documented risk ordering
 *   - describeExecutionMode renders all three pieces of info
 *   - isExecutionMode narrows unknown safely
 */

import { describe, it, expect } from "vitest";
import {
  EXECUTION_MODES,
  EXECUTION_MODE_IDS,
  EXECUTION_MODE_VERSION,
  describeExecutionMode,
  getExecutionMode,
  isExecutionMode,
  modePermits,
  type ExecutionMode,
} from "../../src/core/execution-modes.js";

describe("EXECUTION_MODES catalog", () => {
  it("contains exactly the 5 documented modes", () => {
    expect(Object.keys(EXECUTION_MODES).sort()).toEqual(
      ["audit", "autopilot", "dry-run", "interactive", "review"].sort(),
    );
    expect(EXECUTION_MODE_IDS).toHaveLength(5);
  });

  it("each descriptor has the documented fields", () => {
    for (const id of EXECUTION_MODE_IDS) {
      const m = EXECUTION_MODES[id];
      expect(m.id).toBe(id);
      expect(typeof m.label).toBe("string");
      expect(m.label.length).toBeGreaterThan(0);
      expect(typeof m.description).toBe("string");
      expect(m.description.length).toBeGreaterThan(0);
      expect(["safe", "caution", "dangerous", "destructive"]).toContain(
        m.defaultRiskCap,
      );
      expect(typeof m.hint).toBe("string");
      expect(m.hint.length).toBeLessThanOrEqual(32);
    }
  });

  it("EXECUTION_MODES is frozen at top level", () => {
    expect(Object.isFrozen(EXECUTION_MODES)).toBe(true);
  });

  it("each descriptor is frozen so consumers cannot mutate", () => {
    for (const id of EXECUTION_MODE_IDS) {
      expect(Object.isFrozen(EXECUTION_MODES[id])).toBe(true);
    }
  });

  it("EXECUTION_MODE_IDS is frozen and contains every mode key", () => {
    expect(Object.isFrozen(EXECUTION_MODE_IDS)).toBe(true);
    for (const id of Object.keys(EXECUTION_MODES) as ExecutionMode[]) {
      expect(EXECUTION_MODE_IDS).toContain(id);
    }
  });

  it("documented version constant is exported as 1", () => {
    expect(EXECUTION_MODE_VERSION).toBe(1);
  });
});

describe("isExecutionMode", () => {
  it("returns true for every catalog id", () => {
    for (const id of EXECUTION_MODE_IDS) {
      expect(isExecutionMode(id)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isExecutionMode("yolo")).toBe(false);
    expect(isExecutionMode("plan")).toBe(false);
    expect(isExecutionMode("")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isExecutionMode(0)).toBe(false);
    expect(isExecutionMode(null)).toBe(false);
    expect(isExecutionMode(undefined)).toBe(false);
    expect(isExecutionMode({ id: "interactive" })).toBe(false);
  });
});

describe("getExecutionMode (honest-stub posture)", () => {
  it("returns ok=true with the right descriptor for known ids", () => {
    const result = getExecutionMode("autopilot");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode.id).toBe("autopilot");
      expect(result.mode.label).toBe("Autopilot");
    }
  });

  it("returns ok=false with a descriptive error for unknown ids", () => {
    const result = getExecutionMode("turbo");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("turbo");
      expect(result.error).toContain("Valid:");
      // Includes every valid mode id in the error message.
      for (const id of EXECUTION_MODE_IDS) {
        expect(result.error).toContain(id);
      }
    }
  });

  it("never throws — even on bizarre inputs", () => {
    expect(() => getExecutionMode("")).not.toThrow();
    expect(() => getExecutionMode("___")).not.toThrow();
  });
});

describe("describeExecutionMode", () => {
  it("renders label, hint, and risk cap for each mode", () => {
    for (const id of EXECUTION_MODE_IDS) {
      const out = describeExecutionMode(id);
      expect(out).toContain(EXECUTION_MODES[id].label);
      expect(out).toContain(EXECUTION_MODES[id].hint);
      expect(out).toContain(EXECUTION_MODES[id].defaultRiskCap);
    }
  });
});

describe("modePermits (risk gating)", () => {
  it("interactive permits every risk level (cap: destructive)", () => {
    expect(modePermits("interactive", "safe")).toBe(true);
    expect(modePermits("interactive", "caution")).toBe(true);
    expect(modePermits("interactive", "dangerous")).toBe(true);
    expect(modePermits("interactive", "destructive")).toBe(true);
  });

  it("autopilot permits up to dangerous, blocks destructive", () => {
    expect(modePermits("autopilot", "safe")).toBe(true);
    expect(modePermits("autopilot", "caution")).toBe(true);
    expect(modePermits("autopilot", "dangerous")).toBe(true);
    expect(modePermits("autopilot", "destructive")).toBe(false);
  });

  it("dry-run permits only safe", () => {
    expect(modePermits("dry-run", "safe")).toBe(true);
    expect(modePermits("dry-run", "caution")).toBe(false);
    expect(modePermits("dry-run", "dangerous")).toBe(false);
    expect(modePermits("dry-run", "destructive")).toBe(false);
  });

  it("review permits up to caution, blocks higher", () => {
    expect(modePermits("review", "safe")).toBe(true);
    expect(modePermits("review", "caution")).toBe(true);
    expect(modePermits("review", "dangerous")).toBe(false);
    expect(modePermits("review", "destructive")).toBe(false);
  });

  it("audit permits only safe (read-only)", () => {
    expect(modePermits("audit", "safe")).toBe(true);
    expect(modePermits("audit", "caution")).toBe(false);
    expect(modePermits("audit", "dangerous")).toBe(false);
    expect(modePermits("audit", "destructive")).toBe(false);
  });
});
