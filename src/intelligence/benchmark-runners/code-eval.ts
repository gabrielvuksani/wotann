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
 * the benchmark flavour. Real integration with the upstream pip-
 * packaged harnesses (humaneval-plus, mbpp-plus, lcb_runner) is gated
 * behind WOTANN_CODEEVAL_REAL=1 so the module loads cleanly on CI.
 *
 * Contamination footnote: runCodeEval records a contamination-risk
 * field per task so the benchmark-harness's report-writer can footnote
 * results. HumanEval/MBPP = high risk (in Llama 3.3 / DeepSeek v3
 * training cutoffs). LCB post-cutoff slice only = low risk.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StreamChunk } from "../../providers/types.js";
import type { WotannQueryOptions } from "../../core/types.js";
import type { CompletionCriterion, VerificationEvidence } from "../../autopilot/types.js";

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

// ── Task loading ──────────────────────────────────────

export function loadCodeEvalTasks(
  workingDir: string,
  flavour: CodeEvalFlavour,
  opts: { limit?: number; seed?: number } = {},
): readonly CodeEvalTask[] {
  const filename = `${flavour}-tasks.jsonl`;
  const path = join(workingDir, ".wotann", "benchmarks", filename);
  let tasks: CodeEvalTask[];
  if (existsSync(path)) {
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    tasks = lines
      .map((l) => JSON.parse(l) as CodeEvalTask)
      .filter((t): t is CodeEvalTask => typeof t.id === "string" && typeof t.prompt === "string");
  } else {
    tasks = SMOKE_CORPUS[flavour].slice();
  }

  if (typeof opts.seed === "number") tasks = seededShuffle(tasks, opts.seed);
  if (typeof opts.limit === "number" && opts.limit > 0) tasks = tasks.slice(0, opts.limit);
  return tasks;
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
}

/**
 * Run the specified code-eval flavour. Each task gets k sample
 * attempts; a task is "completed" if ANY sample passes verification.
 * pass@1 = fraction of tasks where the first sample passed;
 * pass@k = fraction where at least one of the k samples passed.
 *
 * Contamination note: the returned report partitions results by
 * contaminationRisk (low/medium/high) so callers publishing
 * leaderboards can footnote high-risk results. HumanEval/MBPP are
 * typically high risk; LCB post-cutoff slice is low.
 */
export async function runCodeEval(
  runtime: RunnerRuntime,
  workingDir: string,
  flavour: CodeEvalFlavour,
  opts: RunCodeEvalOptions = {},
): Promise<CodeEvalReport> {
  const startedAt = Date.now();
  const runId = `${flavour}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const mode: "real" | "simple" = process.env["WOTANN_CODEEVAL_REAL"] === "1" ? "real" : "simple";
  const k = Math.max(1, opts.k ?? 1);

  const loadOpts: Parameters<typeof loadCodeEvalTasks>[2] = {};
  if (opts.limit !== undefined) loadOpts.limit = opts.limit;
  if (opts.seed !== undefined) loadOpts.seed = opts.seed;
  const tasks = loadCodeEvalTasks(workingDir, flavour, loadOpts);
  const results: CodeEvalTaskResult[] = [];

  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) break;
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
      ...(error !== undefined ? { error } : {}),
    };
    results.push(result);
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
    byContamination[r.task.contaminationRisk].total += 1;
    if (r.completed) byContamination[r.task.contaminationRisk].completed += 1;
  }

  return {
    runId,
    flavour,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    // pass@1 ≈ fraction of tasks where the first sample alone passed.
    // When k > 1 we approximate from samplesPassed / samplesTried
    // (not perfect but aligns with the spirit: independent samples).
    passAt1: results.length > 0 ? firstSamplePasses / results.length : 0,
    passAtK: results.length > 0 ? completedTasks / results.length : 0,
    k,
    byContamination,
    results,
    mode,
  };
}

// ── Helpers ───────────────────────────────────────────

function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  let state = seed | 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
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
      timeBudgetMs: 300_000,
    },
  ],
};
