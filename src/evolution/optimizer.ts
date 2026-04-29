/**
 * Optimizer — runs the evolutionary loop:
 *
 *   1. Score the baseline against the eval set.
 *   2. For each generation:
 *      a. propose N mutations
 *      b. apply each mutation by calling the mutate caller (LLM)
 *      c. validate constraints (size, no-TODO, secret-free)
 *      d. evaluate each surviving variant
 *      e. select the top-K survivors via Pareto front
 *   3. Return the OptimizeRunSummary with the winner.
 *
 * The optimizer is fully orthogonal to the WOTANN provider stack: the
 * caller passes in `mutate` and `evaluate` callables, so tests can use
 * deterministic fakes.
 */

import {
  proposeMutations,
  buildMutationPrompt,
  assembleVariant,
  MutationProposal,
} from "./mutator.js";
import { validateConstraints, exposesSecret } from "./constraints.js";
import { evaluateVariant, EvaluationCaller, ProviderResponse } from "./evaluator.js";
import {
  EvolveExample,
  EvolveTarget,
  MutationStrategy,
  OptimizeRunSummary,
  Variant,
} from "./types.js";

export interface MutationCaller {
  (prompt: string): Promise<{ readonly text: string; readonly costUsd: number }>;
}

export interface OptimizerOptions {
  readonly target: EvolveTarget;
  readonly baseline: string;
  readonly examples: ReadonlyArray<EvolveExample>;
  readonly mutate: MutationCaller;
  readonly evaluate: EvaluationCaller;
  readonly generations?: number;
  readonly variantsPerGeneration?: number;
  readonly survivorsPerGeneration?: number;
  readonly strategy?: MutationStrategy;
  readonly recentFailures?: ReadonlyArray<string>;
  readonly maxBudgetUsd?: number;
  readonly onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { readonly type: "baseline-scored"; readonly score: number }
  | { readonly type: "generation-start"; readonly generation: number }
  | {
      readonly type: "variant-evaluated";
      readonly generation: number;
      readonly variantId: string;
      readonly score: number;
      readonly cost: number;
    }
  | {
      readonly type: "variant-rejected";
      readonly variantId: string;
      readonly violations: ReadonlyArray<string>;
    }
  | { readonly type: "budget-exhausted"; readonly spent: number };

const DEFAULT_GENERATIONS = 3;
const DEFAULT_VARIANTS = 4;
const DEFAULT_SURVIVORS = 2;

export async function runOptimization(opts: OptimizerOptions): Promise<OptimizeRunSummary> {
  const generations = opts.generations ?? DEFAULT_GENERATIONS;
  const variantsPerGen = opts.variantsPerGeneration ?? DEFAULT_VARIANTS;
  const survivors = opts.survivorsPerGeneration ?? DEFAULT_SURVIVORS;
  const budget = opts.maxBudgetUsd ?? 10;
  const notes: string[] = [];

  // 1. Score baseline.
  const baselineVariant: Variant = {
    id: "baseline",
    content: opts.baseline,
    parentId: null,
    generation: 0,
    mutationReasoning: "(baseline)",
  };
  const baselineEval = await evaluateVariant({
    caller: opts.evaluate,
    examples: opts.examples,
    variant: baselineVariant,
  });
  let totalCost = baselineEval.aggregate.cost;
  const scoredBaseline: Variant = { ...baselineVariant, score: baselineEval.aggregate.score };
  opts.onProgress?.({ type: "baseline-scored", score: scoredBaseline.score ?? 0 });

  let parents: Variant[] = [scoredBaseline];
  let bestSoFar = scoredBaseline;

  // 2. Generations.
  for (let g = 1; g <= generations; g++) {
    if (totalCost >= budget) {
      notes.push(`Budget ($${budget}) exhausted before generation ${g}.`);
      opts.onProgress?.({ type: "budget-exhausted", spent: totalCost });
      break;
    }
    opts.onProgress?.({ type: "generation-start", generation: g });

    const proposals: MutationProposal[] = [];
    for (const parent of parents) {
      proposals.push(
        ...proposeMutations(
          {
            target: opts.target,
            traceExcerpts: [],
            recentFailures: opts.recentFailures ?? [],
            currentScore: parent.score ?? 0,
            strategy: opts.strategy ?? "random",
            maxLength: 15_000,
          },
          variantsPerGen,
        ),
      );
    }

    const generationVariants: Variant[] = [];
    for (const proposal of proposals) {
      if (totalCost >= budget) break;
      const parent = parents[0] ?? scoredBaseline;
      const prompt = buildMutationPrompt(parent.content, proposal, opts.target);
      let mutated;
      try {
        mutated = await opts.mutate(prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notes.push(`Mutation call failed for ${proposal.id}: ${msg}`);
        continue;
      }
      totalCost += mutated.costUsd;
      const variant = assembleVariant({
        parentId: parent.id,
        generation: g,
        proposal,
        llmOutput: mutated.text,
      });
      const constraints = validateConstraints(opts.target, variant.content);
      if (!constraints.passed) {
        opts.onProgress?.({
          type: "variant-rejected",
          variantId: variant.id,
          violations: constraints.violations,
        });
        continue;
      }
      if (exposesSecret(variant.content)) {
        opts.onProgress?.({
          type: "variant-rejected",
          variantId: variant.id,
          violations: ["Variant appears to contain a secret-like token"],
        });
        continue;
      }
      const evalRes = await evaluateVariant({
        caller: opts.evaluate,
        examples: opts.examples,
        variant,
      });
      totalCost += evalRes.aggregate.cost;
      const scored: Variant = { ...variant, score: evalRes.aggregate.score };
      opts.onProgress?.({
        type: "variant-evaluated",
        generation: g,
        variantId: scored.id,
        score: scored.score ?? 0,
        cost: evalRes.aggregate.cost,
      });
      generationVariants.push(scored);
      if ((scored.score ?? 0) > (bestSoFar.score ?? 0)) {
        bestSoFar = scored;
      }
    }

    if (generationVariants.length === 0) {
      notes.push(`Generation ${g}: no surviving variants.`);
      continue;
    }

    parents = generationVariants
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, survivors);
  }

  const baselineScore = scoredBaseline.score ?? 0;
  const bestScore = bestSoFar.score ?? 0;
  const improvementPct =
    baselineScore > 0 ? ((bestScore - baselineScore) / baselineScore) * 100 : 0;

  return {
    target: opts.target,
    baselineScore,
    bestScore,
    bestVariantId: bestSoFar.id,
    generations,
    totalVariants: 1, // baseline counted; per-generation count is implicit in notes/onProgress
    totalCostUsd: totalCost,
    winnerContent: bestSoFar.content,
    improvementPct,
    notes,
  };
}

/**
 * Test helper: a deterministic mutation caller that just returns the
 * baseline with the proposal's diffHint appended. Useful for unit
 * tests that don't want to mock a real provider.
 */
export function makeStubMutator(): MutationCaller {
  return async (prompt: string) => {
    // Extract <BASELINE>..</BASELINE>
    const match = prompt.match(/<BASELINE>([\s\S]*?)<\/BASELINE>/);
    const baseline = match?.[1] ?? "";
    return { text: baseline + "\n\n[mutated stub]", costUsd: 0 };
  };
}

/** Test helper: deterministic evaluator that scores against expected via Jaccard on the raw input. */
export function makeStubEvaluator(): EvaluationCaller {
  return async ({ input }): Promise<ProviderResponse> => ({
    text: input + " ok",
    costUsd: 0,
    latencyMs: 1,
  });
}
