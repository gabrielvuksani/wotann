/**
 * Sleep-time Agent — amortize compute during idle periods (V9 T11.2).
 *
 * Per Letta's research paper "Sleep-time Compute: Beyond Inference Scaling at
 * Test-time" (arxiv.org/html/2504.13171v1): measured 2.5× cost savings,
 * 5× compute, 18% accuracy improvements vs. baseline test-time-only scaling.
 *
 * WOTANN's autodream.ts provides ~80% of the mechanism (recall/analyze/
 * consolidate). This module adds the *scheduling* layer: detect idle
 * opportunities, sort tasks by priority, and execute under budget +
 * duration + abort constraints while respecting dependency ordering.
 *
 * Pure-logic: the actual LLM call (or whatever the task does) is injected
 * via `taskExecutor`. That keeps this module testable without network,
 * reusable across agents (Workshop, Autopilot, background daemon), and
 * honest about cost accounting (QB #6).
 *
 * Quality bars enforced:
 *   QB #6  honest failures     — executor throws are captured, cost still counted
 *   QB #7  per-call state      — each createSleepTimeAgent returns fresh closure
 *   QB #13 env guard           — no process.env reads anywhere
 */

// ── Public Types ───────────────────────────────────────────

/**
 * What kind of idle window was detected.
 *
 * - `user-away`: UI has been idle (no keypress / mouse) past a threshold.
 * - `long-turn-gap`: Agent finished a turn; no follow-up after delay.
 * - `explicit-trigger`: Caller invoked `runIdleSession` deliberately
 *   (e.g. a cron tick or a `wotann dream` command).
 * - `scheduled-maintenance`: Daemon's nightly consolidation window.
 */
export type IdleSignal =
  | "user-away"
  | "long-turn-gap"
  | "explicit-trigger"
  | "scheduled-maintenance";

export interface SleepTimeOpportunity {
  readonly signal: IdleSignal;
  readonly detectedAt: number;
  readonly estimatedIdleMs: number;
  readonly lastSeenActivity?: number;
}

/**
 * A unit of work the agent can perform while the user is away.
 *
 * - `memory-consolidation`: run the dream pipeline (or a slice of it).
 * - `plan-rehearsal`: precompute the next few steps of a likely next turn.
 * - `cache-warmup`: prefetch docs/embeddings for anticipated queries.
 * - `proactive-retrieval`: fetch references the user asked about recently.
 */
export interface SleepTimeTask {
  readonly id: string;
  readonly kind: "memory-consolidation" | "plan-rehearsal" | "cache-warmup" | "proactive-retrieval";
  /** 0 = lowest, 100 = highest. Higher runs first. */
  readonly priority: number;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
  /** Task IDs that must complete before this one runs. */
  readonly dependencies?: readonly string[];
  /** Opaque payload — executor-specific. */
  readonly payload: unknown;
}

export interface SleepTimeResult {
  readonly taskId: string;
  readonly ok: boolean;
  readonly outputSummary: string;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly error?: string;
}

export interface SleepSessionReport {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly results: readonly SleepTimeResult[];
  readonly aborted: boolean;
  readonly abortReason?: string;
}

export interface SleepTimeAgentOptions {
  /**
   * The function that actually runs a task. Receives the task, returns a
   * result. May throw — throws are captured by the agent as `ok: false`.
   *
   * This is the dependency-injection seam. In production it calls the
   * provider router + middleware pipeline; in tests it's a `vi.fn()`.
   */
  readonly taskExecutor: (task: SleepTimeTask) => Promise<SleepTimeResult>;
  /** Hard cap on cumulative cost per session. Default 0.50. */
  readonly budgetUsd?: number;
  /** Hard cap on wall-clock duration per session. Default 60_000. */
  readonly maxDurationMs?: number;
  /** Optional external abort. If signaled, session stops after current task. */
  readonly abortSignal?: AbortSignal;
  /** Clock for deterministic testing. Default `() => Date.now()`. */
  readonly now?: () => number;
  /** Streaming callback; fires once per completed task. */
  readonly onProgress?: (result: SleepTimeResult) => void;
}

export interface SleepTimeAgent {
  readonly submit: (task: SleepTimeTask) => void;
  readonly queueLength: () => number;
  readonly runIdleSession: (opportunity: SleepTimeOpportunity) => Promise<SleepSessionReport>;
  readonly clearQueue: () => number;
}

// ── Defaults ───────────────────────────────────────────────

const DEFAULT_BUDGET_USD = 0.5;
const DEFAULT_MAX_DURATION_MS = 60_000;

// ── Factory ────────────────────────────────────────────────

/**
 * Create a fresh sleep-time agent with its own queue and closure state.
 *
 * Per QB #7 every call returns a brand-new instance — no module-level
 * globals, so two agents in the same process never share work.
 */
