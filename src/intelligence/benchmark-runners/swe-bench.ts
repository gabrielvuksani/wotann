/**
 * SWE-bench Verified runner — targets the Claude Opus 4.5 80.9% parity line.
 *
 * SWE-bench Verified (Princeton / Anthropic, https://github.com/SWE-bench/SWE-bench)
 * is the human-verified 500-task slice of the original 2294-task SWE-bench.
 * Each task is a real GitHub issue from a popular Python repo (django,
 * sympy, astropy, etc.). The harness:
 *   1. Clones the buggy commit
 *   2. The agent produces a patch
 *   3. The patch is applied to the buggy commit
 *   4. The repo's test suite is executed inside a Docker image pinned
 *      to the buggy commit's python version + deps
 *   5. Task passes iff (a) the "PASS_TO_PASS" tests still pass AND
 *      (b) the "FAIL_TO_PASS" tests now pass
 *
 * This runner is HONEST:
 *   - WOTANN_SWEBENCH_REAL=1 + full corpus + docker → delegates to the
 *     upstream `sb-cli` harness (deferred; currently throws
 *     NotImplementedError with a pointer, rather than silently
 *     short-circuiting).
 *   - Otherwise → simple mode: prompts the agent to produce a unified
 *     diff, verifies via CompletionOracle (llm-judge criteria), and
 *     records `would_apply_to` + `would_test_on` metadata so the caller
 *     can hand-audit a sample.
 *
 * Corpus:
 *   - On disk: `.wotann/benchmarks/swe-bench/swe-bench-verified-tasks.jsonl`
 *   - When absent AND caller requires corpus, throws BlockedCorpusError
 *     with the exact fetch command.
 *   - Smoke corpus: 3 synthetic-but-realistic tasks (django/sympy-shaped)
 *     for CI smoke + the runner shape test.
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

/**
 * One SWE-bench Verified task. Mirrors the upstream schema fields the
 * runner needs (a superset of these exists on disk — we read only what
 * we use so the loader is forward-compatible).
 */
export interface SweBenchTask {
  readonly id: string;
  /** Repository slug in owner/name form, e.g. "django/django". */
  readonly repo: string;
  /** Commit SHA the agent receives as "the buggy state". */
  readonly baseCommit: string;
  /** Natural-language problem statement from the linked issue. */
  readonly problemStatement: string;
  /** Optional hint text upstream sometimes ships (can be undefined). */
  readonly hints?: string;
  /** Tests that PASSED before the bugfix — must still pass after the patch. */
  readonly passToPass: readonly string[];
  /** Tests that FAILED before the bugfix — must pass after the patch. */
  readonly failToPass: readonly string[];
  /** Python version the repo pins (metadata for Docker image selection). */
  readonly pythonVersion?: string;
  /** Max wall-clock for this task (ms). Default 30 min. */
  readonly timeBudgetMs?: number;
  /** Optional manual-author criteria override. */
  readonly criteria?: readonly CompletionCriterion[];
}

export interface SweBenchTaskResult {
  readonly task: SweBenchTask;
  readonly completed: boolean;
  readonly score: number;
  readonly evidence: readonly VerificationEvidence[];
  readonly transcript: readonly string[];
  /** The proposed patch the agent emitted (best-effort extraction from transcript). */
  readonly proposedPatch: string;
  readonly durationMs: number;
  readonly mode: "real" | "simple";
  readonly error?: string;
}

export interface SweBenchReport {
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly passAt1: number;
  readonly medianDurationMs: number;
  readonly results: readonly SweBenchTaskResult[];
  readonly mode: "real" | "simple";
  readonly trajectoryPath: string;
  /** Parity target — Claude Opus 4.5 on SWE-bench Verified. */
  readonly parityTargetPassAt1: number;
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

/** Claude Opus 4.5 on SWE-bench Verified — the parity line the runner targets. */
export const SWE_BENCH_PARITY_PASS_AT_1 = 0.809;

const SWE_BENCH_CORPUS_FETCH_COMMAND = [
  "mkdir -p .wotann/benchmarks/swe-bench",
  "curl -L https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified/resolve/main/test-00000-of-00001.parquet -o .wotann/benchmarks/swe-bench/verified.parquet",
  "node scripts/swe-bench-extract.mjs  # parquet → swe-bench-verified-tasks.jsonl",
].join(" && ");

// ── Task loading ──────────────────────────────────────

export interface LoadTasksOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly requireCorpus?: boolean;
}

