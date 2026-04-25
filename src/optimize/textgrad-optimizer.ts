/**
 * TextGrad — gradient-based prompt optimizer.
 *
 * Treats LLM critique as a gradient signal that updates a prompt over
 * iterations. This is orthogonal to GEPA (evolutionary) and MIPROv2
 * (Bayesian/bootstrap) — TextGrad is "gradient descent on prompts".
 *
 * Public API:
 *  - estimateTextualGradient — query the critic, return a gradient
 *  - applyGradient — apply a gradient to a prompt with a learning rate
 *  - optimizeTextGrad — full loop: run prompt on tasks, gather failures,
 *    compute gradients, update prompt, repeat for N iterations
 *
 * No LLM provider is hardcoded — the caller injects a TextGradLlm.
 *
 * Honesty contract:
 *  - If the critic times out or returns garbage we return
 *    {ok: false, reason: "..."}. Never fake a high-confidence gradient.
 *  - If confidence < abstainThreshold we skip the update and return original
 *    prompt unchanged plus log abstention.
 *  - Learning rate above 1.0 is clamped (with onClampWarning callback).
 *  - applyGradient is purely textual unless the caller passes an editorLlm
 *    (rewrite mode). Default mode is annotation: append the suggested edit
 *    as a directive after the prompt, capped by learning rate.
 */

import {
  type TextGradLlm,
  type TaskInstance,
  type TaskFailure,
  type TextGradFeedback,
  type GradientComputeResult,
  type GradientUpdateResult,
  DEFAULT_ABSTAIN_THRESHOLD,
  DEFAULT_LEARNING_RATE,
  clampLearningRate,
} from "./textgrad-types.js";
import { runCritic, type CriticOptions } from "./textgrad-critic.js";

// ── Step-1: Estimate gradient ──────────────────────────

/**
 * Query the critic to estimate a textual gradient for the given prompt
 * + failure. Returns a GradientComputeResult so callers can distinguish
 * critic failure from low-confidence gradient.
 */
export async function estimateTextualGradient(
  prompt: string,
  task: TaskInstance,
  failure: TaskFailure,
  criticModel: TextGradLlm,
  options: CriticOptions = {},
): Promise<GradientComputeResult> {
  return runCritic(prompt, task, failure, criticModel, options);
}

// ── Step-2: Apply gradient ─────────────────────────────

export interface ApplyGradientOptions {
  /** 0..1, how aggressively to apply the gradient. Default 0.5. */
  readonly learningRate?: number;
  /** Below this confidence, abstain from update. Default 0.4. */
  readonly abstainThreshold?: number;
  /**
   * Optional editor LLM for "rewrite mode". If provided, the gradient is
   * applied by asking this LLM to rewrite the prompt incorporating the
   * suggested edit. If absent, we use textual annotation mode.
   */
  readonly editorLlm?: TextGradLlm;
  /** Called when learning rate is clamped above 1.0 or below 0. */
  readonly onClampWarning?: (original: number, clamped: number) => void;
  /** Called when the optimizer abstains due to low confidence. */
  readonly onAbstain?: (gradient: TextGradFeedback) => void;
}

/**
 * Apply a textual gradient to a prompt.
 *
 * Modes:
 *  - Annotation (default): append the suggestedEdit as a directive
 *    proportional to learningRate. This is fully deterministic and
 *    requires no LLM call.
 *  - Rewrite: if editorLlm is provided, ask it to incorporate the
 *    suggested edit and produce a new prompt.
 */
