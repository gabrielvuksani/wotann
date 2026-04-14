import { describe, it, expect } from "vitest";
import { DoomLoopDetector } from "../../src/hooks/doom-loop-detector.js";

describe("DoomLoop Detector (Phase 15)", () => {
  describe("consecutive detection", () => {
    it("detects 3 consecutive identical calls", () => {
      const detector = new DoomLoopDetector(3);
      detector.record("Read", { path: "/foo.ts" });
      detector.record("Read", { path: "/foo.ts" });
      const result = detector.record("Read", { path: "/foo.ts" });

      expect(result.detected).toBe(true);
      expect(result.type).toBe("consecutive");
      expect(result.count).toBe(3);
    });

    it("does not trigger below threshold", () => {
      const detector = new DoomLoopDetector(3);
      detector.record("Read", { path: "/foo.ts" });
      const result = detector.record("Read", { path: "/foo.ts" });

      expect(result.detected).toBe(false);
    });

    it("breaks on different calls", () => {
      const detector = new DoomLoopDetector(3);
      detector.record("Read", { path: "/foo.ts" });
      detector.record("Read", { path: "/foo.ts" });
      detector.record("Write", { path: "/bar.ts" });
      const result = detector.record("Read", { path: "/foo.ts" });

      expect(result.detected).toBe(false);
    });
  });

  describe("sequence detection [A,B,C,A,B,C,A,B,C]", () => {
    it("detects repeating sequence of length 2", () => {
      const detector = new DoomLoopDetector(3);
      // Build pattern: [A,B,A,B,A,B]
      detector.record("Read", { path: "/a" });
      detector.record("Edit", { path: "/b" });
      detector.record("Read", { path: "/a" });
      detector.record("Edit", { path: "/b" });
      detector.record("Read", { path: "/a" });
      const result = detector.record("Edit", { path: "/b" });

      expect(result.detected).toBe(true);
      expect(result.type).toBe("sequence");
      expect(result.sequenceLength).toBe(2);
    });

    it("detects repeating sequence of length 3", () => {
      const detector = new DoomLoopDetector(3);
      // [A,B,C,A,B,C,A,B,C]
      for (let i = 0; i < 3; i++) {
        detector.record("Read", { p: "a" });
        detector.record("Edit", { p: "b" });
        if (i < 2) detector.record("Bash", { cmd: "test" });
      }
      const result = detector.record("Bash", { cmd: "test" });

      expect(result.detected).toBe(true);
      expect(result.type).toBe("sequence");
    });
  });

  describe("reminder generation", () => {
    it("generates consecutive reminder", () => {
      const detector = new DoomLoopDetector(3);
      detector.record("Read", { path: "/foo" });
      detector.record("Read", { path: "/foo" });
      const result = detector.record("Read", { path: "/foo" });

      const reminder = detector.getReminder(result);
      expect(reminder).toContain("system_reminder");
      expect(reminder).toContain("Doom loop");
      expect(reminder).toContain("Read");
    });

    it("generates sequence reminder", () => {
      const detector = new DoomLoopDetector(3);
      for (let i = 0; i < 3; i++) {
        detector.record("A", { x: 1 });
        detector.record("B", { x: 2 });
      }
      const result = detector.record("A", { x: 1 });

      if (result.detected) {
        const reminder = detector.getReminder(result);
        expect(reminder).toContain("cycle");
      }
    });

    it("returns empty for non-detection", () => {
      const detector = new DoomLoopDetector(3);
      const result = detector.record("Read", { path: "/foo" });
      expect(detector.getReminder(result)).toBe("");
    });
  });

  describe("reset", () => {
    it("clears history", () => {
      const detector = new DoomLoopDetector(3);
      detector.record("A", {});
      detector.record("A", {});
      expect(detector.getHistoryLength()).toBe(2);

      detector.reset();
      expect(detector.getHistoryLength()).toBe(0);
    });
  });
});
