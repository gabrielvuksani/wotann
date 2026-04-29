/**
 * Evaluator — scores a variant against a small dataset.
 *
 * Scoring strategy:
 *   - For each example, send the variant + input to the configured
 *     provider and capture the response.
 *   - Compute a similarity score against the expected outcome using
 *     a simple token-overlap heuristic (Jaccard on sentence-cased
 *     tokens). The heuristic intentionally does NOT call back into the
 *     LLM as a judge — that would inflate cost and create circular
 *     evaluation. For higher-fidelity eval, the user can swap in a
 *     custom scorer at the CLI level.
 *   - Aggregate scores across examples; weight by example priority
 *     (defaults to 1.0).
 *
 * Cost & latency are tracked per-example so the optimizer can pick a
 * variant that's better but not pareto-dominated by speed/cost.
 */

import { EvalResult, EvolveExample, Variant } from "./types.js";

export interface ProviderInvocation {
  readonly variantContent: string;
  readonly input: string;
}

export interface ProviderResponse {
  readonly text: string;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export type EvaluationCaller = (inv: ProviderInvocation) => Promise<ProviderResponse>;

export interface EvaluatorOptions {
  readonly caller: EvaluationCaller;
  readonly examples: ReadonlyArray<EvolveExample>;
  readonly variant: Variant;
  readonly weight?: (exampleId: string) => number;
}

export async function evaluateVariant(opts: EvaluatorOptions): Promise<{
  readonly results: ReadonlyArray<EvalResult>;
  readonly aggregate: { readonly score: number; readonly cost: number };
}> {
  const results: EvalResult[] = [];
  let totalCost = 0;
  let weightedScore = 0;
  let totalWeight = 0;

  for (const example of opts.examples) {
    const w = opts.weight ? opts.weight(example.id) : 1;
    const t0 = Date.now();
    let response: ProviderResponse;
    try {
      response = await opts.caller({
        variantContent: opts.variant.content,
        input: example.input,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        exampleId: example.id,
        variantId: opts.variant.id,
        score: 0,
        cost: 0,
        latencyMs: Date.now() - t0,
        notes: `caller threw: ${message}`,
      });
      totalWeight += w;
      continue;
    }
    const score = jaccardScore(response.text, example.expectedOutcome);
    results.push({
      exampleId: example.id,
      variantId: opts.variant.id,
      score,
      cost: response.costUsd,
      latencyMs: response.latencyMs,
      notes: "",
    });
    totalCost += response.costUsd;
    weightedScore += score * w;
    totalWeight += w;
  }

  const aggregate = {
    score: totalWeight > 0 ? weightedScore / totalWeight : 0,
    cost: totalCost,
  };
  return { results, aggregate };
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "this",
  "that",
  "be",
  "by",
  "as",
  "at",
  "it",
]);

export function tokenize(s: string): ReadonlyArray<string> {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function jaccardScore(predicted: string, expected: string): number {
  const a = new Set(tokenize(predicted));
  const b = new Set(tokenize(expected));
  if (a.size === 0 && b.size === 0) return 1;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}
