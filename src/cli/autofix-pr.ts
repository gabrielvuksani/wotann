/**
 * /autofix-pr (C21) — groups a PR's CI failures into a structured fix
 * plan that the agent can execute step-by-step.
 *
 * Pure analyzer + thin CLI wrapper. The analyzer takes CIFailure
 * objects (same shape GitHubActionsProvider already produces) and
 * returns a FixPlan: ordered, de-duplicated work items keyed by
 * error type, with the failing-file list collapsed per type so the
 * agent doesn't chase a dozen related lint warnings one-by-one.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitHubActionsProvider, type CIFailure } from "../autopilot/ci-feedback.js";

const execFileAsync = promisify(execFile);

// ── Analyzer types ───────────────────────────────────────────

export type FixCategory = "test" | "typecheck" | "lint" | "build" | "deploy" | "unknown";

export interface FixStep {
  readonly category: FixCategory;
  readonly summary: string;
  readonly files: readonly string[];
  readonly hints: readonly string[];
  readonly priority: number; // lower = do first
}

export interface FixPlan {
  readonly steps: readonly FixStep[];
  readonly totalFailures: number;
  readonly uniqueFiles: readonly string[];
  readonly confidence: number; // 0..1 — how sure we are the plan is right
}

// ── Pure analyzer ────────────────────────────────────────────

export function buildFixPlan(failures: readonly CIFailure[]): FixPlan {
  if (failures.length === 0) {
    return { steps: [], totalFailures: 0, uniqueFiles: [], confidence: 1 };
  }

  const byCategory = new Map<FixCategory, CIFailure[]>();
  for (const failure of failures) {
    const cat = normaliseCategory(failure.errorType);
    const list = byCategory.get(cat) ?? [];
    list.push(failure);
    byCategory.set(cat, list);
  }

  const steps: FixStep[] = [];
  for (const [category, groupFailures] of byCategory) {
    const files = dedupeFiles(groupFailures);
    const hints = extractHints(groupFailures);
    steps.push({
      category,
      summary: describeCategory(category, groupFailures.length),
      files,
      hints,
      priority: categoryPriority(category),
    });
  }
  steps.sort((a, b) => a.priority - b.priority);

  const uniqueFiles = dedupeFiles(failures);
  const confidence = computeConfidence(failures, uniqueFiles);

  return {
    steps,
    totalFailures: failures.length,
    uniqueFiles,
    confidence,
  };
}

function normaliseCategory(errorType: CIFailure["errorType"]): FixCategory {
  return errorType === "unknown" ? "unknown" : errorType;
}

/**
 * Fix-order priority — typecheck before lint before tests before build
 * before deploy. Rationale: TS errors cascade into lint warnings and
 * test failures; a clean typecheck often resolves downstream issues
 * without further work, so doing it first minimises wasted cycles.
 */
function categoryPriority(category: FixCategory): number {
  switch (category) {
    case "typecheck":
      return 1;
    case "lint":
      return 2;
    case "test":
      return 3;
    case "build":
      return 4;
    case "deploy":
      return 5;
    case "unknown":
      return 6;
  }
}

function describeCategory(category: FixCategory, count: number): string {
  const noun = count === 1 ? "failure" : "failures";
  switch (category) {
    case "typecheck":
      return `Fix ${count} TypeScript ${noun}`;
    case "lint":
      return `Fix ${count} lint ${noun}`;
    case "test":
      return `Fix ${count} test ${noun}`;
    case "build":
      return `Fix ${count} build ${noun}`;
    case "deploy":
      return `Resolve ${count} deploy ${noun}`;
    case "unknown":
      return `Investigate ${count} uncategorised ${noun}`;
  }
}

function dedupeFiles(failures: readonly CIFailure[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const failure of failures) {
    if (failure.failingFile && !seen.has(failure.failingFile)) {
      seen.add(failure.failingFile);
      out.push(failure.failingFile);
    }
  }
  return out;
}

function extractHints(failures: readonly CIFailure[]): readonly string[] {
  // Gather distinct short hints from messages. We trim each to the
  // first 120 chars to keep the plan readable; the agent can drill
  // into the raw log excerpt via the CIFailure record if needed.
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const failure of failures) {
    const short = (failure.message ?? "").slice(0, 120).trim();
    if (short.length === 0 || seen.has(short)) continue;
    seen.add(short);
    hints.push(short);
    if (hints.length >= 5) break;
  }
  return hints;
}

function computeConfidence(failures: readonly CIFailure[], uniqueFiles: readonly string[]): number {
  // Confidence is higher when failures map to specific files; lower
  // when we have many `unknown` entries or no file pointers at all.
  const withFiles = failures.filter((f) => f.failingFile !== undefined).length;
  const unknowns = failures.filter((f) => f.errorType === "unknown").length;
  if (failures.length === 0) return 1;
  const base = withFiles / failures.length;
  const penalty = unknowns / failures.length;
  // Slight bonus when we have several distinct files — more surface
  // to attack in parallel.
  const breadthBonus = Math.min(0.1, uniqueFiles.length * 0.02);
  return Math.max(0.05, Math.min(1, base - penalty * 0.5 + breadthBonus));
}

export function renderFixPlan(plan: FixPlan): string {
  if (plan.steps.length === 0) return "CI is green — nothing to fix.";

  const lines: string[] = [
    `# Autofix plan — ${plan.totalFailures} failure(s) across ${plan.uniqueFiles.length} file(s)`,
    `Confidence: ${(plan.confidence * 100).toFixed(0)}%`,
    "",
  ];

  plan.steps.forEach((step, idx) => {
    lines.push(`## ${idx + 1}. [${step.category}] ${step.summary}`);
    if (step.files.length > 0) {
      lines.push("   Files:");
      for (const file of step.files.slice(0, 8)) lines.push(`    - ${file}`);
      if (step.files.length > 8) lines.push(`    - …plus ${step.files.length - 8} more`);
    }
    if (step.hints.length > 0) {
      lines.push("   Hints:");
      for (const hint of step.hints) lines.push(`    - ${hint}`);
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

// ── CLI entry ────────────────────────────────────────────────

export interface AutofixPROptions {
  readonly prNumber?: number;
  readonly branch?: string;
  readonly cwd?: string;
}

/**
 * `wotann autofix-pr [--pr <N>] [--branch <name>]` — fetches the latest
 * GitHub Actions run for the PR/branch, parses its failures, and prints
 * a fix plan. Does not modify any files — the agent consumes the plan
 * in a subsequent turn.
 */
export async function runAutofixPR(options: AutofixPROptions): Promise<void> {
  const branch = options.branch ?? (await currentGitBranch(options.cwd));
  if (!branch) {
    console.log("autofix-pr: could not determine branch (not in a git repo?).");
    return;
  }

  const provider = new GitHubActionsProvider();
  const run = await provider.latestRun(branch);
  if (!run) {
    console.log(`autofix-pr: no CI run found for branch "${branch}".`);
    return;
  }

  if (run.status !== "failure") {
    console.log(
      `autofix-pr: latest run on "${branch}" is ${run.status}; ` +
        `no failures to fix (${run.htmlUrl}).`,
    );
    return;
  }

  const failures = await provider.parseFailures(run.id);
  const plan = buildFixPlan(failures);
  console.log(renderFixPlan(plan));
  console.log();
  console.log(`Run: ${run.htmlUrl}`);
}

async function currentGitBranch(cwd: string | undefined): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: cwd ?? process.cwd(),
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
