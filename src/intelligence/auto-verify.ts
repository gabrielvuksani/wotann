/**
 * Auto-Verify — automatically typecheck → lint → test after every code change.
 * Failures auto-fed back to agent for retry (up to 3 attempts).
 * User only sees the final correct result.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────

export interface VerificationStep {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly required: boolean;
  readonly timeoutMs: number;
}

export interface VerificationResult {
  readonly step: string;
  readonly passed: boolean;
  readonly output: string;
  readonly durationMs: number;
}

export interface VerificationReport {
  readonly results: readonly VerificationResult[];
  readonly allPassed: boolean;
  readonly totalDurationMs: number;
  readonly failedSteps: readonly string[];
}

export interface AutoVerifyConfig {
  readonly enabled: boolean;
  readonly maxRetries: number;
  readonly steps: readonly VerificationStep[];
}

// ── Default Steps ────────────────────────────────────────

function detectSteps(workingDir: string): VerificationStep[] {
  const steps: VerificationStep[] = [];

  // TypeScript typecheck
  if (existsSync(join(workingDir, "tsconfig.json"))) {
    steps.push({
      name: "typecheck",
      command: "npx",
      args: ["tsc", "--noEmit"],
      required: true,
      timeoutMs: 60_000,
    });
  }

  // Package.json scripts
  if (existsSync(join(workingDir, "package.json"))) {
    steps.push({
      name: "lint",
      command: "npm",
      args: ["run", "lint", "--if-present"],
      required: false,
      timeoutMs: 30_000,
    });
    steps.push({
      name: "test",
      command: "npm",
      args: ["test", "--", "--run"],
      required: false,
      timeoutMs: 120_000,
    });
  }

  // Python
  if (existsSync(join(workingDir, "pyproject.toml")) || existsSync(join(workingDir, "setup.py"))) {
    steps.push({
      name: "python-test",
      command: "python",
      args: ["-m", "pytest", "--tb=short", "-q"],
      required: false,
      timeoutMs: 120_000,
    });
  }

  // Rust
  if (existsSync(join(workingDir, "Cargo.toml"))) {
    steps.push({
      name: "cargo-check",
      command: "cargo",
      args: ["check"],
      required: true,
      timeoutMs: 120_000,
    });
  }

  return steps;
}

// ── Auto-Verifier ────────────────────────────────────────

export class AutoVerifier {
  private readonly config: AutoVerifyConfig;

  constructor(workingDir: string, config?: Partial<AutoVerifyConfig>) {
    this.config = {
      enabled: true,
      maxRetries: 3,
      steps: config?.steps ?? detectSteps(workingDir),
      ...config,
    };
  }

  /**
   * Run all verification steps.
   * Returns report with pass/fail for each step.
   */
  async verify(workingDir: string): Promise<VerificationReport> {
    if (!this.config.enabled) {
      return { results: [], allPassed: true, totalDurationMs: 0, failedSteps: [] };
    }

    const results: VerificationResult[] = [];
    const startTime = Date.now();

    for (const step of this.config.steps) {
      const stepStart = Date.now();
      try {
        const { stdout, stderr } = await execFileAsync(step.command, [...step.args], {
          cwd: workingDir,
          timeout: step.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        results.push({
          step: step.name,
          passed: true,
          output: (stdout + stderr).slice(0, 2000),
          durationMs: Date.now() - stepStart,
        });
      } catch (err) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        const output = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`.slice(0, 2000);
        results.push({
          step: step.name,
          passed: false,
          output,
          durationMs: Date.now() - stepStart,
        });

        // Stop on required step failure
        if (step.required) break;
      }
    }

    const failedSteps = results.filter((r) => !r.passed).map((r) => r.step);

    return {
      results,
      allPassed: failedSteps.length === 0,
      totalDurationMs: Date.now() - startTime,
      failedSteps,
    };
  }

  /**
   * Build a feedback prompt from verification failures.
   * This is fed back to the agent for retry.
   */
  buildRetryPrompt(report: VerificationReport): string {
    if (report.allPassed) return "";

    const parts = ["⚠️ Verification failed. Fix the following issues:\n"];

    for (const result of report.results) {
      if (!result.passed) {
        parts.push(`**${result.step}** failed:`);
        parts.push("```");
        parts.push(result.output.slice(0, 500));
        parts.push("```\n");
      }
    }

    parts.push("Fix these issues and try again. Do NOT modify test files unless the tests themselves are wrong.");
    return parts.join("\n");
  }

  /**
   * Check if auto-verify is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the configured steps.
   */
  getSteps(): readonly VerificationStep[] {
    return this.config.steps;
  }
}
