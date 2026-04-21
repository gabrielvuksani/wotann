/**
 * Tests for `wotann worktree` — Cursor 3 /worktree slash command (P1-C6).
 *
 * Uses WorktreeManager with the `gitExec` injection hook, then feeds
 * it into the CLI handler.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorktreeManager } from "../../src/orchestration/worktree-manager.js";
import {
  parseWorktreeArgs,
  runWorktreeCommand,
} from "../../src/cli/commands/worktree.js";

// ── Mock git ──────────────────────────────────────────────

type GitHandler = (
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

function okGit(
  pairs: ReadonlyArray<readonly [string, { stdout?: string; stderr?: string }]>,
): GitHandler {
  const map = new Map(pairs);
  return async (args) => {
    const key = args.slice(0, 4).join(" ");
    const keys = [...map.keys()].sort((a, b) => b.length - a.length);
    const match = keys.find((k) => args.join(" ").startsWith(k) || key.startsWith(k));
    const resp = match !== undefined ? map.get(match) : undefined;
    return { stdout: resp?.stdout ?? "", stderr: resp?.stderr ?? "" };
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wotann-wt-cli-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeManager(git: GitHandler): WorktreeManager {
  return new WorktreeManager({
    repoRoot: tmpDir,
    worktreesDir: join(tmpDir, "wts"),
    gitExec: git,
  });
}

// ── Tests ─────────────────────────────────────────────────

describe("runWorktreeCommand — create", () => {
  it("succeeds, emits ✓ line and structured entry", async () => {
    const git = okGit([
      ["rev-parse --verify", { stdout: "abcdef12\n" }],
      ["worktree add -b", { stdout: "" }],
    ]);
    const manager = makeManager(git);
    const result = await runWorktreeCommand({
      action: "create",
      taskId: "task-1",
      manager,
    });
    expect(result.success).toBe(true);
    expect(result.entries[0]?.taskId).toBe("task-1");
    expect(result.lines[0]).toContain("✓");
    expect(result.lines.join("\n")).toContain("wotann/wt/task-1");
  });

  it("surfaces WorktreeError (e.g. invalid base ref) as structured failure", async () => {
    const git: GitHandler = async (args) => {
      if (args[0] === "rev-parse") throw new Error("unknown revision");
      return { stdout: "", stderr: "" };
    };
    const manager = makeManager(git);
    const result = await runWorktreeCommand({
      action: "create",
      taskId: "task-bad-ref",
      base: "no-such-ref",
      manager,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.lines[0]).toMatch(/error:/);
  });

  it("create without taskId returns error", async () => {
    const git = okGit([]);
    const manager = makeManager(git);
    const result = await runWorktreeCommand({ action: "create", manager });
    expect(result.success).toBe(false);
    expect(result.error).toContain("<taskId>");
  });
});

describe("runWorktreeCommand — list", () => {
  it("empty list prints no-worktrees line", async () => {
    const git = okGit([]);
    const manager = makeManager(git);
    const result = await runWorktreeCommand({ action: "list", manager });
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(0);
    expect(result.lines[0]).toContain("no worktrees");
  });

  it("shows active + abandoned entries with status glyphs", async () => {
    const git = okGit([
      ["rev-parse --verify", { stdout: "base\n" }],
      ["worktree add -b", { stdout: "" }],
    ]);
    const manager = makeManager(git);
    await runWorktreeCommand({ action: "create", taskId: "alive", manager });
    await runWorktreeCommand({ action: "create", taskId: "gone", manager });
    await runWorktreeCommand({ action: "abandon", taskId: "gone", manager });
    const result = await runWorktreeCommand({ action: "list", manager });
    expect(result.entries).toHaveLength(2);
    const joined = result.lines.join("\n");
    expect(joined).toContain("alive");
    expect(joined).toContain("gone");
    expect(joined).toContain("active");
    expect(joined).toContain("abandoned");
  });
});

describe("runWorktreeCommand — abandon", () => {
  it("removes filesystem + git ref, returns status=abandoned", async () => {
    const git = okGit([
      ["rev-parse --verify", { stdout: "base\n" }],
      ["worktree add -b", { stdout: "" }],
      ["worktree remove", { stdout: "" }],
      ["worktree prune", { stdout: "" }],
      ["branch -D", { stdout: "" }],
    ]);
    const manager = makeManager(git);
    await runWorktreeCommand({ action: "create", taskId: "to-abandon", manager });
    const result = await runWorktreeCommand({
      action: "abandon",
      taskId: "to-abandon",
      manager,
    });
    expect(result.success).toBe(true);
    expect(result.entries[0]?.status).toBe("abandoned");
  });

  it("abandon without taskId returns error", async () => {
    const manager = makeManager(okGit([]));
    const result = await runWorktreeCommand({ action: "abandon", manager });
    expect(result.success).toBe(false);
  });
});

describe("runWorktreeCommand — accept", () => {
  it("stages + commits + merges, returns mergeCommit", async () => {
    const git: GitHandler = async (args) => {
      const key = args.join(" ");
      if (key.startsWith("rev-parse --verify")) return { stdout: "base\n", stderr: "" };
      if (key.startsWith("worktree add -b")) return { stdout: "", stderr: "" };
      if (args[0] === "-C" && args[2] === "status") return { stdout: " M f.ts\n", stderr: "" };
      if (args[0] === "-C" && args[2] === "add") return { stdout: "", stderr: "" };
      if (args[0] === "-C" && args[2] === "commit") return { stdout: "", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
      if (args[0] === "merge") return { stdout: "", stderr: "" };
      if (key.startsWith("rev-parse HEAD")) return { stdout: "mergeHEAD\n", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const manager = makeManager(git);
    await runWorktreeCommand({ action: "create", taskId: "to-accept", manager });
    const result = await runWorktreeCommand({
      action: "accept",
      taskId: "to-accept",
      message: "feat: accept me",
      manager,
    });
    expect(result.success).toBe(true);
    expect(result.entries[0]?.status).toBe("accepted");
    expect(result.entries[0]?.mergeCommit).toBe("mergeHEAD");
  });

  it("accept without --message returns error", async () => {
    const git = okGit([
      ["rev-parse --verify", { stdout: "b\n" }],
      ["worktree add -b", { stdout: "" }],
    ]);
    const manager = makeManager(git);
    await runWorktreeCommand({ action: "create", taskId: "no-msg", manager });
    const result = await runWorktreeCommand({
      action: "accept",
      taskId: "no-msg",
      manager,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("--message");
  });
});

describe("runWorktreeCommand — parseWorktreeArgs", () => {
  it("lowercases and normalizes action verb", () => {
    const parsed = parseWorktreeArgs("CREATE", "t1", {});
    expect(parsed.action).toBe("create");
    expect(parsed.taskId).toBe("t1");
  });

  it("rejects unknown action with WorktreeError", () => {
    expect(() => parseWorktreeArgs("destroy", "t1", {})).toThrow();
  });

  it("passes through base and message options", () => {
    const parsed = parseWorktreeArgs("accept", "t1", {
      message: "ship it",
      base: "main",
    });
    expect(parsed.message).toBe("ship it");
    expect(parsed.base).toBe("main");
  });
});

describe("runWorktreeCommand — per-session isolation (QB #7)", () => {
  it("two concurrent command runs do not cross-contaminate", async () => {
    const git = okGit([
      ["rev-parse --verify", { stdout: "c\n" }],
      ["worktree add -b", { stdout: "" }],
    ]);
    const m1 = makeManager(git);
    const m2 = makeManager(git);
    await runWorktreeCommand({ action: "create", taskId: "t-only-1", manager: m1 });
    const list2 = await runWorktreeCommand({ action: "list", manager: m2 });
    expect(list2.entries).toHaveLength(0);
  });
});
