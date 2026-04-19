/**
 * PR Artifact Generator — create PR-ready output from autonomous results.
 *
 * After an autonomous or autopilot execution completes, this module
 * generates all the artifacts needed for a pull request:
 * - Title and description with markdown formatting
 * - File change summary
 * - Test results summary
 * - Proof bundle reference
 * - Conventional commit message
 */

import type { AutonomousResult } from "../orchestration/autonomous.js";
import type { FixPlan } from "../cli/autofix-pr.js";

// ── Types ────────────────────────────────────────────────────

export interface PRTemplate {
  readonly title: string;
  readonly description: string;
  readonly fileChangeSummary: string;
  readonly testResultsSummary: string;
  readonly proofBundleRef?: string;
  readonly commitMessage: string;
  readonly labels: readonly string[];
}

export interface PRGenerationConfig {
  readonly maxTitleLength: number;
  readonly includeProofBundle: boolean;
  readonly includeTestDetails: boolean;
  readonly includeCostSummary: boolean;
  readonly conventionalCommitType: CommitType;
  readonly scope?: string;
}

export type CommitType = "feat" | "fix" | "refactor" | "test" | "docs" | "chore" | "perf" | "ci";

export interface FileChangeStat {
  readonly path: string;
  readonly action: "added" | "modified" | "deleted";
}

// ── Default Config ───────────────────────────────────────────

const DEFAULT_PR_CONFIG: PRGenerationConfig = {
  maxTitleLength: 72,
  includeProofBundle: true,
  includeTestDetails: true,
  includeCostSummary: true,
  conventionalCommitType: "feat",
};

// ── PR Artifact Generator ────────────────────────────────────

export class PRArtifactGenerator {
  private readonly config: PRGenerationConfig;

  constructor(config?: Partial<PRGenerationConfig>) {
    this.config = { ...DEFAULT_PR_CONFIG, ...config };
  }

  /**
   * Generate a complete PR template from an autonomous execution result.
   */
  generatePR(
    task: string,
    result: AutonomousResult,
    fileStats?: readonly FileChangeStat[],
  ): PRTemplate {
    const title = this.generateTitle(task);
    const fileChangeSummary = this.generateFileChangeSummary(result, fileStats);
    const testResultsSummary = this.generateTestResultsSummary(result);
    const proofBundleRef = this.config.includeProofBundle
      ? this.generateProofBundleRef(result)
      : undefined;
    const commitMessage = this.generateCommitMessage(task, result);
    const labels = this.inferLabels(result);

    const description = this.assembleDescription(
      task,
      result,
      fileChangeSummary,
      testResultsSummary,
      proofBundleRef,
    );

    return {
      title,
      description,
      fileChangeSummary,
      testResultsSummary,
      proofBundleRef,
      commitMessage,
      labels,
    };
  }

  /**
   * Generate just a conventional commit message.
   */
  generateCommitMessage(task: string, result: AutonomousResult): string {
    const type = this.config.conventionalCommitType;
    const scope = this.config.scope ? `(${this.config.scope})` : "";
    const subject = truncate(sanitizeForCommit(task), 50);
    const body = [
      "",
      `Autonomous execution: ${result.totalCycles} cycles, ${result.exitReason}`,
      `Files changed: ${result.filesChanged.length}`,
      `Cost: $${result.totalCostUsd.toFixed(4)}`,
    ].join("\n");

    return `${type}${scope}: ${subject}${body}`;
  }

  /**
   * Generate a PR template from an autofix-pr FixPlan + CI run context.
   *
   * This is the wire-point used by `wotann autofix-pr --create-pr` — it
   * turns the analyzer's structured fix plan into a PR-ready title/body
   * without pretending there was an autopilot cycle. No silent success:
   * callers must still invoke `gh pr create` with the returned template
   * and propagate any failure exit code.
   */
  generatePRFromFixPlan(
    plan: FixPlan,
    context: { readonly branch: string; readonly runUrl?: string },
  ): PRTemplate {
    const titleBase =
      plan.steps.length === 0
        ? `autofix: no CI failures on ${context.branch}`
        : `autofix: ${plan.totalFailures} CI failure(s) across ${plan.uniqueFiles.length} file(s)`;
    const title = truncate(sanitizeForCommit(titleBase), this.config.maxTitleLength);

    const fileChangeSummary = this.summariseFixPlanFiles(plan);
    const testResultsSummary = this.summariseFixPlanChecks(plan);
    const commitMessage = this.generateFixPlanCommitMessage(plan, context);
    const labels = this.inferFixPlanLabels(plan);
    const description = this.assembleFixPlanDescription(
      plan,
      context,
      fileChangeSummary,
      testResultsSummary,
    );

    return {
      title,
      description,
      fileChangeSummary,
      testResultsSummary,
      proofBundleRef: undefined,
      commitMessage,
      labels,
    };
  }

