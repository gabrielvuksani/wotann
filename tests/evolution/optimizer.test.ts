/**
 * Tests for the WOTANN evolution pipeline.
 *
 * Strategy: use deterministic stub mutator + evaluator so the test
 * doesn't depend on any provider being configured. The optimizer is
 * fully orthogonal to provider plumbing — these tests verify the
 * generation/evaluation/selection logic, not LLM behaviour.
 */

import { describe, expect, it } from "vitest";

import { validateConstraints, exposesSecret } from "../../src/evolution/constraints.js";
import { jaccardScore, tokenize, evaluateVariant } from "../../src/evolution/evaluator.js";
import {
  proposeMutations,
  buildMutationPrompt,
  assembleVariant,
} from "../../src/evolution/mutator.js";
import {
  runOptimization,
  makeStubEvaluator,
  makeStubMutator,
} from "../../src/evolution/optimizer.js";
import { buildSyntheticExamples } from "../../src/evolution/runner.js";

describe("constraints", () => {
  it("rejects skill content without YAML frontmatter", () => {
    const report = validateConstraints(
      { kind: "skill", path: "x.md", name: "x" },
      "no frontmatter here\nname: nope",
    );
    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.includes("frontmatter"))).toBe(true);
  });

  it("rejects skill content over the size cap", () => {
    const tooBig = "---\nname: x\n---\n" + "x".repeat(20_000);
    const report = validateConstraints(
      { kind: "skill", path: "x.md", name: "x" },
      tooBig,
    );
    expect(report.passed).toBe(false);
  });

  it("rejects content with TODO/FIXME placeholders", () => {
    const content = "---\nname: x\n---\nTODO: finish this";
    const report = validateConstraints(
      { kind: "skill", path: "x.md", name: "x" },
      content,
    );
    expect(report.passed).toBe(false);
  });

  it("accepts a valid skill", () => {
    const content = "---\nname: x\ndescription: ok\n---\n# x\n\nA clear description.";
    const report = validateConstraints(
      { kind: "skill", path: "x.md", name: "x" },
      content,
    );
    expect(report.passed).toBe(true);
  });

  it("flags exposed secrets", () => {
    expect(exposesSecret("api_key = 'sk-abc1234567890123456789'")).toBe(true);
    expect(exposesSecret("plain text here")).toBe(false);
  });
});

describe("evaluator", () => {
  it("tokenizes lowercased without stop words and short tokens", () => {
    expect(tokenize("The quick brown FOX")).toEqual(["quick", "brown", "fox"]);
  });

  it("jaccard 1 for identical, 0 for disjoint", () => {
    expect(jaccardScore("apple banana", "apple banana")).toBe(1);
    expect(jaccardScore("apple", "lawn mower garden")).toBe(0);
  });

  it("evaluateVariant aggregates and weights examples", async () => {
    const variant = {
      id: "v1",
      content: "say hello",
      parentId: null,
      generation: 0,
      mutationReasoning: "",
    };
    const examples = [
      { id: "a", input: "hello", expectedOutcome: "hello world" },
      { id: "b", input: "goodbye", expectedOutcome: "goodbye world" },
    ];
    const caller = async ({ input }: { input: string }) => ({
      text: `${input} world`,
      costUsd: 0.01,
      latencyMs: 1,
    });
    const { aggregate, results } = await evaluateVariant({ caller, examples, variant });
    expect(results.length).toBe(2);
    expect(aggregate.cost).toBeCloseTo(0.02);
    expect(aggregate.score).toBeGreaterThan(0); // identical text → high jaccard
  });

  it("evaluateVariant captures caller exceptions as zero-score result", async () => {
    const variant = {
      id: "v1",
      content: "x",
      parentId: null,
      generation: 0,
      mutationReasoning: "",
    };
    const examples = [{ id: "a", input: "in", expectedOutcome: "out" }];
    const caller = async () => {
      throw new Error("network fail");
    };
    const { results } = await evaluateVariant({ caller, examples, variant });
    expect(results[0]?.score).toBe(0);
    expect(results[0]?.notes).toContain("network fail");
  });
});

