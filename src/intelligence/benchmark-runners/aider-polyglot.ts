/**
 * Aider Polyglot benchmark runner — enhanced for 225-problem full corpus +
 * 2-attempt scoring as specified by Aider's leaderboard rules.
 *
 * Aider's Polyglot leaderboard (https://aider.chat/docs/leaderboards/)
 * measures coding-task pass-rate across ~6 languages (Python, JavaScript,
 * Rust, Go, C++, Java) with per-language test-harness pass/fail verdicts.
 * Parity target: Refact.ai leads at 92.9% (2-attempt) as of Apr 2026.
 *
 * Scoring rules (per Aider spec):
 *   - Each problem gets at most 2 attempts
 *   - Attempt 1: diff-edit (compact, targeted)
 *   - On attempt-1 failure: whole-file fallback (attempt 2)
 *   - Task passes iff either attempt passes the test harness
 *   - pass@1 = attempt-1-only passes / total
 *   - pass@2 (Aider-official) = ANY attempt passes / total
 *
 * This runner ships:
 *   - loadAiderPolyglotTasks + BlockedCorpusError for the 225-task corpus
 *   - runAiderPolyglot with configurable diffEditAttempts (default 1 — i.e.
 *     single diff-edit before fallback, matching Aider's 2-attempt spec)
 *   - Per-task + per-language breakdown in the report
 *   - Trajectory JSONL emit
 *   - Dry-run validation
 *
 * Real integration with the `aider-chat` pip package is deferred behind
 * WOTANN_AIDER_REAL=1 — currently falls through to simple-mode with mode:
 * "simple" in the report (never silent lies).
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

export type AiderLanguage = "python" | "javascript" | "rust" | "go" | "cpp" | "java";

export interface AiderPolyglotTask {
  readonly id: string;
  readonly language: AiderLanguage;
  readonly prompt: string;
  readonly starterFile?: string; // e.g. "src/main.py"
  readonly testCommand?: string; // e.g. "pytest -x"
  readonly expectedBehavior?: string;
  readonly criteria?: readonly CompletionCriterion[];
  readonly timeBudgetMs?: number;
}

export interface AiderPolyglotTaskResult {
  readonly task: AiderPolyglotTask;
  readonly completed: boolean;
  readonly score: number;
  readonly evidence: readonly VerificationEvidence[];
  readonly transcript: readonly string[];
  readonly durationMs: number;
  readonly usedWholeFileFallback: boolean;
  readonly diffEditAttempts: number;
  /** Did the FIRST diff-edit attempt pass? (drives pass@1 vs pass@2 scoring). */
  readonly passedFirstAttempt: boolean;
  readonly error?: string;
}

export interface AiderPolyglotReport {
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  /** pass@1 — first attempt only. */
  readonly passAt1: number;
  /** pass@2 — ANY of the 2 attempts (Aider-official headline metric). */
  readonly passAt2: number;
  readonly byLanguage: Readonly<Record<AiderLanguage, { total: number; completed: number }>>;
  readonly results: readonly AiderPolyglotTaskResult[];
  readonly mode: "real" | "simple";
  readonly trajectoryPath: string;
  /** Parity target (Refact.ai leads at 92.9% pass@2 as of Apr 2026). */
  readonly parityTargetPassAt2: number;
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

/** Refact.ai on Aider Polyglot pass@2 — the parity line the runner targets. */
export const AIDER_POLYGLOT_PARITY_PASS_AT_2 = 0.929;

/** Expected full-corpus size. */
export const AIDER_POLYGLOT_FULL_CORPUS_SIZE = 225;

const AIDER_POLYGLOT_CORPUS_FETCH_COMMAND = [
  "mkdir -p .wotann/benchmarks/aider-polyglot",
  "git clone --depth 1 https://github.com/Aider-AI/polyglot-benchmark .wotann/benchmarks/aider-polyglot/src",
  "node scripts/aider-polyglot-extract.mjs  # produces aider-polyglot-tasks.jsonl",
].join(" && ");

// ── Task loading ──────────────────────────────────────

export interface LoadTasksOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly languages?: readonly AiderLanguage[];
  readonly requireCorpus?: boolean;
}