export async function applyGradient(
  prompt: string,
  gradient: TextGradFeedback,
  options: ApplyGradientOptions = {},
): Promise<GradientUpdateResult> {
  const abstainThreshold = options.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD;
  const lrInput = options.learningRate ?? DEFAULT_LEARNING_RATE;
  const lrClamp = clampLearningRate(lrInput);

  if (lrClamp.wasClamped && options.onClampWarning) {
    options.onClampWarning(lrInput, lrClamp.value);
  }

  if (gradient.confidence < abstainThreshold) {
    if (options.onAbstain) options.onAbstain(gradient);
    return {
      ok: false,
      reason: `gradient confidence ${gradient.confidence.toFixed(2)} below threshold ${abstainThreshold}`,
      originalPrompt: prompt,
    };
  }

  if (lrClamp.value === 0) {
    return {
      ok: false,
      reason: "learning rate is 0; no update applied",
      originalPrompt: prompt,
    };
  }

  // Rewrite mode
  if (options.editorLlm) {
    return rewriteWithLlm(prompt, gradient, lrClamp.value, options.editorLlm);
  }

  // Annotation mode (default, deterministic)
  const annotated = applyAnnotation(prompt, gradient, lrClamp.value);
  return { ok: true, newPrompt: annotated, applied: gradient };
}

/**
 * Apply gradient by appending a directive at the end of the prompt.
 * The strength of the directive scales with the learning rate.
 *
 * lr in (0, 0.34]   → a soft hint ("Consider:")
 * lr in (0.34, 0.67] → a guideline ("Note:")
 * lr in (0.67, 1.0] → an imperative ("Important:" + restate the edit twice)
 */
function applyAnnotation(prompt: string, gradient: TextGradFeedback, lr: number): string {
  const trimmed = prompt.replace(/\s+$/, "");
  let suffix: string;

  if (lr <= 0.34) {
    suffix = `\n\nConsider: ${gradient.suggestedEdit}`;
  } else if (lr <= 0.67) {
    suffix = `\n\nNote: ${gradient.suggestedEdit}`;
  } else {
    // High learning rate: stronger imperative + repeat once for emphasis
    suffix = `\n\nImportant: ${gradient.suggestedEdit}\nThis is critical: ${gradient.suggestedEdit}`;
  }

  return `${trimmed}${suffix}`;
}

const REWRITE_INSTRUCTION = `Rewrite the prompt below to incorporate the suggested edit.
Preserve the original intent and structure. Apply the edit faithfully but minimally.

Output ONLY the rewritten prompt. Do not include explanations or markdown fences.`;

async function rewriteWithLlm(
  prompt: string,
  gradient: TextGradFeedback,
  lr: number,
  llm: TextGradLlm,
): Promise<GradientUpdateResult> {
  const editStrength = lr <= 0.34 ? "minimal" : lr <= 0.67 ? "moderate" : "substantial";
  const editorPrompt = [
    REWRITE_INSTRUCTION,
    "",
    `EDIT STRENGTH: ${editStrength}`,
    "",
    "ORIGINAL PROMPT:",
    prompt,
    "",
    "SUGGESTED EDIT:",
    gradient.suggestedEdit,
    "",
    "REWRITTEN PROMPT:",
  ].join("\n");

  let rewritten: string;
  try {
    rewritten = await llm.query(editorPrompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `editor LLM error: ${message}`,
      originalPrompt: prompt,
    };
  }

  if (typeof rewritten !== "string" || rewritten.trim().length === 0) {
    return {
      ok: false,
      reason: "editor LLM returned empty rewrite",
      originalPrompt: prompt,
    };
  }

  // Strip code fences if the editor wrapped the rewrite
  const cleaned = stripFences(rewritten).trim();
  if (cleaned.length === 0) {
    return {
      ok: false,
      reason: "editor rewrite reduced to empty after fence stripping",
      originalPrompt: prompt,
    };
  }

  return { ok: true, newPrompt: cleaned, applied: gradient };
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fencePattern = /^```(?:[a-zA-Z]+)?\s*\n?([\s\S]*?)\n?```$/;
  const m = fencePattern.exec(trimmed);
  if (m && m[1]) return m[1];
  return trimmed;
}

// ── Step-3: Full optimization loop ─────────────────────

