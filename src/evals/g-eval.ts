/**
 * G-Eval implementation — V9 Tier 12 T12.15.
 *
 * Implements the G-Eval framework (Liu et al. 2023): judge prompt +
 * chain-of-thought + integer score on a configured scale (1..N).
 *
 * Pure adapter: callers inject the LLM via `EvalLlm`. No process.env
 * reads. Per-call closures (no module-level cache).
 */

import type {
  EvalLlm,
  GEvalRubric,
  GEvalCriterion,
  GEvalCriterionScore,
  GEvalResult,
} from "./types.js";
import { clampScore, normalizeOnScale } from "./types.js";

export interface GEvalRequest {
  readonly rubric: GEvalRubric;
  readonly candidate: string;
  readonly reference?: string;
  readonly source?: string;
}

/**
 * Build the judge prompt for a single criterion. Public so callers
 * can inspect or mock it. The judge MUST emit a final-line
 * `SCORE: <integer>` per the G-Eval contract.
 */
export function buildGEvalPrompt(criterion: GEvalCriterion, req: GEvalRequest): string {
  const lines: string[] = [];
  lines.push(`Task: evaluate the candidate text on the criterion "${criterion.name}".`);
  lines.push("");
  lines.push(`Criterion description: ${criterion.description}`);
  lines.push("");
  if (criterion.rubric && criterion.rubric.length > 0) {
    lines.push("Score-scale rubric (use this to calibrate):");
    criterion.rubric.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${step}`);
    });
    lines.push("");
  }
  if (req.source !== undefined) {
    lines.push("SOURCE (the original article / conversation):");
    lines.push(req.source);
    lines.push("");
  }
  if (req.reference !== undefined) {
    lines.push("REFERENCE (the gold answer):");
    lines.push(req.reference);
    lines.push("");
  }
  lines.push("CANDIDATE (the text under evaluation):");
  lines.push(req.candidate);
  lines.push("");
  lines.push(
    `Output your reasoning step-by-step, then on the FINAL line emit "SCORE: <integer 1..${criterion.scoreScale}>".`,
  );
  return lines.join("\n");
}

/**
 * Parse a judge response. Returns NaN when the SCORE line is absent
 * or the integer falls outside the criterion scale.
 */
export function parseGEvalResponse(
  raw: string,
  scoreScale: number,
): { score: number; reasoning: string } {
  const lines = raw.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (typeof line !== "string") continue;
    const m = line.match(/SCORE\s*:\s*(\d+)/i);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= scoreScale) {
        return {
          score: n,
          reasoning: lines.slice(0, i).join("\n").trim(),
        };
      }
    }
  }
  return { score: Number.NaN, reasoning: raw.slice(0, 500) };
}

function aggregate(scores: readonly GEvalCriterionScore[], rubric: GEvalRubric): number {
  const valid = scores.filter((s) => !s.abstained && Number.isFinite(s.normalized));
  if (valid.length === 0) return Number.NaN;
  switch (rubric.aggregator) {
    case "min":
      return Math.min(...valid.map((s) => s.normalized));
    case "max":
      return Math.max(...valid.map((s) => s.normalized));
    case "weighted": {
      const totalWeight = rubric.criteria.reduce((a, c) => a + (c.weight ?? 1), 0);
      let sum = 0;
      for (const s of valid) {
        const c = rubric.criteria.find((x) => x.name === s.criterion);
        const w = c?.weight ?? 1;
        sum += s.normalized * w;
      }
      return totalWeight === 0 ? Number.NaN : sum / totalWeight;
    }
    case "mean":
    default:
      return valid.reduce((a, s) => a + s.normalized, 0) / valid.length;
  }
}

/**
 * Run a full G-Eval rubric — one LLM call per criterion. Returns a
 * report with per-criterion scores + the aggregate.
 */
export async function runGEval(req: GEvalRequest, llm: EvalLlm): Promise<GEvalResult> {
  const scores: GEvalCriterionScore[] = [];
  let callsMade = 0;
  let abstentions = 0;

  for (const criterion of req.rubric.criteria) {
    const prompt = buildGEvalPrompt(criterion, req);
    let raw: string;
    try {
      raw = await llm.query(prompt);
      callsMade += 1;
    } catch (err) {
      abstentions += 1;
      scores.push({
        criterion: criterion.name,
        score: Number.NaN,
        normalized: Number.NaN,
        reasoning: `judge-error: ${err instanceof Error ? err.message : String(err)}`,
        abstained: true,
      });
      continue;
    }

    const parsed = parseGEvalResponse(raw, criterion.scoreScale);
    if (Number.isNaN(parsed.score)) {
      abstentions += 1;
      scores.push({
        criterion: criterion.name,
        score: Number.NaN,
        normalized: Number.NaN,
        reasoning: `parse-failed: ${parsed.reasoning.slice(0, 200)}`,
        abstained: true,
      });
      continue;
    }

    const clamped = clampScore(parsed.score, 1, criterion.scoreScale);
    scores.push({
      criterion: criterion.name,
      score: clamped,
      normalized: normalizeOnScale(clamped, criterion.scoreScale),
      reasoning: parsed.reasoning.slice(0, 4000),
      abstained: false,
    });
  }

  const aggregateScore = aggregate(scores, req.rubric);
  return {
    scores,
    aggregate: aggregateScore,
    abstentions,
    callsMade,
  };
}
