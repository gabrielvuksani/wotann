/**
 * C20 — Magic Git analyzer tests.
 */

import { describe, it, expect } from "vitest";
import {
  parseDiffStat,
  suggestCommitMessage,
  renderCommitMessage,
  buildPRDescription,
  parseConflictBlocks,
  suggestConflictResolution,
} from "../../src/git/magic-git.js";

describe("parseDiffStat", () => {
  it("parses numstat output", () => {
    const input = [
      "10\t2\tsrc/foo.ts",
      "3\t0\ttests/foo.test.ts",
      "-\t-\tpublic/logo.png",
    ].join("\n");
    const stats = parseDiffStat(input);
    expect(stats).toHaveLength(3);
    expect(stats[0]).toMatchObject({ path: "src/foo.ts", adds: 10, dels: 2 });
    expect(stats[2]).toMatchObject({ path: "public/logo.png", adds: 0, dels: 0 });
  });

  it("ignores blank lines", () => {
    expect(parseDiffStat("\n\n   \n")).toEqual([]);
  });
});

describe("suggestCommitMessage", () => {
  it("picks `feat` when source dominates", () => {
    const suggestion = suggestCommitMessage([
      { path: "src/core/runtime.ts", adds: 100, dels: 10 },
      { path: "src/core/session.ts", adds: 40, dels: 5 },
    ]);
    expect(suggestion.type).toBe("feat");
    expect(suggestion.scope).toBe("core");
  });

  it("picks `test` when every file is a test", () => {
    const suggestion = suggestCommitMessage([
      { path: "tests/unit/foo.test.ts", adds: 40, dels: 0 },
      { path: "tests/unit/bar.test.ts", adds: 30, dels: 0 },
    ]);
    expect(suggestion.type).toBe("test");
  });

  it("picks `docs` when markdown dominates", () => {
    const suggestion = suggestCommitMessage([
      { path: "docs/guide.md", adds: 50, dels: 0 },
      { path: "README.md", adds: 10, dels: 2 },
    ]);
    expect(suggestion.type).toBe("docs");
  });

  it("picks `fix` when deletions exceed additions 2:1", () => {
    const suggestion = suggestCommitMessage([
      { path: "src/a.ts", adds: 2, dels: 30 },
      { path: "src/b.ts", adds: 1, dels: 20 },
    ]);
    expect(suggestion.type).toBe("fix");
  });

  it("leaves scope undefined when files span multiple src/* dirs", () => {
    const suggestion = suggestCommitMessage([
      { path: "src/core/runtime.ts", adds: 10, dels: 1 },
      { path: "src/providers/registry.ts", adds: 5, dels: 2 },
    ]);
    expect(suggestion.scope).toBeUndefined();
  });

  it("uses caller's hint when provided", () => {
    const suggestion = suggestCommitMessage(
      [{ path: "src/core/runtime.ts", adds: 10, dels: 1 }],
      { hint: "inline cost tracker" },
    );
    expect(suggestion.subject).toContain("inline cost tracker");
  });

  it("handles empty staged diff", () => {
    const suggestion = suggestCommitMessage([]);
    expect(suggestion.type).toBe("chore");
    expect(suggestion.subject).toBe("empty commit");
    expect(suggestion.confidence).toBeLessThan(0.2);
  });

  it("emits a body only when multiple files changed", () => {
    const single = suggestCommitMessage([{ path: "src/foo.ts", adds: 5, dels: 1 }]);
    expect(single.body).toBeUndefined();

    const multi = suggestCommitMessage([
      { path: "src/foo.ts", adds: 5, dels: 1 },
      { path: "src/bar.ts", adds: 2, dels: 2 },
    ]);
    expect(multi.body).toContain("2 files");
  });
});

