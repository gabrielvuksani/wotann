import { describe, it, expect, vi } from "vitest";
import {
  createSleepTimeAgent,
  type SleepTimeAgentOptions,
  type SleepTimeTask,
  type SleepTimeResult,
  type SleepTimeOpportunity,
} from "../../src/learning/sleep-time-agent.js";

// ── Helpers ────────────────────────────────────────────────

function makeOpportunity(): SleepTimeOpportunity {
  return {
    signal: "explicit-trigger",
    detectedAt: 0,
    estimatedIdleMs: 30_000,
  };
}

function makeTask(overrides: Partial<SleepTimeTask> & { id: string }): SleepTimeTask {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "memory-consolidation",
    priority: overrides.priority ?? 50,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0.01,
    estimatedDurationMs: overrides.estimatedDurationMs ?? 100,
    payload: overrides.payload ?? null,
    ...(overrides.dependencies !== undefined ? { dependencies: overrides.dependencies } : {}),
  };
}

/** Counter clock — advances by `step` on every call. */
function counterClock(step: number = 100): () => number {
  let t = 0;
  return () => {
    const current = t;
    t += step;
    return current;
  };
}

/** Executor that records call order and returns an `ok` result. */
function makeRecordingExecutor(options: {
  readonly costPerTask?: number;
  readonly durationPerTask?: number;
  readonly okFor?: readonly string[];
  readonly throwFor?: readonly string[];
} = {}) {
  const callOrder: string[] = [];
  const fn = vi.fn(async (task: SleepTimeTask): Promise<SleepTimeResult> => {
    callOrder.push(task.id);
    if (options.throwFor?.includes(task.id)) {
      throw new Error(`boom-${task.id}`);
    }
    return {
      taskId: task.id,
      ok: options.okFor ? options.okFor.includes(task.id) : true,
      outputSummary: `ran ${task.id}`,
      durationMs: options.durationPerTask ?? 100,
      costUsd: options.costPerTask ?? 0.01,
    };
  });
  return { fn, callOrder };
}

// ── Basic Queue Semantics ──────────────────────────────────

describe("createSleepTimeAgent — queue basics", () => {
  it("fresh agent has queueLength 0", () => {
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({ taskExecutor: fn });
    expect(agent.queueLength()).toBe(0);
  });

  it("submit adds to queue", () => {
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({ taskExecutor: fn });
    agent.submit(makeTask({ id: "t1" }));
    agent.submit(makeTask({ id: "t2" }));
    expect(agent.queueLength()).toBe(2);
  });

  it("clearQueue returns the count cleared", () => {
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({ taskExecutor: fn });
    agent.submit(makeTask({ id: "t1" }));
    agent.submit(makeTask({ id: "t2" }));
    agent.submit(makeTask({ id: "t3" }));
    expect(agent.clearQueue()).toBe(3);
    expect(agent.queueLength()).toBe(0);
  });

  it("clearQueue on empty returns 0", () => {
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({ taskExecutor: fn });
    expect(agent.clearQueue()).toBe(0);
  });
});

// ── Priority Queue Ordering ────────────────────────────────

describe("createSleepTimeAgent — priority ordering", () => {
  it("higher priority is served first", async () => {
    const { fn, callOrder } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    agent.submit(makeTask({ id: "low", priority: 10 }));
    agent.submit(makeTask({ id: "high", priority: 90 }));
    agent.submit(makeTask({ id: "mid", priority: 50 }));
    await agent.runIdleSession(makeOpportunity());
    expect(callOrder).toEqual(["high", "mid", "low"]);
  });

  it("equal priority: lower cost served first", async () => {
    const { fn, callOrder } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    agent.submit(makeTask({ id: "expensive", priority: 50, estimatedCostUsd: 0.20 }));
    agent.submit(makeTask({ id: "cheap", priority: 50, estimatedCostUsd: 0.01 }));
    agent.submit(makeTask({ id: "medium", priority: 50, estimatedCostUsd: 0.05 }));
    await agent.runIdleSession(makeOpportunity());
    expect(callOrder).toEqual(["cheap", "medium", "expensive"]);
  });
});

