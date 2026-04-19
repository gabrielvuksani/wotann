import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { voteOnPatches, summariseVote } from "../../src/intelligence/multi-patch-voter.js";
import type { PatchDescriptor } from "../../src/intelligence/patch-scorer.js";
import * as patchScorerModule from "../../src/intelligence/patch-scorer.js";
import type { PatchScore } from "../../src/intelligence/patch-scorer.js";

function fakeScore(overrides: Partial<PatchScore> & {
  composite: number;
  passing: string[];
  failing: string[];
  newlyPassing?: string[];
  newlyFailing?: string[];
}): PatchScore {
  const { composite, passing, failing, newlyPassing = [], newlyFailing = [], ...rest } = overrides;
  return {
    passDelta: 0,
    failDelta: 0,
    newlyPassing,
    newlyFailing,
    compositeScore: composite,
    before: {
      passed: 0,
      failed: 0,
      skipped: 0,
      passingTestIds: new Set(),
      failingTestIds: new Set(),
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
      parseSucceeded: true,
    },
    after: {
      passed: passing.length,
      failed: failing.length,
      skipped: 0,
      passingTestIds: new Set(passing),
      failingTestIds: new Set(failing),
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
      parseSucceeded: true,
    },
    patchApplied: true,
    restored: true,
    ...rest,
  };
}

