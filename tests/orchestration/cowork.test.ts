/**
 * Cowork tests — decomposition, execution, aggregation layers.
 *
 * V9 Tier 14.7: covers the three public surfaces of cowork.ts with
 * deterministic injected clocks, synthetic worker delays, and vi.fn
 * spies. No file I/O, no env reads, no real LLM calls — pure logic.
 */

import { describe, it, expect, vi } from "vitest";
import {
  decomposeTask,
  runCoworkers,
  aggregateCowork,
  passthroughMerge,
  type CoworkTask,
  type CoworkSubtask,
  type CoworkWorker,
  type CoworkResult,
} from "../../src/orchestration/cowork.js";

// ── Fixtures ──────────────────────────────────────────────

const rootTask: CoworkTask = {
  id: "root-1",
  description: "refactor auth flow",
  scope: ["src/auth/login.ts", "src/auth/logout.ts", "src/auth/session.ts"],
};

function makeSubtask(
  id: string,
  parentId: string,
  scope: readonly string[],
  description = `sub-${id}`,
): CoworkSubtask {
  return { id, parentId, description, scope };
}

function okResult(subtaskId: string, output = `out-${subtaskId}`): CoworkResult {
  return { ok: true, subtaskId, output };
}

// ── Layer 1: Decomposition ────────────────────────────────

