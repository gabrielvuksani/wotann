/**
 * Agentless VALIDATE phase.
 *
 * Goal: apply a candidate diff in an isolated branch, run the test suite,
 * report pass/fail, then revert the branch state regardless of outcome.
 *
 * QB #6: if the diff fails to apply, we DO NOT pretend tests passed.
 * QB #7: branch name is per-call (timestamp + random); no shared state.
 */

import { execFileNoThrow } from "../../utils/execFileNoThrow.js";
import type { TestRunnerFn, ValidateResult } from "./types.js";

export interface ShadowGitLike {
  createBranch(name: string): Promise<void>;
  applyDiff(diff: string): Promise<void>;
  discardBranch(name: string): Promise<void>;
}

export interface ValidateOptions {
  /** Pluggable git wrapper. Required (shadow-git lives elsewhere). */
  readonly shadowGit?: ShadowGitLike;
  /** Pluggable test runner — caller-defined cmd. */
  readonly runTests?: () => Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }>;
  /** Branch prefix (default `wotann/agentless`). */
  readonly branchPrefix?: string;
  /** Random suffix function — for deterministic tests. */
  readonly randomSuffix?: () => string;
}

/**
 * Validate a candidate diff. Always returns a ValidateResult (never throws).
 */
export async function validateRepair(
  diff: string,
  opts: ValidateOptions = {},
): Promise<ValidateResult> {
  const t0 = Date.now();

  if (typeof diff !== "string" || diff.trim() === "") {
    return {
      passed: false,
      applyError: "empty diff",
      durationMs: Date.now() - t0,
    };
  }

  const sg = opts.shadowGit;
  if (!sg) {
    return {
      passed: false,
      applyError: "no shadowGit injected — pass opts.shadowGit",
      durationMs: Date.now() - t0,
    };
  }

  const prefix = opts.branchPrefix ?? "wotann/agentless";
  const suffix = opts.randomSuffix ? opts.randomSuffix() : Math.random().toString(36).slice(2, 8);
  const branch = `${prefix}-${Date.now()}-${suffix}`;

  let createdBranch = false;
  try {
    try {
      await sg.createBranch(branch);
      createdBranch = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        applyError: `createBranch failed: ${msg}`,
        durationMs: Date.now() - t0,
      };
    }

    try {
      await sg.applyDiff(diff);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        applyError: `applyDiff failed: ${msg}`,
        branchUsed: branch,
        durationMs: Date.now() - t0,
      };
    }

    const runner = opts.runTests ?? defaultTestRunner;
    let testResult: { readonly exitCode: number; readonly stdout: string; readonly stderr: string };
    try {
      testResult = await runner();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        applyError: `runner failure: ${msg}`,
        branchUsed: branch,
        durationMs: Date.now() - t0,
      };
    }

    const counts = parseTestCounts(testResult.stdout);
    const passed = testResult.exitCode === 0 && counts.failed === 0;

    return {
      passed,
      branchUsed: branch,
      testResult: {
        total: counts.total,
        passed: counts.passed,
        failed: counts.failed,
        stdout: testResult.stdout.slice(0, 8192),
        stderr: testResult.stderr.slice(0, 8192),
      },
      durationMs: Date.now() - t0,
    };
  } finally {
    if (createdBranch) {
      try {
        await sg.discardBranch(branch);
      } catch {
        // Best-effort cleanup; do not mask original result.
      }
    }
  }
}

/**
 * Default runner — `npm test` via execFileNoThrow.
 */
async function defaultTestRunner(): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return execFileNoThrow("npm", ["test", "--silent"]);
}

/**
 * Parse vitest/jest-like output to extract pass/fail counts.
 */
export function parseTestCounts(stdout: string): {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
} {
  const passedMatch = /(\d+)\s+passed/i.exec(stdout);
  const failedMatch = /(\d+)\s+failed/i.exec(stdout);
  const totalMatch = /(\d+)\s+total/i.exec(stdout);
  const passed = passedMatch && passedMatch[1] ? parseInt(passedMatch[1], 10) : 0;
  const failed = failedMatch && failedMatch[1] ? parseInt(failedMatch[1], 10) : 0;
  const totalRaw = totalMatch && totalMatch[1] ? parseInt(totalMatch[1], 10) : 0;
  const total = totalRaw || passed + failed;
  return { total, passed, failed };
}

/**
 * Convenience: build a TestRunnerFn from validateRepair + injected options.
 */
export function makeTestRunner(opts: ValidateOptions): TestRunnerFn {
  return (diff) => validateRepair(diff, opts);
}
