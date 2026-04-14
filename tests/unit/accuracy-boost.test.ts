import { describe, it, expect } from "vitest";
import {
  AccuracyBooster,
  classifyTaskType,
  type AccuracyContext,
} from "../../src/intelligence/accuracy-boost.js";

const baseContext: AccuracyContext = {
  taskType: "code-generation",
  previousErrors: [],
  previousAttempts: 0,
  availableFiles: [],
  recentToolResults: [],
  language: "typescript",
};

describe("AccuracyBooster", () => {
  describe("boost", () => {
    it("returns all required fields in BoostedQuery", () => {
      const booster = new AccuracyBooster();
      const result = booster.boost("Implement the user authentication module", baseContext);

      expect(result.original).toBe("Implement the user authentication module");
      expect(result.boosted).toBeDefined();
      expect(result.techniques).toBeDefined();
      expect(result.decomposedSteps).toBeDefined();
      expect(result.confidencePrompt).toBeDefined();
      expect(result.verificationPlan).toBeDefined();
    });

    it("applies structured output enforcement for non-trivial prompts", () => {
      const booster = new AccuracyBooster();
      const result = booster.boost(
        "Implement the user authentication module with OAuth support",
        baseContext,
      );

      expect(result.techniques.some((t) => t.name === "structured-output")).toBe(true);
      expect(result.boosted).toContain("tool calls");
    });

    it("applies error-aware retry when previous errors exist", () => {
      const booster = new AccuracyBooster();
      const context: AccuracyContext = {
        ...baseContext,
        previousErrors: ["TypeError: Cannot read property 'id' of undefined"],
        previousAttempts: 1,
      };
      const result = booster.boost("Fix the authentication bug", context);

      expect(result.techniques.some((t) => t.name === "error-aware-retry")).toBe(true);
      expect(result.boosted).toContain("ERROR-AWARE RETRY");
      expect(result.boosted).toContain("TypeError");
    });

    it("escalates retry strategy after 3+ attempts", () => {
      const booster = new AccuracyBooster();
      const context: AccuracyContext = {
        ...baseContext,
        previousErrors: ["Error 1", "Error 2", "Error 3"],
        previousAttempts: 3,
      };
      const result = booster.boost("Fix the authentication bug", context);

      expect(result.boosted).toContain("completely different approach");
    });

    it("decomposes code-generation tasks into subtasks", () => {
      const booster = new AccuracyBooster();
      const result = booster.boost(
        "Implement the user authentication module with OAuth support",
        baseContext,
      );

      expect(result.decomposedSteps.length).toBeGreaterThan(1);
      expect(result.techniques.some((t) => t.name === "task-decomposition")).toBe(true);
    });

    it("applies self-reflection for code tasks", () => {
      const booster = new AccuracyBooster();
      const result = booster.boost(
        "Implement the user authentication module with proper error handling",
        baseContext,
      );

      expect(result.techniques.some((t) => t.name === "self-reflection")).toBe(true);
      expect(result.boosted).toContain("Before presenting your final answer");
    });

    it("does not apply self-reflection for documentation tasks", () => {
      const booster = new AccuracyBooster();
      const context: AccuracyContext = {
        ...baseContext,
        taskType: "documentation",
      };
      const result = booster.boost(
        "Write documentation for the authentication module explaining usage",
        context,
      );

      expect(result.techniques.some((t) => t.name === "self-reflection")).toBe(false);
    });

    it("includes example guidance for bug-fix tasks", () => {
      const booster = new AccuracyBooster();
      const context: AccuracyContext = {
        ...baseContext,
        taskType: "bug-fix",
      };
      const result = booster.boost(
        "Fix the race condition in the session manager causing duplicate entries",
        context,
      );

      expect(result.techniques.some((t) => t.name === "example-guided")).toBe(true);
      expect(result.boosted).toContain("REFERENCE EXAMPLES");
    });

    it("builds a verification plan with TypeScript checks", () => {
      const booster = new AccuracyBooster();
      const context: AccuracyContext = {
        ...baseContext,
        language: "typescript",
        testFramework: "vitest run",
      };
      const result = booster.boost("Implement the feature", context);

      expect(result.verificationPlan).toContain("Run `tsc --noEmit` to check types");
      expect(result.verificationPlan).toContain("Run `vitest run` to verify tests pass");
    });

    it("includes previous error verification in the plan", () => {
      const booster = new AccuracyBooster();
      const context: AccuracyContext = {
        ...baseContext,
        previousErrors: ["Some error"],
        previousAttempts: 1,
      };
      const result = booster.boost("Fix it", context);

      expect(result.verificationPlan.some((p) => p.includes("previous errors"))).toBe(true);
    });

    it("includes reference-check for refactor tasks", () => {
      const booster = new AccuracyBooster();
      const context: AccuracyContext = {
        ...baseContext,
        taskType: "refactor",
      };
      const result = booster.boost(
        "Refactor the authentication module to use the new provider pattern",
        context,
      );

      expect(result.verificationPlan.some((p) => p.includes("references"))).toBe(true);
    });
  });

  describe("enforceStructuredOutput", () => {
    it("passes through short prompts unchanged", () => {
      const booster = new AccuracyBooster();
      expect(booster.enforceStructuredOutput("Hi")).toBe("Hi");
    });

    it("prepends structured output instructions for longer prompts", () => {
      const booster = new AccuracyBooster();
      const result = booster.enforceStructuredOutput(
        "Implement the user authentication module with proper error handling",
      );
      expect(result).toContain("tool calls");
      expect(result).toContain("EXACT old text");
    });
  });

  describe("addSelfReflection", () => {
    it("passes through short prompts unchanged", () => {
      const booster = new AccuracyBooster();
      expect(booster.addSelfReflection("Hi")).toBe("Hi");
    });

    it("appends self-reflection instructions for longer prompts", () => {
      const booster = new AccuracyBooster();
      const result = booster.addSelfReflection(
        "Implement the user authentication module with proper error handling",
      );
      expect(result).toContain("Before presenting your final answer");
      expect(result).toContain("edge cases");
    });
  });

  describe("addConfidenceCalibration", () => {
    it("passes through short prompts unchanged", () => {
      const booster = new AccuracyBooster();
      expect(booster.addConfidenceCalibration("Hi")).toBe("Hi");
    });

    it("appends confidence calibration for longer prompts", () => {
      const booster = new AccuracyBooster();
      const result = booster.addConfidenceCalibration(
        "Implement the user authentication module with proper error handling",
      );
      expect(result).toContain("HIGH (>90%)");
      expect(result).toContain("MEDIUM (60-90%)");
      expect(result).toContain("LOW (<60%)");
    });
  });

  describe("decomposeTask", () => {
    it("returns single-step array for trivial prompts", () => {
      const booster = new AccuracyBooster();
      const steps = booster.decomposeTask("Hello", "general");
      expect(steps).toEqual(["Hello"]);
    });

    it("decomposes code-generation tasks into multiple steps", () => {
      const booster = new AccuracyBooster();
      const steps = booster.decomposeTask(
        "Implement the user authentication module",
        "code-generation",
      );
      expect(steps.length).toBeGreaterThan(1);
      expect(steps.some((s) => s.toLowerCase().includes("test"))).toBe(true);
    });

    it("decomposes bug-fix tasks with a reproduce step", () => {
      const booster = new AccuracyBooster();
      const steps = booster.decomposeTask("Fix the login bug", "bug-fix");
      expect(steps.some((s) => s.toLowerCase().includes("reproduce"))).toBe(true);
    });

    it("decomposes refactor tasks with a reference search step", () => {
      const booster = new AccuracyBooster();
      const steps = booster.decomposeTask("Refactor the auth module", "refactor");
      expect(steps.some((s) => s.toLowerCase().includes("reference"))).toBe(true);
    });

    it("auto-classifies task type when not provided", () => {
      const booster = new AccuracyBooster();
      const steps = booster.decomposeTask("Fix the crash in the login flow");
      expect(steps.length).toBeGreaterThan(1);
    });
  });

  describe("validateDiff", () => {
    it("returns valid for a balanced diff", () => {
      const booster = new AccuracyBooster();
      const result = booster.validateDiff(
        'function hello() {\n  return "world";\n}',
        "test.ts",
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects unbalanced braces", () => {
      const booster = new AccuracyBooster();
      const result = booster.validateDiff(
        'function hello() {\n  return "world";',
        "test.ts",
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("brace"))).toBe(true);
    });

    it("returns invalid for empty diff", () => {
      const booster = new AccuracyBooster();
      const result = booster.validateDiff("", "test.ts");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("empty"))).toBe(true);
    });

    it("skips brace-balance checks for non-code files", () => {
      const booster = new AccuracyBooster();
      const result = booster.validateDiff("just some text {", "readme.md");
      expect(result.valid).toBe(true);
    });

    it("ignores braces inside string literals", () => {
      const booster = new AccuracyBooster();
      const result = booster.validateDiff(
        'const x = "{";\nconst y = "}";\n',
        "test.ts",
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("scoreContextRelevance", () => {
    it("scores relevant items higher than irrelevant ones", () => {
      const booster = new AccuracyBooster();
      const items = [
        "Authentication module with OAuth support for user login",
        "Database migration script for adding new tables",
        "Weather API integration for forecast display",
      ];
      const scored = booster.scoreContextRelevance(
        items,
        "fix the authentication login bug",
      );

      expect(scored.length).toBe(3);
      expect(scored[0]!.content).toContain("Authentication");
      expect(scored[0]!.score).toBeGreaterThan(scored[2]!.score);
    });

    it("returns zero score for completely unrelated context", () => {
      const booster = new AccuracyBooster();
      const scored = booster.scoreContextRelevance(
        ["xyz abc def 123 456"],
        "authentication module",
      );
      expect(scored[0]!.score).toBe(0);
    });

    it("explains the relevance score", () => {
      const booster = new AccuracyBooster();
      const scored = booster.scoreContextRelevance(
        ["User authentication and login system"],
        "fix the authentication system",
      );
      expect(scored[0]!.reason).toBeDefined();
      expect(scored[0]!.reason.length).toBeGreaterThan(0);
    });
  });
});

describe("classifyTaskType", () => {
  it("classifies bug-fix prompts", () => {
    expect(classifyTaskType("Fix the broken login flow")).toBe("bug-fix");
    expect(classifyTaskType("There is an error in the auth module")).toBe("bug-fix");
    expect(classifyTaskType("The test is failing")).toBe("bug-fix");
  });

  it("classifies refactor prompts", () => {
    expect(classifyTaskType("Refactor the auth module")).toBe("refactor");
    expect(classifyTaskType("Rename the variable from x to count")).toBe("refactor");
    expect(classifyTaskType("Extract the utility functions")).toBe("refactor");
  });

  it("classifies test-writing prompts", () => {
    expect(classifyTaskType("Write tests for the auth module")).toBe("test-writing");
    expect(classifyTaskType("Add test coverage for the login flow")).toBe("test-writing");
  });

  it("classifies code-generation prompts", () => {
    expect(classifyTaskType("Create a new authentication module")).toBe("code-generation");
    expect(classifyTaskType("Implement the user registration flow")).toBe("code-generation");
    expect(classifyTaskType("Build a rate limiter")).toBe("code-generation");
  });

  it("classifies investigation prompts", () => {
    expect(classifyTaskType("Why is the server crashing?")).toBe("investigation");
    expect(classifyTaskType("Analyze the performance bottleneck")).toBe("investigation");
  });

  it("falls back to general for ambiguous prompts", () => {
    expect(classifyTaskType("Hello")).toBe("general");
    expect(classifyTaskType("What time is it")).toBe("general");
  });
});
