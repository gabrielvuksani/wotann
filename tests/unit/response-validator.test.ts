import { describe, it, expect } from "vitest";
import { ResponseValidator, type ValidationContext } from "../../src/intelligence/response-validator.js";

describe("ResponseValidator", () => {
  describe("validate", () => {
    it("returns valid for a clean response", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        "Here is the complete implementation with proper error handling and type safety.",
        "Implement the feature",
      );

      expect(result.valid).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result.completeness).toBeDefined();
      expect(result.syntaxChecks).toBeDefined();
      expect(result.consistencyCheck).toBeDefined();
      expect(result.hallucinationCheck).toBeDefined();
    });

    it("flags TODO markers as issues", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        "Implementation:\nconst auth = new Auth();\n// TODO: add error handling",
        "Implement the auth module",
      );

      expect(result.issues.some((i) => i.type === "incomplete" || i.type === "todo-marker")).toBe(true);
    });

    it("flags stub implementations", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        'function login() { throw new Error("Not implemented") }',
        "Implement login",
      );

      expect(result.issues.some((i) => i.type === "incomplete")).toBe(true);
    });

    it("detects syntax errors in code blocks", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        '```typescript\nfunction hello() {\n  return "world";\n```',
        "Write a function",
      );

      // Missing closing brace should be detected
      expect(result.syntaxChecks.length).toBeGreaterThan(0);
      expect(result.syntaxChecks.some((c) => !c.valid)).toBe(true);
    });

    it("validates well-formed code blocks", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        '```typescript\nfunction hello() {\n  return "world";\n}\n```',
        "Write a function",
      );

      expect(result.syntaxChecks.length).toBeGreaterThan(0);
      expect(result.syntaxChecks.every((c) => c.valid)).toBe(true);
    });

    it("flags any-type usage in strict mode", () => {
      const validator = new ResponseValidator();
      const context: ValidationContext = {
        previousResponses: [],
        availableContext: "",
        strictTypes: true,
      };
      const result = validator.validate(
        "const x: any = getValue()",
        "Implement the feature",
        context,
      );

      expect(result.issues.some((i) => i.type === "any-type")).toBe(true);
    });

    it("does not flag any-type when strict mode is off", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        "const x: any = getValue()",
        "Implement the feature",
      );

      expect(result.issues.some((i) => i.type === "any-type")).toBe(false);
    });

    it("flags async code without error handling", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        "async function fetchData() { const data = await api.get('/users'); return data; }",
        "Implement data fetching",
      );

      expect(result.issues.some((i) => i.type === "missing-error-handling")).toBe(true);
    });

    it("does not flag async code with try/catch", () => {
      const validator = new ResponseValidator();
      const result = validator.validate(
        "async function fetchData() { try { const data = await api.get('/users'); return data; } catch (err) { throw err; } }",
        "Implement data fetching",
      );

      expect(result.issues.some((i) => i.type === "missing-error-handling")).toBe(false);
    });
  });

  describe("checkCompleteness", () => {
    it("returns complete for a thorough response", () => {
      const validator = new ResponseValidator();
      const result = validator.checkCompleteness(
        "Here is the complete implementation with proper error handling, type safety, and comprehensive tests.",
        "implementation",
      );

      expect(result.isComplete).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it("flags very short responses", () => {
      const validator = new ResponseValidator();
      const result = validator.checkCompleteness("Done.", "implementation");

      expect(result.isComplete).toBe(false);
      expect(result.missingAspects.some((a) => a.includes("short"))).toBe(true);
      expect(result.score).toBeLessThan(80);
    });

    it("flags TODO markers as incomplete", () => {
      const validator = new ResponseValidator();
      const result = validator.checkCompleteness(
        "Here is the implementation:\nfunction login() { /* TODO: implement */ }",
        "implementation",
      );

      expect(result.isComplete).toBe(false);
      expect(result.missingAspects.some((a) => a.includes("TODO"))).toBe(true);
    });

    it("flags bug-fix without verification mention", () => {
      const validator = new ResponseValidator();
      const result = validator.checkCompleteness(
        "Changed the variable from let to const in the auth module.",
        "bug-fix",
      );

      expect(result.isComplete).toBe(false);
      expect(result.missingAspects.some((a) => a.includes("verification"))).toBe(true);
    });

    it("accepts bug-fix that mentions testing", () => {
      const validator = new ResponseValidator();
      const result = validator.checkCompleteness(
        "Fixed the null reference error. Ran tests to verify the fix does not break anything.",
        "bug-fix",
      );

      expect(result.isComplete).toBe(true);
    });
  });

  describe("checkCodeSyntax", () => {
    it("validates balanced TypeScript code", () => {
      const validator = new ResponseValidator();
      const blocks = [{
        content: 'function hello() {\n  return "world";\n}',
        language: "typescript",
      }];
      const checks = validator.checkCodeSyntax(blocks);

      expect(checks).toHaveLength(1);
      expect(checks[0]!.valid).toBe(true);
    });

    it("detects unbalanced braces", () => {
      const validator = new ResponseValidator();
      const blocks = [{
        content: 'function hello() {\n  return "world";',
        language: "ts",
      }];
      const checks = validator.checkCodeSyntax(blocks);

      expect(checks).toHaveLength(1);
      expect(checks[0]!.valid).toBe(false);
      expect(checks[0]!.errors.some((e) => e.includes("brace"))).toBe(true);
    });

    it("validates JSON blocks", () => {
      const validator = new ResponseValidator();
      const validBlocks = [{
        content: '{"name": "test", "version": "1.0"}',
        language: "json",
      }];
      const invalidBlocks = [{
        content: '{name: "test"}',
        language: "json",
      }];

      expect(validator.checkCodeSyntax(validBlocks)[0]!.valid).toBe(true);
      expect(validator.checkCodeSyntax(invalidBlocks)[0]!.valid).toBe(false);
    });

    it("handles empty code blocks", () => {
      const validator = new ResponseValidator();
      const blocks = [{ content: "", language: "typescript" }];
      const checks = validator.checkCodeSyntax(blocks);

      expect(checks).toHaveLength(1);
      expect(checks[0]!.valid).toBe(true);
    });
  });

  describe("checkConsistency", () => {
    it("returns consistent when no previous responses", () => {
      const validator = new ResponseValidator();
      const result = validator.checkConsistency("New response", []);

      expect(result.isConsistent).toBe(true);
      expect(result.contradictions).toHaveLength(0);
    });

    it("detects file existence contradictions", () => {
      const validator = new ResponseValidator();
      const result = validator.checkConsistency(
        "I found the issue in reading config.ts which contains the bug",
        ["The file config.ts does not exist in this project"],
      );

      expect(result.isConsistent).toBe(false);
      expect(result.contradictions.length).toBeGreaterThan(0);
    });

    it("detects action contradictions", () => {
      const validator = new ResponseValidator();
      const result = validator.checkConsistency(
        "I already did the refactor",
        ["I will not perform the refactor as it is too risky"],
      );

      expect(result.isConsistent).toBe(false);
    });

    it("accepts consistent responses", () => {
      const validator = new ResponseValidator();
      const result = validator.checkConsistency(
        "Updated the auth module with the new provider",
        ["I will update the auth module with the new provider"],
      );

      expect(result.isConsistent).toBe(true);
    });
  });

  describe("detectHallucination", () => {
    it("returns no hallucination when context is empty", () => {
      const validator = new ResponseValidator();
      const result = validator.detectHallucination("Some response about /foo/bar.ts", "");

      expect(result.detected).toBe(false);
    });

    it("flags file paths not in context", () => {
      const validator = new ResponseValidator();
      const result = validator.detectHallucination(
        "The issue is in /src/auth/special-handler.ts which needs updating",
        "The project has /src/auth/login.ts and /src/auth/logout.ts",
      );

      expect(result.detected).toBe(true);
      expect(result.suspiciousReferences.some(
        (r) => r.reference.includes("special-handler"),
      )).toBe(true);
    });

    it("does not flag common system paths", () => {
      const validator = new ResponseValidator();
      const result = validator.detectHallucination(
        "Check /usr/local/bin/node for the installation",
        "The project uses Node.js",
      );

      expect(result.detected).toBe(false);
    });

    it("does not flag common API calls", () => {
      const validator = new ResponseValidator();
      const result = validator.detectHallucination(
        "Use JSON.parse(data) to parse the response",
        "The function processes API data",
      );

      expect(result.detected).toBe(false);
    });
  });

  describe("scoreResponse", () => {
    it("scores a thorough response higher than a minimal one", () => {
      const validator = new ResponseValidator();

      const thorough = validator.scoreResponse(
        "Here is the complete implementation with proper error handling, type safety, readonly patterns, and comprehensive test coverage. The function validates all inputs and returns structured errors.",
        "Implement the feature",
      );

      const minimal = validator.scoreResponse(
        "Done.",
        "Implement the feature",
      );

      expect(thorough.overall).toBeGreaterThan(minimal.overall);
    });

    it("returns breakdown scores", () => {
      const validator = new ResponseValidator();
      const score = validator.scoreResponse(
        "Implementation complete with const declarations and readonly types.",
        "Implement the feature",
      );

      expect(score.breakdown).toHaveProperty("completeness");
      expect(score.breakdown).toHaveProperty("correctness");
      expect(score.breakdown).toHaveProperty("quality");
    });

    it("deducts for any-type usage", () => {
      const validator = new ResponseValidator();

      const withAny = validator.scoreResponse(
        "const x: any = getValue(); const y: any = transform(x);",
        "Implement",
      );
      const withoutAny = validator.scoreResponse(
        "const x: string = getValue(); const y: number = transform(x);",
        "Implement",
      );

      expect(withoutAny.correctness).toBeGreaterThan(withAny.correctness);
    });

    it("rewards immutability patterns", () => {
      const validator = new ResponseValidator();

      const immutable = validator.scoreResponse(
        "const config: readonly string[] = Object.freeze(['a', 'b']); const result = config.map(x => x);",
        "Implement",
      );
      const mutable = validator.scoreResponse(
        "let items = ['a', 'b']; items.push('c'); items = items.filter(x => x);",
        "Implement",
      );

      expect(immutable.quality).toBeGreaterThanOrEqual(mutable.quality);
    });
  });
});
