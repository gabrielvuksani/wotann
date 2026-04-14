/**
 * Task/TODO Tool — LLM-callable task management for agent bridge integration.
 *
 * Self-contained JSON-file-backed task store. Exposes CRUD operations
 * and a dispatch() method for agent bridge tool calls.
 *
 * Storage: {storageDir}/.wotann/tasks.json
 * Loads on construct, saves after every mutation.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface TaskItem {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly description?: string;
  readonly priority: TaskPriority;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly tags: readonly string[];
  readonly parentId?: string;
  readonly blockedBy: readonly string[];
}

export interface TaskToolResult {
  readonly success: boolean;
  readonly action: string;
  readonly data: unknown;
  readonly error?: string;
}

interface TaskToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

// ── Validation ───────────────────────────────────────────

const VALID_STATUSES: readonly TaskStatus[] = ["pending", "in_progress", "completed", "cancelled"];
const VALID_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "critical"];

function isValidStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

function isValidPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (VALID_PRIORITIES as readonly string[]).includes(value);
}

// ── Persistence ──────────────────────────────────────────

interface TaskStore {
  readonly tasks: readonly TaskItem[];
}

function loadStore(filePath: string): TaskStore {
  if (!existsSync(filePath)) {
    return { tasks: [] };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "tasks" in parsed && Array.isArray((parsed as TaskStore).tasks)) {
      return parsed as TaskStore;
    }
    return { tasks: [] };
  } catch {
    return { tasks: [] };
  }
}

function saveStore(filePath: string, store: TaskStore): void {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

// ── Tool Definitions for Agent Bridge ────────────────────

const TOOL_DEFINITIONS: readonly TaskToolDefinition[] = [
  {
    name: "task_create",
    description: "Create a new task with a title and optional description, priority, tags, and parent ID.",
    parameters: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Detailed description" },
        priority: { type: "string", enum: VALID_PRIORITIES, description: "Task priority (default: medium)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        parentId: { type: "string", description: "Parent task ID for subtasks" },
      },
    },
  },
  {
    name: "task_update",
    description: "Update the status of an existing task.",
    parameters: {
      type: "object",
      required: ["id", "status"],
      properties: {
        id: { type: "string", description: "Task ID to update" },
        status: { type: "string", enum: VALID_STATUSES, description: "New status" },
      },
    },
  },
  {
    name: "task_list",
    description: "List tasks with optional filters by status, priority, or tag.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: VALID_STATUSES, description: "Filter by status" },
        priority: { type: "string", enum: VALID_PRIORITIES, description: "Filter by priority" },
        tag: { type: "string", description: "Filter by tag" },
      },
    },
  },
  {
    name: "task_get",
    description: "Get a specific task by ID.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Task ID" },
      },
    },
  },
  {
    name: "task_delete",
    description: "Delete a task by ID.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Task ID to delete" },
      },
    },
  },
];

// ── TaskTool ─────────────────────────────────────────────

export class TaskTool {
  private readonly filePath: string;
  private tasks: readonly TaskItem[];

  constructor(storageDir: string) {
    const wotannDir = join(storageDir, ".wotann");
    if (!existsSync(wotannDir)) {
      mkdirSync(wotannDir, { recursive: true });
    }
    this.filePath = join(wotannDir, "tasks.json");
    this.tasks = loadStore(this.filePath).tasks;
  }

  /**
   * Create a new task. Returns the created TaskItem.
   */
  create(
    title: string,
    options?: {
      readonly description?: string;
      readonly priority?: string;
      readonly tags?: readonly string[];
      readonly parentId?: string;
    },
  ): TaskItem {
    const now = Date.now();
    const priority: TaskPriority = isValidPriority(options?.priority)
      ? options.priority
      : "medium";

    const task: TaskItem = {
      id: randomUUID(),
      title,
      status: "pending",
      description: options?.description,
      priority,
      createdAt: now,
      updatedAt: now,
      tags: options?.tags ? [...options.tags] : [],
      parentId: options?.parentId,
      blockedBy: [],
    };

    this.tasks = [...this.tasks, task];
    this.persist();
    return task;
  }

  /**
   * Update a task's status. Returns the updated task, or null if not found.
   */
  updateStatus(id: string, status: TaskStatus): TaskItem | null {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) return null;

    const existing = this.tasks[index];
    if (!existing) return null;

    const updated: TaskItem = {
      ...existing,
      status,
      updatedAt: Date.now(),
    };

    this.tasks = [
      ...this.tasks.slice(0, index),
      updated,
      ...this.tasks.slice(index + 1),
    ];
    this.persist();
    return updated;
  }

  /**
   * List tasks with optional filters.
   */
  list(filter?: {
    readonly status?: string;
    readonly priority?: string;
    readonly tag?: string;
  }): readonly TaskItem[] {
    let results = [...this.tasks];

    if (filter?.status && isValidStatus(filter.status)) {
      results = results.filter((t) => t.status === filter.status);
    }
    if (filter?.priority && isValidPriority(filter.priority)) {
      results = results.filter((t) => t.priority === filter.priority);
    }
    if (filter?.tag) {
      const tag = filter.tag;
      results = results.filter((t) => t.tags.includes(tag));
    }

    return results;
  }

  /**
   * Get a specific task by ID. Returns null if not found.
   */
  get(id: string): TaskItem | null {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  /**
   * Delete a task by ID. Returns true if the task was deleted.
   */
  delete(id: string): boolean {
    const initialLength = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);

    if (this.tasks.length < initialLength) {
      this.persist();
      return true;
    }
    return false;
  }

  /**
   * Dispatch a tool call by name. Used by agent bridge integration.
   * Returns a structured result suitable for LLM consumption.
   */
  dispatch(toolName: string, args: Record<string, unknown>): TaskToolResult {
    try {
      switch (toolName) {
        case "task_create": {
          const title = args["title"];
          if (typeof title !== "string" || title.trim() === "") {
            return { success: false, action: toolName, data: null, error: "title is required and must be a non-empty string" };
          }
          const task = this.create(title, {
            description: typeof args["description"] === "string" ? args["description"] : undefined,
            priority: typeof args["priority"] === "string" ? args["priority"] : undefined,
            tags: Array.isArray(args["tags"]) ? (args["tags"] as string[]) : undefined,
            parentId: typeof args["parentId"] === "string" ? args["parentId"] : undefined,
          });
          return { success: true, action: toolName, data: task };
        }

        case "task_update": {
          const id = args["id"];
          const status = args["status"];
          if (typeof id !== "string") {
            return { success: false, action: toolName, data: null, error: "id is required" };
          }
          if (!isValidStatus(status)) {
            return { success: false, action: toolName, data: null, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` };
          }
          const updated = this.updateStatus(id, status);
          if (!updated) {
            return { success: false, action: toolName, data: null, error: `Task not found: ${id}` };
          }
          return { success: true, action: toolName, data: updated };
        }

        case "task_list": {
          const items = this.list({
            status: typeof args["status"] === "string" ? args["status"] : undefined,
            priority: typeof args["priority"] === "string" ? args["priority"] : undefined,
            tag: typeof args["tag"] === "string" ? args["tag"] : undefined,
          });
          return { success: true, action: toolName, data: items };
        }

        case "task_get": {
          const id = args["id"];
          if (typeof id !== "string") {
            return { success: false, action: toolName, data: null, error: "id is required" };
          }
          const task = this.get(id);
          if (!task) {
            return { success: false, action: toolName, data: null, error: `Task not found: ${id}` };
          }
          return { success: true, action: toolName, data: task };
        }

        case "task_delete": {
          const id = args["id"];
          if (typeof id !== "string") {
            return { success: false, action: toolName, data: null, error: "id is required" };
          }
          const deleted = this.delete(id);
          if (!deleted) {
            return { success: false, action: toolName, data: null, error: `Task not found: ${id}` };
          }
          return { success: true, action: toolName, data: { deleted: true, id } };
        }

        default:
          return { success: false, action: toolName, data: null, error: `Unknown tool: ${toolName}` };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, action: toolName, data: null, error: message };
    }
  }

  /**
   * Get tool definitions for registration with the agent bridge.
   */
  getToolDefinitions(): readonly TaskToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  // ── Private ────────────────────────────────────────────

  private persist(): void {
    saveStore(this.filePath, { tasks: this.tasks });
  }
}
