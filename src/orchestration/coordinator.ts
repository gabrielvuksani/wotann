/**
 * Coordinator Mode: Research → Spec → Implement → Verify.
 * Max 3 subagents, git worktree isolation per worker.
 *
 * P2 migration: the canonical phase ordering now lives in a PhasedExecutor
 * instance (see phased-executor.ts). All of Coordinator's existing public
 * API is preserved verbatim; `getPhases()` is added as the canonical
 * single-source-of-truth for the phase list.
 */

import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { GraphBuilder, executeGraph, type ExecutionGraph } from "./graph-dsl.js";
import {
  coordinateParallel,
  defaultSynthesizer,
  type AgentTask as ParallelAgentTask,
  type CoordinatedOutcome,
  type Synthesizer,
} from "./parallel-coordinator.js";
import { PhasedExecutor } from "./phased-executor.js";
// V9 T14.7 — Anthropic Cowork pattern: lead dispatches N workers on
// DISJOINT scopes. Wired as a third execution strategy alongside
// "graph" and "parallel". Pure-logic layer — every dependency is
// injected at executeCowork time.
import {
  decomposeTask,
  runCoworkers,
  aggregateCowork,
  passthroughMerge,
  type CoworkTask,
  type CoworkSubtask,
  type CoworkWorker,
  type CoworkResult,
  type CoworkAggregation,
  type CoworkDecomposer,
} from "./cowork.js";

export interface CoordinatorTask {
  readonly id: string;
  readonly description: string;
  readonly files: readonly string[];
  readonly phase: "research" | "spec" | "implement" | "verify";
  readonly assignedAgent?: string;
  readonly status: "pending" | "running" | "completed" | "failed";
}

export interface CoordinatorConfig {
  readonly maxSubagents: number;
  readonly useWorktrees: boolean;
  readonly verifyAfterEach: boolean;
  readonly worktreeRoot?: string;
  /**
   * Execution strategy: "graph" (default — phased DAG via executeWithGraph),
   * "parallel" (N-agent fan-out + synthesis via ParallelCoordinator), or
   * "cowork" (V9 T14.7 — disjoint-scope decomposition + bounded-concurrency
   * pool + scope-conflict aggregation via cowork.ts).
   */
  readonly strategy?: "graph" | "parallel" | "cowork";
}

export interface CoordinatorWorktree {
  readonly taskId: string;
  readonly branch: string;
  readonly path: string;
}

/** Canonical phase ordering for Coordinator — keep in sync with CoordinatorTask.phase. */
const COORDINATOR_PHASES = ["research", "spec", "implement", "verify"] as const;
type CoordinatorPhase = (typeof COORDINATOR_PHASES)[number];

export class Coordinator {
  private readonly tasks: Map<string, CoordinatorTask> = new Map();
  private readonly worktrees: Map<string, CoordinatorWorktree> = new Map();
  private readonly config: CoordinatorConfig;
  private activeWorkers: number = 0;

  /**
   * The canonical phase walker (P2 migration). Coordinator doesn't use
   * `run()` directly — it uses the executor as the single source of truth
   * for phase ordering and transition validation, while preserving its
   * graph-based execution strategy. Per-session: constructed once per
   * Coordinator instance; `buildExecutionGraph()` and `executeWithGraph()`
   * consult this for the authoritative phase list.
   */
  private readonly phasedExecutor: PhasedExecutor<
    CoordinatorPhase,
    { readonly tasksVisited: readonly string[] }
  >;

  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = {
      maxSubagents: config.maxSubagents ?? 3,
      useWorktrees: config.useWorktrees ?? true,
      verifyAfterEach: config.verifyAfterEach ?? true,
      strategy: config.strategy ?? "graph",
      ...(config.worktreeRoot !== undefined ? { worktreeRoot: config.worktreeRoot } : {}),
    };

