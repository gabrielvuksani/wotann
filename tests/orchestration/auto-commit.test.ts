import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoCommitter } from "../../src/orchestration/auto-commit.js";

/**
 * S5-10 test helper: create a throwaway git repo with one committed file
 * and one modified file. AutoCommitter now actually invokes git, so tests
 * need a real repo instead of the fake `/project` path the stub accepted.
 */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wotann-autocommit-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@wotann"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Wotann Test"], { cwd: dir });
  writeFileSync(join(dir, "initial.ts"), "export const x = 1;\n");
  execFileSync("git", ["add", "initial.ts"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

describe("AutoCommitter", () => {
  let committer: AutoCommitter;
  const repos: string[] = [];

  beforeEach(() => {
    committer = new AutoCommitter("test-session");
  });

  afterEach(() => {
    while (repos.length > 0) {
      const dir = repos.pop();
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    }
  });

  describe("generateCommitMessage", () => {
    it("generates a feat commit for new feature tasks", () => {
      const commit = committer.generateCommitMessage(
        "Add user authentication",
        ["src/auth.ts", "src/middleware.ts"],
        "Tests passed",
      );

      expect(commit.type).toBe("feat");
      expect(commit.formatted).toMatch(/^feat/);
      expect(commit.description.length).toBeGreaterThan(0);
      expect(commit.description.length).toBeLessThanOrEqual(72);
    });

    it("generates a fix commit for bug fixes", () => {
      const commit = committer.generateCommitMessage(
        "Fix login validation bug",
        ["src/auth.ts"],
        "Bug resolved",
      );
      expect(commit.type).toBe("fix");
    });

    it("generates a refactor commit for restructuring", () => {
      const commit = committer.generateCommitMessage(
        "Refactor middleware pipeline",
        ["src/middleware.ts"],
        "Done",
      );
      expect(commit.type).toBe("refactor");
    });

    it("generates a test commit for test tasks", () => {
      const commit = committer.generateCommitMessage(
        "Write unit tests for auth",
        ["tests/auth.test.ts"],
        "Coverage at 90%",
      );
      expect(commit.type).toBe("test");
    });

    it("detects scope from task keywords", () => {
      const commit = committer.generateCommitMessage(
        "Fix auth login token refresh",
        ["src/auth.ts"],
        "Fixed",
      );
      expect(commit.scope).toBe("auth");
    });

    it("infers scope from file paths", () => {
      const commit = committer.generateCommitMessage(
        "Update config",
        ["src/config/settings.ts"],
        "Done",
      );
      // Either detects "config" from keyword or from path
      expect(commit.scope).not.toBeNull();
    });

    it("includes body with file list", () => {
      const commit = committer.generateCommitMessage(
        "Add feature",
        ["src/a.ts", "src/b.ts"],
        "All good",
      );
      expect(commit.body).toContain("src/a.ts");
      expect(commit.body).toContain("src/b.ts");
    });

    it("detects breaking changes", () => {
      const commit = committer.generateCommitMessage(
        "BREAKING CHANGE: remove old API",
        ["src/api.ts"],
        "Removed",
      );
      expect(commit.breaking).toBe(true);
      expect(commit.formatted).toContain("!");
    });

    it("formats the commit message correctly", () => {
      const commit = committer.generateCommitMessage(
        "Add database migration for users",
        ["src/db/migration.ts"],
        "Done",
      );
      expect(commit.formatted).toMatch(/^\w+(\(\w+\))?!?: .+$/);
    });

    it("falls back to chore for unrecognized tasks", () => {
      const commit = committer.generateCommitMessage(
        "Miscellaneous cleanup",
        [],
        "Done",
      );
      expect(commit.type).toBe("chore");
    });
  });

  describe("commitIfVerified", () => {
    it("commits when tests pass (real git workspace)", () => {
      const repo = makeRepo();
      repos.push(repo);
      // Stage a modified file so there's something to commit.
      writeFileSync(join(repo, "src.ts"), "export const y = 2;\n");

      const result = committer.commitIfVerified(repo, "Fix auth bug", ["src.ts"], true);

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.commitHash).not.toBeNull();
      expect(result!.commitHash!.length).toBeGreaterThan(0);
      expect(result!.filesCommitted).toContain("src.ts");
    });

    it("returns null when tests fail", () => {
      const repo = makeRepo();
      repos.push(repo);
      const result = committer.commitIfVerified(
        repo,
        "Broken implementation",
        ["src/broken.ts"],
        false,
      );

      expect(result).toBeNull();
    });

    it("records the commit in session history", () => {
      const repo = makeRepo();
      repos.push(repo);
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      committer.commitIfVerified(repo, "Task 1", ["a.ts"], true);
      writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
      committer.commitIfVerified(repo, "Task 2", ["b.ts"], true);

      const history = committer.getSessionCommits();
      expect(history).toHaveLength(2);
      expect(history[0]?.task).toBe("Task 1");
      expect(history[1]?.task).toBe("Task 2");
    });

    it("returns an honest error when the workspace isn't a git repo (S5-10)", () => {
      const nonRepo = mkdtempSync(join(tmpdir(), "wotann-notgit-"));
      repos.push(nonRepo);
      const result = committer.commitIfVerified(nonRepo, "Nope", ["x.ts"], true);
      // commitIfVerified still persists the attempt, but the CommitResult
      // now carries success: false and an error describing why instead
      // of lying with a random hash.
      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toMatch(/not a git repository/);
    });
  });

  describe("getSessionCommits", () => {
    it("filters by session ID", () => {
      const repo = makeRepo();
      repos.push(repo);
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      committer.commitIfVerified(repo, "Task A", ["a.ts"], true);
      writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
      const other = new AutoCommitter("other-session");
      other.commitIfVerified(repo, "Task B", ["b.ts"], true);

      expect(committer.getSessionCommits()).toHaveLength(1);
      expect(other.getSessionCommits()).toHaveLength(1);
    });

    it("returns empty for sessions with no commits", () => {
      expect(committer.getSessionCommits()).toHaveLength(0);
    });
  });

  describe("getAllRecords / getSessionId", () => {
    it("returns all records across sessions", () => {
      const repo = makeRepo();
      repos.push(repo);
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      committer.commitIfVerified(repo, "Task 1", ["a.ts"], true);
      writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
      committer.commitIfVerified(repo, "Task 2", ["b.ts"], true);

      expect(committer.getAllRecords()).toHaveLength(2);
    });

    it("exposes the session ID", () => {
      expect(committer.getSessionId()).toBe("test-session");
    });

    it("auto-generates session ID when not provided", () => {
      const auto = new AutoCommitter();
      expect(auto.getSessionId()).toMatch(/^session_/);
    });
  });
});
