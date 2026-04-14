/**
 * CI feedback loop for background agents (D14).
 *
 * Amp-style background execution: after a push, poll the CI system for the
 * result, parse failures into structured errors, and feed them back into the
 * autonomous runtime for another round of fixes. The loop exits when CI is
 * green, a hard iteration cap is reached, or the user cancels.
 *
 * Providers supported:
 *  - GitHub Actions (via `gh` CLI, which must already be authenticated)
 *  - GitLab CI (via `glab` CLI, if available)
 *  - Generic (custom fetch + parse callbacks)
 *
 * The loop is provider-agnostic through the `CIProvider` interface — adding
 * a new system is a matter of implementing a single method.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface CIRun {
  readonly id: string;
  readonly status: "queued" | "in_progress" | "success" | "failure" | "cancelled";
  readonly branch: string;
  readonly commitSha: string;
  readonly htmlUrl: string;
  readonly startedAt: number;
  readonly completedAt?: number;
}

export interface CIFailure {
  readonly stepName: string;
  readonly errorType: "test" | "lint" | "typecheck" | "build" | "deploy" | "unknown";
  readonly failingFile?: string;
  readonly failingLine?: number;
  readonly message: string;
  readonly logExcerpt: string;
}

export interface CIProvider {
  readonly name: string;
  latestRun(branch: string): Promise<CIRun | null>;
  watchRun(runId: string, onStatus: (run: CIRun) => void, signal?: AbortSignal): Promise<CIRun>;
  parseFailures(runId: string): Promise<readonly CIFailure[]>;
}

/** GitHub Actions via `gh` CLI. */
export class GitHubActionsProvider implements CIProvider {
  readonly name = "github-actions";

  async latestRun(branch: string): Promise<CIRun | null> {
    try {
      const { stdout } = await run("gh", [
        "run",
        "list",
        "--branch",
        branch,
        "--limit",
        "1",
        "--json",
        "databaseId,status,conclusion,headBranch,headSha,url,createdAt,updatedAt",
      ]);
      const runs = JSON.parse(stdout) as Array<{
        databaseId: number;
        status: string;
        conclusion: string | null;
        headBranch: string;
        headSha: string;
        url: string;
        createdAt: string;
        updatedAt: string;
      }>;
      const r = runs[0];
      if (!r) return null;
      return {
        id: String(r.databaseId),
        status: mapGHStatus(r.status, r.conclusion),
        branch: r.headBranch,
        commitSha: r.headSha,
        htmlUrl: r.url,
        startedAt: new Date(r.createdAt).getTime(),
        completedAt: r.status === "completed" ? new Date(r.updatedAt).getTime() : undefined,
      };
    } catch {
      return null;
    }
  }

  async watchRun(
    runId: string,
    onStatus: (run: CIRun) => void,
    signal?: AbortSignal,
  ): Promise<CIRun> {
    const pollIntervalMs = 10_000;
    while (!signal?.aborted) {
      try {
        const { stdout } = await run("gh", [
          "run",
          "view",
          runId,
          "--json",
          "databaseId,status,conclusion,headBranch,headSha,url,createdAt,updatedAt",
        ]);
        const r = JSON.parse(stdout) as {
          databaseId: number;
          status: string;
          conclusion: string | null;
          headBranch: string;
          headSha: string;
          url: string;
          createdAt: string;
          updatedAt: string;
        };
        const current: CIRun = {
          id: String(r.databaseId),
          status: mapGHStatus(r.status, r.conclusion),
          branch: r.headBranch,
          commitSha: r.headSha,
          htmlUrl: r.url,
          startedAt: new Date(r.createdAt).getTime(),
          completedAt: r.status === "completed" ? new Date(r.updatedAt).getTime() : undefined,
        };
        onStatus(current);
        if (
          current.status === "success" ||
          current.status === "failure" ||
          current.status === "cancelled"
        ) {
          return current;
        }
      } catch {
        // transient — back off and retry
      }
      await sleep(pollIntervalMs);
    }
    throw new Error("CI watch aborted");
  }

  async parseFailures(runId: string): Promise<readonly CIFailure[]> {
    try {
      const { stdout: logs } = await run("gh", ["run", "view", runId, "--log-failed"], {
        maxBuffer: 16 * 1024 * 1024,
      });
      return parseCILogs(logs);
    } catch {
      return [];
    }
  }
}

