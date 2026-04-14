/**
 * Issue-to-PR Agent — Watches GitHub issues assigned to @wotann and
 * autonomously writes code, runs tests, and opens a PR.
 * From GitHub Copilot's coding agent pattern.
 *
 * NOTE: Uses execFileSync (not exec) intentionally — execFileSync does NOT
 * invoke a shell, so it is safe from command injection. All arguments are
 * passed as an array, never interpolated into a shell string.
 */

import { execFileSync } from "node:child_process";

// ── Public Types ──────────────────────────────────────

export interface IssueToPRConfig {
  readonly repo: string; // owner/repo
  readonly issueNumber: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly workingDir: string;
}

export interface IssueToPRResult {
  readonly success: boolean;
  readonly prNumber?: number;
  readonly prUrl?: string;
  readonly branchName: string;
  readonly filesChanged: readonly string[];
  readonly testsRun: boolean;
  readonly testsPassed: boolean;
  readonly error?: string;
}

// ── Agent ─────────────────────────────────────────────

export class IssueToPRAgent {
  /**
   * Execute the full issue-to-PR pipeline:
   * 1. Create a branch from the issue
   * 2. Analyze the issue requirements
   * 3. Execute code changes via the autonomous executor
   * 4. Run tests
   * 5. Open a PR
   */
  async execute(
    config: IssueToPRConfig,
    queryFn: (prompt: string) => AsyncGenerator<{ type: string; content?: string }>,
  ): Promise<IssueToPRResult> {
    const branchName = `wotann/issue-${config.issueNumber}`;
    const filesChanged: string[] = [];
    let testsRun = false;
    let testsPassed = false;

    try {
      // Step 1: Create branch
      this.gitExec(config.workingDir, ["checkout", "-b", branchName]);

      // Step 2: Query the agent to implement the issue
      const prompt = [
        `Implement GitHub issue #${config.issueNumber}: ${config.title}`,
        "",
        config.body,
        "",
        "Requirements:",
        "- Write clean, tested code",
        "- Follow existing patterns in the codebase",
        "- Run tests to verify your changes",
        "- List all files you modified",
      ].join("\n");

      let agentOutput = "";
      for await (const chunk of queryFn(prompt)) {
        if (chunk.type === "text" && chunk.content) {
          agentOutput += chunk.content;
        }
      }

      // Step 3: Detect changed files
      const diffOutput = this.gitExec(config.workingDir, ["diff", "--name-only"]);
      filesChanged.push(...diffOutput.split("\n").filter(Boolean));

      // Step 4: Run tests
      try {
        this.runCommand(config.workingDir, "npm", ["test"]);
        testsRun = true;
        testsPassed = true;
      } catch {
        testsRun = true;
        testsPassed = false;
      }

      // Step 5: Commit and push
      if (filesChanged.length > 0) {
        this.gitExec(config.workingDir, ["add", "-A"]);
        this.gitExec(config.workingDir, [
          "commit",
          "-m",
          `fix: resolve #${config.issueNumber} — ${config.title}\n\nAutonomously implemented by WOTANN.`,
        ]);
        this.gitExec(config.workingDir, ["push", "-u", "origin", branchName]);
      }

      // Step 6: Create PR via gh CLI
      const prBody = [
        `## Resolves #${config.issueNumber}`,
        "",
        `### Changes`,
        ...filesChanged.map((f) => `- \`${f}\``),
        "",
        `### Tests`,
        testsRun
          ? testsPassed
            ? "All tests pass."
            : "Tests failed — manual review needed."
          : "Tests not run.",
        "",
        "---",
        "Autonomously implemented by WOTANN.",
      ].join("\n");

      const prOutput = this.runCommand(config.workingDir, "gh", [
        "pr",
        "create",
        "--title",
        `fix: ${config.title}`,
        "--body",
        prBody,
        "--base",
        "main",
      ]);

      const prUrlMatch = prOutput.match(/https:\/\/github\.com\/[^\s]+/);
      const prNumberMatch = prOutput.match(/\/pull\/(\d+)/);

      return {
        success: true,
        prUrl: prUrlMatch?.[0],
        prNumber: prNumberMatch?.[1]
          ? parseInt(prNumberMatch[1], 10)
          : undefined,
        branchName,
        filesChanged,
        testsRun,
        testsPassed,
      };
    } catch (error) {
      // Cleanup: checkout back to main
      try {
        this.gitExec(config.workingDir, ["checkout", "main"]);
      } catch {
        /* ignore */
      }
      try {
        this.gitExec(config.workingDir, ["branch", "-D", branchName]);
      } catch {
        /* ignore */
      }

      return {
        success: false,
        branchName,
        filesChanged,
        testsRun,
        testsPassed,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private gitExec(cwd: string, args: readonly string[]): string {
    return execFileSync("git", [...args], {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: "pipe",
    }).trim();
  }

  private runCommand(cwd: string, cmd: string, args: readonly string[]): string {
    return execFileSync(cmd, [...args], {
      cwd,
      encoding: "utf-8",
      timeout: 300_000,
      stdio: "pipe",
    }).trim();
  }
}
