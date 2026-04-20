/**
 * GEPA — Genetic Evolution of Prompts and Agents — Phase 7 critical path.
 *
 * GEPA (Agrawal et al. 2024, arXiv:2406.17404) beats MIPROv2 on DSPy's
 * prompt-optimization leaderboard by combining:
 *   1. LLM-driven mutation (rewrite the current prompt, don't just
 *      tweak exemplars)
 *   2. Tournament selection with elitism (keep best-of-N + mutate rest)
 *   3. Memoization of fitness evaluations (expensive eval runs cached
 *      by population-member hash)
 *   4. Early-stop when no gen produces improvement for patience gens
 *
 * This module ships a GENERIC genetic optimizer. Callers plug in:
 *   - initial population of candidates (any shape: string, object, AST)
 *   - mutate(candidate): produces N new candidates (LLM-backed or heuristic)
 *   - evaluate(candidate): returns fitness score (higher = better)
 *   - optional: crossover(a, b) for 2-parent recombination
 *
 * Intended for use by:
 *   - Skill prompt optimization (tier 1)
 *   - Tool description optimization (tier 2)
 *   - System prompt section optimization (tier 3)
 *   - Code mutation optimization (tier 4, Darwinian Evolver pattern)
 *
 * No LLM calls inside this module — caller provides mutate+evaluate.
 */

// ── Types ──────────────────────────────────────────────

export interface Candidate<T> {
  /** Stable id for this candidate (used for memoization + audit log). */
  readonly id: string;
  /** Generation this candidate was created in (0-indexed). */
  readonly generation: number;
  /** The actual prompt / code / whatever the optimizer is evolving. */
  readonly value: T;
  /** Cached fitness score (filled after evaluation). */
  readonly fitness?: number;
  /** Optional provenance trail: which parent(s) spawned this. */
  readonly parentIds?: readonly string[];
}

export interface OptimizerConfig<T> {
  /** Initial population to start from. Must have at least 1 member. */
  readonly initialPopulation: readonly T[];
  /** Given a parent candidate, return N (typically 1-3) mutated variants. */
  readonly mutate: (parent: Candidate<T>, count: number) => Promise<readonly T[]>;
  /** Given a candidate, return fitness score (higher = better). */
  readonly evaluate: (candidate: Candidate<T>) => Promise<number>;
  /**
   * Optional crossover function for 2-parent recombination. If omitted,
   * GEPA falls back to pure mutation (asexual reproduction).
   */
  readonly crossover?: (a: Candidate<T>, b: Candidate<T>) => Promise<T>;
  /** Population size per generation. Default 6. */
  readonly populationSize?: number;
  /** Number of generations. Default 10. */
  readonly maxGenerations?: number;
  /** Early-stop if no improvement for this many gens. Default 3. */
  readonly patience?: number;
  /** Mutation count per parent per gen. Default 2. */
  readonly mutationsPerParent?: number;
  /** Elite count — top N carry over unchanged to next gen. Default 1. */
  readonly eliteCount?: number;
  /** Hash function for memoization (caches evaluation by candidate value). Default JSON.stringify. */
  readonly hash?: (value: T) => string;
  /** Called after each generation for progress reporting. */
  readonly onGeneration?: (
    gen: number,
    best: Candidate<T>,
    population: readonly Candidate<T>[],
  ) => void;
  /** Inject random generator (for deterministic tests). Default Math.random. */
  readonly random?: () => number;
}

export interface OptimizationResult<T> {
  /** Best candidate found. */
  readonly best: Candidate<T>;
  /** Best candidate per generation (size = generations actually run). */
  readonly history: readonly Candidate<T>[];
  /** Total evaluate() calls made (after memoization). */
  readonly evaluationsRun: number;
  /** Did we early-stop? */
  readonly earlyStopped: boolean;
  /** Number of generations actually run. */
  readonly generationsRun: number;
}

// ── Optimizer ──────────────────────────────────────────

let idCounter = 0;
function freshId(): string {
  return `c-${++idCounter}-${Date.now().toString(36)}`;
}

/**
 * Run GEPA optimization. Returns the best candidate across all gens.
 *
 * Pseudocode:
 *   population = seed
 *   for gen in 0..maxGenerations:
 *     evaluate all unevaluated members (memoized)
 *     record best
 *     if best unchanged for `patience` gens → break
 *     select elite (top eliteCount)
 *     mutate rest to form new generation
 *
 * Deterministic given the same `random` seed.
 */
