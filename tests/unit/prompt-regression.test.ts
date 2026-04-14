import { describe, it, expect } from "vitest";
import {
  evaluateAssertion,
  runAssertions,
  generateReport,
  getCoreTestSuite,
} from "../../src/testing/prompt-regression.js";

describe("Prompt Regression Testing", () => {
  describe("evaluateAssertion", () => {
    it("contains: passes when text found", () => {
      const result = evaluateAssertion(
        { type: "contains", value: "hello" },
        "say hello world", 100, [],
      );
      expect(result.passed).toBe(true);
    });

    it("contains: fails when text not found", () => {
      const result = evaluateAssertion(
        { type: "contains", value: "xyz" },
        "hello world", 100, [],
      );
      expect(result.passed).toBe(false);
    });

    it("not-contains: passes when text absent", () => {
      const result = evaluateAssertion(
        { type: "not-contains", value: "error" },
        "all good", 100, [],
      );
      expect(result.passed).toBe(true);
    });

    it("matches-regex: validates regex patterns", () => {
      const result = evaluateAssertion(
        { type: "matches-regex", value: "\\d{3}" },
        "code 404 error", 100, [],
      );
      expect(result.passed).toBe(true);
    });

    it("min-length: checks minimum", () => {
      const pass = evaluateAssertion({ type: "min-length", value: 5 }, "hello world", 100, []);
      const fail = evaluateAssertion({ type: "min-length", value: 100 }, "short", 100, []);
      expect(pass.passed).toBe(true);
      expect(fail.passed).toBe(false);
    });

    it("no-error: detects error keyword", () => {
      const clean = evaluateAssertion({ type: "no-error", value: "" }, "all good", 100, []);
      const dirty = evaluateAssertion({ type: "no-error", value: "" }, "got an error here", 100, []);
      expect(clean.passed).toBe(true);
      expect(dirty.passed).toBe(false);
    });

    it("tool-called: checks tool invocation", () => {
      const called = evaluateAssertion({ type: "tool-called", value: "Read" }, "", 100, ["Read", "Bash"]);
      const notCalled = evaluateAssertion({ type: "tool-called", value: "Write" }, "", 100, ["Read"]);
      expect(called.passed).toBe(true);
      expect(notCalled.passed).toBe(false);
    });

    it("latency-under-ms: checks timing", () => {
      const fast = evaluateAssertion({ type: "latency-under-ms", value: 500 }, "", 200, []);
      const slow = evaluateAssertion({ type: "latency-under-ms", value: 100 }, "", 500, []);
      expect(fast.passed).toBe(true);
      expect(slow.passed).toBe(false);
    });
  });

  describe("runAssertions", () => {
    it("runs all assertions and determines pass/fail", () => {
      const result = runAssertions(
        {
          id: "test-1",
          description: "Test",
          prompt: "Hello",
          assertions: [
            { type: "contains", value: "hello" },
            { type: "min-length", value: 3 },
          ],
        },
        "hello world",
        100,
      );
      expect(result.passed).toBe(true);
      expect(result.assertions.length).toBe(2);
    });

    it("fails if any assertion fails", () => {
      const result = runAssertions(
        {
          id: "test-2",
          description: "Test",
          prompt: "Hello",
          assertions: [
            { type: "contains", value: "hello" },
            { type: "contains", value: "nonexistent" },
          ],
        },
        "hello world",
        100,
      );
      expect(result.passed).toBe(false);
    });
  });

  describe("generateReport", () => {
    it("generates correct summary", () => {
      const report = generateReport(
        [
          { testId: "1", passed: true, assertions: [], output: "ok", latencyMs: 100, model: "auto", provider: "auto" },
          { testId: "2", passed: false, assertions: [], output: "fail", latencyMs: 200, model: "auto", provider: "auto" },
        ],
        300,
      );
      expect(report.totalTests).toBe(2);
      expect(report.passed).toBe(1);
      expect(report.failed).toBe(1);
    });
  });

  describe("getCoreTestSuite", () => {
    it("returns non-empty test suite", () => {
      const suite = getCoreTestSuite();
      expect(suite.length).toBeGreaterThan(0);
      expect(suite[0]?.assertions.length).toBeGreaterThan(0);
    });
  });
});
