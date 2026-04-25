/**
 * Ragas metrics — V9 Tier 12 T12.15.
 *
 * Implements 4 RAG metrics: faithfulness, answer_relevancy,
 * context_precision, context_recall. Pure adapter — caller injects
 * the LLM judge.
 *
 * Reference: "Ragas: Automated Evaluation of Retrieval Augmented
 * Generation", Es et al. 2023.
 */

import type {
  EvalLlm,
  RagasSample,
  RagasMetricName,
  RagasMetricResult,
  RagasReport,
} from "./types.js";
import { clampScore } from "./types.js";

interface MetricImpl {
  readonly name: RagasMetricName;
  readonly run: (sample: RagasSample, llm: EvalLlm) => Promise<RagasMetricResult>;
}

// ── Helpers ─────────────────────────────────────────

function abstain(metric: RagasMetricName, reason: string): RagasMetricResult {
  return {
    metric,
    score: Number.NaN,
    details: { reason },
    abstained: true,
  };
}

/**
 * Parse the trailing `SCORE: <float>` line. Returns NaN when absent
 * or out of [0,1].
 */
function parseScore(raw: string): number {
  const lines = raw.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (typeof line !== "string") continue;
    const m = line.match(/SCORE\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    }
  }
  return Number.NaN;
}

// ── Faithfulness ────────────────────────────────────
// Score = (claims in answer that are supported by the contexts) / (total claims).

const faithfulness: MetricImpl = {
  name: "faithfulness",
  run: async (sample, llm) => {
    if (!sample.contexts || sample.contexts.length === 0) {
      return abstain("faithfulness", "no contexts to ground against");
    }
    const prompt = [
      "Task: faithfulness — fraction of factual claims in ANSWER that are supported by CONTEXTS.",
      "",
      "QUESTION:",
      sample.question,
      "",
      "ANSWER:",
      sample.answer,
      "",
      "CONTEXTS:",
      ...sample.contexts.map((c, i) => `[${i + 1}] ${c}`),
      "",
      "Step 1: list every factual claim in the ANSWER (one per line, prefixed by `-`).",
      "Step 2: for each claim, mark SUPPORTED if at least one CONTEXTS entry entails it; UNSUPPORTED otherwise.",
      "Step 3: emit a final line `SCORE: <float in [0,1]>` = supported / total.",
    ].join("\n");
    try {
      const raw = await llm.query(prompt);
      const score = parseScore(raw);
      if (Number.isNaN(score)) return abstain("faithfulness", "judge omitted SCORE");
      return {
        metric: "faithfulness",
        score: clampScore(score, 0, 1),
        details: { rawTail: raw.slice(-200) },
        abstained: false,
      };
    } catch (err) {
      return abstain("faithfulness", err instanceof Error ? err.message : String(err));
    }
  },
};

// ── Answer relevancy ────────────────────────────────
// Score = how directly the answer addresses the question (0..1).

const answerRelevancy: MetricImpl = {
  name: "answer_relevancy",
  run: async (sample, llm) => {
    const prompt = [
      "Task: answer_relevancy — does the ANSWER directly address the QUESTION?",
      "",
      "QUESTION:",
      sample.question,
      "",
      "ANSWER:",
      sample.answer,
      "",
      "Score 0 if the answer is irrelevant or evasive.",
      "Score 1 if the answer fully addresses the question.",
      "Emit a single final line `SCORE: <float in [0,1]>`.",
    ].join("\n");
    try {
      const raw = await llm.query(prompt);
      const score = parseScore(raw);
      if (Number.isNaN(score)) return abstain("answer_relevancy", "judge omitted SCORE");
      return {
        metric: "answer_relevancy",
        score: clampScore(score, 0, 1),
        details: {},
        abstained: false,
      };
    } catch (err) {
      return abstain("answer_relevancy", err instanceof Error ? err.message : String(err));
    }
  },
};

// ── Context precision ──────────────────────────────
// Score = fraction of retrieved contexts that are relevant to answering.