export async function optimize<T>(config: OptimizerConfig<T>): Promise<OptimizationResult<T>> {
  const populationSize = config.populationSize ?? 6;
  const maxGenerations = config.maxGenerations ?? 10;
  const patience = config.patience ?? 3;
  const mutationsPerParent = config.mutationsPerParent ?? 2;
  const eliteCount = Math.min(populationSize, config.eliteCount ?? 1);
  const hashFn = config.hash ?? ((v: T) => JSON.stringify(v));
  const random = config.random ?? Math.random;

  if (config.initialPopulation.length === 0) {
    throw new Error("GEPA: initialPopulation must have at least 1 member");
  }
  if (populationSize < 1) throw new Error("GEPA: populationSize must be >= 1");
  if (mutationsPerParent < 1) throw new Error("GEPA: mutationsPerParent must be >= 1");

  // Fitness cache — avoids re-evaluating identical candidates across gens.
  // Store PROMISES (not values) so concurrent duplicates share one call.
  const fitnessPromises = new Map<string, Promise<number>>();
  let evaluationsRun = 0;

  async function evaluateCached(candidate: Candidate<T>): Promise<Candidate<T>> {
    if (candidate.fitness !== undefined) return candidate;
    const h = hashFn(candidate.value);
    let promise = fitnessPromises.get(h);
    if (!promise) {
      promise = (async () => {
        const fitness = await config.evaluate(candidate);
        evaluationsRun++;
        return fitness;
      })();
      fitnessPromises.set(h, promise);
    }
    const fitness = await promise;
    return { ...candidate, fitness };
  }

  // Seed generation 0
  let population: Candidate<T>[] = config.initialPopulation
    .slice(0, populationSize)
    .map((value, _idx) => ({
      id: freshId(),
      generation: 0,
      value,
      parentIds: [],
    }));
  // If seed is smaller than population, fill by duplicating (will be mutated into diversity)
  while (population.length < populationSize) {
    const donor = population[population.length % Math.max(1, population.length)];
    if (!donor) break;
    population.push({ ...donor, id: freshId() });
  }

  const history: Candidate<T>[] = [];
  let lastBestFitness = -Infinity;
  let genSinceImprovement = 0;
  let earlyStopped = false;
  let genRun = 0;

  for (let gen = 0; gen < maxGenerations; gen++) {
    genRun = gen + 1;
    // Evaluate all
    population = await Promise.all(population.map(evaluateCached));
    population.sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
    const best = population[0];
    if (best) {
      history.push(best);
      config.onGeneration?.(gen, best, population);
      const bestFitness = best.fitness ?? 0;
      if (bestFitness > lastBestFitness + 1e-9) {
        lastBestFitness = bestFitness;
        genSinceImprovement = 0;
      } else {
        genSinceImprovement++;
      }
      if (genSinceImprovement >= patience) {
        earlyStopped = true;
        break;
      }
    }

    // Build next generation
    if (gen < maxGenerations - 1) {
      const elite = population.slice(0, eliteCount);
      const parentsForMutation = population.slice(0, Math.ceil(populationSize / 2));
      const children: Candidate<T>[] = [];
      for (const parent of parentsForMutation) {
        if (children.length + elite.length >= populationSize) break;
        const remaining = populationSize - elite.length - children.length;
        const count = Math.min(mutationsPerParent, remaining);
        if (count <= 0) break;
        const variants = await config.mutate(parent, count);
        for (const v of variants) {
          children.push({
            id: freshId(),
            generation: gen + 1,
            value: v,
            parentIds: [parent.id],
          });
          if (children.length + elite.length >= populationSize) break;
        }
      }

      // Optional crossover: if provided + population has >= 2 members,
      // replace one random non-elite child with a crossover offspring
      if (config.crossover && population.length >= 2 && children.length > 0 && random() < 0.3) {
        const a = population[0];
        const b = population[1];
        if (a && b) {
          const childValue = await config.crossover(a, b);
          children[children.length - 1] = {
            id: freshId(),
            generation: gen + 1,
            value: childValue,
            parentIds: [a.id, b.id],
          };
        }
      }

      population = [...elite.map((e) => ({ ...e, generation: gen + 1 })), ...children];
    }
  }

  // Final evaluation pass in case last-gen mutants weren't evaluated yet
  population = await Promise.all(population.map(evaluateCached));
  population.sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));

  // Pick best across all generations (may exceed current pop's best if
  // an earlier gen had a better one — possible when patience expired on
  // a stall after a great peak)
  let globalBest = population[0];
  for (const h of history) {
    if ((h.fitness ?? 0) > (globalBest?.fitness ?? -Infinity)) globalBest = h;
  }
  if (!globalBest) {
    throw new Error("GEPA: no candidate produced — initial population was empty");
  }

  return {
    best: globalBest,
    history,
    evaluationsRun,
    earlyStopped,
    generationsRun: genRun,
  };
}

// ── Selection helpers ─────────────────────────────────

/**
 * Tournament selection: pick k random candidates, return the best.
 * Used by alternative crossover strategies that want stochastic parent selection.
 */
export function tournamentSelect<T>(
  population: readonly Candidate<T>[],
  k: number,
  random: () => number = Math.random,
): Candidate<T> | null {
  if (population.length === 0) return null;
  const size = Math.max(1, Math.min(k, population.length));
  const picked: Candidate<T>[] = [];
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(random() * population.length);
    const c = population[idx];
    if (c) picked.push(c);
  }
  picked.sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
  return picked[0] ?? null;
}
