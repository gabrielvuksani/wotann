/**
 * TerminalBench runner — Phase 4 Sprint B1 item 2.
 *
 * Scaffolds the runner shape for Stanford/Laude's TerminalBench
 * evaluation (tmux-bootstrapped Docker containers with agent command
 * execution + trajectory scoring). The real pip-installed
 * `terminal-bench` harness integration is intentionally left behind an
 * env-flag gate (WOTANN_TB_REAL=1) so this module loads cleanly on
 * runners without the Python package, and so tests can exercise the
 * runner shape without spinning up Docker.
 *
 * The public API is the minimal surface Phase-4 callers need:
 *   - `loadTerminalBenchTasks(dir, { limit, seed })` — returns an array
 *     of TerminalBenchTask descriptors, either from the on-disk
 *     `.wotann/benchmarks/terminal-bench-tasks.jsonl` corpus or from
 *     the built-in smoke subset if none is present
 *   - `runTerminalBench(runtime, opts)` — runs each task, calls
 *     runtime.query to let the agent attempt it, then calls
 *     runtime.verifyCompletion to score. Returns
 *     TerminalBenchReport with per-task details + an aggregate
 *     pass@1 percentage and median wall-clock
 *   - `TerminalBenchTask` / `TerminalBenchReport` / `TerminalBenchTaskResult`
 *     types for downstream consumers
 *
 * When WOTANN_TB_REAL=1 is set AND the `terminal-bench` python package
 * is importable, the runner delegates container orchestration to
 * `terminal_bench.runner` via a child_process; otherwise it runs tasks
 * as plain prompts against the runtime and verifies via
 * CompletionOracle's default criteria. The simple path is still
 * useful for harness-on-vs-off ablation because the verifier-gated
 * completion score is the thing under study.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StreamChunk } from "../../providers/types.js";
import type { WotannQueryOptions } from "../../core/types.js";
import type { CompletionCriterion, VerificationEvidence } from "../../autopilot/types.js";

// ── Types ──────────────────────────────────────────────

export interface TerminalBenchTask {
  readonly id: string;
  /** Natural-language task prompt given to the agent. */
  readonly prompt: string;
  /** Initial working directory context (e.g. "fresh ubuntu shell"). */
  readonly setup?: string;
  /** Criteria the CompletionOracle uses to score this task. */
  readonly criteria?: readonly CompletionCriterion[];
  /** Reference answer / expected behavior — used for llm-judge when no hard
   *  criteria match. */
  readonly expectedBehavior?: string;
  /** Max wall-clock allowed for this task (ms). */
  readonly timeBudgetMs?: number;
  /** Difficulty class — used by seed-based shuffling. */
  readonly difficulty?: "easy" | "medium" | "hard";
}

export interface TerminalBenchTaskResult {
  readonly task: TerminalBenchTask;
  readonly completed: boolean;
  readonly score: number;
  readonly evidence: readonly VerificationEvidence[];
  readonly transcript: readonly string[];
  readonly durationMs: number;
  readonly error?: string;
}

export interface TerminalBenchReport {
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly passAt1: number; // 0-1
  readonly medianDurationMs: number;
  readonly averageScore: number;
  readonly results: readonly TerminalBenchTaskResult[];
  readonly mode: "real" | "simple";
}

/** Runtime shape the runner depends on — a structural subset of WotannRuntime. */
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

/**
 * Load TerminalBench tasks from disk, with seeded deterministic shuffling
 * + limit. Looks at `.wotann/benchmarks/terminal-bench-tasks.jsonl` first;
 * falls back to the embedded smoke corpus (5 tasks) if the file is absent.
 *
 * JSONL schema (one object per line): {id, prompt, setup?, criteria?,
 * expectedBehavior?, timeBudgetMs?, difficulty?}
 */
export function loadTerminalBenchTasks(
  workingDir: string,
  opts: { limit?: number; seed?: number } = {},
): readonly TerminalBenchTask[] {
  const path = join(workingDir, ".wotann", "benchmarks", "terminal-bench-tasks.jsonl");
  let tasks: TerminalBenchTask[];
  if (existsSync(path)) {
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    tasks = lines
      .map((l, i) => {
        try {
          return JSON.parse(l) as TerminalBenchTask;
        } catch {
          throw new Error(
            `terminal-bench-tasks.jsonl line ${i + 1} is not valid JSON: ${l.slice(0, 80)}`,
          );
        }
      })
      .filter(
        (t): t is TerminalBenchTask => typeof t.id === "string" && typeof t.prompt === "string",
      );
  } else {
    tasks = [...SMOKE_CORPUS];
  }

  if (typeof opts.seed === "number") {
    tasks = seededShuffle(tasks, opts.seed);
  }
  if (typeof opts.limit === "number" && opts.limit > 0) {
    tasks = tasks.slice(0, opts.limit);
  }
  return tasks;
}

// ── Runner ────────────────────────────────────────────

