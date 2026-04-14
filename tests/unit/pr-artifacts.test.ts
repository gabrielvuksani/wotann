import { describe, it, expect } from "vitest";
import { PRArtifactGenerator } from "../../src/autopilot/pr-artifacts.js";
import type { FileChangeStat } from "../../src/autopilot/pr-artifacts.js";
import type { AutonomousResult, AutonomousCycleResult } from "../../src/orchestration/autonomous.js";

describe("PRArtifactGenerator", () => {
  const makeCycle = (overrides?: Partial<AutonomousCycleResult>): AutonomousCycleResult => ({
    cycle: 0,
    action: "fix tests",
    output: "Fixed all failing tests",
    verificationOutput: "All 42 tests passed",
    testsPass: true,
    typecheckPass: true,
    lintPass: true,
    durationMs: 5000,
    strategy: "direct",
    heartbeatOk: true,
    contextUsage: 0.3,
    tokensUsed: 1500,
    costUsd: 0.02,
    ...overrides,
  });

  const makeResult = (overrides?: Partial<AutonomousResult>): AutonomousResult => ({
    success: true,
    totalCycles: 3,
    totalDurationMs: 15000,
    totalCostUsd: 0.06,
    totalTokens: 4500,
    exitReason: "tests-pass",
    cycles: [makeCycle()],
    strategy: "direct",
    filesChanged: ["src/core/config.ts", "src/core/types.ts"],
    ...overrides,
  });

  describe("generatePR", () => {
    it("generates a complete PR template", () => {
      const generator = new PRArtifactGenerator();
      const result = makeResult();
      const pr = generator.generatePR("Add config validation", result);

      expect(pr.title).toBe("Add config validation");
      expect(pr.description).toContain("Add config validation");
      expect(pr.description).toContain("Cycles");
      expect(pr.description).toContain("Files Changed");
      expect(pr.fileChangeSummary).toContain("src/core/config.ts");
      expect(pr.testResultsSummary).toContain("PASS");
      expect(pr.commitMessage).toContain("feat: Add config validation");
      expect(pr.labels.length).toBeGreaterThan(0);
    });

    it("truncates long titles", () => {
      const generator = new PRArtifactGenerator({ maxTitleLength: 20 });
      const pr = generator.generatePR(
        "A very long task description that exceeds the limit",
        makeResult(),
      );
      expect(pr.title.length).toBeLessThanOrEqual(20);
      expect(pr.title).toContain("...");
    });

    it("uses custom commit type", () => {
      const generator = new PRArtifactGenerator({ conventionalCommitType: "fix" });
      const pr = generator.generatePR("Fix validation bug", makeResult());
      expect(pr.commitMessage).toMatch(/^fix:/);
    });

    it("includes scope in commit message", () => {
      const generator = new PRArtifactGenerator({ scope: "core" });
      const pr = generator.generatePR("Add validation", makeResult());
      expect(pr.commitMessage).toContain("feat(core):");
    });

    it("includes proof bundle reference", () => {
      const generator = new PRArtifactGenerator({ includeProofBundle: true });
      const pr = generator.generatePR("Task", makeResult());
      expect(pr.proofBundleRef).toContain("Proof Bundle");
      expect(pr.proofBundleRef).toContain("Success");
      expect(pr.description).toContain("Proof Bundle");
    });

    it("excludes proof bundle when disabled", () => {
      const generator = new PRArtifactGenerator({ includeProofBundle: false });
      const pr = generator.generatePR("Task", makeResult());
      expect(pr.proofBundleRef).toBeUndefined();
    });

    it("uses file stats when provided", () => {
      const generator = new PRArtifactGenerator();
      const fileStats: FileChangeStat[] = [
        { path: "src/new-file.ts", action: "added" },
        { path: "src/old-file.ts", action: "modified" },
        { path: "src/dead-file.ts", action: "deleted" },
      ];
      const pr = generator.generatePR("Refactor", makeResult(), fileStats);
      expect(pr.fileChangeSummary).toContain("+ src/new-file.ts");
      expect(pr.fileChangeSummary).toContain("~ src/old-file.ts");
      expect(pr.fileChangeSummary).toContain("- src/dead-file.ts");
      expect(pr.fileChangeSummary).toContain("3");
    });

    it("handles no files changed", () => {
      const generator = new PRArtifactGenerator();
      const result = makeResult({ filesChanged: [] });
      const pr = generator.generatePR("Docs update", result);
      expect(pr.fileChangeSummary).toContain("No files were modified");
    });

    it("shows test failure details", () => {
      const generator = new PRArtifactGenerator({ includeTestDetails: true });
      const failedCycle = makeCycle({
        testsPass: false,
        typecheckPass: true,
        lintPass: false,
        verificationOutput: "FAIL src/core/config.test.ts > should validate",
      });
      const result = makeResult({ cycles: [failedCycle], success: false, exitReason: "max-cycles" });
      const pr = generator.generatePR("Fix tests", result);
      expect(pr.testResultsSummary).toContain("FAIL");
      expect(pr.testResultsSummary).toContain("should validate");
    });
  });

  describe("generateCommitMessage", () => {
    it("generates a conventional commit message", () => {
      const generator = new PRArtifactGenerator();
      const msg = generator.generateCommitMessage("Add validation logic", makeResult());
      expect(msg).toMatch(/^feat: Add validation logic/);
      expect(msg).toContain("Autonomous execution");
      expect(msg).toContain("Files changed");
    });

    it("truncates long subjects", () => {
      const generator = new PRArtifactGenerator();
      const longTask = "A".repeat(100);
      const msg = generator.generateCommitMessage(longTask, makeResult());
      const firstLine = msg.split("\n")[0]!;
      expect(firstLine.length).toBeLessThanOrEqual(60); // feat: + 50 char subject
    });
  });

  describe("labels", () => {
    it("labels successful runs", () => {
      const generator = new PRArtifactGenerator();
      const pr = generator.generatePR("Task", makeResult({ success: true }));
      expect(pr.labels).toContain("autopilot:success");
      expect(pr.labels).toContain("type:feat");
    });

    it("labels failed runs for review", () => {
      const generator = new PRArtifactGenerator();
      const pr = generator.generatePR("Task", makeResult({ success: false }));
      expect(pr.labels).toContain("autopilot:needs-review");
    });

    it("labels complex runs", () => {
      const generator = new PRArtifactGenerator();
      const pr = generator.generatePR("Task", makeResult({ totalCycles: 15 }));
      expect(pr.labels).toContain("complexity:high");
    });
  });

  describe("cost summary", () => {
    it("includes cost when enabled", () => {
      const generator = new PRArtifactGenerator({ includeCostSummary: true });
      const pr = generator.generatePR("Task", makeResult({ totalCostUsd: 1.2345 }));
      expect(pr.description).toContain("$1.2345");
    });

    it("excludes cost section when disabled", () => {
      const generator = new PRArtifactGenerator({ includeCostSummary: false, includeProofBundle: false });
      const pr = generator.generatePR("Task", makeResult());
      expect(pr.description).not.toContain("## Cost");
    });
  });
});
