/**
 * BugBot Autofix Pipeline — automated bug detection and fix generation
 * from diffs, file contents, and PR reviews.
 *
 * Analyzes code diffs for common bug patterns including:
 * - Null/undefined dereference risks
 * - Uncaught promise rejections
 * - Resource leaks (missing close/cleanup)
 * - Type coercion errors
 * - Off-by-one errors in loops/slices
 * - Security issues (eval, injection, hardcoded secrets)
 * - Mutation of readonly/const data
 * - Dead code after return/throw
 *
 * Generates fix suggestions and PR review comments in Markdown format.
 */

// ── Public Types ──────────────────────────────────────

export type BugSeverity = "critical" | "high" | "medium" | "low";

export interface BugReport {
  readonly file: string;
  readonly line: number;
  readonly severity: BugSeverity;
  readonly description: string;
  readonly suggestedFix?: string;
  readonly rule: string;
  readonly confidence: number;
}

export interface BugBotConfig {
  readonly enabledRules: ReadonlySet<string>;
  readonly minConfidence: number;
  readonly maxBugsPerFile: number;
  readonly includeSuggestions: boolean;
}

interface BugPattern {
  readonly rule: string;
  readonly severity: BugSeverity;
  readonly confidence: number;
  readonly pattern: RegExp;
  readonly description: string;
  readonly suggestFix?: (match: RegExpExecArray, line: string) => string;
}

// ── Constants ─────────────────────────────────────────

const DEFAULT_CONFIG: BugBotConfig = {
  enabledRules: new Set([
    "null-deref", "uncaught-promise", "resource-leak", "type-coercion",
    "off-by-one", "security-eval", "security-secret", "mutation",
    "dead-code", "unused-catch", "console-log", "any-type",
  ]),
  minConfidence: 0.5,
  maxBugsPerFile: 20,
  includeSuggestions: true,
};

const SEVERITY_ORDER: Record<BugSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SEVERITY_EMOJI: Record<BugSeverity, string> = {
  critical: "red_circle",
  high: "orange_circle",
  medium: "yellow_circle",
  low: "blue_circle",
};

// ── Bug Patterns ──────────────────────────────────────