  getConfig(): PRGenerationConfig {
    return this.config;
  }

  // ── Private Helpers ────────────────────────────────────────

  private generateTitle(task: string): string {
    const cleaned = sanitizeForCommit(task);
    return truncate(cleaned, this.config.maxTitleLength);
  }

  private generateFileChangeSummary(
    result: AutonomousResult,
    fileStats?: readonly FileChangeStat[],
  ): string {
    if (fileStats && fileStats.length > 0) {
      const lines = fileStats.map((f) => {
        const icon = f.action === "added" ? "+" : f.action === "deleted" ? "-" : "~";
        return `  ${icon} ${f.path}`;
      });
      return [`### Files Changed (${fileStats.length})`, "", ...lines].join("\n");
    }

    if (result.filesChanged.length === 0) {
      return "### Files Changed\n\nNo files were modified.";
    }

    const lines = result.filesChanged.map((f) => `  ~ ${f}`);
    return [`### Files Changed (${result.filesChanged.length})`, "", ...lines].join("\n");
  }

  private generateTestResultsSummary(result: AutonomousResult): string {
    const lastCycle = result.cycles[result.cycles.length - 1];
    if (!lastCycle) {
      return "### Test Results\n\nNo test results available.";
    }

    const lines = [
      "### Test Results",
      "",
      `| Check | Status |`,
      `|-------|--------|`,
      `| Tests | ${lastCycle.testsPass ? "PASS" : "FAIL"} |`,
      `| TypeCheck | ${lastCycle.typecheckPass ? "PASS" : "FAIL"} |`,
      `| Lint | ${lastCycle.lintPass ? "PASS" : "FAIL"} |`,
    ];

    if (this.config.includeTestDetails && lastCycle.verificationOutput) {
      lines.push("", "**Verification output (last 500 chars):**", "```");
      lines.push(lastCycle.verificationOutput.slice(-500));
      lines.push("```");
    }

    return lines.join("\n");
  }

  private generateProofBundleRef(result: AutonomousResult): string {
    return [
      "### Proof Bundle",
      "",
      `- **Success**: ${result.success}`,
      `- **Exit reason**: ${result.exitReason}`,
      `- **Total cycles**: ${result.totalCycles}`,
      `- **Strategy**: ${result.strategy}`,
      `- **Total cost**: $${result.totalCostUsd.toFixed(4)}`,
      `- **Total tokens**: ${result.totalTokens.toLocaleString()}`,
    ].join("\n");
  }

  private assembleDescription(
    task: string,
    result: AutonomousResult,
    fileChangeSummary: string,
    testResultsSummary: string,
    proofBundleRef?: string,
  ): string {
    const sections: string[] = [
      "## Summary",
      "",
      task,
      "",
      "## Execution Details",
      "",
      `- **Cycles**: ${result.totalCycles}`,
      `- **Duration**: ${formatDuration(result.totalDurationMs)}`,
      `- **Strategy**: ${result.strategy}`,
      `- **Exit reason**: ${result.exitReason}`,
    ];

    if (this.config.includeCostSummary) {
      sections.push(
        "",
        "## Cost",
        "",
        `- **Total cost**: $${result.totalCostUsd.toFixed(4)}`,
        `- **Total tokens**: ${result.totalTokens.toLocaleString()}`,
      );
    }

    sections.push("", fileChangeSummary, "", testResultsSummary);

    if (proofBundleRef) {
      sections.push("", proofBundleRef);
    }

    sections.push("", "---", "", "Generated by WOTANN Autopilot");

    return sections.join("\n");
  }

  private inferLabels(result: AutonomousResult): readonly string[] {
    const labels: string[] = [];

    labels.push(`type:${this.config.conventionalCommitType}`);

    if (result.success) {
      labels.push("autopilot:success");
    } else {
      labels.push("autopilot:needs-review");
    }

    if (result.totalCycles > 10) {
      labels.push("complexity:high");
    }

    return labels;
  }

