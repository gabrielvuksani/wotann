/**
 * SQLite-backed plan storage with atomic state transitions.
 * Inspired by GSD v2's DB-backed planning engine.
 *
 * Plans have milestones -> tasks with dependency tracking.
 * All transitions are atomic SQL transactions preventing corruption.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureColumnExists } from "../utils/schema-drift.js";

// ── Types ────────────────────────────────────────────────────

export type MilestoneStatus = "pending" | "active" | "completed" | "failed";

export type TaskStatus = "pending" | "active" | "completed" | "failed" | "skipped";

export type TaskLifecycle =
  | "enqueue"
  | "claimed"
  | "in_progress"
  | "blocked"
  | "complete"
  | "failed";

export type TaskPhase = "research" | "plan" | "implement" | "verify" | "commit";

export interface Plan {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: MilestoneStatus;
  readonly milestones: readonly PlanMilestone[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlanMilestone {
  readonly id: string;
  readonly planId: string;
  readonly title: string;
  readonly description: string;
  readonly status: MilestoneStatus;
  readonly tasks: readonly PlanTask[];
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface PlanTask {
  readonly id: string;
  readonly milestoneId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly dependencies: readonly string[];
  readonly files: readonly string[];
  readonly phase: TaskPhase;
  readonly lifecycle: TaskLifecycle;
  readonly assignedTo?: string;
  readonly claimedAt?: string;
  readonly blockedReason?: string;
  readonly result?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface PlanSummary {
  readonly planId: string;
  readonly title: string;
  readonly status: MilestoneStatus;
  readonly milestoneCount: number;
  readonly taskCount: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
}

// ── Transition Maps ──────────────────────────────────────────

const VALID_MILESTONE_TRANSITIONS: ReadonlyMap<MilestoneStatus, readonly MilestoneStatus[]> =
  new Map([
    ["pending", ["active"]],
    ["active", ["completed", "failed"]],
    ["completed", []],
    ["failed", ["pending"]],
  ]);

const VALID_TASK_TRANSITIONS: ReadonlyMap<TaskStatus, readonly TaskStatus[]> = new Map([
  ["pending", ["active", "skipped"]],
  ["active", ["completed", "failed"]],
  ["completed", []],
  ["failed", ["pending"]],
  ["skipped", ["pending"]],
]);

const VALID_LIFECYCLE_TRANSITIONS: ReadonlyMap<TaskLifecycle, readonly TaskLifecycle[]> = new Map([
  ["enqueue", ["claimed"]],
  ["claimed", ["in_progress", "blocked"]],
  ["in_progress", ["blocked", "complete", "failed"]],
  ["blocked", ["in_progress", "failed"]],
  ["complete", []],
  ["failed", ["enqueue"]],
]);

function isValidLifecycleTransition(from: TaskLifecycle, to: TaskLifecycle): boolean {
  return VALID_LIFECYCLE_TRANSITIONS.get(from)?.includes(to) ?? false;
}

function isValidMilestoneTransition(from: MilestoneStatus, to: MilestoneStatus): boolean {
  return VALID_MILESTONE_TRANSITIONS.get(from)?.includes(to) ?? false;
}

function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TASK_TRANSITIONS.get(from)?.includes(to) ?? false;
}

// ── Plan Store ───────────────────────────────────────────────

export class PlanStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = join(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    // Wave 6.5-UU (H-21) standard PRAGMA bundle. See utils/schema-drift.ts
    // for the rationale; mirrored inline here so each store stays
    // self-contained rather than coupled to the helper module's import.
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("user_version"); // read for migration check
    this.migrateLegacy();
    this.initialize();
  }

  /**
   * Wave 6.5-UU (SB-12) — migrate legacy plans.db files written by earlier
   * WOTANN builds that didn't yet have the `lifecycle` column on `tasks`.
   * Without this, the lifecycle-aware code paths (assignment, claim,
   * release) HARD CRASH with `no such column: lifecycle`.
   *
   * Idempotent: only fires when `tasks` exists (a fresh DB skips migration
   * because the table will be created by `initialize()` with the column
   * already in place).
   */
  private migrateLegacy(): void {
    const tableExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
      .get() as { name?: string } | undefined;
    if (!tableExists) return;
    ensureColumnExists(this.db, "tasks", "lifecycle", "TEXT NOT NULL DEFAULT 'enqueue'");
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS milestones (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_milestones_plan ON milestones(plan_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        phase TEXT NOT NULL DEFAULT 'implement',
        lifecycle TEXT NOT NULL DEFAULT 'enqueue',
        assigned_to TEXT,
        claimed_at TEXT,
        blocked_reason TEXT,
        dependencies TEXT NOT NULL DEFAULT '[]',
        files TEXT NOT NULL DEFAULT '[]',
        result TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_lifecycle ON tasks(lifecycle);
    `);
  }

  // ── Plan CRUD ──────────────────────────────────────────────

  createPlan(title: string, description: string): Plan {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO plans (id, title, description) VALUES (?, ?, ?)
    `,
      )
      .run(id, title, description);

    return this.getPlan(id)!;
  }

  getPlan(planId: string): Plan | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM plans WHERE id = ?
    `,
      )
      .get(planId) as Record<string, unknown> | undefined;

    if (!row) return null;

    const milestones = this.getMilestones(planId);

    return {
      id: row["id"] as string,
      title: row["title"] as string,
      description: row["description"] as string,
      status: row["status"] as MilestoneStatus,
      milestones,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
    };
  }

  listPlans(): readonly PlanSummary[] {
    const rows = this.db
      .prepare(
        `
      SELECT p.id, p.title, p.status,
        (SELECT COUNT(*) FROM milestones WHERE plan_id = p.id) AS milestone_count,
        (SELECT COUNT(*) FROM tasks t JOIN milestones m ON t.milestone_id = m.id WHERE m.plan_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t JOIN milestones m ON t.milestone_id = m.id WHERE m.plan_id = p.id AND t.status = 'completed') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t JOIN milestones m ON t.milestone_id = m.id WHERE m.plan_id = p.id AND t.status = 'failed') AS failed_tasks
      FROM plans p
      ORDER BY p.created_at DESC
    `,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      planId: r["id"] as string,
      title: r["title"] as string,
      status: r["status"] as MilestoneStatus,
      milestoneCount: r["milestone_count"] as number,
      taskCount: r["task_count"] as number,
      completedTasks: r["completed_tasks"] as number,
      failedTasks: r["failed_tasks"] as number,
    }));
  }

  // ── Milestone CRUD ─────────────────────────────────────────

  addMilestone(
    planId: string,
    milestone: {
      readonly title: string;
      readonly description: string;
      readonly tasks?: readonly PlanTask[];
    },
  ): PlanMilestone {
    const id = randomUUID();

    const maxOrder = this.db
      .prepare(
        `
      SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM milestones WHERE plan_id = ?
    `,
      )
      .get(planId) as { max_order: number };

    this.db
      .prepare(
        `
      INSERT INTO milestones (id, plan_id, title, description, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(id, planId, milestone.title, milestone.description, maxOrder.max_order + 1);

    return this.getMilestone(id)!;
  }

  getMilestone(milestoneId: string): PlanMilestone | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM milestones WHERE id = ?
    `,
      )
      .get(milestoneId) as Record<string, unknown> | undefined;

    if (!row) return null;

    const tasks = this.getTasksForMilestone(milestoneId);

    return {
      id: row["id"] as string,
      planId: row["plan_id"] as string,
      title: row["title"] as string,
      description: row["description"] as string,
      status: row["status"] as MilestoneStatus,
      tasks,
      createdAt: row["created_at"] as string,
      completedAt: row["completed_at"] as string | undefined,
    };
  }

  getActiveMilestone(planId: string): PlanMilestone | null {
    const row = this.db
      .prepare(
        `
      SELECT id FROM milestones WHERE plan_id = ? AND status = 'active' ORDER BY sort_order LIMIT 1
    `,
      )
      .get(planId) as { id: string } | undefined;

    if (!row) return null;
    return this.getMilestone(row.id);
  }

  private getMilestones(planId: string): readonly PlanMilestone[] {
    const rows = this.db
      .prepare(
        `
      SELECT id FROM milestones WHERE plan_id = ? ORDER BY sort_order
    `,
      )
      .all(planId) as Array<{ id: string }>;

    return rows.map((r) => this.getMilestone(r.id)!).filter(Boolean);
  }

  // ── Task CRUD ──────────────────────────────────────────────

  addTask(
    milestoneId: string,
    task: {
      readonly title: string;
      readonly description: string;
      readonly dependencies?: readonly string[];
      readonly files?: readonly string[];
      readonly phase?: TaskPhase;
    },
  ): PlanTask {
    const id = randomUUID();

    const maxOrder = this.db
      .prepare(
        `
      SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE milestone_id = ?
    `,
      )
      .get(milestoneId) as { max_order: number };

    this.db
      .prepare(
        `
      INSERT INTO tasks (id, milestone_id, title, description, phase, dependencies, files, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        milestoneId,
        task.title,
        task.description,
        task.phase ?? "implement",
        JSON.stringify(task.dependencies ?? []),
        JSON.stringify(task.files ?? []),
        maxOrder.max_order + 1,
      );

    return this.getTask(id)!;
  }

  getTask(taskId: string): PlanTask | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM tasks WHERE id = ?
    `,
      )
      .get(taskId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToTask(row);
  }

  /**
   * Advance a task to its next logical status.
   * pending -> active -> completed
   * Uses atomic transactions to prevent data corruption.
   */
  advanceTask(taskId: string, result?: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const nextStatus: TaskStatus = task.status === "pending" ? "active" : "completed";

    if (!isValidTaskTransition(task.status, nextStatus)) {
      throw new Error(
        `Invalid task transition: ${task.status} -> ${nextStatus} for task ${taskId}`,
      );
    }

    const transaction = this.db.transaction(() => {
      const completedAt = nextStatus === "completed" ? new Date().toISOString() : null;
      this.db
        .prepare(
          `
        UPDATE tasks SET status = ?, result = COALESCE(?, result), completed_at = COALESCE(?, completed_at)
        WHERE id = ?
      `,
        )
        .run(nextStatus, result ?? null, completedAt, taskId);

      // Auto-advance milestone if needed
      if (nextStatus === "active") {
        this.autoActivateMilestone(task.milestoneId);
      }
      if (nextStatus === "completed") {
        this.autoCompleteMilestone(task.milestoneId);
      }
    });

    transaction();
    return this.getTask(taskId)!;
  }

  /**
   * Mark a task as failed with an error message.
   */
  failTask(taskId: string, error: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!isValidTaskTransition(task.status, "failed")) {
      throw new Error(`Invalid task transition: ${task.status} -> failed for task ${taskId}`);
    }

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
        UPDATE tasks SET status = 'failed', result = ?, completed_at = ?
        WHERE id = ?
      `,
        )
        .run(error, new Date().toISOString(), taskId);

      // If a task fails, mark milestone as failed too
      this.db
        .prepare(
          `
        UPDATE milestones SET status = 'failed' WHERE id = ?
      `,
        )
        .run(task.milestoneId);
    });

    transaction();
    return this.getTask(taskId)!;
  }

  /**
   * Skip a pending task.
   */
  skipTask(taskId: string, reason?: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!isValidTaskTransition(task.status, "skipped")) {
      throw new Error(`Invalid task transition: ${task.status} -> skipped for task ${taskId}`);
    }

    this.db
      .prepare(
        `
      UPDATE tasks SET status = 'skipped', result = ? WHERE id = ?
    `,
      )
      .run(reason ?? "Skipped", taskId);

    return this.getTask(taskId)!;
  }

  // ── Lifecycle Transitions ────────────────────────────────

  /**
   * Claim a task for a specific agent (enqueue -> claimed).
   * Sets assignedTo and claimedAt timestamp.
   */
  claimTask(taskId: string, agentId: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!isValidLifecycleTransition(task.lifecycle, "claimed")) {
      throw new Error(
        `Invalid lifecycle transition: ${task.lifecycle} -> claimed for task ${taskId}`,
      );
    }

    this.db
      .prepare(
        `
      UPDATE tasks SET lifecycle = 'claimed', assigned_to = ?, claimed_at = ?
      WHERE id = ?
    `,
      )
      .run(agentId, new Date().toISOString(), taskId);

    return this.getTask(taskId)!;
  }

  /**
   * Start working on a claimed task (claimed -> in_progress).
   * Also advances the task status to active if still pending.
   */
  startTask(taskId: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!isValidLifecycleTransition(task.lifecycle, "in_progress")) {
      throw new Error(
        `Invalid lifecycle transition: ${task.lifecycle} -> in_progress for task ${taskId}`,
      );
    }

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
        UPDATE tasks SET lifecycle = 'in_progress' WHERE id = ?
      `,
        )
        .run(taskId);

      // Auto-advance task status to active if still pending
      if (task.status === "pending" && isValidTaskTransition("pending", "active")) {
        this.db
          .prepare(
            `
          UPDATE tasks SET status = 'active' WHERE id = ?
        `,
          )
          .run(taskId);
        this.autoActivateMilestone(task.milestoneId);
      }
    });

    transaction();
    return this.getTask(taskId)!;
  }

  /**
   * Block a task with a reason (claimed | in_progress -> blocked).
   */
  blockTask(taskId: string, reason: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!isValidLifecycleTransition(task.lifecycle, "blocked")) {
      throw new Error(
        `Invalid lifecycle transition: ${task.lifecycle} -> blocked for task ${taskId}`,
      );
    }

    this.db
      .prepare(
        `
      UPDATE tasks SET lifecycle = 'blocked', blocked_reason = ?
      WHERE id = ?
    `,
      )
      .run(reason, taskId);

    return this.getTask(taskId)!;
  }

  /**
   * Complete a task's lifecycle (in_progress -> complete).
   * Also advances the task status to completed.
   */
  completeTask(taskId: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!isValidLifecycleTransition(task.lifecycle, "complete")) {
      throw new Error(
        `Invalid lifecycle transition: ${task.lifecycle} -> complete for task ${taskId}`,
      );
    }

    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `
        UPDATE tasks SET lifecycle = 'complete', completed_at = COALESCE(completed_at, ?)
        WHERE id = ?
      `,
        )
        .run(now, taskId);

      // Also advance task status to completed if still active
      if (task.status === "active" && isValidTaskTransition("active", "completed")) {
        this.db
          .prepare(
            `
          UPDATE tasks SET status = 'completed', completed_at = ?
          WHERE id = ?
        `,
          )
          .run(now, taskId);
        this.autoCompleteMilestone(task.milestoneId);
      }
    });

    transaction();
    return this.getTask(taskId)!;
  }

  /**
   * Fail a task's lifecycle (in_progress | blocked -> failed).
   * Also marks the task status as failed if not already.
   */
  failTaskLifecycle(taskId: string, reason: string): PlanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!isValidLifecycleTransition(task.lifecycle, "failed")) {
      throw new Error(
        `Invalid lifecycle transition: ${task.lifecycle} -> failed for task ${taskId}`,
      );
    }

    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `
        UPDATE tasks SET lifecycle = 'failed', blocked_reason = ?, completed_at = ?
        WHERE id = ?
      `,
        )
        .run(reason, now, taskId);

      // Also fail the task status if it was active
      if (task.status === "active" && isValidTaskTransition("active", "failed")) {
        this.db
          .prepare(
            `
          UPDATE tasks SET status = 'failed', result = ?, completed_at = ?
          WHERE id = ?
        `,
          )
          .run(reason, now, taskId);

        this.db
          .prepare(
            `
          UPDATE milestones SET status = 'failed' WHERE id = ?
        `,
          )
          .run(task.milestoneId);
      }
    });

    transaction();
    return this.getTask(taskId)!;
  }

  /**
   * Get tasks that are ready to run: pending tasks whose
   * dependencies are all completed or skipped.
   */
  getNextTasks(planId: string): readonly PlanTask[] {
    const allTasks = this.getAllTasksForPlan(planId);
    const completedOrSkipped = new Set(
      allTasks.filter((t) => t.status === "completed" || t.status === "skipped").map((t) => t.id),
    );

    return allTasks.filter((task) => {
      if (task.status !== "pending") return false;
      return task.dependencies.every((dep) => completedOrSkipped.has(dep));
    });
  }

  /**
   * Delete a plan and all its milestones/tasks (CASCADE).
   */
  deletePlan(planId: string): boolean {
    const result = this.db.prepare(`DELETE FROM plans WHERE id = ?`).run(planId);
    return result.changes > 0;
  }

  /**
   * Get a summary of plan progress.
   */
  getPlanProgress(planId: string): {
    total: number;
    completed: number;
    failed: number;
    active: number;
    pending: number;
    skipped: number;
    percentComplete: number;
    enqueued: number;
    claimed: number;
    inProgress: number;
    blocked: number;
  } {
    const tasks = this.getAllTasksForPlan(planId);
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const active = tasks.filter((t) => t.status === "active").length;
    const skipped = tasks.filter((t) => t.status === "skipped").length;
    const pending = tasks.filter((t) => t.status === "pending").length;

    return {
      total,
      completed,
      failed,
      active,
      pending,
      skipped,
      percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
      enqueued: tasks.filter((t) => t.lifecycle === "enqueue").length,
      claimed: tasks.filter((t) => t.lifecycle === "claimed").length,
      inProgress: tasks.filter((t) => t.lifecycle === "in_progress").length,
      blocked: tasks.filter((t) => t.lifecycle === "blocked").length,
    };
  }

  close(): void {
    this.db.close();
  }

  // ── Private Helpers ────────────────────────────────────────

  private getTasksForMilestone(milestoneId: string): readonly PlanTask[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tasks WHERE milestone_id = ? ORDER BY sort_order
    `,
      )
      .all(milestoneId) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToTask(r));
  }

  private getAllTasksForPlan(planId: string): readonly PlanTask[] {
    const rows = this.db
      .prepare(
        `
      SELECT t.* FROM tasks t
      JOIN milestones m ON t.milestone_id = m.id
      WHERE m.plan_id = ?
      ORDER BY m.sort_order, t.sort_order
    `,
      )
      .all(planId) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToTask(r));
  }

  /**
   * Auto-activate a milestone when its first task becomes active.
   */
  private autoActivateMilestone(milestoneId: string): void {
    const milestone = this.db
      .prepare(
        `
      SELECT status FROM milestones WHERE id = ?
    `,
      )
      .get(milestoneId) as { status: string } | undefined;

    if (milestone?.status === "pending") {
      if (isValidMilestoneTransition("pending", "active")) {
        this.db
          .prepare(
            `
          UPDATE milestones SET status = 'active' WHERE id = ?
        `,
          )
          .run(milestoneId);

        // Also activate the parent plan
        const planRow = this.db
          .prepare(
            `
          SELECT plan_id FROM milestones WHERE id = ?
        `,
          )
          .get(milestoneId) as { plan_id: string } | undefined;

        if (planRow) {
          const plan = this.db
            .prepare(
              `
            SELECT status FROM plans WHERE id = ?
          `,
            )
            .get(planRow.plan_id) as { status: string } | undefined;

          if (plan?.status === "pending") {
            this.db
              .prepare(
                `
              UPDATE plans SET status = 'active', updated_at = datetime('now') WHERE id = ?
            `,
              )
              .run(planRow.plan_id);
          }
        }
      }
    }
  }

  /**
   * Auto-complete a milestone when all its tasks are completed or skipped.
   */
  private autoCompleteMilestone(milestoneId: string): void {
    const remaining = this.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM tasks
      WHERE milestone_id = ? AND status NOT IN ('completed', 'skipped')
    `,
      )
      .get(milestoneId) as { count: number };

    if (remaining.count === 0) {
      const milestone = this.db
        .prepare(
          `
        SELECT status FROM milestones WHERE id = ?
      `,
        )
        .get(milestoneId) as { status: string } | undefined;

      if (
        milestone &&
        isValidMilestoneTransition(milestone.status as MilestoneStatus, "completed")
      ) {
        this.db
          .prepare(
            `
          UPDATE milestones SET status = 'completed', completed_at = datetime('now')
          WHERE id = ?
        `,
          )
          .run(milestoneId);
      }

      // Check if all milestones in the plan are completed
      const planRow = this.db
        .prepare(
          `
        SELECT plan_id FROM milestones WHERE id = ?
      `,
        )
        .get(milestoneId) as { plan_id: string } | undefined;

      if (planRow) {
        const remainingMilestones = this.db
          .prepare(
            `
          SELECT COUNT(*) AS count FROM milestones
          WHERE plan_id = ? AND status NOT IN ('completed')
        `,
          )
          .get(planRow.plan_id) as { count: number };

        if (remainingMilestones.count === 0) {
          this.db
            .prepare(
              `
            UPDATE plans SET status = 'completed', updated_at = datetime('now')
            WHERE id = ?
          `,
            )
            .run(planRow.plan_id);
        }
      }
    }
  }

  private rowToTask(row: Record<string, unknown>): PlanTask {
    return {
      id: row["id"] as string,
      milestoneId: row["milestone_id"] as string,
      title: row["title"] as string,
      description: row["description"] as string,
      status: row["status"] as TaskStatus,
      dependencies: JSON.parse((row["dependencies"] as string) || "[]") as string[],
      files: JSON.parse((row["files"] as string) || "[]") as string[],
      phase: row["phase"] as TaskPhase,
      lifecycle: (row["lifecycle"] as TaskLifecycle | undefined) ?? "enqueue",
      assignedTo: row["assigned_to"] as string | undefined,
      claimedAt: row["claimed_at"] as string | undefined,
      blockedReason: row["blocked_reason"] as string | undefined,
      result: row["result"] as string | undefined,
      createdAt: row["created_at"] as string,
      completedAt: row["completed_at"] as string | undefined,
    };
  }
}
