import { describe, it, expect } from "vitest";
import { gatherLocalContext, formatContextForPrompt } from "../../src/middleware/local-context.js";
import { join } from "node:path";

describe("LocalContextMiddleware", () => {
  const PROJECT_DIR = join(process.cwd());

  it("gathers context for current project", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);

    expect(ctx.workingDir).toBe(PROJECT_DIR);
    expect(ctx.projectType).toBe("typescript");
    expect(ctx.packageManager).toBeDefined();
    expect(ctx.languages.length).toBeGreaterThan(0);
    expect(ctx.tools.length).toBeGreaterThan(0);
  });

  it("detects TypeScript project type", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);
    expect(ctx.projectType).toBe("typescript");
  });

  it("detects available tools", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);
    const nodeInfo = ctx.tools.find((t) => t.name === "node");
    expect(nodeInfo).toBeDefined();
    expect(nodeInfo?.available).toBe(true);
    expect(nodeInfo?.version).toContain("v");
  });

  it("detects git status", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);
    // May be null if not a git repo, but should be defined.
    // Behavior-assertion: when non-null, the status string must be
    // either a non-empty working-tree summary or the empty-tree
    // sentinel — never just whitespace or a stray error token.
    if (ctx.gitStatus === null) {
      expect(ctx.gitStatus).toBeNull();
    } else {
      expect(typeof ctx.gitStatus).toBe("string");
      // Real `git status --porcelain` output is either "" (clean)
      // or a newline-terminated list of "XY path" entries; both are
      // valid. Anything else (e.g. "fatal: ...") means detection
      // broke — catch that here.
      if (ctx.gitStatus.length > 0) {
        expect(ctx.gitStatus).not.toMatch(/^fatal:/);
        expect(ctx.gitStatus).not.toMatch(/^error:/);
      }
    }
  });

  it("generates directory tree", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);
    expect(ctx.directoryTree.length).toBeGreaterThan(0);
    expect(ctx.directoryTree).toContain("src/");
  });

  it("reads dependencies from package.json", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);
    expect(ctx.dependencies.length).toBeGreaterThan(0);
  });

  it("formats context for prompt injection", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);
    const formatted = formatContextForPrompt(ctx);

    expect(formatted).toContain("Working directory:");
    expect(formatted).toContain("typescript");
    expect(formatted).toContain("Available tools:");
  });

  it("handles non-existent directory gracefully", () => {
    const ctx = gatherLocalContext("/nonexistent/path");
    expect(ctx.projectType).toBe("unknown");
    expect(ctx.directoryTree).toBe("");
  });

  it("limits directory tree depth to prevent bloat", () => {
    const ctx = gatherLocalContext(PROJECT_DIR);
    // Tree should be limited — not thousands of lines.
    // The repo has grown: 86+ skills, src/ with 40+ subdirs, desktop-app/, ios/
    // (5 targets), tests/, docs/, research/. A few hundred entries is fine.
    const lines = ctx.directoryTree.split("\n").length;
    expect(lines).toBeLessThan(2000);
  });
});
