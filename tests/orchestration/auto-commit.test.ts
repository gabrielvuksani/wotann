import { describe, it, expect, beforeEach } from "vitest";
import { AutoCommitter } from "../../src/orchestration/auto-commit.js";

describe("AutoCommitter", () => {
  let committer: AutoCommitter;

  beforeEach(() => {
    committer = new AutoCommitter("test-session");
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
    it("commits when tests pass", () => {
      const result = committer.commitIfVerified(
        "/project",
        "Fix auth bug",
        ["src/auth.ts"],
        true,
      );

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.commitHash).not.toBeNull();
      expect(result!.filesCommitted).toContain("src/auth.ts");
    });

    it("returns null when tests fail", () => {
      const result = committer.commitIfVerified(
        "/project",
        "Broken implementation",
        ["src/broken.ts"],
        false,
      );

      expect(result).toBeNull();
    });

    it("records the commit in session history", () => {
      committer.commitIfVerified("/project", "Task 1", ["a.ts"], true);
      committer.commitIfVerified("/project", "Task 2", ["b.ts"], true);

      const history = committer.getSessionCommits();
      expect(history).toHaveLength(2);
      expect(history[0]?.task).toBe("Task 1");
      expect(history[1]?.task).toBe("Task 2");
    });
  });

  describe("getSessionCommits", () => {
    it("filters by session ID", () => {
      const other = new AutoCommitter("other-session");
      committer.commitIfVerified("/p", "Task A", ["a.ts"], true);
      other.commitIfVerified("/p", "Task B", ["b.ts"], true);

      expect(committer.getSessionCommits()).toHaveLength(1);
      expect(other.getSessionCommits()).toHaveLength(1);
    });

    it("returns empty for sessions with no commits", () => {
      expect(committer.getSessionCommits()).toHaveLength(0);
    });
  });

  describe("getAllRecords / getSessionId", () => {
    it("returns all records across sessions", () => {
      committer.commitIfVerified("/p", "Task 1", ["a.ts"], true);
      committer.commitIfVerified("/p", "Task 2", ["b.ts"], true);

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
