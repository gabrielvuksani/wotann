import { describe, it, expect } from "vitest";
import {
  HAPTIC_MAP,
  resolveHaptic,
  listTriggers,
} from "../../src/mobile/haptic-feedback.js";
import type { HapticPattern } from "../../src/mobile/haptic-feedback.js";

describe("HAPTIC_MAP", () => {
  it("should contain at least 10 mappings", () => {
    expect(HAPTIC_MAP.length).toBeGreaterThanOrEqual(10);
  });

  it("should have unique triggers", () => {
    const triggers = HAPTIC_MAP.map((e) => e.trigger);
    const unique = new Set(triggers);
    expect(unique.size).toBe(triggers.length);
  });

  it("should only use valid haptic patterns", () => {
    const validPatterns: readonly HapticPattern[] = [
      "success",
      "error",
      "warning",
      "selection",
      "impact-light",
      "impact-medium",
      "impact-heavy",
    ];
    for (const event of HAPTIC_MAP) {
      expect(validPatterns).toContain(event.pattern);
    }
  });

  it("should map known app events correctly", () => {
    const map = new Map(HAPTIC_MAP.map((e) => [e.trigger, e.pattern]));
    expect(map.get("message-sent")).toBe("impact-light");
    expect(map.get("response-complete")).toBe("success");
    expect(map.get("error")).toBe("error");
    expect(map.get("arena-complete")).toBe("impact-heavy");
    expect(map.get("budget-warning")).toBe("warning");
    expect(map.get("tab-switch")).toBe("selection");
  });
});

describe("resolveHaptic", () => {
  it("should resolve known triggers", () => {
    expect(resolveHaptic("message-sent")).toBe("impact-light");
    expect(resolveHaptic("task-complete")).toBe("success");
    expect(resolveHaptic("voice-start")).toBe("impact-medium");
  });

  it("should return null for unknown triggers", () => {
    expect(resolveHaptic("nonexistent")).toBeNull();
    expect(resolveHaptic("")).toBeNull();
  });
});

describe("listTriggers", () => {
  it("should return all trigger names", () => {
    const triggers = listTriggers();
    expect(triggers.length).toBe(HAPTIC_MAP.length);
    expect(triggers).toContain("message-sent");
    expect(triggers).toContain("error");
    expect(triggers).toContain("file-received");
  });

  it("should not contain duplicates", () => {
    const triggers = listTriggers();
    const unique = new Set(triggers);
    expect(unique.size).toBe(triggers.length);
  });
});
