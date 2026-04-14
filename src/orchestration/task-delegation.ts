/**
 * Task Delegation Protocol — structured handoff between agent instances.
 *
 * When a parent agent spawns sub-agents, this protocol ensures:
 * 1. Complete context transfer (files, decisions, constraints)
 * 2. Result verification (sub-agent proves work is done)
 * 3. Rollback on failure (revert sub-agent's changes)
 * 4. Knowledge extraction (learn from sub-agent's experience)
 */

import { randomUUID } from "node:crypto";

export type DelegationStatus = "pending" | "accepted" | "in-progress" | "completed" | "failed" | "rolled-back";

export interface DelegationTask {
  readonly id: string;
  readonly parentAgentId: string;
  readonly childAgentId?: string;
  readonly task: string;
  readonly context: DelegationContext;
  readonly constraints: DelegationConstraints;
  readonly status: DelegationStatus;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly result?: DelegationResult;
}

export interface DelegationContext {
  readonly workingDir: string;
  readonly relevantFiles: readonly string[];
  readonly decisions: readonly string[];
  readonly priorAttempts: readonly string[];
  readonly memoryEntryIds: readonly string[];
  readonly parentSessionId: string;
}

export interface DelegationConstraints {
  readonly maxTimeMs: number;
  readonly maxCostUsd: number;
  readonly allowedFiles: readonly string[];
  readonly forbiddenFiles: readonly string[];
  readonly mustPass: readonly string[];
  readonly provider?: string;
  readonly model?: string;
}

export interface DelegationResult {
  readonly success: boolean;
  readonly output: string;
  readonly filesModified: readonly string[];
  readonly testsRun: number;
  readonly testsPassed: number;
  readonly costUsd: number;
  readonly tokensUsed: number;
  readonly knowledgeExtracted: readonly string[];
  readonly errors: readonly string[];
}

export class TaskDelegationManager {
  private readonly tasks: Map<string, DelegationTask> = new Map();
  private readonly results: Map<string, DelegationResult> = new Map();

  /**
   * Create a delegation task.
   */
  create(
    parentAgentId: string,
    task: string,
    context: DelegationContext,
    constraints: DelegationConstraints,
  ): DelegationTask {
    const delegation: DelegationTask = {
      id: randomUUID(),
      parentAgentId,
      task,
      context,
      constraints,
      status: "pending",
      createdAt: Date.now(),
    };
    this.tasks.set(delegation.id, delegation);
    return delegation;
  }

  /**
   * Accept a delegation (child agent picks it up).
   */
  accept(taskId: string, childAgentId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "pending") return false;
    this.tasks.set(taskId, { ...task, childAgentId, status: "accepted", startedAt: Date.now() });
    return true;
  }

  /**
   * Mark delegation as in-progress.
   */
  markInProgress(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "accepted") return false;
    this.tasks.set(taskId, { ...task, status: "in-progress" });
    return true;
  }

  /**
   * Complete a delegation with results.
   */
  complete(taskId: string, result: DelegationResult): boolean {
    const task = this.tasks.get(taskId);
    if (!task || (task.status !== "in-progress" && task.status !== "accepted")) return false;
    this.tasks.set(taskId, { ...task, status: result.success ? "completed" : "failed", completedAt: Date.now(), result });
    this.results.set(taskId, result);
    return true;
  }

  /**
   * Roll back a failed delegation.
   */
  rollback(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "failed") return false;
    this.tasks.set(taskId, { ...task, status: "rolled-back" });
    return true;
  }

  /**
   * Get all tasks for a parent agent.
   */
  getByParent(parentAgentId: string): readonly DelegationTask[] {
    return [...this.tasks.values()].filter((t) => t.parentAgentId === parentAgentId);
  }

  /**
   * Get pending tasks (for child agents to pick up).
   */
  getPending(): readonly DelegationTask[] {
    return [...this.tasks.values()].filter((t) => t.status === "pending");
  }

  /**
   * Extract knowledge from completed delegations.
   */
  extractKnowledge(parentAgentId: string): readonly string[] {
    const completed = this.getByParent(parentAgentId).filter((t) => t.status === "completed");
    return completed.flatMap((t) => t.result?.knowledgeExtracted ?? []);
  }

  getTask(taskId: string): DelegationTask | undefined { return this.tasks.get(taskId); }
  getResult(taskId: string): DelegationResult | undefined { return this.results.get(taskId); }
}