export function createSleepTimeAgent(options: SleepTimeAgentOptions): SleepTimeAgent {
  const budgetUsd = options.budgetUsd ?? DEFAULT_BUDGET_USD;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const now = options.now ?? (() => Date.now());
  const { taskExecutor, abortSignal, onProgress } = options;

  // Per-instance mutable state (encapsulated — not exported).
  const queue: SleepTimeTask[] = [];

  const submit = (task: SleepTimeTask): void => {
    queue.push(task);
  };

  const queueLength = (): number => queue.length;

  const clearQueue = (): number => {
    const cleared = queue.length;
    queue.length = 0;
    return cleared;
  };

  const runIdleSession = async (opportunity: SleepTimeOpportunity): Promise<SleepSessionReport> => {
    const startedAt = now();
    const results: SleepTimeResult[] = [];
    const completedIds = new Set<string>();

    let cumulativeCostUsd = 0;
    let aborted = false;
    let abortReason: string | undefined;

    // Sort the queue by priority desc, then cost asc. We sort a snapshot
    // so that new submits during execution don't reshuffle in-flight
    // ordering. The snapshot is re-taken between passes so new deps
    // unlocked by a completed task can be considered.
    //
    // We use a two-pass dependency resolver: any task whose deps aren't
    // yet satisfied is deferred. After a full scan, if at least one
    // task ran, we scan again. If no task ran in a scan, remaining
    // tasks are genuinely blocked (cyclic or external deps) and we stop.
    //
    // Opportunity is currently unused beyond being recorded implicitly
    // via timing. Future: use `estimatedIdleMs` to short-circuit queue
    // ordering (skip expensive tasks in short windows).
    void opportunity;

    const deferred: SleepTimeTask[] = [...queue];
    queue.length = 0; // drain

    const depsSatisfied = (task: SleepTimeTask): boolean => {
      if (!task.dependencies || task.dependencies.length === 0) return true;
      for (const dep of task.dependencies) {
        if (!completedIds.has(dep)) return false;
      }
      return true;
    };

    while (deferred.length > 0) {
      // Snapshot + sort: priority desc (high first), cost asc (cheap first)
      // among equal priorities. We sort after each pass because a prior
      // task's completion may unlock a dep and we want the next round
      // to reconsider priority fairly.
      deferred.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.estimatedCostUsd - b.estimatedCostUsd;
      });

      let ranThisPass = 0;
      // We iterate over a copy so that splicing doesn't disturb iteration.
      const pass: SleepTimeTask[] = [...deferred];

      for (const task of pass) {
        // Re-check abort + budget + duration at each task.
        if (abortSignal?.aborted) {
          aborted = true;
          abortReason = "external-abort";
          break;
        }
        if (cumulativeCostUsd >= budgetUsd) {
          aborted = true;
          abortReason = "budget-exceeded";
          break;
        }
        const elapsed = now() - startedAt;
        if (elapsed >= maxDurationMs) {
          aborted = true;
          abortReason = "duration-exceeded";
          break;
        }

        if (!depsSatisfied(task)) {
          // Leave in deferred list; will be retried next pass.
          continue;
        }

        // Remove from deferred — it's about to run.
        const idx = deferred.indexOf(task);
        if (idx >= 0) deferred.splice(idx, 1);

        const result = await runTaskHonest(task, taskExecutor, now);
        results.push(result);
        completedIds.add(task.id);
        // QB #6 honest accounting: count cost even on failure.
        cumulativeCostUsd += result.costUsd;
        ranThisPass++;

        try {
          onProgress?.(result);
        } catch {
          // onProgress is user code — must not break the session.
        }
      }

      if (aborted) break;

      // No task ran AND none were even executed → all remaining are blocked.
      if (ranThisPass === 0) {
        break;
      }
    }

    const endedAt = now();
    return {
      startedAt,
      endedAt,
      results,
      aborted,
      ...(abortReason !== undefined ? { abortReason } : {}),
    };
  };

  return {
    submit,
    queueLength,
    runIdleSession,
    clearQueue,
  };
}

// ── Internals ──────────────────────────────────────────────

/**
 * Execute a single task with honest error handling.
 *
 * QB #6: if the executor throws, we still return a result with
 * `ok: false`, the error message, and whatever cost was accrued
 * (we conservatively take the task's estimated cost as a floor so
 * a silently-failing expensive task can't pretend to be free).
 */
async function runTaskHonest(
  task: SleepTimeTask,
  executor: (task: SleepTimeTask) => Promise<SleepTimeResult>,
  now: () => number,
): Promise<SleepTimeResult> {
  const startedAt = now();
  try {
    const result = await executor(task);
    // Trust the executor's numbers but defend against NaN / negatives.
    const costUsd =
      Number.isFinite(result.costUsd) && result.costUsd >= 0
        ? result.costUsd
        : task.estimatedCostUsd;
    const durationMs =
      Number.isFinite(result.durationMs) && result.durationMs >= 0
        ? result.durationMs
        : now() - startedAt;
    return {
      taskId: result.taskId,
      ok: result.ok,
      outputSummary: result.outputSummary,
      durationMs,
      costUsd,
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      ok: false,
      outputSummary: "",
      durationMs: now() - startedAt,
      costUsd: task.estimatedCostUsd, // honest: charge the floor
      error: message,
    };
  }
}
