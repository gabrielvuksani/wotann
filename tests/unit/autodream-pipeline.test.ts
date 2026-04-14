import { describe, it, expect } from "vitest";
import {
  shouldDream,
  classifyFeedback,
  decayInstinct,
  phaseRecall,
  phaseAnalyze,
  phaseConsolidate,
  phasePrune,
  runDreamPipeline,
  type Instinct,
} from "../../src/learning/autodream.js";

describe("autoDream Learning Pipeline", () => {
  describe("Three-Gate Trigger", () => {
    it("triggers when all gates pass", () => {
      expect(shouldDream({ idleMinutes: 45, newObservations: 10, lastDreamHoursAgo: 6 })).toBe(true);
    });

    it("blocks when not idle enough", () => {
      expect(shouldDream({ idleMinutes: 10, newObservations: 10, lastDreamHoursAgo: 6 })).toBe(false);
    });

    it("blocks when not enough observations", () => {
      expect(shouldDream({ idleMinutes: 45, newObservations: 2, lastDreamHoursAgo: 6 })).toBe(false);
    });

    it("blocks when dreamed too recently", () => {
      expect(shouldDream({ idleMinutes: 45, newObservations: 10, lastDreamHoursAgo: 2 })).toBe(false);
    });
  });

  describe("Feedback Classification", () => {
    it("detects corrections", () => {
      expect(classifyFeedback("No, that's wrong").type).toBe("correction");
      expect(classifyFeedback("Stop doing that").type).toBe("correction");
    });

    it("detects confirmations", () => {
      expect(classifyFeedback("Yes, exactly!").type).toBe("confirmation");
      expect(classifyFeedback("Perfect, keep going").type).toBe("confirmation");
    });

    it("detects neutral messages", () => {
      expect(classifyFeedback("What time is it?").type).toBe("neutral");
    });
  });

  describe("Instinct Decay", () => {
    it("reduces confidence over time", () => {
      const instinct: Instinct = {
        id: "test", behavior: "use immutable patterns", confidence: 1.0,
        source: "correction", createdAt: new Date(), fireCount: 0, decayRate: 0.99,
      };

      const decayed = decayInstinct(instinct, 720); // 30 days
      expect(decayed.confidence).toBeLessThan(1.0);
      expect(decayed.confidence).toBeGreaterThan(0.1);
    });

    it("never drops below 0.1", () => {
      const instinct: Instinct = {
        id: "test", behavior: "test", confidence: 0.5,
        source: "pattern", createdAt: new Date(), fireCount: 0, decayRate: 0.5,
      };

      const decayed = decayInstinct(instinct, 10000);
      expect(decayed.confidence).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe("Four-Phase Pipeline", () => {
    it("Phase 1 (Recall): extracts patterns from observations", () => {
      const obs = [
        "Fixed TypeScript error in provider",
        "TypeScript compilation passed",
        "Fixed TypeScript type mismatch",
      ];

      const recalled = phaseRecall(obs, [], []);
      expect(recalled.patterns.length).toBeGreaterThan(0);
    });

    it("Phase 2 (Analyze): groups items by theme", () => {
      const recalled = phaseRecall(
        ["test observation"],
        [{ message: "Don't use any types", context: "code review" }],
        [{ message: "Perfect, keep doing that", context: "approach" }],
      );

      const themes = phaseAnalyze(recalled);
      expect(themes.some((t) => t.theme === "user-corrections")).toBe(true);
      expect(themes.some((t) => t.theme === "user-confirmations")).toBe(true);
    });

    it("Phase 3 (Consolidate): creates gotchas and instincts", () => {
      const themes = [
        { theme: "user-corrections", items: ["Don't use any types"], impact: 0.9 },
        { theme: "user-confirmations", items: ["Good approach"], impact: 0.7 },
      ];

      const consolidated = phaseConsolidate(themes);
      expect(consolidated.gotchas.length).toBe(1);
      expect(consolidated.instincts.length).toBe(1);
      expect(consolidated.instincts[0]?.source).toBe("confirmation");
    });

    it("Phase 4 (Prune): removes low-confidence instincts", () => {
      const instincts: Instinct[] = [
        { id: "1", behavior: "good", confidence: 0.8, source: "confirmation", createdAt: new Date(), fireCount: 5, decayRate: 0.99 },
        { id: "2", behavior: "weak", confidence: 0.05, source: "pattern", createdAt: new Date(), fireCount: 0, decayRate: 0.5 },
      ];

      const pruned = phasePrune(instincts);
      expect(pruned.length).toBe(1);
      expect(pruned[0]?.id).toBe("1");
    });

    it("Full pipeline: runDreamPipeline", () => {
      const result = runDreamPipeline(
        ["observation 1", "observation 2", "observation 3"],
        [{ message: "Don't do that", context: "review" }],
        [{ message: "Great work", context: "feedback" }],
        [],
      );

      expect(result.gotchasAdded).toBeGreaterThanOrEqual(1);
      expect(result.instinctsUpdated).toBeGreaterThanOrEqual(1);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
