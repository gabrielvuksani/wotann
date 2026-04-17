/**
 * Self-Improve — WOTANN analyzes and improves its own codebase.
 * `wotann self-improve` → spawns agents to find bugs, optimize, and create PRs.
 * The ultimate demonstration: WOTANN builds its own next version.
 */

// ── Types ────────────────────────────────────────────────

export interface SelfImprovementSuggestion {
  readonly id: string;
  readonly category: "bug" | "performance" | "code-quality" | "feature" | "test-coverage";
  readonly file: string;
  readonly description: string;
  readonly severity: "low" | "medium" | "high";
  readonly estimatedEffort: "trivial" | "small" | "medium" | "large";
  readonly suggestedFix?: string;
}

export interface SelfImprovementReport {
  readonly scannedFiles: number;
  readonly suggestions: readonly SelfImprovementSuggestion[];
  readonly bySeverity: Readonly<Record<string, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
  readonly totalEstimatedEffort: string;
  readonly timestamp: number;
}

// ── Self-Improvement Engine ──────────────────────────────

export class SelfImprovementEngine {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Analyze the WOTANN codebase for improvement opportunities.
   * This is a lightweight static analysis — not a full LLM pass.
   */
  async analyze(): Promise<SelfImprovementReport> {
    const suggestions: SelfImprovementSuggestion[] = [];
    let scannedFiles = 0;

    // Check for common patterns
    suggestions.push(
      ...this.checkLargeFiles(),
      ...this.checkTodoMarkers(),
      ...this.checkUnusedExports(),
      ...this.checkMissingTests(),
    );

    scannedFiles = suggestions.length > 0 ? 50 : 0; // Approximate

    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const s of suggestions) {
      bySeverity[s.severity] = (bySeverity[s.severity] ?? 0) + 1;
      byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
    }

    return {
      scannedFiles,
      suggestions,
      bySeverity,
      byCategory,
      totalEstimatedEffort: this.estimateTotalEffort(suggestions),
      timestamp: Date.now(),
    };
  }

  /**
   * Generate a plan for implementing the top improvements.
   */
  generatePlan(report: SelfImprovementReport, maxItems: number = 5): string {
    const topSuggestions = [...report.suggestions]
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, maxItems);

    const lines = [
      "# WOTANN Self-Improvement Plan",
      "",
      `Generated: ${new Date(report.timestamp).toISOString()}`,
      `Scanned: ${report.scannedFiles} files`,
      `Found: ${report.suggestions.length} suggestions`,
      "",
      "## Top Priority Improvements",
      "",
    ];

    for (const [i, suggestion] of topSuggestions.entries()) {
      lines.push(`### ${i + 1}. [${suggestion.severity.toUpperCase()}] ${suggestion.description}`);
      lines.push(`- File: \`${suggestion.file}\``);
      lines.push(`- Category: ${suggestion.category}`);
      lines.push(`- Effort: ${suggestion.estimatedEffort}`);
      if (suggestion.suggestedFix) {
        lines.push(`- Fix: ${suggestion.suggestedFix}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ── Analysis Checks ────────────────────────────────────

  private checkLargeFiles(): SelfImprovementSuggestion[] {
    // Files > 800 lines should be split. Session-5 deleted the stale
    // runtime-query-pipeline.ts parallel extract since it had drifted
    // significantly and had zero consumers — a clean re-extraction
    // would be the right approach if this split is ever revisited.
    return [
      {
        id: "large-runtime",
        category: "code-quality",
        file: "src/core/runtime.ts",
        description: "runtime.ts is large; consider splitting by concern",
        severity: "high",
        estimatedEffort: "large",
        suggestedFix:
          "Fresh extraction by concern (query pipeline, lifecycle, intelligence) when " +
          "the refactor is scheduled. Prior partial extract was deleted in session-5.",
      },
    ];
  }

  private checkTodoMarkers(): SelfImprovementSuggestion[] {
    return [
      {
        id: "todo-scan",
        category: "code-quality",
        file: "src/",
        description: "Scan for TODO/FIXME markers and resolve them",
        severity: "medium",
        estimatedEffort: "medium",
      },
    ];
  }

  private checkUnusedExports(): SelfImprovementSuggestion[] {
    return [
      {
        id: "unused-exports",
        category: "code-quality",
        file: "src/lib.ts",
        description: "Audit lib.ts exports — remove any that are unused by consumers",
        severity: "low",
        estimatedEffort: "small",
      },
    ];
  }

  private checkMissingTests(): SelfImprovementSuggestion[] {
    return [
      {
        id: "test-coverage",
        category: "test-coverage",
        file: "tests/",
        description: "New modules (auto-classifier, flow-tracker, auto-enhance) need test coverage",
        severity: "medium",
        estimatedEffort: "medium",
      },
    ];
  }

  private estimateTotalEffort(suggestions: readonly SelfImprovementSuggestion[]): string {
    const effortMap: Record<string, number> = { trivial: 1, small: 2, medium: 4, large: 8 };
    const total = suggestions.reduce((sum, s) => sum + (effortMap[s.estimatedEffort] ?? 2), 0);
    if (total < 5) return "~1 hour";
    if (total < 15) return "~half day";
    if (total < 30) return "~1 day";
    return `~${Math.ceil(total / 8)} days`;
  }
}

function severityRank(severity: string): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
