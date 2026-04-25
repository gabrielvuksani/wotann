import { describe, it, expect, vi } from "vitest";
import { runGEval, parseGEvalResponse, buildGEvalPrompt } from "../../src/evals/g-eval.js";
import type { EvalLlm, GEvalRubric } from "../../src/evals/types.js";

const COHERENCE_RUBRIC: GEvalRubric = {
  criteria: [
    {
      name: "coherence",
      description: "How well the candidate flows as a unified piece of writing.",
      scoreScale: 5,
      rubric: ["Score 1: incoherent", "Score 5: perfectly coherent"],
    },
  ],
  aggregator: "mean",
};

function llmReturning(reply: string): EvalLlm {
  return { query: vi.fn(async () => reply) };
}

describe("buildGEvalPrompt", () => {
  it("includes criterion + candidate text", () => {
    const prompt = buildGEvalPrompt(COHERENCE_RUBRIC.criteria[0]!, {
      rubric: COHERENCE_RUBRIC,
      candidate: "Hello world.",
    });
    expect(prompt).toContain("coherence");
    expect(prompt).toContain("Hello world.");
    expect(prompt).toContain("SCORE:");
  });
});

describe("parseGEvalResponse", () => {
  it("parses a SCORE line at the end", () => {
    const r = parseGEvalResponse("Reasoning here.\nSCORE: 4", 5);
    expect(r.score).toBe(4);
    expect(r.reasoning).toBe("Reasoning here.");
  });

  it("returns NaN when no SCORE line", () => {
    const r = parseGEvalResponse("just text", 5);
    expect(Number.isNaN(r.score)).toBe(true);
  });

  it("returns NaN when score is out of range", () => {
    const r = parseGEvalResponse("ok\nSCORE: 99", 5);
    expect(Number.isNaN(r.score)).toBe(true);
  });
});

describe("runGEval", () => {
  it("returns a parsed score on a clean judge response", async () => {
    const result = await runGEval(
      { rubric: COHERENCE_RUBRIC, candidate: "x" },
      llmReturning("Looks coherent.\nSCORE: 5"),
    );
    expect(result.scores.length).toBe(1);
    expect(result.scores[0]!.score).toBe(5);
    expect(result.scores[0]!.normalized).toBe(1);
    expect(result.aggregate).toBe(1);
    expect(result.abstentions).toBe(0);
    expect(result.callsMade).toBe(1);
  });

  it("counts abstention on parse failure", async () => {
    const result = await runGEval(
      { rubric: COHERENCE_RUBRIC, candidate: "x" },
      llmReturning("just words, no SCORE"),
    );
    expect(result.abstentions).toBe(1);
    expect(result.scores[0]!.abstained).toBe(true);
    expect(Number.isNaN(result.aggregate)).toBe(true);
  });

  it("counts abstention on judge throw", async () => {
    const llm: EvalLlm = {
      query: vi.fn(async () => {
        throw new Error("judge down");
      }),
    };
    const result = await runGEval({ rubric: COHERENCE_RUBRIC, candidate: "x" }, llm);
    expect(result.abstentions).toBe(1);
    expect(result.scores[0]!.reasoning).toContain("judge down");
  });

  it("aggregates two criteria with mean", async () => {
    const rubric: GEvalRubric = {
      criteria: [
        { name: "a", description: "...", scoreScale: 5 },
        { name: "b", description: "...", scoreScale: 5 },
      ],
      aggregator: "mean",
    };
    let i = 0;
    const replies = ["...\nSCORE: 5", "...\nSCORE: 1"];
    const llm: EvalLlm = { query: vi.fn(async () => replies[i++]!) };
    const result = await runGEval({ rubric, candidate: "x" }, llm);
    expect(result.aggregate).toBeCloseTo(0.5, 5);
  });

  it("supports min aggregator", async () => {
    const rubric: GEvalRubric = {
      criteria: [
        { name: "a", description: "...", scoreScale: 5 },
        { name: "b", description: "...", scoreScale: 5 },
      ],
      aggregator: "min",
    };
    let i = 0;
    const replies = ["...\nSCORE: 5", "...\nSCORE: 2"];
    const llm: EvalLlm = { query: vi.fn(async () => replies[i++]!) };
    const result = await runGEval({ rubric, candidate: "x" }, llm);
    expect(result.aggregate).toBeCloseTo(0.25, 2);
  });
});
