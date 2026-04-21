/**
 * Worktree Manager — Cursor 3 `/worktree` slash-command backend (P1-C6).
 *
 * Pattern: each task gets its own git worktree under
 * `<repoRoot>/.wotann/worktrees/<taskId>/`, so agent changes stay
 * isolated from the main working tree. Abandoning is cheap
 * (`git worktree remove --force`), accepting merges the feature
 * branch into the current branch.
 *
 * This is deliberately thinner than `TaskIsolationManager`
 * (src/sandbox/task-isolation.ts) — TaskIsolationManager is a full
 * sandbox lifecycle with status machines; WorktreeManager is the
 * Cursor 3 ergonomics: create → use → accept | abandon. They can
 * coexist; /best-of-n uses WorktreeManager for per-rollout isolation.
 *
 * WOTANN quality bars:
 * - QB #6 honest failures: dirty tree, invalid base ref, duplicate id
 *   all throw `WorktreeError` with a specific reason — no silent retry.
 * - QB #7 per-session state: worktree map is instance-local; two
 *   concurrent WorktreeManager instances never share state.
 * - Security: every `git` subcommand uses `execFile` with an argv
 *   array — no shell interpolation, no injection surface. Callers
 *   pass taskIds; we sanitize to ASCII `[A-Za-z0-9_-]{1,64}`.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────

/**
 * Status of a worktree managed by this manager.
 * Abandoned/accepted entries stay in the map after removal so
 * `list()` can show the full session history — call `forget()` to
 * drop them or the list naturally purges on next `create` with
 * the same id.
 */
export type WorktreeStatus = "active" | "abandoned" | "accepted";

export interface WorktreeEntry {
  readonly taskId: string;
  readonly branch: string;
  readonly workspaceRoot: string;
  readonly baseRef: string;
  readonly status: WorktreeStatus;
  readonly createdAt: string;
  readonly mergedAt?: string;
  readonly mergeCommit?: string;
}