describe("mutator", () => {
  it("proposeMutations(reflective) cycles through recent failures", () => {
    const proposals = proposeMutations(
      {
        target: { kind: "skill", path: "x.md", name: "x" },
        traceExcerpts: [],
        recentFailures: ["F1", "F2"],
        currentScore: 0.5,
        strategy: "reflective",
        maxLength: 1000,
      },
      4,
    );
    expect(proposals.length).toBe(4);
    expect(proposals[0]?.rationale).toBe("F1");
    expect(proposals[1]?.rationale).toBe("F2");
    expect(proposals[2]?.rationale).toBe("F1");
  });

  it("proposeMutations(random) returns the canonical 8 tweak names", () => {
    const proposals = proposeMutations(
      {
        target: { kind: "skill", path: "x.md", name: "x" },
        traceExcerpts: [],
        recentFailures: [],
        currentScore: 0,
        strategy: "random",
        maxLength: 1000,
      },
      8,
    );
    const hints = proposals.map((p) => p.diffHint);
    expect(new Set(hints).size).toBe(8);
  });

  it("buildMutationPrompt embeds baseline inside <BASELINE>", () => {
    const prompt = buildMutationPrompt(
      "BASE-CONTENT",
      { id: "id-1", diffHint: "hint", rationale: "why" },
      { kind: "skill", path: "x.md", name: "x" },
    );
    expect(prompt).toContain("<BASELINE>");
    expect(prompt).toContain("BASE-CONTENT");
    expect(prompt).toContain("hint");
  });

  it("assembleVariant trims llmOutput", () => {
    const v = assembleVariant({
      parentId: "p",
      generation: 1,
      proposal: { id: "id-1", diffHint: "h", rationale: "r" },
      llmOutput: "  out  \n",
    });
    expect(v.content).toBe("out");
    expect(v.parentId).toBe("p");
    expect(v.generation).toBe(1);
  });
});

describe("runner.buildSyntheticExamples", () => {
  it("returns one synthetic example when no triggers are present", () => {
    const skill = "---\nname: x\ndescription: A simple skill\n---\n# x";
    const examples = buildSyntheticExamples(skill);
    expect(examples.length).toBeGreaterThanOrEqual(1);
  });
});

describe("runOptimization", () => {
  it("scores baseline + at least one generation, returns winner", async () => {
    const summary = await runOptimization({
      target: { kind: "skill", path: "x.md", name: "x" },
      baseline: "---\nname: x\n---\nbaseline body",
      examples: [{ id: "e1", input: "in", expectedOutcome: "in ok" }],
      mutate: makeStubMutator(),
      evaluate: makeStubEvaluator(),
      generations: 1,
      variantsPerGeneration: 2,
    });
    expect(summary.baselineScore).toBeGreaterThanOrEqual(0);
    expect(summary.bestScore).toBeGreaterThanOrEqual(summary.baselineScore);
    expect(summary.bestVariantId).toBeTruthy();
  });

  it("reports budget exhaustion and stops generating", async () => {
    let callCount = 0;
    const summary = await runOptimization({
      target: { kind: "skill", path: "x.md", name: "x" },
      baseline: "---\nname: x\n---\nbody",
      examples: [{ id: "e1", input: "in", expectedOutcome: "out" }],
      mutate: async () => {
        callCount++;
        return { text: "---\nname: x\n---\nmutated body", costUsd: 100 };
      },
      evaluate: makeStubEvaluator(),
      maxBudgetUsd: 5,
      generations: 5,
      variantsPerGeneration: 3,
    });
    expect(callCount).toBeLessThan(15); // would be 15 without budget cap
    expect(summary.notes.some((n) => n.includes("Budget"))).toBe(true);
  });

  it("rejects variants that violate constraints", async () => {
    const events: string[] = [];
    await runOptimization({
      target: { kind: "skill", path: "x.md", name: "x" },
      baseline: "---\nname: x\n---\nbody",
      examples: [{ id: "e1", input: "in", expectedOutcome: "out" }],
      mutate: async () => ({ text: "no frontmatter here", costUsd: 0 }),
      evaluate: makeStubEvaluator(),
      generations: 1,
      variantsPerGeneration: 2,
      onProgress: (e) => events.push(e.type),
    });
    expect(events).toContain("variant-rejected");
  });
});
