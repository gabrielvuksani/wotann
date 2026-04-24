/**
 * Tests for `wotann review` — V9 Tier 14.1 port of Claude Code's
 * `/ultrareview`. Exercises the LOCAL orchestration surface: diff
 * resolution across branch/pr/diff targets, bounded-concurrency
 * dispatch, per-dimension failure isolation, and the markdown renderer.
 *
 * We never shell out to git or gh — `gitExec` is injected in every
 * test. The reviewer is always a pure async function so we can assert
 * exactly which dimensions fired and in what order.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_REVIEW_DIMENSIONS,
  formatReviewMarkdown,
  runReview,
  type ReviewDimension,
  type ReviewFinding,
  type ReviewerContext,
  type RunReviewResult,
} from "../../src/cli/commands/review.js";

// ── Helpers ───────────────────────────────────────────────

function finding(
  dim: ReviewDimension,
  overrides: Partial<ReviewFinding> = {},
): ReviewFinding {
  return {
    dimension: dim,
    severity: "medium",
    file: "src/x.ts",
    line: 10,
    message: `issue in ${dim}`,
    ...overrides,
  };
}

/**
 * Reviewer that records every call in order and returns the mapped
 * findings. Lets tests assert both "what was called" and "result
 * shape" without stateful mocks.
 */
function recordingReviewer(
  responses: Partial<Record<ReviewDimension, readonly ReviewFinding[]>>,
) {
  const calls: ReviewDimension[] = [];
  const fn = async (ctx: ReviewerContext): Promise<readonly ReviewFinding[]> => {
    calls.push(ctx.dimension);
    return responses[ctx.dimension] ?? [];
  };
  return { fn, calls };
}

function gitExecRecorder() {
  const calls: (readonly string[])[] = [];
  const exec = async (args: readonly string[]): Promise<string> => {
    calls.push(args);
    if (args[0] === "diff") return "diff --git a/x b/x\n+new line\n";
    if (args[0] === "pr" && args[1] === "diff") return "diff --git a/pr b/pr\n+pr change\n";
    return "";
  };
  return { exec, calls };
}

function assertOk(result: Awaited<ReturnType<typeof runReview>>): RunReviewResult {
  if (!result.ok) {
    throw new Error(`expected ok:true, got error: ${result.error}`);
  }
  return result;
}

// ── Diff-mode target ──────────────────────────────────────