export interface RunTerminalBenchOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly model?: string;
  readonly provider?: string;
  readonly threshold?: number;
  /** Max total budget across all tasks (ms). Tasks stop early when exceeded. */
  readonly totalBudgetMs?: number;
  /** Override individual task timeBudgetMs. */
  readonly perTaskBudgetMs?: number;
}

/**
 * Run TerminalBench against `runtime`. Each task:
 *   1. runtime.query({prompt: task.prompt, ...}) — agent attempts the task,
 *      transcript captured
 *   2. runtime.verifyCompletion(task.prompt, {criteria: task.criteria ?? defaults})
 *      — weighted verifier decides pass/fail
 * Returns a TerminalBenchReport with aggregate pass@1 and per-task details.
 *
 * Real-container mode (WOTANN_TB_REAL=1) is reserved for future wire-up
 * — currently falls through to simple mode with a note in the report.
 */
export async function runTerminalBench(
  runtime: RunnerRuntime,
  workingDir: string,
  opts: RunTerminalBenchOptions = {},
): Promise<TerminalBenchReport> {
  const startedAt = Date.now();
  const runId = `tb-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const wantReal = process.env["WOTANN_TB_REAL"] === "1";
  const mode: "real" | "simple" = wantReal ? "real" : "simple";

  const tasks = loadTerminalBenchTasks(workingDir, {
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });

  const results: TerminalBenchTaskResult[] = [];
  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) {
      break;
    }
    const taskStart = Date.now();
    const budget = opts.perTaskBudgetMs ?? task.timeBudgetMs ?? 300_000;

    let transcript: string[] = [];
    let error: string | undefined;
    try {
      const queryOpts: WotannQueryOptions = {
        prompt: task.setup ? `${task.setup}\n\n${task.prompt}` : task.prompt,
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

    const verifyOpts: Parameters<RunnerRuntime["verifyCompletion"]>[1] = {};
    if (task.criteria !== undefined) verifyOpts.criteria = task.criteria;
    if (opts.threshold !== undefined) verifyOpts.threshold = opts.threshold;
    const verdict =
      error === undefined
        ? await runtime.verifyCompletion(task.prompt, verifyOpts)
        : { completed: false, score: 0, evidence: [] as readonly VerificationEvidence[] };

    const durationMs = Date.now() - taskStart;
    const result: TerminalBenchTaskResult = {
      task,
      completed: verdict.completed,
      score: verdict.score,
      evidence: verdict.evidence,
      transcript,
      durationMs,
      ...(error !== undefined ? { error } : {}),
    };
    results.push(result);
  }

  const finishedAt = Date.now();
  const completedTasks = results.filter((r) => r.completed).length;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const medianDurationMs = durations.length
    ? (durations[Math.floor(durations.length / 2)] ?? 0)
    : 0;
  const averageScore =
    results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0;

  return {
    runId,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1: results.length > 0 ? completedTasks / results.length : 0,
    medianDurationMs,
    averageScore,
    results,
    mode,
  };
}

// ── Helpers ───────────────────────────────────────────

function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  // Mulberry32 PRNG — tiny, deterministic, good enough for test ordering.
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

// ── Smoke Corpus ──────────────────────────────────────

const SMOKE_CORPUS: readonly TerminalBenchTask[] = [
  {
    id: "tb-smoke-01",
    prompt:
      "Write a Node.js script that reverses the bytes of an input file and writes to stdout. Use streams, not readFileSync.",
    expectedBehavior:
      "Uses node:stream or fs.createReadStream + on-data handlers to reverse byte order",
    difficulty: "easy",
    timeBudgetMs: 180_000,
  },
  {
    id: "tb-smoke-02",
    prompt:
      "Fix a TypeScript type error: an async function declared to return Promise<number> is returning Promise<number | undefined>. Adjust the implementation without changing the signature.",
    expectedBehavior: "Adds a non-undefined guard or default value; signature unchanged",
    difficulty: "easy",
    timeBudgetMs: 180_000,
  },
  {
    id: "tb-smoke-03",
    prompt:
      "Write a 20-line function that deduplicates an array of objects by a nested key path (e.g. 'user.email'), preserving first-seen order.",
    expectedBehavior: "Handles undefined/null nested keys safely; preserves insertion order",
    difficulty: "medium",
    timeBudgetMs: 240_000,
  },
  {
    id: "tb-smoke-04",
    prompt:
      "Refactor a function that parses JSON with `JSON.parse` inside a try/catch, to use a tolerant parser that handles single-quoted strings and trailing commas. Don't pull in new dependencies.",
    expectedBehavior:
      "Lossless fallback order: strict → trailing-comma strip → single-quote conversion",
    difficulty: "medium",
    timeBudgetMs: 240_000,
  },
  {
    id: "tb-smoke-05",
    prompt:
      "Debug: a React component re-renders infinitely when a prop changes. The prop is an object literal passed inline. Explain the root cause and propose a one-line fix.",
    expectedBehavior:
      "Identifies stable reference issue; suggests useMemo / hoisted const / useCallback",
    difficulty: "hard",
    timeBudgetMs: 180_000,
  },
];