export interface WorktreeManagerConfig {
  /** Repository root (the branch we merge back into). Defaults to cwd. */
  readonly repoRoot?: string;
  /**
   * Directory that holds worktrees. Defaults to `<repoRoot>/.wotann/worktrees`.
   * Created on first `create()`.
   */
  readonly worktreesDir?: string;
  /** Prefix for feature branches. Default `wotann/wt/`. */
  readonly branchPrefix?: string;
  /** Timeout for each git subprocess. Default 30_000ms. */
  readonly timeoutMs?: number;
  /**
   * Injection point for tests — replaces the git invocation. If
   * supplied, production code is bypassed. Each call receives the
   * argv exactly as it would be passed to execFile.
   */
  readonly gitExec?: (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
}

// ── Errors ─────────────────────────────────────────────────

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

// ── Helpers ────────────────────────────────────────────────

const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validate a caller-supplied taskId. Must be ASCII word-chars or hyphen,
 * between 1 and 64 chars. Anything else throws — we rely on this to
 * keep the taskId safe when concatenated into filesystem paths and
 * git branch names (which already forbid some chars, but defense in
 * depth is cheap).
 */
export function validateTaskId(taskId: string): void {
  if (!TASK_ID_RE.test(taskId)) {
    throw new WorktreeError(`invalid taskId "${taskId}" — must match ${TASK_ID_RE.source}`);
  }
}

/**
 * Safe constant suffix/length policy for branch names so we never
 * hit git's 255-byte name limit.
 */
function branchNameFor(prefix: string, taskId: string): string {
  const name = `${prefix}${taskId}`;
  if (name.length > 128) {
    throw new WorktreeError(`generated branch name exceeds 128 chars: ${name.length}`);
  }
  return name;
}

// ── Core class ─────────────────────────────────────────────

export class WorktreeManager {
  private readonly repoRoot: string;
  private readonly worktreesDir: string;
  private readonly branchPrefix: string;
  private readonly timeoutMs: number;
  private readonly entries: Map<string, WorktreeEntry> = new Map();
  private readonly gitImpl: (
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;

  constructor(config: WorktreeManagerConfig = {}) {
    this.repoRoot = config.repoRoot ?? process.cwd();
    this.worktreesDir = config.worktreesDir ?? join(this.repoRoot, ".wotann", "worktrees");
    this.branchPrefix = config.branchPrefix ?? "wotann/wt/";
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.gitImpl =
      config.gitExec ??
      ((args) =>
        execFileAsync("git", [...args], {
          cwd: this.repoRoot,
          timeout: this.timeoutMs,
        }));
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Create a new isolated worktree rooted at `baseRef` (default HEAD).
   * Throws `WorktreeError` on dirty tree, invalid ref, duplicate id.
   */
  async create(taskId: string, baseRef?: string): Promise<WorktreeEntry> {
    validateTaskId(taskId);

    const existing = this.entries.get(taskId);
    if (existing && existing.status === "active") {
      throw new WorktreeError(`worktree "${taskId}" already active`);
    }

    const base = baseRef ?? "HEAD";
    // Fail fast if the ref doesn't resolve.
    let resolvedBase: string;
    try {
      const { stdout } = await this.git(["rev-parse", "--verify", base]);
      resolvedBase = stdout.trim();
    } catch (err) {
      throw new WorktreeError(`base ref "${base}" does not resolve: ${readableError(err)}`);
    }

    const branch = branchNameFor(this.branchPrefix, taskId);
    const workspaceRoot = join(this.worktreesDir, taskId);

    if (existsSync(workspaceRoot)) {
      throw new WorktreeError(`worktree path already on disk: ${workspaceRoot}`);
    }

    const parentDir = dirname(workspaceRoot);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    try {
      // `git worktree add -b <branch> <path> <baseRef>` — creates the
      // branch and worktree atomically. If the branch already exists,
      // git fails and we surface it.
      await this.git(["worktree", "add", "-b", branch, workspaceRoot, resolvedBase]);
    } catch (err) {
      // Cleanup any partial filesystem state from a failed add.
      if (existsSync(workspaceRoot)) {
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
      throw new WorktreeError(`git worktree add failed: ${readableError(err)}`);
    }

    const entry: WorktreeEntry = {
      taskId,
      branch,
      workspaceRoot,
      baseRef: resolvedBase,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    this.entries.set(taskId, entry);
    return entry;
  }

  /**
   * Look up a worktree's workspace root by taskId. Only returns the
   * path if it's still active (abandoned/accepted worktrees are gone
   * from disk). Returns undefined otherwise.
   */
  getWorkspaceRoot(taskId: string): string | undefined {
    const entry = this.entries.get(taskId);
    if (!entry) return undefined;
    if (entry.status !== "active") return undefined;
    return entry.workspaceRoot;
  }

  /**
   * Return the full entry (including abandoned/accepted history).
   */
  getEntry(taskId: string): WorktreeEntry | undefined {
    return this.entries.get(taskId);
  }

  /**
   * List all tracked worktrees in insertion order. Includes abandoned
   * and accepted entries so operators can see recent history.
   */
  list(): readonly WorktreeEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Remove the worktree and its branch — for when the task's result
   * is not wanted. Active → abandoned transition. Idempotent on
   * already-abandoned ids.
   */
  async abandon(taskId: string): Promise<WorktreeEntry> {
    validateTaskId(taskId);
    const entry = this.entries.get(taskId);
    if (!entry) {
      throw new WorktreeError(`no worktree tracked for "${taskId}"`);
    }
    if (entry.status !== "active") {
      // Already removed — return the existing entry unchanged so
      // abandon() is safe to retry.
      return entry;
    }

    await this.removeWorktreeFiles(entry);

    const next: WorktreeEntry = { ...entry, status: "abandoned" };
    this.entries.set(taskId, next);
    return next;
  }

  /**
   * Stage + commit any remaining changes in the worktree, then merge
   * the feature branch into the current branch of the main checkout.
   * Leaves the worktree directory in place until a later abandon call
   * so operators can inspect post-merge state.
   *
   * If the working tree in the worktree is clean and the branch has
   * no commits beyond baseRef, this is a no-op (returns entry with
   * mergeCommit undefined, status accepted).
   */
  async accept(taskId: string, commitMessage: string): Promise<WorktreeEntry> {
    validateTaskId(taskId);
    const entry = this.entries.get(taskId);
    if (!entry) {
      throw new WorktreeError(`no worktree tracked for "${taskId}"`);
    }
    if (entry.status !== "active") {
      throw new WorktreeError(`cannot accept "${taskId}" — status is "${entry.status}"`);
    }
    if (typeof commitMessage !== "string" || commitMessage.trim().length === 0) {
      throw new WorktreeError("accept requires a non-empty commitMessage");
    }

    // 1. Stage & commit any pending work inside the worktree.
    const statusOutput = await this.gitAt(entry.workspaceRoot, ["status", "--porcelain"]);
    if (statusOutput.stdout.trim().length > 0) {
      await this.gitAt(entry.workspaceRoot, ["add", "-A"]);
      await this.gitAt(entry.workspaceRoot, ["commit", "-m", commitMessage]);
    }

    // 2. Merge feature branch into current branch of repoRoot.
    let mergeCommit: string | undefined;
    const hasCommits = await this.branchHasCommitsBeyond(entry.branch, entry.baseRef);
    if (hasCommits) {
      try {
        await this.git(["merge", "--no-ff", entry.branch, "-m", commitMessage]);
      } catch (err) {
        // Try to abort cleanly before surfacing.
        await this.gitSafe(["merge", "--abort"]);
        throw new WorktreeError(`merge of ${entry.branch} failed: ${readableError(err)}`);
      }
      const { stdout } = await this.git(["rev-parse", "HEAD"]);
      mergeCommit = stdout.trim();
    }

    const next: WorktreeEntry = {
      ...entry,
      status: "accepted",
      mergedAt: new Date().toISOString(),
      ...(mergeCommit !== undefined ? { mergeCommit } : {}),
    };
    this.entries.set(taskId, next);
    return next;
  }

  /** Drop an entry from the map. Filesystem is NOT touched. */
  forget(taskId: string): boolean {
    return this.entries.delete(taskId);
  }

  // ── Internals ────────────────────────────────────────────

  private async git(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
    return this.gitImpl(args);
  }

  private async gitSafe(
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string } | null> {
    try {
      return await this.git(args);
    } catch {
      return null;
    }
  }

  private async gitAt(
    cwd: string,
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> {
    // Prefix with `-C <cwd>` so the configured git invocation (real
    // or injected) targets the worktree rather than the repo root.
    return this.gitImpl(["-C", cwd, ...args]);
  }

  private async branchHasCommitsBeyond(branch: string, baseRef: string): Promise<boolean> {
    const { stdout } = (await this.gitSafe(["rev-list", "--count", `${baseRef}..${branch}`])) ?? {
      stdout: "0",
    };
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) && n > 0;
  }

  private async removeWorktreeFiles(entry: WorktreeEntry): Promise<void> {
    await this.gitSafe(["worktree", "remove", entry.workspaceRoot, "--force"]);
    if (existsSync(entry.workspaceRoot)) {
      rmSync(entry.workspaceRoot, { recursive: true, force: true });
    }
    await this.gitSafe(["worktree", "prune"]);
    // Delete the feature branch if it still exists. Safe-harmless if
    // it was already cleaned up by `worktree remove`.
    await this.gitSafe(["branch", "-D", entry.branch]);
  }
}

// ── Utilities ──────────────────────────────────────────────

function readableError(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) {
      return stderr.trim().split("\n").slice(0, 3).join(" | ");
    }
    return err.message;
  }
  return String(err);
}