describe("runReview — diff target", () => {
  it("uses supplied diff text directly and never calls gitExec", async () => {
    const { fn: reviewer, calls: reviewerCalls } = recordingReviewer({
      security: [finding("security")],
    });
    const { exec, calls: gitCalls } = gitExecRecorder();

    const result = await runReview({
      target: { kind: "diff", diff: "DIFF-LITERAL" },
      reviewer,
      gitExec: exec,
    });

    const ok = assertOk(result);
    expect(ok.diffText).toBe("DIFF-LITERAL");
    expect(gitCalls).toHaveLength(0);
    expect(reviewerCalls.sort()).toEqual([...ALL_REVIEW_DIMENSIONS].sort());
  });

  it("fails cleanly when kind=diff but target.diff is missing", async () => {
    const { fn } = recordingReviewer({});
    const result = await runReview({
      // @ts-expect-error — deliberate: testing runtime guard
      target: { kind: "diff" },
      reviewer: fn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("target.diff");
  });
});

// ── Branch-mode target ────────────────────────────────────

describe("runReview — branch target", () => {
  it("composes `git diff --no-color base...HEAD` when ref omitted", async () => {
    const { fn } = recordingReviewer({});
    const { exec, calls } = gitExecRecorder();

    await runReview({
      target: { kind: "branch", baseRef: "main" },
      reviewer: fn,
      gitExec: exec,
    });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]).toEqual(["diff", "--no-color", "main...HEAD"]);
  });

  it("honours custom ref and baseRef", async () => {
    const { fn } = recordingReviewer({});
    const { exec, calls } = gitExecRecorder();

    await runReview({
      target: { kind: "branch", ref: "feature/x", baseRef: "develop" },
      reviewer: fn,
      gitExec: exec,
    });

    expect(calls[0]).toEqual(["diff", "--no-color", "develop...feature/x"]);
  });

  it("defaults baseRef to main when omitted", async () => {
    const { fn } = recordingReviewer({});
    const { exec, calls } = gitExecRecorder();

    await runReview({
      target: { kind: "branch" },
      reviewer: fn,
      gitExec: exec,
    });

    expect(calls[0]).toEqual(["diff", "--no-color", "main...HEAD"]);
  });

  it("returns ok:false when kind=branch and gitExec missing", async () => {
    const { fn } = recordingReviewer({});
    const result = await runReview({
      target: { kind: "branch", ref: "feature/x" },
      reviewer: fn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("gitExec");
  });
});

// ── PR-mode target ────────────────────────────────────────

describe("runReview — PR target", () => {
  it("composes `gh pr diff <ref>` and strips leading #", async () => {
    const { fn } = recordingReviewer({});
    const { exec, calls } = gitExecRecorder();

    await runReview({
      target: { kind: "pr", ref: "#123" },
      reviewer: fn,
      gitExec: exec,
    });

    expect(calls[0]).toEqual(["pr", "diff", "123"]);
  });

  it("accepts PR numbers without #", async () => {
    const { fn } = recordingReviewer({});
    const { exec, calls } = gitExecRecorder();

    await runReview({
      target: { kind: "pr", ref: "456" },
      reviewer: fn,
      gitExec: exec,
    });

    expect(calls[0]).toEqual(["pr", "diff", "456"]);
  });

  it("fails cleanly when PR ref is missing", async () => {
    const { fn } = recordingReviewer({});
    const { exec } = gitExecRecorder();
    const result = await runReview({
      target: { kind: "pr" },
      reviewer: fn,
      gitExec: exec,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("target.ref");
  });
});

// ── Dimension dispatch ───────────────────────────────────

describe("runReview — dimension dispatch", () => {
  it("calls each default dimension exactly once", async () => {
    const { fn, calls } = recordingReviewer({});
    await runReview({
      target: { kind: "diff", diff: "d" },
      reviewer: fn,
    });
    expect(calls.length).toBe(ALL_REVIEW_DIMENSIONS.length);
    // each dimension fired exactly once
    for (const d of ALL_REVIEW_DIMENSIONS) {
      expect(calls.filter((c) => c === d)).toHaveLength(1);
    }
  });

  it("respects user-supplied dimensions filter", async () => {
    const { fn, calls } = recordingReviewer({});
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "testing"],
      reviewer: fn,
    });
    const ok = assertOk(result);
    expect(calls.sort()).toEqual(["security", "testing"]);
    expect(ok.dimensionsRun.sort()).toEqual(["security", "testing"]);
  });

  it("dedupes repeated dimensions from caller input", async () => {
    const { fn, calls } = recordingReviewer({});
    await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "security", "testing"],
      reviewer: fn,
    });
    expect(calls.filter((c) => c === "security")).toHaveLength(1);
    expect(calls.filter((c) => c === "testing")).toHaveLength(1);
  });

  it("drops unknown dimensions and still runs the valid ones", async () => {
    const { fn, calls } = recordingReviewer({});
    await runReview({
      target: { kind: "diff", diff: "d" },
      // @ts-expect-error — testing runtime guard against stale dimension strings
      dimensions: ["security", "nope"],
      reviewer: fn,
    });
    expect(calls).toEqual(["security"]);
  });

  it("returns ok:false when every requested dimension is unknown", async () => {
    const { fn } = recordingReviewer({});
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      // @ts-expect-error — runtime guard
      dimensions: ["bogus"],
      reviewer: fn,
    });
    expect(result.ok).toBe(false);
  });
});

// ── Aggregation & sorting ─────────────────────────────────