// ── Session Report Shape ───────────────────────────────────

describe("createSleepTimeAgent — session report", () => {
  it("runIdleSession returns report with results array", async () => {
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    agent.submit(makeTask({ id: "a" }));
    agent.submit(makeTask({ id: "b" }));
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.results).toHaveLength(2);
    expect(report.aborted).toBe(false);
    expect(report.startedAt).toBeGreaterThanOrEqual(0);
    expect(report.endedAt).toBeGreaterThan(report.startedAt);
  });

  it("empty queue: returns empty report without error", async () => {
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.results).toHaveLength(0);
    expect(report.aborted).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── Budget Cap ─────────────────────────────────────────────

describe("createSleepTimeAgent — budget cap", () => {
  it("stops executing when cumulative cost reaches budget", async () => {
    const { fn, callOrder } = makeRecordingExecutor({ costPerTask: 0.10 });
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      budgetUsd: 0.25,
      now: counterClock(10),
    });
    // 5 tasks × $0.10 each = $0.50 total. Budget cap = $0.25.
    // First 3 tasks exceed cap after the 3rd completes ($0.30 >= $0.25).
    for (let i = 0; i < 5; i++) {
      agent.submit(makeTask({ id: `t${i}`, priority: 100 - i }));
    }
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(true);
    expect(report.abortReason).toBe("budget-exceeded");
    expect(callOrder.length).toBeLessThan(5);
    expect(callOrder.length).toBeGreaterThanOrEqual(2);
  });

  it("default budget is 0.50", async () => {
    const { fn } = makeRecordingExecutor({ costPerTask: 0.10 });
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    // 10 tasks × $0.10 = $1.00; default cap $0.50 stops around task 5.
    for (let i = 0; i < 10; i++) {
      agent.submit(makeTask({ id: `t${i}`, priority: 100 - i }));
    }
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(true);
    expect(report.abortReason).toBe("budget-exceeded");
    expect(report.results.length).toBeLessThan(10);
  });
});

// ── Duration Cap ───────────────────────────────────────────

describe("createSleepTimeAgent — duration cap", () => {
  it("stops when elapsed time exceeds maxDurationMs", async () => {
    const { fn } = makeRecordingExecutor();
    // Clock advances 1000ms per read; with duration cap 2000ms the
    // second check will already be past the budget so ~1 task runs.
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      maxDurationMs: 2000,
      now: counterClock(1000),
    });
    for (let i = 0; i < 5; i++) {
      agent.submit(makeTask({ id: `t${i}`, priority: 100 - i }));
    }
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(true);
    expect(report.abortReason).toBe("duration-exceeded");
    expect(report.results.length).toBeLessThan(5);
  });
});

// ── Abort Signal ───────────────────────────────────────────