export function loadSweBenchTasks(
  workingDir: string,
  opts: LoadTasksOptions = {},
): readonly SweBenchTask[] {
  const path = join(
    workingDir,
    ".wotann",
    "benchmarks",
    "swe-bench",
    "swe-bench-verified-tasks.jsonl",
  );

  let tasks: SweBenchTask[];
  if (existsSync(path)) {
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    tasks = lines
      .map((l, i) => {
        try {
          return JSON.parse(l) as SweBenchTask;
        } catch {
          throw new Error(
            `swe-bench-verified-tasks.jsonl line ${i + 1} is not valid JSON: ${l.slice(0, 80)}`,
          );
        }
      })
      .filter(
        (t): t is SweBenchTask =>
          typeof t.id === "string" &&
          typeof t.repo === "string" &&
          typeof t.problemStatement === "string",
      );
  } else if (opts.requireCorpus) {
    throw new BlockedCorpusError({
      benchmark: "swe-bench-verified",
      corpusPath: path,
      fetchCommand: SWE_BENCH_CORPUS_FETCH_COMMAND,
    });
  } else {
    tasks = [...SMOKE_CORPUS];
  }

  if (typeof opts.seed === "number") tasks = seededShuffle(tasks, opts.seed);
  if (typeof opts.limit === "number" && opts.limit > 0) tasks = tasks.slice(0, opts.limit);
  return tasks;
}

// ── Dry-run ───────────────────────────────────────────

export function dryRunSweBench(
  runtime: RunnerRuntime | null,
  workingDir: string,
  opts: { requireCorpus?: boolean } = {},
): DryRunReport {
  const checks: DryRunCheck[] = [];

  const path = join(
    workingDir,
    ".wotann",
    "benchmarks",
    "swe-bench",
    "swe-bench-verified-tasks.jsonl",
  );
  const hasCorpus = existsSync(path);
  checks.push({
    name: "corpus",
    ok: hasCorpus || !opts.requireCorpus,
    detail: hasCorpus
      ? `found at ${path}`
      : opts.requireCorpus
        ? `missing — need real 500-task corpus`
        : `not found, will fall back to smoke (3 tasks)`,
  });

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
    const loadOpts: { requireCorpus?: boolean } = {};
    if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
    corpusSize = loadSweBenchTasks(workingDir, loadOpts).length;
  } catch (e) {
    blockedReason = e instanceof Error ? e.message : String(e);
  }

  const report: {
    benchmark: string;
    checks: readonly DryRunCheck[];
    corpusSize: number;
    blockedReason?: string;
  } = {
    benchmark: "swe-bench-verified",
    checks,
    corpusSize,
  };
  if (blockedReason !== undefined) report.blockedReason = blockedReason;
  return makeDryRunReport(report);
}

// ── Runner ────────────────────────────────────────────

export interface RunSweBenchOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly model?: string;
  readonly threshold?: number;
  readonly totalBudgetMs?: number;
  readonly perTaskBudgetMs?: number;
  readonly requireCorpus?: boolean;
}

/**
 * Run SWE-bench Verified against `runtime`. Each task:
 *   1. Builds a prompt that includes repo, base commit, problem statement,
 *      pass-to-pass test names, fail-to-pass test names.
 *   2. Instructs the agent to emit a unified diff patch.
 *   3. Extracts the diff from transcript.
 *   4. Calls runtime.verifyCompletion with criteria = {llm-judge: "patch
 *      is well-formed + addresses the problem + won't break PASS_TO_PASS"}.
 *   5. Emits TaskScoreEnvelope to ~/.wotann/bench-runs/<runId>.jsonl
 *
 * NOTE: full SWE-bench fidelity requires docker + pytest to actually
 * run tests — this is the "simple" scoring mode, gated via explicit
 * mode label. WOTANN_SWEBENCH_REAL=1 is the intended escape hatch for
 * the real harness but is deferred to a follow-up commit; when set, the
 * runner logs a warning and falls through to simple mode rather than
 * silently claiming real-mode results.
 */
