/**
 * Skill prompt optimizer — wires GEPA to skill prompts (Phase 7A).
 *
 * Skills ship with a fixed prompt. When the prompt is sub-optimal
 * (common on first draft), the skill's task success rate suffers.
 * GEPA's genetic optimizer rewrites the prompt across generations
 * and scores each variant against a test set — converging on a
 * version that outperforms the initial draft.
 *
 * This module provides:
 *   - SkillOptimizerConfig — what to optimize + how to score
 *   - optimizeSkillPrompt(config)  — runs GEPA, returns best prompt
 *   - createLlmPromptMutator(query) — LLM rewrites a prompt N ways
 *
 * The evaluator is caller-supplied: pass a function that takes the
 * prompt, runs the skill against a test set, and returns a fitness
 * score (0-1 pass rate typical, but any higher-is-better metric works).
 *
 * This is a pure composition layer over `learning/gepa-optimizer.ts`.
 */

import { optimize, type OptimizationResult } from "../learning/gepa-optimizer.js";

// ── Types ──────────────────────────────────────────────

export interface SkillOptimizerConfig {
  /** Initial skill prompt (the one in SKILL.md). */
  readonly initialPrompt: string;
  /**
   * Runs the skill with `prompt` against the test set. Must return a
   * fitness score (higher = better).
   */
  readonly evaluate: (prompt: string) => Promise<number>;
  /**
   * Produces N mutated variants of `parent`. Typical: LLM-backed, but
   * can be heuristic (append clarifying sentence, reword intro, etc.).
   */
  readonly mutate: (parent: string, count: number) => Promise<readonly string[]>;
  /** Population size. Default 6. */
  readonly populationSize?: number;
  /** Max generations. Default 10. */
  readonly maxGenerations?: number;
  /** Early-stop patience. Default 3. */
  readonly patience?: number;
  /** Mutations per parent. Default 2. */
  readonly mutationsPerParent?: number;
  /** onGeneration callback for progress. */
  readonly onGeneration?: (gen: number, bestPrompt: string, bestFitness: number) => void;
}

export interface SkillOptimizerResult {
  /** The optimized prompt. */
  readonly prompt: string;
  /** Fitness score of the optimized prompt. */
  readonly fitness: number;
  /** Whether we improved over the initial prompt. */
  readonly improved: boolean;
  /** Fitness of the initial prompt (baseline). */
  readonly baselineFitness: number;
  /** Number of GEPA generations that ran. */
  readonly generationsRun: number;
  /** Total evaluate calls (after memoization). */
  readonly evaluationsRun: number;
}

// ── LLM mutator ────────────────────────────────────────

export type LlmQuery = (
  prompt: string,
  options: { readonly maxTokens: number; readonly temperature?: number },
) => Promise<string>;

const MUTATE_PROMPT_TEMPLATE = (
  current: string,
  variant: number,
) => `You are rewriting an agent prompt to improve its task success rate. Produce variant #${variant} — a rewritten version that is DIFFERENT but preserves the core intent.

Rules:
- Keep the same functional goal
- Try a different STRUCTURE (e.g. add numbered steps, add examples, tighten language, remove filler)
- Do NOT add features the original didn't have
- Do NOT output preamble or commentary — output ONLY the rewritten prompt

Current prompt:
"""
${current.slice(0, 8000)}
"""

Rewritten prompt #${variant}:`;

export function createLlmPromptMutator(
  query: LlmQuery,
): (parent: string, count: number) => Promise<readonly string[]> {
  return async (parent, count) => {
    const variants: string[] = [];
    // Sequential so we don't thundering-herd the LLM provider
    for (let i = 0; i < count; i++) {
      const prompt = MUTATE_PROMPT_TEMPLATE(parent, i + 1);
      const response = await query(prompt, { maxTokens: 2048, temperature: 0.7 });
      const cleaned = cleanPromptResponse(response);
      if (cleaned && cleaned !== parent) {
        variants.push(cleaned);
      }
    }
    return variants;
  };
}

/**
 * Strip preamble the LLM sometimes adds ("Sure, here's the rewrite:",
 * triple-quoted fencing, etc).
 */
export function cleanPromptResponse(raw: string): string {
  if (!raw) return "";
  let out = raw.trim();
  // Strip leading chatty phrases
  out = out.replace(/^(Sure|Here'?s|Here is|Rewritten prompt[\s\S]*?:)[^\n]*\n/i, "");
  // Strip triple-quoted fences
  out = out.replace(/^"""\s*\n?/, "").replace(/\n?"""\s*$/, "");
  out = out.replace(/^```[a-z]*\s*\n?/, "").replace(/\n?```\s*$/, "");
  return out.trim();
}

// ── Optimizer ──────────────────────────────────────────

export async function optimizeSkillPrompt(
  config: SkillOptimizerConfig,
): Promise<SkillOptimizerResult> {
  const baselineFitness = await config.evaluate(config.initialPrompt);

  const result: OptimizationResult<string> = await optimize({
    initialPopulation: [config.initialPrompt],
    mutate: async (parent, count) => config.mutate(parent.value, count),
    evaluate: async (cand) => config.evaluate(cand.value),
    populationSize: config.populationSize ?? 6,
    maxGenerations: config.maxGenerations ?? 10,
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

  const optimizedFitness = result.best.fitness ?? 0;
  return {
    prompt: result.best.value,
    fitness: optimizedFitness,
    improved: optimizedFitness > baselineFitness,
    baselineFitness,
    generationsRun: result.generationsRun,
    evaluationsRun: result.evaluationsRun,
  };
}

// ── Convenience: build evaluator from a runtime.query + test set ──────

export interface TestCase {
  readonly input: string;
  readonly expectedContains?: string;
  readonly expectedEquals?: string;
}

/**
 * Build an evaluator that sends a skill's prompt + each test input
 * through the runtime, then scores by pass rate (fraction of tests
 * where the response matches expectedContains/expectedEquals).
 */
export function buildBasicEvaluator(
  runtime: { readonly query: (prompt: string) => Promise<string> },
  testCases: readonly TestCase[],
): (skillPrompt: string) => Promise<number> {
  return async (skillPrompt) => {
    if (testCases.length === 0) return 0;
    let passes = 0;
    for (const tc of testCases) {
      try {
        const response = await runtime.query(`${skillPrompt}\n\nInput:\n${tc.input}`);
        const normalized = response.trim().toLowerCase();
        if (tc.expectedEquals !== undefined) {
          if (normalized === tc.expectedEquals.trim().toLowerCase()) passes++;
        } else if (tc.expectedContains !== undefined) {
          if (normalized.includes(tc.expectedContains.trim().toLowerCase())) passes++;
        } else {
          // No expectation → any non-empty response is a pass
          if (response.trim().length > 0) passes++;
        }
      } catch {
        // Test failed — don't count as pass
      }
    }
    return passes / testCases.length;
  };
}
