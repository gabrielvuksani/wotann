import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskTool } from "../../src/tools/task-tool.js";
import { rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("TaskTool", () => {
  let storageDir: string;
  let tool: TaskTool;

  beforeEach(() => {
    storageDir = join(tmpdir(), `wotann-task-test-${randomUUID()}`);
    mkdirSync(storageDir, { recursive: true });
    tool = new TaskTool(storageDir);
  });

  afterEach(() => {
    try {
      rmSync(storageDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  // ── Create ───────────────────────────────────────────────

  describe("create()", () => {
    it("creates a task with required fields", () => {
      const task = tool.create("Build login page");

      expect(task.id).toBeTruthy();
      expect(task.title).toBe("Build login page");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe("medium");
      expect(task.tags).toEqual([]);
      expect(task.blockedBy).toEqual([]);
      expect(task.createdAt).toBeGreaterThan(0);
      expect(task.updatedAt).toBeGreaterThan(0);
    });

    it("creates a task with all optional fields", () => {
      const task = tool.create("Implement auth", {
        description: "OAuth2 flow",
        priority: "critical",
        tags: ["auth", "backend"],
        parentId: "parent-123",
      });

      expect(task.description).toBe("OAuth2 flow");
      expect(task.priority).toBe("critical");
      expect(task.tags).toEqual(["auth", "backend"]);
      expect(task.parentId).toBe("parent-123");
    });

    it("defaults to medium priority for invalid priority", () => {
      const task = tool.create("Task", { priority: "ULTRA" });
      expect(task.priority).toBe("medium");
    });

    it("generates unique IDs", () => {
      const a = tool.create("Task A");
      const b = tool.create("Task B");
      expect(a.id).not.toBe(b.id);
    });
  });

  // ── Read ─────────────────────────────────────────────────

  describe("get()", () => {
    it("returns a task by ID", () => {
      const created = tool.create("Find me");
      const found = tool.get(created.id);

      expect(found).not.toBeNull();
      expect(found?.title).toBe("Find me");
    });

    it("returns null for non-existent ID", () => {
      expect(tool.get("does-not-exist")).toBeNull();
    });
  });

  describe("list()", () => {
    it("returns all tasks when no filter", () => {
      tool.create("Task 1");
      tool.create("Task 2");
      tool.create("Task 3");

      const all = tool.list();
      expect(all).toHaveLength(3);
    });

    it("filters by status", () => {
      const t1 = tool.create("Pending");
      const t2 = tool.create("In Progress");
      tool.updateStatus(t2.id, "in_progress");

      const pending = tool.list({ status: "pending" });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe(t1.id);
    });

    it("filters by priority", () => {
      tool.create("Low task", { priority: "low" });
      tool.create("High task", { priority: "high" });
      tool.create("Another low", { priority: "low" });

      const lows = tool.list({ priority: "low" });
      expect(lows).toHaveLength(2);
    });

    it("filters by tag", () => {
      tool.create("Tagged", { tags: ["frontend"] });
      tool.create("Other", { tags: ["backend"] });
      tool.create("Both", { tags: ["frontend", "backend"] });

      const frontend = tool.list({ tag: "frontend" });
      expect(frontend).toHaveLength(2);
    });

    it("returns empty array when no tasks exist", () => {
      expect(tool.list()).toHaveLength(0);
    });

    it("ignores invalid filter values", () => {
      tool.create("Task");
      const result = tool.list({ status: "INVALID_STATUS" });
      // Invalid status doesn't match any task, returns all (no filter applied)
      expect(result).toHaveLength(1);
    });
  });

  // ── Update ───────────────────────────────────────────────

  describe("updateStatus()", () => {
    it("updates task status", () => {
      const task = tool.create("Do thing");
      const updated = tool.updateStatus(task.id, "in_progress");

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("in_progress");
    });

    it("updates the updatedAt timestamp", () => {
      const task = tool.create("Do thing");
      const originalUpdatedAt = task.updatedAt;

      // Small delay to ensure timestamp differs
      const updated = tool.updateStatus(task.id, "completed");
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it("returns null for non-existent task", () => {
      expect(tool.updateStatus("ghost", "completed")).toBeNull();
    });

    it("preserves other task fields on update", () => {
      const task = tool.create("Tagged task", {
        description: "Has description",
        priority: "high",
        tags: ["important"],
      });

      const updated = tool.updateStatus(task.id, "in_progress");

      expect(updated?.title).toBe("Tagged task");
      expect(updated?.description).toBe("Has description");
      expect(updated?.priority).toBe("high");
      expect(updated?.tags).toEqual(["important"]);
    });
  });

  // ── Delete ───────────────────────────────────────────────

  describe("delete()", () => {
    it("deletes an existing task", () => {
      const task = tool.create("Delete me");
      const deleted = tool.delete(task.id);

      expect(deleted).toBe(true);
      expect(tool.get(task.id)).toBeNull();
    });

    it("returns false for non-existent task", () => {
      expect(tool.delete("nope")).toBe(false);
    });

    it("does not affect other tasks", () => {
      const keep = tool.create("Keep me");
      const remove = tool.create("Remove me");

      tool.delete(remove.id);

      expect(tool.get(keep.id)).not.toBeNull();
      expect(tool.list()).toHaveLength(1);
    });
  });

  // ── Persistence ────────────────────────────────────────

  describe("persistence", () => {
    it("persists tasks to disk", () => {
      tool.create("Persistent task");

      const filePath = join(storageDir, ".wotann", "tasks.json");
      expect(existsSync(filePath)).toBe(true);

      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as { tasks: unknown[] };
      expect(data.tasks).toHaveLength(1);
    });

    it("loads tasks from disk on construction", () => {
      tool.create("Survives reload");
      tool.create("Also survives");

      // Create a new instance pointing to same storage
      const tool2 = new TaskTool(storageDir);
      const tasks = tool2.list();

      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.title).toBe("Survives reload");
    });

    it("persists status updates", () => {
      const task = tool.create("Update me");
      tool.updateStatus(task.id, "completed");

      const tool2 = new TaskTool(storageDir);
      const loaded = tool2.get(task.id);

      expect(loaded?.status).toBe("completed");
    });

    it("persists deletes", () => {
      const task = tool.create("Delete me");
      tool.delete(task.id);

      const tool2 = new TaskTool(storageDir);
      expect(tool2.get(task.id)).toBeNull();
      expect(tool2.list()).toHaveLength(0);
    });

    it("handles corrupted JSON file gracefully", () => {
      const filePath = join(storageDir, ".wotann", "tasks.json");
      mkdirSync(join(storageDir, ".wotann"), { recursive: true });
      const { writeFileSync } = require("node:fs");
      writeFileSync(filePath, "NOT VALID JSON{{{", "utf-8");

      const tool2 = new TaskTool(storageDir);
      expect(tool2.list()).toHaveLength(0);
    });

    it("handles missing tasks key in JSON", () => {
      const filePath = join(storageDir, ".wotann", "tasks.json");
      mkdirSync(join(storageDir, ".wotann"), { recursive: true });
      const { writeFileSync } = require("node:fs");
      writeFileSync(filePath, '{"other": true}', "utf-8");

      const tool2 = new TaskTool(storageDir);
      expect(tool2.list()).toHaveLength(0);
    });
  });

  // ── Dispatch (Agent Bridge) ────────────────────────────

  describe("dispatch()", () => {
    describe("task_create", () => {
      it("creates a task via dispatch", () => {
        const result = tool.dispatch("task_create", { title: "Dispatched task" });

        expect(result.success).toBe(true);
        expect(result.action).toBe("task_create");
        expect((result.data as { title: string }).title).toBe("Dispatched task");
      });

      it("returns error for missing title", () => {
        const result = tool.dispatch("task_create", {});

        expect(result.success).toBe(false);
        expect(result.error).toContain("title");
      });

      it("returns error for empty title", () => {
        const result = tool.dispatch("task_create", { title: "  " });

        expect(result.success).toBe(false);
        expect(result.error).toContain("title");
      });

      it("passes optional fields through", () => {
        const result = tool.dispatch("task_create", {
          title: "Full task",
          description: "Detailed",
          priority: "high",
          tags: ["api"],
          parentId: "p-1",
        });

        expect(result.success).toBe(true);
        const data = result.data as { description: string; priority: string; tags: string[]; parentId: string };
        expect(data.description).toBe("Detailed");
        expect(data.priority).toBe("high");
        expect(data.tags).toEqual(["api"]);
        expect(data.parentId).toBe("p-1");
      });
    });

    describe("task_update", () => {
      it("updates status via dispatch", () => {
        const task = tool.create("Update via dispatch");
        const result = tool.dispatch("task_update", {
          id: task.id,
          status: "completed",
        });

        expect(result.success).toBe(true);
        expect((result.data as { status: string }).status).toBe("completed");
      });

      it("returns error for missing id", () => {
        const result = tool.dispatch("task_update", { status: "completed" });
        expect(result.success).toBe(false);
        expect(result.error).toContain("id");
      });

      it("returns error for invalid status", () => {
        const task = tool.create("Task");
        const result = tool.dispatch("task_update", {
          id: task.id,
          status: "WRONG",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid status");
      });

      it("returns error for non-existent task", () => {
        const result = tool.dispatch("task_update", {
          id: "ghost-id",
          status: "completed",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("not found");
      });
    });

    describe("task_list", () => {
      it("lists all tasks via dispatch", () => {
        tool.create("A");
        tool.create("B");

        const result = tool.dispatch("task_list", {});

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it("filters tasks via dispatch", () => {
        tool.create("Low", { priority: "low" });
        tool.create("High", { priority: "high" });

        const result = tool.dispatch("task_list", { priority: "high" });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });
    });

    describe("task_get", () => {
      it("gets task via dispatch", () => {
        const task = tool.create("Fetch me");
        const result = tool.dispatch("task_get", { id: task.id });

        expect(result.success).toBe(true);
        expect((result.data as { title: string }).title).toBe("Fetch me");
      });

      it("returns error for missing id", () => {
        const result = tool.dispatch("task_get", {});
        expect(result.success).toBe(false);
      });

      it("returns error for non-existent task", () => {
        const result = tool.dispatch("task_get", { id: "nope" });
        expect(result.success).toBe(false);
        expect(result.error).toContain("not found");
      });
    });

    describe("task_delete", () => {
      it("deletes task via dispatch", () => {
        const task = tool.create("Gone");
        const result = tool.dispatch("task_delete", { id: task.id });

        expect(result.success).toBe(true);
        expect(tool.get(task.id)).toBeNull();
      });

      it("returns error for non-existent task", () => {
        const result = tool.dispatch("task_delete", { id: "missing" });
        expect(result.success).toBe(false);
      });
    });

    describe("unknown tool", () => {
      it("returns error for unknown tool name", () => {
        const result = tool.dispatch("task_unknown", {});

        expect(result.success).toBe(false);
        expect(result.error).toContain("Unknown tool");
      });
    });
  });

  // ── Tool Definitions ───────────────────────────────────

  describe("getToolDefinitions()", () => {
    it("returns 5 tool definitions", () => {
      const defs = tool.getToolDefinitions();
      expect(defs).toHaveLength(5);
    });

    it("includes all expected tool names", () => {
      const defs = tool.getToolDefinitions();
      const names = defs.map((d) => d.name);

      expect(names).toContain("task_create");
      expect(names).toContain("task_update");
      expect(names).toContain("task_list");
      expect(names).toContain("task_get");
      expect(names).toContain("task_delete");
    });

    it("each definition has name, description, and parameters", () => {
      const defs = tool.getToolDefinitions();

      for (const def of defs) {
        expect(typeof def.name).toBe("string");
        expect(typeof def.description).toBe("string");
        expect(def.description.length).toBeGreaterThan(0);
        expect(typeof def.parameters).toBe("object");
      }
    });
  });
});
