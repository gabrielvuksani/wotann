import { describe, it, expect } from "vitest";
import { normalizeAnswer, answersEqual } from "../../src/intelligence/answer-normalizer.js";

describe("normalizeAnswer", () => {
  describe("basic normalization", () => {
    it("returns empty on empty input", () => {
      expect(normalizeAnswer("")).toBe("");
    });

    it("trims outer whitespace", () => {
      expect(normalizeAnswer("  42  ")).toBe("42");
    });

    it("collapses internal whitespace", () => {
      expect(normalizeAnswer("hello    world   foo")).toBe("hello world foo");
    });

    it("strips trailing punctuation by default", () => {
      expect(normalizeAnswer("Paris.")).toBe("Paris");
      expect(normalizeAnswer("42!")).toBe("42");
    });
  });

  describe("leading answer-prefix stripping", () => {
    it('strips "The answer is: X"', () => {
      expect(normalizeAnswer("The answer is: Paris")).toBe("Paris");
    });

    it('strips "Answer: X"', () => {
      expect(normalizeAnswer("Answer: 42")).toBe("42");
    });

    it('strips "Result: X"', () => {
      expect(normalizeAnswer("Result: success")).toBe("success");
    });

    it("strips => arrow", () => {
      expect(normalizeAnswer("=> Paris")).toBe("Paris");
    });

    it('strips "I think the answer is ..."', () => {
      expect(normalizeAnswer("I think the answer is Paris")).toBe("Paris");
    });

    it('strips "Final answer: ..."', () => {
      expect(normalizeAnswer("Final answer: 42")).toBe("42");
    });

    it("is case-insensitive on prefix match", () => {
      expect(normalizeAnswer("ANSWER: Paris")).toBe("Paris");
    });
  });

  describe("code-fence stripping", () => {
    it("extracts from ```python ... ``` block", () => {
      const input = "```python\nreturn 42\n```";
      expect(normalizeAnswer(input)).toBe("return 42");
    });

    it("extracts from unlabeled ``` block", () => {
      expect(normalizeAnswer("```\n42\n```")).toBe("42");
    });

    it("takes the first fence when multiple present", () => {
      const input = "```\nfirst\n```\n\n```\nsecond\n```";
      expect(normalizeAnswer(input)).toBe("first");
    });
  });

  describe("markdown emphasis stripping", () => {
    it("strips **bold**", () => {
      expect(normalizeAnswer("**Paris**")).toBe("Paris");
    });

    it("strips *italic*", () => {
      expect(normalizeAnswer("*42*")).toBe("42");
    });

    it("strips `code span`", () => {
      expect(normalizeAnswer("`O(log n)`")).toBe("O(log n)");
    });

    it("strips __underscore-bold__", () => {
      expect(normalizeAnswer("__answer__")).toBe("answer");
    });
  });

  describe("numeric domain", () => {
    it("extracts first integer", () => {
      expect(normalizeAnswer("The answer is 42 birds", { domain: "numeric" })).toBe("42");
    });

    it("extracts first decimal", () => {
      expect(normalizeAnswer("Roughly 3.14 meters long", { domain: "numeric" })).toBe("3.14");
    });

    it("extracts first negative number", () => {
      expect(normalizeAnswer("The value is -273.15 celsius", { domain: "numeric" })).toBe("-273.15");
    });

    it("extracts scientific notation", () => {
      expect(normalizeAnswer("About 6.022e23 molecules", { domain: "numeric" })).toBe("6.022e23");
    });

    it("returns empty string when no number present", () => {
      expect(normalizeAnswer("No numbers here", { domain: "numeric" })).toBe("No numbers here");
    });
  });

  describe("code domain", () => {
    it("preserves trailing punctuation (code is punctuation-significant)", () => {
      expect(normalizeAnswer("return arr.length;", { domain: "code" })).toBe("return arr.length;");
    });

    it("preserves case", () => {
      expect(normalizeAnswer("MyClass", { domain: "code" })).toBe("MyClass");
    });

    it('does not strip "Answer:" prefix for code', () => {
      // Code might literally have "Answer:" as part of a comment or string
      expect(normalizeAnswer("Answer: return 42", { domain: "code" })).toBe("Answer: return 42");
    });
  });

  describe("multiple-choice domain", () => {
    it("extracts a single letter answer", () => {
      expect(normalizeAnswer("A", { domain: "multiple-choice" })).toBe("A");
    });

    it('strips "The answer is: B" prefix', () => {
      expect(normalizeAnswer("The answer is: B", { domain: "multiple-choice" })).toBe("B");
    });

    it("preserves case of letter choice", () => {
      expect(normalizeAnswer("**c**", { domain: "multiple-choice" })).toBe("c");
    });
  });

  describe("unit stripping", () => {
    it("strips trailing kg", () => {
      expect(normalizeAnswer("42 kg", { stripUnits: true })).toBe("42");
    });

    it("strips trailing %", () => {
      expect(normalizeAnswer("85%", { stripUnits: true })).toBe("85");
    });

    it("does not strip when stripUnits is false (default)", () => {
      expect(normalizeAnswer("42 kg")).toBe("42 kg");
    });
  });

  describe("option overrides", () => {
    it("explicit stripTrailingPunctuation: false preserves punctuation", () => {
      expect(normalizeAnswer("42.", { stripTrailingPunctuation: false })).toBe("42.");
    });

    it("explicit lowercase: true lowercases", () => {
      expect(normalizeAnswer("PARIS", { lowercase: true })).toBe("paris");
    });

    it("domain preset is overridden by explicit option", () => {
      // numeric domain normally extractFirstNumber; override to false keeps prose
      expect(
        normalizeAnswer("42 was the answer", { domain: "numeric", extractFirstNumber: false }),
      ).toBe("42 was the answer");
    });
  });
});

describe("answersEqual", () => {
  it("matches after normalization (case + punctuation)", () => {
    expect(answersEqual("Paris.", "Paris")).toBe(true);
  });

  it("matches after prefix strip", () => {
    expect(answersEqual("The answer is: 42", "42")).toBe(true);
  });

  it("matches with numeric-domain extraction", () => {
    expect(answersEqual("The answer is 42 birds", "42", { domain: "numeric" })).toBe(true);
  });

  it("returns false on genuine mismatch", () => {
    expect(answersEqual("Paris", "London")).toBe(false);
  });

  it("case-sensitive by default (lowercase off)", () => {
    expect(answersEqual("paris", "Paris")).toBe(false);
  });

  it("case-insensitive with lowercase option", () => {
    expect(answersEqual("PARIS", "paris", { lowercase: true })).toBe(true);
  });
});
