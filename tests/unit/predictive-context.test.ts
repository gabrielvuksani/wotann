import { describe, it, expect } from "vitest";
import { PredictiveContextLoader } from "../../src/intelligence/predictive-context.js";

describe("PredictiveContextLoader", () => {
  describe("predictNextFiles", () => {
    it("returns empty predictions with no history", () => {
      const loader = new PredictiveContextLoader();
      const predictions = loader.predictNextFiles(
        ["src/index.ts"],
        ["search for auth"],
      );
      expect(predictions.length).toBe(0);
    });

    it("predicts co-accessed files", () => {
      const loader = new PredictiveContextLoader();
      const now = Date.now();

      // Simulate accessing files together multiple times
      loader.recordActual(["src/auth.ts", "src/session.ts"], "auth work");
      loader.recordActual(["src/auth.ts", "src/session.ts"], "auth work");
      loader.recordActual(["src/auth.ts", "src/session.ts"], "auth work");

      const predictions = loader.predictNextFiles(["src/auth.ts"], []);
      const sessionPrediction = predictions.find(
        (p) => p.path === "src/session.ts",
      );
      expect(sessionPrediction).toBeDefined();
      expect(sessionPrediction?.confidence).toBeGreaterThan(0);
    });

    it("predicts directory siblings", () => {
      const loader = new PredictiveContextLoader();

      // Record accessing files in the same directory
      loader.recordActual(["src/core/types.ts"], "types");
      loader.recordActual(["src/core/config.ts"], "config");
      loader.recordActual(["src/core/session.ts"], "session");

      const predictions = loader.predictNextFiles(["src/core/types.ts"], []);
      // Should predict other files from src/core/
      const corePredictions = predictions.filter((p) =>
        p.path.startsWith("src/core/"),
      );
      expect(corePredictions.length).toBeGreaterThan(0);
    });

    it("sorts predictions by confidence descending", () => {
      const loader = new PredictiveContextLoader();

      loader.recordActual(["src/a.ts", "src/b.ts"], "work");
      loader.recordActual(["src/a.ts", "src/b.ts"], "work");
      loader.recordActual(["src/a.ts", "src/c.ts"], "work");

      const predictions = loader.predictNextFiles(["src/a.ts"], []);
      for (let i = 1; i < predictions.length; i++) {
        const prev = predictions[i - 1];
        const curr = predictions[i];
        if (prev && curr) {
          expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
        }
      }
    });
  });

  describe("preloadContext", () => {
    it("preloads files within budget", () => {
      const loader = new PredictiveContextLoader();
      const predictions = [
        { path: "a.ts", confidence: 0.9, reason: "test", estimatedTokens: 500 },
        { path: "b.ts", confidence: 0.8, reason: "test", estimatedTokens: 500 },
        { path: "c.ts", confidence: 0.7, reason: "test", estimatedTokens: 500 },
      ];

      const result = loader.preloadContext(predictions, 1200);
      expect(result.preloaded.length).toBe(2);
      expect(result.skipped.length).toBe(1);
      expect(result.totalTokensUsed).toBe(1000);
      expect(result.budgetRemaining).toBe(200);
    });

    it("preloads nothing when budget is 0", () => {
      const loader = new PredictiveContextLoader();
      const predictions = [
        { path: "a.ts", confidence: 0.9, reason: "test", estimatedTokens: 500 },
      ];

      const result = loader.preloadContext(predictions, 0);
      expect(result.preloaded.length).toBe(0);
      expect(result.skipped.length).toBe(1);
    });

    it("preloads all when budget is sufficient", () => {
      const loader = new PredictiveContextLoader();
      const predictions = [
        { path: "a.ts", confidence: 0.9, reason: "test", estimatedTokens: 100 },
        { path: "b.ts", confidence: 0.8, reason: "test", estimatedTokens: 100 },
      ];

      const result = loader.preloadContext(predictions, 10000);
      expect(result.preloaded.length).toBe(2);
      expect(result.skipped.length).toBe(0);
    });
  });

  describe("recordActual", () => {
    it("grows access history", () => {
      const loader = new PredictiveContextLoader();
      expect(loader.getHistoryLength()).toBe(0);

      loader.recordActual(["src/a.ts", "src/b.ts"]);
      expect(loader.getHistoryLength()).toBe(2);
    });

    it("trims history at maxHistory", () => {
      const loader = new PredictiveContextLoader(5);

      for (let i = 0; i < 10; i++) {
        loader.recordActual([`file-${i}.ts`]);
      }

      expect(loader.getHistoryLength()).toBe(5);
    });
  });

  describe("getAccuracy", () => {
    it("returns zero accuracy with no predictions", () => {
      const loader = new PredictiveContextLoader();
      const accuracy = loader.getAccuracy();
      expect(accuracy.totalPredictions).toBe(0);
      expect(accuracy.accuracyPercent).toBe(0);
    });

    it("tracks prediction accuracy", () => {
      const loader = new PredictiveContextLoader();

      // Log predictions then record actuals
      loader.logPredictions(["src/a.ts", "src/b.ts"]);
      loader.recordActual(["src/a.ts", "src/c.ts"]);

      const accuracy = loader.getAccuracy();
      expect(accuracy.totalPredictions).toBe(1);
      expect(accuracy.correctPredictions).toBe(1);
      expect(accuracy.accuracyPercent).toBe(100);
    });
  });
});
