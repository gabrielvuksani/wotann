/**
 * Cowork — multi-agent pattern where a lead dispatches N workers on DISJOINT
 * scopes and aggregates their results. (Anthropic Cowork GA 2026-04-09.)
 *
 * WHAT
 *   Pure-logic layer — task decomposition, bounded-concurrency worker
 *   lifecycle, and result aggregation. This module ships the three
 *   building blocks; callers wire them together (coordinator.ts stays
 *   untouched). A production wiring would plug an LLM-backed decomposer
 *   and real subagent executors into `CoworkWorker.execute`.
 *
 * WHY
 *   `parallel-coordinator.ts` already fans out tasks but has no notion of
 *   SCOPE — every agent can touch anything. Cowork is different: the
 *   decomposition step records the file paths / logical boundaries each
 *   subtask owns, the aggregation step detects overlaps, and the caller
 *   gets a structured report with a `scopeConflicts` channel instead of
 *   silently stomped writes.
 *
 * V9 reference
 *   MASTER_PLAN_V9.md line 3800 — "Cowork multi-agent (Anthropic Cowork
 *   GA Apr 9) | 3-4d, 500-700 LOC | src/orchestration/cowork.ts —
 *   extends coordinator.ts".
 *
 * WOTANN quality bars this module upholds
 *   QB #6  honest failure envelopes — a worker that throws becomes
 *          `{ok: false, error}` in its `CoworkResult`, never a rejected
 *          promise from `runCoworkers`, never a silently-swallowed noop.
 *   QB #7  zero module-level state — every function is pure on its
 *          arguments. Two concurrent cowork runs never share state.
 *   QB #13 zero `process.env` reads — the clock is injected via `now`,
 *          concurrency is passed as config, abort via `AbortSignal`.
 *
 * Code style
 *   Follows coordinator.ts conventions: readonly fields, interface-per-
 *   shape, JSDoc-dense, pure functions where possible, no ad-hoc state.
 */

// ── Layer 1: Decomposition ─────────────────────────────────

/**
 * Root task handed to the lead agent. `scope` names the file paths or
 * logical boundaries this task owns; the decomposer will split the
 * scope amongst subtasks.
 */
export interface CoworkTask {
  readonly id: string;
  readonly description: string;
  readonly scope: readonly string[];
  readonly maxWorkers?: number;
}

/**
 * One piece of the decomposition. `parentId` MUST equal the root task's
 * id; `decomposeTask` rejects self-referential splits where a subtask
 * claims to be its own parent.
 */
export interface CoworkSubtask {
  readonly id: string;
  readonly parentId: string;
  readonly description: string;
  readonly scope: readonly string[];
}

/**
 * Output of the decomposition step.
 *
 * `overlapping` reports scope strings that appear in two or more
 * subtasks — these are flagged (not rejected) so the caller can decide
 * whether to serialize those workers, merge the subtasks, or tolerate
 * the overlap and rely on the aggregation-step conflict detector to
 * report back what actually happened.
 */
export interface CoworkPlan {
  readonly rootTask: CoworkTask;
  readonly subtasks: readonly CoworkSubtask[];
  readonly overlapping: readonly string[];
}

/**
 * Splitter function — INJECTED so production can wire an LLM-backed
 * decomposer while tests pass deterministic stubs. `decomposeTask`
 * never itself calls a model; it only validates the splitter's output.
 */
export type CoworkDecomposer = (task: CoworkTask) => readonly CoworkSubtask[];

/**
 * Decompose `task` into subtasks by invoking `decomposer`, then
 * validate the output and compute overlapping scopes.
 *
 * Rejections (throws `Error`):
 *   - Any subtask's `parentId` is not equal to `task.id` — a splitter
 *     returning self-referential subtasks is a bug, not a silent
 *     degradation (QB #6).
 *   - Duplicate subtask ids within the same decomposition.
 *
 * An empty subtask list is valid: caller may interpret it as "no split
 * possible, run the root as a single worker".
 */
export function decomposeTask(task: CoworkTask, decomposer: CoworkDecomposer): CoworkPlan {
  const subtasks = decomposer(task);

  // QB #6: reject illegal decompositions loudly, not silently.
  const seenIds = new Set<string>();
  for (const sub of subtasks) {
    if (sub.parentId !== task.id) {
      throw new Error(
        `cowork decomposition: subtask ${sub.id} has parentId=${sub.parentId} but root task id=${task.id}`,
      );
    }
    if (seenIds.has(sub.id)) {
      throw new Error(`cowork decomposition: duplicate subtask id ${sub.id}`);
    }
    seenIds.add(sub.id);
  }

  return {
    rootTask: task,
    subtasks,
    overlapping: computeOverlappingScopes(subtasks),
  };
}

// ── Layer 2: Execution ─────────────────────────────────────

/**
 * One worker, one subtask. `execute` is a thunk; the caller can close
 * over provider calls, sandbox handles, LLM sessions, etc. A worker is
 * allowed to throw — the pool converts the throw to an `ok:false`
 * result.
 */
export interface CoworkWorker {
  readonly subtaskId: string;
  readonly execute: () => Promise<CoworkResult>;
}

/**
 * Result envelope. Honest failure surface: a worker that throws surfaces
 * as `ok:false` with the error message, never as a silent success.
 */
export type CoworkResult =
  | {
      readonly ok: true;
      readonly subtaskId: string;
      readonly output: string;
      readonly metadata?: Record<string, unknown>;
    }
  | {
      readonly ok: false;
      readonly subtaskId: string;
      readonly error: string;
    };

/**
 * Aggregate run report. `results` is in worker-start order (stable when
 * workers are scheduled in list order; may interleave on completion).
 */