describe("createSleepTimeAgent — abort signal", () => {
  it("mid-session abort stops queue processing", async () => {
    const controller = new AbortController();
    const { fn } = makeRecordingExecutor();

    // Executor aborts the signal on its second call.
    let callCount = 0;
    const executor: SleepTimeAgentOptions["taskExecutor"] = async (task) => {
      callCount++;
      const result = await fn(task);
      if (callCount === 2) controller.abort();
      return result;
    };

    const agent = createSleepTimeAgent({
      taskExecutor: executor,
      abortSignal: controller.signal,
      now: counterClock(10),
    });
    for (let i = 0; i < 5; i++) {
      agent.submit(makeTask({ id: `t${i}`, priority: 100 - i }));
    }
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(true);
    expect(report.abortReason).toBe("external-abort");
    expect(report.results.length).toBe(2);
  });

  it("pre-aborted signal: no tasks execute", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      abortSignal: controller.signal,
      now: counterClock(10),
    });
    agent.submit(makeTask({ id: "t1" }));
    agent.submit(makeTask({ id: "t2" }));
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(true);
    expect(report.results).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── Honest Failure Handling (QB #6) ────────────────────────

describe("createSleepTimeAgent — honest failures", () => {
  it("executor throw is recorded as failure, doesn't stop session", async () => {
    const { fn, callOrder } = makeRecordingExecutor({ throwFor: ["bad"] });
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    agent.submit(makeTask({ id: "good1", priority: 80 }));
    agent.submit(makeTask({ id: "bad", priority: 70, estimatedCostUsd: 0.07 }));
    agent.submit(makeTask({ id: "good2", priority: 60 }));
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(false);
    expect(report.results).toHaveLength(3);
    // good1, bad, good2 all ran
    expect(callOrder).toEqual(["good1", "bad", "good2"]);
    // the "bad" result is a failure with the thrown message
    const bad = report.results.find((r) => r.taskId === "bad");
    expect(bad?.ok).toBe(false);
    expect(bad?.error).toContain("boom-bad");
    // honest cost accounting: the failed task was still charged its floor
    expect(bad?.costUsd).toBe(0.07);
  });

  it("executor throw still increments budget toward cap", async () => {
    const { fn } = makeRecordingExecutor({ throwFor: ["t0", "t1", "t2"] });
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      budgetUsd: 0.20,
      now: counterClock(10),
    });
    // Each failed task charges 0.10; 3 of them = 0.30 which exceeds $0.20.
    for (let i = 0; i < 5; i++) {
      agent.submit(makeTask({ id: `t${i}`, priority: 100 - i, estimatedCostUsd: 0.10 }));
    }
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(true);
    expect(report.abortReason).toBe("budget-exceeded");
    // All executed tasks should be failures
    for (const r of report.results) {
      expect(r.ok).toBe(false);
    }
  });
});

// ── Dependency Ordering ────────────────────────────────────

describe("createSleepTimeAgent — dependencies", () => {
  it("task with incomplete deps is skipped in first pass", async () => {
    const { fn, callOrder } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    // dep has LOWER priority, but must run first because child depends on it.
    agent.submit(makeTask({ id: "child", priority: 90, dependencies: ["dep"] }));
    agent.submit(makeTask({ id: "dep", priority: 10 }));
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(false);
    expect(report.results).toHaveLength(2);
    expect(callOrder).toEqual(["dep", "child"]);
  });

  it("dependencies satisfied after dep completes: task runs in later pass", async () => {
    const { fn, callOrder } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    // chain: a -> b -> c
    agent.submit(makeTask({ id: "c", priority: 50, dependencies: ["b"] }));
    agent.submit(makeTask({ id: "a", priority: 50 }));
    agent.submit(makeTask({ id: "b", priority: 50, dependencies: ["a"] }));
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.results).toHaveLength(3);
    // a must come before b, b before c
    expect(callOrder.indexOf("a")).toBeLessThan(callOrder.indexOf("b"));
    expect(callOrder.indexOf("b")).toBeLessThan(callOrder.indexOf("c"));
  });

  it("cyclic/impossible deps: stops after nothing ran in a pass", async () => {
    const { fn, callOrder } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    // Both depend on a non-existent task.
    agent.submit(makeTask({ id: "x", dependencies: ["ghost"] }));
    agent.submit(makeTask({ id: "y", dependencies: ["ghost"] }));
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.aborted).toBe(false);
    expect(callOrder).toEqual([]);
    expect(report.results).toHaveLength(0);
  });
});

// ── Progress Callback ─────────────────────────────────────

