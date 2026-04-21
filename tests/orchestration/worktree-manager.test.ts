/**
 * Tests for WorktreeManager — Cursor 3 `/worktree` backend (P1-C6).
 *
 * Uses the `gitExec` injection hook to replace `git` with a
 * scriptable mock. Avoids touching the filesystem by configuring
 * `worktreesDir` under an isolated tmpdir per-test and by never
 * asking the mock to write files (the real filesystem calls are
 * `mkdirSync` for the parent dir, `existsSync` checks, and
 * `rmSync` for cleanup — all of which we allow).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorktreeError,
  WorktreeManager,
  validateTaskId,
} from "../../src/orchestration/worktree-manager.js";

// ── Mock git ──────────────────────────────────────────────

interface GitCall {
  readonly args: readonly string[];
}

type GitHandler = (
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

function scriptedGit(
  responses: ReadonlyMap<string, { stdout?: string; stderr?: string; reject?: string }>,
  calls: GitCall[],
): GitHandler {
  return async (args) => {
    calls.push({ args });
    // Match by a joined key — we use the first few args as the key.
    const key = args.slice(0, 4).join(" ");
    // Find the longest-matching key first for specificity.
    const keys = [...responses.keys()].sort((a, b) => b.length - a.length);
    const match = keys.find((k) => key.startsWith(k) || args.join(" ").startsWith(k));
    const r = match !== undefined ? responses.get(match) : undefined;
    if (!r) {
      return { stdout: "", stderr: "" };
    }
    if (r.reject !== undefined) {
      throw new Error(r.reject);
    }
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

// ── Shared fixtures ───────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wotann-wt-test-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // tolerate cleanup races
  }
});

// ── Tests ─────────────────────────────────────────────────

describe("WorktreeManager — validateTaskId", () => {
  it("accepts typical task ids", () => {
    expect(() => validateTaskId("task-1")).not.toThrow();
    expect(() => validateTaskId("A_b-9")).not.toThrow();
    expect(() => validateTaskId("abc123")).not.toThrow();
  });

  it("rejects empty and shell-injection strings", () => {
    expect(() => validateTaskId("")).toThrow(WorktreeError);
    expect(() => validateTaskId("; rm -rf /")).toThrow(WorktreeError);
    expect(() => validateTaskId("task id with spaces")).toThrow(WorktreeError);
    expect(() => validateTaskId("..\\..\\escape")).toThrow(WorktreeError);
  });

  it("rejects over-long task ids (>64 chars)", () => {
    expect(() => validateTaskId("a".repeat(65))).toThrow(WorktreeError);
  });
});

describe("WorktreeManager — create", () => {
  it("succeeds on clean repo, resolves HEAD, creates worktree", async () => {
    const calls: GitCall[] = [];
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify HEAD", { stdout: "abc1234\n" }],
        ["worktree add -b", { stdout: "", stderr: "" }],
      ]),
      calls,
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    const entry = await mgr.create("task-1");
    expect(entry.taskId).toBe("task-1");
    expect(entry.branch).toBe("wotann/wt/task-1");
    expect(entry.workspaceRoot).toBe(join(tmpDir, "wts", "task-1"));
    expect(entry.status).toBe("active");
    expect(entry.baseRef).toBe("abc1234");
    // Verify the add argv uses -b flag, isolating injection-safe argv.
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add");
    expect(addCall).toBeDefined();
    expect(addCall?.args).toContain("-b");
    expect(addCall?.args).toContain("wotann/wt/task-1");
  });

  it("fails on invalid base ref with WorktreeError", async () => {
    const git: GitHandler = async (args) => {
      if (args[0] === "rev-parse") {
        throw new Error("unknown revision or path");
      }
      return { stdout: "", stderr: "" };
    };
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await expect(mgr.create("task-2", "no-such-branch")).rejects.toThrow(WorktreeError);
  });

  it("surfaces a dirty-tree / add failure from git honestly", async () => {
    const git: GitHandler = async (args) => {
      if (args.join(" ").startsWith("rev-parse --verify")) {
        return { stdout: "abc1234\n", stderr: "" };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        const err = new Error("fatal: could not create work tree dir") as Error & {
          stderr?: string;
        };
        err.stderr = "fatal: dirty tree";
        throw err;
      }
      return { stdout: "", stderr: "" };
    };
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await expect(mgr.create("task-dirty")).rejects.toThrow(WorktreeError);
  });

  it("rejects duplicate active taskId", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "abc1234\n" }],
        ["worktree add -b", { stdout: "" }],
      ]),
      [],
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts-dup"),
      gitExec: git,
    });
    await mgr.create("dup-task");
    await expect(mgr.create("dup-task")).rejects.toThrow(WorktreeError);
  });

  it("rejects invalid taskId (shell injection)", async () => {
    const git = scriptedGit(new Map(), []);
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await expect(mgr.create("; rm -rf /")).rejects.toThrow(WorktreeError);
  });
});

describe("WorktreeManager — list + getWorkspaceRoot", () => {
  it("list is empty initially, then shows active entries", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "deadbeef\n" }],
        ["worktree add -b", { stdout: "" }],
      ]),
      [],
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    expect(mgr.list()).toHaveLength(0);
    await mgr.create("task-a");
    await mgr.create("task-b");
    const listed = mgr.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((e) => e.taskId)).toEqual(["task-a", "task-b"]);
  });

  it("getWorkspaceRoot returns undefined for unknown & abandoned ids", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "abc\n" }],
        ["worktree add -b", { stdout: "" }],
      ]),
      [],
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts-x"),
      gitExec: git,
    });
    expect(mgr.getWorkspaceRoot("nope")).toBeUndefined();
    await mgr.create("alive");
    expect(mgr.getWorkspaceRoot("alive")).toBe(join(tmpDir, "wts-x", "alive"));
    await mgr.abandon("alive");
    expect(mgr.getWorkspaceRoot("alive")).toBeUndefined();
  });
});

describe("WorktreeManager — abandon", () => {
  it("transitions active -> abandoned and surfaces in list()", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "c1\n" }],
        ["worktree add -b", { stdout: "" }],
        ["worktree remove", { stdout: "" }],
        ["worktree prune", { stdout: "" }],
        ["branch -D", { stdout: "" }],
      ]),
      [],
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await mgr.create("task-ab");
    const abandoned = await mgr.abandon("task-ab");
    expect(abandoned.status).toBe("abandoned");
    const all = mgr.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe("abandoned");
  });

  it("is idempotent on already-abandoned taskId", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "c1\n" }],
        ["worktree add -b", { stdout: "" }],
      ]),
      [],
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts-idem"),
      gitExec: git,
    });
    await mgr.create("idem");
    await mgr.abandon("idem");
    const second = await mgr.abandon("idem");
    expect(second.status).toBe("abandoned");
  });

  it("throws for unknown taskId", async () => {
    const git = scriptedGit(new Map(), []);
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await expect(mgr.abandon("nope")).rejects.toThrow(WorktreeError);
  });
});

describe("WorktreeManager — accept", () => {
  it("stages + commits + merges when there are pending changes", async () => {
    const calls: GitCall[] = [];
    const git: GitHandler = async (args) => {
      calls.push({ args });
      const key = args.join(" ");
      if (key.startsWith("rev-parse --verify")) return { stdout: "base01\n", stderr: "" };
      if (key.startsWith("worktree add -b")) return { stdout: "", stderr: "" };
      // Inside-worktree calls use `-C <path>` prefix.
      if (args[0] === "-C" && args[2] === "status") {
        // Dirty worktree — pending file to add.
        return { stdout: " M file.ts\n", stderr: "" };
      }
      if (args[0] === "-C" && args[2] === "add") return { stdout: "", stderr: "" };
      if (args[0] === "-C" && args[2] === "commit") return { stdout: "", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
      if (args[0] === "merge") return { stdout: "", stderr: "" };
      if (key.startsWith("rev-parse HEAD")) return { stdout: "mergecommit999\n", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await mgr.create("ta");
    const accepted = await mgr.accept("ta", "feat: my change");
    expect(accepted.status).toBe("accepted");
    expect(accepted.mergeCommit).toBe("mergecommit999");
    // Verify the commit inside the worktree used `-m commitMessage`.
    const commitCall = calls.find((c) => c.args[0] === "-C" && c.args[2] === "commit");
    expect(commitCall?.args).toContain("-m");
    expect(commitCall?.args).toContain("feat: my change");
    // Verify the merge into the main branch was `--no-ff`.
    const mergeCall = calls.find((c) => c.args[0] === "merge");
    expect(mergeCall?.args).toContain("--no-ff");
  });

  it("no-ops merge if branch has zero commits beyond base", async () => {
    const git: GitHandler = async (args) => {
      const key = args.join(" ");
      if (key.startsWith("rev-parse --verify")) return { stdout: "base\n", stderr: "" };
      if (key.startsWith("worktree add -b")) return { stdout: "", stderr: "" };
      if (args[0] === "-C" && args[2] === "status") return { stdout: "", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\n", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts-noop"),
      gitExec: git,
    });
    await mgr.create("empty-work");
    const accepted = await mgr.accept("empty-work", "feat: noop");
    expect(accepted.status).toBe("accepted");
    expect(accepted.mergeCommit).toBeUndefined();
  });

  it("aborts merge and throws WorktreeError when merge fails", async () => {
    const git: GitHandler = async (args) => {
      const key = args.join(" ");
      if (key.startsWith("rev-parse --verify")) return { stdout: "base\n", stderr: "" };
      if (key.startsWith("worktree add -b")) return { stdout: "", stderr: "" };
      if (args[0] === "-C" && args[2] === "status") return { stdout: "", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "3\n", stderr: "" };
      if (args[0] === "merge" && args[1] === "--abort") return { stdout: "", stderr: "" };
      if (args[0] === "merge") {
        const err = new Error("conflict") as Error & { stderr?: string };
        err.stderr = "CONFLICT (content)";
        throw err;
      }
      return { stdout: "", stderr: "" };
    };
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts-bad"),
      gitExec: git,
    });
    await mgr.create("bad");
    await expect(mgr.accept("bad", "feat: will conflict")).rejects.toThrow(WorktreeError);
  });

  it("rejects empty commit message", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "b\n" }],
        ["worktree add -b", { stdout: "" }],
      ]),
      [],
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts-m"),
      gitExec: git,
    });
    await mgr.create("task-x");
    await expect(mgr.accept("task-x", "   ")).rejects.toThrow(WorktreeError);
  });

  it("rejects accept on abandoned taskId", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "b\n" }],
        ["worktree add -b", { stdout: "" }],
      ]),
      [],
    );
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await mgr.create("task-a2");
    await mgr.abandon("task-a2");
    await expect(mgr.accept("task-a2", "msg")).rejects.toThrow(WorktreeError);
  });
});

describe("WorktreeManager — per-session isolation (QB #7)", () => {
  it("two managers with same repoRoot do NOT share state", async () => {
    const git = scriptedGit(
      new Map([
        ["rev-parse --verify", { stdout: "c\n" }],
        ["worktree add -b", { stdout: "" }],
      ]),
      [],
    );
    const m1 = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    const m2 = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await m1.create("only-in-1");
    expect(m1.list()).toHaveLength(1);
    // m2 never saw the create — its map is instance-local.
    expect(m2.list()).toHaveLength(0);
    expect(m2.getWorkspaceRoot("only-in-1")).toBeUndefined();
  });
});

describe("WorktreeManager — security: no shell injection", () => {
  it("every git invocation uses argv array (execFile style), not shell", async () => {
    const calls: string[][] = [];
    const git: GitHandler = async (args) => {
      calls.push([...args]);
      if (args.join(" ").startsWith("rev-parse --verify")) {
        return { stdout: "safe-sha\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };
    const mgr = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: git,
    });
    await mgr.create("task-sec");
    // No single call should contain shell metacharacters in a single
    // argument — each arg is a discrete token.
    for (const call of calls) {
      for (const arg of call) {
        // Strict: no semicolons, ampersands, pipes, backticks, $()
        expect(arg).not.toMatch(/[;&|`]/);
        expect(arg).not.toMatch(/\$\(/);
      }
    }
  });
});
