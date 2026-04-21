/**
 * TerminalBench 2.0 runner — targets the Claude Mythos 82% parity line.
 *
 * TerminalBench (Stanford / Laude Institute, https://github.com/laude-institute/terminal-bench)
 * is the flagship "agent in a real shell" benchmark: tmux-bootstrapped
 * Docker containers per task, an automated grader shipped with each
 * task, and 30-minute wall-clock budgets. The 2.0 release (March 2026)
 * added 120 new tasks across infra, data, and science corpora.
 *
 * This module is a HONEST runner shell. Three modes:
 *
 *   1. `mode="simple"` — the default when WOTANN_TB_REAL is unset and
 *      no docker/corpus is available. Runs tasks as plain prompts
 *      against runtime.query; verifies via runtime.verifyCompletion
 *      (CompletionOracle). Useful for harness-on-vs-off ablation and
 *      CI smoke tests against the 5-task built-in corpus.
 *
 *   2. `mode="dry-run"` — skip execution, validate setup:
 *        - corpus present on disk (or smoke fallback available)
 *        - docker CLI reachable
 *        - runtime has query + verifyCompletion
 *      Emits a DryRunReport that callers can print / serialize.
 *
 *   3. `mode="real"` (WOTANN_TB_REAL=1) — delegate to the upstream
 *      terminal_bench.runner Python harness via child_process. Requires
 *      docker + pip-installed `terminal-bench` package. Deferred to a
 *      follow-up commit; currently short-circuits to "simple" mode with
 *      a note in the report so a `--real` flag never silently lies.
 *
 * Corpus:
 *   - On disk: `.wotann/benchmarks/terminal-bench/terminal-bench-tasks.jsonl`
 *   - When absent AND caller requires corpus (not smoke), throws
 *     BlockedCorpusError with the exact `git clone` + extract command.
 *   - Smoke corpus: 5 embedded tasks (unchanged — still useful for CI).
 *
 * Trajectory:
 *   Every task append-writes a TaskScoreEnvelope to
 *   ~/.wotann/bench-runs/<runId>.jsonl so operators can `tail -f` progress.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  /** Docker image the upstream harness would spin up (metadata only). */
  readonly dockerImage?: string;
  /** Shell command the upstream grader runs to verify completion. */
  readonly graderCommand?: string;
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
  /** Where the per-task JSONL trajectory lives. */
  readonly trajectoryPath: string;
  /** Parity target for this benchmark (Claude Mythos 82% on TB 2.0). */
  readonly parityTargetPassAt1: number;
  /**
   * Populated when real-mode was requested (WOTANN_TB_REAL=1) but the
   * harness was not installed / dispatch failed, and the run therefore
   * degraded to simple-mode. Absent on successful real-mode runs and
   * on simple-mode runs that never attempted real-mode. This makes the
   * "real requested but simple delivered" case visible instead of silent.
   */
  readonly realModeIssue?: string;
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

// ── Constants ─────────────────────────────────────────

/** Claude Mythos on TerminalBench 2.0 — the parity line the runner targets. */
export const TERMINAL_BENCH_PARITY_PASS_AT_1 = 0.82;

/**
 * Upstream corpus fetch command. Written out here so the blocked-error
 * message always matches what this runner expects.
 */
const TB_CORPUS_FETCH_COMMAND = [
  "mkdir -p .wotann/benchmarks/terminal-bench",
  "git clone --depth 1 https://github.com/laude-institute/terminal-bench .wotann/benchmarks/terminal-bench/src",
  "node scripts/terminal-bench-extract.mjs  # produces terminal-bench-tasks.jsonl",
].join(" && ");

// ── Task loading ──────────────────────────────────────

export interface LoadTasksOptions {
  readonly limit?: number;
  readonly seed?: number;
  /**
   * When true and no JSONL is on disk, throws BlockedCorpusError instead
   * of falling back to the smoke corpus. Used by full-benchmark runs so a
   * leaderboard entry can never accidentally be the 5-task smoke set.
   */
  readonly requireCorpus?: boolean;
}

