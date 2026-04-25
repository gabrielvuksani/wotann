/**
 * Diff loader — verifies discovery, validation, and gh-CLI shelling.
 *
 * QB #14: tests verify the real discriminated-union contract; never assume
 * "happy path returns same shape as error path".
 */

import { describe, expect, it } from "vitest";
import { loadPrDiff } from "../../src/pr-checks/diff-loader.js";
import type { ExecRunner } from "../../src/pr-checks/diff-loader.js";

describe("loadPrDiff — inline mode", () => {
  it("accepts a valid unified diff", async () => {
    const r = await loadPrDiff({
      mode: "inline",
      inlineDiff: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe("inline");
  });

  it("accepts empty diff (empty PR)", async () => {
    const r = await loadPrDiff({ mode: "inline", inlineDiff: "" });
    expect(r.ok).toBe(true);
  });

  it("rejects non-diff text", async () => {
    const r = await loadPrDiff({ mode: "inline", inlineDiff: "just some prose" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unified diff/);
  });

  it("rejects when over maxBytes", async () => {
    const r = await loadPrDiff({
      mode: "inline",
      inlineDiff: "diff --git a/x b/x\n" + "x".repeat(100),
      maxBytes: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/maxBytes/);
  });
});

describe("loadPrDiff — file mode", () => {
  it("reads via injected readFileFn", async () => {
    const r = await loadPrDiff({
      mode: "file",
      filePath: "/tmp/x.diff",
      readFileFn: async () => "diff --git a/y b/y\n",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe("file");
  });

  it("returns error when readFileFn throws", async () => {
    const r = await loadPrDiff({
      mode: "file",
      filePath: "/tmp/missing.diff",
      readFileFn: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ENOENT/);
  });

  it("requires filePath", async () => {
    const r = await loadPrDiff({ mode: "file" });
    expect(r.ok).toBe(false);
  });
});

describe("loadPrDiff — gh-cli mode", () => {
  const makeRunner = (stdout: string, stderr: string, exitCode: number): ExecRunner =>
    async () => ({ stdout, stderr, exitCode });

  it("returns the diff when gh exits 0", async () => {
    const r = await loadPrDiff({
      mode: "gh-cli",
      prNumber: 42,
      execFn: makeRunner("diff --git a/q b/q\n", "", 0),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("gh-cli");
      expect(r.diff).toContain("diff --git");
    }
  });

  it("returns error on non-zero exit", async () => {
    const r = await loadPrDiff({
      mode: "gh-cli",
      prNumber: 42,
      execFn: makeRunner("", "PR not found", 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PR not found/);
  });

  it("returns error if prNumber missing", async () => {
    const r = await loadPrDiff({ mode: "gh-cli" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/prNumber/);
  });

  it("rejects unparseable stdout", async () => {
    const r = await loadPrDiff({
      mode: "gh-cli",
      prNumber: 1,
      execFn: makeRunner("not a diff", "", 0),
    });
    expect(r.ok).toBe(false);
  });

  it("forwards repo arg as --repo flag", async () => {
    const seen: string[][] = [];
    const r = await loadPrDiff({
      mode: "gh-cli",
      prNumber: 7,
      repo: "owner/name",
      execFn: async (_file, args) => {
        seen.push([...args]);
        return { stdout: "diff --git a/x b/x\n", stderr: "", exitCode: 0 };
      },
    });
    expect(r.ok).toBe(true);
    expect(seen[0]).toEqual(["pr", "diff", "7", "--repo", "owner/name"]);
  });
});

describe("loadPrDiff — mode auto-detect", () => {
  it("auto-detects inline when inlineDiff present", async () => {
    const r = await loadPrDiff({ inlineDiff: "diff --git a/x b/x\n" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe("inline");
  });

  it("auto-detects file when filePath present", async () => {
    const r = await loadPrDiff({
      filePath: "/x",
      readFileFn: async () => "diff --git a/x b/x\n",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe("file");
  });
});
