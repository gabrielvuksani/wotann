/**
 * Aider Polyglot benchmark runner — Phase 4 Sprint B1 item 5.
 *
 * Aider's Polyglot leaderboard (https://aider.chat/docs/leaderboards/)
 * measures coding-task pass-rate across ~5 languages (Python, JavaScript,
 * Rust, Go, C++, Java) with per-language test-harness pass/fail verdicts.
 * The benchmark values: diff-edit correctness, per-language idiom,
 * compile-before-submit safety, whole-file fallback after N diff-edit
 * failures.
 *
 * This runner ships the wire-format shell: loadAiderPolyglotTasks +
 * runAiderPolyglot + the shared RunnerRuntime interface. Real integration
 * with the `aider-chat` pip package + per-language compile is gated
 * behind WOTANN_AIDER_REAL=1 so the module loads without the heavy
 * Python dep.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StreamChunk } from "../../providers/types.js";
import type { WotannQueryOptions } from "../../core/types.js";
import type { CompletionCriterion, VerificationEvidence } from "../../autopilot/types.js";

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
  readonly error?: string;
}

export interface AiderPolyglotReport {
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly passAt1: number;
  readonly byLanguage: Readonly<Record<AiderLanguage, { total: number; completed: number }>>;
  readonly results: readonly AiderPolyglotTaskResult[];
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

export function loadAiderPolyglotTasks(
  workingDir: string,
  opts: { limit?: number; seed?: number; languages?: readonly AiderLanguage[] } = {},
): readonly AiderPolyglotTask[] {
  const path = join(workingDir, ".wotann", "benchmarks", "aider-polyglot-tasks.jsonl");
  let tasks: AiderPolyglotTask[];
  if (existsSync(path)) {
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
  } else {
    tasks = [...SMOKE_CORPUS];
  }

  if (opts.languages && opts.languages.length > 0) {
    const allowed = new Set(opts.languages);
    tasks = tasks.filter((t) => allowed.has(t.language));
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

export interface RunAiderPolyglotOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly languages?: readonly AiderLanguage[];
  readonly model?: string;
  readonly threshold?: number;
  readonly totalBudgetMs?: number;
  readonly perTaskBudgetMs?: number;
  /** Max diff-edit attempts before whole-file fallback kicks in. */
  readonly diffEditAttempts?: number;
}

/**
 * Aider's signature strategy: try diff-edit first (compact, targeted),
 * fall back to whole-file rewrite after N failed diff-edit attempts.
 * This runner simulates that pattern at the prompt level — the first
 * attempt instructs the agent to respond with a diff-edit hunk; if the
 * verifier fails, retry instructs the agent to respond with the full
 * revised file. Real integration with the aider-chat pip package is
 * deferred (WOTANN_AIDER_REAL=1).
 */
export async function runAiderPolyglot(
  runtime: RunnerRuntime,
  workingDir: string,
  opts: RunAiderPolyglotOptions = {},
): Promise<AiderPolyglotReport> {
  const startedAt = Date.now();
  const runId = `aider-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const mode: "real" | "simple" = process.env["WOTANN_AIDER_REAL"] === "1" ? "real" : "simple";
  const diffEditBudget = opts.diffEditAttempts ?? 3;

  const loadOpts: Parameters<typeof loadAiderPolyglotTasks>[1] = {};
  if (opts.limit !== undefined) loadOpts.limit = opts.limit;
  if (opts.seed !== undefined) loadOpts.seed = opts.seed;
  if (opts.languages !== undefined) loadOpts.languages = opts.languages;
  const tasks = loadAiderPolyglotTasks(workingDir, loadOpts);
  const results: AiderPolyglotTaskResult[] = [];

  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) break;
    const taskStart = Date.now();
    const budget = opts.perTaskBudgetMs ?? task.timeBudgetMs ?? 300_000;

    let transcript: string[] = [];
    let error: string | undefined;
    let usedWholeFileFallback = false;
    let diffEditAttempts = 0;
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
        const queryOpts: WotannQueryOptions = { prompt: attemptPrompt };
        if (opts.model) queryOpts.model = opts.model;
        for await (const chunk of runtime.query(queryOpts)) {
          if (Date.now() > deadline) break;
          if (chunk.type === "text") transcript.push(chunk.content);
        }

        const verifyOpts: Parameters<RunnerRuntime["verifyCompletion"]>[1] = {};
        if (task.criteria !== undefined) verifyOpts.criteria = task.criteria;
        if (opts.threshold !== undefined) verifyOpts.threshold = opts.threshold;
        verdict = await runtime.verifyCompletion(task.prompt, verifyOpts);
        if (verdict.completed) break;
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
        const queryOpts: WotannQueryOptions = { prompt: fallbackPrompt };
        if (opts.model) queryOpts.model = opts.model;
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
      ...(error !== undefined ? { error } : {}),
    };
    results.push(result);
  }

  const finishedAt = Date.now();
  const completedTasks = results.filter((r) => r.completed).length;
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

  return {
    runId,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1: results.length > 0 ? completedTasks / results.length : 0,
    byLanguage,
    results,
    mode,
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
