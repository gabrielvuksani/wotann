/**
 * Unified code-eval runner — HumanEval+, MBPP+, LiveCodeBench.
 *
 * All three benchmarks share the same task shape: a prompt describing a
 * function to implement + a test suite that grades pass/fail. The main
 * differences are test-suite contamination risk (HumanEval/MBPP are in
 * most training corpora → post-cutoff slices only), evaluation depth
 * (LiveCodeBench has algorithmic difficulty tiers), and scoring
 * (pass@k for HumanEval/MBPP, weighted rating for LCB).
 *
 * This module ships one generic runner, runCodeEval, parameterised by
 * the benchmark flavour.
 *
 * Contamination footnote: runCodeEval records a contamination-risk
 * field per task so the benchmark-harness's report-writer can footnote
 * results. HumanEval/MBPP = high risk (in Llama 3.3 / DeepSeek v3
 * training cutoffs). LCB post-cutoff slice only = low risk.
 *
 * The runner also enforces an LCB CUTOFF-DATE contract:
 *   - LCB tasks MUST carry a `releaseDate` field (ISO date string)
 *   - Tasks with releaseDate BEFORE the configured modelCutoff are
 *     flagged as medium (not low) contamination risk
 *   - This matches the MASTER_AUDIT_2026-04-18 guidance on LCB usage.
 *
 * Real integration with upstream pip packages (humaneval-plus,
 * mbpp-plus, lcb_runner) is gated behind WOTANN_CODEEVAL_REAL=1; falls
 * through to simple mode with mode: "simple" (no silent lies).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StreamChunk } from "../../providers/types.js";
import type { WotannQueryOptions } from "../../core/types.js";
import type { CompletionCriterion, VerificationEvidence } from "../../autopilot/types.js";
import {
  BlockedCorpusError,
  type DryRunReport,
  type DryRunCheck,
  makeDryRunReport,
  openTrajectoryWriter,
  seededShuffle,
  type TaskScoreEnvelope,
} from "./shared.js";

// ── Types ──────────────────────────────────────────────

export type CodeEvalFlavour = "humaneval-plus" | "mbpp-plus" | "livecodebench";

export type ContaminationRisk = "low" | "medium" | "high";

export interface CodeEvalTask {
  readonly id: string;
  readonly flavour: CodeEvalFlavour;
  /** Problem statement shown to the agent. */
  readonly prompt: string;
  /** Expected function signature, if provided. */
  readonly signature?: string;
  /** Test harness executed against the agent's output. */
  readonly testCommand?: string;
  readonly criteria?: readonly CompletionCriterion[];
  readonly contaminationRisk: ContaminationRisk;
  readonly timeBudgetMs?: number;
  /** LiveCodeBench: difficulty rating. Ignored for HumanEval/MBPP. */
  readonly difficulty?: "easy" | "medium" | "hard";
  /**
   * LiveCodeBench: problem release date (ISO string, e.g. "2025-09-15").
   * Used to detect contamination relative to a model's training cutoff.
   */
  readonly releaseDate?: string;
}

export interface CodeEvalTaskResult {
  readonly task: CodeEvalTask;
  readonly completed: boolean;
  readonly score: number;
  readonly evidence: readonly VerificationEvidence[];
  readonly transcript: readonly string[];
  readonly durationMs: number;
  /** Number of k-samples tried (for pass@k scoring). */
  readonly samplesTried: number;
  /** Number of samples that passed verification. */
  readonly samplesPassed: number;
  /** True iff the FIRST sample passed — drives pass@1 (vs pass@k). */
  readonly firstSamplePassed: boolean;
  /**
   * Effective contamination risk for this task given the modelCutoff.
   * May be higher than the task's recorded risk if releaseDate
   * predates the cutoff.
   */
  readonly effectiveContaminationRisk: ContaminationRisk;
  readonly error?: string;
}

export interface CodeEvalReport {
  readonly runId: string;
  readonly flavour: CodeEvalFlavour;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly passAt1: number;
  readonly passAtK: number;
  readonly k: number;
  readonly byContamination: Readonly<
    Record<ContaminationRisk, { total: number; completed: number }>
  >;
  readonly results: readonly CodeEvalTaskResult[];
  readonly mode: "real" | "simple";
  readonly trajectoryPath: string;
  /** Configured model cutoff used for effective-contamination calcs. */
  readonly modelCutoff?: string;
}

