import { describe, it, expect, vi } from "vitest";
import {
  cleanPromptResponse,
  createLlmPromptMutator,
  optimizeSkillPrompt,
  buildBasicEvaluator,
} from "../../src/skills/skill-optimizer.js";

describe("cleanPromptResponse", () => {
  it("trims whitespace", () => {
    expect(cleanPromptResponse("  hello  ")).toBe("hello");
  });

  it("strips Sure, here's preamble", () => {
    expect(cleanPromptResponse("Sure, here's the rewrite:\nActual prompt")).toBe(
      "Actual prompt",
    );
  });

  it("strips triple-quote fencing", () => {
    expect(cleanPromptResponse('"""\nprompt body\n"""')).toBe("prompt body");
  });

  it("strips code fences", () => {
    expect(cleanPromptResponse("```\nbody\n```")).toBe("body");
  });

  it("handles empty input", () => {
    expect(cleanPromptResponse("")).toBe("");
  });
});

describe("createLlmPromptMutator", () => {
  it("produces N variants via query", async () => {
    const responses = ["variant 1", "variant 2", "variant 3"];
    let call = 0;
    const query = async () => responses[call++]!;
    const mutator = createLlmPromptMutator(query);
    const variants = await mutator("original prompt", 3);
    expect(variants).toEqual(["variant 1", "variant 2", "variant 3"]);
  });

  it("skips empty or unchanged responses", async () => {
    const responses = ["good variant", "original prompt", ""];
    let call = 0;
    const query = async () => responses[call++]!;
    const mutator = createLlmPromptMutator(query);
    const variants = await mutator("original prompt", 3);
    expect(variants).toEqual(["good variant"]);
  });

  it("strips preamble from LLM responses", async () => {
    const query = async () => "Sure, here is the rewrite:\ncleaned version";
    const mutator = createLlmPromptMutator(query);
    const variants = await mutator("orig", 1);
    expect(variants[0]).toBe("cleaned version");
  });
});

describe("optimizeSkillPrompt", () => {
  it("returns initial when no mutation helps", async () => {
    const result = await optimizeSkillPrompt({
      initialPrompt: "original",
      evaluate: async () => 0.5,
      mutate: async (parent) => [parent],
      maxGenerations: 3,
      populationSize: 2,
      patience: 100,
    });
    expect(result.prompt).toBe("original");
    expect(result.baselineFitness).toBe(0.5);
    expect(result.improved).toBe(false);
  });

  it("picks best when mutation improves fitness", async () => {
    const fitnessMap: Record<string, number> = {
      original: 0.3,
      better: 0.7,
      best: 0.9,
    };
    const result = await optimizeSkillPrompt({
      initialPrompt: "original",
      evaluate: async (p) => fitnessMap[p] ?? 0,
      mutate: async (parent) => {
        if (parent === "original") return ["better"];
        if (parent === "better") return ["best"];
        return [parent];
      },
      maxGenerations: 5,
      populationSize: 2,
      patience: 100,
    });
    expect(result.prompt).toBe("best");
    expect(result.fitness).toBe(0.9);
    expect(result.improved).toBe(true);
  });

  it("reports generationsRun + evaluationsRun", async () => {
    const result = await optimizeSkillPrompt({
      initialPrompt: "p",
      evaluate: async () => 0.5,
      mutate: async (parent) => [parent],
      maxGenerations: 5,
      populationSize: 2,
      patience: 100,
    });
    expect(result.generationsRun).toBeGreaterThan(0);
    expect(result.evaluationsRun).toBeGreaterThan(0);
  });

  it("calls onGeneration callback", async () => {
    const calls: number[] = [];
    await optimizeSkillPrompt({
      initialPrompt: "p",
      evaluate: async () => 0.5,
      mutate: async (parent) => [parent],
      maxGenerations: 3,
      populationSize: 2,
      patience: 100,
      onGeneration: (gen) => calls.push(gen),
    });
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("buildBasicEvaluator", () => {
  it("scores expectedContains matches", async () => {
    const runtime = { query: async () => "the answer is 42" };
    const evaluate = buildBasicEvaluator(runtime, [
      { input: "x", expectedContains: "42" },
      { input: "y", expectedContains: "missing" },
    ]);
    expect(await evaluate("skill prompt")).toBe(0.5);
  });

  it("scores expectedEquals matches (case-insensitive)", async () => {
    const runtime = { query: async () => "PARIS" };
    const evaluate = buildBasicEvaluator(runtime, [
      { input: "x", expectedEquals: "paris" },
    ]);
    expect(await evaluate("s")).toBe(1);
  });

  it("returns 0 for empty test set", async () => {
    const runtime = { query: async () => "" };
    const evaluate = buildBasicEvaluator(runtime, []);
    expect(await evaluate("s")).toBe(0);
  });

  it("handles thrown errors (counts as fail)", async () => {
    const runtime = {
      query: async () => {
        throw new Error("boom");
      },
    };
    const evaluate = buildBasicEvaluator(runtime, [{ input: "x", expectedContains: "y" }]);
    expect(await evaluate("s")).toBe(0);
  });

  it("passes when no expectation AND response non-empty", async () => {
    const runtime = { query: async () => "any response" };
    const evaluate = buildBasicEvaluator(runtime, [{ input: "x" }]);
    expect(await evaluate("s")).toBe(1);
  });
});
