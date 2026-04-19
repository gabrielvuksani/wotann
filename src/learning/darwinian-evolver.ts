/**
 * Darwinian Evolver — code-tier optimization (Phase 7C).
 *
 * GEPA optimizes prompts; this module optimizes CODE. The mutation
 * operator rewrites a function body; the fitness function runs tests
 * and returns pass rate; the optimizer picks the code that passes
 * most tests.
 *
 * Key constraints vs prompt evolution:
 *   1. Syntax must stay valid across mutations (a broken-parse
 *      variant scores 0 without even running).
 *   2. Some mutations don't compile/typecheck — reject those before
 *      fitness evaluation (save expensive test runs).
 *   3. The original code is the seed population; only apply mutations
 *      that the caller explicitly authorizes.
 *
 * This module composes GEPA's optimizer with a pre-evaluation gate:
 *   - syntaxCheck(code)  → caller-supplied; cheap
 *   - evaluate(code)     → runs tests (expensive)
 *   - mutate(parent)     → LLM rewrite OR deterministic transforms
 *
 * Not a code-generator — operates on existing code that the caller
 * has already extracted (e.g. a function body). Does not write files.
 */

import { optimize, type OptimizationResult } from "./gepa-optimizer.js";

// ── Types ──────────────────────────────────────────────

export interface DarwinianConfig {
  /** Seed code (the original implementation). */
  readonly initialCode: string;
  /**
   * Cheap pre-evaluation: does this code parse? Caller supplies a
   * real parser (acorn for JS, Python tokenizer, etc.). Optional —
   * defaults to "always valid".
   */
  readonly syntaxCheck?: (code: string) => boolean;
  /**
   * Expensive fitness: runs tests on this code and returns pass rate
   * (0-1). Typically wraps patch-scorer.ts.
   */
  readonly evaluate: (code: string) => Promise<number>;
  /**
   * Produces N variants of `parent`. Typically LLM-backed: "rewrite
   * this function to fix <specific bug>, produce N alternatives".
   */
  readonly mutate: (parent: string, count: number) => Promise<readonly string[]>;
  /** Population size. Default 6. */
  readonly populationSize?: number;
  /** Max generations. Default 8. */
  readonly maxGenerations?: number;
  /** Early-stop patience. Default 3. */
  readonly patience?: number;
  /** Mutations per parent. Default 2. */
  readonly mutationsPerParent?: number;
  /** onGeneration callback for telemetry. */
  readonly onGeneration?: (gen: number, bestCode: string, bestFitness: number) => void;
}

export interface DarwinianResult {
  /** Best code found. */
  readonly code: string;
  /** Fitness of the best code. */
  readonly fitness: number;
  /** Fitness of the initial code (baseline). */
  readonly baselineFitness: number;
  /** Did we improve? */
  readonly improved: boolean;
  /** Number of generations run. */
  readonly generationsRun: number;
  /** Number of evaluations actually executed (after memoization). */
  readonly evaluationsRun: number;
  /** Number of mutants rejected at the syntax-check gate. */
  readonly syntaxRejects: number;
}

// ── Evolver ────────────────────────────────────────────

export async function evolveCode(config: DarwinianConfig): Promise<DarwinianResult> {
  const syntaxCheck = config.syntaxCheck ?? (() => true);
  let syntaxRejects = 0;

  // Wrap mutate to filter out syntactically-broken variants upfront
  const filteredMutate = async (parent: string, count: number): Promise<readonly string[]> => {
    const raw = await config.mutate(parent, count);
    const valid: string[] = [];
    for (const variant of raw) {
      if (syntaxCheck(variant)) {
        valid.push(variant);
      } else {
        syntaxRejects++;
      }
    }
    return valid;
  };

  // Wrap evaluate to score syntax-broken code as 0 (defensive; should
  // be filtered already, but doubling up avoids edge cases)
  const safeEvaluate = async (code: string): Promise<number> => {
    if (!syntaxCheck(code)) return 0;
    return config.evaluate(code);
  };

  const baselineFitness = await safeEvaluate(config.initialCode);

  const result: OptimizationResult<string> = await optimize({
    initialPopulation: [config.initialCode],
    mutate: async (parent, count) => filteredMutate(parent.value, count),
    evaluate: async (cand) => safeEvaluate(cand.value),
    populationSize: config.populationSize ?? 6,
    maxGenerations: config.maxGenerations ?? 8,
    patience: config.patience ?? 3,
    mutationsPerParent: config.mutationsPerParent ?? 2,
    hash: (v) => v,
    ...(config.onGeneration !== undefined
      ? {
          onGeneration: (gen, best) => {
            config.onGeneration?.(gen, best.value, best.fitness ?? 0);
          },
        }
      : {}),
  });

  const bestFitness = result.best.fitness ?? 0;
  return {
    code: result.best.value,
    fitness: bestFitness,
    baselineFitness,
    improved: bestFitness > baselineFitness,
    generationsRun: result.generationsRun,
    evaluationsRun: result.evaluationsRun,
    syntaxRejects,
  };
}

// ── Deterministic text transforms (optional mutation source) ───

/**
 * Build a mutation function from a fixed bank of deterministic
 * text transforms. Useful when LLM budget is exhausted OR for
 * deterministic tests. Transforms are applied in round-robin.
 */
export function buildDeterministicMutator(
  transforms: readonly ((code: string) => string | null)[],
): (parent: string, count: number) => Promise<readonly string[]> {
  let nextIdx = 0;
  return async (parent, count) => {
    const variants: string[] = [];
    const seen = new Set<string>([parent]);
    let attempts = 0;
    while (variants.length < count && attempts < transforms.length * 3) {
      const transform = transforms[nextIdx % transforms.length];
      nextIdx++;
      attempts++;
      if (!transform) continue;
      const out = transform(parent);
      if (out && !seen.has(out)) {
        seen.add(out);
        variants.push(out);
      }
    }
    return variants;
  };
}

/**
 * Common transforms for TypeScript/JavaScript code. Each returns
 * null if the transform doesn't apply (no change possible).
 */
export const COMMON_TS_TRANSFORMS: readonly ((code: string) => string | null)[] = [
  // Swap const → let
  (code) => {
    const match = code.match(/\bconst\s+\w+\s*=/);
    if (!match) return null;
    return code.replace(/\bconst\b/, "let");
  },
  // Add null-safe optional chaining
  (code) => {
    if (code.includes("?.")) return null;
    const match = code.match(/(\w+)\.(\w+)/);
    if (!match) return null;
    return code.replace(match[0], `${match[1]}?.${match[2]}`);
  },
  // Swap == → ===
  (code) => {
    if (!/[^=!]==[^=]/.test(code)) return null;
    return code.replace(/([^=!])==([^=])/g, "$1===$2");
  },
  // Add explicit return type on arrow functions
  (code) => {
    const match = code.match(/=\s*\(([^)]*)\)\s*=>/);
    if (!match) return null;
    if (code.includes(": ")) return null; // already typed somewhere
    return code.replace(match[0], `= (${match[1]}): unknown =>`);
  },
];