describe("createSleepTimeAgent — onProgress", () => {
  it("fires once per completed task", async () => {
    const { fn } = makeRecordingExecutor();
    const onProgress = vi.fn();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      onProgress,
      now: counterClock(10),
    });
    agent.submit(makeTask({ id: "t1" }));
    agent.submit(makeTask({ id: "t2" }));
    agent.submit(makeTask({ id: "t3" }));
    await agent.runIdleSession(makeOpportunity());
    expect(onProgress).toHaveBeenCalledTimes(3);
    // each call received a SleepTimeResult-shaped object
    const firstCall = onProgress.mock.calls[0]?.[0] as SleepTimeResult;
    expect(firstCall.taskId).toBeTruthy();
    expect(typeof firstCall.ok).toBe("boolean");
  });

  it("onProgress throwing does not break the session", async () => {
    const { fn } = makeRecordingExecutor();
    const onProgress = vi.fn(() => {
      throw new Error("observer-crashed");
    });
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      onProgress,
      now: counterClock(10),
    });
    agent.submit(makeTask({ id: "t1" }));
    agent.submit(makeTask({ id: "t2" }));
    const report = await agent.runIdleSession(makeOpportunity());
    expect(report.results).toHaveLength(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });
});

// ── Instance Isolation (QB #7) ─────────────────────────────

describe("createSleepTimeAgent — per-instance isolation", () => {
  it("two independent agents do not share queues", () => {
    const { fn: fn1 } = makeRecordingExecutor();
    const { fn: fn2 } = makeRecordingExecutor();
    const a1 = createSleepTimeAgent({ taskExecutor: fn1 });
    const a2 = createSleepTimeAgent({ taskExecutor: fn2 });
    a1.submit(makeTask({ id: "t1" }));
    a1.submit(makeTask({ id: "t2" }));
    expect(a1.queueLength()).toBe(2);
    expect(a2.queueLength()).toBe(0);
    a2.submit(makeTask({ id: "x1" }));
    expect(a1.queueLength()).toBe(2);
    expect(a2.queueLength()).toBe(1);
  });

  it("two independent agents execute their own tasks only", async () => {
    const exec1 = makeRecordingExecutor();
    const exec2 = makeRecordingExecutor();
    const a1 = createSleepTimeAgent({
      taskExecutor: exec1.fn,
      now: counterClock(10),
    });
    const a2 = createSleepTimeAgent({
      taskExecutor: exec2.fn,
      now: counterClock(10),
    });
    a1.submit(makeTask({ id: "a1-t1" }));
    a2.submit(makeTask({ id: "a2-t1" }));
    await Promise.all([
      a1.runIdleSession(makeOpportunity()),
      a2.runIdleSession(makeOpportunity()),
    ]);
    expect(exec1.callOrder).toEqual(["a1-t1"]);
    expect(exec2.callOrder).toEqual(["a2-t1"]);
  });

  it("clearing one agent's queue does not affect the other", () => {
    const { fn: fn1 } = makeRecordingExecutor();
    const { fn: fn2 } = makeRecordingExecutor();
    const a1 = createSleepTimeAgent({ taskExecutor: fn1 });
    const a2 = createSleepTimeAgent({ taskExecutor: fn2 });
    a1.submit(makeTask({ id: "t1" }));
    a2.submit(makeTask({ id: "t2" }));
    a2.submit(makeTask({ id: "t3" }));
    expect(a1.clearQueue()).toBe(1);
    expect(a2.queueLength()).toBe(2);
  });
});

// ── Opportunity Signal Plumbing ───────────────────────────

describe("createSleepTimeAgent — opportunity signals", () => {
  it("accepts all four IdleSignal variants", async () => {
    const { fn } = makeRecordingExecutor();
    const agent = createSleepTimeAgent({
      taskExecutor: fn,
      now: counterClock(10),
    });
    const signals: readonly SleepTimeOpportunity["signal"][] = [
      "user-away",
      "long-turn-gap",
      "explicit-trigger",
      "scheduled-maintenance",
    ];
    for (const signal of signals) {
      const report = await agent.runIdleSession({
        signal,
        detectedAt: 0,
        estimatedIdleMs: 1000,
      });
      expect(report.aborted).toBe(false);
    }
  });
});