describe("renderCommitMessage", () => {
  it("renders scope with parentheses and body separated by blank line", () => {
    const rendered = renderCommitMessage({
      type: "feat",
      scope: "hooks",
      subject: "add `if` predicate",
      body: "Some longer explanation.",
      breaking: false,
      confidence: 0.7,
    });
    expect(rendered).toBe("feat(hooks): add `if` predicate\n\nSome longer explanation.");
  });

  it("omits scope gracefully", () => {
    const rendered = renderCommitMessage({
      type: "chore",
      scope: undefined,
      subject: "bump deps",
      body: undefined,
      breaking: false,
      confidence: 0.5,
    });
    expect(rendered).toBe("chore: bump deps");
  });

  it("marks breaking changes with !", () => {
    const rendered = renderCommitMessage({
      type: "feat",
      scope: "api",
      subject: "rename provider field",
      body: undefined,
      breaking: true,
      confidence: 0.5,
    });
    expect(rendered).toMatch(/^feat\(api\)!:/);
  });
});

describe("buildPRDescription", () => {
  it("lists commits as bullets and creates a test plan from test paths", () => {
    const body = buildPRDescription({
      title: "Add magic git",
      commits: [
        { hash: "aaaa", subject: "feat(git): analyzer" },
        { hash: "bbbb", subject: "test(git): analyzer cases" },
      ],
      diffStats: [
        { path: "src/git/magic-git.ts", adds: 200, dels: 0 },
        { path: "tests/git/magic-git.test.ts", adds: 180, dels: 0 },
      ],
      baseBranch: "main",
    });
    expect(body).toContain("## Summary");
    expect(body).toContain("feat(git): analyzer");
    expect(body).toContain("## Test plan");
    expect(body).toContain("tests/git/magic-git.test.ts passes");
    expect(body).toContain("npm test` green on main");
  });

  it("caps commits at 8 and indicates overflow", () => {
    const commits = Array.from({ length: 12 }, (_, i) => ({
      hash: `h${i}`,
      subject: `commit ${i}`,
    }));
    const body = buildPRDescription({
      title: "Many commits",
      commits,
      diffStats: [],
    });
    expect(body).toContain("plus 4 more commit(s)");
  });

  it("falls back to manual-test plan when no tests present", () => {
    const body = buildPRDescription({
      title: "No tests",
      commits: [{ hash: "aaa", subject: "chore: bump" }],
      diffStats: [{ path: "package.json", adds: 1, dels: 1 }],
    });
    expect(body).toContain("No new tests included");
    expect(body).toContain("Manual verification");
  });
});

describe("parseConflictBlocks + suggestConflictResolution", () => {
  it("parses a 2-way conflict", () => {
    const merged = [
      "line1",
      "<<<<<<< HEAD",
      "ours",
      "=======",
      "theirs",
      ">>>>>>> branch",
      "line2",
    ].join("\n");
    const hunks = parseConflictBlocks(merged);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.ours.trim()).toBe("ours");
    expect(hunks[0]!.theirs.trim()).toBe("theirs");
  });

  it("parses a 3-way conflict with ancestor", () => {
    const merged = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| merged common ancestors",
      "original",
      "=======",
      "theirs",
      ">>>>>>> branch",
    ].join("\n");
    const hunks = parseConflictBlocks(merged);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.ancestor?.trim()).toBe("original");
  });

  it("suggests take-ours when sides identical", () => {
    const r = suggestConflictResolution({ ours: "same\n", theirs: "same\n", ancestor: undefined });
    expect(r.strategy).toBe("take-ours");
    expect(r.reason).toMatch(/identical/);
  });

  it("suggests take-theirs when ours is empty", () => {
    const r = suggestConflictResolution({ ours: "", theirs: "new content\n", ancestor: undefined });
    expect(r.strategy).toBe("take-theirs");
  });

  it("suggests superset when one side contains the other", () => {
    const r = suggestConflictResolution({
      ours: "line1\nline2\nline3\n",
      theirs: "line2\n",
      ancestor: undefined,
    });
    expect(r.strategy).toBe("take-ours");
    expect(r.reason).toMatch(/superset/);
  });

  it("falls back to manual when changes diverge", () => {
    const r = suggestConflictResolution({
      ours: "ours changed this line",
      theirs: "theirs rewrote it differently",
      ancestor: undefined,
    });
    expect(r.strategy).toBe("manual");
  });
});
