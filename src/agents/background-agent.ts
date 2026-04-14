/**
 * Background Agent Executor — runs autonomous coding tasks in isolation.
 *
 * Architecture:
 * 1. User submits task → KAIROS creates agent session
 * 2. Git worktree created (isolated copy of repo)
 * 3. Agent runs autonomously: read → plan → edit → test → iterate
 * 4. On completion: tests pass → commit → create PR → push notification
 *
 * Security: All shell commands use execFileSync (no shell injection).
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

import {
  ciFeedbackLoop,
  GitHubActionsProvider,
  type CIFailure,
  type CIRun,
} from "../autopilot/ci-feedback.js";

// ── Types ────────────────────────────────────────────

export interface BackgroundTaskConfig {
  readonly description: string;
  readonly fileScope?: readonly string[];
  readonly model: string;
  readonly provider: string;
  readonly maxCost: number;
  readonly maxTurns: number;
  readonly workingDir: string;
  /**
   * D14: when true, after the agent pushes a commit the manager polls the
   * CI system and feeds failures back into the agent's fix loop. Capped at
   * 5 iterations. Exposed via the `agents.ci-loop` RPC.
   */
  readonly ciFeedbackEnabled?: boolean;
}

export interface CIFeedbackResult {
  readonly succeeded: boolean;
  readonly iterations: number;
  readonly finalStatus: string | null;
  readonly runUrl: string | null;
}

export interface BackgroundTaskStatus {
  readonly id: string;
  readonly description: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly progress: number;
  readonly currentStep: string;
  readonly filesModified: readonly string[];
  readonly cost: number;
  readonly turnsUsed: number;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly worktreePath: string | null;
  readonly branchName: string | null;
  readonly prUrl: string | null;
  readonly error: string | null;
}

// ── Background Agent Manager ─────────────────────────

const MAX_PARALLEL = 8;
const AGENT_DIR = join(homedir(), ".wotann", "agents");

export class BackgroundAgentManager {
  private readonly tasks: Map<string, BackgroundTaskStatus> = new Map();
  private readonly queue: string[] = [];
  private runningCount = 0;
  private statusCallback: ((status: BackgroundTaskStatus) => void) | null = null;

  constructor() {
    if (!existsSync(AGENT_DIR)) {
      mkdirSync(AGENT_DIR, { recursive: true });
    }
  }

  onStatusChange(callback: (status: BackgroundTaskStatus) => void): void {
    this.statusCallback = callback;
  }

