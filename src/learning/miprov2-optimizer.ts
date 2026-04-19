/**
 * MIPROv2 bootstrap-fewshot optimizer — Phase 7B.
 *
 * DSPy's MIPROv2 (Opsahl-Ong et al. 2024) combines two optimization
 * axes: the INSTRUCTION (the natural-language prompt itself) and the
 * EXEMPLARS (few-shot demonstrations). The "bootstrap" idea: run the
 * current program on training data, keep only the runs that produced
 * the correct answer, and use THOSE as the few-shot exemplars on the
 * next iteration.
 *
 * This is simpler than GEPA — no full evolutionary loop needed — and
 * often gets you 70% of the improvement in 30% of the LLM calls. Use
 * as a fallback when GEPA's budget is exceeded, OR as a first pass to
 * seed GEPA's initial population.
 *
 * Ships:
 *   - bootstrapFewShot(config) — collect successful demos, rebuild prompt
 *   - formatFewShotPrompt(instruction, demos) — render prompt with
 *     exemplars
 *   - selectBestDemos(candidates, count) — fitness-weighted sample
 *
 * Not a replacement for GEPA; they compose. See skill-optimizer.ts
 * for a GEPA-driven loop.
 */

// ── Types ──────────────────────────────────────────────

export interface TrainingExample {
  readonly input: string;
  readonly expectedOutput: string;
}

export interface SuccessfulDemo {
  readonly input: string;
  readonly output: string;
  readonly score: number; // 0-1
}

export interface MiproConfig {
  /** The base instruction prompt (without exemplars). */
  readonly instruction: string;
  /** Training examples to bootstrap from. */
  readonly trainingSet: readonly TrainingExample[];
  /**
   * Run the agent with a prompt + input, return the raw output.
   */
  readonly runAgent: (prompt: string, input: string) => Promise<string>;
  /**
   * Score an output against the expected output. Return 0-1.
   * Default: exact-match after trim+lowercase.
   */
  readonly score?: (actual: string, expected: string) => number;
  /** Max demos to include in the final prompt. Default 4. */
  readonly maxDemos?: number;
  /** Min score required for a demo to be "successful". Default 1.0 (exact). */
  readonly minScoreForDemo?: number;
  /** Seed for deterministic selection when ties exist. Default 42. */
  readonly randomSeed?: number;
}

export interface MiproResult {
  /** The final optimized prompt (instruction + best demos). */
  readonly prompt: string;
  /** The demos selected for the final prompt. */
  readonly demos: readonly SuccessfulDemo[];
  /** Average score across the training set BEFORE optimization. */
  readonly baselineScore: number;
  /** Average score across the training set AFTER optimization. */
  readonly optimizedScore: number;
  /** Number of successful demos collected during bootstrap. */
  readonly demosCollected: number;
  /** Total LLM calls made. */
  readonly callsMade: number;
}

// ── Scoring ────────────────────────────────────────────

export function exactMatchScore(actual: string, expected: string): number {
  return actual.trim().toLowerCase() === expected.trim().toLowerCase() ? 1 : 0;
}

// ── Prompt formatter ──────────────────────────────────

/**
 * Render a few-shot prompt: [instruction][demos][final input-slot].
 * Callers append `Input: <actual-input>\nOutput:` after this for the
 * agent to complete.
 */
export function formatFewShotPrompt(instruction: string, demos: readonly SuccessfulDemo[]): string {
  if (demos.length === 0) return instruction;
  const demoBlocks = demos.map(
    (d, i) => `Example ${i + 1}:\nInput: ${d.input}\nOutput: ${d.output}`,
  );
  return `${instruction}\n\n${demoBlocks.join("\n\n")}`;
}

// ── Deterministic RNG ─────────────────────────────────

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Selection ─────────────────────────────────────────

/**
 * Pick the best N demos. Ties broken by stable-sort + deterministic
 * RNG so runs are reproducible given the same seed.
 */
export function selectBestDemos(
  candidates: readonly SuccessfulDemo[],
  count: number,
  seed: number = 42,
): readonly SuccessfulDemo[] {
  if (count >= candidates.length) return [...candidates].sort((a, b) => b.score - a.score);
  const rand = mulberry32(seed);
  const indexed = candidates.map((d, i) => ({ d, i, r: rand() }));
  // Sort: primary by score desc; tiebreak by random (but seeded)
  indexed.sort((a, b) => {
    if (b.d.score !== a.d.score) return b.d.score - a.d.score;
    return a.r - b.r;
  });
  return indexed.slice(0, count).map((x) => x.d);
}

// ── Bootstrap ─────────────────────────────────────────

export async function bootstrapFewShot(config: MiproConfig): Promise<MiproResult> {
  const score = config.score ?? exactMatchScore;
  const maxDemos = config.maxDemos ?? 4;
  const minScoreForDemo = config.minScoreForDemo ?? 1.0;
  const seed = config.randomSeed ?? 42;

  let callsMade = 0;

  // 1. BASELINE: run instruction-only prompt on each training example
  let baselineScoreSum = 0;
  const successfulDemos: SuccessfulDemo[] = [];
  for (const ex of config.trainingSet) {
    const promptWithInput = `${config.instruction}\n\nInput: ${ex.input}\nOutput:`;
    const output = await config.runAgent(promptWithInput, ex.input);
    callsMade++;
    const s = score(output, ex.expectedOutput);
    baselineScoreSum += s;
    if (s >= minScoreForDemo) {
      successfulDemos.push({ input: ex.input, output, score: s });
    }
  }
  const baselineScore =
    config.trainingSet.length > 0 ? baselineScoreSum / config.trainingSet.length : 0;

  // 2. SELECT: pick best demos from successful runs
  const selectedDemos = selectBestDemos(successfulDemos, maxDemos, seed);

  // 3. REBUILD: prompt with exemplars
  const optimizedPrompt = formatFewShotPrompt(config.instruction, selectedDemos);

  // 4. RE-EVALUATE: run on training set with the new prompt
  let optimizedScoreSum = 0;
  for (const ex of config.trainingSet) {
    const promptWithInput = `${optimizedPrompt}\n\nInput: ${ex.input}\nOutput:`;
    const output = await config.runAgent(promptWithInput, ex.input);
    callsMade++;
    optimizedScoreSum += score(output, ex.expectedOutput);
  }
  const optimizedScore =
    config.trainingSet.length > 0 ? optimizedScoreSum / config.trainingSet.length : 0;

  return {
    prompt: optimizedPrompt,
    demos: selectedDemos,
    baselineScore,
    optimizedScore,
    demosCollected: successfulDemos.length,
    callsMade,
  };
}
