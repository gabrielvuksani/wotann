/**
 * Auto-Archive on PR Merge (DX7) — Jean-inspired cleanup.
 *
 * When a PR merges, automatically:
 * 1. Archive the associated conversation/session to disk
 * 2. Clean up git worktrees for the merged branch
 * 3. Delete the remote branch (if configured)
 * 4. Log the archive event for audit
 *
 * Integrates with the hook engine via the standard hook lifecycle.
 */

import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────

export interface ArchiveResult {
  readonly prNumber: number;
  readonly conversationId?: string;
  readonly worktreeRemoved: boolean;
  readonly sessionArchived: boolean;
  readonly branchDeleted: boolean;
  readonly archivePath?: string;
  readonly timestamp: number;
}

export interface AutoArchiveConfig {
  readonly enabled: boolean;
  readonly removeWorktrees: boolean;
  readonly archiveSessions: boolean;
  readonly deleteRemoteBranch: boolean;
  readonly archiveDir: string;
  readonly webhookSecret?: string;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly prNumber: number;
  readonly branchName: string;
  readonly messages: readonly string[];
  readonly filesChanged: readonly string[];
  readonly totalCost?: number;
  readonly totalTokens?: number;
}

// ── Auto-Archive Hook ────────────────────────────────────

export class AutoArchiveHook {
  private readonly config: AutoArchiveConfig;
  private readonly archiveLog: ArchiveResult[] = [];

  constructor(config?: Partial<AutoArchiveConfig>) {
    this.config = {
      enabled: true,
      removeWorktrees: true,
      archiveSessions: true,
      deleteRemoteBranch: false,
      archiveDir: ".wotann/archives",
      ...config,
    };
  }

  /**
   * Handle a PR merge event.
   * Called from the GitHub webhook channel adapter.
   */
  async onPRMerge(
    prNumber: number,
    branchName: string,
    session?: SessionSnapshot,
  ): Promise<ArchiveResult> {
    let result: ArchiveResult = {
      prNumber,
      conversationId: session?.conversationId,
      worktreeRemoved: false,
      sessionArchived: false,
      branchDeleted: false,
      timestamp: Date.now(),
    };

    if (!this.config.enabled) return result;

    // Archive session to disk
    if (this.config.archiveSessions && session) {
      const archiveResult = await this.archiveSession(session);
      result = { ...result, sessionArchived: archiveResult.success, archivePath: archiveResult.path };
    }

    // Remove associated git worktree
    if (this.config.removeWorktrees) {
      const removed = await this.removeWorktree(branchName);
      result = { ...result, worktreeRemoved: removed };
    }

    // Delete remote branch
    if (this.config.deleteRemoteBranch) {
      const deleted = await this.deleteRemoteBranch(branchName);
      result = { ...result, branchDeleted: deleted };
    }

    this.archiveLog.push(result);
    return result;
  }

  /**
   * Get the archive log of all processed PR merges.
   */
  getArchiveLog(): readonly ArchiveResult[] {
    return [...this.archiveLog];
  }

  // ── Private ────────────────────────────────────────────

  /**
   * Archive a session snapshot to disk as JSON.
   */
  private async archiveSession(
    session: SessionSnapshot,
  ): Promise<{ success: boolean; path?: string }> {
    try {
      await mkdir(this.config.archiveDir, { recursive: true });
      const filename = `pr-${session.prNumber}-${session.sessionId}-${Date.now()}.json`;
      const archivePath = join(this.config.archiveDir, filename);

      const archiveData = {
        ...session,
        archivedAt: new Date().toISOString(),
      };

      await writeFile(archivePath, JSON.stringify(archiveData, null, 2), "utf-8");
      return { success: true, path: archivePath };
    } catch {
      return { success: false };
    }
  }

  /**
   * Remove a git worktree associated with a branch.
   */
  private async removeWorktree(branchName: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"]);
      const lines = stdout.split("\n");

      for (const line of lines) {
        if (line.startsWith("worktree ") && line.includes(branchName)) {
          const worktreePath = line.replace("worktree ", "").trim();
          if (existsSync(worktreePath)) {
            await execFileAsync("git", ["worktree", "remove", "--force", worktreePath]);
            return true;
          }
        }
      }
    } catch {
      // Git operation failed — not critical
    }
    return false;
  }

  /**
   * Delete the remote branch after merge.
   */
  private async deleteRemoteBranch(branchName: string): Promise<boolean> {
    // Never delete main/master/develop branches
    const protectedBranches = ["main", "master", "develop", "staging", "production"];
    if (protectedBranches.includes(branchName)) {
      return false;
    }

    try {
      await execFileAsync("git", ["push", "origin", "--delete", branchName]);
      return true;
    } catch {
      return false;
    }
  }
}