    // PhasedExecutor as the single-source-of-truth for phase ordering +
    // transition validation. Handlers are no-ops here: Coordinator's
    // actual work is DAG-based (executeWithGraph), not phase-handler-based.
    // What we gain is: one authoritative phase list, free transition
    // validation for future phase-aware tooling (phase-gate, plateau
    // detector, long-horizon), and honest error types when something
    // tries to transition illegally.
    this.phasedExecutor = new PhasedExecutor({
      phases: COORDINATOR_PHASES,
      handlers: {
        research: async (ctx) => ctx,
        spec: async (ctx) => ctx,
        implement: async (ctx) => ctx,
        verify: async (ctx) => ctx,
      },
    });
  }

  /**
   * Return the canonical phase ordering, sourced from PhasedExecutor.
   * External consumers (UI, telemetry, progress reporters) can iterate
   * this to render progress in the correct order. Part of the P2
   * unification: every phased orchestrator exposes `getPhases()`.
   */
  getPhases(): readonly CoordinatorPhase[] {
    return this.phasedExecutor.getPhases();
  }

  addTask(task: CoordinatorTask): void {
    this.tasks.set(task.id, task);
  }

  getTask(id: string): CoordinatorTask | undefined {
    return this.tasks.get(id);
  }

  getPendingTasks(): readonly CoordinatorTask[] {
    return [...this.tasks.values()].filter((t) => t.status === "pending");
  }

  canSpawnWorker(): boolean {
    return this.activeWorkers < this.config.maxSubagents;
  }

  startTask(taskId: string, agentId: string): CoordinatorTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "pending" || !this.canSpawnWorker()) return null;

    const updated: CoordinatorTask = {
      ...task,
      status: "running",
      assignedAgent: agentId,
    };
    this.tasks.set(taskId, updated);
    this.activeWorkers++;
    return updated;
  }

  completeTask(taskId: string): CoordinatorTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return null;

    const updated: CoordinatorTask = { ...task, status: "completed" };
    this.tasks.set(taskId, updated);
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
    return updated;
  }

  failTask(taskId: string): CoordinatorTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return null;

    const updated: CoordinatorTask = { ...task, status: "failed" };
    this.tasks.set(taskId, updated);
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
    return updated;
  }

  isComplete(): boolean {
    return [...this.tasks.values()].every((t) => t.status === "completed" || t.status === "failed");
  }

  getProgress(): { total: number; completed: number; failed: number; running: number } {
    const tasks = [...this.tasks.values()];
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      running: tasks.filter((t) => t.status === "running").length,
    };
  }

  createWorktree(taskId: string, repoRoot: string): CoordinatorWorktree | null {
    const task = this.tasks.get(taskId);
    if (!task || !this.config.useWorktrees) return null;

    const existing = this.worktrees.get(taskId);
    if (existing) return existing;

    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();

    const worktreeRoot = this.config.worktreeRoot ?? join(gitRoot, ".wotann", "worktrees");
    if (!existsSync(worktreeRoot)) {
      mkdirSync(worktreeRoot, { recursive: true });
    }

    const branch = `wotann/${taskId}`;
    const worktreePath = join(worktreeRoot, taskId);

    execFileSync("git", ["worktree", "add", "-b", branch, worktreePath], {
      cwd: gitRoot,
      stdio: "ignore",
    });

    const created: CoordinatorWorktree = {
      taskId,
      branch,
      path: worktreePath,
    };
    this.worktrees.set(taskId, created);
    return created;
  }

  removeWorktree(taskId: string, repoRoot: string): boolean {
    const worktree = this.worktrees.get(taskId);
    if (!worktree) return false;

    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();

    execFileSync("git", ["worktree", "remove", "--force", worktree.path], {
      cwd: gitRoot,
      stdio: "ignore",
    });

    try {
      execFileSync("git", ["branch", "-D", worktree.branch], {
        cwd: gitRoot,
        stdio: "ignore",
      });
    } catch {
      // Best-effort cleanup only.
    }

    this.worktrees.delete(taskId);
    return true;
  }

  getWorktree(taskId: string): CoordinatorWorktree | undefined {
    return this.worktrees.get(taskId);
  }

  /**
   * Build an execution graph from pending tasks.
   * Tasks in the same phase can run in parallel (fanout); phases run sequentially (chain).
   *
   * P2 migration: phase order sourced from the PhasedExecutor instance, so
   * there's exactly one authoritative list in the codebase.
   */
  buildExecutionGraph(): ExecutionGraph {
    const tasks = [...this.tasks.values()];
    const phaseOrder = this.phasedExecutor.getPhases();
    const builder = new GraphBuilder();

    for (const phase of phaseOrder) {
      const phaseTasks = tasks.filter((t) => t.phase === phase && t.status === "pending");
      if (phaseTasks.length === 0) continue;

      for (const task of phaseTasks) {
        builder.addNode({
          id: task.id,
          type: "task",
          label: `${phase}: ${task.description.slice(0, 60)}`,
          handler: task.id,
        });
      }

      // Fan out tasks within the same phase, then chain to the next phase
      if (phaseTasks.length > 1) {
        builder.fanout(
          phaseTasks[0]!.id,
          phaseTasks.slice(1).map((t) => t.id),
        );
      }
    }

    // Chain phases sequentially
    const phaseLeads = phaseOrder
      .map((phase) => tasks.find((t) => t.phase === phase && t.status === "pending"))
      .filter((t): t is CoordinatorTask => t !== undefined);

    for (let i = 0; i < phaseLeads.length - 1; i++) {
      builder.chain(phaseLeads[i]!.id, phaseLeads[i + 1]!.id);
    }

    return builder.build();
  }

  /**
   * Execute all pending tasks using graph-based orchestration.
   * When worktrees are enabled and a repoRoot is provided, each task runs
   * in an isolated git worktree that is cleaned up after completion.
   */
  async executeWithGraph(
    taskExecutor: (
      taskId: string,
      worktreePath?: string,
    ) => Promise<{ success: boolean; output: string }>,
    repoRoot?: string,
  ): Promise<{ success: boolean; completedCount: number; failedCount: number }> {
    const graph = this.buildExecutionGraph();
    const results = await executeGraph(graph, async (node) => {
      this.startTask(node.id, `agent-${node.id}`);

      // Create an isolated worktree when enabled and a repo root is available
      let worktreePath: string | undefined;
      if (this.config.useWorktrees && repoRoot) {
        try {
          const wt = this.createWorktree(node.id, repoRoot);
          worktreePath = wt?.path;
        } catch {
          // Worktree creation failed — continue without isolation
        }
      }

      let outcome: { success: boolean; output: string };
      try {
        outcome = await taskExecutor(node.id, worktreePath);
      } finally {
        // Clean up the worktree regardless of success or failure
        if (worktreePath && repoRoot) {
          try {
            this.removeWorktree(node.id, repoRoot);
          } catch {
            // Best-effort cleanup only
          }
        }
      }

      if (outcome.success) {
        this.completeTask(node.id);
      } else {
        this.failTask(node.id);
      }
      return outcome;
    });
    const progress = this.getProgress();
    return {
      success: results.every((r) => r.status === "success"),
      completedCount: progress.completed,
      failedCount: progress.failed,
    };
  }

  /**
   * Strategy dispatcher — when `config.strategy === "parallel"` this method
   * fans pending tasks through `ParallelCoordinator.coordinateParallel` and
   * synthesises the outputs. Unlike `executeWithGraph` (phase-chained DAG),
   * every task runs in parallel and the synthesiser fuses results.
   */
  async executeParallel(
    executor: (taskId: string, description: string) => Promise<string>,
    synthesize: Synthesizer = defaultSynthesizer,
  ): Promise<CoordinatedOutcome> {
    const parallelTasks: readonly ParallelAgentTask[] = this.getPendingTasks().map((t) => ({
      id: t.id,
      prompt: t.description,
    }));
    return coordinateParallel(
      parallelTasks,
      async (task) => {
        this.startTask(task.id, `parallel-${task.id}`);
        try {
          const out = await executor(task.id, task.prompt);
          this.completeTask(task.id);
          return out;
        } catch (err) {
          this.failTask(task.id);
          throw err;
        }
      },
      synthesize,
      { concurrency: this.config.maxSubagents },
    );
  }

  getStrategy(): "graph" | "parallel" | "cowork" {
    return this.config.strategy ?? "graph";
  }

  /**
   * V9 T14.7 — Cowork strategy: lead decomposes the root task into
   * disjoint-scope subtasks via the injected `decomposer`, runs them
   * with bounded concurrency (capped by `maxSubagents`), and aggregates
   * via the injected merge function. Tasks are tracked via the same
   * `startTask`/`completeTask`/`failTask` lifecycle as the other
   * strategies so progress reporting stays consistent.
   *
   * The orphan `cowork.ts` ships pure logic — this method is the
   * single wiring point that drives task lifecycle + concurrency from
   * Coordinator's existing config.
   */
  async executeCowork<T = readonly CoworkResult[]>(
    rootTask: CoworkTask,
    decomposer: CoworkDecomposer,
    executor: (subtask: CoworkSubtask) => Promise<CoworkResult>,
    options: {
      readonly merge?: (results: readonly CoworkResult[]) => T;
      readonly onConflict?: (conflictingScopes: readonly string[]) => void;
      readonly abortSignal?: AbortSignal;
    } = {},
  ): Promise<CoworkAggregation<T>> {
    const plan = decomposeTask(rootTask, decomposer);
    const workers: readonly CoworkWorker[] = plan.subtasks.map((subtask) => ({
      subtaskId: subtask.id,
      execute: async () => {
        // Track inside Coordinator's own task ledger so progress
        // reporters keep working. Subtasks are added on the fly so
        // cowork doesn't require pre-population.
        if (!this.tasks.has(subtask.id)) {
          this.addTask({
            id: subtask.id,
            description: subtask.description,
            files: subtask.scope,
            phase: "implement",
            status: "pending",
          });
        }
        this.startTask(subtask.id, `cowork-${subtask.id}`);
        try {
          const result = await executor(subtask);
          if (result.ok) this.completeTask(subtask.id);
          else this.failTask(subtask.id);
          return result;
        } catch (err) {
          this.failTask(subtask.id);
          return {
            ok: false,
            subtaskId: subtask.id,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    }));
    const execution = await runCoworkers(workers, {
      concurrency: this.config.maxSubagents,
      ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
    });
    const merge =
      options.merge ?? (passthroughMerge as unknown as (r: readonly CoworkResult[]) => T);
    return aggregateCowork(plan, execution, {
      merge,
      ...(options.onConflict !== undefined ? { onConflict: options.onConflict } : {}),
    });
  }
}