export interface CoworkExecution {
  readonly results: readonly CoworkResult[];
  readonly durationMs: number;
  readonly successCount: number;
  readonly failureCount: number;
}

/**
 * Options for `runCoworkers`.
 *
 * `concurrency` defaults to min(workers.length, 4). Clamped to at least
 * 1 when set.
 *
 * `abortSignal` cancels workers that haven't started yet — the pool
 * stops pulling new workers from the queue. Workers already in flight
 * run to completion (we don't have a generic abort mechanism for the
 * injected `execute` thunk; caller closes over their own cancel token
 * if they want in-flight cancellation).
 *
 * `now` is an injected clock for deterministic tests (QB #13: never
 * read `Date.now` directly when it's measurable via injection).
 */
export interface RunCoworkersOptions {
  readonly concurrency?: number;
  readonly abortSignal?: AbortSignal;
  readonly now?: () => number;
}

const DEFAULT_MAX_CONCURRENCY = 4;

/**
 * Bounded-concurrency worker pool. Pure wrt its args — zero module
 * state, one closure per call.
 *
 * Contract:
 *   - All input workers produce exactly one `CoworkResult` in the
 *     output `results[]`, unless they were aborted before starting
 *     (then they don't appear — aborted workers are NOT reported as
 *     successes).
 *   - A worker that throws produces an `ok:false` entry; `runCoworkers`
 *     itself never rejects for that reason.
 *   - `successCount + failureCount === results.length`.
 */
export async function runCoworkers(
  workers: readonly CoworkWorker[],
  options: RunCoworkersOptions = {},
): Promise<CoworkExecution> {
  const now = options.now ?? Date.now;
  const startedAt = now();

  if (workers.length === 0) {
    return {
      results: [],
      durationMs: now() - startedAt,
      successCount: 0,
      failureCount: 0,
    };
  }

  const rawConcurrency = options.concurrency ?? Math.min(workers.length, DEFAULT_MAX_CONCURRENCY);
  const concurrency = Math.max(1, Math.min(rawConcurrency, workers.length));

  const results: CoworkResult[] = [];
  let nextIdx = 0;

  const runOne = async (worker: CoworkWorker): Promise<void> => {
    try {
      const result = await worker.execute();
      results.push(result);
    } catch (err) {
      results.push({
        ok: false,
        subtaskId: worker.subtaskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const workerLoop = async (): Promise<void> => {
    while (true) {
      // QB #6: honour abort before pulling the next task, not in the
      // middle of one — in-flight workers complete honestly.
      if (options.abortSignal?.aborted) return;
      const idx = nextIdx++;
      if (idx >= workers.length) return;
      const worker = workers[idx];
      if (worker === undefined) return;
      await runOne(worker);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));

  const successCount = results.filter((r) => r.ok).length;
  return {
    results,
    durationMs: now() - startedAt,
    successCount,
    failureCount: results.length - successCount,
  };
}

// ── Layer 3: Aggregation ───────────────────────────────────

/**
 * Merge strategy for aggregating parallel worker outputs. Callers pass
 * a `merge` function that fuses the raw result list into a domain type
 * `T` (text blob, diff, JSON map, whatever makes sense for the task).
 *
 * `onConflict` fires when `aggregateCowork` detects that two or more
 * SUCCEEDED workers share a scope — the caller can decide to log it,
 * serialize a second pass, or accept the conflict.
 */
export interface CoworkAggregationOptions<T> {
  readonly merge: (results: readonly CoworkResult[]) => T;
  readonly onConflict?: (conflictingScopes: readonly string[]) => void;
}

/**
 * Aggregated output. `scopeConflicts` reports scopes claimed by two or
 * more SUCCESSFUL workers — unsuccessful workers' scopes are excluded
 * because a failed worker didn't actually write anything.
 */
export interface CoworkAggregation<T> {
  readonly output: T;
  readonly scopeConflicts: readonly string[];
  readonly partialFailure: boolean;
}

/**
 * Final step: take the plan + the execution report, and fuse the
 * results. Detects scope conflicts on the succeeded workers only and
 * flags partial failure if ANY worker failed.
 */
export function aggregateCowork<T>(
  plan: CoworkPlan,
  execution: CoworkExecution,
  options: CoworkAggregationOptions<T>,
): CoworkAggregation<T> {
  const output = options.merge(execution.results);

  const succeededIds = new Set(execution.results.filter((r) => r.ok).map((r) => r.subtaskId));
  const succeededSubtasks = plan.subtasks.filter((s) => succeededIds.has(s.id));
  const scopeConflicts = computeOverlappingScopes(succeededSubtasks);

  if (scopeConflicts.length > 0) {
    options.onConflict?.(scopeConflicts);
  }

  return {
    output,
    scopeConflicts,
    partialFailure: execution.failureCount > 0,
  };
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Given a list of subtasks, return the scope strings that appear in
 * two or more of them. Order is deterministic (insertion order from
 * the first occurrence of each duplicated scope).
 */
function computeOverlappingScopes(subtasks: readonly CoworkSubtask[]): readonly string[] {
  const seenOnce = new Set<string>();
  const overlappingOrder: string[] = [];
  const overlappingSet = new Set<string>();

  for (const sub of subtasks) {
    for (const scope of sub.scope) {
      if (seenOnce.has(scope) && !overlappingSet.has(scope)) {
        overlappingSet.add(scope);
        overlappingOrder.push(scope);
      }
      seenOnce.add(scope);
    }
  }

  return overlappingOrder;
}

/**
 * Convenience: a pass-through merge for callers that just want the raw
 * results. Equivalent to `merge: (r) => r` but typed as `readonly
 * CoworkResult[]` so callers don't need the annotation at the call
 * site.
 */
export function passthroughMerge(results: readonly CoworkResult[]): readonly CoworkResult[] {
  return results;
}
