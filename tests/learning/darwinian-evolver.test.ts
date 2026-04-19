import { describe, it, expect } from "vitest";
import {
  evolveCode,
  buildDeterministicMutator,
  COMMON_TS_TRANSFORMS,
} from "../../src/learning/darwinian-evolver.js";

describe("evolveCode — basic", () => {
  it("returns initial code when no mutation improves", async () => {
    const result = await evolveCode({
      initialCode: "function f() { return 42; }",
      evaluate: async () => 0.5,
      mutate: async (parent) => [parent],
      maxGenerations: 3,
      populationSize: 2,
      patience: 100,
    });
    expect(result.code).toBe("function f() { return 42; }");
    expect(result.baselineFitness).toBe(0.5);
    expect(result.improved).toBe(false);
  });

  it("picks best when mutation improves fitness", async () => {
    const fitnessMap: Record<string, number> = {
      "const x = 1": 0.5,
      "let x = 1": 0.8,
      "let y = 2": 0.9,
    };
    const result = await evolveCode({
      initialCode: "const x = 1",
      evaluate: async (c) => fitnessMap[c] ?? 0,
      mutate: async (parent) => {
        if (parent === "const x = 1") return ["let x = 1"];
        if (parent === "let x = 1") return ["let y = 2"];
        return [parent];
      },
      maxGenerations: 5,
      populationSize: 2,
      patience: 100,
    });
    expect(result.code).toBe("let y = 2");
    expect(result.fitness).toBe(0.9);
    expect(result.improved).toBe(true);
  });

  it("rejects syntactically-broken mutations", async () => {
    const result = await evolveCode({
      initialCode: "const x = 1;",
      syntaxCheck: (code) => code.includes(";"), // require semicolon
      evaluate: async () => 0.5,
      mutate: async () => ["bad code no semi", "const y = 2;"],
      maxGenerations: 2,
      populationSize: 2,
      patience: 100,
    });
    expect(result.syntaxRejects).toBeGreaterThan(0);
  });

  it("baseline fitness 0 when seed fails syntax check", async () => {
    const result = await evolveCode({
      initialCode: "invalid code",
      syntaxCheck: () => false,
      evaluate: async () => 1, // never called
      mutate: async () => [],
      maxGenerations: 2,
      populationSize: 2,
      patience: 100,
    });
    expect(result.baselineFitness).toBe(0);
  });

  it("reports syntaxRejects across gens", async () => {
    let callCount = 0;
    const result = await evolveCode({
      initialCode: "seed",
      syntaxCheck: (c) => c === "seed" || c === "good",
      evaluate: async () => 0.5,
      mutate: async () => {
        callCount++;
        return ["bad1", "good", "bad2"];
      },
      maxGenerations: 3,
      populationSize: 2,
      patience: 100,
    });
    expect(result.syntaxRejects).toBeGreaterThanOrEqual(callCount * 2);
  });
});

describe("buildDeterministicMutator", () => {
  it("applies transforms in round-robin", async () => {
    const transforms = [
      (c: string) => (c === "a" ? "b" : null),
      (c: string) => (c === "a" ? "c" : null),
    ];
    const mutator = buildDeterministicMutator(transforms);
    const variants = await mutator("a", 2);
    expect(variants.sort()).toEqual(["b", "c"]);
  });

  it("skips transforms that return null", async () => {
    const transforms = [(_c: string) => null, (c: string) => `${c}!`];
    const mutator = buildDeterministicMutator(transforms);
    const variants = await mutator("x", 1);
    expect(variants).toEqual(["x!"]);
  });

  it("skips duplicates", async () => {
    const transforms = [
      (_c: string) => "same",
      (_c: string) => "same",
      (_c: string) => "different",
    ];
    const mutator = buildDeterministicMutator(transforms);
    const variants = await mutator("seed", 3);
    expect(variants.sort()).toEqual(["different", "same"]);
  });

  it("returns empty array when no transform applies", async () => {
    const mutator = buildDeterministicMutator([(_c: string) => null]);
    const variants = await mutator("x", 5);
    expect(variants).toEqual([]);
  });
});

describe("COMMON_TS_TRANSFORMS", () => {
  it("includes const → let", () => {
    const transform = COMMON_TS_TRANSFORMS[0]!;
    expect(transform("const x = 1;")).toBe("let x = 1;");
    expect(transform("let x = 1;")).toBeNull();
  });

  it("adds optional chaining", () => {
    const transform = COMMON_TS_TRANSFORMS[1]!;
    expect(transform("obj.prop")).toBe("obj?.prop");
    expect(transform("obj?.prop")).toBeNull();
  });

  it("converts == to ===", () => {
    const transform = COMMON_TS_TRANSFORMS[2]!;
    const out = transform("if (a == b) return");
    expect(out).toContain("===");
    expect(transform("if (a === b) return")).toBeNull();
  });
});