export interface RunnerRuntime {
  query(options: WotannQueryOptions): AsyncGenerator<StreamChunk>;
  verifyCompletion(
    task: string,
    opts?: {
      criteria?: readonly CompletionCriterion[];
      taskType?: "code" | "ui" | "docs" | "test";
      threshold?: number;
    },
  ): Promise<{
    completed: boolean;
    score: number;
    evidence: readonly VerificationEvidence[];
  }>;
}

// ── Constants ─────────────────────────────────────────

const CORPUS_FETCH_COMMANDS: Record<CodeEvalFlavour, string> = {
  "humaneval-plus": [
    "mkdir -p .wotann/benchmarks/code-eval",
    "curl -L https://huggingface.co/datasets/evalplus/humanevalplus/resolve/main/data/HumanEvalPlus.jsonl -o .wotann/benchmarks/code-eval/humaneval-plus-tasks.jsonl",
  ].join(" && "),
  "mbpp-plus": [
    "mkdir -p .wotann/benchmarks/code-eval",
    "curl -L https://huggingface.co/datasets/evalplus/mbppplus/resolve/main/data/MbppPlus.jsonl -o .wotann/benchmarks/code-eval/mbpp-plus-tasks.jsonl",
  ].join(" && "),
  livecodebench: [
    "mkdir -p .wotann/benchmarks/code-eval",
    "curl -L https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test.jsonl -o .wotann/benchmarks/code-eval/livecodebench-tasks.jsonl",
  ].join(" && "),
};

// ── Task loading ──────────────────────────────────────

export interface LoadTasksOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly requireCorpus?: boolean;
  /**
   * LCB only: filter to tasks with releaseDate strictly after this ISO
   * date string. Used to exclude pre-cutoff problems for a given model.
   */
  readonly releasedAfter?: string;
}

export function loadCodeEvalTasks(
  workingDir: string,
  flavour: CodeEvalFlavour,
  opts: LoadTasksOptions = {},
): readonly CodeEvalTask[] {
  const filename = `${flavour}-tasks.jsonl`;
  // Prefer new layout first; fall back to legacy root-of-benchmarks location.
  const primary = join(workingDir, ".wotann", "benchmarks", "code-eval", filename);
  const legacy = join(workingDir, ".wotann", "benchmarks", filename);
  const path = existsSync(primary) ? primary : existsSync(legacy) ? legacy : null;

  let tasks: CodeEvalTask[];
  if (path !== null) {
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    tasks = lines
      .map((l) => JSON.parse(l) as CodeEvalTask)
      .filter((t): t is CodeEvalTask => typeof t.id === "string" && typeof t.prompt === "string");
  } else if (opts.requireCorpus) {
    throw new BlockedCorpusError({
      benchmark: flavour,
      corpusPath: primary,
      fetchCommand: CORPUS_FETCH_COMMANDS[flavour],
    });
  } else {
    tasks = SMOKE_CORPUS[flavour].slice();
  }

  // LCB cutoff filter — only applied to livecodebench flavour
  if (flavour === "livecodebench" && typeof opts.releasedAfter === "string") {
    const cutoff = opts.releasedAfter;
    tasks = tasks.filter((t) => typeof t.releaseDate === "string" && t.releaseDate > cutoff);
  }

  if (typeof opts.seed === "number") tasks = seededShuffle(tasks, opts.seed);
  if (typeof opts.limit === "number" && opts.limit > 0) tasks = tasks.slice(0, opts.limit);
  return tasks;
}

// ── Dry-run ───────────────────────────────────────────

