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

import type {
  AutonomousResult,
} from "../orchestration/autonomous.js";

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

export type CommitType =
  | "feat"
  | "fix"
  | "refactor"
  | "test"
  | "docs"
  | "chore"
  | "perf"
  | "ci";

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
      task, result, fileChangeSummary, testResultsSummary, proofBundleRef,
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
  generateCommitMessage(
    task: string,
    result: AutonomousResult,
  ): string {
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
}

// ── Module-Level Helpers ─────────────────────────────────────

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function sanitizeForCommit(text: string): string {
  return text
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
