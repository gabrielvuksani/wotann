/**
 * `wotann best-of-n` — Cursor 3 `/best-of-n` slash-command port (P1-C6).
 *
 * Spawns N parallel agent rollouts on the same task spec, then runs
 * every surviving rollout through the P1-B10 CriticRerank to pick a
 * winner. Each rollout is (optionally) executed inside a per-rollout
 * worktree so changes stay isolated until the winner is promoted.
 *
 * This module is dependency-injected end-to-end:
 *   - generator: how to run a rollout (caller supplies an LLM driver)
 *   - critic:    the judge that scores candidates (caller supplies an LLM)
 *   - isolate:   optional WorktreeManager for per-rollout isolation
 *
 * The command shell therefore has zero LLM/provider knowledge — the
 * entrypoint (src/index.ts) will wire a default generator/critic from
 * the runtime's active provider.
 *
 * WOTANN quality bars:
 * - QB #6 honest failures: `AllRolloutsFailed` from CriticRerank is
 *   surfaced verbatim to the caller; critic errors are in `errors[]`.
 * - QB #7 per-session state: each `runBestOfN` call owns its own
 *   worktree map through the injected manager (or a fresh default).
 */

import {
  AllRolloutsFailed,
  CriticRerank,
  type CriticJudge,
  type CriticTask,
  type RerankError,
  type RerankEvent,
  type RerankResult,
  type Rollout,
  type RollouGenerator,
  type ScoredRollout,
} from "../../orchestration/critic-rerank.js";
import { WorktreeManager } from "../../orchestration/worktree-manager.js";

// ── Public types ───────────────────────────────────────────

/**
 * A per-rollout adapter the caller provides. The `workspaceRoot` is
 * either a per-rollout worktree path (if isolation is enabled) or
 * undefined (rollouts share the caller's cwd).
 */
export type BestOfNRolloutFn = (
  task: CriticTask,
  index: number,
  workspaceRoot: string | undefined,
) => Promise<Rollout>;

export interface BestOfNCommandOptions {
  readonly task: CriticTask;
  /** Number of parallel rollouts. Default 3. */
  readonly N?: number;
  /** Per-rollout generator (e.g. `(task, i) => provider.complete(task.task)`). */
  readonly rollout: BestOfNRolloutFn;
  /** Critic for scoring candidates. */
  readonly critic: CriticJudge;
  /** If true, every rollout runs in its own worktree. Default false. */
  readonly isolate?: boolean;
  /** Override the WorktreeManager used for isolation (tests). */
  readonly worktreeManager?: WorktreeManager;
  /** Base task id for generated worktree ids (`<id>-r<N>`). */
  readonly taskIdPrefix?: string;
  /** Event sink for observability. */
  readonly onEvent?: (event: BestOfNEvent) => void;
  /** Per-rollout generation timeout. Default 120_000. */
  readonly perRolloutTimeoutMs?: number;
}

export type BestOfNEvent =
  | { readonly kind: "worktree.created"; readonly index: number; readonly workspace: string }
  | { readonly kind: "worktree.abandoned"; readonly index: number }
  | { readonly kind: "rerank"; readonly inner: RerankEvent };

export interface BestOfNResult {
  readonly success: boolean;
  readonly winner: ScoredRollout | null;
  readonly rollouts: readonly ScoredRollout[];
  readonly errors: readonly RerankError[];
  readonly rationale: string;
  readonly lines: readonly string[];
  readonly allFailed?: {
    readonly reasons: readonly string[];
  };
}

// ── Entry point ────────────────────────────────────────────