const BUG_PATTERNS: readonly BugPattern[] = [
  {
    rule: "null-deref",
    severity: "high",
    confidence: 0.75,
    pattern: /(\w+)!\.(\w+)/g,
    description: "Non-null assertion operator used — may throw at runtime if value is null/undefined",
    suggestFix: (match, _line) =>
      `Add a null check: if (${match[1]}) { ${match[1]}.${match[2]} }`,
  },
  {
    rule: "null-deref",
    severity: "medium",
    confidence: 0.65,
    pattern: /(\w+)\?\.(\w+)\(\)/g,
    description: "Optional chaining on function call — result may be undefined if chain breaks",
  },
  {
    rule: "uncaught-promise",
    severity: "high",
    confidence: 0.80,
    pattern: /(?:^|\s)(?:new\s+Promise|\.then)\s*\(/g,
    description: "Promise without .catch() or try/catch — unhandled rejections crash Node.js",
    suggestFix: () => "Add .catch(err => handleError(err)) or wrap in try/catch",
  },
  {
    rule: "resource-leak",
    severity: "high",
    confidence: 0.70,
    pattern: /(?:createReadStream|createWriteStream|connect)\s*\(/g,
    description: "Resource opened but no corresponding close/destroy in scope",
    suggestFix: () => "Use try/finally or a using declaration to ensure cleanup",
  },
  {
    rule: "type-coercion",
    severity: "medium",
    confidence: 0.85,
    pattern: /[^!=]==[^=]/g,
    description: "Loose equality (==) used — may cause unexpected type coercion",
    suggestFix: () => "Replace == with === for strict equality",
  },
  {
    rule: "off-by-one",
    severity: "medium",
    confidence: 0.55,
    pattern: /\.length\s*-\s*0\b/g,
    description: "Subtracting 0 from .length — potential off-by-one (did you mean -1?)",
    suggestFix: () => "Verify: should this be .length - 1 for zero-based indexing?",
  },
  {
    rule: "security-eval",
    severity: "critical",
    confidence: 0.95,
    pattern: /\beval\s*\(/g,
    description: "eval() usage detected — arbitrary code running vulnerability",
    suggestFix: () => "Replace eval() with JSON.parse(), Function constructor, or a safe parser",
  },
  {
    rule: "security-secret",
    severity: "critical",
    confidence: 0.90,
    pattern: /(?:password|secret|api_?key|token)\s*[:=]\s*["'][^"']{8,}["']/gi,
    description: "Possible hardcoded secret or credential in source code",
    suggestFix: () => "Move to environment variable: process.env.SECRET_NAME",
  },
  {
    rule: "mutation",
    severity: "medium",
    confidence: 0.70,
    pattern: /\.push\(|\.splice\(|\.sort\(\)|\.reverse\(\)|delete\s+\w+\.\w+/g,
    description: "In-place mutation detected — may violate immutability constraints",
    suggestFix: () => "Use immutable alternatives: [...arr, item], arr.toSorted(), structuredClone()",
  },
  {
    rule: "dead-code",
    severity: "low",
    confidence: 0.80,
    pattern: /(?:return|throw)\s+[^;]+;\s*\n\s*(?!\/\/|\/\*|\*|}\s*(?:catch|finally|else))[a-zA-Z]/g,
    description: "Code after return/throw is unreachable",
    suggestFix: () => "Remove unreachable code after return/throw statement",
  },
  {
    rule: "unused-catch",
    severity: "medium",
    confidence: 0.75,
    pattern: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g,
    description: "Empty catch block swallows errors silently",
    suggestFix: () => "At minimum log the error: catch (err) { console.error(err); }",
  },
  {
    rule: "console-log",
    severity: "low",
    confidence: 0.90,
    pattern: /console\.log\(/g,
    description: "console.log() left in code — use structured logging in production",
    suggestFix: () => "Replace with a proper logger: logger.debug() or logger.info()",
  },
  {
    rule: "any-type",
    severity: "low",
    confidence: 0.85,
    pattern: /:\s*any\b/g,
    description: "TypeScript 'any' type disables type checking",
    suggestFix: () => "Replace 'any' with 'unknown' and add type narrowing",
  },
];

// ── BugBot Class ──────────────────────────────────────

export class BugBot {
  private readonly config: BugBotConfig;
  private totalScans = 0;
  private totalBugsFound = 0;

  constructor(config?: Partial<BugBotConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze a unified diff string for bugs in added lines.
   * Only scans lines starting with '+' (new code).
   */
  analyzeDiff(diff: string): readonly BugReport[] {
    this.totalScans++;
    const bugs: BugReport[] = [];
    const chunks = parseDiffChunks(diff);

    for (const chunk of chunks) {
      const fileBugs = this.analyzeFileChunk(chunk.file, chunk.addedLines);
      bugs.push(...fileBugs.slice(0, this.config.maxBugsPerFile));
    }

    const sorted = [...bugs].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );

    this.totalBugsFound += sorted.length;
    return sorted;
  }

  /**
   * Generate a fix suggestion for a specific bug in the context of its file.
   * Returns the file content with the suggested fix applied.
   */
  generateFix(bug: BugReport, fileContent: string): string {
    const lines = fileContent.split("\n");
    const lineIndex = bug.line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return fileContent; // Line out of range — return unchanged
    }

    const targetLine = lines[lineIndex]!;

    // Find the matching pattern and apply its fix
    for (const pattern of BUG_PATTERNS) {
      if (pattern.rule !== bug.rule) continue;
      if (!pattern.suggestFix) continue;

      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      const match = regex.exec(targetLine);
      if (match) {
        const fixComment = `// BUGBOT FIX (${bug.rule}): ${pattern.suggestFix(match, targetLine)}`;
        const newLines = [...lines];
        newLines[lineIndex] = `${fixComment}\n${targetLine}`;
        return newLines.join("\n");
      }
    }

    // No automatic fix available — add a comment
    if (bug.suggestedFix) {
      const newLines = [...lines];
      const indent = targetLine.match(/^(\s*)/)?.[1] ?? "";
      newLines[lineIndex] = `${indent}// BUGBOT: ${bug.suggestedFix}\n${targetLine}`;
      return newLines.join("\n");
    }

    return fileContent;
  }

  /**
   * Create a formatted PR comment summarizing all bugs found.
   * Uses GitHub-flavored Markdown with collapsible sections.
   */
  createPRComment(bugs: readonly BugReport[]): string {
    if (bugs.length === 0) {
      return "## BugBot Report\n\nNo issues found. Code looks clean.";
    }

    const lines: string[] = [
      "## BugBot Report",
      "",
      `Found **${bugs.length}** issue${bugs.length === 1 ? "" : "s"}:`,
      "",
    ];

    // Summary table
    const bySeverity = groupBySeverity(bugs);
    for (const [severity, count] of bySeverity) {
      lines.push(`- ${SEVERITY_EMOJI[severity]} **${severity.toUpperCase()}**: ${count}`);
    }
    lines.push("");

    // Group by file
    const byFile = groupByFile(bugs);
    for (const [file, fileBugs] of byFile) {
      lines.push(`### ${file}`);
      lines.push("");

      for (const bug of fileBugs) {
        const emoji = SEVERITY_EMOJI[bug.severity];
        lines.push(`- ${emoji} **Line ${bug.line}** [${bug.rule}]: ${bug.description}`);
        if (bug.suggestedFix) {
          lines.push(`  - Fix: ${bug.suggestedFix}`);
        }
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("*Generated by BugBot — automated code review*");

    return lines.join("\n");
  }

  /**
   * Get scanning statistics.
   */
  getStats(): { totalScans: number; totalBugsFound: number } {
    return { totalScans: this.totalScans, totalBugsFound: this.totalBugsFound };
  }

  // ── Private Analysis ────────────────────────────────

  private analyzeFileChunk(
    file: string,
    addedLines: readonly { line: number; content: string }[],
  ): BugReport[] {
    const bugs: BugReport[] = [];

    for (const { line, content } of addedLines) {
      for (const pattern of BUG_PATTERNS) {
        if (!this.config.enabledRules.has(pattern.rule)) continue;
        if (pattern.confidence < this.config.minConfidence) continue;

        const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
        const match = regex.exec(content);
        if (!match) continue;

        const suggestedFix = this.config.includeSuggestions && pattern.suggestFix
          ? pattern.suggestFix(match, content)
          : undefined;

        bugs.push({
          file,
          line,
          severity: pattern.severity,
          description: pattern.description,
          suggestedFix,
          rule: pattern.rule,
          confidence: pattern.confidence,
        });
      }
    }

    return bugs;
  }
}

// ── Diff Parser ───────────────────────────────────────

interface DiffChunk {
  readonly file: string;
  readonly addedLines: readonly { line: number; content: string }[];
}

/**
 * Parse a unified diff into file chunks with added lines.
 */
function parseDiffChunks(diff: string): readonly DiffChunk[] {
  const chunks: DiffChunk[] = [];
  const lines = diff.split("\n");

  let currentFile = "";
  let currentLine = 0;
  let addedLines: { line: number; content: string }[] = [];

  for (const line of lines) {
    // File header: +++ b/path/to/file.ts
    if (line.startsWith("+++ b/")) {
      if (currentFile && addedLines.length > 0) {
        chunks.push({ file: currentFile, addedLines: [...addedLines] });
      }
      currentFile = line.slice(6);
      addedLines = [];
      continue;
    }

    // Hunk header: @@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1]!, 10);
      continue;
    }

    // Added line
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push({ line: currentLine, content: line.slice(1) });
      currentLine++;
      continue;
    }

    // Context or removed line
    if (!line.startsWith("-")) {
      currentLine++;
    }
  }

  // Flush last file
  if (currentFile && addedLines.length > 0) {
    chunks.push({ file: currentFile, addedLines: [...addedLines] });
  }

  return chunks;
}

// ── Helpers ───────────────────────────────────────────

function groupBySeverity(
  bugs: readonly BugReport[],
): ReadonlyMap<BugSeverity, number> {
  const map = new Map<BugSeverity, number>();
  for (const bug of bugs) {
    map.set(bug.severity, (map.get(bug.severity) ?? 0) + 1);
  }
  return map;
}

function groupByFile(
  bugs: readonly BugReport[],
): ReadonlyMap<string, readonly BugReport[]> {
  const map = new Map<string, BugReport[]>();
  for (const bug of bugs) {
    const existing = map.get(bug.file) ?? [];
    map.set(bug.file, [...existing, bug]);
  }
  return map;
}
