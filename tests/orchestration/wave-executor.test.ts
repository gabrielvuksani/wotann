import { describe, it, expect } from "vitest";
import {
  buildWaves,
  buildFreshContextWaves,
  executeWaves,
  executeWavesWithFreshContext,
} from "../../src/orchestration/wave-executor.js";
import type {
  WaveTask,
  FreshContextTask,
  ContextResolver,
} from "../../src/orchestration/wave-executor.js";

// ── Test Helpers ────────────────────────────────────

function makeTask(id: string, deps: string[] = []): WaveTask {
  return {
    id,
    description: `Task ${id}`,
    dependencies: deps,
    status: "pending",
  };
}

function makeFreshTask(
  id: string,
  deps: string[] = [],
  contextFiles: string[] = [],
  maxTokens = 10_000,
): FreshContextTask {
  return {
    id,
    description: `Task ${id}`,
    dependencies: deps,
    status: "pending",
    contextSnapshot: contextFiles,
    maxContextTokens: maxTokens,
  };
}

const mockResolver: ContextResolver = async (paths) => {
  const map = new Map<string, string>();
  for (const path of paths) {
    map.set(path, `// Content of ${path}\nexport const x = 1;`);
  }
  return map;
};

// ── Tests: buildWaves ───────────────────────────────

