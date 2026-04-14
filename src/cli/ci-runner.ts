/**
 * CI Runner — `wotann ci "fix failing tests"`.
 *
 * Non-interactive mode for CI/CD pipelines. Runs a task with retry logic,
 * captures structured output, and returns an exit code suitable for CI.
 *
 * Design:
 * - No interactive prompts — all configuration via CIOptions
 * - Retry loop with attempt tracking
 * - Structured summary for CI logs
 * - Optional auto-commit on success
 * - Exit code convention: 0 = success, 1 = task failed, 2 = config error
 */

import { execFile } from "node:child_process";

// ── Types ────────────────────────────────────────────────

export interface CIOptions {
  readonly task: string;
  readonly maxAttempts?: number;
  readonly commitOnSuccess?: boolean;
  readonly exitOnFailure?: boolean;
  readonly commitMessage?: string;
  readonly workingDir?: string;
}

export interface CIResult {
  readonly exitCode: number;
  readonly summary: string;
  readonly attempts: readonly CIAttemptResult[];
  readonly totalDurationMs: number;
}

export interface CIAttemptResult {
  readonly attempt: number;
  readonly success: boolean;
  readonly output: string;
  readonly error: string;
  readonly durationMs: number;
}

/**
 * Task executor function — abstracts the runtime query.
 * Takes the task prompt and attempt number, returns success/failure and output.
 */
export type CITaskExecutor = (
  task: string,
  attempt: number,
) => Promise<{ success: boolean; output: string; error: string }>;

// ── Constants ────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_COMMIT_MESSAGE = "fix: automated fix by wotann ci";

// ── CI Runner ────────────────────────────────────────────

/**
 * Run a task in CI mode with retry logic.
 *
 * @param options - CI configuration
 * @param executor - Function that runs the actual task
 * @returns Structured result with exit code, summary, and per-attempt details
 */
export async function runCI(
  options: CIOptions,
  executor: CITaskExecutor,
): Promise<CIResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const exitOnFailure = options.exitOnFailure ?? true;

  if (options.task.trim().length === 0) {
    return {
      exitCode: 2,
      summary: "Error: empty task string",
      attempts: [],
      totalDurationMs: 0,
    };
  }

  if (maxAttempts < 1) {
    return {
      exitCode: 2,
      summary: "Error: maxAttempts must be >= 1",
      attempts: [],
      totalDurationMs: 0,
    };
  }

  const attempts: CIAttemptResult[] = [];
  const startTime = Date.now();
  let lastSuccess = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();

    try {
      const result = await executor(options.task, attempt);
      const durationMs = Date.now() - attemptStart;

      attempts.push({
        attempt,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs,
      });

      if (result.success) {
        lastSuccess = true;
        break;
      }

      // If not the last attempt, continue to retry
      if (attempt === maxAttempts && exitOnFailure) {
        break;
      }
    } catch (err) {
      const durationMs = Date.now() - attemptStart;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";

      attempts.push({
        attempt,
        success: false,
        output: "",
        error: errorMessage,
        durationMs,
      });

      if (attempt === maxAttempts && exitOnFailure) {
        break;
      }
    }
  }

  const totalDurationMs = Date.now() - startTime;

  // Auto-commit on success if configured
  if (lastSuccess && options.commitOnSuccess) {
    await autoCommit(
      options.commitMessage ?? DEFAULT_COMMIT_MESSAGE,
      options.workingDir,
    );
  }

  const summary = buildSummary(options.task, attempts, lastSuccess, totalDurationMs);

  return {
    exitCode: lastSuccess ? 0 : 1,
    summary,
    attempts,
    totalDurationMs,
  };
}

// ── Summary Builder ──────────────────────────────────────

function buildSummary(
  task: string,
  attempts: readonly CIAttemptResult[],
  success: boolean,
  totalDurationMs: number,
): string {
  const lines: string[] = [
    "=== WOTANN CI Result ===",
    `Task: ${task}`,
    `Status: ${success ? "SUCCESS" : "FAILED"}`,
    `Attempts: ${attempts.length}`,
    `Duration: ${formatDuration(totalDurationMs)}`,
  ];

  if (!success && attempts.length > 0) {
    const lastAttempt = attempts[attempts.length - 1];
    if (lastAttempt?.error) {
      lines.push(`Last error: ${lastAttempt.error.slice(0, 200)}`);
    }
  }

  lines.push("========================");
  return lines.join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ── Auto-Commit ──────────────────────────────────────────

/**
 * Run `git add -A && git commit -m "..."` in the working directory.
 * Failure is non-fatal — the CI result is still returned.
 */
function autoCommit(message: string, workingDir?: string): Promise<void> {
  return new Promise((resolve) => {
    const cwd = workingDir ?? process.cwd();

    execFile(
      "git",
      ["add", "-A"],
      { cwd },
      (addErr) => {
        if (addErr) {
          // Git add failed — skip commit
          resolve();
          return;
        }

        execFile(
          "git",
          ["commit", "-m", message],
          { cwd },
          () => {
            // Commit may fail if nothing to commit — that is fine
            resolve();
          },
        );
      },
    );
  });
}