describe("decomposeTask", () => {
  it("returns a plan with the subtasks the decomposer produced", () => {
    const decomposer = (t: CoworkTask): readonly CoworkSubtask[] => [
      makeSubtask("s1", t.id, ["src/auth/login.ts"]),
      makeSubtask("s2", t.id, ["src/auth/logout.ts"]),
      makeSubtask("s3", t.id, ["src/auth/session.ts"]),
    ];
    const plan = decomposeTask(rootTask, decomposer);
    expect(plan.rootTask).toEqual(rootTask);
    expect(plan.subtasks).toHaveLength(3);
    expect(plan.subtasks.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("accepts an empty subtask list", () => {
    const plan = decomposeTask(rootTask, () => []);
    expect(plan.subtasks).toEqual([]);
    expect(plan.overlapping).toEqual([]);
  });

  it("flags overlapping scopes across subtasks", () => {
    const decomposer = (t: CoworkTask): readonly CoworkSubtask[] => [
      makeSubtask("s1", t.id, ["src/auth/login.ts", "src/auth/shared.ts"]),
      makeSubtask("s2", t.id, ["src/auth/logout.ts", "src/auth/shared.ts"]),
      makeSubtask("s3", t.id, ["src/auth/session.ts"]),
    ];
    const plan = decomposeTask(rootTask, decomposer);
    expect(plan.overlapping).toEqual(["src/auth/shared.ts"]);
  });

  it("reports no overlap when every scope is disjoint", () => {
    const decomposer = (t: CoworkTask): readonly CoworkSubtask[] => [
      makeSubtask("s1", t.id, ["a.ts"]),
      makeSubtask("s2", t.id, ["b.ts"]),
    ];
    expect(decomposeTask(rootTask, decomposer).overlapping).toEqual([]);
  });

  it("rejects a self-referential decomposer (parentId !== root.id)", () => {
    const decomposer = (_: CoworkTask): readonly CoworkSubtask[] => [
      makeSubtask("s1", "wrong-parent", ["a.ts"]),
    ];
    expect(() => decomposeTask(rootTask, decomposer)).toThrow(/parentId=wrong-parent/);
  });

  it("rejects duplicate subtask ids", () => {
    const decomposer = (t: CoworkTask): readonly CoworkSubtask[] => [
      makeSubtask("dup", t.id, ["a.ts"]),
      makeSubtask("dup", t.id, ["b.ts"]),
    ];
    expect(() => decomposeTask(rootTask, decomposer)).toThrow(/duplicate subtask id dup/);
  });
});

// ── Layer 2: Execution ────────────────────────────────────

describe("runCoworkers", () => {
  it("returns successCount==N and failureCount==0 when all succeed", async () => {
    const workers: CoworkWorker[] = ["a", "b", "c"].map((id) => ({
      subtaskId: id,
      execute: async () => okResult(id),
    }));
    const exec = await runCoworkers(workers);
    expect(exec.successCount).toBe(3);
    expect(exec.failureCount).toBe(0);
    expect(exec.results).toHaveLength(3);
  });

  it("captures a thrown worker as ok:false without affecting siblings", async () => {
    const workers: CoworkWorker[] = [
      { subtaskId: "a", execute: async () => okResult("a") },
      { subtaskId: "b", execute: async () => { throw new Error("boom"); } },
      { subtaskId: "c", execute: async () => okResult("c") },
    ];
    const exec = await runCoworkers(workers);
    expect(exec.successCount).toBe(2);
    expect(exec.failureCount).toBe(1);
    const bResult = exec.results.find((r) => r.subtaskId === "b");
    expect(bResult?.ok).toBe(false);
    if (bResult && bResult.ok === false) {
      expect(bResult.error).toBe("boom");
    }
  });

  it("captures non-Error throws as stringified errors", async () => {
    const workers: CoworkWorker[] = [
      { subtaskId: "a", execute: async () => { throw "string-error"; } },
    ];
    const exec = await runCoworkers(workers);
    expect(exec.results).toHaveLength(1);
    const result = exec.results[0]!;
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe("string-error");
    }
  });

  it("respects the concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const workers: CoworkWorker[] = Array.from({ length: 8 }, (_, i) => ({
      subtaskId: `w${i}`,
      execute: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return okResult(`w${i}`);
      },
    }));
    await runCoworkers(workers, { concurrency: 2 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("defaults concurrency to min(workers, 4) when unset", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const workers: CoworkWorker[] = Array.from({ length: 10 }, (_, i) => ({
      subtaskId: `w${i}`,
      execute: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return okResult(`w${i}`);
      },
    }));
    await runCoworkers(workers);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("abort signal prevents not-yet-started workers from running", async () => {
    const started: string[] = [];
    const controller = new AbortController();
    const workers: CoworkWorker[] = Array.from({ length: 10 }, (_, i) => ({
      subtaskId: `w${i}`,
      execute: async () => {
        started.push(`w${i}`);
        if (i === 0) controller.abort();
        await new Promise((r) => setTimeout(r, 1));
        return okResult(`w${i}`);
      },
    }));
    const exec = await runCoworkers(workers, {
      concurrency: 1,
      abortSignal: controller.signal,
    });
    // With concurrency=1 and abort after w0, only w0 runs.
    expect(started.length).toBeLessThan(workers.length);
    expect(exec.results.length).toBe(started.length);
  });

  it("records duration via an injected clock", async () => {
    let tick = 0;
    const now = () => {
      tick += 100;
      return tick;
    };
    const workers: CoworkWorker[] = [
      { subtaskId: "a", execute: async () => okResult("a") },
    ];
    const exec = await runCoworkers(workers, { now });
    expect(exec.durationMs).toBe(100);
  });

  it("handles an empty worker list without throwing", async () => {
    const exec = await runCoworkers([]);
    expect(exec.results).toEqual([]);
    expect(exec.successCount).toBe(0);
    expect(exec.failureCount).toBe(0);
  });

  it("clamps concurrency=0 to at least 1", async () => {
    const workers: CoworkWorker[] = [
      { subtaskId: "a", execute: async () => okResult("a") },
    ];
    const exec = await runCoworkers(workers, { concurrency: 0 });
    expect(exec.successCount).toBe(1);
  });
});

// ── Layer 3: Aggregation ──────────────────────────────────

describe("aggregateCowork", () => {
  const baseSubtasks: CoworkSubtask[] = [
    makeSubtask("s1", rootTask.id, ["src/auth/login.ts"]),
    makeSubtask("s2", rootTask.id, ["src/auth/logout.ts"]),
  ];
  const basePlan = {
    rootTask,
    subtasks: baseSubtasks,
    overlapping: [],
  } as const;

  it("invokes the merge function with all results", () => {
    const execution = {
      results: [okResult("s1"), okResult("s2")],
      durationMs: 10,
      successCount: 2,
      failureCount: 0,
    };
    const merge = vi.fn((rs: readonly CoworkResult[]) =>
      rs.map((r) => r.subtaskId).join(","),
    );
    const agg = aggregateCowork(basePlan, execution, { merge });
    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith(execution.results);
    expect(agg.output).toBe("s1,s2");
  });

  it("passes a custom merge output through unchanged", () => {
    const execution = {
      results: [okResult("s1", "alpha"), okResult("s2", "beta")],
      durationMs: 5,
      successCount: 2,
      failureCount: 0,
    };
    const agg = aggregateCowork<{ combined: string }>(basePlan, execution, {
      merge: (rs) => ({
        combined: rs
          .filter((r): r is Extract<CoworkResult, { ok: true }> => r.ok)
          .map((r) => r.output)
          .join("|"),
      }),
    });
    expect(agg.output).toEqual({ combined: "alpha|beta" });
  });

  it("reports scopeConflicts when 2+ successful workers share a scope", () => {
    const conflictPlan = {
      rootTask,
      subtasks: [
        makeSubtask("s1", rootTask.id, ["src/shared.ts", "src/a.ts"]),
        makeSubtask("s2", rootTask.id, ["src/shared.ts", "src/b.ts"]),
      ],
      overlapping: ["src/shared.ts"],
    } as const;
    const execution = {
      results: [okResult("s1"), okResult("s2")],
      durationMs: 1,
      successCount: 2,
      failureCount: 0,
    };
    const agg = aggregateCowork(conflictPlan, execution, { merge: passthroughMerge });
    expect(agg.scopeConflicts).toEqual(["src/shared.ts"]);
  });

  it("skips conflicts for failed workers (only succeeded workers count)", () => {
    const conflictPlan = {
      rootTask,
      subtasks: [
        makeSubtask("s1", rootTask.id, ["src/shared.ts"]),
        makeSubtask("s2", rootTask.id, ["src/shared.ts"]),
      ],
      overlapping: ["src/shared.ts"],
    } as const;
    const execution = {
      results: [
        okResult("s1"),
        { ok: false as const, subtaskId: "s2", error: "crashed" },
      ],
      durationMs: 1,
      successCount: 1,
      failureCount: 1,
    };
    const agg = aggregateCowork(conflictPlan, execution, { merge: passthroughMerge });
    expect(agg.scopeConflicts).toEqual([]);
    expect(agg.partialFailure).toBe(true);
  });

  it("sets partialFailure=true when any worker failed", () => {
    const execution = {
      results: [
        okResult("s1"),
        { ok: false as const, subtaskId: "s2", error: "oh no" },
      ],
      durationMs: 1,
      successCount: 1,
      failureCount: 1,
    };
    const agg = aggregateCowork(basePlan, execution, { merge: passthroughMerge });
    expect(agg.partialFailure).toBe(true);
  });

  it("sets partialFailure=false when every worker succeeded", () => {
    const execution = {
      results: [okResult("s1"), okResult("s2")],
      durationMs: 1,
      successCount: 2,
      failureCount: 0,
    };
    const agg = aggregateCowork(basePlan, execution, { merge: passthroughMerge });
    expect(agg.partialFailure).toBe(false);
  });

  it("invokes onConflict with the conflicting scopes when present", () => {
    const conflictPlan = {
      rootTask,
      subtasks: [
        makeSubtask("s1", rootTask.id, ["shared.ts"]),
        makeSubtask("s2", rootTask.id, ["shared.ts"]),
      ],
      overlapping: ["shared.ts"],
    } as const;
    const execution = {
      results: [okResult("s1"), okResult("s2")],
      durationMs: 1,
      successCount: 2,
      failureCount: 0,
    };
    const onConflict = vi.fn();
    aggregateCowork(conflictPlan, execution, {
      merge: passthroughMerge,
      onConflict,
    });
    expect(onConflict).toHaveBeenCalledWith(["shared.ts"]);
  });

  it("does NOT invoke onConflict when no conflicts exist", () => {
    const execution = {
      results: [okResult("s1"), okResult("s2")],
      durationMs: 1,
      successCount: 2,
      failureCount: 0,
    };
    const onConflict = vi.fn();
    aggregateCowork(basePlan, execution, { merge: passthroughMerge, onConflict });
    expect(onConflict).not.toHaveBeenCalled();
  });
});

// ── End-to-end wiring smoke test ───────────────────────────

describe("cowork end-to-end wiring", () => {
  it("decompose → run → aggregate composes into a full pipeline", async () => {
    const plan = decomposeTask(rootTask, (t) => [
      makeSubtask("s1", t.id, ["src/auth/login.ts"]),
      makeSubtask("s2", t.id, ["src/auth/logout.ts"]),
    ]);
    const workers: CoworkWorker[] = plan.subtasks.map((s) => ({
      subtaskId: s.id,
      execute: async () => okResult(s.id, `completed-${s.id}`),
    }));
    const exec = await runCoworkers(workers);
    const agg = aggregateCowork(plan, exec, {
      merge: (rs) =>
        rs
          .filter((r): r is Extract<CoworkResult, { ok: true }> => r.ok)
          .map((r) => r.output)
          .sort()
          .join("+"),
    });
    expect(agg.output).toBe("completed-s1+completed-s2");
    expect(agg.scopeConflicts).toEqual([]);
    expect(agg.partialFailure).toBe(false);
  });
});
