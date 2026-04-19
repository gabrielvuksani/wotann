/**
 * Shadow Git: maintains a SEPARATE git repo for per-turn snapshots.
 * The user's .git is NEVER touched. Safe subprocess execution only.
 *
 * S3-3 adds auto-checkpoint semantics inspired by hermes's
 * `checkpoint_manager.py`: snapshot before every mutating tool call
 * (Write/Edit/NotebookEdit/Bash with destructive flags) so any turn can
 * be rolled back cheaply. The existing API (initialize/createCheckpoint/
 * restore/listCheckpoints) is unchanged; we layer ShadowGit.beforeTool()
 * + ShadowGit.afterTool() on top for hook integration.
 *
 * Phase D (Hermes pattern #2) adds ghost-branch checkpoints via git
 * plumbing (write-tree/commit-tree/update-ref) under the
 * `refs/wotann-ghost/<id>` namespace. Plumbing avoids touching HEAD or
 * the reflog so labelled snapshots accumulate without disturbing the
 * linear commit history used by the auto-snapshot hooks. Ghost
 * checkpoints are addressable by a short logical ID (returned to the
 * caller) and can be listed, rolled back, or diffed pairwise.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);

/**
 * Tool names that mutate the working tree. Hooks call `beforeTool(toolName)`
 * for these names and ShadowGit snapshots before the tool runs.
 */
const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "Write",
  "Edit",
  "NotebookEdit",
  "MultiEdit",
  "HashlineEdit",
]);

export interface ShadowCheckpoint {
  readonly hash: string;
  readonly label: string;
  readonly timestamp: number;
  readonly toolName?: string;
}

/**
 * Logical identifier for a ghost-branch checkpoint — opaque string the
 * caller uses to refer back to a snapshot. Internally maps to a ref at
 * `refs/wotann-ghost/<id>`.
 */
export type CheckpointId = string;

export interface GhostCheckpoint {
  readonly id: CheckpointId;
  readonly hash: string;
  readonly label: string;
  readonly timestamp: number;
  readonly ref: string;
}

export interface DiffSummary {
  readonly idA: CheckpointId;
  readonly idB: CheckpointId;
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly files: readonly string[];
}

/** Ref namespace for ghost checkpoints — keeps them out of HEAD/reflog. */
const GHOST_REF_PREFIX = "refs/wotann-ghost";

export class ShadowGit {
  private readonly shadowDir: string;
  private readonly workDir: string;
  private initialized: boolean = false;
  private readonly recentCheckpoints: ShadowCheckpoint[] = [];
  /** Max recent-checkpoints to retain in memory for quick restore(). */
  private static readonly RECENT_MAX = 50;

