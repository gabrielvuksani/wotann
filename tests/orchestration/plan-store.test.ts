import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlanStore, type Plan, type PlanTask } from "../../src/orchestration/plan-store.js";

describe("PlanStore", () => {
  let store: PlanStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-plan-test-"));
    store = new PlanStore(join(tempDir, "plans.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Plan CRUD ──────────────────────────────────────��───────

  describe("createPlan", () => {
    it("creates a plan with pending status", () => {
      const plan = store.createPlan("Test Plan", "A test plan");
      expect(plan.title).toBe("Test Plan");
      expect(plan.description).toBe("A test plan");
      expect(plan.status).toBe("pending");
      expect(plan.milestones).toHaveLength(0);
    });

    it("assigns a unique ID", () => {
      const plan1 = store.createPlan("Plan 1", "");
      const plan2 = store.createPlan("Plan 2", "");
      expect(plan1.id).not.toBe(plan2.id);
    });
  });

  describe("getPlan", () => {
    it("retrieves an existing plan", () => {
      const created = store.createPlan("My Plan", "Description");
      const retrieved = store.getPlan(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe("My Plan");
    });

    it("returns null for non-existent plan", () => {
      expect(store.getPlan("nonexistent-id")).toBeNull();
    });
  });

  describe("listPlans", () => {
    it("lists all plans with summaries", () => {
      store.createPlan("Plan A", "First");
      store.createPlan("Plan B", "Second");

      const plans = store.listPlans();
      expect(plans).toHaveLength(2);
      expect(plans[0]?.milestoneCount).toBe(0);
      expect(plans[0]?.taskCount).toBe(0);
    });
  });

  describe("deletePlan", () => {
    it("removes a plan and cascades to milestones/tasks", () => {
      const plan = store.createPlan("Doomed Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS1", description: "" });
      store.addTask(ms.id, { title: "Task 1", description: "" });

      expect(store.deletePlan(plan.id)).toBe(true);
      expect(store.getPlan(plan.id)).toBeNull();
    });

    it("returns false for non-existent plan", () => {
      expect(store.deletePlan("ghost")).toBe(false);
    });
  });

  // ── Milestone CRUD ─────────────────────────────────────────

  describe("addMilestone", () => {
    it("adds a milestone to a plan", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, {
        title: "Milestone 1",
        description: "First milestone",
      });

      expect(ms.title).toBe("Milestone 1");
      expect(ms.status).toBe("pending");
      expect(ms.tasks).toHaveLength(0);
    });

    it("maintains sort order", () => {
      const plan = store.createPlan("Plan", "");
      store.addMilestone(plan.id, { title: "First", description: "" });
      store.addMilestone(plan.id, { title: "Second", description: "" });

      const retrieved = store.getPlan(plan.id)!;
      expect(retrieved.milestones).toHaveLength(2);
      expect(retrieved.milestones[0]?.title).toBe("First");
      expect(retrieved.milestones[1]?.title).toBe("Second");
    });
  });

  describe("getActiveMilestone", () => {
    it("returns null when no milestone is active", () => {
      const plan = store.createPlan("Plan", "");
      store.addMilestone(plan.id, { title: "MS1", description: "" });

      expect(store.getActiveMilestone(plan.id)).toBeNull();
    });
  });

  // ── Task CRUD ��──────────────────────────────────────────���──

  describe("addTask", () => {
    it("adds a task to a milestone", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });

      const task = store.addTask(ms.id, {
        title: "Task 1",
        description: "Do something",
        phase: "implement",
        files: ["src/foo.ts"],
      });

      expect(task.title).toBe("Task 1");
      expect(task.status).toBe("pending");
      expect(task.phase).toBe("implement");
      expect(task.files).toEqual(["src/foo.ts"]);
      expect(task.dependencies).toEqual([]);
    });

    it("supports dependency tracking", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const t1 = store.addTask(ms.id, { title: "Setup", description: "" });
      const t2 = store.addTask(ms.id, {
        title: "Build",
        description: "",
        dependencies: [t1.id],
      });

      expect(t2.dependencies).toEqual([t1.id]);
    });

    it("defaults to implement phase", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });
      expect(task.phase).toBe("implement");
    });
  });

  // ── Task State Transitions ──���──────────────────────────────

  describe("advanceTask", () => {
    it("advances pending -> active", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      const advanced = store.advanceTask(task.id);
      expect(advanced.status).toBe("active");
    });

    it("advances active -> completed", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id); // pending -> active
      const completed = store.advanceTask(task.id, "All good"); // active -> completed

      expect(completed.status).toBe("completed");
      expect(completed.result).toBe("All good");
      expect(completed.completedAt).toBeTruthy();
    });

    it("throws for invalid transition (completed -> ?)", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id); // pending -> active
      store.advanceTask(task.id); // active -> completed

      expect(() => store.advanceTask(task.id)).toThrow("Invalid task transition");
    });

    it("throws for non-existent task", () => {
      expect(() => store.advanceTask("ghost-id")).toThrow("Task not found");
    });

    it("auto-activates milestone when first task starts", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id); // pending -> active

      const milestone = store.getMilestone(ms.id)!;
      expect(milestone.status).toBe("active");
    });

    it("auto-activates plan when first task starts", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id); // pending -> active

      const updated = store.getPlan(plan.id)!;
      expect(updated.status).toBe("active");
    });

    it("auto-completes milestone when all tasks done", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const t1 = store.addTask(ms.id, { title: "T1", description: "" });
      const t2 = store.addTask(ms.id, { title: "T2", description: "" });

      // Complete both tasks
      store.advanceTask(t1.id); store.advanceTask(t1.id);
      store.advanceTask(t2.id); store.advanceTask(t2.id);

      const milestone = store.getMilestone(ms.id)!;
      expect(milestone.status).toBe("completed");
      expect(milestone.completedAt).toBeTruthy();
    });

    it("auto-completes plan when all milestones completed", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const t = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(t.id); // active
      store.advanceTask(t.id); // completed

      const updated = store.getPlan(plan.id)!;
      expect(updated.status).toBe("completed");
    });
  });

  describe("failTask", () => {
    it("marks an active task as failed", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id); // pending -> active
      const failed = store.failTask(task.id, "Something broke");

      expect(failed.status).toBe("failed");
      expect(failed.result).toBe("Something broke");
    });

    it("marks the parent milestone as failed", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id);
      store.failTask(task.id, "Error");

      const milestone = store.getMilestone(ms.id)!;
      expect(milestone.status).toBe("failed");
    });

    it("throws for pending task (can only fail active)", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      expect(() => store.failTask(task.id, "Error")).toThrow("Invalid task transition");
    });
  });

  describe("skipTask", () => {
    it("skips a pending task", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      const skipped = store.skipTask(task.id, "Not needed");
      expect(skipped.status).toBe("skipped");
      expect(skipped.result).toBe("Not needed");
    });

    it("throws for active task", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id);
      expect(() => store.skipTask(task.id)).toThrow("Invalid task transition");
    });
  });

  // ── Dependency-Aware Next Tasks ────────────────────────────

  describe("getNextTasks", () => {
    it("returns tasks with no dependencies", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      store.addTask(ms.id, { title: "Independent", description: "" });

      const next = store.getNextTasks(plan.id);
      expect(next).toHaveLength(1);
      expect(next[0]?.title).toBe("Independent");
    });

    it("blocks tasks with unmet dependencies", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const t1 = store.addTask(ms.id, { title: "First", description: "" });
      store.addTask(ms.id, {
        title: "Second",
        description: "",
        dependencies: [t1.id],
      });

      const next = store.getNextTasks(plan.id);
      expect(next).toHaveLength(1);
      expect(next[0]?.title).toBe("First");
    });

    it("unblocks tasks when dependencies are completed", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const t1 = store.addTask(ms.id, { title: "First", description: "" });
      const t2 = store.addTask(ms.id, {
        title: "Second",
        description: "",
        dependencies: [t1.id],
      });

      // Complete t1
      store.advanceTask(t1.id);
      store.advanceTask(t1.id);

      const next = store.getNextTasks(plan.id);
      expect(next.some((t) => t.id === t2.id)).toBe(true);
    });

    it("unblocks tasks when dependencies are skipped", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const t1 = store.addTask(ms.id, { title: "First", description: "" });
      const t2 = store.addTask(ms.id, {
        title: "Second",
        description: "",
        dependencies: [t1.id],
      });

      store.skipTask(t1.id);

      const next = store.getNextTasks(plan.id);
      expect(next.some((t) => t.id === t2.id)).toBe(true);
    });

    it("excludes non-pending tasks", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const task = store.addTask(ms.id, { title: "T", description: "" });

      store.advanceTask(task.id); // now active

      const next = store.getNextTasks(plan.id);
      expect(next).toHaveLength(0);
    });
  });

  // ── Progress Tracking ──────────────────────────────────────

  describe("getPlanProgress", () => {
    it("calculates progress correctly", () => {
      const plan = store.createPlan("Plan", "");
      const ms = store.addMilestone(plan.id, { title: "MS", description: "" });
      const t1 = store.addTask(ms.id, { title: "T1", description: "" });
      const t2 = store.addTask(ms.id, { title: "T2", description: "" });
      const t3 = store.addTask(ms.id, { title: "T3", description: "" });
      store.addTask(ms.id, { title: "T4", description: "" });

      // Complete t1
      store.advanceTask(t1.id);
      store.advanceTask(t1.id);

      // Fail t2
      store.advanceTask(t2.id);
      store.failTask(t2.id, "Error");

      // Skip t3
      store.skipTask(t3.id);

      const progress = store.getPlanProgress(plan.id);
      expect(progress.total).toBe(4);
      expect(progress.completed).toBe(1);
      expect(progress.failed).toBe(1);
      expect(progress.skipped).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.percentComplete).toBe(25);
    });

    it("returns 0% for empty plan", () => {
      const plan = store.createPlan("Empty", "");
      const progress = store.getPlanProgress(plan.id);
      expect(progress.total).toBe(0);
      expect(progress.percentComplete).toBe(0);
    });
  });
});
