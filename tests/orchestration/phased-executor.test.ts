/**
 * PhasedExecutor tests — generic phase machinery + 2 migration proofs.
 *
 * Covers:
 * 1.  Strict phase ordering walks phases in declared order.
 * 2.  transition() validates unknown from/to phases → ErrorInvalidTransition.
 * 3.  Each phase handler is invoked with current context and can update it.
 * 4.  Handler throw surfaces as ErrorPhaseFailed with phase + reason + snapshot.
 * 5.  observableState reflects currentPhase + completedPhases while running.
 * 6.  Transitions emit events in order (fromPhase, toPhase).
 * 7.  Instance-per-run: a second run with a fresh instance is isolated.
 * 8.  Migrated autonomous.ts still satisfies its existing public-API contracts.
 * 9.  Migrated coordinator.ts still satisfies its existing public-API contracts.
 * 10. Unknown transition via direct transition() call → ErrorInvalidTransition.
 * 11. Cross-orchestrator isolation: two executors with different phase sets
 *     don't interfere.
 */

import { describe, it, expect } from "vitest";
import {
  PhasedExecutor,
  ErrorPhaseFailed,
  ErrorInvalidTransition,
  type PhaseHandler,
  type PhasedExecutorState,
  type TransitionEvent,
} from "../../src/orchestration/phased-executor.js";
import { AutonomousExecutor } from "../../src/orchestration/autonomous.js";
import { Coordinator } from "../../src/orchestration/coordinator.js";

type DemoPhase = "alpha" | "beta" | "gamma";
interface DemoContext {
  readonly trace: readonly string[];
  readonly counter: number;
}

function buildExec(
  handlers: Record<DemoPhase, PhaseHandler<DemoPhase, DemoContext>>,
  events: TransitionEvent<DemoPhase>[] = [],
): PhasedExecutor<DemoPhase, DemoContext> {
  const exec = new PhasedExecutor<DemoPhase, DemoContext>({
    phases: ["alpha", "beta", "gamma"] as const,
    handlers,
    onTransition: (e) => events.push(e),
  });
  return exec;
}

describe("PhasedExecutor", () => {
  it("walks phases in strict declared order", async () => {
    const seen: DemoPhase[] = [];
    const exec = buildExec({
      alpha: async (ctx) => {
        seen.push("alpha");
        return { trace: [...ctx.trace, "a"], counter: ctx.counter + 1 };
      },
      beta: async (ctx) => {
        seen.push("beta");
        return { trace: [...ctx.trace, "b"], counter: ctx.counter + 1 };
      },
      gamma: async (ctx) => {
        seen.push("gamma");
        return { trace: [...ctx.trace, "g"], counter: ctx.counter + 1 };
      },
    });

    const out = await exec.run({ trace: [], counter: 0 });
    expect(seen).toEqual(["alpha", "beta", "gamma"]);
    expect(out.trace).toEqual(["a", "b", "g"]);
    expect(out.counter).toBe(3);
  });

  it("each phase handler receives the updated context", async () => {
    const exec = buildExec({
      alpha: async (ctx) => ({ ...ctx, counter: 10 }),
      beta: async (ctx) => {
        expect(ctx.counter).toBe(10); // from alpha
        return { ...ctx, counter: ctx.counter * 2 };
      },
      gamma: async (ctx) => {
        expect(ctx.counter).toBe(20); // from beta
        return { ...ctx, counter: ctx.counter + 5 };
      },
    });
    const out = await exec.run({ trace: [], counter: 0 });
    expect(out.counter).toBe(25);
  });

  it("handler throw surfaces as ErrorPhaseFailed with phase + reason + snapshot", async () => {
    const exec = buildExec({
      alpha: async (ctx) => ({ ...ctx, counter: 1 }),
      beta: async () => {
        throw new Error("boom");
      },
      gamma: async (ctx) => ctx,
    });
    await expect(exec.run({ trace: [], counter: 0 })).rejects.toMatchObject({
      name: "ErrorPhaseFailed",
      phase: "beta",
      reason: "boom",
    });
    // After failure, contextSnapshot is the last known-good context (post-alpha).
    try {
      await exec.run({ trace: [], counter: 0 });
    } catch (err) {
      const failed = err as ErrorPhaseFailed<DemoPhase, DemoContext>;
      expect(failed).toBeInstanceOf(ErrorPhaseFailed);
      expect(failed.contextSnapshot.counter).toBe(1);
    }
  });

  it("observableState reflects currentPhase + completedPhases during run", async () => {
    const observed: PhasedExecutorState<DemoPhase>[] = [];
    const exec = buildExec({
      alpha: async (ctx) => {
        observed.push(exec.observableState());
        return ctx;
      },
      beta: async (ctx) => {
        observed.push(exec.observableState());
        return ctx;
      },
      gamma: async (ctx) => {
        observed.push(exec.observableState());
        return ctx;
      },
    });
    await exec.run({ trace: [], counter: 0 });

    expect(observed[0]?.currentPhase).toBe("alpha");
    expect(observed[0]?.completedPhases).toEqual([]);
    expect(observed[1]?.currentPhase).toBe("beta");
    expect(observed[1]?.completedPhases).toEqual(["alpha"]);
    expect(observed[2]?.currentPhase).toBe("gamma");
    expect(observed[2]?.completedPhases).toEqual(["alpha", "beta"]);
    expect(exec.observableState().completedPhases).toEqual(["alpha", "beta", "gamma"]);
  });

  it("emits transition events in order", async () => {
    const events: TransitionEvent<DemoPhase>[] = [];
    const exec = buildExec(
      {
        alpha: async (c) => c,
        beta: async (c) => c,
        gamma: async (c) => c,
      },
      events,
    );
    await exec.run({ trace: [], counter: 0 });
    expect(events.map((e) => [e.from, e.to])).toEqual([
      [null, "alpha"],
      ["alpha", "beta"],
      ["beta", "gamma"],
      ["gamma", null],
    ]);
  });

  it("rejects ErrorInvalidTransition when transition() called with unknown phase", () => {
    const exec = buildExec({
      alpha: async (c) => c,
      beta: async (c) => c,
      gamma: async (c) => c,
    });
    expect(() => exec.transition("alpha", "delta" as DemoPhase, { trace: [], counter: 0 })).toThrow(
      ErrorInvalidTransition,
    );
    expect(() =>
      exec.transition("omega" as DemoPhase, "alpha", { trace: [], counter: 0 }),
    ).toThrow(ErrorInvalidTransition);
  });

  it("rejects ErrorInvalidTransition when skipping phases out-of-order", () => {
    const exec = buildExec({
      alpha: async (c) => c,
      beta: async (c) => c,
      gamma: async (c) => c,
    });
    // alpha → gamma is invalid (skips beta)
    expect(() => exec.transition("alpha", "gamma", { trace: [], counter: 0 })).toThrow(
      ErrorInvalidTransition,
    );
  });

  it("instance-per-run: fresh instance resets state", async () => {
    const mkExec = (): PhasedExecutor<DemoPhase, DemoContext> =>
      new PhasedExecutor<DemoPhase, DemoContext>({
        phases: ["alpha", "beta", "gamma"] as const,
        handlers: {
          alpha: async (ctx) => ({ ...ctx, counter: ctx.counter + 1 }),
          beta: async (ctx) => ({ ...ctx, counter: ctx.counter + 1 }),
          gamma: async (ctx) => ({ ...ctx, counter: ctx.counter + 1 }),
        },
      });
    const a = await mkExec().run({ trace: [], counter: 0 });
    const b = await mkExec().run({ trace: [], counter: 100 });
    expect(a.counter).toBe(3);
    expect(b.counter).toBe(103);
  });

  it("cross-executor isolation: distinct phase sets don't interfere", async () => {
    type PA = "one" | "two";
    type PB = "x" | "y";
    const execA = new PhasedExecutor<PA, { v: number }>({
      phases: ["one", "two"] as const,
      handlers: {
        one: async (c) => ({ v: c.v + 1 }),
        two: async (c) => ({ v: c.v + 10 }),
      },
    });
    const execB = new PhasedExecutor<PB, { v: number }>({
      phases: ["x", "y"] as const,
      handlers: {
        x: async (c) => ({ v: c.v * 2 }),
        y: async (c) => ({ v: c.v * 3 }),
      },
    });
    const [a, b] = await Promise.all([execA.run({ v: 0 }), execB.run({ v: 1 })]);
    expect(a.v).toBe(11);
    expect(b.v).toBe(6);
  });
});

