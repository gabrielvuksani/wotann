import { describe, it, expect } from "vitest";
import {
  bootstrapFewShot,
  selectBestDemos,
  formatFewShotPrompt,
  exactMatchScore,
  type SuccessfulDemo,
  type TrainingExample,
} from "../../src/learning/miprov2-optimizer.js";

describe("exactMatchScore", () => {
  it("returns 1 on match", () => {
    expect(exactMatchScore("hello", "hello")).toBe(1);
  });

  it("returns 1 after trim+lowercase", () => {
    expect(exactMatchScore("  HELLO  ", "hello")).toBe(1);
  });

  it("returns 0 on mismatch", () => {
    expect(exactMatchScore("hi", "hello")).toBe(0);
  });
});

describe("formatFewShotPrompt", () => {
  it("returns instruction as-is when no demos", () => {
    expect(formatFewShotPrompt("instr", [])).toBe("instr");
  });

  it("appends Example N blocks", () => {
    const demos: SuccessfulDemo[] = [
      { input: "Q1", output: "A1", score: 1 },
      { input: "Q2", output: "A2", score: 1 },
    ];
    const prompt = formatFewShotPrompt("instruction", demos);
    expect(prompt).toContain("instruction");
    expect(prompt).toContain("Example 1:");
    expect(prompt).toContain("Input: Q1");
    expect(prompt).toContain("Output: A1");
    expect(prompt).toContain("Example 2:");
  });
});

describe("selectBestDemos", () => {
  const demos: SuccessfulDemo[] = [
    { input: "a", output: "a", score: 1 },
    { input: "b", output: "b", score: 0.8 },
    { input: "c", output: "c", score: 0.5 },
    { input: "d", output: "d", score: 1 },
  ];

  it("returns all when count >= length", () => {
    expect(selectBestDemos(demos, 10)).toHaveLength(4);
  });

  it("picks top-N by score", () => {
    const picked = selectBestDemos(demos, 2);
    expect(picked).toHaveLength(2);
    // Both highest-scored demos (both 1.0) selected
    expect(picked.every((d) => d.score === 1)).toBe(true);
  });

  it("deterministic for given seed", () => {
    const a = selectBestDemos(demos, 2, 42);
    const b = selectBestDemos(demos, 2, 42);
    expect(a.map((d) => d.input)).toEqual(b.map((d) => d.input));
  });

  it("different seed may produce different order on ties", () => {
    const a = selectBestDemos(demos, 2, 1);
    const b = selectBestDemos(demos, 2, 999);
    // At minimum both should be score=1
    expect(a.every((d) => d.score === 1)).toBe(true);
    expect(b.every((d) => d.score === 1)).toBe(true);
  });
});

describe("bootstrapFewShot", () => {
  const trainingSet: TrainingExample[] = [
    { input: "2+2", expectedOutput: "4" },
    { input: "3+3", expectedOutput: "6" },
    { input: "5+5", expectedOutput: "10" },
  ];

  it("returns the instruction when baseline already gets all right", async () => {
    const runAgent = async (_prompt: string, input: string) => {
      if (input === "2+2") return "4";
      if (input === "3+3") return "6";
      if (input === "5+5") return "10";
      return "?";
    };
    const result = await bootstrapFewShot({
      instruction: "Add the two numbers.",
      trainingSet,
      runAgent,
      maxDemos: 3,
    });
    expect(result.baselineScore).toBe(1);
    expect(result.optimizedScore).toBe(1);
    expect(result.demosCollected).toBe(3);
  });

  it("demos are attached even when baseline is perfect", async () => {
    const runAgent = async () => "4"; // always right
    const result = await bootstrapFewShot({
      instruction: "Add.",
      trainingSet: [{ input: "2+2", expectedOutput: "4" }],
      runAgent,
      maxDemos: 2,
    });
    expect(result.demos).toHaveLength(1);
    expect(result.prompt).toContain("Example 1");
  });

  it("reports callsMade = 2 * trainingSet size (baseline + eval)", async () => {
    const runAgent = async () => "4";
    const result = await bootstrapFewShot({
      instruction: "Add.",
      trainingSet: [
        { input: "2+2", expectedOutput: "4" },
        { input: "3+3", expectedOutput: "6" }, // will fail, counted
      ],
      runAgent,
      maxDemos: 1,
    });
    expect(result.callsMade).toBe(4);
  });

  it("handles empty training set", async () => {
    const result = await bootstrapFewShot({
      instruction: "x",
      trainingSet: [],
      runAgent: async () => "",
    });
    expect(result.baselineScore).toBe(0);
    expect(result.optimizedScore).toBe(0);
  });

  it("respects custom score function", async () => {
    const runAgent = async (_p: string, input: string) =>
      input === "2+2" ? "approximately 4" : "wrong";
    // Permissive score: pass if output contains the expected
    const lenientScore = (actual: string, expected: string) =>
      actual.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
    const result = await bootstrapFewShot({
      instruction: "Add.",
      trainingSet: [{ input: "2+2", expectedOutput: "4" }],
      runAgent,
      score: lenientScore,
    });
    expect(result.baselineScore).toBe(1);
    expect(result.demosCollected).toBe(1);
  });

  it("limits demos to maxDemos", async () => {
    const trainingSetLarge: TrainingExample[] = Array.from({ length: 10 }, (_, i) => ({
      input: String(i),
      expectedOutput: String(i),
    }));
    const runAgent = async (_p: string, input: string) => input; // all succeed
    const result = await bootstrapFewShot({
      instruction: "Echo.",
      trainingSet: trainingSetLarge,
      runAgent,
      maxDemos: 3,
    });
    expect(result.demos).toHaveLength(3);
  });
});
