import { describe, it, expect, vi } from "vitest";
import {
  chainOfVerification,
  parseQuestionList,
} from "../../src/intelligence/chain-of-verification.js";

describe("parseQuestionList", () => {
  it("extracts numbered questions", () => {
    const raw = `Verification questions:
1. Is X true?
2. Did Y happen?
3. Does Z exist?`;
    expect(parseQuestionList(raw)).toEqual([
      "Is X true?",
      "Did Y happen?",
      "Does Z exist?",
    ]);
  });

  it("handles bullet points", () => {
    const raw = `Questions:
- Is X?
- Is Y?`;
    expect(parseQuestionList(raw)).toEqual(["Is X?", "Is Y?"]);
  });

  it("skips non-questions", () => {
    const raw = `Q1 — just a statement
Is X?
Not a question`;
    const result = parseQuestionList(raw);
    expect(result).toContain("Is X?");
    expect(result).not.toContain("Not a question");
  });

  it("empty input", () => {
    expect(parseQuestionList("")).toEqual([]);
  });
});

describe("chainOfVerification", () => {
  it("runs the 4-step protocol", async () => {
    const calls: string[] = [];
    const llmQuery = async (prompt: string) => {
      calls.push(prompt);
      if (calls.length === 1) return "The answer is 42.";
      if (calls.length === 2) {
        return `Verification questions:
1. Is 42 correct?
2. Was the calculation shown?`;
      }
      if (prompt.startsWith("Answer this fact-check")) return "Yes.";
      return "Final: 42.";
    };
    const result = await chainOfVerification("q?", { llmQuery });
    expect(result.baselineAnswer).toBe("The answer is 42.");
    expect(result.verificationQuestions).toHaveLength(2);
    expect(result.verificationRounds).toHaveLength(2);
    expect(result.finalAnswer).toContain("42");
  });

  it("short-circuits when no verification questions generated", async () => {
    const llmQuery = async (prompt: string) => {
      if (prompt.includes("Verification")) return "(no questions)";
      return "baseline";
    };
    const result = await chainOfVerification("q?", { llmQuery });
    expect(result.verificationQuestions).toEqual([]);
    expect(result.finalAnswer).toBe("baseline");
  });

  it("caps at maxVerificationQuestions", async () => {
    let call = 0;
    const llmQuery = async () => {
      call++;
      if (call === 1) return "baseline";
      if (call === 2) {
        return `Verification questions:
1. q1?
2. q2?
3. q3?
4. q4?
5. q5?`;
      }
      return "verified";
    };
    const result = await chainOfVerification("q?", {
      llmQuery,
      maxVerificationQuestions: 2,
    });
    expect(result.verificationQuestions).toHaveLength(2);
  });

  it("revisionNeeded flag set when final differs from baseline", async () => {
    let call = 0;
    const llmQuery = async () => {
      call++;
      if (call === 1) return "old baseline";
      if (call === 2) return "Verification questions:\n1. Is baseline correct?";
      if (call === 3) return "No, should be X.";
      return "new revised answer";
    };
    const result = await chainOfVerification("q?", { llmQuery });
    expect(result.revisionNeeded).toBe(true);
  });

  it("revisionNeeded false when final matches baseline", async () => {
    let call = 0;
    const llmQuery = async () => {
      call++;
      if (call === 1) return "stable answer";
      if (call === 2) return "Verification questions:\n1. Q?";
      if (call === 3) return "Verified.";
      return "stable answer"; // no change
    };
    const result = await chainOfVerification("q?", { llmQuery });
    expect(result.revisionNeeded).toBe(false);
    expect(result.finalAnswer).toBe("stable answer");
  });
});
