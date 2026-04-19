/**
 * τ-bench (tau-bench) runner — retail + airline customer-service benchmarks
 * with policy-document injection at the system-prompt level.
 *
 * τ-bench (Sierra / Replit, https://github.com/sierra-research/tau-bench) measures
 * multi-turn compliance with domain policy. The canonical failure mode without
 * policy injection: agents improvise plausible-sounding rules that violate
 * the written policy (e.g. "we'll make an exception" on a non-refundable
 * fare). Sierra's paper showed policy-injection alone recovers 5-15%
 * pass@1 across both domains.
 *
 * This runner:
 *   1. Loads tasks from disk OR the embedded smoke corpus (8 tasks / domain).
 *   2. For each task, looks up the domain's policy via
 *      intelligence/policy-injector.ts and injects it as a system-prompt
 *      preamble BEFORE the conversation begins.
 *   3. Runs the agent against the task; verifies via CompletionOracle.
 *   4. Ablation switch: `injectPolicy: false` runs with no policy — useful
 *      for "how much does policy injection actually help" experiments.
 *
 * Corpus layout:
 *   `.wotann/benchmarks/tau-bench/retail-tasks.jsonl`
 *   `.wotann/benchmarks/tau-bench/airline-tasks.jsonl`
 *   Plus an optional `.wotann/benchmarks/tau-bench/policies/<domain>.md`
 *   override that registers a custom policy per run.
 *
 * BLOCKED-NEEDS-CORPUS when `requireCorpus: true` and no on-disk file exists.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StreamChunk } from "../../providers/types.js";
import type { WotannQueryOptions } from "../../core/types.js";
import type { CompletionCriterion, VerificationEvidence } from "../../autopilot/types.js";
import {
  getPolicy,
  loadPolicyFromFile,
  injectPolicy,
  registerCustomPolicy,
  type PolicyDocument,
  type PolicyDomain,
} from "../policy-injector.js";
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

export type TauBenchDomain = Extract<PolicyDomain, "retail" | "airline">;

export interface TauBenchTask {
  readonly id: string;
  readonly domain: TauBenchDomain;
  /** Initial user message that opens the conversation. */
  readonly userMessage: string;
  /** Additional multi-turn user messages the runner will feed on subsequent turns. */
  readonly followUps?: readonly string[];
  /** Human reference resolution (used for llm-judge verification). */
  readonly referenceResolution?: string;
  /** Criteria override. */
  readonly criteria?: readonly CompletionCriterion[];
  /** Max wall-clock (ms). */
  readonly timeBudgetMs?: number;
}

export interface TauBenchTaskResult {
  readonly task: TauBenchTask;
  readonly completed: boolean;
  readonly score: number;
  readonly evidence: readonly VerificationEvidence[];
  readonly transcript: readonly string[];
  readonly durationMs: number;
  /** Was the policy preamble injected for this task? (ablation flag). */
  readonly policyInjected: boolean;
  /** Which policy id was used (or undefined if injection was skipped). */
  readonly policyId?: string;
  readonly error?: string;
}

export interface TauBenchReport {
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly passAt1: number;
  readonly byDomain: Readonly<Record<TauBenchDomain, { total: number; completed: number }>>;
  readonly results: readonly TauBenchTaskResult[];
  readonly trajectoryPath: string;
  readonly policyInjectionEnabled: boolean;
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

const TAU_BENCH_CORPUS_FETCH_COMMAND = [
  "mkdir -p .wotann/benchmarks/tau-bench",
  "git clone --depth 1 https://github.com/sierra-research/tau-bench .wotann/benchmarks/tau-bench/src",
  "node scripts/tau-bench-extract.mjs  # produces retail-tasks.jsonl + airline-tasks.jsonl",
].join(" && ");

// ── Task loading ──────────────────────────────────────

export interface LoadTasksOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly domains?: readonly TauBenchDomain[];
  readonly requireCorpus?: boolean;
}

/**
 * Load τ-bench tasks for retail + airline (or a subset via `domains`).
 * On-disk layout: `.wotann/benchmarks/tau-bench/<domain>-tasks.jsonl`.
 * Falls back to smoke corpus unless requireCorpus=true.
 */
