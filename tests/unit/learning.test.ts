import { describe, it, expect } from "vitest";
import {
  shouldDream,
  classifyFeedback,
  decayInstinct,
  correctionToGotcha,
  type Instinct,
} from "../../src/learning/autodream.js";

describe("autoDream & Learning", () => {
  describe("shouldDream (three-gate trigger)", () => {
    it("triggers when all gates pass", () => {
      expect(shouldDream({
        idleMinutes: 60,
        newObservations: 10,
        lastDreamHoursAgo: 8,
      })).toBe(true);
    });

    // S2-8: idle threshold lowered 30min → 10min; use 5 min here so
    // blocking still applies.
    it("blocks when system not idle enough (<10 min)", () => {
      expect(shouldDream({
        idleMinutes: 5,
        newObservations: 10,
        lastDreamHoursAgo: 8,
      })).toBe(false);
    });

    it("blocks when not enough observations", () => {
      expect(shouldDream({
        idleMinutes: 60,
        newObservations: 2,
        lastDreamHoursAgo: 8,
      })).toBe(false);
    });

    it("blocks when dreamed too recently", () => {
      expect(shouldDream({
        idleMinutes: 60,
        newObservations: 10,
        lastDreamHoursAgo: 1,
      })).toBe(false);
    });
  });

  describe("classifyFeedback", () => {
    it("detects corrections", () => {
      expect(classifyFeedback("No, that's wrong").type).toBe("correction");
      expect(classifyFeedback("Stop doing that").type).toBe("correction");
      expect(classifyFeedback("Not what I asked for").type).toBe("correction");
    });

    it("detects confirmations", () => {
      expect(classifyFeedback("Yes, exactly!").type).toBe("confirmation");
      expect(classifyFeedback("Perfect, keep going").type).toBe("confirmation");
    });

    it("returns neutral for normal messages", () => {
      expect(classifyFeedback("Can you help me with this?").type).toBe("neutral");
    });
  });

  describe("decayInstinct", () => {
    it("reduces confidence over time", () => {
      const instinct: Instinct = {
        id: "i1",
        behavior: "Always verify after writes",
        confidence: 0.9,
        source: "correction",
        createdAt: new Date(),
        fireCount: 5,
        decayRate: 0.5,
      };

      const decayed = decayInstinct(instinct, 720); // 30 days
      expect(decayed.confidence).toBeLessThan(instinct.confidence);
    });

    it("has a minimum confidence floor", () => {
      const instinct: Instinct = {
        id: "i1",
        behavior: "Test",
        confidence: 0.2,
        source: "pattern",
        createdAt: new Date(),
        fireCount: 1,
        decayRate: 0.1,
      };

      const decayed = decayInstinct(instinct, 10000);
      expect(decayed.confidence).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe("correctionToGotcha", () => {
    it("formats as markdown gotcha entry", () => {
      const gotcha = correctionToGotcha(
        "Don't use any type assertions",
        "TypeScript strict mode project",
      );

      expect(gotcha).toContain("## Gotcha");
      expect(gotcha).toContain("Context");
      expect(gotcha).toContain("Correction");
      expect(gotcha).toContain("Active");
    });
  });
});
