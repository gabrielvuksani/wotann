/**
 * Parallel agent coordinator — spawn N agents, collect, synthesize.
 *
 * Different from self-consistency voting: agents here get different
 * SUB-TASKS, not the same task. Use cases:
 *   - Research: 3 agents explore different angles of a question
 *   - Review: 3 agents review different dimensions (security, perf, correctness)
 *   - Synthesis: agents operate in parallel, then a synthesizer fuses
 *
 * Ships:
 *   - AgentTask + AgentResult + CoordinatorConfig types
 *   - coordinateParallel(tasks, execute, synthesize): orchestrator
 *   - Concurrency limiting, timeouts, per-agent error isolation
 *
 * Caller supplies execute() + synthesize() — this module owns the
 * orchestration.
 */

// ── Types ──────────────────────────────────────────────

export interface AgentTask {
  readonly id: string;
  readonly prompt: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AgentResult {
  readonly taskId: string;
  readonly output: string;
  readonly error?: string;
  readonly durationMs: number;
}

export interface CoordinatorConfig {
  readonly concurrency?: number;
  readonly perTaskTimeoutMs?: number;
  readonly onTaskComplete?: (result: AgentResult) => void;
}

export type AgentExecutor = (task: AgentTask) => Promise<string>;
export type Synthesizer = (results: readonly AgentResult[]) => Promise<string>;

export interface CoordinatedOutcome {
  readonly synthesis: string;
  readonly results: readonly AgentResult[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly totalDurationMs: number;
}

// ── Coordinator ────────────────────────────────────────

export async function coordinateParallel(
  tasks: readonly AgentTask[],
  execute: AgentExecutor,
  synthesize: Synthesizer,
  config: CoordinatorConfig = {},
): Promise<CoordinatedOutcome> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, config.concurrency ?? 3);
  const perTaskTimeoutMs = config.perTaskTimeoutMs ?? 120_000;

  const results: AgentResult[] = [];
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) return;
      const task = tasks[idx]!;
      const taskStart = Date.now();
      try {
        const output = await withTimeout(execute(task), perTaskTimeoutMs);
        const result: AgentResult = {
          taskId: task.id,
          output,
          durationMs: Date.now() - taskStart,
        };
        results.push(result);
        config.onTaskComplete?.(result);
      } catch (err) {
        const result: AgentResult = {
          taskId: task.id,
          output: "",
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - taskStart,
        };
        results.push(result);
        config.onTaskComplete?.(result);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

  const synthesis = await synthesize(results);

  const successCount = results.filter((r) => !r.error).length;
  return {
    synthesis,
    results,
    successCount,
    failureCount: results.length - successCount,
    totalDurationMs: Date.now() - startedAt,
  };
}

// ── Helpers ────────────────────────────────────────────

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Default synthesizer: concatenate successful outputs labelled with
 * their task ids. Useful when the caller wants the raw outputs for
 * downstream processing.
 */
export function defaultSynthesizer(results: readonly AgentResult[]): Promise<string> {
  const parts = results.filter((r) => !r.error).map((r) => `[${r.taskId}]\n${r.output}`);
  return Promise.resolve(parts.join("\n\n---\n\n"));
}

/**
 * LLM-backed synthesizer factory: feeds all successful outputs to an
 * LLM that produces a unified synthesis.
 */
export function createLlmSynthesizer(llmQuery: (prompt: string) => Promise<string>): Synthesizer {
  return async (results) => {
    const successful = results.filter((r) => !r.error);
    if (successful.length === 0) return "(no successful sub-agent outputs to synthesize)";

    const body = successful.map((r) => `## Agent ${r.taskId}\n${r.output}`).join("\n\n");

    const prompt = `Synthesize these parallel agent outputs into a single coherent response. Identify agreements, highlight disagreements, and produce a unified answer.

${body}

Synthesis:`;

    return llmQuery(prompt);
  };
}
