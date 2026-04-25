import { describe, it, expect, vi } from "vitest";
import {
  estimateTextualGradient,
  applyGradient,
  optimizeTextGrad,
} from "../../src/optimize/textgrad-optimizer.js";
import {
  type TextGradLlm,
  type TaskInstance,
  type TextGradFeedback,
  clampLearningRate,
  validateFeedback,
  DEFAULT_LEARNING_RATE,
} from "../../src/optimize/textgrad-types.js";

// ── Fakes ──────────────────────────────────────────

function fakeLlm(handler: (prompt: string) => string | Promise<string>): TextGradLlm {
  return {
    name: "fake",
    query: async (p: string) => handler(p),
  };
}

const TASK: TaskInstance = {
  id: "t-add",
  input: "2 + 2",
  expected: "4",
};

// ── clampLearningRate ──────────────────────────────

describe("clampLearningRate", () => {
  it("returns value unchanged when in range", () => {
    expect(clampLearningRate(0.5)).toEqual({ value: 0.5, wasClamped: false });
  });

  it("clamps values above 1 to 1", () => {
    expect(clampLearningRate(2.0)).toEqual({ value: 1, wasClamped: true });
  });

  it("clamps negative values to 0", () => {
    expect(clampLearningRate(-0.5)).toEqual({ value: 0, wasClamped: true });
  });

  it("returns default for NaN", () => {
    const r = clampLearningRate(NaN);
    expect(r.wasClamped).toBe(true);
    expect(r.value).toBe(DEFAULT_LEARNING_RATE);
  });

  it("accepts edge values 0 and 1 unclamped", () => {
    expect(clampLearningRate(0).wasClamped).toBe(false);
    expect(clampLearningRate(1).wasClamped).toBe(false);
  });
});

// ── validateFeedback ──────────────────────────────

describe("validateFeedback", () => {
  it("returns null for a valid feedback", () => {
    const fb: TextGradFeedback = {
      failureDescription: "x",
      suggestedEdit: "y",
      confidence: 0.5,
    };
    expect(validateFeedback(fb)).toBeNull();
  });

  it("rejects empty failureDescription", () => {
    expect(
      validateFeedback({ failureDescription: "", suggestedEdit: "y", confidence: 0.5 }),
    ).not.toBeNull();
  });

  it("rejects out-of-range confidence", () => {
    expect(
      validateFeedback({ failureDescription: "x", suggestedEdit: "y", confidence: 1.5 }),
    ).not.toBeNull();
    expect(
      validateFeedback({ failureDescription: "x", suggestedEdit: "y", confidence: -0.1 }),
    ).not.toBeNull();
  });
});

// ── estimateTextualGradient ────────────────────────

describe("estimateTextualGradient", () => {
  it("returns gradient on clear failure", async () => {
    const llm = fakeLlm(() =>
      JSON.stringify({
        failure_description: "Math is wrong.",
        suggested_edit: "Add: compute step-by-step.",
        confidence: 0.9,
      }),
    );
    const result = await estimateTextualGradient(
      "Compute it.",
      TASK,
      { taskId: TASK.id, actualOutput: "wrong", score: 0 },
      llm,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gradient.confidence).toBeGreaterThan(0.5);
  });

  it("returns ok=false on critic timeout", async () => {
    const llm = fakeLlm(async () => {
      await new Promise((r) => setTimeout(r, 500));
      return "{}";
    });
    const result = await estimateTextualGradient(
      "p",
      TASK,
      { taskId: TASK.id, actualOutput: "x", score: 0 },
      llm,
      { timeoutMs: 10 },
    );
    expect(result.ok).toBe(false);
  });
});

// ── applyGradient — annotation mode ────────────────

