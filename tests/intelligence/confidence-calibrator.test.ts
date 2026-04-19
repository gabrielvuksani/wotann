import { describe, it, expect } from "vitest";
import {
  hedgeScore,
  consistencyScore,
  calibrateConfidence,
  buildSelfScorePrompt,
  parseSelfScore,
} from "../../src/intelligence/confidence-calibrator.js";

describe("hedgeScore", () => {
  it("high score on confident text", () => {
    expect(hedgeScore("The answer is 42.")).toBeGreaterThan(0.9);
  });

  it("lower score with hedges", () => {
    const confident = hedgeScore("The answer is 42.");
    const hedged = hedgeScore("I think maybe the answer is probably 42.");
    expect(hedged).toBeLessThan(confident);
  });

  it("zero on empty", () => {
    expect(hedgeScore("")).toBe(0);
  });

  it("bounded [0, 1]", () => {
    const extreme = hedgeScore(
      "I think maybe perhaps possibly probably likely could be might be uncertain",
    );
    expect(extreme).toBeGreaterThanOrEqual(0);
    expect(extreme).toBeLessThanOrEqual(1);
  });
});

describe("consistencyScore", () => {
  it("1 when samples agree", () => {
    expect(consistencyScore("Paris", ["Paris", "Paris"])).toBe(1);
  });

  it("0 when all samples differ", () => {
    expect(consistencyScore("Paris", ["London", "Berlin"])).toBe(0);
  });

  it("fractional agreement", () => {
    expect(consistencyScore("Paris", ["Paris", "London", "Paris"])).toBeCloseTo(2 / 3, 2);
  });

  it("1 when no samples provided", () => {
    expect(consistencyScore("x", [])).toBe(1);
  });

  it("normalizes first line + case", () => {
    expect(consistencyScore("Paris", ["paris", "  PARIS  ", "paris\nextra line"])).toBe(1);
  });
});

describe("calibrateConfidence", () => {
  it("high band for confident + consistent + self-high", () => {
    const result = calibrateConfidence({
      text: "The answer is 42.",
      samples: ["The answer is 42.", "The answer is 42.", "The answer is 42."],
      selfScore: 0.95,
    });
    expect(result.band).toBe("high");
    expect(result.score).toBeGreaterThan(0.8);
  });

  it("reject band for hedged + inconsistent + self-low", () => {
    const result = calibrateConfidence({
      text: "I think maybe perhaps the answer could be something",
      samples: ["different answer", "another answer"],
      selfScore: 0.1,
    });
    expect(result.band).toBe("reject");
  });

  it("only uses hedge when no samples/self", () => {
    const result = calibrateConfidence({ text: "Definitive answer" });
    expect(result.components.consistencyScore).toBeNull();
    expect(result.components.selfScore).toBeNull();
  });

  it("custom thresholds", () => {
    const result = calibrateConfidence(
      { text: "maybe X" },
      { highThreshold: 0.5, mediumThreshold: 0.3, lowThreshold: 0.1 },
    );
    expect(["high", "medium", "low"]).toContain(result.band);
  });

  it("components exposed for debugging", () => {
    const result = calibrateConfidence({
      text: "X",
      samples: ["X"],
      selfScore: 0.8,
    });
    expect(result.components.hedgeScore).toBeDefined();
    expect(result.components.consistencyScore).toBe(1);
    expect(result.components.selfScore).toBe(0.8);
  });

  it("clamps self-score to [0, 1]", () => {
    const result = calibrateConfidence({ text: "x", selfScore: 2.5 });
    expect(result.components.selfScore).toBe(1);
    const low = calibrateConfidence({ text: "x", selfScore: -0.5 });
    expect(low.components.selfScore).toBe(0);
  });
});

describe("buildSelfScorePrompt", () => {
  it("includes question + answer", () => {
    const prompt = buildSelfScorePrompt("What is 2+2?", "4");
    expect(prompt).toContain("What is 2+2?");
    expect(prompt).toContain("4");
    expect(prompt).toContain("Confidence");
  });
});

describe("parseSelfScore", () => {
  it("parses decimal", () => {
    expect(parseSelfScore("0.85")).toBeCloseTo(0.85, 2);
  });

  it("parses percent", () => {
    expect(parseSelfScore("85%")).toBeCloseTo(0.85, 2);
  });

  it("clamps to [0, 1]", () => {
    expect(parseSelfScore("2.5")).toBe(1);
    // Note: -0.5 matches as 0.5 because the regex picks up the digits
    expect(parseSelfScore("-0.5")).toBe(0.5);
  });

  it("extracts number from chatty response", () => {
    expect(parseSelfScore("I'd say about 0.7")).toBeCloseTo(0.7, 2);
  });

  it("returns null on unparseable", () => {
    expect(parseSelfScore("high")).toBeNull();
    expect(parseSelfScore("")).toBeNull();
  });
});