describe("voteOnPatches", () => {
  let scorePatchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    scorePatchSpy = vi.spyOn(patchScorerModule, "scorePatch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOpts = {
    workDir: process.cwd(),
    testCommand: ["node", "-e", "0"],
    useShadowGit: false,
  };

  it("returns abstain on empty patch list", async () => {
    const result = await voteOnPatches([], defaultOpts);
    expect(result.abstained).toBe(true);
    expect(result.winnerIndex).toBeNull();
  });

  it("picks highest composite score", async () => {
    scorePatchSpy
      .mockResolvedValueOnce(fakeScore({ composite: 1, passing: ["a"], failing: [] }))
      .mockResolvedValueOnce(fakeScore({ composite: 3, passing: ["a", "b", "c"], failing: [] }))
      .mockResolvedValueOnce(fakeScore({ composite: 2, passing: ["a", "b"], failing: [] }));

    const patches: PatchDescriptor[] = [
      { files: [{ path: "p1.ts", newContent: "x" }] },
      { files: [{ path: "p2.ts", newContent: "x" }] },
      { files: [{ path: "p3.ts", newContent: "x" }] },
    ];

    const result = await voteOnPatches(patches, defaultOpts);
    expect(result.winnerIndex).toBe(1);
    expect(result.abstained).toBe(false);
    expect(result.reason).toContain("compositeScore=3");
  });

  it("abstains when all patches regress below minCompositeScore", async () => {
    scorePatchSpy
      .mockResolvedValueOnce(fakeScore({ composite: -2, passing: [], failing: ["t1"] }))
      .mockResolvedValueOnce(fakeScore({ composite: -1, passing: [], failing: ["t1"] }));

    const patches: PatchDescriptor[] = [
      { files: [{ path: "p1", newContent: "x" }] },
      { files: [{ path: "p2", newContent: "x" }] },
    ];
    const result = await voteOnPatches(patches, defaultOpts, { minCompositeScore: 0 });
    expect(result.abstained).toBe(true);
    expect(result.reason).toContain("no patch met minCompositeScore");
  });

  it("abstains when best score <= abstainThreshold", async () => {
    scorePatchSpy.mockResolvedValueOnce(
      fakeScore({ composite: 0, passing: ["a"], failing: [] }),
    );
    const patches: PatchDescriptor[] = [{ files: [{ path: "p", newContent: "x" }] }];
    const result = await voteOnPatches(patches, defaultOpts, {
      minCompositeScore: 0,
      abstainThreshold: 0,
    });
    expect(result.abstained).toBe(true);
    expect(result.reason).toContain("abstainThreshold");
  });

  it("never abstains when abstainThreshold = -Infinity", async () => {
    scorePatchSpy.mockResolvedValueOnce(
      fakeScore({ composite: -5, passing: [], failing: ["t1"] }),
    );
    const patches: PatchDescriptor[] = [{ files: [{ path: "p", newContent: "x" }] }];
    const result = await voteOnPatches(patches, defaultOpts, {
      minCompositeScore: -Infinity,
      abstainThreshold: -Infinity,
    });
    expect(result.abstained).toBe(false);
    expect(result.winnerIndex).toBe(0);
  });

  it("ties broken by smaller diff when preferSmaller=true", async () => {
    scorePatchSpy
      .mockResolvedValueOnce(fakeScore({ composite: 5, passing: ["a"], failing: [] }))
      .mockResolvedValueOnce(fakeScore({ composite: 5, passing: ["a"], failing: [] }));

    const patches: PatchDescriptor[] = [
      { files: [{ path: "big", newContent: "x".repeat(1000) }] },
      { files: [{ path: "small", newContent: "y" }] },
    ];
    const result = await voteOnPatches(patches, defaultOpts);
    expect(result.winnerIndex).toBe(1);
  });

  it("preserves insertion order when preferSmaller=false", async () => {
    scorePatchSpy
      .mockResolvedValueOnce(fakeScore({ composite: 5, passing: ["a"], failing: [] }))
      .mockResolvedValueOnce(fakeScore({ composite: 5, passing: ["a"], failing: [] }));

    const patches: PatchDescriptor[] = [
      { files: [{ path: "big", newContent: "x".repeat(1000) }] },
      { files: [{ path: "small", newContent: "y" }] },
    ];
    const result = await voteOnPatches(patches, defaultOpts, {
      preferSmaller: false,
      abstainThreshold: -Infinity,
    });
    expect(result.winnerIndex).toBe(0);
  });

  it("computes consensus passing: tests all patches pass", async () => {
    scorePatchSpy
      .mockResolvedValueOnce(fakeScore({ composite: 1, passing: ["t1", "t2"], failing: [] }))
      .mockResolvedValueOnce(fakeScore({ composite: 2, passing: ["t1", "t2", "t3"], failing: [] }));

    const patches: PatchDescriptor[] = [
      { files: [{ path: "p1", newContent: "x" }] },
      { files: [{ path: "p2", newContent: "x" }] },
    ];
    const result = await voteOnPatches(patches, defaultOpts);
    expect(result.consensusPassing).toEqual(["t1", "t2"]);
  });

  it("computes consensus failing: tests all patches fail", async () => {
    scorePatchSpy
      .mockResolvedValueOnce(fakeScore({ composite: 1, passing: [], failing: ["bad"] }))
      .mockResolvedValueOnce(fakeScore({ composite: 2, passing: [], failing: ["bad"] }));

    const patches: PatchDescriptor[] = [
      { files: [{ path: "p1", newContent: "x" }] },
      { files: [{ path: "p2", newContent: "x" }] },
    ];
    const result = await voteOnPatches(patches, defaultOpts, { minCompositeScore: -Infinity });
    expect(result.consensusFailing).toEqual(["bad"]);
  });

  it("computes contentious tests: at least one patch passes, at least one fails", async () => {
    scorePatchSpy
      .mockResolvedValueOnce(fakeScore({ composite: 1, passing: ["t1"], failing: ["t2"] }))
      .mockResolvedValueOnce(fakeScore({ composite: 1, passing: ["t2"], failing: ["t1"] }));

    const patches: PatchDescriptor[] = [
      { files: [{ path: "p1", newContent: "x" }] },
      { files: [{ path: "p2", newContent: "x" }] },
    ];
    const result = await voteOnPatches(patches, defaultOpts);
    expect(result.contentiousTests.sort()).toEqual(["t1", "t2"]);
    expect(result.consensusPassing).toEqual([]);
    expect(result.consensusFailing).toEqual([]);
  });
});

describe("summariseVote", () => {
  it("includes abstain marker when abstained", () => {
    const out = summariseVote({
      winnerIndex: null,
      reason: "all regressed",
      scores: [],
      consensusPassing: [],
      consensusFailing: [],
      contentiousTests: [],
      abstained: true,
    });
    expect(out).toContain("ABSTAIN");
  });

  it("includes winner index when not abstained", () => {
    const out = summariseVote({
      winnerIndex: 2,
      reason: "best",
      scores: [],
      consensusPassing: [],
      consensusFailing: [],
      contentiousTests: [],
      abstained: false,
    });
    expect(out).toContain("winner = patch #2");
  });

  it("truncates contentious list to 5", () => {
    const out = summariseVote({
      winnerIndex: 0,
      reason: "x",
      scores: [],
      consensusPassing: [],
      consensusFailing: [],
      contentiousTests: ["a", "b", "c", "d", "e", "f", "g"],
      abstained: false,
    });
    expect(out).toContain("…");
  });
});
