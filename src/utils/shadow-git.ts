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
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