/** Heuristic log parser — works for most ts/node/jest style failures. */
export function parseCILogs(logs: string): readonly CIFailure[] {
  const failures: CIFailure[] = [];
  const lines = logs.split("\n");

  // TypeScript errors: `file.ts(12,34): error TS2345: ...`
  const tsPattern = /^(.+?\.ts)\((\d+),\d+\):\s*error\s*TS\d+:\s*(.+)$/;
  // Vitest/Jest: `FAIL path/to/test.test.ts > suite > case`
  const testFailPattern = /^\s*(?:FAIL|×|✗)\s+(.+\.(test|spec)\.(ts|tsx|js|jsx))/;
  // ESLint: `path/file.ts\n  12:34  error  ...`
  const lintPattern = /^\s+(\d+):\d+\s+error\s+(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const tsMatch = line.match(tsPattern);
    if (tsMatch?.[1]) {
      failures.push({
        stepName: "typecheck",
        errorType: "typecheck",
        failingFile: tsMatch[1],
        failingLine: Number(tsMatch[2]),
        message: tsMatch[3] ?? "",
        logExcerpt: lines.slice(Math.max(0, i - 2), i + 3).join("\n"),
      });
      continue;
    }
    const testMatch = line.match(testFailPattern);
    if (testMatch?.[1]) {
      failures.push({
        stepName: "tests",
        errorType: "test",
        failingFile: testMatch[1],
        message: line.trim(),
        logExcerpt: lines.slice(i, i + 8).join("\n"),
      });
      continue;
    }
    const lintMatch = line.match(lintPattern);
    if (lintMatch?.[2]) {
      failures.push({
        stepName: "lint",
        errorType: "lint",
        failingLine: Number(lintMatch[1]),
        message: lintMatch[2],
        logExcerpt: line,
      });
    }
  }

  return failures.length > 0 ? failures : [fallbackFailure(logs)];
}

function fallbackFailure(logs: string): CIFailure {
  const lastErrorLine = logs
    .split("\n")
    .reverse()
    .find((l) => /\berror\b|\bfailed\b|\bFAIL\b/i.test(l));
  return {
    stepName: "unknown",
    errorType: "unknown",
    message: lastErrorLine?.trim() ?? "CI failed without a recognisable error pattern",
    logExcerpt: logs.slice(-2000),
  };
}

function mapGHStatus(status: string, conclusion: string | null): CIRun["status"] {
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "cancelled") return "cancelled";
    return "failure";
  }
  if (status === "queued") return "queued";
  return "in_progress";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * High-level loop: push → poll CI → if failure, hand structured failures to a
 * fixer callback → loop. The fixer is whatever runtime driver you wire in
 * (autonomous executor, background worker, etc).
 */
export async function ciFeedbackLoop(params: {
  provider: CIProvider;
  branch: string;
  maxIterations?: number;
  onStatus?: (run: CIRun) => void;
  fixFailures: (failures: readonly CIFailure[]) => Promise<{ committedFix: boolean }>;
  signal?: AbortSignal;
}): Promise<{ final: CIRun | null; iterations: number; succeeded: boolean }> {
  const max = params.maxIterations ?? 5;
  let iterations = 0;
  let last: CIRun | null = null;

  while (iterations < max && !params.signal?.aborted) {
    iterations += 1;

    const latest = await params.provider.latestRun(params.branch);
    if (!latest) {
      return { final: null, iterations, succeeded: false };
    }

    last = await params.provider.watchRun(latest.id, (r) => params.onStatus?.(r), params.signal);

    if (last.status === "success") {
      return { final: last, iterations, succeeded: true };
    }
    if (last.status === "cancelled") {
      return { final: last, iterations, succeeded: false };
    }

    // Failure — parse, hand to fixer, and loop
    const failures = await params.provider.parseFailures(last.id);
    const { committedFix } = await params.fixFailures(failures);
    if (!committedFix) {
      // Nothing was changed — further loops are wasted CI budget
      return { final: last, iterations, succeeded: false };
    }
  }

  return { final: last, iterations, succeeded: false };
}