export interface TextGradOptimizeConfig {
  /** Initial prompt to optimize. */
  readonly initialPrompt: string;
  /** Tasks the prompt is supposed to handle. */
  readonly trainingSet: readonly TaskInstance[];
  /**
   * Run the agent with a prompt + task input. Return the actual output.
   * The optimizer will compute the score by calling score() below.
   */
  readonly runAgent: (prompt: string, task: TaskInstance) => Promise<string>;
  /**
   * Score an output against a task. Return [0, 1]. The optimizer treats
   * any score below failureThreshold as a failure that warrants gradient
   * computation.
   */
  readonly score: (output: string, task: TaskInstance) => Promise<number>;
  /** The critic LLM. */
  readonly criticLlm: TextGradLlm;
  /**
   * Optional editor LLM for rewrite mode. If absent, gradients are
   * applied via annotation only.
   */
  readonly editorLlm?: TextGradLlm;
  /** Number of optimization iterations. Default 5. */
  readonly maxIterations?: number;
  /** Learning rate. Default 0.5. */
  readonly learningRate?: number;
  /** Abstain threshold. Default 0.4. */
  readonly abstainThreshold?: number;
  /** Below this score a task is a failure. Default 0.5. */
  readonly failureThreshold?: number;
  /** Stop early if all tasks pass. Default true. */
  readonly stopWhenPerfect?: boolean;
  /** Critic timeout (ms). */
  readonly criticTimeoutMs?: number;
  /** Called once per iteration with progress info. */
  readonly onIteration?: (info: TextGradIterationInfo) => void;
}

export interface TextGradIterationInfo {
  readonly iteration: number;
  readonly currentPrompt: string;
  readonly meanScore: number;
  readonly failures: number;
  readonly gradientsApplied: number;
  readonly gradientsAbstained: number;
}

export interface TextGradOptimizeResult {
  readonly bestPrompt: string;
  readonly bestScore: number;
  readonly initialScore: number;
  readonly iterationsRun: number;
  readonly history: readonly TextGradIterationInfo[];
  readonly stopped: "perfect" | "max-iterations" | "no-failures-found";
}

/**
 * Run the full TextGrad optimization loop.
 */
