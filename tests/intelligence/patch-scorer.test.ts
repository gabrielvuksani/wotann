import { describe, it, expect } from "vitest";
import {
  parseVitestJson,
  parseGeneric,
  rankPatches,
  type PatchDescriptor,
  type PatchScorerOptions,
  type PatchScore,
} from "../../src/intelligence/patch-scorer.js";

describe("parseVitestJson", () => {
  it("extracts passed / failed / skipped counts from vitest envelope", () => {
    const stdout = JSON.stringify({
      testResults: [
        {
          name: "foo.test.ts",
          assertionResults: [
            { fullName: "foo > adds", status: "passed" },
            { fullName: "foo > regress", status: "failed" },
            { fullName: "foo > todo", status: "skipped" },
          ],
        },
      ],
    });
    const result = parseVitestJson(stdout, "");
    expect(result.parseSucceeded).toBe(true);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.passingTestIds.has("foo.test.ts::foo > adds")).toBe(true);
    expect(result.failingTestIds.has("foo.test.ts::foo > regress")).toBe(true);
  });

  it("returns parseSucceeded=false on garbage input", () => {
    const result = parseVitestJson("not json at all", "");
    expect(result.parseSucceeded).toBe(false);
  });

  it("tolerates log-lines before + after the JSON envelope", () => {
    const stdout = `
> wotann@0.1.0 test
> vitest run --reporter=json

${JSON.stringify({
  testResults: [
    {
      name: "a.test.ts",
      assertionResults: [{ fullName: "a", status: "passed" }],
    },
  ],
})}

Done.
`;
    const result = parseVitestJson(stdout, "");
    expect(result.parseSucceeded).toBe(true);
    expect(result.passed).toBe(1);
  });

  it("falls back to title when fullName missing", () => {
    const stdout = JSON.stringify({
      testResults: [
        {
          name: "b.test.ts",
          assertionResults: [{ title: "onlyTitle", status: "passed" }],
        },
      ],
    });
    const result = parseVitestJson(stdout, "");
    expect(result.passed).toBe(1);
    expect(result.passingTestIds.has("b.test.ts::onlyTitle")).toBe(true);
  });

  it("handles missing testResults field", () => {
    const result = parseVitestJson(JSON.stringify({ foo: "bar" }), "");
    expect(result.parseSucceeded).toBe(false);
    expect(result.passed).toBe(0);
  });
});

describe("parseGeneric", () => {
  it("counts ✓ as passed", () => {
    const stdout = " ✓ test foo\n ✓ test bar";
    const result = parseGeneric(stdout, "");
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.parseSucceeded).toBe(true);
  });

  it("counts ✗ as failed", () => {
    const stdout = " ✓ passing test\n ✗ failing test";
    const result = parseGeneric(stdout, "");
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("handles × (U+00D7) as failure marker", () => {
    const stdout = " × broken test";
    const result = parseGeneric(stdout, "");
    expect(result.failed).toBe(1);
    expect(result.failingTestIds.has("broken test")).toBe(true);
  });

  it("counts skipped markers", () => {
    const stdout = " ↓ skipped";
    const result = parseGeneric(stdout, "");
    expect(result.skipped).toBe(1);
  });

  it("reads stderr as fallback when stdout is empty", () => {
    const result = parseGeneric("", " ✓ from stderr");
    expect(result.passed).toBe(1);
    expect(result.passingTestIds.has("from stderr")).toBe(true);
  });

  it("returns parseSucceeded=false on empty input", () => {
    const result = parseGeneric("", "");
    expect(result.parseSucceeded).toBe(false);
  });
});

describe("rankPatches (with stub parser)", () => {
  it("orders patches by compositeScore descending", async () => {
    // All three "patches" are placeholder - we stub the parser so
    // we don't actually need to write files or run tests.
    const patches: PatchDescriptor[] = [
      { files: [{ path: "p1.txt", newContent: "A" }], label: "p1" },
      { files: [{ path: "p2.txt", newContent: "B" }], label: "p2" },
      { files: [{ path: "p3.txt", newContent: "C" }], label: "p3" },
    ];
    // A parser that returns a different score per call — we piggyback
    // on the call-count via a mutable closure.
    let callCount = 0;
    const scenarios = [
      // BEFORE (call 0,2,4): same baseline for all 3 patches
      { passed: 10, failed: 5, passing: ["t1", "t2"], failing: ["t3", "t4"] },
      // p1 AFTER: fixes t3, doesn't break anything → composite +1
      { passed: 11, failed: 4, passing: ["t1", "t2", "t3"], failing: ["t4"] },
      // (BEFORE again for p2)
      { passed: 10, failed: 5, passing: ["t1", "t2"], failing: ["t3", "t4"] },
      // p2 AFTER: fixes t3 AND t4 → composite +2
      { passed: 12, failed: 3, passing: ["t1", "t2", "t3", "t4"], failing: [] },
      // (BEFORE again for p3)
      { passed: 10, failed: 5, passing: ["t1", "t2"], failing: ["t3", "t4"] },
      // p3 AFTER: fixes t3 but BREAKS t1 → composite +1 - 2 = -1
      { passed: 10, failed: 5, passing: ["t2", "t3"], failing: ["t1", "t4"] },
    ];
    const parser = (_stdout: string, _stderr: string) => {
      const scenario = scenarios[callCount++] ?? scenarios[0]!;
      return {
        passed: scenario.passed,
        failed: scenario.failed,
        skipped: 0,
        passingTestIds: new Set(scenario.passing),
        failingTestIds: new Set(scenario.failing),
        parseSucceeded: true,
      };
    };
    // Use a test command that always exits with the same canned stdout.
    // `node -e "console.log('x')"` runs on every platform with node
    // installed — the parser ignores the output and uses the scenario table.
    const testCommand = ["node", "-e", "process.stdout.write('canned')"];
    const opts: PatchScorerOptions = {
      workDir: process.cwd(),
      testCommand,
      timeoutMs: 30_000,
      parser,
      useShadowGit: false, // avoid shadow-git setup in unit test
    };

    const ranked = await rankPatches(patches, opts);

    expect(ranked).toHaveLength(3);
    const first = ranked[0] as { index: number; score: PatchScore };
    const second = ranked[1] as { index: number; score: PatchScore };
    const third = ranked[2] as { index: number; score: PatchScore };
    expect(first.index).toBe(1); // p2 best (composite +2)
    expect(first.score.compositeScore).toBe(2);
    expect(second.index).toBe(0); // p1 next (composite +1)
    expect(third.index).toBe(2); // p3 worst (composite -1, regression)
    expect(third.score.newlyFailing).toEqual(["t1"]);
  }, 60_000);

  it("ties broken by smaller diff size", async () => {
    const patches: PatchDescriptor[] = [
      { files: [{ path: "big.txt", newContent: "x".repeat(1000) }] },
      { files: [{ path: "small.txt", newContent: "y" }] },
    ];
    // Same score for both
    const parser = () => ({
      passed: 1,
      failed: 0,
      skipped: 0,
      passingTestIds: new Set<string>(["t"]),
      failingTestIds: new Set<string>(),
      parseSucceeded: true,
    });
    const ranked = await rankPatches(patches, {
      workDir: process.cwd(),
      testCommand: ["node", "-e", "process.stdout.write('x')"],
      parser,
      useShadowGit: false,
    });
    expect(ranked[0]?.index).toBe(1); // smaller diff wins the tie
  }, 60_000);
});
