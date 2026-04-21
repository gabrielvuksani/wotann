/**
 * Tests for OpenHands-style critic-model rerank over N parallel rollouts.
 *
 * Pattern: generate N candidate solutions, score each via critic LLM,
 * pick highest-scored. Ties broken by shortest output.
 */

import { describe, it, expect } from "vitest";
import {
  CriticRerank,
  AllRolloutsFailed,
  type Rollout,
  type RollouGenerator,
  type CriticJudge,
  type RerankEvent,
} from "../../src/orchestration/critic-rerank.js";

// ── Helpers ────────────────────────────────────────────

function constantJudge(scores: readonly number[]): CriticJudge {
  let i = 0;
  return async (_task, candidate) => {
    const score = scores[i++] ?? 50;
    return {
      score,
      reasoning: `score=${score} for len=${candidate.output.length}`,
    };
  };
}

function textGenerator(outputs: readonly string[]): RollouGenerator {
  return async (_task, idx) => {
    const text = outputs[idx] ?? "";
    return { output: text, metadata: { idx } };
  };
}

// ── Tests ──────────────────────────────────────────────

describe("CriticRerank — basic picking", () => {
  it("runs 5 rollouts, all pass, picks highest-scored", async () => {
    const rerank = new CriticRerank({
      generator: textGenerator(["a", "bb", "ccc", "dddd", "eeeee"]),
      critic: constantJudge([10, 20, 30, 40, 99]),
      N: 5,
    });
    const result = await rerank.rerank({ task: "problem" });
    expect(result.winner).not.toBeNull();
    expect(result.winner?.output).toBe("eeeee");
    expect(result.winner?.score).toBe(99);
    expect(result.rollouts).toHaveLength(5);
    expect(result.errors).toHaveLength(0);
  });

  it("honors configurable N (N=3 works)", async () => {
    const rerank = new CriticRerank({
      generator: textGenerator(["x", "y", "z"]),
      critic: constantJudge([10, 50, 20]),
      N: 3,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.rollouts).toHaveLength(3);
    expect(result.winner?.output).toBe("y");
  });

  it("picks by highest score, not insertion order", async () => {
    const rerank = new CriticRerank({
      generator: textGenerator(["A", "B", "C"]),
      critic: constantJudge([30, 90, 50]),
      N: 3,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.winner?.output).toBe("B");
    expect(result.winner?.index).toBe(1);
  });
});

describe("CriticRerank — tie-breaking", () => {
  it("ties broken by shortest output", async () => {
    const rerank = new CriticRerank({
      generator: textGenerator(["long answer here", "short", "medium ans"]),
      critic: constantJudge([75, 75, 75]),
      N: 3,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.winner?.output).toBe("short");
  });

  it("multi-way tie at top — still shortest wins", async () => {
    const rerank = new CriticRerank({
      generator: textGenerator(["AAAA", "BB", "CCC", "D"]),
      critic: constantJudge([80, 80, 80, 80]),
      N: 4,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.winner?.output).toBe("D");
  });
});

describe("CriticRerank — honest failures", () => {
  it("1 of 5 generators fails, 4 scored — tie-break still works", async () => {
    let gcalls = 0;
    const gen: RollouGenerator = async (_task, idx) => {
      gcalls++;
      if (idx === 2) throw new Error("gen failed");
      return { output: `x${idx}`, metadata: { idx } };
    };
    const rerank = new CriticRerank({
      generator: gen,
      critic: constantJudge([10, 20, 30, 40]),
      N: 5,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.rollouts).toHaveLength(4);
    expect(result.errors).toHaveLength(1);
    const err = result.errors[0];
    expect(err?.stage).toBe("generator");
    expect(err?.index).toBe(2);
    expect(result.winner?.index).toBe(4);
    expect(gcalls).toBe(5);
  });

  it("all 5 fail -> throws AllRolloutsFailed with reasons", async () => {
    const gen: RollouGenerator = async (_task, idx) => {
      throw new Error(`gen-${idx}-boom`);
    };
    const rerank = new CriticRerank({
      generator: gen,
      critic: constantJudge([50]),
      N: 5,
    });
    let thrown: unknown;
    try {
      await rerank.rerank({ task: "t" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AllRolloutsFailed);
    const err = thrown as AllRolloutsFailed;
    expect(err.reasons).toHaveLength(5);
    expect(err.reasons[0]).toContain("gen-0-boom");
    expect(err.reasons[4]).toContain("gen-4-boom");
  });

  it("critic errors are honestly propagated; surviving candidates still win", async () => {
    const judge: CriticJudge = async (_t, candidate) => {
      if (candidate.output === "bad") throw new Error("judge boom");
      return { score: 60, reasoning: "ok" };
    };
    const rerank = new CriticRerank({
      generator: textGenerator(["good1", "bad", "good2"]),
      critic: judge,
      N: 3,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.stage).toBe("critic");
    expect(result.rollouts).toHaveLength(2);
    expect(result.winner).not.toBeNull();
  });
});

describe("CriticRerank — timeouts", () => {
  it("timeout on one generator, others proceed", async () => {
    const gen: RollouGenerator = async (_task, idx) => {
      if (idx === 1) {
        await new Promise((r) => setTimeout(r, 200));
        return { output: "slow", metadata: {} };
      }
      return { output: `q${idx}`, metadata: {} };
    };
    const rerank = new CriticRerank({
      generator: gen,
      critic: constantJudge([10, 999, 30]),
      N: 3,
      perRolloutTimeoutMs: 50,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.rollouts).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.stage).toBe("generator");
    expect(result.errors[0]?.reason).toMatch(/timeout/i);
    expect(result.winner?.index).toBe(2);
  });
});

describe("CriticRerank — concurrency isolation", () => {
  it("concurrent reranks do not cross-contaminate", async () => {
    let callCount = 0;
    const gen: RollouGenerator = async (task, idx) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 5));
      return { output: `${task.task}-${idx}`, metadata: {} };
    };
    // Separate judges so each invocation sees an independent score stream.
    const makeJudge = (scores: readonly number[]): CriticJudge => {
      let i = 0;
      return async () => ({ score: scores[i++] ?? 0, reasoning: "" });
    };
    const r1 = new CriticRerank({
      generator: gen,
      critic: makeJudge([1, 2, 99]),
      N: 3,
    });
    const r2 = new CriticRerank({
      generator: gen,
      critic: makeJudge([77, 1, 2]),
      N: 3,
    });
    const [result1, result2] = await Promise.all([
      r1.rerank({ task: "alpha" }),
      r2.rerank({ task: "beta" }),
    ]);
    expect(result1.winner?.output).toBe("alpha-2");
    expect(result2.winner?.output).toBe("beta-0");
    expect(callCount).toBe(6);
  });
});

describe("CriticRerank — event emission", () => {
  it("emits rollout.started, rollout.finished, critic.scored, rerank.picked in order", async () => {
    const events: RerankEvent[] = [];
    const rerank = new CriticRerank({
      generator: textGenerator(["a", "b"]),
      critic: constantJudge([20, 80]),
      N: 2,
      onEvent: (e) => events.push(e),
    });
    await rerank.rerank({ task: "t" });

    const kinds = events.map((e) => e.kind);
    // 2x started, 2x finished, 2x scored, 1x picked
    expect(kinds.filter((k) => k === "rollout.started")).toHaveLength(2);
    expect(kinds.filter((k) => k === "rollout.finished")).toHaveLength(2);
    expect(kinds.filter((k) => k === "critic.scored")).toHaveLength(2);
    expect(kinds.filter((k) => k === "rerank.picked")).toHaveLength(1);
    // Final event is picked.
    expect(kinds[kinds.length - 1]).toBe("rerank.picked");
    // Every start has a matching finish for the same index before critic.scored for that index.
    for (let idx = 0; idx < 2; idx++) {
      const sIdx = events.findIndex(
        (e) => e.kind === "rollout.started" && e.index === idx,
      );
      const fIdx = events.findIndex(
        (e) => e.kind === "rollout.finished" && e.index === idx,
      );
      const cIdx = events.findIndex(
        (e) => e.kind === "critic.scored" && e.index === idx,
      );
      expect(sIdx).toBeGreaterThanOrEqual(0);
      expect(fIdx).toBeGreaterThan(sIdx);
      expect(cIdx).toBeGreaterThan(fIdx);
    }
  });

  it("emits rollout.failed when a generator throws", async () => {
    const events: RerankEvent[] = [];
    const gen: RollouGenerator = async (_task, idx) => {
      if (idx === 0) throw new Error("boom");
      return { output: "ok", metadata: {} };
    };
    const rerank = new CriticRerank({
      generator: gen,
      critic: constantJudge([90]),
      N: 2,
      onEvent: (e) => events.push(e),
    });
    await rerank.rerank({ task: "t" });
    const failed = events.filter((e) => e.kind === "rollout.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ kind: "rollout.failed", index: 0 });
  });
});

describe("CriticRerank — LlmQuery injection pattern (B4 verifier match)", () => {
  it("parses JSON from critic.llmQuery output", async () => {
    // Use the built-in llmQueryCritic helper that matches B4's LlmQuery shape.
    const llmQuery = async (prompt: string) => {
      // Critic should receive a structured prompt referencing the candidate.
      expect(prompt).toContain("score");
      return '{"score": 77, "reasoning": "looks good"}';
    };
    const { llmQueryCritic } = await import(
      "../../src/intelligence/critic-model.js"
    );
    const critic = llmQueryCritic(llmQuery);
    const rerank = new CriticRerank({
      generator: textGenerator(["candidate-1"]),
      critic,
      N: 1,
    });
    const result = await rerank.rerank({ task: "build me X" });
    expect(result.winner?.score).toBe(77);
  });

  it("malformed critic JSON: parseable subset kept, others errored", async () => {
    // Mix: 3 candidates. Critic #0 returns malformed, #1 valid, #2 valid.
    let call = 0;
    const llmQuery = async () => {
      const idx = call++;
      if (idx === 0) return "not valid JSON at all";
      if (idx === 1) return '{"score": 42, "reasoning": "mid"}';
      return '{"score": 88, "reasoning": "high"}';
    };
    const { llmQueryCritic } = await import(
      "../../src/intelligence/critic-model.js"
    );
    const critic = llmQueryCritic(llmQuery);
    const rerank = new CriticRerank({
      generator: textGenerator(["c0", "c1", "c2"]),
      critic,
      N: 3,
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.rollouts).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.stage).toBe("critic");
    expect(result.winner?.score).toBe(88);
  });

  it("llmQueryCritic clamps score to 0..100 and extracts score from fenced JSON", async () => {
    const llmQuery = async () =>
      '```json\n{"score": 150, "reasoning": "too high"}\n```';
    const { llmQueryCritic } = await import(
      "../../src/intelligence/critic-model.js"
    );
    const critic = llmQueryCritic(llmQuery);
    const result = await critic({ task: "t" }, { output: "x", metadata: {} });
    expect(result.score).toBe(100);
  });
});

describe("CriticRerank — defaults + validation", () => {
  it("default N is 5", async () => {
    const rerank = new CriticRerank({
      generator: textGenerator(["a", "b", "c", "d", "e", "f"]),
      critic: constantJudge([1, 2, 3, 4, 5]),
    });
    const result = await rerank.rerank({ task: "t" });
    expect(result.rollouts).toHaveLength(5);
  });

  it("rejects N < 1", () => {
    expect(
      () =>
        new CriticRerank({
          generator: textGenerator(["x"]),
          critic: constantJudge([1]),
          N: 0,
        }),
    ).toThrow(/N must be/i);
  });
});

// ── Export type check — the pattern is fit for opt-in per-task ───────
// (No runtime assertion; if the type doesn't compile, tsc fails.)

describe("type surface", () => {
  it("RerankTask is minimal enough to opt-in via rerank:true", () => {
    const task: { readonly task: string; readonly rerank: true } = {
      task: "hard",
      rerank: true,
    };
    // Pass-through assertion — just ensures types compose cleanly.
    expect(task.rerank).toBe(true);
  });

  it("Rollout supports arbitrary metadata", () => {
    const r: Rollout = {
      output: "x",
      metadata: { temperature: 0.7, seed: 42 },
    };
    expect(r.metadata).toMatchObject({ temperature: 0.7 });
  });
});
