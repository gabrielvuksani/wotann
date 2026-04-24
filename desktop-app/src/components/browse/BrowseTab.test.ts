/**
 * BrowseTab.test.ts — unit tests for the pure helpers (V9 T10.3).
 *
 * Tests are intentionally JSX-free. We exercise the exported helper
 * functions only — React rendering is out of scope for this task.
 *
 * Vitest picks this file up via desktop-app/vitest.config.ts which
 * includes `src/**\/*.test.ts`. The helpers live in the sibling
 * BrowseTab.tsx; vite's React plugin transforms the file on import
 * so the test never sees the JSX.
 *
 * Coverage targets (spec asks for >=15 assertions):
 *   - formatTurnDuration: ms, seconds, minutes, in-progress (null endTs)
 *   - riskColor: low / medium / high
 *   - stepIcon: all 6 BrowsePlanStepKindView cases, uniqueness
 *   - isSessionActive: each of the 6 statuses
 *   - summarizePlan: empty, 1-step, 2-4 steps, many steps
 *   - statusChrome: each status yields a non-empty label + color
 */

import { describe, expect, it } from "vitest";
import {
  formatTurnDuration,
  isSessionActive,
  riskColor,
  statusChrome,
  stepIcon,
  summarizePlan,
} from "./BrowseTab";
import type { BrowsePlanStepKindView, BrowsePlanStepView } from "./types";

// Fixed clock so in-progress durations are deterministic.
const FIXED_NOW = 10_000;
const now = (): number => FIXED_NOW;

function mkStep(kind: BrowsePlanStepKindView, idx: number): BrowsePlanStepView {
  return {
    id: `s${idx}`,
    kind,
    rationale: `because ${idx}`,
  };
}

describe("formatTurnDuration", () => {
  it("formats a sub-second duration in milliseconds", () => {
    expect(formatTurnDuration(0, 500, now)).toBe("500ms");
  });

  it("formats a second-scale duration as tenths of a second", () => {
    expect(formatTurnDuration(0, 1_500, now)).toBe("1.5s");
  });

  it("formats a multi-minute duration as m + s", () => {
    expect(formatTurnDuration(0, 2 * 60_000 + 3_000, now)).toBe("2m3s");
  });

  it("treats endTs === null as in-progress and uses now()", () => {
    // delta = 10_000 - 5_000 = 5_000ms = 5.0s, with suffix
    expect(formatTurnDuration(5_000, null, now)).toBe("5.0s…");
  });

  it("handles exactly-zero elapsed (clamped to >=0)", () => {
    expect(formatTurnDuration(100, 100, now)).toBe("0ms");
  });

  it("clamps negative deltas to zero (clock skew safety)", () => {
    expect(formatTurnDuration(200, 100, now)).toBe("0ms");
  });

  it("in-progress in ms range keeps the ellipsis", () => {
    // start = 9500, now = 10_000, delta = 500
    expect(formatTurnDuration(9_500, null, now)).toBe("500ms…");
  });
});

describe("riskColor", () => {
  it("low risk returns the info token", () => {
    expect(riskColor("low")).toContain("info");
  });
  it("medium risk returns the amber token", () => {
    expect(riskColor("medium")).toContain("amber");
  });
  it("high risk returns the error token", () => {
    expect(riskColor("high")).toContain("error");
  });
  it("each risk yields a distinct color", () => {
    const colors = new Set([
      riskColor("low"),
      riskColor("medium"),
      riskColor("high"),
    ]);
    expect(colors.size).toBe(3);
  });
});

describe("stepIcon", () => {
  const kinds: readonly BrowsePlanStepKindView[] = [
    "navigate",
    "click",
    "type",
    "read",
    "extract",
    "approve",
  ];

  it("returns a non-empty icon for every plan-step kind", () => {
    for (const k of kinds) {
      const icon = stepIcon(k);
      expect(typeof icon).toBe("string");
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it("emits a unique icon per kind (no collisions)", () => {
    const icons = new Set(kinds.map((k) => stepIcon(k)));
    expect(icons.size).toBe(kinds.length);
  });
});

describe("isSessionActive", () => {
  it("planning is active", () => {
    expect(isSessionActive("planning")).toBe(true);
  });
  it("awaiting-approval is active", () => {
    expect(isSessionActive("awaiting-approval")).toBe(true);
  });
  it("running is active", () => {
    expect(isSessionActive("running")).toBe(true);
  });
  it("halted is NOT active", () => {
    expect(isSessionActive("halted")).toBe(false);
  });
  it("complete is NOT active", () => {
    expect(isSessionActive("complete")).toBe(false);
  });
  it("failed is NOT active", () => {
    expect(isSessionActive("failed")).toBe(false);
  });
});

describe("summarizePlan", () => {
  it("empty plan summary", () => {
    expect(summarizePlan([])).toBe("No plan yet");
  });

  it("one-step plan includes the kind name", () => {
    const s = summarizePlan([mkStep("navigate", 0)]);
    expect(s).toContain("1 step");
    expect(s).toContain("navigate");
  });

  it("two-step plan enumerates icons", () => {
    const s = summarizePlan([mkStep("navigate", 0), mkStep("click", 1)]);
    expect(s).toContain("2 steps");
    // Both icons must appear.
    expect(s).toContain(stepIcon("navigate"));
    expect(s).toContain(stepIcon("click"));
  });

  it("four-step plan still enumerates all icons", () => {
    const s = summarizePlan([
      mkStep("navigate", 0),
      mkStep("click", 1),
      mkStep("type", 2),
      mkStep("read", 3),
    ]);
    expect(s).toContain("4 steps");
    expect(s).toContain(stepIcon("navigate"));
    expect(s).toContain(stepIcon("click"));
    expect(s).toContain(stepIcon("type"));
    expect(s).toContain(stepIcon("read"));
  });

  it("many-step plan uses the 'first N' format", () => {
    const many: readonly BrowsePlanStepView[] = [
      mkStep("navigate", 0),
      mkStep("click", 1),
      mkStep("type", 2),
      mkStep("read", 3),
      mkStep("extract", 4),
      mkStep("approve", 5),
    ];
    const s = summarizePlan(many);
    expect(s).toContain("6 steps");
    expect(s).toContain("first");
  });
});

describe("statusChrome", () => {
  it("each status yields a non-empty label", () => {
    const statuses = [
      "planning",
      "awaiting-approval",
      "running",
      "halted",
      "complete",
      "failed",
    ] as const;
    for (const s of statuses) {
      const chrome = statusChrome(s);
      expect(chrome.label.length).toBeGreaterThan(0);
      expect(chrome.color.length).toBeGreaterThan(0);
      expect(chrome.bg.length).toBeGreaterThan(0);
    }
  });

  it("running and failed have different colors", () => {
    expect(statusChrome("running").color).not.toBe(
      statusChrome("failed").color,
    );
  });

  it("awaiting-approval label mentions approval", () => {
    expect(statusChrome("awaiting-approval").label.toLowerCase()).toContain(
      "approval",
    );
  });
});
