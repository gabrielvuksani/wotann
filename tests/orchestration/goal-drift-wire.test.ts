/**
 * Wire-test for B7 GoalDriftDetector integration with
 * AutonomousExecutor (P1-B7 part 3).
 *
 * Covers the contract that turns goal-drift from library code into
 * a runtime-active feature (WOTANN quality bar #14 — real wiring):
 *  - executor CALLS detector.checkActions at the N-turn checkpoint
 *  - executor DOES NOT call when callbacks.goalDrift is omitted
 *  - executor DOES NOT call when goalDriftCheckEveryNCycles = 0
 *  - drift=true yields a nudge prepended to the NEXT cycle's prompt
 *  - drift=false does NOT nudge
 *  - provider.readTodo is invoked with the supplied taskId
 *  - onDrift hook fires on every drift check (drift=true or false)
 *  - errors in the drift path do not crash the cycle loop
 */

import { describe, it, expect, vi } from "vitest";
import { AutonomousExecutor } from "../../src/orchestration/autonomous.js";
import {
  GoalDriftDetector,
  type AgentAction,
  type DriftAssessment,
} from "../../src/orchestration/goal-drift.js";
import {
  NullTodoProvider,
  type TodoProvider,
} from "../../src/orchestration/todo-provider.js";
import type { TodoState, Subgoal } from "../../src/orchestration/todo-tracker.js";

// -- Helpers --------------------------------------------------

/** A TodoState with one pending subgoal tied to the task spec. */
function makeTodoState(
  taskId: string,
  pendingDescriptions: readonly string[],
): TodoState {
  const now = "2026-04-20T00:00:00.000Z";
  const pending: Subgoal[] = pendingDescriptions.map((d, i) => ({
    id: `sg-${i + 1}`,
    description: d,
    status: "pending" as const,
    createdAt: now,
  }));
  return Object.freeze({
    taskId,
    taskSpec: "wire-test",
    done: Object.freeze([]),
    pending: Object.freeze(pending),
    scopeChanges: Object.freeze([]),
    createdAt: now,
    updatedAt: now,
  });
}

/** Stubbed provider that always returns the given state. */
function mockProvider(state: TodoState): TodoProvider {
  return {
    async readTodo(_taskId: string) {
      return state;
    },
    async writeTodo() {},
  };
}

/**
 * Stubbed detector subclass that records every checkActions call
 * and returns a prepared assessment. Used to prove wire-up without
 * relying on Jaccard relevance scoring.
 */
class RecordingDetector extends GoalDriftDetector {
  readonly calls: Array<{ state: TodoState; actions: readonly AgentAction[] }> = [];
  constructor(private readonly result: DriftAssessment) {
    super();
  }
  override async checkActions(
    state: TodoState,
    actions: readonly AgentAction[],
  ): Promise<DriftAssessment> {
    this.calls.push({ state, actions });
    return this.result;
  }
}

// -- Tests ----------------------------------------------------

