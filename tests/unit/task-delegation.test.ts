import { describe, it, expect } from "vitest";
import { TaskDelegationManager, type DelegationContext, type DelegationConstraints, type DelegationResult } from "../../src/orchestration/task-delegation.js";

describe("TaskDelegationManager", () => {
  function makeContext(): DelegationContext {
    return {
      workingDir: "/tmp/test",
      relevantFiles: ["src/index.ts"],
      decisions: [],
      priorAttempts: [],
      memoryEntryIds: [],
      parentSessionId: "session-1",
    };
  }

  function makeConstraints(): DelegationConstraints {
    return {
      maxTimeMs: 60_000,
      maxCostUsd: 1.0,
      allowedFiles: ["src/**"],
      forbiddenFiles: ["node_modules/**"],
      mustPass: ["npm test"],
    };
  }

  function makeResult(success: boolean): DelegationResult {
    return {
      success,
      output: success ? "All tests pass" : "Test failed",
      filesModified: ["src/index.ts"],
      testsRun: 5,
      testsPassed: success ? 5 : 3,
      costUsd: 0.12,
      tokensUsed: 5000,
      knowledgeExtracted: success ? ["Pattern: use immutable updates"] : [],
      errors: success ? [] : ["TypeError: undefined is not a function"],
    };
  }

  it("creates a delegation task", () => {
    const mgr = new TaskDelegationManager();
    const task = mgr.create("parent-1", "Fix the auth module", makeContext(), makeConstraints());

    expect(task.id).toBeDefined();
    expect(task.parentAgentId).toBe("parent-1");
    expect(task.status).toBe("pending");
    expect(task.task).toBe("Fix the auth module");
  });

  it("accepts and marks in-progress", () => {
    const mgr = new TaskDelegationManager();
    const task = mgr.create("parent-1", "Fix auth", makeContext(), makeConstraints());

    expect(mgr.accept(task.id, "child-1")).toBe(true);
    expect(mgr.getTask(task.id)!.status).toBe("accepted");
    expect(mgr.getTask(task.id)!.childAgentId).toBe("child-1");

    expect(mgr.markInProgress(task.id)).toBe(true);
    expect(mgr.getTask(task.id)!.status).toBe("in-progress");
  });

  it("completes a delegation with results", () => {
    const mgr = new TaskDelegationManager();
    const task = mgr.create("parent-1", "Fix auth", makeContext(), makeConstraints());
    mgr.accept(task.id, "child-1");

    const result = makeResult(true);
    expect(mgr.complete(task.id, result)).toBe(true);
    expect(mgr.getTask(task.id)!.status).toBe("completed");
    expect(mgr.getResult(task.id)).toEqual(result);
  });

  it("fails a delegation", () => {
    const mgr = new TaskDelegationManager();
    const task = mgr.create("parent-1", "Fix auth", makeContext(), makeConstraints());
    mgr.accept(task.id, "child-1");

    const result = makeResult(false);
    expect(mgr.complete(task.id, result)).toBe(true);
    expect(mgr.getTask(task.id)!.status).toBe("failed");
  });

  it("rolls back a failed delegation", () => {
    const mgr = new TaskDelegationManager();
    const task = mgr.create("parent-1", "Fix auth", makeContext(), makeConstraints());
    mgr.accept(task.id, "child-1");
    mgr.complete(task.id, makeResult(false));

    expect(mgr.rollback(task.id)).toBe(true);
    expect(mgr.getTask(task.id)!.status).toBe("rolled-back");
  });

  it("getPending returns only pending tasks", () => {
    const mgr = new TaskDelegationManager();
    mgr.create("p", "task-1", makeContext(), makeConstraints());
    const t2 = mgr.create("p", "task-2", makeContext(), makeConstraints());
    mgr.accept(t2.id, "child");

    const pending = mgr.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.task).toBe("task-1");
  });

  it("getByParent returns tasks for a specific parent", () => {
    const mgr = new TaskDelegationManager();
    mgr.create("parent-A", "A-task", makeContext(), makeConstraints());
    mgr.create("parent-B", "B-task", makeContext(), makeConstraints());

    expect(mgr.getByParent("parent-A")).toHaveLength(1);
    expect(mgr.getByParent("parent-A")[0]!.task).toBe("A-task");
  });

  it("extractKnowledge collects from completed delegations", () => {
    const mgr = new TaskDelegationManager();
    const t1 = mgr.create("parent", "task-1", makeContext(), makeConstraints());
    mgr.accept(t1.id, "child");
    mgr.complete(t1.id, makeResult(true));

    const knowledge = mgr.extractKnowledge("parent");
    expect(knowledge).toContain("Pattern: use immutable updates");
  });
});
