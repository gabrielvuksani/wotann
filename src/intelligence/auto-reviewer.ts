/**
 * Auto-Reviewer — automated code review using configurable rule sets.
 *
 * Checks for naming conventions, file size limits, import patterns,
 * TODO markers, and custom rules loaded from a config directory.
 * Produces structured violations that can be rendered as PR comments
 * or TUI output.
 *
 * Follows the Conductor pattern: rules are loaded from disk, applied
 * to change sets, and violations are reported with file/line precision.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, extname, basename } from "node:path";

// ── Public Types ──────────────────────────────────────

export type ViolationSeverity = "error" | "warning" | "info";

export interface ReviewViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly severity: ViolationSeverity;
  readonly message: string;
}

export interface ReviewRule {
  readonly id: string;
  readonly severity: ViolationSeverity;
  readonly description: string;
  readonly check: (file: FileChange) => readonly ReviewViolation[];
  readonly fileFilter?: (path: string) => boolean;
}

export interface FileChange {
  readonly path: string;
  readonly content: string;
}

export interface ReviewReport {
  readonly violations: readonly ReviewViolation[];
  readonly fileCount: number;
  readonly ruleCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly passed: boolean;
}

export interface ReviewConfig {
  readonly maxFileLines: number;
  readonly maxFunctionLines: number;
  readonly bannedImports: readonly string[];
  readonly requiredPatterns: readonly { pattern: string; message: string }[];
  readonly namingConventions: NamingConventions;
  readonly customRules: readonly ReviewRule[];
}

interface NamingConventions {
  readonly classPattern: RegExp;
  readonly functionPattern: RegExp;
  readonly constPattern: RegExp;
  readonly filePattern: RegExp;
}

// ── Constants ─────────��───────────────────────────────

const DEFAULT_MAX_FILE_LINES = 800;
const DEFAULT_MAX_FUNCTION_LINES = 50;

const DEFAULT_NAMING: NamingConventions = {
  classPattern: /^[A-Z][a-zA-Z0-9]*$/,
  functionPattern: /^[a-z][a-zA-Z0-9]*$/,
  constPattern: /^[A-Z][A-Z0-9_]*$/,
  filePattern: /^[a-z][a-z0-9-]*\.[a-z]+$/,
};

const DEFAULT_BANNED_IMPORTS = [
  "lodash", // Prefer native methods
  "moment", // Use Temporal or date-fns
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// ── AutoReviewer ──────────────────────────────────────

export type SlopSeverity = "low" | "medium" | "high";

export interface SlopFinding {
  readonly line: number;
  readonly category: string;
  readonly severity: SlopSeverity;
  readonly match: string;
}

export interface SlopReport {
  readonly slopScore: number;
  readonly findings: readonly SlopFinding[];
}

export class AutoReviewer {
  /**
   * Detect AI-generated "slop" patterns in code output.
   * From gstack v0.16.3.0 cross-model review pattern.
   */
  private static readonly SLOP_PATTERNS: readonly {
    pattern: RegExp;
    category: string;
    severity: SlopSeverity;
  }[] = [
    { pattern: /\/\/ ?(This|The|We|Here|Note:) /gm, category: "unnecessary-comment", severity: "low" },
    { pattern: /\/\*\*\s*\n\s*\*\s*(This|The|A) (function|method|class|module|component)/gm, category: "obvious-docstring", severity: "low" },
    { pattern: /try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{\s*\/\/ ?(ignore|swallow|suppress|do nothing)/gmi, category: "swallowed-error", severity: "high" },
    { pattern: /console\.(log|warn|error)\s*\(\s*['"]TODO/gm, category: "todo-console", severity: "medium" },
    { pattern: /\/\/ eslint-disable/gm, category: "eslint-disable", severity: "medium" },
    { pattern: /as any\b/gm, category: "unsafe-cast", severity: "high" },
    { pattern: /\/\/ @ts-ignore/gm, category: "ts-ignore", severity: "high" },
    { pattern: /placeholder|lorem ipsum|example\.com/gim, category: "placeholder-content", severity: "medium" },
  ];

  private rules: ReviewRule[] = [];
  private config: ReviewConfig = {
    maxFileLines: DEFAULT_MAX_FILE_LINES,
    maxFunctionLines: DEFAULT_MAX_FUNCTION_LINES,
    bannedImports: DEFAULT_BANNED_IMPORTS,
    requiredPatterns: [],
    namingConventions: DEFAULT_NAMING,
    customRules: [],
  };

  constructor() {
    this.rules = buildBuiltinRules(this.config);
  }

  /**
   * Detect AI-generated "slop" patterns in code output.
   * Returns a score (0 = clean, 100 = pure slop) and per-line findings.
   */
  detectSlop(code: string): SlopReport {
    const findings: SlopFinding[] = [];
    const lines = code.split("\n");

    for (const { pattern, category, severity } of AutoReviewer.SLOP_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(code)) !== null) {
        const lineNumber = code.slice(0, match.index).split("\n").length;
        findings.push({
          line: lineNumber,
          category,
          severity,
          match: match[0].slice(0, 60),
        });
      }
    }

    const weights: Record<SlopSeverity, number> = { low: 1, medium: 3, high: 5 };
    const totalWeight = findings.reduce(
      (sum, f) => sum + weights[f.severity],
      0,
    );
    const slopScore = Math.min(
      100,
      Math.round((totalWeight / Math.max(1, lines.length)) * 100),
    );

    return { slopScore, findings };
  }

  /**
   * Load review rules from a configuration directory.
   * Expects JSON files with rule definitions.
   */
  loadRules(configDir: string): void {
    if (!existsSync(configDir)) return;

    // Load config override
    const configPath = join(configDir, "review-config.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<{
          maxFileLines: number;
          maxFunctionLines: number;
          bannedImports: string[];
        }>;

        this.config = {
          ...this.config,
          maxFileLines: parsed.maxFileLines ?? this.config.maxFileLines,
          maxFunctionLines: parsed.maxFunctionLines ?? this.config.maxFunctionLines,
          bannedImports: parsed.bannedImports ?? this.config.bannedImports,
        };
      } catch {
        // Invalid config — keep defaults
      }
    }

    // Load custom pattern rules from .json files
    try {
      const files = readdirSync(configDir).filter(
        (f) => f.endsWith(".json") && f !== "review-config.json",
      );

      for (const file of files) {
        const rulePath = join(configDir, file);
        try {
          const raw = readFileSync(rulePath, "utf-8");
          const parsed = JSON.parse(raw) as {
            id?: string;
            severity?: ViolationSeverity;
            pattern?: string;
            message?: string;
            extensions?: string[];
          };

          if (parsed.id && parsed.pattern && parsed.message) {
            const regex = new RegExp(parsed.pattern, "g");
            const extensions = parsed.extensions
              ? new Set(parsed.extensions)
              : SOURCE_EXTENSIONS;

            this.rules.push({
              id: parsed.id,
              severity: parsed.severity ?? "warning",
              description: parsed.message,
              fileFilter: (path) => extensions.has(extname(path)),
              check: (fileChange) => {
                const violations: ReviewViolation[] = [];
                const lines = fileChange.content.split("\n");

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i]!;
                  regex.lastIndex = 0;
                  if (regex.test(line)) {
                    violations.push({
                      file: fileChange.path,
                      line: i + 1,
                      rule: parsed.id!,
                      severity: parsed.severity ?? "warning",
                      message: parsed.message!,
                    });
                  }
                }

                return violations;
              },
            });
          }
        } catch {
          // Skip invalid rule files
        }
      }
    } catch {
      // Skip if directory is unreadable
    }

    // Rebuild builtin rules with updated config
    this.rules = [...buildBuiltinRules(this.config), ...this.rules.filter((r) => !isBuiltinRule(r.id))];
  }

  /**
   * Review a set of file changes and return all violations.
   */
  reviewChanges(changes: readonly FileChange[]): readonly ReviewViolation[] {
    const violations: ReviewViolation[] = [];

    for (const change of changes) {
      for (const rule of this.rules) {
        // Skip rules that don't apply to this file type
        if (rule.fileFilter && !rule.fileFilter(change.path)) continue;

        const ruleViolations = rule.check(change);
        violations.push(...ruleViolations);
      }
    }

    return [...violations].sort(severityComparator);
  }

  /**
   * Review changes and return a full report with summary.
   */
  reviewWithReport(changes: readonly FileChange[]): ReviewReport {
    const violations = this.reviewChanges(changes);

    const errorCount = violations.filter((v) => v.severity === "error").length;
    const warningCount = violations.filter((v) => v.severity === "warning").length;
    const infoCount = violations.filter((v) => v.severity === "info").length;

    return {
      violations,
      fileCount: changes.length,
      ruleCount: this.rules.length,
      errorCount,
      warningCount,
      infoCount,
      passed: errorCount === 0,
    };
  }

  /**
   * Format violations as a Markdown report.
   */
  formatReport(report: ReviewReport): string {
    const lines: string[] = [
      "## Auto-Review Report",
      "",
      `Files reviewed: ${report.fileCount} | Rules applied: ${report.ruleCount}`,
      `Result: ${report.passed ? "PASSED" : "FAILED"}`,
      "",
    ];

    if (report.violations.length === 0) {
      lines.push("No violations found.");
      return lines.join("\n");
    }

    lines.push(`| Severity | Count |`);
    lines.push(`|----------|-------|`);
    if (report.errorCount > 0) lines.push(`| Error | ${report.errorCount} |`);
    if (report.warningCount > 0) lines.push(`| Warning | ${report.warningCount} |`);
    if (report.infoCount > 0) lines.push(`| Info | ${report.infoCount} |`);
    lines.push("");

    // Group by file
    const byFile = new Map<string, ReviewViolation[]>();
    for (const v of report.violations) {
      const existing = byFile.get(v.file) ?? [];
      byFile.set(v.file, [...existing, v]);
    }

    for (const [file, fileViolations] of byFile) {
      lines.push(`### ${file}`);
      for (const v of fileViolations) {
        const icon = v.severity === "error" ? "x" : v.severity === "warning" ? "!" : "i";
        lines.push(`- [${icon}] Line ${v.line}: **${v.rule}** -- ${v.message}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Get the current rule count.
   */
  getRuleCount(): number {
    return this.rules.length;
  }
}

// ── Built-in Rules ────────────────────────────────────

const BUILTIN_RULE_IDS = new Set([
  "file-size", "function-size", "banned-import", "todo-marker",
  "naming-class", "naming-file", "console-log", "any-type",
]);

function isBuiltinRule(id: string): boolean {
  return BUILTIN_RULE_IDS.has(id);
}

function buildBuiltinRules(config: ReviewConfig): ReviewRule[] {
  const rules: ReviewRule[] = [];

  // File size limit
  rules.push({
    id: "file-size",
    severity: "error",
    description: `File exceeds ${config.maxFileLines} line limit`,
    fileFilter: (path) => SOURCE_EXTENSIONS.has(extname(path)),
    check: (file) => {
      const lineCount = file.content.split("\n").length;
      if (lineCount > config.maxFileLines) {
        return [{
          file: file.path,
          line: 1,
          rule: "file-size",
          severity: "error" as const,
          message: `File has ${lineCount} lines (max: ${config.maxFileLines})`,
        }];
      }
      return [];
    },
  });

  // Function size limit
  rules.push({
    id: "function-size",
    severity: "warning",
    description: `Function exceeds ${config.maxFunctionLines} line limit`,
    fileFilter: (path) => SOURCE_EXTENSIONS.has(extname(path)),
    check: (file) => {
      const violations: ReviewViolation[] = [];
      const funcRe = /(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>)/g;

      let match = funcRe.exec(file.content);
      while (match !== null) {
        const startLine = file.content.slice(0, match.index).split("\n").length;
        const bodySize = estimateFunctionSize(file.content, match.index);

        if (bodySize > config.maxFunctionLines) {
          violations.push({
            file: file.path,
            line: startLine,
            rule: "function-size",
            severity: "warning",
            message: `Function body is ~${bodySize} lines (max: ${config.maxFunctionLines})`,
          });
        }
        match = funcRe.exec(file.content);
      }

      return violations;
    },
  });

  // Banned imports
  rules.push({
    id: "banned-import",
    severity: "error",
    description: "Import from banned package",
    fileFilter: (path) => SOURCE_EXTENSIONS.has(extname(path)),
    check: (file) => {
      const violations: ReviewViolation[] = [];
      const lines = file.content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const banned of config.bannedImports) {
          if (line.includes(`from "${banned}"`) || line.includes(`from '${banned}'`)) {
            violations.push({
              file: file.path,
              line: i + 1,
              rule: "banned-import",
              severity: "error",
              message: `Import from banned package: ${banned}`,
            });
          }
        }
      }

      return violations;
    },
  });

  // TODO markers
  rules.push({
    id: "todo-marker",
    severity: "info",
    description: "TODO/FIXME/HACK marker found",
    check: (file) => {
      const violations: ReviewViolation[] = [];
      const lines = file.content.split("\n");
      const markerRe = /\b(TODO|FIXME|HACK|XXX)\b/g;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        markerRe.lastIndex = 0;
        const match = markerRe.exec(line);
        if (match) {
          violations.push({
            file: file.path,
            line: i + 1,
            rule: "todo-marker",
            severity: "info",
            message: `${match[1]} marker: ${line.trim().slice(0, 80)}`,
          });
        }
      }

      return violations;
    },
  });

  // Class naming convention
  rules.push({
    id: "naming-class",
    severity: "warning",
    description: "Class name should be PascalCase",
    fileFilter: (path) => SOURCE_EXTENSIONS.has(extname(path)),
    check: (file) => {
      const violations: ReviewViolation[] = [];
      const classRe = /(?:export\s+)?class\s+(\w+)/g;

      let match = classRe.exec(file.content);
      while (match !== null) {
        const name = match[1]!;
        if (!config.namingConventions.classPattern.test(name)) {
          const lineNum = file.content.slice(0, match.index).split("\n").length;
          violations.push({
            file: file.path,
            line: lineNum,
            rule: "naming-class",
            severity: "warning",
            message: `Class "${name}" should be PascalCase`,
          });
        }
        match = classRe.exec(file.content);
      }

      return violations;
    },
  });

  // File naming convention
  rules.push({
    id: "naming-file",
    severity: "info",
    description: "File name should be kebab-case",
    check: (file) => {
      const fileName = basename(file.path);
      if (!config.namingConventions.filePattern.test(fileName)) {
        return [{
          file: file.path,
          line: 1,
          rule: "naming-file",
          severity: "info" as const,
          message: `File name "${fileName}" should be kebab-case (e.g., my-module.ts)`,
        }];
      }
      return [];
    },
  });

  // console.log detection
  rules.push({
    id: "console-log",
    severity: "warning",
    description: "console.log left in production code",
    fileFilter: (path) => SOURCE_EXTENSIONS.has(extname(path)),
    check: (file) => {
      const violations: ReviewViolation[] = [];
      const lines = file.content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes("console.log(")) {
          violations.push({
            file: file.path,
            line: i + 1,
            rule: "console-log",
            severity: "warning",
            message: "console.log() should be replaced with structured logging",
          });
        }
      }

      return violations;
    },
  });

  // TypeScript any type
  rules.push({
    id: "any-type",
    severity: "warning",
    description: "TypeScript 'any' type disables type safety",
    fileFilter: (path) => extname(path) === ".ts" || extname(path) === ".tsx",
    check: (file) => {
      const violations: ReviewViolation[] = [];
      const lines = file.content.split("\n");
      const anyRe = /:\s*any\b/g;

      for (let i = 0; i < lines.length; i++) {
        anyRe.lastIndex = 0;
        if (anyRe.test(lines[i]!)) {
          violations.push({
            file: file.path,
            line: i + 1,
            rule: "any-type",
            severity: "warning",
            message: "Use 'unknown' instead of 'any' for type safety",
          });
        }
      }

      return violations;
    },
  });

  return rules;
}

// ── Helpers ─────��───────────────────────��─────────────

function estimateFunctionSize(content: string, startIndex: number): number {
  let braces = 0;
  let started = false;
  let lines = 0;

  for (let i = startIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") {
      braces++;
      started = true;
    } else if (ch === "}") {
      braces--;
      if (started && braces === 0) break;
    } else if (ch === "\n") {
      if (started) lines++;
    }
  }

  return lines;
}

const SEVERITY_WEIGHT: Record<ViolationSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function severityComparator(a: ReviewViolation, b: ReviewViolation): number {
  const severityDiff = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
  if (severityDiff !== 0) return severityDiff;
  const fileDiff = a.file.localeCompare(b.file);
  if (fileDiff !== 0) return fileDiff;
  return a.line - b.line;
}