  private summariseFixPlanFiles(plan: FixPlan): string {
    if (plan.uniqueFiles.length === 0) {
      return "### Files Flagged\n\nNo failing files were identified from CI logs.";
    }
    const lines = plan.uniqueFiles.map((f) => `  ~ ${f}`);
    return [`### Files Flagged (${plan.uniqueFiles.length})`, "", ...lines].join("\n");
  }

  private summariseFixPlanChecks(plan: FixPlan): string {
    if (plan.steps.length === 0) {
      return "### CI Checks\n\nAll checks green — nothing to fix.";
    }
    const byCategory = new Map<string, number>();
    for (const step of plan.steps) {
      byCategory.set(step.category, (byCategory.get(step.category) ?? 0) + 1);
    }
    const header = [
      "### CI Checks",
      "",
      `Confidence: ${(plan.confidence * 100).toFixed(0)}%`,
      "",
      `| Category | Step Count |`,
      `|----------|-----------:|`,
    ];
    const rows: string[] = [];
    for (const [category, count] of byCategory) {
      rows.push(`| ${category} | ${count} |`);
    }
    return [...header, ...rows].join("\n");
  }

  private generateFixPlanCommitMessage(
    plan: FixPlan,
    context: { readonly branch: string; readonly runUrl?: string },
  ): string {
    const type = this.config.conventionalCommitType;
    const scope = this.config.scope ? `(${this.config.scope})` : "";
    const subject = truncate(
      sanitizeForCommit(
        plan.steps.length === 0
          ? `autofix on ${context.branch} — no failures`
          : `autofix ${plan.totalFailures} CI failure(s) on ${context.branch}`,
      ),
      50,
    );
    const bodyLines = [
      "",
      `Fix plan: ${plan.steps.length} step(s), ${plan.uniqueFiles.length} file(s)`,
      `Confidence: ${(plan.confidence * 100).toFixed(0)}%`,
    ];
    if (context.runUrl) {
      bodyLines.push(`Run: ${context.runUrl}`);
    }
    return `${type}${scope}: ${subject}${bodyLines.join("\n")}`;
  }

  private inferFixPlanLabels(plan: FixPlan): readonly string[] {
    const labels: string[] = [`type:${this.config.conventionalCommitType}`, "autofix"];
    if (plan.steps.length === 0) {
      labels.push("autofix:noop");
      return labels;
    }
    if (plan.confidence >= 0.7) {
      labels.push("autofix:confident");
    } else if (plan.confidence < 0.35) {
      labels.push("autofix:needs-review");
    }
    for (const step of plan.steps) {
      labels.push(`autofix:${step.category}`);
    }
    return Array.from(new Set(labels));
  }

  private assembleFixPlanDescription(
    plan: FixPlan,
    context: { readonly branch: string; readonly runUrl?: string },
    fileChangeSummary: string,
    testResultsSummary: string,
  ): string {
    const sections: string[] = [
      "## Summary",
      "",
      plan.steps.length === 0
        ? `No CI failures were found for branch \`${context.branch}\`.`
        : `Autofix plan for \`${context.branch}\` — ${plan.totalFailures} CI failure(s) grouped into ${plan.steps.length} step(s).`,
      "",
      "## Fix Plan",
      "",
    ];

    if (plan.steps.length === 0) {
      sections.push("_No remediation steps — CI is green._");
    } else {
      plan.steps.forEach((step, idx) => {
        sections.push(`### ${idx + 1}. [${step.category}] ${step.summary}`);
        if (step.files.length > 0) {
          sections.push("", "Files:");
          for (const file of step.files.slice(0, 8)) sections.push(`- ${file}`);
          if (step.files.length > 8) sections.push(`- …plus ${step.files.length - 8} more`);
        }
        if (step.hints.length > 0) {
          sections.push("", "Hints:");
          for (const hint of step.hints) sections.push(`- ${hint}`);
        }
        sections.push("");
      });
    }

    sections.push("", fileChangeSummary, "", testResultsSummary);

    if (context.runUrl) {
      sections.push("", `CI run: ${context.runUrl}`);
    }

    sections.push("", "---", "", "Generated by `wotann autofix-pr --create-pr`");

    return sections.join("\n");
  }
}

// ── Module-Level Helpers ─────────────────────────────────────

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function sanitizeForCommit(text: string): string {
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
