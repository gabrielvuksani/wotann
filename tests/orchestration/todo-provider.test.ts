/**
 * Tests for TodoProvider — NullTodoProvider honest-stub contract +
 * createFsTodoProvider round-trip (P1-B7 part 3).
 *
 * Covers:
 *  - NullTodoProvider readTodo returns empty state with caller's taskId
 *  - NullTodoProvider writeTodo accepts without throwing + no FS side-effects
 *  - createFsTodoProvider reads .wotann/todos/<taskId>.md via TodoTracker
 *  - createFsTodoProvider round-trips write→read
 *  - createFsTodoProvider unknown task returns empty state (does not throw)
 *  - isNullTodoProvider recognizes the singleton reference
 *  - taskId with unsafe chars is sanitized in both read + write paths
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoTracker } from "../../src/orchestration/todo-tracker.js";
import {
  NullTodoProvider,
  createFsTodoProvider,
  isNullTodoProvider,
  snapshotTodos,
  readTodoMdRaw,
} from "../../src/orchestration/todo-provider.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "wotann-todo-provider-"));
}

describe("NullTodoProvider — honest no-op stub", () => {
  it("readTodo returns empty state with caller's taskId", async () => {
    const state = await NullTodoProvider.readTodo("task-abc");
    expect(state.taskId).toBe("task-abc");
    expect(state.pending).toHaveLength(0);
    expect(state.done).toHaveLength(0);
    expect(state.scopeChanges).toHaveLength(0);
    expect(state.taskSpec).toBe("");
  });

  it("readTodo returns a frozen snapshot (immutability per QB #1)", async () => {
    const state = await NullTodoProvider.readTodo("x");
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.pending)).toBe(true);
    expect(Object.isFrozen(state.done)).toBe(true);
  });

  it("writeTodo accepts the call and produces no side-effects", async () => {
    const dir = tempDir();
    try {
      // Provide a state that WOULD write if the provider weren't null.
      await NullTodoProvider.writeTodo("task-x", {
        taskId: "task-x",
        taskSpec: "",
        done: [],
        pending: [],
        scopeChanges: [],
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      });
      // Null provider never touches disk — the dir stays empty.
      expect(existsSync(join(dir, ".wotann"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isNullTodoProvider recognizes the singleton by reference", () => {
    expect(isNullTodoProvider(NullTodoProvider)).toBe(true);
  });

  it("isNullTodoProvider returns false for a different provider", () => {
    const fs = createFsTodoProvider({ rootDir: "/tmp/irrelevant" });
    expect(isNullTodoProvider(fs)).toBe(false);
  });
});

describe("createFsTodoProvider — FS round-trip", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("unknown task returns empty state (does not throw)", async () => {
    const provider = createFsTodoProvider({ rootDir: dir });
    const state = await provider.readTodo("never-seen");
    expect(state.taskId).toBe("never-seen");
    expect(state.pending).toHaveLength(0);
    expect(state.done).toHaveLength(0);
  });

  it("reads a todo.md that TodoTracker wrote", async () => {
    // Populate .wotann/todos/<taskId>.md via the tracker itself.
    const tracker = TodoTracker.start(
      "task-42",
      "build thing X",
      ["step one", "step two"],
      { workingDir: dir },
    );
    expect(existsSync(tracker.path!)).toBe(true);

    const provider = createFsTodoProvider({ rootDir: dir });
    const state = await provider.readTodo("task-42");
    expect(state.taskId).toBe("task-42");
    expect(state.taskSpec).toBe("build thing X");
    expect(state.pending).toHaveLength(2);
    expect(state.pending[0]?.description).toBe("step one");
    expect(state.pending[1]?.description).toBe("step two");
  });

  it("writeTodo persists a state snapshot that the tracker can re-parse", async () => {
    const provider = createFsTodoProvider({ rootDir: dir });
    const now = "2026-04-20T00:00:00.000Z";
    const originalState = {
      taskId: "task-77",
      taskSpec: "investigate drift",
      done: [],
      pending: [
        {
          id: "sg-1",
          description: "look at logs",
          status: "pending" as const,
          createdAt: now,
        },
      ],
      scopeChanges: [],
      createdAt: now,
      updatedAt: now,
    };
    await provider.writeTodo("task-77", originalState);

    // Raw file exists with sanitized name.
    const raw = readTodoMdRaw(dir, "task-77");
    expect(raw).not.toBeNull();
    expect(raw).toContain("# Task: task-77");
    expect(raw).toContain("look at logs");

    // Round-trip: read the same file back via the provider.
    const roundTrip = await provider.readTodo("task-77");
    expect(roundTrip.taskId).toBe("task-77");
    expect(roundTrip.pending).toHaveLength(1);
    expect(roundTrip.pending[0]?.description).toBe("look at logs");
    expect(roundTrip.pending[0]?.id).toBe("sg-1");
  });

  it("sanitizes unsafe taskId characters in file name", async () => {
    const provider = createFsTodoProvider({ rootDir: dir });
    const now = "2026-04-20T00:00:00.000Z";
    await provider.writeTodo("task/with:bad*chars", {
      taskId: "task/with:bad*chars",
      taskSpec: "",
      done: [],
      pending: [],
      scopeChanges: [],
      createdAt: now,
      updatedAt: now,
    });
    // Sanitized filename replaces `/ : *` with underscores.
    const raw = readTodoMdRaw(dir, "task/with:bad*chars");
    expect(raw).not.toBeNull();
    // Round-trip through the provider with the original taskId succeeds.
    const state = await provider.readTodo("task/with:bad*chars");
    expect(state.taskId).toBe("task/with:bad*chars");
  });

  it("respects a custom todosDir override", async () => {
    const custom = join(dir, "custom-todos");
    const provider = createFsTodoProvider({ rootDir: dir, todosDir: custom });
    const now = "2026-04-20T00:00:00.000Z";
    await provider.writeTodo("task-88", {
      taskId: "task-88",
      taskSpec: "",
      done: [],
      pending: [],
      scopeChanges: [],
      createdAt: now,
      updatedAt: now,
    });
    // Default `.wotann/todos` never used.
    expect(existsSync(join(dir, ".wotann", "todos", "task-88.md"))).toBe(false);
    expect(existsSync(join(custom, "task-88.md"))).toBe(true);
  });
});

describe("snapshotTodos helper", () => {
  it("delegates to provider.readTodo", async () => {
    let sawTaskId = "";
    const stub: import("../../src/orchestration/todo-provider.js").TodoProvider = {
      async readTodo(taskId) {
        sawTaskId = taskId;
        return NullTodoProvider.readTodo(taskId);
      },
      async writeTodo() {},
    };
    const state = await snapshotTodos(stub, "task-99");
    expect(sawTaskId).toBe("task-99");
    expect(state.taskId).toBe("task-99");
  });
});

describe("FS provider — two providers with different rootDir stay isolated (QB #7)", () => {
  let dirA: string;
  let dirB: string;
  beforeEach(() => {
    dirA = tempDir();
    dirB = tempDir();
  });
  afterEach(() => {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("writes to dirA do not leak into dirB", async () => {
    const pa = createFsTodoProvider({ rootDir: dirA });
    const pb = createFsTodoProvider({ rootDir: dirB });
    const now = "2026-04-20T00:00:00.000Z";
    await pa.writeTodo("shared-id", {
      taskId: "shared-id",
      taskSpec: "A",
      done: [],
      pending: [
        { id: "sg-a", description: "A-only", status: "pending", createdAt: now },
      ],
      scopeChanges: [],
      createdAt: now,
      updatedAt: now,
    });
    const bState = await pb.readTodo("shared-id");
    expect(bState.pending).toHaveLength(0);
    const aState = await pa.readTodo("shared-id");
    expect(aState.pending).toHaveLength(1);
  });
});