describe("runReview — aggregation", () => {
  it("aggregates findings across dimensions and sorts critical first", async () => {
    const { fn } = recordingReviewer({
      security: [finding("security", { severity: "low", file: "a.ts", line: 1 })],
      performance: [
        finding("performance", { severity: "critical", file: "b.ts", line: 5 }),
      ],
      testing: [finding("testing", { severity: "high", file: "c.ts", line: 2 })],
    });

    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "performance", "testing"],
      reviewer: fn,
    });

    const ok = assertOk(result);
    expect(ok.findings.map((f) => f.severity)).toEqual(["critical", "high", "low"]);
    expect(ok.findings[0]!.dimension).toBe("performance");
  });

  it("normalises a finding whose dimension field disagrees with the caller", async () => {
    const { fn } = recordingReviewer({
      security: [finding("performance" as ReviewDimension, { message: "mis-tagged" })],
    });
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security"],
      reviewer: fn,
    });
    const ok = assertOk(result);
    // The finding was emitted from the `security` dimension, so the
    // shell re-stamps it as `security` for correct attribution.
    expect(ok.findings[0]!.dimension).toBe("security");
  });

  it("exposes perDimensionCounts for every run dimension", async () => {
    const { fn } = recordingReviewer({
      security: [finding("security"), finding("security")],
      performance: [finding("performance")],
    });
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "performance"],
      reviewer: fn,
    });
    const ok = assertOk(result);
    expect(ok.perDimensionCounts.security).toBe(2);
    expect(ok.perDimensionCounts.performance).toBe(1);
  });

  it("tolerates a reviewer that returns undefined (treats as zero findings)", async () => {
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security"],
      // @ts-expect-error — simulating a misbehaving reviewer
      reviewer: async () => undefined,
    });
    const ok = assertOk(result);
    expect(ok.findings).toHaveLength(0);
    expect(ok.dimensionsRun).toEqual(["security"]);
  });
});

// ── Failure isolation ────────────────────────────────────

describe("runReview — per-dimension failure isolation", () => {
  it("keeps a failing dimension out of dimensionsRun but completes the others", async () => {
    const reviewer = async (ctx: ReviewerContext): Promise<readonly ReviewFinding[]> => {
      if (ctx.dimension === "architecture") throw new Error("boom");
      return [finding(ctx.dimension)];
    };
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "architecture", "testing"],
      reviewer,
    });

    const ok = assertOk(result);
    expect(ok.dimensionsRun.sort()).toEqual(["security", "testing"]);
    expect(ok.dimensionFailures).toHaveLength(1);
    expect(ok.dimensionFailures[0]!.dimension).toBe("architecture");
    expect(ok.dimensionFailures[0]!.reason).toContain("boom");
    expect(ok.findings).toHaveLength(2);
  });

  it("returns ok:true even when every dimension throws — failures are in the envelope", async () => {
    const reviewer = async (): Promise<readonly ReviewFinding[]> => {
      throw new Error("all broken");
    };
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "testing"],
      reviewer,
    });
    const ok = assertOk(result);
    expect(ok.dimensionsRun).toHaveLength(0);
    expect(ok.dimensionFailures).toHaveLength(2);
    expect(ok.findings).toHaveLength(0);
  });
});

// ── Concurrency ──────────────────────────────────────────

describe("runReview — concurrency", () => {
  it("never exceeds the concurrency cap", async () => {
    let inflight = 0;
    let peak = 0;
    const reviewer = async (): Promise<readonly ReviewFinding[]> => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inflight -= 1;
      return [];
    };
    await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: [...ALL_REVIEW_DIMENSIONS],
      reviewer,
      concurrency: 2,
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("defaults to concurrency=3 when omitted", async () => {
    let inflight = 0;
    let peak = 0;
    const reviewer = async (): Promise<readonly ReviewFinding[]> => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inflight -= 1;
      return [];
    };
    await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: [...ALL_REVIEW_DIMENSIONS],
      reviewer,
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("clamps invalid concurrency to 1 rather than throwing", async () => {
    const { fn, calls } = recordingReviewer({});
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "testing"],
      reviewer: fn,
      concurrency: 0,
    });
    const ok = assertOk(result);
    expect(ok.dimensionsRun.sort()).toEqual(["security", "testing"]);
    expect(calls.sort()).toEqual(["security", "testing"]);
  });
});