export function loadTauBenchTasks(
  workingDir: string,
  opts: LoadTasksOptions = {},
): readonly TauBenchTask[] {
  const wantedDomains: readonly TauBenchDomain[] = opts.domains ?? ["retail", "airline"];
  const base = join(workingDir, ".wotann", "benchmarks", "tau-bench");

  let tasks: TauBenchTask[] = [];
  let anyOnDisk = false;
  for (const domain of wantedDomains) {
    const path = join(base, `${domain}-tasks.jsonl`);
    if (existsSync(path)) {
      anyOnDisk = true;
      const lines = readFileSync(path, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
      const domainTasks = lines
        .map((l, i) => {
          try {
            return JSON.parse(l) as TauBenchTask;
          } catch {
            throw new Error(
              `${domain}-tasks.jsonl line ${i + 1} is not valid JSON: ${l.slice(0, 80)}`,
            );
          }
        })
        .filter(
          (t): t is TauBenchTask =>
            typeof t.id === "string" &&
            typeof t.userMessage === "string" &&
            (t.domain === "retail" || t.domain === "airline"),
        );
      tasks.push(...domainTasks);
    }
  }

  if (!anyOnDisk) {
    if (opts.requireCorpus) {
      throw new BlockedCorpusError({
        benchmark: "tau-bench",
        corpusPath: join(base, "retail-tasks.jsonl"),
        fetchCommand: TAU_BENCH_CORPUS_FETCH_COMMAND,
      });
    }
    const allSmoke = [...SMOKE_CORPUS];
    tasks = allSmoke.filter((t) => wantedDomains.includes(t.domain));
  }

  if (typeof opts.seed === "number") tasks = seededShuffle(tasks, opts.seed);
  if (typeof opts.limit === "number" && opts.limit > 0) tasks = tasks.slice(0, opts.limit);
  return tasks;
}

// ── Dry-run ───────────────────────────────────────────

export function dryRunTauBench(
  runtime: RunnerRuntime | null,
  workingDir: string,
  opts: { requireCorpus?: boolean; domains?: readonly TauBenchDomain[] } = {},
): DryRunReport {
  const checks: DryRunCheck[] = [];
  const wantedDomains: readonly TauBenchDomain[] = opts.domains ?? ["retail", "airline"];
  const base = join(workingDir, ".wotann", "benchmarks", "tau-bench");

  let anyOnDisk = false;
  for (const domain of wantedDomains) {
    const path = join(base, `${domain}-tasks.jsonl`);
    const exists = existsSync(path);
    if (exists) anyOnDisk = true;
    checks.push({
      name: `corpus-${domain}`,
      ok: exists || !opts.requireCorpus,
      detail: exists
        ? `found at ${path}`
        : opts.requireCorpus
          ? `missing — need real τ-bench ${domain} corpus`
          : `not found, will fall back to smoke corpus`,
    });
  }

  // Policy availability check (retail + airline ship built-in)
  for (const domain of wantedDomains) {
    const p = getPolicy(domain);
    checks.push({
      name: `policy-${domain}`,
      ok: p !== null,
      detail: p ? `built-in policy v${p.version}` : "no policy registered",
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
    const loadOpts: { requireCorpus?: boolean; domains?: readonly TauBenchDomain[] } = {};
    if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
    if (opts.domains !== undefined) loadOpts.domains = opts.domains;
    corpusSize = loadTauBenchTasks(workingDir, loadOpts).length;
  } catch (e) {
    blockedReason = e instanceof Error ? e.message : String(e);
  }

  // Suppress "no corpus found" noise when smoke fallback is acceptable:
  void anyOnDisk;
  const report: {
    benchmark: string;
    checks: readonly DryRunCheck[];
    corpusSize: number;
    blockedReason?: string;
  } = {
    benchmark: "tau-bench",
    checks,
    corpusSize,
  };
  if (blockedReason !== undefined) report.blockedReason = blockedReason;
  return makeDryRunReport(report);
}

// ── Runner ────────────────────────────────────────────

export interface RunTauBenchOptions {
  readonly limit?: number;
  readonly seed?: number;
  readonly domains?: readonly TauBenchDomain[];
  readonly model?: string;
  readonly threshold?: number;
  readonly totalBudgetMs?: number;
  readonly perTaskBudgetMs?: number;
  readonly requireCorpus?: boolean;
  /**
   * Policy-injection ablation. Default true (inject). Set false to run
   * the benchmark WITHOUT policy, which is the Sierra-baseline mode.
   */
  readonly injectPolicy?: boolean;
  /**
   * Optional per-domain policy overrides from disk. If provided, registers
   * the loaded policy in the custom slot and injects that instead of the
   * built-in. Useful when the upstream τ-bench corpus ships per-task
   * policies that differ from our condensed built-ins.
   */
  readonly policyOverrides?: Partial<Record<TauBenchDomain, string>>;
}

/**
 * Run τ-bench across retail + airline (or the subset requested via opts.domains).
 * For each task, injects the domain policy as a system-prompt preamble
 * (unless opts.injectPolicy === false) and calls runtime.query with the
 * constructed prompt + the task's user message.
 *
 * Emits TaskScoreEnvelope per task to ~/.wotann/bench-runs/<runId>.jsonl
 * including the policyId so the trajectory file is reproducible.
 */
export async function runTauBench(
  runtime: RunnerRuntime,
  workingDir: string,
  opts: RunTauBenchOptions = {},
): Promise<TauBenchReport> {
  const startedAt = Date.now();
  const runId = `tau-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const injectEnabled = opts.injectPolicy !== false; // default true

  // Load any per-domain override policies first so getPolicy resolves them.
  if (opts.policyOverrides) {
    for (const domain of Object.keys(opts.policyOverrides) as TauBenchDomain[]) {
      const overridePath = opts.policyOverrides[domain];
      if (overridePath) {
        const loaded = await loadPolicyFromFile(overridePath, {
          id: `tau-bench-${domain}-custom`,
          name: `τ-bench ${domain} (custom)`,
        });
        registerCustomPolicy(loaded);
      }
    }
  }

  const loadOpts: {
    limit?: number;
    seed?: number;
    domains?: readonly TauBenchDomain[];
    requireCorpus?: boolean;
  } = {};
  if (opts.limit !== undefined) loadOpts.limit = opts.limit;
  if (opts.seed !== undefined) loadOpts.seed = opts.seed;
  if (opts.domains !== undefined) loadOpts.domains = opts.domains;
  if (opts.requireCorpus !== undefined) loadOpts.requireCorpus = opts.requireCorpus;
  const tasks = loadTauBenchTasks(workingDir, loadOpts);

  const trajectory = openTrajectoryWriter(runId);
  trajectory.write({
    type: "run-start",
    runId,
    benchmark: "tau-bench",
    startedAt,
    totalTasks: tasks.length,
    policyInjectionEnabled: injectEnabled,
  });

  const results: TauBenchTaskResult[] = [];
  for (const task of tasks) {
    if (opts.totalBudgetMs !== undefined && Date.now() - startedAt > opts.totalBudgetMs) {
      trajectory.write({ type: "budget-exhausted", runId, elapsedMs: Date.now() - startedAt });
      break;
    }
    const taskStart = Date.now();
    const budget = opts.perTaskBudgetMs ?? task.timeBudgetMs ?? 300_000;

    const policy: PolicyDocument | null = injectEnabled ? getPolicy(task.domain) : null;
    const policyInjected = policy !== null;

    let transcript: string[] = [];
    let error: string | undefined;
    try {
      const userMessageCombined = [task.userMessage, ...(task.followUps ?? [])].join("\n\n");
      const basePrompt = [
        `You are a customer-service agent for ${task.domain === "retail" ? "a retail store" : "an airline"}.`,
        `Follow the active policy exactly. If the customer requests an exception,`,
        `state the policy and escalate only when the policy says to.`,
      ].join(" ");
      const systemPrompt = policy ? injectPolicy(basePrompt, policy) : basePrompt;

      const queryOpts: WotannQueryOptions = {
        prompt: `${systemPrompt}\n\n---\n\nUser message:\n${userMessageCombined}`,
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
        ? await runtime.verifyCompletion(task.userMessage, verifyOpts)
        : { completed: false, score: 0, evidence: [] as readonly VerificationEvidence[] };

    const durationMs = Date.now() - taskStart;
    const result: TauBenchTaskResult = {
      task,
      completed: verdict.completed,
      score: verdict.score,
      evidence: verdict.evidence,
      transcript,
      durationMs,
      policyInjected,
      ...(policy !== null ? { policyId: policy.id } : {}),
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
        domain: task.domain,
        policyInjected,
        policyId: policy?.id,
        ...(error !== undefined ? { error } : {}),
      },
    };
    trajectory.write({ type: "task-result", ...envelope });
  }

  const finishedAt = Date.now();
  const completedTasks = results.filter((r) => r.completed).length;
  const byDomain: Record<TauBenchDomain, { total: number; completed: number }> = {
    retail: { total: 0, completed: 0 },
    airline: { total: 0, completed: 0 },
  };
  for (const r of results) {
    byDomain[r.task.domain].total += 1;
    if (r.completed) byDomain[r.task.domain].completed += 1;
  }
  const passAt1 = results.length > 0 ? completedTasks / results.length : 0;

  trajectory.write({
    type: "run-end",
    runId,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    byDomain,
    policyInjectionEnabled: injectEnabled,
  });

  return {
    runId,
    startedAt,
    finishedAt,
    totalTasks: results.length,
    completedTasks,
    passAt1,
    byDomain,
    results,
    trajectoryPath: trajectory.path,
    policyInjectionEnabled: injectEnabled,
  };
}

// ── Smoke Corpus ──────────────────────────────────────

/**
 * Built-in 8-task smoke corpus (4 retail + 4 airline). Each task exercises
 * a compliance rule where policy injection materially changes the correct
 * answer. Useful for testing the ablation switch.
 */
const SMOKE_CORPUS: readonly TauBenchTask[] = [
  // ── Retail ────────────────────────────────────────────
  {
    id: "tau-retail-01",
    domain: "retail",
    userMessage:
      "I bought a gift card 3 days ago and haven't used it yet. Can I get a refund on the original credit card?",
    referenceResolution:
      "Policy-correct: gift cards are NEVER refundable, regardless of use. Agent should decline politely and explain policy.",
    timeBudgetMs: 120_000,
  },
  {
    id: "tau-retail-02",
    domain: "retail",
    userMessage:
      "My item arrived broken. I have photos. What are my options? I bought it 45 days ago.",
    referenceResolution:
      "Damaged-in-transit → full refund OR replacement regardless of window. 45-day limit does not apply here.",
    timeBudgetMs: 120_000,
  },
  {
    id: "tau-retail-03",
    domain: "retail",
    userMessage:
      "I'm returning a $2000 TV I opened last week. Original packaging, everything included.",
    referenceResolution:
      "Electronics restocking fee applies: 10% ($200). Refund goes to original payment method. Agent should quote exact amount.",
    timeBudgetMs: 120_000,
  },
  {
    id: "tau-retail-04",
    domain: "retail",
    userMessage: "I'd like a $600 refund but I lost the receipt. Is that possible?",
    referenceResolution:
      "Above $500 without receipt → escalate to supervisor. Agent should not process unilaterally.",
    timeBudgetMs: 120_000,
  },
  // ── Airline ───────────────────────────────────────────
  {
    id: "tau-airline-01",
    domain: "airline",
    userMessage:
      "I booked a Basic Economy ticket 2 weeks ago and need to cancel. What's my refund?",
    referenceResolution:
      "Basic Economy is non-refundable outside the 24-hour rule. Agent should state policy plainly and not negotiate.",
    timeBudgetMs: 120_000,
  },
  {
    id: "tau-airline-02",
    domain: "airline",
    userMessage: "My flight was cancelled due to a thunderstorm. I want a hotel voucher.",
    referenceResolution:
      "Weather cancellation → rebook + no fare difference. NO hotel voucher (weather is not airline-controlled).",
    timeBudgetMs: 120_000,
  },
  {
    id: "tau-airline-03",
    domain: "airline",
    userMessage: "I'm Platinum status. How many checked bags do I get for free?",
    referenceResolution: "Platinum status → 2 free checked bags.",
    timeBudgetMs: 120_000,
  },
  {
    id: "tau-airline-04",
    domain: "airline",
    userMessage: "I booked a First-class ticket 3 hours ago and want to cancel for a full refund.",
    referenceResolution:
      "24-hour rule: any ticket booked in last 24 hours is fully refundable. Agent should issue full refund to original form of payment.",
    timeBudgetMs: 120_000,
  },
];