// ── Migration proof: AutonomousExecutor preserves public API ───────────────

describe("AutonomousExecutor (post-migration, public API preserved)", () => {
  it("still exposes enterMode/exitMode/isActive", () => {
    const exec = new AutonomousExecutor();
    expect(exec.isActive()).toBe(false);
    exec.enterMode("task");
    expect(exec.isActive()).toBe(true);
    exec.exitMode();
    expect(exec.isActive()).toBe(false);
  });

  it("still succeeds on first cycle when tests pass (smoke)", async () => {
    const exec = new AutonomousExecutor({ maxCycles: 2 });
    const result = await exec.execute(
      "Fix bug",
      async () => ({ output: "done", costUsd: 0, tokensUsed: 0 }),
      async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
    );
    expect(result.success).toBe(true);
    expect(result.exitReason).toBe("tests-pass");
  });

  it("exposes phased executor state via getPhasedState()", () => {
    const exec = new AutonomousExecutor();
    const state = exec.getPhasedState();
    // Before run: currentPhase is null
    expect(state).toBeDefined();
    expect(state.phases).toBeDefined();
  });
});

// ── Migration proof: Coordinator preserves public API ─────────────────────

describe("Coordinator (post-migration, public API preserved)", () => {
  it("still manages task lifecycle", () => {
    const coord = new Coordinator({ maxSubagents: 2 });
    coord.addTask({
      id: "t1",
      description: "Task 1",
      files: ["a.ts"],
      phase: "implement",
      status: "pending",
    });
    expect(coord.getPendingTasks()).toHaveLength(1);
    coord.startTask("t1", "agent-1");
    expect(coord.getTask("t1")?.status).toBe("running");
    coord.completeTask("t1");
    expect(coord.getTask("t1")?.status).toBe("completed");
  });

  it("exposes the phase plan as the canonical ordering", () => {
    const coord = new Coordinator();
    const phases = coord.getPhases();
    expect(phases).toEqual(["research", "spec", "implement", "verify"]);
  });

  it("still respects maxSubagents after migration", () => {
    const coord = new Coordinator({ maxSubagents: 1 });
    coord.addTask({ id: "a", description: "A", files: [], phase: "research", status: "pending" });
    coord.addTask({ id: "b", description: "B", files: [], phase: "research", status: "pending" });
    coord.startTask("a", "w1");
    expect(coord.canSpawnWorker()).toBe(false);
    expect(coord.startTask("b", "w2")).toBeNull();
  });
});