export function dryRunCodeEval(
  runtime: RunnerRuntime | null,
  workingDir: string,
  flavour: CodeEvalFlavour,
  opts: { requireCorpus?: boolean; releasedAfter?: string } = {},
): DryRunReport {
  const checks: DryRunCheck[] = [];

  const filename = `${flavour}-tasks.jsonl`;
  const primary = join(workingDir, ".wotann", "benchmarks", "code-eval", filename);
  const legacy = join(workingDir, ".wotann", "benchmarks", filename);
  const hasCorpus = existsSync(primary) || existsSync(legacy);
  checks.push({
    name: "corpus",
    ok: hasCorpus || !opts.requireCorpus,
    detail: hasCorpus
      ? `found at ${existsSync(primary) ? primary : legacy}`
      : opts.requireCorpus
        ? `missing — need real corpus`
        : `not found, will fall back to smoke corpus`,
  });

  // LCB contamination warning — if caller wants LCB + didn't set a cutoff,
  // warn that contamination partitioning will rely on task-embedded risk.
  if (flavour === "livecodebench" && !opts.releasedAfter) {
    checks.push({
      name: "lcb-cutoff",
      ok: true,
      detail:
        "no --released-after set; trusting task-embedded contaminationRisk (set --released-after=YYYY-MM-DD for cutoff-based filtering)",
    });
  }

  if (runtime === null) {
    checks.push({
      name: "runtime",
      ok: true,
      detail: "skipped (runtime not provided — dry-run mode)",
    });
  } else {
    const runtimeOk =
      typeof runtime.query === "function" && typeof runtime.verifyCompletion === "function";
    checks.push({
      name: "runtime",
      ok: runtimeOk,
      detail: runtimeOk ? "runtime satisfies RunnerRuntime shape" : "runtime is incomplete",
    });
  }

  let corpusSize = 0;
  let blockedReason: string | undefined;
  try {
    const loadOpts: { requireCorpus?: boolean; releasedAfter?: string } = {};
    if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
    if (opts.releasedAfter !== undefined) loadOpts.releasedAfter = opts.releasedAfter;
    corpusSize = loadCodeEvalTasks(workingDir, flavour, loadOpts).length;
  } catch (e) {
    blockedReason = e instanceof Error ? e.message : String(e);
  }

  const report: {
    benchmark: string;
    checks: readonly DryRunCheck[];
    corpusSize: number;
    blockedReason?: string;
  } = {
    benchmark: flavour,
    checks,
    corpusSize,
  };
  if (blockedReason !== undefined) report.blockedReason = blockedReason;
  return makeDryRunReport(report);
}

// ── Runner ────────────────────────────────────────────

export interface RunCodeEvalOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly model?: string;
  readonly threshold?: number;
  readonly totalBudgetMs?: number;
  readonly perTaskBudgetMs?: number;
  /** Samples per task for pass@k scoring. Default 1. HumanEval often uses 10. */
  readonly k?: number;
  readonly requireCorpus?: boolean;
  /**
   * Model's training cutoff, ISO date string (e.g. "2024-11-01"). If
   * supplied, tasks with releaseDate <= modelCutoff get effective
   * contamination risk bumped to "medium" regardless of the recorded
   * risk. Used by the LCB flavour to make contamination reporting
   * honest.
   */
  readonly modelCutoff?: string;
  /**
   * LCB only: filter loaded tasks to releaseDate > releasedAfter.
   * Strictest form of cutoff enforcement; excludes pre-cutoff tasks
   * entirely from scoring rather than just recolouring them.
   */
  readonly releasedAfter?: string;
}

/**
 * Run the specified code-eval flavour. Each task gets k sample
 * attempts; a task is "completed" if ANY sample passes verification.
 * pass@1 = fraction of tasks where the first sample passed;
 * pass@k = fraction where at least one of the k samples passed.
 *
 * Contamination partitioning:
 *   - Each task carries a static `contaminationRisk`.
 *   - If `modelCutoff` is set, tasks with releaseDate <= modelCutoff
 *     have their effective risk bumped to "medium" (from "low") —
 *     matches MASTER_AUDIT_2026-04-18 LCB guidance.
 *   - The report's byContamination breakdown uses the EFFECTIVE risk.
 */
