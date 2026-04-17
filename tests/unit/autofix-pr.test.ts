/**
 * C21 — /autofix-pr analyzer tests.
 */

import { describe, it, expect } from "vitest";
import { buildFixPlan, renderFixPlan } from "../../src/cli/autofix-pr.js";
import type { CIFailure } from "../../src/autopilot/ci-feedback.js";

function mkFailure(over: Partial<CIFailure> = {}): CIFailure {
  return {
    stepName: "test",
    errorType: "test",
    message: "Assertion failed",
    logExcerpt: "fake log",
    ...over,
  };
}

describe("buildFixPlan", () => {
  it("returns empty plan with confidence=1 for zero failures", () => {
    const plan = buildFixPlan([]);
    expect(plan.steps).toHaveLength(0);
    expect(plan.totalFailures).toBe(0);
    expect(plan.confidence).toBe(1);
  });

  it("orders typecheck before lint before test before build", () => {
    const plan = buildFixPlan([
      mkFailure({ errorType: "build" }),
      mkFailure({ errorType: "lint" }),
      mkFailure({ errorType: "typecheck" }),
      mkFailure({ errorType: "test" }),
    ]);
    expect(plan.steps.map((s) => s.category)).toEqual([
      "typecheck",
      "lint",
      "test",
      "build",
    ]);
  });

  it("groups failures by category and counts them", () => {
    const plan = buildFixPlan([
      mkFailure({ errorType: "test", failingFile: "a.test.ts" }),
      mkFailure({ errorType: "test", failingFile: "b.test.ts" }),
      mkFailure({ errorType: "lint", failingFile: "c.ts" }),
    ]);
    expect(plan.steps).toHaveLength(2);
    const testStep = plan.steps.find((s) => s.category === "test");
    expect(testStep?.summary).toContain("2 test failures");
    const lintStep = plan.steps.find((s) => s.category === "lint");
    expect(lintStep?.summary).toContain("1 lint failure");
  });

  it("deduplicates files across failures", () => {
    const plan = buildFixPlan([
      mkFailure({ errorType: "test", failingFile: "a.test.ts" }),
      mkFailure({ errorType: "test", failingFile: "a.test.ts" }),
      mkFailure({ errorType: "test", failingFile: "b.test.ts" }),
    ]);
    expect(plan.uniqueFiles).toEqual(["a.test.ts", "b.test.ts"]);
  });

  it("caps hints at 5 distinct messages", () => {
    const failures = Array.from({ length: 10 }, (_, i) =>
      mkFailure({ errorType: "test", message: `Distinct message ${i}` }),
    );
    const plan = buildFixPlan(failures);
    const step = plan.steps[0]!;
    expect(step.hints).toHaveLength(5);
  });

  it("dedupes identical hint messages", () => {
    const plan = buildFixPlan([
      mkFailure({ message: "same" }),
      mkFailure({ message: "same" }),
      mkFailure({ message: "different" }),
    ]);
    const step = plan.steps[0]!;
    expect(step.hints).toEqual(["same", "different"]);
  });

  it("confidence drops when failures lack file pointers", () => {
    const withFiles = buildFixPlan([
      mkFailure({ failingFile: "a.ts" }),
      mkFailure({ failingFile: "b.ts" }),
    ]);
    const noFiles = buildFixPlan([mkFailure({}), mkFailure({})]);
    expect(withFiles.confidence).toBeGreaterThan(noFiles.confidence);
  });

  it("confidence drops when many failures are `unknown`", () => {
    const clean = buildFixPlan([
      mkFailure({ errorType: "test", failingFile: "a.ts" }),
      mkFailure({ errorType: "lint", failingFile: "b.ts" }),
    ]);
    const murky = buildFixPlan([
      mkFailure({ errorType: "unknown", failingFile: "a.ts" }),
      mkFailure({ errorType: "unknown", failingFile: "b.ts" }),
    ]);
    expect(clean.confidence).toBeGreaterThan(murky.confidence);
  });
});

describe("renderFixPlan", () => {
  it('renders "CI is green" when no failures', () => {
    expect(renderFixPlan(buildFixPlan([]))).toMatch(/green/i);
  });

  it("renders numbered steps with category tags", () => {
    const plan = buildFixPlan([
      mkFailure({ errorType: "typecheck", failingFile: "src/foo.ts", message: "TS2322" }),
      mkFailure({ errorType: "test", failingFile: "tests/foo.test.ts", message: "expected 1 to be 2" }),
    ]);
    const rendered = renderFixPlan(plan);
    expect(rendered).toMatch(/# Autofix plan/);
    expect(rendered).toMatch(/## 1\. \[typecheck\]/);
    expect(rendered).toMatch(/## 2\. \[test\]/);
    expect(rendered).toContain("src/foo.ts");
    expect(rendered).toContain("TS2322");
  });

  it("truncates file lists at 8 entries with overflow marker", () => {
    const failures = Array.from({ length: 12 }, (_, i) =>
      mkFailure({ errorType: "lint", failingFile: `file${i}.ts` }),
    );
    const rendered = renderFixPlan(buildFixPlan(failures));
    expect(rendered).toMatch(/plus 4 more/);
  });
});
