import { describe, expect, it } from "vitest";
import {
  parseTestCounts,
  validateRepair,
} from "../../../src/modes/agentless/validate.js";
import type { ShadowGitLike } from "../../../src/modes/agentless/validate.js";

class FakeShadowGit implements ShadowGitLike {
  readonly events: string[] = [];
  shouldFailCreate = false;
  shouldFailApply = false;
  shouldFailDiscard = false;

  async createBranch(name: string): Promise<void> {
    if (this.shouldFailCreate) throw new Error("create-fail");
    this.events.push(`create:${name}`);
  }
  async applyDiff(diff: string): Promise<void> {
    if (this.shouldFailApply) throw new Error("apply-fail");
    this.events.push(`apply:${diff.length}`);
  }
  async discardBranch(name: string): Promise<void> {
    if (this.shouldFailDiscard) throw new Error("discard-fail");
    this.events.push(`discard:${name}`);
  }
}

describe("parseTestCounts", () => {
  it("parses vitest summary", () => {
    const out = "Tests:       4 passed, 1 failed, 5 total";
    expect(parseTestCounts(out)).toEqual({ total: 5, passed: 4, failed: 1 });
  });

  it("derives total from sum if missing", () => {
    expect(parseTestCounts("3 passed, 2 failed").total).toBe(5);
  });

  it("returns zeros on no recognizable summary", () => {
    expect(parseTestCounts("no tests run")).toEqual({ total: 0, passed: 0, failed: 0 });
  });
});

describe("validateRepair", () => {
  const sampleDiff = "diff --git a/x b/x\n";

  it("rejects empty diff with applyError", async () => {
    const r = await validateRepair("", {});
    expect(r.passed).toBe(false);
    expect(r.applyError).toContain("empty diff");
  });

  it("rejects when no shadowGit injected", async () => {
    const r = await validateRepair(sampleDiff, {});
    expect(r.passed).toBe(false);
    expect(r.applyError).toContain("shadowGit");
  });

  it("returns passed=true when tests green + cleans up branch", async () => {
    const sg = new FakeShadowGit();
    const r = await validateRepair(sampleDiff, {
      shadowGit: sg,
      runTests: async () => ({
        exitCode: 0,
        stdout: "Tests: 5 passed, 0 failed, 5 total",
        stderr: "",
      }),
      randomSuffix: () => "abc",
    });
    expect(r.passed).toBe(true);
    expect(r.testResult?.passed).toBe(5);
    expect(r.branchUsed).toContain("wotann/agentless-");
    expect(sg.events.some((e) => e.startsWith("create:"))).toBe(true);
    expect(sg.events.some((e) => e.startsWith("discard:"))).toBe(true);
    expect(sg.events.some((e) => e.startsWith("apply:"))).toBe(true);
  });

  it("returns passed=false when tests red — still discards branch", async () => {
    const sg = new FakeShadowGit();
    const r = await validateRepair(sampleDiff, {
      shadowGit: sg,
      runTests: async () => ({
        exitCode: 1,
        stdout: "Tests: 3 passed, 2 failed, 5 total",
        stderr: "",
      }),
    });
    expect(r.passed).toBe(false);
    expect(r.testResult?.failed).toBe(2);
    expect(sg.events.some((e) => e.startsWith("discard:"))).toBe(true);
  });

  it("returns applyError when applyDiff fails — and still cleans up", async () => {
    const sg = new FakeShadowGit();
    sg.shouldFailApply = true;
    const r = await validateRepair(sampleDiff, {
      shadowGit: sg,
      runTests: async () => ({ exitCode: 0, stdout: "5 passed", stderr: "" }),
    });
    expect(r.passed).toBe(false);
    expect(r.applyError).toContain("apply-fail");
    expect(sg.events.some((e) => e.startsWith("discard:"))).toBe(true);
  });

  it("returns applyError when createBranch fails — does NOT call discard", async () => {
    const sg = new FakeShadowGit();
    sg.shouldFailCreate = true;
    const r = await validateRepair(sampleDiff, { shadowGit: sg });
    expect(r.passed).toBe(false);
    expect(r.applyError).toContain("create-fail");
    expect(sg.events.some((e) => e.startsWith("discard:"))).toBe(false);
  });

  it("masks discard failure (doesn't override result)", async () => {
    const sg = new FakeShadowGit();
    sg.shouldFailDiscard = true;
    const r = await validateRepair(sampleDiff, {
      shadowGit: sg,
      runTests: async () => ({ exitCode: 0, stdout: "1 passed", stderr: "" }),
    });
    expect(r.passed).toBe(true);
  });

  it("captures runner failure as applyError", async () => {
    const sg = new FakeShadowGit();
    const r = await validateRepair(sampleDiff, {
      shadowGit: sg,
      runTests: async () => {
        throw new Error("npm crashed");
      },
    });
    expect(r.passed).toBe(false);
    expect(r.applyError).toContain("npm crashed");
  });
});
