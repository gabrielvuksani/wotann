import { describe, it, expect } from "vitest";
import {
  formatCriticPrompt,
  parseGradientResponse,
  runCritic,
} from "../../src/optimize/textgrad-critic.js";
import type {
  TextGradLlm,
  TaskInstance,
  TaskFailure,
} from "../../src/optimize/textgrad-types.js";

// ── Helpers ────────────────────────────────────────

function fakeLlm(response: string | (() => Promise<string>)): TextGradLlm {
  return {
    name: "fake",
    query: typeof response === "string" ? async () => response : response,
  };
}

const TASK: TaskInstance = {
  id: "t1",
  input: "What is 2 + 2?",
  expected: "4",
  description: "Arithmetic question",
};

const FAILURE: TaskFailure = {
  taskId: "t1",
  actualOutput: "I think it might be 5",
  score: 0.1,
};

// ── formatCriticPrompt ─────────────────────────────

describe("formatCriticPrompt", () => {
  it("includes prompt, input, expected, actual output, and score", () => {
    const formatted = formatCriticPrompt("Solve the math problem.", TASK, FAILURE);
    expect(formatted).toContain("Solve the math problem.");
    expect(formatted).toContain("What is 2 + 2?");
    expect(formatted).toContain("4");
    expect(formatted).toContain("I think it might be 5");
    expect(formatted).toContain("0.10");
  });

  it("includes task description when provided", () => {
    const formatted = formatCriticPrompt("p", TASK, FAILURE);
    expect(formatted).toContain("Arithmetic question");
  });

  it("omits expected section when expected is undefined", () => {
    const taskNoExpected: TaskInstance = { id: "t1", input: "in" };
    const formatted = formatCriticPrompt("p", taskNoExpected, FAILURE);
    expect(formatted).not.toContain("EXPECTED OUTPUT");
  });

  it("includes error message when present", () => {
    const failureWithErr: TaskFailure = { ...FAILURE, errorMessage: "TypeError: foo" };
    const formatted = formatCriticPrompt("p", TASK, failureWithErr);
    expect(formatted).toContain("TypeError: foo");
  });

  it("instructs the critic to respond with raw JSON", () => {
    const formatted = formatCriticPrompt("p", TASK, FAILURE);
    expect(formatted.toLowerCase()).toContain("json");
  });
});

// ── parseGradientResponse ──────────────────────────

describe("parseGradientResponse — well-formed JSON", () => {
  it("parses valid JSON with all fields", () => {
    const raw = JSON.stringify({
      failure_description: "Output is incorrect.",
      suggested_edit: "Add explicit instruction to compute carefully.",
      confidence: 0.85,
    });
    const result = parseGradientResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gradient.failureDescription).toBe("Output is incorrect.");
      expect(result.gradient.suggestedEdit).toContain("compute carefully");
      expect(result.gradient.confidence).toBeCloseTo(0.85);
    }
  });

  it("clamps confidence above 1 to 1", () => {
    const raw = JSON.stringify({
      failure_description: "x",
      suggested_edit: "y",
      confidence: 5.0,
    });
    const result = parseGradientResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gradient.confidence).toBe(1);
  });

  it("clamps negative confidence to 0", () => {
    const raw = JSON.stringify({
      failure_description: "x",
      suggested_edit: "y",
      confidence: -0.5,
    });
    const result = parseGradientResponse(raw);
    // confidence=0 is valid but useless; check it's at 0 minimum
    if (result.ok) expect(result.gradient.confidence).toBe(0);
  });

  it("strips markdown code fences", () => {
    const raw = "```json\n" + JSON.stringify({
      failure_description: "x",
      suggested_edit: "y",
      confidence: 0.5,
    }) + "\n```";
    const result = parseGradientResponse(raw);
    expect(result.ok).toBe(true);
  });

  it("preserves rawCriticResponse for audit", () => {
    const raw = JSON.stringify({
      failure_description: "x",
      suggested_edit: "y",
      confidence: 0.5,
    });
    const result = parseGradientResponse(raw);
    if (result.ok) expect(result.gradient.rawCriticResponse).toBe(raw);
  });
});

describe("parseGradientResponse — malformed input", () => {
  it("returns ok=false for empty string", () => {
    const result = parseGradientResponse("");
    expect(result.ok).toBe(false);
  });

  it("falls back to heuristic on malformed JSON, with low confidence", () => {
    const result = parseGradientResponse("Some prose without JSON structure.");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gradient.confidence).toBeLessThanOrEqual(0.3);
  });

  it("returns ok=false when content is whitespace only", () => {
    const result = parseGradientResponse("   \n\n  \t");
    expect(result.ok).toBe(false);
  });

  it("handles JSON missing required fields with low-confidence fallback", () => {
    const raw = JSON.stringify({ confidence: 0.9 }); // missing the text fields
    const result = parseGradientResponse(raw);
    // Should fall back to heuristic since validation failed
    if (result.ok) {
      expect(result.gradient.confidence).toBeLessThanOrEqual(0.3);
    }
  });

  it("survives when JSON is wrapped in other prose", () => {
    const raw =
      'Here is my analysis: ' +
      JSON.stringify({
        failure_description: "Bug.",
        suggested_edit: "Fix.",
        confidence: 0.7,
      }) +
      ' That is all.';
    const result = parseGradientResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gradient.confidence).toBe(0.7);
  });
});

// ── runCritic ──────────────────────────────────────

describe("runCritic", () => {
  it("returns gradient on successful critic response", async () => {
    const llm = fakeLlm(
      JSON.stringify({
        failure_description: "Off by one.",
        suggested_edit: "Add bounds check.",
        confidence: 0.8,
      }),
    );
    const result = await runCritic("p", TASK, FAILURE, llm);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gradient.suggestedEdit).toContain("bounds check");
    }
  });

  it("returns ok=false on empty response", async () => {
    const llm = fakeLlm("");
    const result = await runCritic("p", TASK, FAILURE, llm);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("returns ok=false on critic LLM error", async () => {
    const llm = fakeLlm(async () => {
      throw new Error("network fail");
    });
    const result = await runCritic("p", TASK, FAILURE, llm);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("network fail");
  });

  it("respects timeoutMs option", async () => {
    const llm = fakeLlm(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return "{}";
    });
    const result = await runCritic("p", TASK, FAILURE, llm, { timeoutMs: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timeout/i);
  });
});