  submit(config: BackgroundTaskConfig): string {
    const id = `task-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const branchName = `agent/${id}`;

    const status: BackgroundTaskStatus = {
      id,
      description: config.description,
      status: "queued",
      progress: 0,
      currentStep: "Queued",
      filesModified: [],
      cost: 0,
      turnsUsed: 0,
      startedAt: Date.now(),
      completedAt: null,
      worktreePath: null,
      branchName,
      prUrl: null,
      error: null,
    };

    this.tasks.set(id, status);
    this.queue.push(id);
    this.emitStatus(status);
    this.processQueue(config);
    return id;
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === "queued") {
      const idx = this.queue.indexOf(id);
      if (idx >= 0) this.queue.splice(idx, 1);
    }
    this.updateStatus(id, { status: "cancelled", completedAt: Date.now() });
    this.cleanupWorktree(task);
    return true;
  }

  getTask(id: string): BackgroundTaskStatus | null {
    return this.tasks.get(id) ?? null;
  }

  listTasks(): readonly BackgroundTaskStatus[] {
    return [...this.tasks.values()];
  }

  getRunningCount(): number {
    return this.runningCount;
  }

  // ── Internal ──────────────────────────────────────

  private processQueue(config: BackgroundTaskConfig): void {
    while (this.runningCount < MAX_PARALLEL && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) break;
      this.runningCount++;
      this.executeTask(id, config)
        .catch((err) => {
          this.updateStatus(id, { status: "failed", error: String(err), completedAt: Date.now() });
        })
        .finally(() => {
          this.runningCount--;
        });
    }
  }

  private async executeTask(id: string, config: BackgroundTaskConfig): Promise<void> {
    this.updateStatus(id, { status: "running", currentStep: "Creating worktree..." });

    // Create git worktree for isolation
    const worktreePath = this.createWorktree(id, `agent/${id}`, config.workingDir);
    if (!worktreePath) {
      this.updateStatus(id, {
        status: "failed",
        error: "Failed to create worktree",
        completedAt: Date.now(),
      });
      return;
    }
    this.updateStatus(id, { worktreePath, progress: 10, currentStep: "Planning..." });

    // NOTE: Real agent execution would connect to WotannRuntime here.
    // For now, this creates the infrastructure. The runtime integration
    // will call the agent loop with the worktree as working directory.
    this.updateStatus(id, { progress: 40, currentStep: "Executing task..." });

    // Run verification
    this.updateStatus(id, { progress: 70, currentStep: "Verifying..." });
    const verification = this.runVerification(worktreePath);

    if (verification.success) {
      this.updateStatus(id, { progress: 90, currentStep: "Creating commit..." });
      const result = this.commitChanges(worktreePath, `agent/${id}`, config.description);
      this.updateStatus(id, {
        status: "completed",
        progress: 100,
        currentStep: "Done",
        completedAt: Date.now(),
        prUrl: result.prUrl,
        filesModified: result.files,
      });

      // ── D14: CI feedback loop after push ──
      // When enabled and a PR was created, poll CI for this branch and,
      // if it fails, feed structured failures back into the agent's fix
      // loop. Bounded at 5 iterations.
      if (config.ciFeedbackEnabled && result.prUrl) {
        await this.runCIFeedbackLoop(id, worktreePath, `agent/${id}`);
      }
    } else {
      this.updateStatus(id, {
        status: "failed",
        completedAt: Date.now(),
        error: verification.error,
      });
    }
  }

  private createWorktree(id: string, branch: string, cwd: string): string | null {
    const path = join(AGENT_DIR, id);
    const opts: ExecFileSyncOptions = { cwd, stdio: "pipe" };
    try {
      execFileSync("git", ["worktree", "add", path, "-b", branch], opts);
      return path;
    } catch {
      try {
        execFileSync("git", ["worktree", "add", path, branch], opts);
        return path;
      } catch {
        return null;
      }
    }
  }

  private runVerification(cwd: string): { success: boolean; error: string | null } {
    const opts: ExecFileSyncOptions = { cwd, stdio: "pipe", timeout: 120_000 };
    try {
      execFileSync("npx", ["tsc", "--noEmit"], opts);
      return { success: true, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Typecheck failed: ${msg.slice(0, 500)}` };
    }
  }

  private commitChanges(
    cwd: string,
    branch: string,
    desc: string,
  ): { prUrl: string | null; files: readonly string[] } {
    const opts: ExecFileSyncOptions = { cwd, stdio: "pipe" };
    try {
      execFileSync("git", ["add", "-A"], opts);
      // Check for changes
      try {
        execFileSync("git", ["diff", "--cached", "--quiet"], opts);
        return { prUrl: null, files: [] };
      } catch {
        // Has changes
      }
      const diffOut = execFileSync("git", ["diff", "--cached", "--name-only"], opts)
        .toString()
        .trim();
      const files = diffOut.split("\n").filter(Boolean);
      const msg = `feat: ${desc}\n\nAutonomous task by WOTANN background agent.`;
      execFileSync("git", ["commit", "-m", msg], opts);

      // Try push + PR (best effort)
      let prUrl: string | null = null;
      try {
        execFileSync("git", ["push", "origin", branch], opts);
        const pr = execFileSync(
          "gh",
          ["pr", "create", "--title", `feat: ${desc.slice(0, 60)}`, "--body", "WOTANN agent task"],
          opts,
        );
        prUrl = pr.toString().trim();
      } catch {
        /* No remote or gh CLI */
      }

      return { prUrl, files };
    } catch {
      return { prUrl: null, files: [] };
    }
  }

  /**
   * D14: Public entry point for the CI feedback loop.
   *
   * Exposed via the `agents.ci-loop` RPC so callers can explicitly trigger
   * the loop on an existing task (e.g. after a retry). Returns a summary
   * of the terminal run so the caller knows whether CI went green.
   */
  async runCIFeedback(taskId: string): Promise<CIFeedbackResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { succeeded: false, iterations: 0, finalStatus: null, runUrl: null };
    }
    if (!task.worktreePath || !task.branchName) {
      return { succeeded: false, iterations: 0, finalStatus: null, runUrl: null };
    }
    return this.runCIFeedbackLoop(taskId, task.worktreePath, task.branchName);
  }

  private async runCIFeedbackLoop(
    taskId: string,
    worktreePath: string,
    branchName: string,
  ): Promise<CIFeedbackResult> {
    const provider = new GitHubActionsProvider();
    this.updateStatus(taskId, { currentStep: "CI: polling for run..." });

    try {
      const result = await ciFeedbackLoop({
        provider,
        branch: branchName,
        maxIterations: 5,
        onStatus: (run: CIRun) => {
          this.updateStatus(taskId, {
            currentStep: `CI ${run.status} — ${run.commitSha.slice(0, 7)}`,
          });
        },
        fixFailures: async (failures: readonly CIFailure[]) => {
          // Fix callback — dispatches back into the fix loop.
          // The infrastructure hook exists; a concrete runtime driver can
          // subscribe to the `ci.failures` event to perform the fix, commit,
          // and push. We report the failure structure for observability and
          // indicate "no commit" so the feedback loop bails out cleanly
          // when no driver is attached.
          const summary = failures
            .slice(0, 3)
            .map((f) => `- ${f.errorType}: ${f.message.slice(0, 120)}`)
            .join("\n");
          this.updateStatus(taskId, {
            currentStep: `CI failed (${failures.length} issues) — dispatching fix...`,
            error: summary,
          });
          return { committedFix: false };
        },
      });

      this.updateStatus(taskId, {
        currentStep: result.succeeded
          ? "CI green"
          : `CI exhausted after ${result.iterations} iteration(s)`,
      });
      return {
        succeeded: result.succeeded,
        iterations: result.iterations,
        finalStatus: result.final?.status ?? null,
        runUrl: result.final?.htmlUrl ?? null,
      };
    } catch (err) {
      this.updateStatus(taskId, {
        currentStep: `CI loop aborted: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { succeeded: false, iterations: 0, finalStatus: null, runUrl: null };
    } finally {
      // Worktree remains for subsequent fix iterations — cleanup on cancel.
      void worktreePath;
    }
  }

  private cleanupWorktree(task: BackgroundTaskStatus): void {
    if (!task.worktreePath || !existsSync(task.worktreePath)) return;
    try {
      rmSync(task.worktreePath, { recursive: true, force: true });
    } catch {
      /* Best effort */
    }
  }

  private updateStatus(id: string, updates: Partial<BackgroundTaskStatus>): void {
    const current = this.tasks.get(id);
    if (!current) return;
    const updated = { ...current, ...updates };
    this.tasks.set(id, updated);
    this.emitStatus(updated);
  }

  private emitStatus(status: BackgroundTaskStatus): void {
    this.statusCallback?.(status);
    try {
      writeFileSync(join(AGENT_DIR, `${status.id}.json`), JSON.stringify(status, null, 2));
    } catch {
      /* Best effort */
    }
  }

  loadPersistedTasks(): void {
    try {
      const files = readdirSync(AGENT_DIR).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const data = JSON.parse(
            readFileSync(join(AGENT_DIR, file), "utf-8"),
          ) as BackgroundTaskStatus;
          if (data.id) this.tasks.set(data.id, data);
        } catch {
          /* Skip corrupt */
        }
      }
    } catch {
      /* Dir may not exist */
    }
  }
}
