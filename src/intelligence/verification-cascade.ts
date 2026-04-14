/**
 * Verification Cascade -- mandatory verification chain after code changes.
 *
 * Runs a sequence of verification steps in order:
 *   1. typecheck (tsc --noEmit)
 *   2. lint (eslint/biome)
 *   3. unit tests (vitest/jest)
 *   4. integration tests (vitest/jest with tag)
 *   5. build (tsc / npm run build)
 *
 * Steps are auto-detected from the working directory's package.json
 * and config files. Required steps cause an early exit on failure;
 * optional steps log warnings but continue the cascade.
 *
 * All results are immutable -- each run produces a new CascadeResult.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// -- Types ------------------------------------------------------------------

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
  readonly exitCode: number;
  readonly durationMs: number;
  readonly skipped: boolean;
}

export interface CascadeResult {
  readonly steps: readonly VerificationResult[];
  readonly allPassed: boolean;
  readonly failedStep: string | null;
  readonly totalDurationMs: number;
  readonly stepsRun: number;
  readonly stepsSkipped: number;
}

// -- Step Execution ---------------------------------------------------------

/**
 * Execute a single verification step as a child process.
 */
function executeStep(
  step: VerificationStep,
  workingDir: string,
): Promise<VerificationResult> {
  const start = Date.now();

  return new Promise<VerificationResult>((resolve) => {
    const child = execFile(
      step.command,
      [...step.args],
      {
        cwd: workingDir,
        timeout: step.timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        env: { ...process.env, FORCE_COLOR: "0" },
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const output = (stdout + "\n" + stderr).trim();

        if (error) {
          const exitCode = typeof error.code === "number"
            ? error.code
            : (error.killed ? 137 : 1);

          resolve({
            step: step.name,
            passed: false,
            output,
            exitCode,
            durationMs,
            skipped: false,
          });
          return;
        }

        resolve({
          step: step.name,
          passed: true,
          output,
          exitCode: 0,
          durationMs,
          skipped: false,
        });
      },
    );

    // Safety: ensure the child process is cleaned up on timeout
    child.on("error", () => {
      resolve({
        step: step.name,
        passed: false,
        output: "Process failed to start",
        exitCode: 127,
        durationMs: Date.now() - start,
        skipped: false,
      });
    });
  });
}

// -- Step Detection ---------------------------------------------------------

/**
 * Read and parse package.json from the working directory.
 */
function readPackageJson(workingDir: string): Record<string, unknown> | null {
  const pkgPath = join(workingDir, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const raw = readFileSync(pkgPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check if a file exists in the working directory.
 */
function hasFile(workingDir: string, filename: string): boolean {
  return existsSync(join(workingDir, filename));
}

/**
 * Auto-detect available verification steps from the project setup.
 */
function detectSteps(workingDir: string): readonly VerificationStep[] {
  const pkg = readPackageJson(workingDir);
  const scripts = (pkg?.["scripts"] ?? {}) as Record<string, string>;
  const steps: VerificationStep[] = [];

  // Step 1: TypeScript typecheck
  if (hasFile(workingDir, "tsconfig.json")) {
    const command = scripts["typecheck"]
      ? "npm"
      : "npx";
    const args = scripts["typecheck"]
      ? ["run", "typecheck"]
      : ["tsc", "--noEmit"];

    steps.push({
      name: "typecheck",
      command,
      args,
      required: true,
      timeoutMs: 60_000,
    });
  }

  // Step 2: Linting
  if (scripts["lint"]) {
    steps.push({
      name: "lint",
      command: "npm",
      args: ["run", "lint"],
      required: false,
      timeoutMs: 30_000,
    });
  } else if (hasFile(workingDir, "biome.json") || hasFile(workingDir, "biome.jsonc")) {
    steps.push({
      name: "lint",
      command: "npx",
      args: ["biome", "check", "."],
      required: false,
      timeoutMs: 30_000,
    });
  } else if (hasFile(workingDir, ".eslintrc.json") || hasFile(workingDir, "eslint.config.js")) {
    steps.push({
      name: "lint",
      command: "npx",
      args: ["eslint", "."],
      required: false,
      timeoutMs: 30_000,
    });
  }

  // Step 3: Unit tests
  if (scripts["test"]) {
    steps.push({
      name: "unit-tests",
      command: "npm",
      args: ["test", "--", "--run"],
      required: true,
      timeoutMs: 120_000,
    });
  } else if (hasFile(workingDir, "vitest.config.ts") || hasFile(workingDir, "vitest.config.js")) {
    steps.push({
      name: "unit-tests",
      command: "npx",
      args: ["vitest", "run"],
      required: true,
      timeoutMs: 120_000,
    });
  } else if (hasFile(workingDir, "jest.config.js") || hasFile(workingDir, "jest.config.ts")) {
    steps.push({
      name: "unit-tests",
      command: "npx",
      args: ["jest", "--ci"],
      required: true,
      timeoutMs: 120_000,
    });
  }

  // Step 4: Integration tests (only if there is a dedicated script)
  if (scripts["test:integration"]) {
    steps.push({
      name: "integration-tests",
      command: "npm",
      args: ["run", "test:integration"],
      required: false,
      timeoutMs: 180_000,
    });
  }

  // Step 5: Build
  if (scripts["build"]) {
    steps.push({
      name: "build",
      command: "npm",
      args: ["run", "build"],
      required: false,
      timeoutMs: 120_000,
    });
  }

  return steps;
}

// -- Verification Cascade ---------------------------------------------------

export class VerificationCascade {
  private readonly steps: readonly VerificationStep[];
  private readonly workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.steps = detectSteps(workingDir);
  }

  /**
   * Get the list of detected verification steps.
   */
  getSteps(): readonly VerificationStep[] {
    return this.steps;
  }

  /**
   * Run the full verification cascade.
   * Fails fast on required steps; optional steps log but continue.
   * Optionally filter which steps to run based on changed files.
   */
  async run(_changedFiles: readonly string[] = []): Promise<CascadeResult> {
    const results: VerificationResult[] = [];
    let failedStep: string | null = null;
    let stepsSkipped = 0;
    const cascadeStart = Date.now();

    for (const step of this.steps) {
      // If a required step already failed, skip remaining steps
      if (failedStep !== null) {
        results.push({
          step: step.name,
          passed: false,
          output: `Skipped: previous required step "${failedStep}" failed`,
          exitCode: -1,
          durationMs: 0,
          skipped: true,
        });
        stepsSkipped++;
        continue;
      }

      const result = await executeStep(step, this.workingDir);
      results.push(result);

      if (!result.passed && step.required) {
        failedStep = step.name;
      }
    }

    const totalDurationMs = Date.now() - cascadeStart;

    return {
      steps: results,
      allPassed: failedStep === null,
      failedStep,
      totalDurationMs,
      stepsRun: results.length - stepsSkipped,
      stepsSkipped,
    };
  }

  /**
   * Run a single step by name.
   */
  async runStep(stepName: string): Promise<VerificationResult | null> {
    const step = this.steps.find((s) => s.name === stepName);
    if (!step) return null;
    return executeStep(step, this.workingDir);
  }
}