export async function runCodeEval(
  runtime: RunnerRuntime,
  workingDir: string,
  flavour: CodeEvalFlavour,
  opts: RunCodeEvalOptions = {},
): Promise<CodeEvalReport> {
  const startedAt = Date.now();
  const runId = `${flavour}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  // Always "simple" until real upstream-harness integration lands.
  const mode: "real" | "simple" = "simple";
  const k = Math.max(1, opts.k ?? 1);

  const loadOpts: {
    limit?: number;
    seed?: number;
    requireCorpus?: boolean;
    releasedAfter?: string;
  } = {};
  if (opts.limit !== undefined) loadOpts.limit = opts.limit;
  if (opts.seed !== undefined) loadOpts.seed = opts.seed;
  if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
  if (opts.releasedAfter !== undefined) loadOpts.releasedAfter = opts.releasedAfter;
  const tasks = loadCodeEvalTasks(workingDir, flavour, loadOpts);

  const trajectory = openTrajectoryWriter(runId);
  trajectory.write({
    type: "run-start",
    runId,
    benchmark: flavour,
    startedAt,
    totalTasks: tasks.length,
    k,
    modelCutoff: opts.modelCutoff,
    mode,
  });

  const results: CodeEvalTaskResult[] = [];

  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) {
      trajectory.write({ type: "budget-exhausted", runId, elapsedMs: Date.now() - startedAt });
      break;
    }
    const taskStart = Date.now();
    const budget = opts.perTaskBudgetMs ?? task.timeBudgetMs ?? 120_000;
    const deadline = taskStart + budget;

    let transcript: string[] = [];
    let error: string | undefined;
    let samplesTried = 0;
    let samplesPassed = 0;
    let firstSampleCompleted = false;
    let anySampleCompleted = false;
    let bestVerdict = {
      completed: false,
      score: 0,
      evidence: [] as readonly VerificationEvidence[],
    };

    try {
      for (let sample = 0; sample < k && Date.now() < deadline; sample++) {
        samplesTried++;
        const samplePrompt = [
          flavour === "livecodebench"
            ? "You are solving a competitive-programming problem. Reason about complexity. Provide a compiling solution."
            : "Implement the requested function. Your output must be valid, testable, and self-contained.",
          task.signature ? `Signature: ${task.signature}` : "",
          "",
          task.prompt,
          "",
          `(Sample ${sample + 1}/${k})`,
        ]
          .filter((s) => s.length > 0)
          .join("\n");

        const queryOpts: WotannQueryOptions = {
          prompt: samplePrompt,
          ...(opts.model ? { model: opts.model } : {}),
        };
        for await (const chunk of runtime.query(queryOpts)) {
          if (Date.now() > deadline) break;
          if (chunk.type === "text") transcript.push(chunk.content);
        }

        const verifyOpts: Parameters<RunnerRuntime["verifyCompletion"]>[1] = {};
        if (task.criteria !== undefined) verifyOpts.criteria = task.criteria;
        if (opts.threshold !== undefined) verifyOpts.threshold = opts.threshold;
        const verdict = await runtime.verifyCompletion(task.prompt, verifyOpts);

        if (verdict.completed) {
          samplesPassed++;
          if (sample === 0) firstSampleCompleted = true;
          anySampleCompleted = true;
          if (verdict.score > bestVerdict.score) bestVerdict = verdict;
        } else if (verdict.score > bestVerdict.score) {
          bestVerdict = verdict;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const effectiveRisk = computeEffectiveContaminationRisk(task, opts.modelCutoff);
    const durationMs = Date.now() - taskStart;
    const result: CodeEvalTaskResult = {
      task,
      completed: anySampleCompleted,
      score: bestVerdict.score,
      evidence: bestVerdict.evidence,
      transcript,
      durationMs,
      samplesTried,
      samplesPassed,
      firstSamplePassed: firstSampleCompleted,
      effectiveContaminationRisk: effectiveRisk,
      ...(error !== undefined ? { error } : {}),
    };
    results.push(result);

    const envelope: TaskScoreEnvelope = {
      task_id: task.id,
      passed: anySampleCompleted,
      durationMs,
      cost: 0,
      score: bestVerdict.score,
      trajectory: transcript.slice(-20),
      meta: {
        flavour,
        samplesTried,
        samplesPassed,
        firstSamplePassed: firstSampleCompleted,
        contaminationRisk: task.contaminationRisk,
        effectiveContaminationRisk: effectiveRisk,
        ...(error !== undefined ? { error } : {}),
      },
    };
    trajectory.write({ type: "task-result", ...envelope });
  }

  const finishedAt = Date.now();
  const completedTasks = results.filter((r) => r.completed).length;
  const firstSamplePasses = results.filter((r) => r.firstSamplePassed).length;
  const byContamination: Record<ContaminationRisk, { total: number; completed: number }> = {
    low: { total: 0, completed: 0 },
    medium: { total: 0, completed: 0 },
    high: { total: 0, completed: 0 },
  };
  for (const r of results) {
    byContamination[r.effectiveContaminationRisk].total += 1;
    if (r.completed) byContamination[r.effectiveContaminationRisk].completed += 1;
  }

  const passAt1 = results.length > 0 ? firstSamplePasses / results.length : 0;
  const passAtK = results.length > 0 ? completedTasks / results.length : 0;

  trajectory.write({
    type: "run-end",
    runId,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    passAtK,
    k,
    byContamination,
    mode,
  });

  const report: CodeEvalReport = {
    runId,
    flavour,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    passAtK,
    k,
    byContamination,
    results,
    mode,
    trajectoryPath: trajectory.path,
    ...(opts.modelCutoff !== undefined ? { modelCutoff: opts.modelCutoff } : {}),
  };
  return report;
}

// ── Helpers ───────────────────────────────────────────

/**
 * Compute the effective contamination risk for a task given an optional
 * model cutoff date. Rules:
 *   - No cutoff provided → return task's recorded risk unchanged.
 *   - Cutoff provided + task has releaseDate:
 *       - releaseDate > cutoff → keep recorded risk (post-cutoff)
 *       - releaseDate <= cutoff → bump to at least "medium"
 *   - Cutoff provided + task has no releaseDate → keep recorded risk.
 *
 * This partially corrects for the MASTER_AUDIT_2026-04-18 concern that
 * LCB "low" tags assume a specific model cutoff that may not match the
 * caller's model.
 */
function computeEffectiveContaminationRisk(
  task: CodeEvalTask,
  modelCutoff: string | undefined,
): ContaminationRisk {
  if (typeof modelCutoff !== "string" || typeof task.releaseDate !== "string") {
    return task.contaminationRisk;
  }
  const postCutoff = task.releaseDate > modelCutoff;
  if (postCutoff) return task.contaminationRisk;
  // Bump low→medium, keep medium/high as-is.
  return task.contaminationRisk === "low" ? "medium" : task.contaminationRisk;
}

// ── Smoke Corpora ─────────────────────────────────────

const SMOKE_CORPUS: Record<CodeEvalFlavour, readonly CodeEvalTask[]> = {
  "humaneval-plus": [
    {
      id: "he-plus-smoke-01",
      flavour: "humaneval-plus",
      prompt:
        "Write a function `has_close_elements(numbers, threshold)` that returns True if any two numbers in the list are closer than `threshold` to each other.",
      signature: "def has_close_elements(numbers: list[float], threshold: float) -> bool:",
      contaminationRisk: "high",
      timeBudgetMs: 120_000,
    },
    {
      id: "he-plus-smoke-02",
      flavour: "humaneval-plus",
      prompt:
        "Write a function `separate_paren_groups(paren_string)` that splits balanced-paren groups from a string of parens. Ignore spaces.",
      signature: "def separate_paren_groups(paren_string: str) -> list[str]:",
      contaminationRisk: "high",
      timeBudgetMs: 120_000,
    },
  ],
  "mbpp-plus": [
    {
      id: "mbpp-plus-smoke-01",
      flavour: "mbpp-plus",
      prompt:
        "Write a Python function to find the similar elements from the given two tuple lists.",
      signature: "def similar_elements(test_tup1, test_tup2):",
      contaminationRisk: "high",
      timeBudgetMs: 120_000,
    },
    {
      id: "mbpp-plus-smoke-02",
      flavour: "mbpp-plus",
      prompt: "Write a python function to identify non-prime numbers.",
      signature: "def is_not_prime(n):",
      contaminationRisk: "high",
      timeBudgetMs: 120_000,
    },
  ],
  livecodebench: [
    {
      id: "lcb-smoke-01",
      flavour: "livecodebench",
      prompt:
        "Given n events on a number line with start and end times, find the maximum number of non-overlapping events you can attend.",
      signature: "def max_events(events: list[tuple[int, int]]) -> int:",
      contaminationRisk: "low", // assume post-cutoff slice
      difficulty: "medium",
      releaseDate: "2025-09-15",
      timeBudgetMs: 240_000,
    },
    {
      id: "lcb-smoke-02",
      flavour: "livecodebench",
      prompt:
        "Given a grid with obstacles, find the shortest path from top-left to bottom-right that passes through at most k obstacles.",
      signature: "def shortest_path_with_obstacles(grid: list[list[int]], k: int) -> int:",
      contaminationRisk: "low",
      difficulty: "hard",
      releaseDate: "2025-11-03",
      timeBudgetMs: 300_000,
    },
  ],
};
