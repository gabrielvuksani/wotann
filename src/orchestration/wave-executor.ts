/**
 * Wave-based parallel execution: topological grouping, parallel execution, fresh context.
 * From GSD — group tasks by dependency into waves, execute each wave in parallel.
 *
 * Fresh Context: each task can declare its own context snapshot (file paths + token budget)
 * so it runs with isolated, task-relevant context instead of accumulated global context.
 */

import { estimateTokens } from "../context/inspector.js";

// ── Types ─────────────────────────────────────────────

export interface WaveTask {
  readonly id: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly result?: string;
}

/**
 * Extended task with isolated context per task (D4: Fresh Context Per Task).
 * Each parallel task gets only the files relevant to it, preventing
 * context pollution from other tasks' accumulated state.
 */
export interface FreshContextTask extends WaveTask {
  readonly contextSnapshot: readonly string[];
  readonly maxContextTokens: number;
}

export interface Wave {
  readonly index: number;
  readonly tasks: readonly WaveTask[];
}

export interface FreshContextWave {
  readonly index: number;
  readonly tasks: readonly FreshContextTask[];
}

export interface WaveExecutionResult {
  readonly taskId: string;
  readonly result: string;
  readonly contextTokensUsed: number;
}

/**
 * Resolver that maps file paths to their content.
 * Called before each wave to snapshot context per task.
 */
export type ContextResolver = (paths: readonly string[]) => Promise<ReadonlyMap<string, string>>;

// ── Wave Building ─────────────────────────────────────

/**
 * Group tasks into waves by dependency analysis.
 * Tasks with no remaining dependencies go in the current wave.
 */
export function buildWaves(tasks: readonly WaveTask[]): readonly Wave[] {
  const waves: Wave[] = [];
  const completed = new Set<string>();
  let remaining = [...tasks];

  let waveIndex = 0;
  while (remaining.length > 0) {
    const ready = remaining.filter((t) =>
      t.dependencies.every((dep) => completed.has(dep)),
    );

    if (ready.length === 0 && remaining.length > 0) {
      // Circular dependency — force remaining into one wave
      waves.push({ index: waveIndex, tasks: remaining });
      break;
    }

    waves.push({ index: waveIndex, tasks: ready });

    for (const task of ready) {
      completed.add(task.id);
    }

    remaining = remaining.filter((t) => !completed.has(t.id));
    waveIndex++;
  }

  return waves;
}

/**
 * Build waves from FreshContextTasks, preserving context metadata.
 */
export function buildFreshContextWaves(
  tasks: readonly FreshContextTask[],
): readonly FreshContextWave[] {
  const baseWaves = buildWaves(tasks);
  return baseWaves.map((wave) => ({
    index: wave.index,
    tasks: wave.tasks.map((baseTask) => {
      const freshTask = tasks.find((t) => t.id === baseTask.id);
      return freshTask ?? {
        ...baseTask,
        contextSnapshot: [],
        maxContextTokens: 0,
      };
    }),
  }));
}

// ── Execution ─────────────────────────────────────────

/**
 * Execute waves sequentially, tasks within each wave in parallel.
 */
export async function executeWaves(
  waves: readonly Wave[],
  executor: (task: WaveTask) => Promise<string>,
): Promise<ReadonlyMap<string, string>> {
  const results = new Map<string, string>();

  for (const wave of waves) {
    const waveResults = await Promise.allSettled(
      wave.tasks.map(async (task) => {
        const result = await executor(task);
        return { id: task.id, result };
      }),
    );

    for (const result of waveResults) {
      if (result.status === "fulfilled") {
        results.set(result.value.id, result.value.result);
      }
    }
  }

  return results;
}

/**
 * Execute waves with fresh context isolation per task (D4).
 *
 * Before each wave:
 *   1. Snapshot the relevant context per task (only its declared files)
 *   2. Trim context to fit within each task's token budget
 *   3. Pass the isolated context to the executor
 *
 * After wave completion:
 *   4. Merge results back into the shared results map
 *
 * This ensures no task sees another task's accumulated garbage.
 */
export async function executeWavesWithFreshContext(
  waves: readonly FreshContextWave[],
  executor: (task: FreshContextTask, context: ReadonlyMap<string, string>) => Promise<string>,
  contextResolver: ContextResolver,
): Promise<ReadonlyMap<string, WaveExecutionResult>> {
  const results = new Map<string, WaveExecutionResult>();

  for (const wave of waves) {
    // Phase 1: Snapshot context per task before the wave starts
    const taskContexts = await snapshotWaveContexts(wave.tasks, contextResolver);

    // Phase 2: Execute all tasks in this wave in parallel with isolated context
    const waveResults = await Promise.allSettled(
      wave.tasks.map(async (task) => {
        const context = taskContexts.get(task.id) ?? new Map<string, string>();
        const result = await executor(task, context);
        const contextTokensUsed = computeContextTokens(context);
        return { taskId: task.id, result, contextTokensUsed };
      }),
    );

    // Phase 3: Merge results back
    for (const result of waveResults) {
      if (result.status === "fulfilled") {
        results.set(result.value.taskId, result.value);
      }
    }
  }

  return results;
}

// ── Context Snapshotting ──────────────────────────────

/**
 * Snapshot context for all tasks in a wave.
 * Each task gets only its declared files, trimmed to its token budget.
 */
async function snapshotWaveContexts(
  tasks: readonly FreshContextTask[],
  resolver: ContextResolver,
): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  // Collect all unique paths needed across the wave
  const allPaths = new Set<string>();
  for (const task of tasks) {
    for (const path of task.contextSnapshot) {
      allPaths.add(path);
    }
  }

  // Resolve all paths in one batch (efficient I/O)
  const resolvedContent = await resolver([...allPaths]);

  // Build per-task context maps, respecting each task's token budget
  const taskContexts = new Map<string, ReadonlyMap<string, string>>();

  for (const task of tasks) {
    const taskContext = new Map<string, string>();
    let tokensUsed = 0;

    for (const path of task.contextSnapshot) {
      const content = resolvedContent.get(path);
      if (!content) continue;

      const tokenCost = estimateTokens(content);
      if (task.maxContextTokens > 0 && tokensUsed + tokenCost > task.maxContextTokens) {
        // Budget exceeded — truncate this file's content to fit
        const remainingBudget = task.maxContextTokens - tokensUsed;
        if (remainingBudget > 50) {
          // Rough truncation: 4 chars per token
          const truncated = content.slice(0, remainingBudget * 4);
          taskContext.set(path, truncated);
          tokensUsed += estimateTokens(truncated);
        }
        break; // No more files fit
      }

      taskContext.set(path, content);
      tokensUsed += tokenCost;
    }

    taskContexts.set(task.id, taskContext);
  }

  return taskContexts;
}

/**
 * Compute total token usage for a context map.
 */
function computeContextTokens(context: ReadonlyMap<string, string>): number {
  let total = 0;
  for (const content of context.values()) {
    total += estimateTokens(content);
  }
  return total;
}