export function loadAiderPolyglotTasks(
  workingDir: string,
  opts: LoadTasksOptions = {},
): readonly AiderPolyglotTask[] {
  const primary = join(
    workingDir,
    ".wotann",
    "benchmarks",
    "aider-polyglot",
    "aider-polyglot-tasks.jsonl",
  );
  const legacy = join(workingDir, ".wotann", "benchmarks", "aider-polyglot-tasks.jsonl");
  const path = existsSync(primary) ? primary : existsSync(legacy) ? legacy : null;

  let tasks: AiderPolyglotTask[];
  if (path !== null) {
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    tasks = lines
      .map((l) => JSON.parse(l) as AiderPolyglotTask)
      .filter(
        (t): t is AiderPolyglotTask =>
          typeof t.id === "string" &&
          typeof t.prompt === "string" &&
          typeof t.language === "string",
      );
  } else if (opts.requireCorpus) {
    throw new BlockedCorpusError({
      benchmark: "aider-polyglot",
      corpusPath: primary,
      fetchCommand: AIDER_POLYGLOT_CORPUS_FETCH_COMMAND,
    });
  } else {
    tasks = [...SMOKE_CORPUS];
  }

  if (opts.languages && opts.languages.length > 0) {
    const allowed = new Set(opts.languages);
    tasks = tasks.filter((t) => allowed.has(t.language));
  }

  if (typeof opts.seed === "number") tasks = seededShuffle(tasks, opts.seed);
  if (typeof opts.limit === "number" && opts.limit > 0) tasks = tasks.slice(0, opts.limit);
  return tasks;
}

// ── Dry-run ───────────────────────────────────────────

export function dryRunAiderPolyglot(
  runtime: RunnerRuntime | null,
  workingDir: string,
  opts: { requireCorpus?: boolean } = {},
): DryRunReport {
  const checks: DryRunCheck[] = [];

  const primary = join(
    workingDir,
    ".wotann",
    "benchmarks",
    "aider-polyglot",
    "aider-polyglot-tasks.jsonl",
  );
  const legacy = join(workingDir, ".wotann", "benchmarks", "aider-polyglot-tasks.jsonl");
  const hasCorpus = existsSync(primary) || existsSync(legacy);
  checks.push({
    name: "corpus",
    ok: hasCorpus || !opts.requireCorpus,
    detail: hasCorpus
      ? `found at ${existsSync(primary) ? primary : legacy}`
      : opts.requireCorpus
        ? `missing — need full ${AIDER_POLYGLOT_FULL_CORPUS_SIZE}-problem corpus`
        : `not found, will fall back to smoke corpus`,
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
    corpusSize = loadAiderPolyglotTasks(workingDir, loadOpts).length;
  } catch (e) {
    blockedReason = e instanceof Error ? e.message : String(e);
  }

  // Warn if on-disk corpus is smaller than the official 225 problems
  // (likely a partial extract or outdated checkout).
  if (corpusSize > 0 && corpusSize < AIDER_POLYGLOT_FULL_CORPUS_SIZE && hasCorpus) {
    checks.push({
      name: "corpus-size",
      ok: false,
      detail: `corpus has ${corpusSize} tasks, official is ${AIDER_POLYGLOT_FULL_CORPUS_SIZE} — rerun the extract script`,
    });
  }

  const report: {
    benchmark: string;
    checks: readonly DryRunCheck[];
    corpusSize: number;
    blockedReason?: string;
  } = {
    benchmark: "aider-polyglot",
    checks,
    corpusSize,
  };
  if (blockedReason !== undefined) report.blockedReason = blockedReason;
  return makeDryRunReport(report);
}

// ── Runner ────────────────────────────────────────────

export interface RunAiderPolyglotOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly languages?: readonly AiderLanguage[];
  readonly model?: string;
  readonly threshold?: number;
  readonly totalBudgetMs?: number;
  readonly perTaskBudgetMs?: number;
  /**
   * Number of diff-edit attempts before whole-file fallback.
   * Aider's official 2-attempt spec = `diffEditAttempts: 1` (one diff
   * then one whole-file fallback). Default 1 to match the leaderboard.
   * Set higher for research / ablation runs.
   */
  readonly diffEditAttempts?: number;
  readonly requireCorpus?: boolean;
}

/**
 * Aider's signature strategy: try diff-edit first (compact, targeted),
 * fall back to whole-file rewrite after N failed diff-edit attempts.
 * This runner simulates that pattern at the prompt level — the first
 * attempt instructs the agent to respond with a diff-edit hunk; if the
 * verifier fails, retry instructs the agent to respond with the full
 * revised file.
 *
 * Tracks passedFirstAttempt per task so pass@1 vs pass@2 breakdowns are
 * accurate (Aider's headline is pass@2 — any attempt passing). Real
 * integration with the aider-chat pip package is gated via
 * WOTANN_AIDER_REAL=1 and currently falls through to simple mode with
 * mode: "simple" in the report (no silent lies).
 */