export async function runBestOfN(options: BestOfNCommandOptions): Promise<BestOfNResult> {
  const N = options.N ?? 3;
  if (!Number.isInteger(N) || N < 1) {
    throw new Error(`N must be a positive integer, got ${N}`);
  }

  const isolate = options.isolate === true;
  const manager = options.worktreeManager ?? (isolate ? new WorktreeManager() : undefined);
  const prefix = options.taskIdPrefix ?? `bon-${Date.now().toString(36)}`;
  const onEvent = options.onEvent ?? (() => {});

  // Track every worktree we spin up so we can cleanly discard losers
  // at the end even if the generator throws.
  const createdTaskIds: string[] = [];

  const generator: RollouGenerator = async (task, index) => {
    let workspace: string | undefined;
    if (isolate && manager) {
      const taskId = `${prefix}-r${index}`;
      const entry = await manager.create(taskId);
      workspace = entry.workspaceRoot;
      createdTaskIds.push(taskId);
      onEvent({ kind: "worktree.created", index, workspace });
    }
    return options.rollout(task, index, workspace);
  };

  const rerank = new CriticRerank({
    generator,
    critic: options.critic,
    N,
    ...(options.perRolloutTimeoutMs !== undefined
      ? { perRolloutTimeoutMs: options.perRolloutTimeoutMs }
      : {}),
    onEvent: (e) => onEvent({ kind: "rerank", inner: e }),
  });

  let rerankResult: RerankResult;
  try {
    rerankResult = await rerank.rerank(options.task);
  } catch (err) {
    // Abandon any worktrees we spun up so a partial failure doesn't
    // pollute the checkout. Honest failure path.
    await abandonAll(manager, createdTaskIds, onEvent);
    if (err instanceof AllRolloutsFailed) {
      return {
        success: false,
        winner: null,
        rollouts: [],
        errors: err.reasons.map(
          (reason, index) => ({ index, stage: "generator", reason }) as const,
        ),
        rationale: err.message,
        lines: [
          `✗ best-of-${N} failed: all rollouts errored`,
          ...err.reasons.slice(0, N).map((r, i) => `  #${i} ${truncate(r, 120)}`),
        ],
        allFailed: { reasons: err.reasons },
      };
    }
    throw err;
  }

  // Abandon losing worktrees. Winner's workspace is intentionally kept
  // for the caller to accept (merge) later — the command shell only
  // picks the winner; promotion is a separate `wotann worktree accept`.
  if (manager) {
    const winnerTaskId =
      rerankResult.winner !== null ? `${prefix}-r${rerankResult.winner.index}` : null;
    const losers = createdTaskIds.filter((id) => id !== winnerTaskId);
    await abandonAll(manager, losers, onEvent);
  }

  return {
    success: rerankResult.winner !== null,
    winner: rerankResult.winner,
    rollouts: rerankResult.rollouts,
    errors: rerankResult.errors,
    rationale: rerankResult.rationale,
    lines: renderReport(N, rerankResult, isolate ? prefix : undefined),
  };
}

// ── Internals ──────────────────────────────────────────────

async function abandonAll(
  manager: WorktreeManager | undefined,
  taskIds: readonly string[],
  onEvent: (event: BestOfNEvent) => void,
): Promise<void> {
  if (!manager) return;
  for (let i = 0; i < taskIds.length; i++) {
    const id = taskIds[i];
    if (!id) continue;
    try {
      await manager.abandon(id);
      onEvent({ kind: "worktree.abandoned", index: i });
    } catch {
      // Swallow: abandon is best-effort cleanup. The error already
      // surfaced on the create/rollout path if it matters.
    }
  }
}

function renderReport(
  N: number,
  result: RerankResult,
  worktreePrefix: string | undefined,
): string[] {
  const lines: string[] = [];
  if (result.winner) {
    lines.push(
      `✓ best-of-${N} picked rollout #${result.winner.index} (score=${result.winner.score})`,
    );
    if (worktreePrefix) {
      lines.push(`  winner worktree: ${worktreePrefix}-r${result.winner.index}`);
    }
  } else {
    lines.push(`✗ best-of-${N} no winner — every rollout errored in critic stage`);
  }
  lines.push(`  rationale: ${result.rationale}`);
  lines.push(`  rollouts:  ${result.rollouts.length}/${N} scored`);
  if (result.errors.length > 0) {
    lines.push(`  errors:    ${result.errors.length}`);
    for (const e of result.errors.slice(0, 5)) {
      lines.push(`    #${e.index}/${e.stage}: ${truncate(e.reason, 100)}`);
    }
  }
  return lines;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
