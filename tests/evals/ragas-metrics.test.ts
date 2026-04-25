import { describe, it, expect, vi } from "vitest";
import { runRagasMetric, runRagasReport } from "../../src/evals/ragas-metrics.js";
import type { EvalLlm, RagasSample } from "../../src/evals/types.js";

const SAMPLE: RagasSample = {
  question: "When did Python 3.0 release?",
  contexts: ["Python 3.0 was released on December 3, 2008."],
  answer: "Python 3.0 was released in December 2008.",
  groundTruth: "December 3, 2008",
};

function llmReturning(reply: string): EvalLlm {
  return { query: vi.fn(async () => reply) };
}

describe("runRagasMetric", () => {
  it("faithfulness scores on judge response", async () => {
    const r = await runRagasMetric(
      "faithfulness",
      SAMPLE,
      llmReturning("- Python 3.0 was released in December 2008. SUPPORTED\nSCORE: 1.0"),
    );
    expect(r.metric).toBe("faithfulness");
    expect(r.score).toBe(1);
    expect(r.abstained).toBe(false);
  });

  it("answer_relevancy abstains on missing SCORE", async () => {
    const r = await runRagasMetric("answer_relevancy", SAMPLE, llmReturning("just words"));
    expect(r.abstained).toBe(true);
  });

  it("context_precision needs contexts", async () => {
    const r = await runRagasMetric(
      "context_precision",
      { ...SAMPLE, contexts: [] },
      llmReturning(""),
    );
    expect(r.abstained).toBe(true);
  });

  it("context_recall needs groundTruth", async () => {
    const sampleNoGT: RagasSample = {
      question: "x",
      contexts: ["a"],
      answer: "y",
    };
    const r = await runRagasMetric("context_recall", sampleNoGT, llmReturning(""));
    expect(r.abstained).toBe(true);
  });

  it("clamps out-of-range scores", async () => {
    const r = await runRagasMetric(
      "answer_relevancy",
      SAMPLE,
      llmReturning("good\nSCORE: 0.85"),
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("propagates judge throw as abstention", async () => {
    const llm: EvalLlm = {
      query: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const r = await runRagasMetric("faithfulness", SAMPLE, llm);
    expect(r.abstained).toBe(true);
    expect(JSON.stringify(r.details)).toContain("network down");
  });

  it("rejects unknown metric name", async () => {
    // @ts-expect-error — invalid metric
    const r = await runRagasMetric("not_a_metric", SAMPLE, llmReturning(""));
    expect(r.abstained).toBe(true);
  });
});

describe("runRagasReport", () => {
  it("aggregates across all 4 metrics by default", async () => {
    let i = 0;
    const replies = [
      "...\nSCORE: 0.9", // faithfulness
      "...\nSCORE: 0.8", // answer_relevancy
      "...\nSCORE: 0.7", // context_precision
      "...\nSCORE: 1.0", // context_recall
    ];
    const llm: EvalLlm = { query: vi.fn(async () => replies[i++]!) };
    const report = await runRagasReport(SAMPLE, llm);
    expect(report.metrics.length).toBe(4);
    expect(report.aggregate).toBeCloseTo(0.85, 2);
    expect(report.callsMade).toBe(4);
  });

  it("computes aggregate ignoring abstentions", async () => {
    let i = 0;
    const replies = ["...\nSCORE: 1.0", "no score line", "...\nSCORE: 0.5", "...\nSCORE: 0.5"];
    const llm: EvalLlm = { query: vi.fn(async () => replies[i++]!) };
    const report = await runRagasReport(SAMPLE, llm);
    // Three valid scores: 1.0, 0.5, 0.5 → mean ≈ 0.667
    expect(report.aggregate).toBeCloseTo((1.0 + 0.5 + 0.5) / 3, 2);
    expect(report.callsMade).toBe(3);
  });

  it("supports a metric subset", async () => {
    const llm: EvalLlm = { query: vi.fn(async () => "...\nSCORE: 0.9") };
    const report = await runRagasReport(SAMPLE, llm, ["faithfulness", "answer_relevancy"]);
    expect(report.metrics.length).toBe(2);
  });
});
