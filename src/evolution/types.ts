/**
 * Type definitions for the WOTANN evolution pipeline (hermes-self-evolution port).
 *
 * Why a separate file: the optimizer, mutator, evaluator, and CLI all
 * share these types but have orthogonal responsibilities. Keeping the
 * type surface here avoids circular imports.
 */

export type EvolveTarget =
  | { readonly kind: "skill"; readonly path: string; readonly name: string }
  | { readonly kind: "prompt-section"; readonly path: string; readonly section: string }
  | { readonly kind: "tool-description"; readonly toolName: string; readonly current: string };

export interface EvolveExample {
  readonly id: string;
  readonly input: string;
  readonly expectedOutcome: string;
  /** Optional ground truth — e.g. a list of tool calls the agent should produce. */
  readonly expectedActions?: ReadonlyArray<string>;
}

export interface EvalResult {
  readonly exampleId: string;
  readonly variantId: string;
  readonly score: number; // 0..1
  readonly cost: number;
  readonly latencyMs: number;
  readonly notes: string;
}

export interface Variant {
  readonly id: string;
  readonly content: string;
  readonly parentId: string | null;
  readonly generation: number;
  readonly mutationReasoning: string;
  readonly score?: number; // populated after evaluation
}

export interface OptimizeRunSummary {
  readonly target: EvolveTarget;
  readonly baselineScore: number;
  readonly bestScore: number;
  readonly bestVariantId: string;
  readonly generations: number;
  readonly totalVariants: number;
  readonly totalCostUsd: number;
  readonly winnerContent: string;
  readonly improvementPct: number;
  readonly notes: ReadonlyArray<string>;
}

/**
 * Mutation strategy. The "reflective" strategy reads execution traces
 * from prior runs and proposes targeted edits ("the last failure was
 * because step 3 was unclear — rewrite it to ..."). The "random"
 * strategy is a fallback that tweaks formatting / phrasing without
 * trace context — used when there's no trace history yet.
 */
export type MutationStrategy = "reflective" | "random";

export interface MutationContext {
  readonly target: EvolveTarget;
  readonly traceExcerpts: ReadonlyArray<string>;
  readonly recentFailures: ReadonlyArray<string>;
  readonly currentScore: number;
  readonly strategy: MutationStrategy;
  readonly maxLength: number;
}

export interface ConstraintReport {
  readonly passed: boolean;
  readonly violations: ReadonlyArray<string>;
}