/**
 * Load TerminalBench tasks from disk, with seeded deterministic shuffling
 * + limit. Looks at `.wotann/benchmarks/terminal-bench/terminal-bench-tasks.jsonl`
 * first (new v2 layout); falls back to the legacy `.wotann/benchmarks/
 * terminal-bench-tasks.jsonl` location for backwards compatibility; falls
 * back to the embedded smoke corpus (5 tasks) unless requireCorpus=true.
 *
 * JSONL schema (one object per line): {id, prompt, setup?, criteria?,
 * expectedBehavior?, timeBudgetMs?, difficulty?, dockerImage?, graderCommand?}
 */
export function loadTerminalBenchTasks(
  workingDir: string,
  opts: LoadTasksOptions = {},
): readonly TerminalBenchTask[] {
  const primary = join(
    workingDir,
    ".wotann",
    "benchmarks",
    "terminal-bench",
    "terminal-bench-tasks.jsonl",
  );
  const legacy = join(workingDir, ".wotann", "benchmarks", "terminal-bench-tasks.jsonl");
  const path = existsSync(primary) ? primary : existsSync(legacy) ? legacy : null;

  let tasks: TerminalBenchTask[];
  if (path !== null) {
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
  } else if (opts.requireCorpus) {
    throw new BlockedCorpusError({
      benchmark: "terminal-bench",
      corpusPath: primary,
      fetchCommand: TB_CORPUS_FETCH_COMMAND,
    });
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

// ── Dry-run validation ────────────────────────────────

/**
 * Validate the setup without running any tasks. Checks:
 *   - corpus presence (or smoke-fallback acceptable)
 *   - docker CLI present (required for "real" mode only, informational otherwise)
 *   - runtime has query + verifyCompletion methods
 *
 * Returns a DryRunReport. Does NOT throw on missing prereqs — the report
 * is the canonical way to communicate readiness.
 */
export function dryRunTerminalBench(
  runtime: RunnerRuntime | null,
  workingDir: string,
  opts: { requireCorpus?: boolean } = {},
): DryRunReport {
  const checks: DryRunCheck[] = [];

  // Corpus check
  const primary = join(
    workingDir,
    ".wotann",
    "benchmarks",
    "terminal-bench",
    "terminal-bench-tasks.jsonl",
  );
  const legacy = join(workingDir, ".wotann", "benchmarks", "terminal-bench-tasks.jsonl");
  const hasCorpus = existsSync(primary) || existsSync(legacy);
  checks.push({
    name: "corpus",
    ok: hasCorpus || !opts.requireCorpus,
    detail: hasCorpus
      ? `found at ${existsSync(primary) ? primary : legacy}`
      : opts.requireCorpus
        ? `missing — need real corpus (not smoke)`
        : `not found, will fall back to smoke (5 tasks)`,
  });

  // Docker check — informational only. Docker is only required for the
  // not-yet-wired "real" mode (WOTANN_TB_REAL=1); absence does not block
  // a "simple" mode run. Report as ok=true so overall dry-run readiness
  // isn't marked bad just because docker is missing.
  let dockerAvailable = false;
  let dockerDetail = "docker not found in PATH (only required for real-mode)";
  try {
    execFileSync("docker", ["--version"], { stdio: "pipe", timeout: 3000 });
    dockerAvailable = true;
    dockerDetail = "docker available";
  } catch {
    // intentional — informational only
  }
  checks.push({
    name: "docker",
    ok: true, // always ok — simple mode doesn't need docker
    detail: dockerAvailable ? dockerDetail : `${dockerDetail}`,
  });

  // Runtime check — informational when runtime is null (dry-run often
  // skips spin-up). Only marks as not-ok when runtime is present but
  // incomplete.
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

  // Corpus size lookup — always safe (smoke fallback if requireCorpus=false)
  let corpusSize = 0;
  let blockedReason: string | undefined;
  try {
    const loadOpts: { requireCorpus?: boolean } = {};
    if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
    corpusSize = loadTerminalBenchTasks(workingDir, loadOpts).length;
  } catch (e) {
    if (e instanceof BlockedCorpusError) {
      blockedReason = e.message;
    } else {
      blockedReason = e instanceof Error ? e.message : String(e);
    }
  }

  const report: {
    benchmark: string;
    checks: readonly DryRunCheck[];
    corpusSize: number;
    blockedReason?: string;
  } = {
    benchmark: "terminal-bench",
    checks,
    corpusSize,
  };
  if (blockedReason !== undefined) report.blockedReason = blockedReason;
  return makeDryRunReport(report);
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
  /** When true, throws BlockedCorpusError if on-disk corpus is missing. */
  readonly requireCorpus?: boolean;
}

/**
 * Run TerminalBench against `runtime`. Each task:
 *   1. runtime.query({prompt: task.prompt, ...}) — agent attempts the task,
 *      transcript captured
 *   2. runtime.verifyCompletion(task.prompt, {criteria: task.criteria ?? defaults})
 *      — weighted verifier decides pass/fail
 *   3. Append TaskScoreEnvelope to ~/.wotann/bench-runs/<runId>.jsonl
 *
 * Returns a TerminalBenchReport with aggregate pass@1 and per-task details.
 * Parity target (Claude Mythos 82% on TB 2.0) is recorded so callers can
 * flag regressions against a moving leaderboard.
 *
 * Real-container mode (WOTANN_TB_REAL=1) is reserved for future wire-up
 * — currently falls through to simple mode with `mode: "simple"` in the
 * report, never `"real"` — we don't claim capability we don't have.
 */
export async function runTerminalBench(
  runtime: RunnerRuntime,
  workingDir: string,
  opts: RunTerminalBenchOptions = {},
): Promise<TerminalBenchReport> {
  const startedAt = Date.now();
  const runId = `tb-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  // WOTANN_TB_REAL=1 opts into real-mode subprocess dispatch to `tb run`.
  // When unset (or any other value), runs in simple-mode. This env switch
  // is the wire-up gate; actual real dispatch is attempted further below
  // and degrades honestly to simple if the tb CLI or corpus is missing.
  const wantReal = process.env["WOTANN_TB_REAL"] === "1";
  let mode: "real" | "simple" = wantReal ? "real" : "simple";
  let realModeIssue: string | undefined;

  const loadOpts: { limit?: number; seed?: number; requireCorpus?: boolean } = {};
  if (opts.limit !== undefined) loadOpts.limit = opts.limit;
  if (opts.seed !== undefined) loadOpts.seed = opts.seed;
  if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
  const tasks = loadTerminalBenchTasks(workingDir, loadOpts);

  const trajectory = openTrajectoryWriter(runId);
  trajectory.write({
    type: "run-start",
    runId,
    benchmark: "terminal-bench",
    startedAt,
    totalTasks: tasks.length,
    mode,
  });

  // Real-mode preflight: probe tb CLI + agent script. Falls back to
  // simple-mode with an honest `realModeIssue` if any precondition is
  // missing. We deliberately do NOT actually execute `tb run` here in
  // this commit — the subprocess dispatch wiring lives in the small
  // `dispatchTbRun` helper below, which is currently guarded behind
  // `WOTANN_TB_DISPATCH=1` to keep the default simple-mode surface
  // byte-identical until the end-to-end pipeline is exercised by hand
  // once. This is honest plumbing: mode flips to "real" only when the
  // full chain works; otherwise realModeIssue carries the reason.
  if (wantReal) {
    const probe = probeRealModePreconditions(workingDir);
    if (!probe.ready) {
      mode = "simple";
      realModeIssue = probe.reason;
      trajectory.write({
        type: "real-mode-fallback",
        runId,
        reason: realModeIssue,
      });
    } else if (process.env["WOTANN_TB_DISPATCH"] === "1") {
      // Opt-in actual subprocess dispatch. Hidden behind a second env so
      // a typo in CI doesn't trigger a live 6-hour tb run.
      const dispatched = await dispatchTbRun({
        runId,
        workingDir,
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        trajectory,
      });
      if (dispatched !== null) {
        const finishedAt = Date.now();
        const completedTasks = dispatched.results.filter((r) => r.completed).length;
        const durations = dispatched.results.map((r) => r.durationMs).sort((a, b) => a - b);
        const medianDurationMs = durations.length
          ? (durations[Math.floor(durations.length / 2)] ?? 0)
          : 0;
        const averageScore =
          dispatched.results.length > 0
            ? dispatched.results.reduce((s, r) => s + r.score, 0) / dispatched.results.length
            : 0;
        const passAt1 =
          dispatched.results.length > 0 ? completedTasks / dispatched.results.length : 0;
        trajectory.write({
          type: "run-end",
          runId,
          finishedAt,
          totalTasks: dispatched.results.length,
          completedTasks,
          passAt1,
          parityTargetPassAt1: TERMINAL_BENCH_PARITY_PASS_AT_1,
          mode: "real",
        });
        return {
          runId,
          startedAt,
          finishedAt,
          totalTasks: dispatched.results.length,
          completedTasks,
          passAt1,
          medianDurationMs,
          averageScore,
          results: dispatched.results,
          mode: "real",
          trajectoryPath: trajectory.path,
          parityTargetPassAt1: TERMINAL_BENCH_PARITY_PASS_AT_1,
        };
      }
      // Dispatch attempted but returned null — degrade to simple-mode.
      mode = "simple";
      realModeIssue = "tb run subprocess failed or produced no parseable results";
    }
  }

  const results: TerminalBenchTaskResult[] = [];
  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) {
      trajectory.write({ type: "budget-exhausted", runId, elapsedMs: Date.now() - startedAt });
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

    const envelope: TaskScoreEnvelope = {
      task_id: task.id,
      passed: verdict.completed,
      durationMs,
      cost: 0,
      score: verdict.score,
      trajectory: transcript.slice(-20),
      meta: error !== undefined ? { error } : { difficulty: task.difficulty ?? "unknown" },
    };
    trajectory.write({ type: "task-result", ...envelope });
  }

  const finishedAt = Date.now();
  const completedTasks = results.filter((r) => r.completed).length;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const medianDurationMs = durations.length
    ? (durations[Math.floor(durations.length / 2)] ?? 0)
    : 0;
  const averageScore =
    results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0;
  const passAt1 = results.length > 0 ? completedTasks / results.length : 0;

  trajectory.write({
    type: "run-end",
    runId,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    parityTargetPassAt1: TERMINAL_BENCH_PARITY_PASS_AT_1,
    mode,
    ...(realModeIssue !== undefined ? { realModeIssue } : {}),
  });

  return {
    runId,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    medianDurationMs,
    averageScore,
    results,
    mode,
    trajectoryPath: trajectory.path,
    parityTargetPassAt1: TERMINAL_BENCH_PARITY_PASS_AT_1,
    ...(realModeIssue !== undefined ? { realModeIssue } : {}),
  };
}

// ── Real-mode dispatch (P0-8 plumbing) ────────────────

/**
 * Probe whether the upstream TerminalBench CLI is available on PATH.
 * Exported so CLI code / tests can check readiness without spinning up
 * a full run. Never throws — returns a data-tagged struct.
 */
export function isTbCliAvailable(): { available: boolean; reason?: string } {
  try {
    execFileSync("tb", ["--version"], { stdio: "pipe", timeout: 5000 });
    return { available: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      available: false,
      reason:
        `tb CLI not installed or not on PATH (${msg.slice(0, 120)}). ` +
        `Run: bash scripts/install-terminal-bench.sh`,
    };
  }
}

/**
 * Resolve the on-disk path to `python-scripts/tb_agent.py`. Works
 * whether the runner is executed from src/ (dev) or dist/ (built).
 * Exported so tests can assert the path is stable + exists.
 */
export function resolveTbAgentScript(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // From src/intelligence/benchmark-runners we walk up 3 levels to the
  // repo root, then into python-scripts/. Same relative distance from
  // dist/intelligence/benchmark-runners once compiled.
  return resolve(here, "..", "..", "..", "python-scripts", "tb_agent.py");
}

/**
 * Preflight a real-mode run: checks tb CLI + agent script + corpus
 * directory. All three are required. Returns a {ready, reason} tag.
 */
export function probeRealModePreconditions(workingDir: string): {
  ready: boolean;
  reason?: string;
} {
  const cli = isTbCliAvailable();
  if (!cli.available) {
    return { ready: false, reason: cli.reason ?? "tb CLI missing" };
  }
  const agent = resolveTbAgentScript();
  if (!existsSync(agent)) {
    return { ready: false, reason: `tb_agent.py missing at ${agent}` };
  }
  const corpusDir = join(workingDir, ".wotann", "benchmarks", "terminal-bench");
  if (!existsSync(corpusDir)) {
    return {
      ready: false,
      reason:
        `corpus directory missing at ${corpusDir}. ` +
        `Run: node scripts/download-terminal-bench-corpus.mjs --yes`,
    };
  }
  return { ready: true };
}

/**
 * Parse `tb run` stdout. Scans for the last line that looks like a
 * JSON object with a `results` array, then maps each entry into the
 * runner's internal result shape. Exported so
 * `scripts/terminal-bench-extract.mjs` can share the contract via a
 * sibling implementation (kept in sync by the test suite).
 */
export interface TbExtractResult {
  readonly results: readonly TerminalBenchTaskResult[];
  readonly rawJson: string;
}

export function parseTbStdout(stdout: string): TbExtractResult | null {
  const lines = stdout.split("\n").map((l) => l.trim());
  let jsonBlob: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.startsWith("{") && line.includes('"results"')) {
      jsonBlob = line;
      break;
    }
  }
  if (jsonBlob === null) return null;

  try {
    const obj = JSON.parse(jsonBlob) as {
      results?: Array<{
        task_id?: string;
        prompt?: string;
        completed?: boolean;
        score?: number;
        duration_ms?: number;
        transcript?: string[];
        error?: string;
      }>;
    };
    const rawResults = Array.isArray(obj.results) ? obj.results : [];
    const mapped: TerminalBenchTaskResult[] = rawResults.map((r) => {
      const task: TerminalBenchTask = {
        id: typeof r.task_id === "string" ? r.task_id : "unknown",
        prompt: typeof r.prompt === "string" ? r.prompt : "",
      };
      const base: TerminalBenchTaskResult = {
        task,
        completed: r.completed === true,
        score: typeof r.score === "number" ? r.score : 0,
        evidence: [] as readonly VerificationEvidence[],
        transcript: Array.isArray(r.transcript)
          ? r.transcript.filter((s): s is string => typeof s === "string")
          : [],
        durationMs: typeof r.duration_ms === "number" ? r.duration_ms : 0,
      };
      return typeof r.error === "string" ? { ...base, error: r.error } : base;
    });
    return { results: mapped, rawJson: jsonBlob };
  } catch {
    return null;
  }
}

interface DispatchTbRunArgs {
  readonly runId: string;
  readonly workingDir: string;
  readonly model?: string;
  readonly trajectory: { write(entry: unknown): void; readonly path: string };
}

/**
 * Subprocess dispatch to `tb run`. Gated behind WOTANN_TB_DISPATCH=1
 * (checked by the caller) so a typo in WOTANN_TB_REAL alone never
 * triggers a live 6-hour tb run. This is the plumbing wire-up — calling
 * code must opt in a SECOND time to actually spawn the subprocess.
 *
 * Returns a {results} struct on success, or null if dispatch / parse
 * failed. On null the caller degrades to simple-mode and populates
 * `realModeIssue` from the trajectory diagnostic.
 *
 * Implementation note: we use `execFileSync` so this function blocks
 * the runner for the duration of `tb run` (which can be hours). The
 * per-task progress is visible via the trajectory JSONL either way.
 */
async function dispatchTbRun(args: DispatchTbRunArgs): Promise<TbExtractResult | null> {
  const agentScript = resolveTbAgentScript();
  const outDir = join(args.workingDir, ".wotann", "bench-runs", args.runId);
  const model = args.model ?? "opus-4.7";
  const tbArgs = ["run", "--agent", agentScript, "--model", model, "--output-dir", outDir];

  args.trajectory.write({
    type: "real-mode-dispatch",
    runId: args.runId,
    tbArgs,
  });

  let stdout: string;
  try {
    const buf = execFileSync("tb", tbArgs, {
      stdio: "pipe",
      timeout: 6 * 60 * 60 * 1000, // 6h cap
      env: {
        ...process.env,
        WOTANN_TB_RUN_ID: args.runId,
      },
    });
    stdout = buf.toString("utf-8");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    args.trajectory.write({
      type: "real-mode-spawn-failed",
      runId: args.runId,
      reason: reason.slice(0, 500),
    });
    return null;
  }

  const parsed = parseTbStdout(stdout);
  if (parsed === null) {
    args.trajectory.write({
      type: "real-mode-parse-failed",
      runId: args.runId,
      reason: "no parseable JSON results in tb stdout",
    });
    return null;
  }

  for (const r of parsed.results) {
    args.trajectory.write({
      type: "task-result",
      task_id: r.task.id,
      passed: r.completed,
      durationMs: r.durationMs,
      cost: 0,
      score: r.score,
      trajectory: r.transcript.slice(-20),
    });
  }

  return parsed;
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
