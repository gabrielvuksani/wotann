import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskIsolationManager, TaskIsolationError } from "../../src/sandbox/task-isolation.js";

/**
 * Tests for TaskIsolationManager.
 *
 * Since actual git worktree operations require a real repo, these tests
 * mock the async git calls and test the state management logic.
 * Integration tests with real git repos belong in tests/integration/.
 */

// Mock util.promisify to return a stub for execFileAsync
vi.mock("node:util", async () => {
  const actual = await vi.importActual<typeof import("node:util")>("node:util");
  return {
    ...actual,
    promisify: () => {
      // Returns a mock execFileAsync
      return async (_cmd: string, args: string[]) => {
        const argsStr = args?.join(" ") ?? "";

        if (argsStr.includes("rev-parse --git-dir")) {
          return { stdout: ".git", stderr: "" };
        }
        if (argsStr.includes("rev-parse HEAD")) {
          return { stdout: "abc1234\n", stderr: "" };
        }

        return { stdout: "", stderr: "" };
      };
    },
  };
});

// Mock fs to avoid actual filesystem operations
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    watch: vi.fn().mockReturnValue({ close: vi.fn() }),
  };
});

describe("TaskIsolationManager", () => {
  let manager: TaskIsolationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TaskIsolationManager("/fake/repo", "/fake/isolation");
  });

  describe("createIsolation", () => {
    it("creates an isolated task with correct properties", async () => {
      const task = await manager.createIsolation("task-1", "implement feature X");

      expect(task.id).toBe("task-1");
      expect(task.branch).toBe("wotann/task/task-1");
      expect(task.task).toBe("implement feature X");
      expect(task.status).toBe("active");
      expect(task.createdAt).toBeTruthy();
    });

    it("throws when creating a duplicate task ID", async () => {
      await manager.createIsolation("task-1", "first task");

      await expect(
        manager.createIsolation("task-1", "second task"),
      ).rejects.toThrow(TaskIsolationError);
    });

    it("generates an ID when empty string provided", async () => {
      const task = await manager.createIsolation("", "auto-id task");
      expect(task.id).toBeTruthy();
      expect(task.id.length).toBeGreaterThan(0);
    });

    it("sets worktree path under isolation directory", async () => {
      const task = await manager.createIsolation("task-1", "test");
      expect(task.worktreePath).toContain("/fake/isolation/task-1");
    });
  });

  describe("completeTask", () => {
    it("transitions active task to completed", async () => {
      await manager.createIsolation("task-1", "test");
      const completed = manager.completeTask("task-1");

      expect(completed.status).toBe("completed");
      expect(completed.id).toBe("task-1");
    });

    it("throws when task does not exist", () => {
      expect(() => manager.completeTask("nonexistent")).toThrow(TaskIsolationError);
    });

    it("throws when task is not active", async () => {
      await manager.createIsolation("task-1", "test");
      manager.completeTask("task-1");

      expect(() => manager.completeTask("task-1")).toThrow("not active");
    });

    it("preserves other task properties on transition", async () => {
      const original = await manager.createIsolation("task-1", "test");
      const completed = manager.completeTask("task-1");

      expect(completed.branch).toBe(original.branch);
      expect(completed.worktreePath).toBe(original.worktreePath);
      expect(completed.task).toBe(original.task);
      expect(completed.createdAt).toBe(original.createdAt);
    });
  });

  describe("failTask", () => {
    it("transitions active task to failed", async () => {
      await manager.createIsolation("task-1", "test");
      const failed = manager.failTask("task-1");

      expect(failed.status).toBe("failed");
    });

    it("throws when task is not active", async () => {
      await manager.createIsolation("task-1", "test");
      manager.completeTask("task-1");

      expect(() => manager.failTask("task-1")).toThrow("not active");
    });

    it("throws for nonexistent task", () => {
      expect(() => manager.failTask("ghost")).toThrow(TaskIsolationError);
    });
  });

  describe("mergeTask", () => {
    it("merges a completed task successfully", async () => {
      await manager.createIsolation("task-1", "test");
      manager.completeTask("task-1");

      const result = await manager.mergeTask("task-1");

      expect(result.success).toBe(true);
      expect(result.taskId).toBe("task-1");
      expect(result.conflictFiles).toHaveLength(0);
      expect(result.mergedAt).toBeTruthy();
    });

    it("throws when merging a non-completed task", async () => {
      await manager.createIsolation("task-1", "test");

      await expect(manager.mergeTask("task-1")).rejects.toThrow('must be "completed"');
    });

    it("updates task status to merged on success", async () => {
      await manager.createIsolation("task-1", "test");
      manager.completeTask("task-1");
      await manager.mergeTask("task-1");

      const task = manager.getTask("task-1");
      expect(task?.status).toBe("merged");
    });

    it("throws for nonexistent task", async () => {
      await expect(manager.mergeTask("nonexistent")).rejects.toThrow(TaskIsolationError);
    });
  });

  describe("discardTask", () => {
    it("removes a task from tracking", async () => {
      await manager.createIsolation("task-1", "test");
      const result = await manager.discardTask("task-1");

      expect(result).toBe(true);
      expect(manager.getTask("task-1")).toBeUndefined();
    });

    it("returns false for nonexistent task", async () => {
      const result = await manager.discardTask("nonexistent");
      expect(result).toBe(false);
    });

    it("throws when discarding a merged task", async () => {
      await manager.createIsolation("task-1", "test");
      manager.completeTask("task-1");
      await manager.mergeTask("task-1");

      await expect(manager.discardTask("task-1")).rejects.toThrow("Cannot discard merged task");
    });
  });

  describe("listActive", () => {
    it("returns empty array when no tasks exist", () => {
      expect(manager.listActive()).toEqual([]);
    });

    it("returns active and completed tasks", async () => {
      await manager.createIsolation("task-1", "active task");
      await manager.createIsolation("task-2", "completed task");
      manager.completeTask("task-2");

      const active = manager.listActive();
      expect(active).toHaveLength(2);
    });

    it("excludes failed tasks", async () => {
      await manager.createIsolation("task-1", "active");
      await manager.createIsolation("task-2", "will fail");
      manager.failTask("task-2");

      const active = manager.listActive();
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe("task-1");
    });

    it("excludes merged tasks", async () => {
      await manager.createIsolation("task-1", "will merge");
      manager.completeTask("task-1");
      await manager.mergeTask("task-1");

      await manager.createIsolation("task-2", "still active");

      const active = manager.listActive();
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe("task-2");
    });
  });

  describe("listAll", () => {
    it("returns all tasks regardless of status", async () => {
      await manager.createIsolation("task-1", "active");
      await manager.createIsolation("task-2", "will complete");
      await manager.createIsolation("task-3", "will fail");
      manager.completeTask("task-2");
      manager.failTask("task-3");

      expect(manager.listAll()).toHaveLength(3);
    });
  });

  describe("getTask", () => {
    it("returns undefined for nonexistent task", () => {
      expect(manager.getTask("nonexistent")).toBeUndefined();
    });

    it("returns the correct task", async () => {
      await manager.createIsolation("task-1", "test task");
      const task = manager.getTask("task-1");

      expect(task?.id).toBe("task-1");
      expect(task?.task).toBe("test task");
    });
  });

  describe("cleanup", () => {
    it("removes failed tasks", async () => {
      await manager.createIsolation("task-1", "will fail");
      manager.failTask("task-1");

      const result = await manager.cleanup();
      expect(result.removedCount).toBe(1);
      expect(result.removedIds).toContain("task-1");
    });

    it("removes merged tasks", async () => {
      await manager.createIsolation("task-1", "will merge");
      manager.completeTask("task-1");
      await manager.mergeTask("task-1");

      const result = await manager.cleanup();
      expect(result.removedCount).toBe(1);
    });

    it("keeps active tasks within threshold", async () => {
      await manager.createIsolation("task-1", "recent active");

      const result = await manager.cleanup();
      expect(result.removedCount).toBe(0);
    });

    it("removes stale active tasks beyond threshold", async () => {
      await manager.createIsolation("task-1", "stale task");

      // Use very short threshold to force cleanup
      const result = await manager.cleanup(0);
      expect(result.removedCount).toBe(1);
    });

    it("returns IDs of removed tasks", async () => {
      await manager.createIsolation("task-a", "fail");
      await manager.createIsolation("task-b", "fail too");
      manager.failTask("task-a");
      manager.failTask("task-b");

      const result = await manager.cleanup();
      expect(result.removedIds).toContain("task-a");
      expect(result.removedIds).toContain("task-b");
    });
  });
});
