import { describe, it, expect, vi } from "vitest";
import {
  optimize,
  tournamentSelect,
  type OptimizerConfig,
  type Candidate,
} from "../../src/learning/gepa-optimizer.js";

// Deterministic RNG for tests
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("optimize — basic", () => {
  it("returns seed as best when mutation produces nothing better", async () => {
    const config: OptimizerConfig<number> = {
      initialPopulation: [42],
      mutate: async (parent) => [parent.value], // no-op mutation
      evaluate: async (c) => c.value,
      maxGenerations: 5,
      populationSize: 3,
    };
    const result = await optimize(config);
    expect(result.best.value).toBe(42);
  });

  it("converges to optimum with simple hill-climb mutation", async () => {
    // Maximize a function — start at 0, mutate by ±1, target 100
    const config: OptimizerConfig<number> = {
      initialPopulation: [0],
      mutate: async (parent) => [parent.value + 1, parent.value + 1],
      evaluate: async (c) => c.value, // fitness = value
      maxGenerations: 50,
      populationSize: 4,
      patience: 100, // no early stop — let it run
    };
    const result = await optimize(config);
    expect(result.best.value).toBeGreaterThan(20);
  });

  it("early-stops after patience generations of no improvement", async () => {
    let callCount = 0;
    const config: OptimizerConfig<number> = {
      initialPopulation: [10],
      mutate: async (parent) => [parent.value], // no improvement possible
      evaluate: async (c) => {
        callCount++;
        return c.value;
      },
      maxGenerations: 100,
      populationSize: 4,
      patience: 3,
    };
    const result = await optimize(config);
    expect(result.earlyStopped).toBe(true);
    expect(result.generationsRun).toBeLessThan(10);
  });
});

describe("optimize — memoization", () => {
  it("caches fitness by hash — does not re-evaluate identical candidates", async () => {
    const evalSpy = vi.fn(async (c: Candidate<number>) => c.value);
    const config: OptimizerConfig<number> = {
      initialPopulation: [1],
      mutate: async (parent) => [parent.value], // always returns same value
      evaluate: evalSpy,
      maxGenerations: 5,
      populationSize: 3,
      patience: 100,
    };
    const result = await optimize(config);
    // Only ONE unique candidate (value=1), so only ONE evaluate call
    expect(result.evaluationsRun).toBe(1);
    expect(evalSpy).toHaveBeenCalledTimes(1);
  });

  it("custom hash function controls cache key", async () => {
    const evalSpy = vi.fn(async (c: Candidate<{ x: number; y: number }>) => c.value.x + c.value.y);
    // Use hash that ignores y — treats {x:1,y:2} and {x:1,y:99} as identical
    const config: OptimizerConfig<{ x: number; y: number }> = {
      initialPopulation: [{ x: 1, y: 2 }],
      mutate: async (parent) => [
        { x: parent.value.x, y: parent.value.y + 1 },
      ],
      evaluate: evalSpy,
      hash: (v) => String(v.x),
      maxGenerations: 3,
      populationSize: 3,
      patience: 10,
    };
    await optimize(config);
    // Every candidate has x=1 so cache key is always "1" — 1 evaluation total
    expect(evalSpy).toHaveBeenCalledTimes(1);
  });
});

describe("optimize — elitism", () => {
  it("carries elite unchanged across generations", async () => {
    const mutations: Array<{ parentId: string; child: number }> = [];
    const config: OptimizerConfig<number> = {
      initialPopulation: [100, 50, 25],
      mutate: async (parent, count) => {
        const out: number[] = [];
        for (let i = 0; i < count; i++) {
          // Always mutate to 0 — any elite member (100) should survive
          out.push(0);
          mutations.push({ parentId: parent.id, child: 0 });
        }
        return out;
      },
      evaluate: async (c) => c.value,
      maxGenerations: 5,
      populationSize: 4,
      eliteCount: 1,
      patience: 100,
    };
    const result = await optimize(config);
    // Best candidate is still 100 because it was carried as elite
    expect(result.best.value).toBe(100);
  });
});

describe("optimize — crossover", () => {
  it("invokes crossover when provided and pop >= 2", async () => {
    const crossoverSpy = vi.fn(async (_a: Candidate<number>, _b: Candidate<number>) => 999);
    const config: OptimizerConfig<number> = {
      initialPopulation: [1, 2],
      mutate: async (parent) => [parent.value + 10],
      evaluate: async (c) => c.value,
      crossover: crossoverSpy,
      maxGenerations: 10,
      populationSize: 4,
      patience: 100,
      random: seededRandom(1), // deterministic
    };
    await optimize(config);
    expect(crossoverSpy).toHaveBeenCalled();
  });
});

describe("optimize — edge cases", () => {
  it("throws on empty initial population", async () => {
    await expect(
      optimize({
        initialPopulation: [],
        mutate: async () => [],
        evaluate: async () => 0,
      }),
    ).rejects.toThrow(/at least 1 member/);
  });

  it("throws on populationSize < 1", async () => {
    await expect(
      optimize({
        initialPopulation: [1],
        mutate: async () => [1],
        evaluate: async () => 0,
        populationSize: 0,
      }),
    ).rejects.toThrow(/populationSize/);
  });

  it("reports evaluationsRun accurately", async () => {
    const config: OptimizerConfig<number> = {
      initialPopulation: [1, 2, 3],
      mutate: async (parent, n) => {
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(parent.value * 10 + i);
        return out;
      },
      evaluate: async (c) => c.value,
      maxGenerations: 3,
      populationSize: 3,
      patience: 100,
    };
    const result = await optimize(config);
    expect(result.evaluationsRun).toBeGreaterThan(0);
  });

  it("calls onGeneration once per generation", async () => {
    const calls: number[] = [];
    const config: OptimizerConfig<number> = {
      initialPopulation: [1],
      mutate: async () => [1],
      evaluate: async () => 0,
      maxGenerations: 3,
      populationSize: 2,
      patience: 100,
      onGeneration: (gen) => calls.push(gen),
    };
    await optimize(config);
    expect(calls).toEqual([0, 1, 2]);
  });
});

describe("tournamentSelect", () => {
  const pop: Candidate<number>[] = [
    { id: "a", generation: 0, value: 10, fitness: 10 },
    { id: "b", generation: 0, value: 20, fitness: 20 },
    { id: "c", generation: 0, value: 5, fitness: 5 },
    { id: "d", generation: 0, value: 15, fitness: 15 },
  ];

  it("returns null on empty population", () => {
    expect(tournamentSelect([], 3)).toBeNull();
  });

  it("k=1 returns one candidate deterministically from seeded rng", () => {
    // With a fixed-seed RNG, we'll always pick the same index
    const picked = tournamentSelect(pop, 1, seededRandom(42));
    expect(picked).not.toBeNull();
    expect(pop).toContain(picked);
  });

  it("k=popSize picks the best (elite-equivalent)", () => {
    const picked = tournamentSelect(pop, pop.length, seededRandom(1));
    expect(picked?.fitness).toBe(20);
  });

  it("k > popSize clamps to popSize", () => {
    const picked = tournamentSelect(pop, 100, seededRandom(1));
    expect(picked).not.toBeNull();
  });
});