describe("AutonomousExecutor × GoalDriftDetector wire-up", () => {
  it("invokes GoalDriftDetector.checkActions at the N-turn checkpoint", async () => {
    // goalDriftCheckEveryNCycles=2 fires at cycles 2, 4, ...
    const executor = new AutonomousExecutor({
      maxCycles: 5,
      goalDriftCheckEveryNCycles: 2,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: false,
      reason: "no drift",
      bestRelevance: 0.5,
      bestMatchSubgoalId: "sg-1",
      method: "heuristic",
    });
    const todos = makeTodoState("task-wire-1", ["do the thing"]);
    const provider = mockProvider(todos);

    let call = 0;
    await executor.execute(
      "do the thing",
      async () => {
        call++;
        return { output: `cycle ${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 5,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: { detector, provider, taskId: "task-wire-1" },
      },
    );

    // Drift check fires only when cycle > 0 AND cycle % 2 === 0 AND
    // actionHistory is non-empty. With maxCycles=5 and N=2 that's
    // cycles 2 and 4 → 2 calls.
    expect(detector.calls.length).toBeGreaterThanOrEqual(1);
    expect(detector.calls.length).toBeLessThanOrEqual(2);
    // Every call received the same todo state and non-empty actions.
    for (const c of detector.calls) {
      expect(c.state.taskId).toBe("task-wire-1");
      expect(c.actions.length).toBeGreaterThan(0);
      expect(c.actions.length).toBeLessThanOrEqual(5);
    }
  });

  it("does NOT invoke the detector when callbacks.goalDrift is omitted", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 5,
      goalDriftCheckEveryNCycles: 1,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: true,
      reason: "should never fire",
      bestRelevance: 0,
      bestMatchSubgoalId: null,
      method: "heuristic",
    });
    let call = 0;
    await executor.execute(
      "task",
      async () => {
        call++;
        return { output: `x${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 5,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
    );
    expect(detector.calls.length).toBe(0);
  });

  it("does NOT invoke the detector when goalDriftCheckEveryNCycles = 0", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 5,
      goalDriftCheckEveryNCycles: 0, // gate OFF
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: true,
      reason: "irrelevant",
      bestRelevance: 0,
      bestMatchSubgoalId: null,
      method: "heuristic",
    });
    const provider = mockProvider(makeTodoState("t", ["x"]));
    let call = 0;
    await executor.execute(
      "task",
      async () => {
        call++;
        return { output: `cycle ${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 5,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: { detector, provider, taskId: "t" },
      },
    );
    expect(detector.calls.length).toBe(0);
  });

  it("drift=true prepends a nudge to the next prompt", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 5,
      goalDriftCheckEveryNCycles: 2,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: true,
      reason: "action X does not match pending todo Y",
      bestRelevance: 0.05,
      bestMatchSubgoalId: "sg-1",
      method: "heuristic",
    });
    const provider = mockProvider(makeTodoState("t-nudge", ["pending thing"]));

    const prompts: string[] = [];
    let call = 0;
    await executor.execute(
      "base task",
      async (prompt) => {
        prompts.push(prompt);
        call++;
        return { output: `cycle ${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 5,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: { detector, provider, taskId: "t-nudge" },
      },
    );

    // Some prompt after the first drift check (cycle 2) must contain
    // the nudge marker + reason string.
    const nudged = prompts.some((p) =>
      p.includes("[Goal-drift warning]") && p.includes("action X does not match"),
    );
    expect(nudged).toBe(true);
  });

  it("drift=false does NOT emit a nudge to any prompt", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 5,
      goalDriftCheckEveryNCycles: 2,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: false,
      reason: "all good",
      bestRelevance: 0.8,
      bestMatchSubgoalId: "sg-1",
      method: "heuristic",
    });
    const provider = mockProvider(makeTodoState("t-clean", ["pending thing"]));

    const prompts: string[] = [];
    let call = 0;
    await executor.execute(
      "base",
      async (prompt) => {
        prompts.push(prompt);
        call++;
        return { output: `c${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 5,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: { detector, provider, taskId: "t-clean" },
      },
    );
    expect(prompts.every((p) => !p.includes("[Goal-drift warning]"))).toBe(true);
  });

  it("provider.readTodo receives the supplied taskId", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 5,
      goalDriftCheckEveryNCycles: 2,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: false,
      reason: "ok",
      bestRelevance: 0.5,
      bestMatchSubgoalId: null,
      method: "heuristic",
    });
    const readTodo = vi.fn(async (taskId: string) => makeTodoState(taskId, ["x"]));
    const provider: TodoProvider = { readTodo, async writeTodo() {} };
    let call = 0;
    await executor.execute(
      "base",
      async () => {
        call++;
        return { output: `c${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 5,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: { detector, provider, taskId: "my-specific-task-id" },
      },
    );
    expect(readTodo).toHaveBeenCalled();
    for (const invocation of readTodo.mock.calls) {
      expect(invocation[0]).toBe("my-specific-task-id");
    }
  });

  it("onDrift hook is called whenever a drift check runs (drift=true AND drift=false)", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 5,
      goalDriftCheckEveryNCycles: 2,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: false,
      reason: "nope",
      bestRelevance: 0.5,
      bestMatchSubgoalId: null,
      method: "heuristic",
    });
    const provider = mockProvider(makeTodoState("t", ["x"]));
    const onDrift = vi.fn();
    let call = 0;
    await executor.execute(
      "base",
      async () => {
        call++;
        return { output: `c${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 5,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: { detector, provider, taskId: "t", onDrift },
      },
    );
    expect(onDrift).toHaveBeenCalled();
    // Every call's second arg is the cycle number.
    for (const args of onDrift.mock.calls) {
      expect(typeof args[1]).toBe("number");
    }
  });

  it("falls back gracefully when provider.readTodo throws", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 4,
      goalDriftCheckEveryNCycles: 2,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new RecordingDetector({
      drift: false,
      reason: "won't be asked",
      bestRelevance: 0.5,
      bestMatchSubgoalId: null,
      method: "heuristic",
    });
    const provider: TodoProvider = {
      async readTodo() {
        throw new Error("boom");
      },
      async writeTodo() {},
    };
    let call = 0;
    // Should not throw — executor swallows and warns.
    const result = await executor.execute(
      "base",
      async () => {
        call++;
        return { output: `c${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 4,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: { detector, provider, taskId: "broken" },
      },
    );
    // Run completes without unhandled rejection — that's the contract.
    expect(result).toBeDefined();
  });

  it("NullTodoProvider + goal-drift results in no-drift (empty todos)", async () => {
    const executor = new AutonomousExecutor({
      maxCycles: 4,
      goalDriftCheckEveryNCycles: 2,
      enhancedDoomLoopDetection: false,
      enableIntelligentStrategy: false,
    });
    const detector = new GoalDriftDetector();
    const onDrift = vi.fn();
    let call = 0;
    await executor.execute(
      "base",
      async () => {
        call++;
        return { output: `c${call}`, costUsd: 0, tokensUsed: 0 };
      },
      async () => ({
        testsPass: call >= 4,
        typecheckPass: true,
        lintPass: true,
        output: "",
      }),
      {
        goalDrift: {
          detector,
          provider: NullTodoProvider,
          taskId: "task",
          onDrift,
        },
      },
    );
    // When pending is empty the detector reports no-drift.
    for (const args of onDrift.mock.calls) {
      const assessment = args[0] as DriftAssessment;
      expect(assessment.drift).toBe(false);
    }
  });
});
