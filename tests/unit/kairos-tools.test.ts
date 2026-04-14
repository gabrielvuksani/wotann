import { describe, it, expect } from "vitest";
import {
  pushNotification,
  detectPREvents,
  healthCheck,
  type PRState,
} from "../../src/daemon/kairos-tools.js";

describe("KAIROS Tools", () => {
  describe("pushNotification", () => {
    it("returns boolean (success/fallback)", () => {
      const result = pushNotification({
        title: "Test",
        body: "Test notification",
      });
      // On macOS in dev, may succeed; in CI, falls back to console
      expect(typeof result).toBe("boolean");
    });
  });

  describe("detectPREvents", () => {
    it("detects merge event", () => {
      const prev: PRState = { number: 1, title: "PR", state: "open", checksStatus: "success", lastUpdated: "" };
      const curr: PRState = { number: 1, title: "PR", state: "merged", checksStatus: "success", lastUpdated: "" };
      const events = detectPREvents(prev, curr);
      expect(events).toContain("merged");
    });

    it("detects checks_passed event", () => {
      const prev: PRState = { number: 1, title: "PR", state: "open", checksStatus: "pending", lastUpdated: "" };
      const curr: PRState = { number: 1, title: "PR", state: "open", checksStatus: "success", lastUpdated: "" };
      const events = detectPREvents(prev, curr);
      expect(events).toContain("checks_passed");
    });

    it("detects checks_failed event", () => {
      const prev: PRState = { number: 1, title: "PR", state: "open", checksStatus: "pending", lastUpdated: "" };
      const curr: PRState = { number: 1, title: "PR", state: "open", checksStatus: "failure", lastUpdated: "" };
      const events = detectPREvents(prev, curr);
      expect(events).toContain("checks_failed");
    });

    it("detects close event", () => {
      const prev: PRState = { number: 1, title: "PR", state: "open", checksStatus: "success", lastUpdated: "" };
      const curr: PRState = { number: 1, title: "PR", state: "closed", checksStatus: "success", lastUpdated: "" };
      const events = detectPREvents(prev, curr);
      expect(events).toContain("closed");
    });

    it("returns empty for no changes", () => {
      const state: PRState = { number: 1, title: "PR", state: "open", checksStatus: "pending", lastUpdated: "" };
      const events = detectPREvents(state, state);
      expect(events).toHaveLength(0);
    });
  });

  describe("healthCheck", () => {
    it("reports unhealthy for unreachable service", async () => {
      const result = await healthCheck("test", "http://localhost:99999", 2000);
      expect(result.healthy).toBe(false);
      expect(result.service).toBe("test");
    });
  });
});