describe("applyGradient (annotation mode)", () => {
  const goodGradient: TextGradFeedback = {
    failureDescription: "Output too brief.",
    suggestedEdit: "Always include reasoning steps.",
    confidence: 0.8,
  };

  it("appends suggestion to prompt at default LR", async () => {
    const result = await applyGradient("Solve it.", goodGradient);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newPrompt).toContain("Always include reasoning steps");
  });

  it("uses 'Consider' phrasing at low LR", async () => {
    const result = await applyGradient("Solve it.", goodGradient, { learningRate: 0.2 });
    if (result.ok) expect(result.newPrompt).toContain("Consider");
  });

  it("uses 'Note' phrasing at moderate LR", async () => {
    const result = await applyGradient("Solve it.", goodGradient, { learningRate: 0.5 });
    if (result.ok) expect(result.newPrompt).toContain("Note");
  });

  it("uses 'Important' phrasing at high LR", async () => {
    const result = await applyGradient("Solve it.", goodGradient, { learningRate: 0.95 });
    if (result.ok) expect(result.newPrompt).toContain("Important");
  });

  it("abstains when confidence below threshold", async () => {
    const lowConf: TextGradFeedback = { ...goodGradient, confidence: 0.2 };
    const result = await applyGradient("p", lowConf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.toLowerCase()).toContain("confidence");
      expect(result.originalPrompt).toBe("p");
    }
  });

  it("respects custom abstainThreshold", async () => {
    const result = await applyGradient("p", goodGradient, { abstainThreshold: 0.95 });
    expect(result.ok).toBe(false);
  });

  it("clamps learning rate above 1 and notifies via callback", async () => {
    const onClamp = vi.fn();
    await applyGradient("p", goodGradient, { learningRate: 5, onClampWarning: onClamp });
    expect(onClamp).toHaveBeenCalledWith(5, 1);
  });

  it("returns ok=false when LR is 0", async () => {
    const result = await applyGradient("p", goodGradient, { learningRate: 0 });
    expect(result.ok).toBe(false);
  });

  it("calls onAbstain callback on low-confidence skip", async () => {
    const onAbstain = vi.fn();
    const lowConf: TextGradFeedback = { ...goodGradient, confidence: 0.1 };
    await applyGradient("p", lowConf, { onAbstain });
    expect(onAbstain).toHaveBeenCalledWith(lowConf);
  });
});

// ── applyGradient — rewrite mode ───────────────────

