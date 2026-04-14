/**
 * Filesystem-level task isolation using git worktrees.
 * Each concurrent autonomous task gets its own worktree.
 * Changes are merged only on verification success.
 *
 * Provides safe parallel task execution: each task operates
 * on an isolated branch/worktree so failures don't pollute
 * the main working tree.
 */

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────

export type IsolatedTaskStatus = "active" | "completed" | "failed" | "merged";

export interface IsolatedTask {
  readonly id: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly task: string;
  readonly status: IsolatedTaskStatus;
  readonly createdAt: string;
}

export interface MergeResult {
  readonly success: boolean;
  readonly taskId: string;
  readonly branch: string;
  readonly conflictFiles: readonly string[];
  readonly mergedAt: string;
}

export interface CleanupResult {
  readonly removedCount: number;
  readonly removedIds: readonly string[];
}

// ── Constants ──────────────────────────────────────────

const BRANCH_PREFIX = "wotann/task/";
const DEFAULT_TIMEOUT_MS = 30_000;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Task Isolation Manager ─────────────────────────────

export class TaskIsolationManager {
  private readonly repoRoot: string;
  private readonly isolationDir: string;
  private readonly tasks: Map<string, IsolatedTask> = new Map();

  constructor(repoRoot: string, isolationDir: string) {
    this.repoRoot = repoRoot;
    this.isolationDir = isolationDir;
  }

  /**
   * Create an isolated worktree for a task.
   * Creates a new branch and worktree directory.
   */
  async createIsolation(taskId: string, task: string): Promise<IsolatedTask> {
    this.ensureIsolationDir();
    await this.validateGitRepo();

    const id = taskId || randomUUID().slice(0, 12);
    const branch = `${BRANCH_PREFIX}${id}`;
    const worktreePath = join(this.isolationDir, id);

    if (this.tasks.has(id)) {
      throw new TaskIsolationError(`Task "${id}" already exists`);
    }

    if (existsSync(worktreePath)) {
      throw new TaskIsolationError(`Worktree path already exists: ${worktreePath}`);
    }

    // Get current HEAD for the branch point
    const headResult = await this.gitExec(["rev-parse", "HEAD"]);
    const headRef = headResult.trim();

    // Create branch from current HEAD
    await this.gitExec(["branch", branch, headRef]);

    // Create worktree
    await this.gitExec(["worktree", "add", worktreePath, branch]);

    const isolated: IsolatedTask = {
      id,
      worktreePath,
      branch,
      task,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(id, isolated);
    return isolated;
  }

  /**
   * Mark a task as completed (ready for merge).
   */
  completeTask(taskId: string): IsolatedTask {
    const task = this.getTaskOrThrow(taskId);

    if (task.status !== "active") {
      throw new TaskIsolationError(`Task "${taskId}" is not active (status: ${task.status})`);
    }

    const updated: IsolatedTask = { ...task, status: "completed" };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Mark a task as failed.
   */
  failTask(taskId: string): IsolatedTask {
    const task = this.getTaskOrThrow(taskId);

    if (task.status !== "active") {
      throw new TaskIsolationError(`Task "${taskId}" is not active (status: ${task.status})`);
    }

    const updated: IsolatedTask = { ...task, status: "failed" };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Merge a completed task back to the current branch.
   * Only merges tasks with "completed" status.
   */
  async mergeTask(taskId: string): Promise<MergeResult> {
    const task = this.getTaskOrThrow(taskId);

    if (task.status !== "completed") {
      throw new TaskIsolationError(
        `Cannot merge task "${taskId}" with status "${task.status}" -- must be "completed"`,
      );
    }

    try {
      await this.gitExec(["merge", "--no-ff", task.branch, "-m", `wotann: merge task ${taskId}`]);

      const updated: IsolatedTask = { ...task, status: "merged" };
      this.tasks.set(taskId, updated);

      return {
        success: true,
        taskId,
        branch: task.branch,
        conflictFiles: [],
        mergedAt: new Date().toISOString(),
      };
    } catch {
      // Check for merge conflicts
      const conflicts = await this.detectConflicts();

      if (conflicts.length > 0) {
        await this.gitExecSafe(["merge", "--abort"]);
      }

      return {
        success: false,
        taskId,
        branch: task.branch,
        conflictFiles: conflicts,
        mergedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Discard a failed or unwanted task.
   * Removes the worktree and branch.
   */
  async discardTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === "merged") {
      throw new TaskIsolationError(`Cannot discard merged task "${taskId}"`);
    }

    await this.removeWorktree(task);
    this.tasks.delete(taskId);
    return true;
  }

  /**
   * List all active (non-merged, non-discarded) isolations.
   */
  listActive(): readonly IsolatedTask[] {
    return [...this.tasks.values()].filter(
      (t) => t.status === "active" || t.status === "completed",
    );
  }

  /**
   * List all tracked tasks regardless of status.
   */
  listAll(): readonly IsolatedTask[] {
    return [...this.tasks.values()];
  }

  /**
   * Get a specific task by ID.
   */
  getTask(taskId: string): IsolatedTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Cleanup stale worktrees (older than threshold).
   * Removes both the worktree and the task branch.
   */
  async cleanup(thresholdMs?: number): Promise<CleanupResult> {
    const threshold = thresholdMs ?? STALE_THRESHOLD_MS;
    const now = Date.now();
    const removedIds: string[] = [];

    for (const [id, task] of this.tasks) {
      const shouldRemove =
        task.status === "merged" ||
        task.status === "failed" ||
        (now - new Date(task.createdAt).getTime()) >= threshold;

      if (shouldRemove) {
        await this.removeWorktree(task);
        this.tasks.delete(id);
        removedIds.push(id);
      }
    }

    return { removedCount: removedIds.length, removedIds };
  }

  // ── Private Helpers ──────────────────────────────────

  private getTaskOrThrow(taskId: string): IsolatedTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskIsolationError(`Task "${taskId}" not found`);
    }
    return task;
  }

  private ensureIsolationDir(): void {
    if (!existsSync(this.isolationDir)) {
      mkdirSync(this.isolationDir, { recursive: true });
    }
  }

  private async validateGitRepo(): Promise<void> {
    try {
      await this.gitExec(["rev-parse", "--git-dir"]);
    } catch {
      throw new TaskIsolationError(`Not a git repository: ${this.repoRoot}`);
    }
  }

  private async removeWorktree(task: IsolatedTask): Promise<void> {
    if (existsSync(task.worktreePath)) {
      await this.gitExecSafe(["worktree", "remove", task.worktreePath, "--force"]);

      // Fallback: manual removal if git worktree remove fails
      if (existsSync(task.worktreePath)) {
        rmSync(task.worktreePath, { recursive: true, force: true });
      }
    }

    await this.gitExecSafe(["worktree", "prune"]);
    await this.gitExecSafe(["branch", "-D", task.branch]);
  }

  private async detectConflicts(): Promise<readonly string[]> {
    try {
      const output = await this.gitExec(["diff", "--name-only", "--diff-filter=U"]);
      return output.split("\n").filter((line) => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  private async gitExec(args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd: this.repoRoot,
      timeout: DEFAULT_TIMEOUT_MS,
    });
    return stdout;
  }

  private async gitExecSafe(args: readonly string[]): Promise<string | null> {
    try {
      return await this.gitExec(args);
    } catch {
      return null;
    }
  }
}

// ── Error Type ─────────────────────────────────────────

export class TaskIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskIsolationError";
  }
}
