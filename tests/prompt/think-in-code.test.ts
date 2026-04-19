import { describe, it, expect } from "vitest";
import {
  wrapWithThinkInCode,
  extractThinkingBlocks,
  stripThinkingBlocks,
  didThinkInCode,
  validateThinkingStructure,
} from "../../src/prompt/think-in-code.js";

describe("wrapWithThinkInCode", () => {
  it("prepends directive before base prompt", () => {
    const out = wrapWithThinkInCode("Base prompt here");
    expect(out.indexOf("pseudocode")).toBeLessThan(out.indexOf("Base prompt"));
  });

  it("uses python language when specified", () => {
    const out = wrapWithThinkInCode("base", { language: "python" });
    expect(out).toContain("python");
  });

  it("includes maxSteps in directive", () => {
    const out = wrapWithThinkInCode("base", { maxSteps: 5 });
    expect(out).toContain("5 steps");
  });

  it("includes answer tag instruction by default", () => {
    const out = wrapWithThinkInCode("base");
    expect(out).toContain("<answer>");
  });

  it("omits answer tag instruction when requireAnswerTag=false", () => {
    const out = wrapWithThinkInCode("base", { requireAnswerTag: false });
    expect(out).not.toContain("<answer>");
  });

  it("returns directive alone when base is empty", () => {
    const out = wrapWithThinkInCode("");
    expect(out).not.toContain("---");
  });
});

describe("extractThinkingBlocks", () => {
  it("extracts language + thinking + answer", () => {
    const response = `Some preamble.

\`\`\`python
def f():
    return 42
\`\`\`

<answer>42</answer>`;
    const extracted = extractThinkingBlocks(response);
    expect(extracted.language).toBe("python");
    expect(extracted.thinking).toContain("return 42");
    expect(extracted.answer).toBe("42");
  });

  it("returns null language when no fence", () => {
    const extracted = extractThinkingBlocks("just plain text");
    expect(extracted.language).toBeNull();
    expect(extracted.thinking).toBe("");
  });

  it("returns null answer when no tag", () => {
    const extracted = extractThinkingBlocks("```python\nx\n```");
    expect(extracted.answer).toBeNull();
  });

  it("language is null for unlabeled fence", () => {
    const extracted = extractThinkingBlocks("```\nx\n```");
    expect(extracted.language).toBeNull();
  });
});

describe("stripThinkingBlocks", () => {
  it("prefers answer tag content", () => {
    const response = `\`\`\`python\nthinking\n\`\`\`\n<answer>42</answer>`;
    expect(stripThinkingBlocks(response)).toBe("42");
  });

  it("strips fenced blocks when no answer tag", () => {
    const response = `Before\n\`\`\`\nthinking\n\`\`\`\nAfter`;
    expect(stripThinkingBlocks(response)).toContain("Before");
    expect(stripThinkingBlocks(response)).toContain("After");
    expect(stripThinkingBlocks(response)).not.toContain("thinking");
  });

  it("returns raw response when strip produces empty", () => {
    const response = `\`\`\`\nall thinking no answer\n\`\`\``;
    expect(stripThinkingBlocks(response)).toContain("thinking");
  });
});

describe("didThinkInCode", () => {
  it("true when fenced block present", () => {
    expect(didThinkInCode("```\nx\n```")).toBe(true);
    expect(didThinkInCode("```python\nx\n```")).toBe(true);
  });

  it("false when no fence", () => {
    expect(didThinkInCode("plain answer")).toBe(false);
  });
});

describe("validateThinkingStructure", () => {
  it("adherenceScore 1 when both block + answer present", () => {
    const response = `\`\`\`python\nstep_1: x\n\`\`\`\n<answer>y</answer>`;
    const v = validateThinkingStructure(response);
    expect(v.adherenceScore).toBe(1);
    expect(v.hasThinkingBlock).toBe(true);
    expect(v.hasAnswerTag).toBe(true);
  });

  it("adherenceScore 0.5 when only block present (answer required)", () => {
    const response = `\`\`\`python\nstep_1: x\n\`\`\``;
    const v = validateThinkingStructure(response);
    expect(v.adherenceScore).toBe(0.5);
    expect(v.hasThinkingBlock).toBe(true);
    expect(v.hasAnswerTag).toBe(false);
  });

  it("adherenceScore 1 when requireAnswerTag=false + block present", () => {
    const response = `\`\`\`python\nx\n\`\`\``;
    const v = validateThinkingStructure(response, { requireAnswerTag: false });
    expect(v.adherenceScore).toBe(1);
  });

  it("counts step lines", () => {
    const response = `\`\`\`\nstep_1: do x\nstep_2: do y\nstep 3: do z\n\`\`\`\n<answer>a</answer>`;
    const v = validateThinkingStructure(response);
    expect(v.thinkingStepCount).toBe(3);
  });

  it("adherenceScore 0 when neither present", () => {
    const v = validateThinkingStructure("plain text response");
    expect(v.adherenceScore).toBe(0);
  });
});
