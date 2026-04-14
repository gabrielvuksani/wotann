/**
 * Shadow Git: maintains a SEPARATE git repo for per-turn snapshots.
 * The user's .git is NEVER touched. Safe subprocess execution only.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export class ShadowGit {
  private readonly shadowDir: string;
  private readonly workDir: string;
  private initialized: boolean = false;

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

  async restore(hash: string): Promise<boolean> {
    if (!hash) return false;

    try {
      await this.git(["reset", "--hard", hash]);
      return true;
    } catch {
      return false;
    }
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