export async function optimizeTextGrad(
  config: TextGradOptimizeConfig,
): Promise<TextGradOptimizeResult> {
  if (config.trainingSet.length === 0) {
    throw new Error("optimizeTextGrad: trainingSet must not be empty");
  }

  const maxIterations = config.maxIterations ?? 5;
  const learningRate = config.learningRate ?? DEFAULT_LEARNING_RATE;
  const abstainThreshold = config.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD;
  const failureThreshold = config.failureThreshold ?? 0.5;
  const stopWhenPerfect = config.stopWhenPerfect ?? true;

  let currentPrompt = config.initialPrompt;
  let bestPrompt = config.initialPrompt;
  let bestScore = -Infinity;
  let initialScore = 0;
  const history: TextGradIterationInfo[] = [];
  let stopped: "perfect" | "max-iterations" | "no-failures-found" = "max-iterations";

  // Establish baseline at iteration 0 (no update yet)
  const baselineRuns = await runOnTrainingSet(currentPrompt, config);
  const baselineMean =
    baselineRuns.reduce((s, r) => s + r.score, 0) / Math.max(1, baselineRuns.length);
  initialScore = baselineMean;
  bestScore = baselineMean;
  history.push({
    iteration: 0,
    currentPrompt,
    meanScore: baselineMean,
    failures: baselineRuns.filter((r) => r.score < failureThreshold).length,
    gradientsApplied: 0,
    gradientsAbstained: 0,
  });
  if (config.onIteration) config.onIteration(history[0]!);

  if (stopWhenPerfect && baselineRuns.every((r) => r.score >= failureThreshold)) {
    return {
      bestPrompt,
      bestScore,
      initialScore,
      iterationsRun: 0,
      history,
      stopped: "no-failures-found",
    };
  }

  for (let iter = 1; iter <= maxIterations; iter++) {
    const runs = iter === 1 ? baselineRuns : await runOnTrainingSet(currentPrompt, config);
    const failures = runs.filter((r) => r.score < failureThreshold);

    if (failures.length === 0) {
      stopped = "perfect";
      break;
    }

    let applied = 0;
    let abstained = 0;

    // Process failures one at a time. We only apply ONE gradient update per
    // iteration to mimic SGD-style updates rather than batch updates that
    // could blow up the prompt.
    const target = failures[0]!;
    const gradResult = await estimateTextualGradient(
      currentPrompt,
      target.task,
      {
        taskId: target.task.id,
        actualOutput: target.output,
        score: target.score,
      },
      config.criticLlm,
      config.criticTimeoutMs !== undefined ? { timeoutMs: config.criticTimeoutMs } : {},
    );

    if (!gradResult.ok) {
      // Critic failed — record + continue (do not crash)
      const info: TextGradIterationInfo = {
        iteration: iter,
        currentPrompt,
        meanScore: runs.reduce((s, r) => s + r.score, 0) / runs.length,
        failures: failures.length,
        gradientsApplied: 0,
        gradientsAbstained: 1,
      };
      history.push(info);
      if (config.onIteration) config.onIteration(info);
      continue;
    }

    const updateOpts: ApplyGradientOptions = {
      learningRate,
      abstainThreshold,
    };
    if (config.editorLlm) {
      (updateOpts as { editorLlm?: TextGradLlm }).editorLlm = config.editorLlm;
    }
    const update = await applyGradient(currentPrompt, gradResult.gradient, updateOpts);

    if (update.ok) {
      // Tentatively accept; verify it didn't make things worse
      const tentativeRuns = await runOnTrainingSet(update.newPrompt, config);
      const tentativeMean = tentativeRuns.reduce((s, r) => s + r.score, 0) / tentativeRuns.length;
      const currentMean = runs.reduce((s, r) => s + r.score, 0) / runs.length;
      if (tentativeMean >= currentMean) {
        currentPrompt = update.newPrompt;
        applied = 1;
        if (tentativeMean > bestScore) {
          bestScore = tentativeMean;
          bestPrompt = update.newPrompt;
        }
      } else {
        // Reject: gradient hurt performance. Keep current prompt.
        abstained = 1;
      }
    } else {
      abstained = 1;
    }

    const finalRuns = applied > 0 ? await runOnTrainingSet(currentPrompt, config) : runs;
    const meanScore = finalRuns.reduce((s, r) => s + r.score, 0) / finalRuns.length;
    const info: TextGradIterationInfo = {
      iteration: iter,
      currentPrompt,
      meanScore,
      failures: finalRuns.filter((r) => r.score < failureThreshold).length,
      gradientsApplied: applied,
      gradientsAbstained: abstained,
    };
    history.push(info);
    if (config.onIteration) config.onIteration(info);

    if (meanScore > bestScore) {
      bestScore = meanScore;
      bestPrompt = currentPrompt;
    }

    if (stopWhenPerfect && info.failures === 0) {
      stopped = "perfect";
      break;
    }
  }

  return {
    bestPrompt,
    bestScore,
    initialScore,
    iterationsRun: history.length - 1,
    history,
    stopped,
  };
}

interface TrainingRun {
  readonly task: TaskInstance;
  readonly output: string;
  readonly score: number;
}

async function runOnTrainingSet(
  prompt: string,
  config: TextGradOptimizeConfig,
): Promise<readonly TrainingRun[]> {
  const out: TrainingRun[] = [];
  for (const task of config.trainingSet) {
    let output: string;
    try {
      output = await config.runAgent(prompt, task);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({ task, output: `[runtime-error] ${message}`, score: 0 });
      continue;
    }
    let s: number;
    try {
      s = await config.score(output, task);
    } catch {
      s = 0;
    }
    if (typeof s !== "number" || Number.isNaN(s)) s = 0;
    s = Math.max(0, Math.min(1, s));
    out.push({ task, output, score: s });
  }
  return out;
}