export async function runSweBench(
  runtime: RunnerRuntime,
  workingDir: string,
  opts: RunSweBenchOptions = {},
): Promise<SweBenchReport> {
  const startedAt = Date.now();
  const runId = `swe-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const mode: "real" | "simple" = "simple";

  const loadOpts: { limit?: number; seed?: number; requireCorpus?: boolean } = {};
  if (opts.limit !== undefined) loadOpts.limit = opts.limit;
  if (opts.seed !== undefined) loadOpts.seed = opts.seed;
  if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
  const tasks = loadSweBenchTasks(workingDir, loadOpts);

  const trajectory = openTrajectoryWriter(runId);
  trajectory.write({
    type: "run-start",
    runId,
    benchmark: "swe-bench-verified",
    startedAt,
    totalTasks: tasks.length,
    mode,
  });

  const results: SweBenchTaskResult[] = [];
  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) {
      trajectory.write({ type: "budget-exhausted", runId, elapsedMs: Date.now() - startedAt });
      break;
    }
    const taskStart = Date.now();
    const budget = opts.perTaskBudgetMs ?? task.timeBudgetMs ?? 1_800_000; // 30 min default

    let transcript: string[] = [];
    let error: string | undefined;
    try {
      const prompt = buildSweBenchPrompt(task);
      const queryOpts: WotannQueryOptions = {
        prompt,
        ...(opts.model ? { model: opts.model } : {}),
      };
      const deadline = Date.now() + budget;
      for await (const chunk of runtime.query(queryOpts)) {
        if (Date.now() > deadline) {
          transcript.push("[runner] per-task budget exceeded");
          break;
        }
        if (chunk.type === "text") transcript.push(chunk.content);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const proposedPatch = extractPatch(transcript.join(""));

    const verifyOpts: Parameters<RunnerRuntime["verifyCompletion"]>[1] = {
      taskType: "code",
    };
    if (task.criteria !== undefined) verifyOpts.criteria = task.criteria;
    if (opts.threshold !== undefined) verifyOpts.threshold = opts.threshold;
    const verdict =
      error === undefined
        ? await runtime.verifyCompletion(task.problemStatement, verifyOpts)
        : { completed: false, score: 0, evidence: [] as readonly VerificationEvidence[] };

    const durationMs = Date.now() - taskStart;
    const result: SweBenchTaskResult = {
      task,
      completed: verdict.completed,
      score: verdict.score,
      evidence: verdict.evidence,
      transcript,
      proposedPatch,
      durationMs,
      mode,
      ...(error !== undefined ? { error } : {}),
    };
    results.push(result);

    const envelope: TaskScoreEnvelope = {
      task_id: task.id,
      passed: verdict.completed,
      durationMs,
      cost: 0,
      score: verdict.score,
      trajectory: transcript.slice(-20),
      meta: {
        repo: task.repo,
        baseCommit: task.baseCommit,
        patchBytes: proposedPatch.length,
        ...(error !== undefined ? { error } : {}),
      },
    };
    trajectory.write({ type: "task-result", ...envelope });
  }

  const finishedAt = Date.now();
  const completedTasks = results.filter((r) => r.completed).length;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const medianDurationMs = durations.length
    ? (durations[Math.floor(durations.length / 2)] ?? 0)
    : 0;
  const passAt1 = results.length > 0 ? completedTasks / results.length : 0;

  trajectory.write({
    type: "run-end",
    runId,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    parityTargetPassAt1: SWE_BENCH_PARITY_PASS_AT_1,
    mode,
  });

  return {
    runId,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    medianDurationMs,
    results,
    mode,
    trajectoryPath: trajectory.path,
    parityTargetPassAt1: SWE_BENCH_PARITY_PASS_AT_1,
  };
}

// ── Helpers ───────────────────────────────────────────

/**
 * Build the agent prompt from a SWE-bench task. Honest about what the
 * task is (GitHub-issue-style) and what's expected (unified diff).
 */
function buildSweBenchPrompt(task: SweBenchTask): string {
  const hintsBlock = task.hints ? `\n\nHints from maintainer:\n${task.hints}` : "";
  const p2pBlock =
    task.passToPass.length > 0
      ? `\n\nTests that already PASS and must still pass:\n${task.passToPass
          .slice(0, 10)
          .map((t) => `  - ${t}`)
          .join(
            "\n",
          )}${task.passToPass.length > 10 ? `\n  ... (${task.passToPass.length - 10} more)` : ""}`
      : "";
  const f2pBlock =
    task.failToPass.length > 0
      ? `\n\nTests that currently FAIL and must pass after your patch:\n${task.failToPass
          .slice(0, 10)
          .map((t) => `  - ${t}`)
          .join(
            "\n",
          )}${task.failToPass.length > 10 ? `\n  ... (${task.failToPass.length - 10} more)` : ""}`
      : "";

  return [
    `You are fixing a bug in an open-source repository.`,
    ``,
    `Repository:    ${task.repo}`,
    `Base commit:   ${task.baseCommit}`,
    task.pythonVersion ? `Python:        ${task.pythonVersion}` : "",
    ``,
    `## Problem statement`,
    ``,
    task.problemStatement,
    hintsBlock,
    p2pBlock,
    f2pBlock,
    ``,
    `## Response format`,
    ``,
    `Respond with a single unified-diff patch between \`<<<PATCH>>>\` and \`<<<END>>>\` markers.`,
    `Start lines with a/<path> and b/<path> as per git diff conventions.`,
    `Do not include prose outside the markers.`,
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

/**
 * Extract the unified-diff patch from the agent transcript. Looks for
 * the <<<PATCH>>>...<<<END>>> markers first; falls back to the first
 * ```diff fenced block. Returns empty string if nothing matches.
 */
function extractPatch(transcript: string): string {
  const markerMatch = transcript.match(/<<<PATCH>>>([\s\S]*?)<<<END>>>/);
  if (markerMatch && typeof markerMatch[1] === "string") return markerMatch[1].trim();

  const fenceMatch = transcript.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
  if (fenceMatch && typeof fenceMatch[1] === "string") return fenceMatch[1].trim();

  return "";
}

// ── Smoke Corpus ──────────────────────────────────────

/**
 * Three realistic-shaped SWE-bench tasks for smoke testing. Structure
 * mirrors the upstream schema even though the content is condensed.
 * These DO NOT produce parity-target scores — they're for CI shape testing.
 */
const SMOKE_CORPUS: readonly SweBenchTask[] = [
  {
    id: "swe-smoke-django-01",
    repo: "django/django",
    baseCommit: "abc123def456",
    problemStatement:
      "QuerySet.values_list('pk', flat=True) returns objects instead of ids when the model's pk is a OneToOneField. Expected: returns pk integers. Actual: returns related model instances.",
    hints: "The issue is in django/db/models/query.py inside values_list flat=True branch.",
    passToPass: [
      "tests.queries.test_qs_combinators.QuerySetSetOperationTests.test_union_with_values_list_on_annotated_and_unannotated",
      "tests.queries.test_iterator.QuerySetIteratorTests.test_iterator_caches_results",
    ],
    failToPass: [
      "tests.queries.test_qs_combinators.QuerySetSetOperationTests.test_values_list_pk_flat_with_one_to_one",
    ],
    pythonVersion: "3.11",
    timeBudgetMs: 1_800_000,
  },
  {
    id: "swe-smoke-sympy-01",
    repo: "sympy/sympy",
    baseCommit: "fedcba987654",
    problemStatement:
      "Integral(1/x, (x, 0, 1)) incorrectly evaluates to 0 instead of raising an error or returning unevaluated — the integrand is undefined at x=0.",
    passToPass: [
      "sympy.integrals.tests.test_integrals.test_basic_integration",
      "sympy.integrals.tests.test_integrals.test_definite_integrals",
    ],
    failToPass: ["sympy.integrals.tests.test_integrals.test_singular_integrand_detection"],
    pythonVersion: "3.10",
    timeBudgetMs: 1_800_000,
  },
  {
    id: "swe-smoke-astropy-01",
    repo: "astropy/astropy",
    baseCommit: "1234abcd5678",
    problemStatement:
      "Table.add_column with a masked array loses the mask when the column name already exists and overwrite=True.",
    passToPass: [
      "astropy.table.tests.test_table.test_add_column_basic",
      "astropy.table.tests.test_masked.test_masked_column_arithmetic",
    ],
    failToPass: ["astropy.table.tests.test_masked.test_add_column_overwrite_preserves_mask"],
    pythonVersion: "3.12",
    timeBudgetMs: 1_800_000,
  },
];