  constructor(workDir: string, shadowDir?: string) {
    this.workDir = workDir;
    this.shadowDir = shadowDir ?? join(workDir, ".wotann", ".shadow-git");
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    if (!existsSync(this.shadowDir)) {
      mkdirSync(this.shadowDir, { recursive: true });
    }

    try {
      await execFileAsync("git", ["init", "--bare", this.shadowDir], { cwd: this.workDir });
      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  async createCheckpoint(label: string): Promise<string> {
    if (!this.initialized) await this.initialize();

    try {
      await this.git(["add", "-A"]);
      await this.git(["commit", "-m", label, "--allow-empty"]);
      const { stdout } = await this.git(["rev-parse", "HEAD"]);
      return stdout.trim();
    } catch {
      return "";
    }
  }

  /**
   * Auto-snapshot before a tool call if the tool is in MUTATING_TOOLS.
   * Returns the checkpoint hash (empty string if snapshotting failed
   * or the tool isn't one we track — callers should treat empty as a
   * no-op, not an error).
   */
  async beforeTool(toolName: string, context?: string): Promise<string> {
    if (!MUTATING_TOOLS.has(toolName)) return "";
    const label = context ? `auto: ${toolName} · ${context.slice(0, 80)}` : `auto: ${toolName}`;
    const hash = await this.createCheckpoint(label);
    if (hash) {
      this.recentCheckpoints.push({
        hash,
        label,
        timestamp: Date.now(),
        toolName,
      });
      if (this.recentCheckpoints.length > ShadowGit.RECENT_MAX) {
        this.recentCheckpoints.shift();
      }
    }
    return hash;
  }

  /**
   * Record a post-tool "successful" marker so the recent-checkpoints list
   * can show which snapshots led to stable states. Purely bookkeeping —
   * the checkpoint itself already committed via `beforeTool`.
   */
  markStable(hash: string): void {
    if (!hash) return;
    const entry = this.recentCheckpoints.find((c) => c.hash === hash);
    if (entry) {
      // We mutate the in-memory cache here (a controlled local buffer); the
      // underlying git commit is still immutable on disk.
      (entry as { stable?: boolean }).stable = true;
    }
  }

  /** Read the in-memory tail of recent checkpoints (most recent last). */
  getRecentCheckpoints(): readonly ShadowCheckpoint[] {
    return this.recentCheckpoints;
  }

  async restore(hash: string): Promise<boolean> {
    if (!hash) return false;

    try {
      await this.git(["reset", "--hard", hash]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restore the most recent checkpoint that was created before a named
   * tool ran. Useful for "undo the last edit" workflows without the agent
   * having to remember hashes.
   */
  async restoreLastBefore(toolName: string): Promise<boolean> {
    const target = [...this.recentCheckpoints].reverse().find((c) => c.toolName === toolName);
    if (!target) return false;
    return this.restore(target.hash);
  }

  async listCheckpoints(limit: number = 10): Promise<readonly string[]> {
    try {
      const { stdout } = await this.git(["log", "--oneline", `-${limit}`]);
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  // ── Ghost-branch checkpoints (Phase D — Hermes pattern) ───────────
  //
  // Ghost checkpoints live under `refs/wotann-ghost/<id>` and are built
  // from git plumbing (write-tree + commit-tree + update-ref). They do
  // NOT touch HEAD and do NOT write to the reflog. This lets labelled
  // snapshots accumulate alongside the auto-commit stream from
  // `createCheckpoint`/`beforeTool` without polluting either history.
  //
  // Invariants:
  // - Each ghost ref points to a commit whose tree is a snapshot of the
  //   current working tree at the moment of capture.
  // - The ref name encodes a random short ID — callers never need to
  //   pass the full ref path; `rollbackToCheckpoint` and
  //   `diffCheckpoints` resolve the ID internally.
  // - If the underlying shadow repo has no parent commit yet, the ghost
  //   is created as an orphan (no parent), which git handles natively.

  /**
   * Snapshot the current agent workspace to a ghost-branch under
   * `refs/wotann-ghost/<id>` and return the opaque ID. Uses git
   * plumbing (write-tree → commit-tree → update-ref) so the user's
   * reflog and HEAD are never touched.
   *
   * Returns the empty string on error so callers can treat the result
   * as a no-op rather than an exception.
   */
  async createGhostCheckpoint(label: string): Promise<CheckpointId> {
    if (!this.initialized) await this.initialize();

    try {
      // Stage the entire working tree into the shadow index. Without
      // this, `write-tree` would snapshot the previous staged state.
      await this.git(["add", "-A"]);

      // Plumbing step 1: write the current index to a tree object.
      const treeResult = await this.git(["write-tree"]);
      const treeSha = treeResult.stdout.trim();
      if (!treeSha) return "";

      // Plumbing step 2: build a commit object from the tree. Parent is
      // whatever HEAD points at, if anything — falling back to orphan
      // when the shadow repo is empty.
      const parentArgs: string[] = [];
      try {
        const headResult = await this.git(["rev-parse", "HEAD"]);
        const headSha = headResult.stdout.trim();
        if (headSha) parentArgs.push("-p", headSha);
      } catch {
        /* empty shadow repo — orphan commit is fine */
      }

      const commitResult = await this.git(["commit-tree", treeSha, ...parentArgs, "-m", label]);
      const commitSha = commitResult.stdout.trim();
      if (!commitSha) return "";

      // Plumbing step 3: bind the commit to a ghost ref. ID is derived
      // from the timestamp + 6 random bytes for collision resistance,
      // yielding short but unique identifiers across a session.
      const id = makeCheckpointId();
      const ref = ghostRef(id);
      await this.git(["update-ref", ref, commitSha]);

      return id;
    } catch {
      return "";
    }
  }

  /**
   * List all ghost checkpoints currently stored under
   * `refs/wotann-ghost/*`, ordered oldest-first (ascending by commit
   * time). Returns an empty array if none exist or the listing fails.
   */
  async listGhostCheckpoints(): Promise<readonly GhostCheckpoint[]> {
    if (!this.initialized) await this.initialize();

    try {
      const format = "%(refname)\x1f%(objectname)\x1f%(committerdate:unix)\x1f%(contents:subject)";
      const { stdout } = await this.git([
        "for-each-ref",
        `--format=${format}`,
        "--sort=committerdate",
        GHOST_REF_PREFIX,
      ]);

      if (!stdout.trim()) return [];

      const result: GhostCheckpoint[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const [ref, hash, ts, ...subjectParts] = line.split("\x1f");
        if (!ref || !hash) continue;
        const id = ref.slice(GHOST_REF_PREFIX.length + 1);
        if (!id) continue;
        result.push({
          id,
          hash,
          label: (subjectParts.join("\x1f") ?? "").trim(),
          // git emits committerdate in seconds; store in ms for parity
          // with ShadowCheckpoint.timestamp.
          timestamp: Number(ts ?? "0") * 1000,
          ref,
        });
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Restore the working tree to the state captured by a ghost
   * checkpoint. Uses `read-tree --reset -u` (plumbing) so HEAD on the
   * shadow repo's default branch is unchanged — only the working tree
   * and the shadow index move.
   */
  async rollbackToCheckpoint(id: CheckpointId): Promise<boolean> {
    if (!id) return false;
    if (!this.initialized) await this.initialize();

    const ref = ghostRef(id);

    try {
      // Verify the ref exists before attempting the rollback so we can
      // distinguish "no such checkpoint" from a hard failure.
      const exists = await this.git(["rev-parse", "--verify", ref]);
      if (!exists.stdout.trim()) return false;
    } catch {
      return false;
    }

    try {
      // read-tree is plumbing — it updates the index + working tree
      // without touching HEAD. --reset discards stale index entries,
      // -u syncs the working tree. This is the plumbing equivalent of
      // `git reset --hard <ref>` without the reflog write.
      await this.git(["read-tree", "--reset", "-u", ref]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Summarise the diff between two ghost checkpoints. Uses
   * `diff-tree --numstat` (plumbing) to get file-level insertion and
   * deletion counts.
   */
  async diffCheckpoints(idA: CheckpointId, idB: CheckpointId): Promise<DiffSummary> {
    const empty: DiffSummary = {
      idA,
      idB,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      files: [],
    };

    if (!idA || !idB) return empty;
    if (!this.initialized) await this.initialize();

    const refA = ghostRef(idA);
    const refB = ghostRef(idB);

    try {
      const { stdout } = await this.git([
        "diff-tree",
        "-r",
        "--numstat",
        "--no-commit-id",
        refA,
        refB,
      ]);

      const files: string[] = [];
      let insertions = 0;
      let deletions = 0;

      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // numstat format: "<added>\t<deleted>\t<path>". Binary files
        // emit "-\t-\t<path>" — treat them as changed-but-uncounted.
        const [addStr, delStr, ...pathParts] = trimmed.split("\t");
        const path = pathParts.join("\t");
        if (!path) continue;
        files.push(path);
        const add = Number(addStr);
        const del = Number(delStr);
        if (Number.isFinite(add)) insertions += add;
        if (Number.isFinite(del)) deletions += del;
      }

      return {
        idA,
        idB,
        filesChanged: files.length,
        insertions,
        deletions,
        files,
      };
    } catch {
      return empty;
    }
  }

  private async git(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
    const env = {
      ...process.env,
      GIT_DIR: this.shadowDir,
      GIT_WORK_TREE: this.workDir,
      GIT_AUTHOR_NAME: process.env["GIT_AUTHOR_NAME"] ?? "WOTANN",
      GIT_AUTHOR_EMAIL: process.env["GIT_AUTHOR_EMAIL"] ?? "wotann@local",
      GIT_COMMITTER_NAME: process.env["GIT_COMMITTER_NAME"] ?? "WOTANN",
      GIT_COMMITTER_EMAIL: process.env["GIT_COMMITTER_EMAIL"] ?? "wotann@local",
    };

    return execFileAsync("git", [...args], { env, cwd: this.workDir });
  }
}

// ── Ghost-ref helpers ────────────────────────────────────────────────

/**
 * Resolve a logical checkpoint id to the full ref path. Kept separate
 * from the class so the ref-name format is verified by tests without
 * needing a ShadowGit instance.
 */
function ghostRef(id: CheckpointId): string {
  return `${GHOST_REF_PREFIX}/${id}`;
}

/**
 * Generate a short, sortable, collision-resistant checkpoint ID.
 * Format: `<base36-timestamp>-<12-hex-chars>`. Timestamp prefix makes
 * IDs naturally sortable in the filesystem ref store; random suffix
 * covers the very-rare same-ms collision.
 */
function makeCheckpointId(): CheckpointId {
  const ts = Date.now().toString(36);
  const rand = randomBytes(6).toString("hex");
  return `${ts}-${rand}`;
}
