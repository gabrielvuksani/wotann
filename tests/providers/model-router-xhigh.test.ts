/**
 * V9 T14.1a — Opus 4.7 xhigh effort helper tests.
 *
 * Covers the gatekeeping logic that decides whether to pass xhigh to
 * a given model, and the clamp behavior for non-supporting models.
 */

import { describe, expect, it } from "vitest";
import {
  clampEffortForModel,
  supportsXhighEffort,
} from "../../src/providers/model-router.js";

describe("supportsXhighEffort", () => {
  it("returns true for canonical Opus 4.7 IDs", () => {
    expect(supportsXhighEffort("claude-opus-4-7")).toBe(true);
    expect(supportsXhighEffort("claude-opus-4-7[1m]")).toBe(true);
    expect(supportsXhighEffort("opus-4-7")).toBe(true);
    expect(supportsXhighEffort("opus4-7")).toBe(true);
  });

  it("returns true for pinned revisions of Opus 4.7", () => {
    expect(supportsXhighEffort("claude-opus-4-7-2026-04-12")).toBe(true);
    expect(supportsXhighEffort("claude-opus-4-7-latest")).toBe(true);
  });

  it("returns false for older Opus models (pre-4-7)", () => {
    // Wave 9 V14+ integrator: claude-opus-4-6 retired June 15 2026.
    // The "older" test target stays at 4-6 because the contract is
    // "should return false for the version that was current BEFORE
    // the xhigh-bump"; bulk-sed bumped this to 4-7 which the source
    // legitimately now treats as TRUE (current Opus). Restored.
    expect(supportsXhighEffort("claude-opus-4-6")).toBe(false);
    expect(supportsXhighEffort("claude-opus-4-5")).toBe(false);
    expect(supportsXhighEffort("claude-opus-3")).toBe(false);
  });

  it("returns false for Sonnet / Haiku family", () => {
    expect(supportsXhighEffort("claude-sonnet-4-7")).toBe(false);
    expect(supportsXhighEffort("claude-haiku-4-5")).toBe(false);
  });

  it("returns false for non-Anthropic models", () => {
    expect(supportsXhighEffort("gpt-5")).toBe(false);
    expect(supportsXhighEffort("gemini-2-flash")).toBe(false);
    expect(supportsXhighEffort("llama-3.3-70b")).toBe(false);
    expect(supportsXhighEffort("")).toBe(false);
  });
});

describe("clampEffortForModel", () => {
  it("passes xhigh through when the model supports it", () => {
    expect(clampEffortForModel("xhigh", "claude-opus-4-7")).toBe("xhigh");
  });

  it("clamps xhigh down to high when the model doesn't support it", () => {
    // Explicitly high, not max — per the documented rationale that
    // we never silently upgrade the user to a 4x-budget tier.
    expect(clampEffortForModel("xhigh", "claude-sonnet-4-7")).toBe("high");
    expect(clampEffortForModel("xhigh", "gpt-5")).toBe("high");
  });

  it("passes every other effort level through unchanged", () => {
    const levels = ["low", "medium", "high", "max"] as const;
    for (const effort of levels) {
      expect(clampEffortForModel(effort, "claude-sonnet-4-7")).toBe(effort);
      expect(clampEffortForModel(effort, "claude-opus-4-7")).toBe(effort);
    }
  });

  it("never upgrades below-xhigh efforts to xhigh, even on Opus 4.7", () => {
    expect(clampEffortForModel("high", "claude-opus-4-7")).toBe("high");
    expect(clampEffortForModel("medium", "claude-opus-4-7")).toBe("medium");
  });
});