describe("buildWaves", () => {
  it("puts independent tasks in a single wave", () => {
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    const waves = buildWaves(tasks);
    expect(waves).toHaveLength(1);
    expect(waves[0]?.tasks).toHaveLength(3);
  });

  it("creates sequential waves for chained dependencies", () => {
    const tasks = [
      makeTask("a"),
      makeTask("b", ["a"]),
      makeTask("c", ["b"]),
    ];
    const waves = buildWaves(tasks);
    expect(waves).toHaveLength(3);
    expect(waves[0]?.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(waves[1]?.tasks.map((t) => t.id)).toEqual(["b"]);
    expect(waves[2]?.tasks.map((t) => t.id)).toEqual(["c"]);
  });

  it("groups tasks with same dependencies into one wave", () => {
    const tasks = [
      makeTask("a"),
      makeTask("b", ["a"]),
      makeTask("c", ["a"]),
    ];
    const waves = buildWaves(tasks);
    expect(waves).toHaveLength(2);
    expect(waves[1]?.tasks).toHaveLength(2);
  });

  it("handles circular dependencies by forcing into one wave", () => {
    const tasks = [
      makeTask("a", ["b"]),
      makeTask("b", ["a"]),
    ];
    const waves = buildWaves(tasks);
    // Circular deps are forced into a single wave
    expect(waves).toHaveLength(1);
    expect(waves[0]?.tasks).toHaveLength(2);
  });

  it("handles empty task list", () => {
    expect(buildWaves([])).toEqual([]);
  });

  it("assigns incrementing wave indices", () => {
    const tasks = [
      makeTask("a"),
      makeTask("b", ["a"]),
      makeTask("c", ["b"]),
    ];
    const waves = buildWaves(tasks);
    expect(waves.map((w) => w.index)).toEqual([0, 1, 2]);
  });
});

// ── Tests: buildFreshContextWaves ───────────────────

describe("buildFreshContextWaves", () => {
  it("preserves context metadata through wave building", () => {
    const tasks: FreshContextTask[] = [
      makeFreshTask("a", [], ["src/a.ts"], 5000),
      makeFreshTask("b", ["a"], ["src/b.ts", "src/shared.ts"], 8000),
    ];
    const waves = buildFreshContextWaves(tasks);
    expect(waves).toHaveLength(2);

    const taskA = waves[0]?.tasks.find((t) => t.id === "a");
    expect(taskA?.contextSnapshot).toEqual(["src/a.ts"]);
    expect(taskA?.maxContextTokens).toBe(5000);

    const taskB = waves[1]?.tasks.find((t) => t.id === "b");
    expect(taskB?.contextSnapshot).toEqual(["src/b.ts", "src/shared.ts"]);
    expect(taskB?.maxContextTokens).toBe(8000);
  });

  it("handles empty task list", () => {
    expect(buildFreshContextWaves([])).toEqual([]);
  });
});

// ── Tests: executeWaves ─────────────────────────────

describe("executeWaves", () => {
  it("executes all tasks and collects results", async () => {
    const tasks = [makeTask("a"), makeTask("b")];
    const waves = buildWaves(tasks);

    const results = await executeWaves(waves, async (task) => {
      return `result-${task.id}`;
    });

    expect(results.size).toBe(2);
    expect(results.get("a")).toBe("result-a");
    expect(results.get("b")).toBe("result-b");
  });

  it("executes waves sequentially", async () => {
    const order: string[] = [];
    const tasks = [
      makeTask("a"),
      makeTask("b", ["a"]),
    ];
    const waves = buildWaves(tasks);

    await executeWaves(waves, async (task) => {
      order.push(task.id);
      return `done-${task.id}`;
    });

    expect(order).toEqual(["a", "b"]);
  });

  it("runs tasks within a wave in parallel", async () => {
    const startTimes: Record<string, number> = {};
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    const waves = buildWaves(tasks);

    await executeWaves(waves, async (task) => {
      startTimes[task.id] = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      return task.id;
    });

    // All tasks should start within ~10ms of each other (parallel)
    const times = Object.values(startTimes);
    const maxDiff = Math.max(...times) - Math.min(...times);
    expect(maxDiff).toBeLessThan(50); // Well under sequential threshold
  });

  it("handles task failures gracefully", async () => {
    const tasks = [makeTask("a"), makeTask("b")];
    const waves = buildWaves(tasks);

    const results = await executeWaves(waves, async (task) => {
      if (task.id === "b") throw new Error("Task B failed");
      return `result-${task.id}`;
    });

    // Successful task should still have its result
    expect(results.get("a")).toBe("result-a");
    // Failed task should not be in results
    expect(results.has("b")).toBe(false);
  });

  it("handles empty waves", async () => {
    const results = await executeWaves([], async () => "nope");
    expect(results.size).toBe(0);
  });
});

// ── Tests: executeWavesWithFreshContext ──────────────

describe("executeWavesWithFreshContext", () => {
  it("passes isolated context per task", async () => {
    const tasks: FreshContextTask[] = [
      makeFreshTask("a", [], ["src/a.ts"]),
      makeFreshTask("b", [], ["src/b.ts"]),
    ];
    const waves = buildFreshContextWaves(tasks);
    const receivedContexts: Record<string, string[]> = {};

    await executeWavesWithFreshContext(
      waves,
      async (task, context) => {
        receivedContexts[task.id] = [...context.keys()];
        return `done-${task.id}`;
      },
      mockResolver,
    );

    // Task A should only see src/a.ts
    expect(receivedContexts["a"]).toEqual(["src/a.ts"]);
    // Task B should only see src/b.ts
    expect(receivedContexts["b"]).toEqual(["src/b.ts"]);
  });

  it("resolves shared files once across tasks", async () => {
    let resolverCallCount = 0;
    const countingResolver: ContextResolver = async (paths) => {
      resolverCallCount++;
      const map = new Map<string, string>();
      for (const p of paths) map.set(p, `content-${p}`);
      return map;
    };

    const tasks: FreshContextTask[] = [
      makeFreshTask("a", [], ["src/shared.ts", "src/a.ts"]),
      makeFreshTask("b", [], ["src/shared.ts", "src/b.ts"]),
    ];
    const waves = buildFreshContextWaves(tasks);

    await executeWavesWithFreshContext(
      waves,
      async (_task, _ctx) => "ok",
      countingResolver,
    );

    // Resolver should be called once per wave (batch), not per task
    expect(resolverCallCount).toBe(1);
  });

  it("respects per-task token budgets", async () => {
    // Create a resolver that returns large content
    const largeResolver: ContextResolver = async (paths) => {
      const map = new Map<string, string>();
      for (const p of paths) {
        // Each file is ~1000 tokens (4000 chars)
        map.set(p, "x".repeat(4000));
      }
      return map;
    };

    const tasks: FreshContextTask[] = [
      makeFreshTask("a", [], ["src/a.ts", "src/b.ts", "src/c.ts"], 500),
    ];
    const waves = buildFreshContextWaves(tasks);
    let contextSize = 0;

    await executeWavesWithFreshContext(
      waves,
      async (_task, context) => {
        for (const content of context.values()) {
          contextSize += content.length;
        }
        return "ok";
      },
      largeResolver,
    );

    // Context should be trimmed to fit ~500 tokens (~2000 chars)
    expect(contextSize).toBeLessThan(4000 * 3); // Less than all 3 files
  });

  it("returns WaveExecutionResult with token counts", async () => {
    const tasks: FreshContextTask[] = [
      makeFreshTask("a", [], ["src/a.ts"]),
    ];
    const waves = buildFreshContextWaves(tasks);

    const results = await executeWavesWithFreshContext(
      waves,
      async () => "done",
      mockResolver,
    );

    const result = results.get("a");
    expect(result).toBeDefined();
    expect(result?.taskId).toBe("a");
    expect(result?.result).toBe("done");
    expect(result?.contextTokensUsed).toBeGreaterThan(0);
  });

  it("handles tasks with no context files", async () => {
    const tasks: FreshContextTask[] = [
      makeFreshTask("a", [], []),
    ];
    const waves = buildFreshContextWaves(tasks);

    const results = await executeWavesWithFreshContext(
      waves,
      async (_task, context) => {
        expect(context.size).toBe(0);
        return "done";
      },
      mockResolver,
    );

    expect(results.get("a")?.contextTokensUsed).toBe(0);
  });

  it("handles empty waves", async () => {
    const results = await executeWavesWithFreshContext(
      [],
      async () => "nope",
      mockResolver,
    );
    expect(results.size).toBe(0);
  });
});