const contextPrecision: MetricImpl = {
  name: "context_precision",
  run: async (sample, llm) => {
    if (!sample.contexts || sample.contexts.length === 0) {
      return abstain("context_precision", "no contexts");
    }
    const prompt = [
      "Task: context_precision — what FRACTION of retrieved CONTEXTS contain information relevant to answering the QUESTION?",
      "",
      "QUESTION:",
      sample.question,
      "",
      "CONTEXTS:",
      ...sample.contexts.map((c, i) => `[${i + 1}] ${c}`),
      "",
      "Mark each context RELEVANT or NOT_RELEVANT, then emit the final line `SCORE: <float in [0,1]>`.",
    ].join("\n");
    try {
      const raw = await llm.query(prompt);
      const score = parseScore(raw);
      if (Number.isNaN(score)) return abstain("context_precision", "judge omitted SCORE");
      return {
        metric: "context_precision",
        score: clampScore(score, 0, 1),
        details: { contextCount: sample.contexts.length },
        abstained: false,
      };
    } catch (err) {
      return abstain("context_precision", err instanceof Error ? err.message : String(err));
    }
  },
};

// ── Context recall ─────────────────────────────────
// Score = fraction of ground-truth claims supported by at least one context.

const contextRecall: MetricImpl = {
  name: "context_recall",
  run: async (sample, llm) => {
    if (!sample.groundTruth) {
      return abstain("context_recall", "no groundTruth (required for recall)");
    }
    if (!sample.contexts || sample.contexts.length === 0) {
      return abstain("context_recall", "no contexts");
    }
    const prompt = [
      "Task: context_recall — what FRACTION of factual claims in GROUND_TRUTH are covered by CONTEXTS?",
      "",
      "QUESTION:",
      sample.question,
      "",
      "GROUND_TRUTH:",
      sample.groundTruth,
      "",
      "CONTEXTS:",
      ...sample.contexts.map((c, i) => `[${i + 1}] ${c}`),
      "",
      "Step 1: list each claim from GROUND_TRUTH.",
      "Step 2: mark each COVERED if any context supports it.",
      "Step 3: emit `SCORE: <float in [0,1]>` = covered / total.",
    ].join("\n");
    try {
      const raw = await llm.query(prompt);
      const score = parseScore(raw);
      if (Number.isNaN(score)) return abstain("context_recall", "judge omitted SCORE");
      return {
        metric: "context_recall",
        score: clampScore(score, 0, 1),
        details: {},
        abstained: false,
      };
    } catch (err) {
      return abstain("context_recall", err instanceof Error ? err.message : String(err));
    }
  },
};

const ALL_METRICS: readonly MetricImpl[] = [
  faithfulness,
  answerRelevancy,
  contextPrecision,
  contextRecall,
];

// ── Public API ─────────────────────────────────────

/**
 * Run a single Ragas metric. Returns a RagasMetricResult with the
 * score in [0,1] (or NaN + abstained=true on failure).
 */
export async function runRagasMetric(
  metric: RagasMetricName,
  sample: RagasSample,
  llm: EvalLlm,
): Promise<RagasMetricResult> {
  const impl = ALL_METRICS.find((m) => m.name === metric);
  if (!impl) {
    return abstain(metric, `unknown metric: ${metric}`);
  }
  return impl.run(sample, llm);
}

/**
 * Run all 4 metrics on a sample. Returns a full report including
 * the per-metric breakdown and an aggregate score (mean of
 * non-abstained metrics).
 */
export async function runRagasReport(
  sample: RagasSample,
  llm: EvalLlm,
  metrics?: readonly RagasMetricName[],
): Promise<RagasReport> {
  const want = metrics ?? ALL_METRICS.map((m) => m.name);
  const results: RagasMetricResult[] = [];
  for (const m of want) {
    results.push(await runRagasMetric(m, sample, llm));
  }
  const valid = results.filter((r) => !r.abstained && Number.isFinite(r.score));
  const aggregate =
    valid.length === 0 ? Number.NaN : valid.reduce((a, r) => a + r.score, 0) / valid.length;
  return {
    metrics: results,
    aggregate,
    callsMade: results.filter((r) => !r.abstained).length,
  };
}