export async function runAiderPolyglot(
  runtime: RunnerRuntime,
  workingDir: string,
  opts: RunAiderPolyglotOptions = {},
): Promise<AiderPolyglotReport> {
  const startedAt = Date.now();
  const runId = `aider-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  // Always "simple" until real aider-chat integration lands (spec honesty).
  const mode: "real" | "simple" = "simple";
  const diffEditBudget = opts.diffEditAttempts ?? 1; // Aider spec = 1 diff + 1 fallback = 2 attempts

  const loadOpts: {
    limit?: number;
    seed?: number;
    languages?: readonly AiderLanguage[];
    requireCorpus?: boolean;
  } = {};
  if (opts.limit !== undefined) loadOpts.limit = opts.limit;
  if (opts.seed !== undefined) loadOpts.seed = opts.seed;
  if (opts.languages !== undefined) loadOpts.languages = opts.languages;
  if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
  const tasks = loadAiderPolyglotTasks(workingDir, loadOpts);

  const trajectory = openTrajectoryWriter(runId);
  trajectory.write({
    type: "run-start",
    runId,
    benchmark: "aider-polyglot",
    startedAt,
    totalTasks: tasks.length,
    diffEditBudget,
    mode,
  });

  const results: AiderPolyglotTaskResult[] = [];

  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) {
      trajectory.write({ type: "budget-exhausted", runId, elapsedMs: Date.now() - startedAt });
      break;
    }
    const taskStart = Date.now();
    const budget = opts.perTaskBudgetMs ?? task.timeBudgetMs ?? 300_000;

    let transcript: string[] = [];
    let error: string | undefined;
    let usedWholeFileFallback = false;
    let diffEditAttempts = 0;
    let passedFirstAttempt = false;
    let verdict = { completed: false, score: 0, evidence: [] as readonly VerificationEvidence[] };

    try {
      const preamble = languagePreamble(task.language);
      const deadline = Date.now() + budget;

      // Diff-edit attempts
      for (let attempt = 0; attempt < diffEditBudget && Date.now() < deadline; attempt++) {
        diffEditAttempts++;
        const attemptPrompt = [
          preamble,
          `DIFF-EDIT ATTEMPT ${attempt + 1}/${diffEditBudget}:`,
          task.prompt,
          ``,
          `Respond with a minimal diff hunk in unified diff format. Do not rewrite the whole file unless asked.`,
        ].join("\n");
        const queryOpts: WotannQueryOptions = {
          prompt: attemptPrompt,
          ...(opts.model ? { model: opts.model } : {}),
        };
        for await (const chunk of runtime.query(queryOpts)) {
          if (Date.now() > deadline) break;
          if (chunk.type === "text") transcript.push(chunk.content);
        }

        const verifyOpts: Parameters<RunnerRuntime["verifyCompletion"]>[1] = {};
        if (task.criteria !== undefined) verifyOpts.criteria = task.criteria;
        if (opts.threshold !== undefined) verifyOpts.threshold = opts.threshold;
        verdict = await runtime.verifyCompletion(task.prompt, verifyOpts);
        if (verdict.completed) {
          if (attempt === 0) passedFirstAttempt = true;
          break;
        }
      }

      // Whole-file fallback if diff-edits all failed
      if (!verdict.completed && Date.now() < deadline) {
        usedWholeFileFallback = true;
        const fallbackPrompt = [
          preamble,
          `WHOLE-FILE FALLBACK: ${diffEditBudget} diff-edit attempts did not pass verification.`,
          task.prompt,
          ``,
          `Respond with the COMPLETE revised file contents. No diff markers.`,
        ].join("\n");
        const queryOpts: WotannQueryOptions = {
          prompt: fallbackPrompt,
          ...(opts.model ? { model: opts.model } : {}),
        };
        for await (const chunk of runtime.query(queryOpts)) {
          if (Date.now() > deadline) break;
          if (chunk.type === "text") transcript.push(chunk.content);
        }

        const verifyOpts: Parameters<RunnerRuntime["verifyCompletion"]>[1] = {};
        if (task.criteria !== undefined) verifyOpts.criteria = task.criteria;
        if (opts.threshold !== undefined) verifyOpts.threshold = opts.threshold;
        verdict = await runtime.verifyCompletion(task.prompt, verifyOpts);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const durationMs = Date.now() - taskStart;
    const result: AiderPolyglotTaskResult = {
      task,
      completed: verdict.completed,
      score: verdict.score,
      evidence: verdict.evidence,
      transcript,
      durationMs,
      usedWholeFileFallback,
      diffEditAttempts,
      passedFirstAttempt,
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
        language: task.language,
        usedWholeFileFallback,
        diffEditAttempts,
        passedFirstAttempt,
        ...(error !== undefined ? { error } : {}),
      },
    };
    trajectory.write({ type: "task-result", ...envelope });
  }

  const finishedAt = Date.now();
  const completedTasks = results.filter((r) => r.completed).length;
  const firstAttemptPasses = results.filter((r) => r.passedFirstAttempt).length;
  const byLanguage: Record<AiderLanguage, { total: number; completed: number }> = {
    python: { total: 0, completed: 0 },
    javascript: { total: 0, completed: 0 },
    rust: { total: 0, completed: 0 },
    go: { total: 0, completed: 0 },
    cpp: { total: 0, completed: 0 },
    java: { total: 0, completed: 0 },
  };
  for (const r of results) {
    byLanguage[r.task.language].total += 1;
    if (r.completed) byLanguage[r.task.language].completed += 1;
  }

  const passAt1 = results.length > 0 ? firstAttemptPasses / results.length : 0;
  const passAt2 = results.length > 0 ? completedTasks / results.length : 0;

  trajectory.write({
    type: "run-end",
    runId,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    passAt2,
    byLanguage,
    parityTargetPassAt2: AIDER_POLYGLOT_PARITY_PASS_AT_2,
    mode,
  });

  return {
    runId,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    passAt2,
    byLanguage,
    results,
    mode,
    trajectoryPath: trajectory.path,
    parityTargetPassAt2: AIDER_POLYGLOT_PARITY_PASS_AT_2,
  };
}

// ── Helpers ───────────────────────────────────────────

function languagePreamble(language: AiderLanguage): string {
  switch (language) {
    case "python":
      return "Write idiomatic Python 3.12. Use type hints on new function signatures. Standard-library first.";
    case "javascript":
      return "Write modern JavaScript (ES2022+). Prefer const + arrow functions + destructuring. Avoid `var`.";
    case "rust":
      return "Write idiomatic Rust. Use Result<T, E> over unwrap. Prefer `?` operator. Explicit lifetimes only when needed.";
    case "go":
      return "Write idiomatic Go. Handle errors explicitly — no panics except for truly unrecoverable states. gofmt-clean.";
    case "cpp":
      return "Write modern C++17. RAII for resources. Prefer std:: over raw pointers. No manual new/delete.";
    case "java":
      return "Write modern Java 21. Prefer records for data classes, Optional for nullables, streams for collections.";
  }
}

// ── Smoke Corpus ──────────────────────────────────────

const SMOKE_CORPUS: readonly AiderPolyglotTask[] = [
  {
    id: "aider-py-01",
    language: "python",
    prompt:
      "Implement a debounce decorator that delays function execution by N ms, cancelling earlier calls.",
    expectedBehavior: "Uses threading.Timer or asyncio; cancels previous timer on re-call.",
    timeBudgetMs: 180_000,
  },
  {
    id: "aider-js-01",
    language: "javascript",
    prompt: "Write a function that parses ISO 8601 durations (e.g. 'PT1H30M15S') into seconds.",
    expectedBehavior: "Handles weeks/days/hours/minutes/seconds combinations correctly.",
    timeBudgetMs: 180_000,
  },
  {
    id: "aider-rust-01",
    language: "rust",
    prompt: "Write a function that finds the longest palindromic substring of a given string.",
    expectedBehavior: "Manacher's algorithm or expand-around-center; no stdin I/O.",
    timeBudgetMs: 240_000,
  },
  {
    id: "aider-go-01",
    language: "go",
    prompt: "Build a concurrent-safe LRU cache with Get, Put, and Size methods. Capacity 100.",
    expectedBehavior:
      "sync.Mutex guards internal state; container/list + map[string]*list.Element.",
    timeBudgetMs: 240_000,
  },
  {
    id: "aider-cpp-01",
    language: "cpp",
    prompt:
      "Implement a thread-safe bounded blocking queue with push/pop and a 1-second timeout on pop.",
    expectedBehavior: "std::mutex + std::condition_variable; wait_for with timeout.",
    timeBudgetMs: 240_000,
  },
];