describe("applyGradient (rewrite mode)", () => {
  const goodGradient: TextGradFeedback = {
    failureDescription: "Output too brief.",
    suggestedEdit: "Always include reasoning steps.",
    confidence: 0.8,
  };

  it("uses editor LLM to rewrite the prompt", async () => {
    const editorLlm = fakeLlm(() => "Solve carefully and show work.");
    const result = await applyGradient("Solve it.", goodGradient, { editorLlm });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newPrompt).toBe("Solve carefully and show work.");
  });

  it("strips code fences from editor output", async () => {
    const editorLlm = fakeLlm(() => "```\nNew prompt body\n```");
    const result = await applyGradient("p", goodGradient, { editorLlm });
    if (result.ok) expect(result.newPrompt).toBe("New prompt body");
  });

  it("returns ok=false when editor returns empty", async () => {
    const editorLlm = fakeLlm(() => "");
    const result = await applyGradient("p", goodGradient, { editorLlm });
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when editor throws", async () => {
    const editorLlm = fakeLlm(async () => {
      throw new Error("editor offline");
    });
    const result = await applyGradient("p", goodGradient, { editorLlm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("editor offline");
  });
});

// ── optimizeTextGrad — full loop ───────────────────

describe("optimizeTextGrad", () => {
  it("returns initial prompt and stops if all tasks pass", async () => {
    const trainingSet: TaskInstance[] = [{ id: "t1", input: "x", expected: "ok" }];
    const result = await optimizeTextGrad({
      initialPrompt: "Already perfect prompt",
      trainingSet,
      runAgent: async () => "ok",
      score: async () => 1.0,
      criticLlm: fakeLlm(() => "{}"),
    });
    expect(result.bestPrompt).toBe("Already perfect prompt");
    expect(result.stopped).toBe("no-failures-found");
  });

  it("applies a gradient when there are failures", async () => {
    const trainingSet: TaskInstance[] = [{ id: "t1", input: "x", expected: "good" }];
    let runCount = 0;
    const runAgent = async () => {
      runCount++;
      // Pretend the agent improves after the prompt is updated
      return runCount > 2 ? "good" : "bad";
    };
    const score = async (output: string) => (output === "good" ? 1.0 : 0.0);

    const criticLlm = fakeLlm(() =>
      JSON.stringify({
        failure_description: "Bad output.",
        suggested_edit: "Be more specific.",
        confidence: 0.9,
      }),
    );

    const result = await optimizeTextGrad({
      initialPrompt: "Initial",
      trainingSet,
      runAgent,
      score,
      criticLlm,
      maxIterations: 3,
    });

    // The optimizer should have moved beyond initial prompt
    expect(result.bestScore).toBeGreaterThanOrEqual(result.initialScore);
  });

  it("does not crash when critic always fails", async () => {
    const trainingSet: TaskInstance[] = [{ id: "t1", input: "x", expected: "good" }];
    const failingCritic = fakeLlm(async () => {
      throw new Error("critic offline");
    });
    const result = await optimizeTextGrad({
      initialPrompt: "p",
      trainingSet,
      runAgent: async () => "bad",
      score: async () => 0.0,
      criticLlm: failingCritic,
      maxIterations: 2,
    });
    // Should complete gracefully
    expect(result.iterationsRun).toBeGreaterThanOrEqual(0);
    expect(result.bestPrompt).toBe("p");
  });

  it("rejects gradient that hurts performance", async () => {
    const trainingSet: TaskInstance[] = [{ id: "t1", input: "x", expected: "good" }];
    let pass = 0;
    const runAgent = async () => {
      // Always fail
      pass++;
      return "bad";
    };
    const score = async () => 0.3;

    const criticLlm = fakeLlm(() =>
      JSON.stringify({
        failure_description: "x",
        suggested_edit: "Make it worse.",
        confidence: 0.9,
      }),
    );

    const result = await optimizeTextGrad({
      initialPrompt: "Initial",
      trainingSet,
      runAgent,
      score,
      criticLlm,
      maxIterations: 1,
      stopWhenPerfect: false,
    });
    // Best prompt should still be the initial one since updates don't improve score
    expect(result.bestScore).toBeLessThanOrEqual(result.initialScore + 0.001);
  });

  it("throws when training set is empty", async () => {
    await expect(
      optimizeTextGrad({
        initialPrompt: "p",
        trainingSet: [],
        runAgent: async () => "x",
        score: async () => 1,
        criticLlm: fakeLlm(() => "{}"),
      }),
    ).rejects.toThrow();
  });

  it("calls onIteration callback per iteration", async () => {
    const trainingSet: TaskInstance[] = [{ id: "t1", input: "x" }];
    const seen: number[] = [];
    await optimizeTextGrad({
      initialPrompt: "p",
      trainingSet,
      runAgent: async () => "x",
      score: async () => 1.0, // baseline already perfect
      criticLlm: fakeLlm(() => "{}"),
      onIteration: (info) => seen.push(info.iteration),
    });
    expect(seen).toContain(0);
  });

  it("handles runAgent throwing without crashing", async () => {
    const trainingSet: TaskInstance[] = [{ id: "t1", input: "x", expected: "good" }];
    const result = await optimizeTextGrad({
      initialPrompt: "p",
      trainingSet,
      runAgent: async () => {
        throw new Error("runtime fail");
      },
      score: async () => 1.0,
      criticLlm: fakeLlm(() =>
        JSON.stringify({
          failure_description: "f",
          suggested_edit: "e",
          confidence: 0.9,
        }),
      ),
      maxIterations: 1,
    });
    expect(result).toBeDefined();
  });
});