// ── Clock injection ──────────────────────────────────────

describe("runReview — clock injection", () => {
  it("uses injected now() to compute durationMs deterministically", async () => {
    const { fn } = recordingReviewer({});
    let t = 1_000;
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security"],
      reviewer: fn,
      now: () => {
        const current = t;
        t += 42;
        return current;
      },
    });
    const ok = assertOk(result);
    expect(ok.durationMs).toBe(42);
  });
});

// ── Guards on required inputs ────────────────────────────

describe("runReview — input guards", () => {
  it("returns ok:false when reviewer is missing", async () => {
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      // @ts-expect-error — testing guard
      reviewer: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("reviewer");
  });

  it("returns ok:false when dimensions array is empty", async () => {
    const { fn } = recordingReviewer({});
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: [],
      reviewer: fn,
    });
    expect(result.ok).toBe(false);
  });
});

// ── Markdown formatting ──────────────────────────────────

describe("formatReviewMarkdown", () => {
  it("produces severity-grouped sections with a header summary", async () => {
    const { fn } = recordingReviewer({
      security: [
        finding("security", { severity: "critical", file: "a.ts", line: 1, message: "auth bypass" }),
      ],
      performance: [
        finding("performance", { severity: "medium", file: "b.ts", line: 9, message: "N+1" }),
      ],
    });
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "performance"],
      reviewer: fn,
    });
    const ok = assertOk(result);

    const md = formatReviewMarkdown(ok);
    expect(md).toContain("# Review");
    expect(md).toContain("## Critical (1)");
    expect(md).toContain("## Medium (1)");
    expect(md).toContain("auth bypass");
    expect(md).toContain("N+1");
    // Per-dimension summary renders counts for each ran dimension.
    expect(md).toContain("**security**: 1 finding");
    expect(md).toContain("**performance**: 1 finding");
  });

  it("says 'No issues found' when findings are empty", async () => {
    const { fn } = recordingReviewer({});
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security"],
      reviewer: fn,
    });
    const ok = assertOk(result);
    const md = formatReviewMarkdown(ok);
    expect(md).toContain("No issues found");
  });

  it("lists dimension failures when any reviewer threw", async () => {
    const reviewer = async (ctx: ReviewerContext): Promise<readonly ReviewFinding[]> => {
      if (ctx.dimension === "testing") throw new Error("reviewer oom");
      return [];
    };
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security", "testing"],
      reviewer,
    });
    const ok = assertOk(result);
    const md = formatReviewMarkdown(ok);
    expect(md).toContain("Dimension failures");
    expect(md).toContain("testing");
    expect(md).toContain("reviewer oom");
  });

  it("renders file:line when line is present, file alone otherwise", async () => {
    const { fn } = recordingReviewer({
      security: [
        finding("security", { file: "a.ts", line: 42, message: "with line" }),
        finding("security", { file: "b.ts", line: undefined, message: "without line" }),
      ],
    });
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security"],
      reviewer: fn,
    });
    const ok = assertOk(result);
    const md = formatReviewMarkdown(ok);
    expect(md).toContain("`a.ts:42`");
    expect(md).toContain("`b.ts`");
    expect(md).not.toContain("`b.ts:undefined`");
  });

  it("includes suggestion when present and omits the sub-bullet otherwise", async () => {
    const { fn } = recordingReviewer({
      security: [
        finding("security", { message: "fixable", suggestion: "use zod" }),
        finding("security", { message: "unfixable" }),
      ],
    });
    const result = await runReview({
      target: { kind: "diff", diff: "d" },
      dimensions: ["security"],
      reviewer: fn,
    });
    const ok = assertOk(result);
    const md = formatReviewMarkdown(ok);
    expect(md).toContain("_Suggestion_: use zod");
    // Only one suggestion line — unfixable one had none.
    expect(md.match(/_Suggestion_/g)).toHaveLength(1);
  });
});
