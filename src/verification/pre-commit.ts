/**
 * Proactive pre-commit analysis.
 * Detects the best local verification commands and runs them before shipping.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runSandboxedCommandSync } from "../sandbox/executor.js";
import type { PlatformSandbox } from "../sandbox/security.js";

export interface PreCommitCheck {
  readonly name: string;
  readonly command: readonly string[];
  readonly success: boolean;
  readonly output: string;
  readonly sandbox: PlatformSandbox;
  readonly sandboxEnforced: boolean;
}

export interface PreCommitAnalysisResult {
  readonly checks: readonly PreCommitCheck[];
  readonly blockers: readonly string[];
  readonly commandRunner: string;
  readonly sandbox: PlatformSandbox;
  readonly sandboxEnforced: boolean;
}

interface PackageJson {
  readonly scripts?: Record<string, string>;
}

export function runPreCommitAnalysis(
  workingDir: string,
  maxTimeoutMs: number = 120_000,
): PreCommitAnalysisResult {
  const runner = detectRunner(workingDir);
  const checks = discoverChecks(workingDir, runner.command);

  const results = checks.map((check) => runCheck(workingDir, check, maxTimeoutMs));
  return {
    checks: results,
    blockers: results.filter((check) => !check.success).map((check) => check.name),
    commandRunner: runner.label,
    sandbox: results[0]?.sandbox ?? "none",
    sandboxEnforced: results.some((check) => check.sandboxEnforced),
  };
}

function discoverChecks(
  workingDir: string,
  runnerCommand: string,
): readonly { name: string; command: readonly string[] }[] {
  const pkgPath = join(workingDir, "package.json");
  if (!existsSync(pkgPath)) return [];

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
  const scripts = pkg.scripts ?? {};
  const checks: Array<{ name: string; command: readonly string[] }> = [];

  if (scripts["typecheck"]) {
    checks.push({ name: "typecheck", command: [runnerCommand, "run", "typecheck"] });
  }
  if (scripts["lint"]) {
    checks.push({ name: "lint", command: [runnerCommand, "run", "lint"] });
  }
  if (scripts["test"]) {
    checks.push({ name: "test", command: [runnerCommand, "run", "test"] });
  }
  if (checks.length === 0 && scripts["build"]) {
    checks.push({ name: "build", command: [runnerCommand, "run", "build"] });
  }

  return checks;
}

function runCheck(
  workingDir: string,
  check: { name: string; command: readonly string[] },
  maxTimeoutMs: number,
): PreCommitCheck {
  const [binary, ...args] = check.command;
  const result = runSandboxedCommandSync(binary!, args, {
    workingDir,
    timeoutMs: maxTimeoutMs,
    allowNetwork: check.name === "test",
  });

  return {
    name: check.name,
    command: check.command,
    success: result.success,
    output: result.output || (result.success ? "" : "Unknown pre-commit failure"),
    sandbox: result.sandbox,
    sandboxEnforced: result.enforced,
  };
}

function detectRunner(workingDir: string): { command: string; label: string } {
  if (existsSync(join(workingDir, "pnpm-lock.yaml"))) {
    return { command: "pnpm", label: "pnpm" };
  }
  if (existsSync(join(workingDir, "yarn.lock"))) {
    return { command: "yarn", label: "yarn" };
  }
  return { command: "npm", label: "npm" };
}
