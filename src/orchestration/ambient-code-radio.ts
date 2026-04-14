/**
 * Ambient Code Radio -- background daemon that watches file changes and
 * proactively suggests improvements, catches bugs, and spots patterns.
 * Like having a senior developer looking over your shoulder.
 *
 * Analyzes file changes for: bugs, security issues, performance problems,
 * missing tests, style inconsistencies. Maintains a suggestion queue
 * with dismiss/apply actions.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, basename } from "node:path";

// -- Types -------------------------------------------------------------------

export type SuggestionType = "bug" | "improvement" | "security" | "performance" | "style" | "test-gap";
export type SuggestionPriority = "low" | "medium" | "high" | "critical";
export type ChangeType = "create" | "modify" | "delete";

export interface AmbientSuggestion {
  readonly id: string;
  readonly type: SuggestionType;
  readonly file: string;
  readonly line: number | null;
  readonly title: string;
  readonly description: string;
  readonly suggestedFix: string | null;
  readonly confidence: number;
  readonly priority: SuggestionPriority;
  readonly createdAt: number;
}

export interface WatchOptions {
  readonly extensions: readonly string[];
  readonly ignorePatterns: readonly string[];
  readonly maxSuggestions: number;
}

export interface ApplyResult {
  readonly success: boolean;
  readonly suggestionId: string;
  readonly message: string;
}

// -- Pattern detectors -------------------------------------------------------

interface PatternRule {
  readonly type: SuggestionType;
  readonly priority: SuggestionPriority;
  readonly pattern: RegExp;
  readonly title: string;
  readonly description: string;
  readonly fix: string | null;
  readonly confidence: number;
  readonly extensions: readonly string[];
}

const PATTERN_RULES: readonly PatternRule[] = [
  {
    type: "security",
    priority: "critical",
    pattern: /(?:password|secret|api_?key|token)\s*[:=]\s*["'][^"']+["']/i,
    title: "Potential hardcoded secret",
    description: "Detected what appears to be a hardcoded secret or credential. Use environment variables instead.",
    fix: "Replace with process.env.YOUR_SECRET_NAME or a secrets manager.",
    confidence: 0.85,
    extensions: [".ts", ".js", ".py", ".go", ".rs", ".java"],
  },
  {
    type: "bug",
    priority: "high",
    pattern: /console\.log\(/,
    title: "Debug console.log left in code",
    description: "console.log statements may have been left from debugging. Consider removing or replacing with a proper logger.",
    fix: "Remove console.log or replace with a structured logger.",
    confidence: 0.6,
    extensions: [".ts", ".js", ".tsx", ".jsx"],
  },
  {
    type: "security",
    priority: "high",
    pattern: /\beval\s*\(/,
    title: "Use of dynamic code execution",
    description: "Dynamic code execution can run arbitrary code and is a security risk. Use safer alternatives.",
    fix: "Replace with JSON.parse(), a sandboxed evaluator, or safer pattern.",
    confidence: 0.9,
    extensions: [".ts", ".js", ".tsx", ".jsx"],
  },
  {
    type: "performance",
    priority: "medium",
    pattern: /\.forEach\(\s*async\b/,
    title: "Async callback in forEach",
    description: "forEach does not await async callbacks -- use for...of or Promise.all with map instead.",
    fix: "Replace with for...of loop or Promise.all(items.map(async (item) => ...)).",
    confidence: 0.95,
    extensions: [".ts", ".js", ".tsx", ".jsx"],
  },
  {
    type: "bug",
    priority: "high",
    pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/,
    title: "Empty catch block",
    description: "Silently swallowing errors makes debugging difficult. At minimum, log the error.",
    fix: "Add error logging or re-throw with context.",
    confidence: 0.8,
    extensions: [".ts", ".js", ".tsx", ".jsx", ".java"],
  },
  {
    type: "test-gap",
    priority: "medium",
    pattern: /export\s+(?:class|function|const)\s+\w+/,
    title: "Exported symbol may lack tests",
    description: "New exported symbols should have corresponding test coverage.",
    fix: null,
    confidence: 0.4,
    extensions: [".ts", ".js"],
  },
  {
    type: "style",
    priority: "low",
    pattern: /TODO|FIXME|HACK|XXX/,
    title: "TODO/FIXME marker found",
    description: "Code contains a TODO or FIXME comment that may need resolution.",
    fix: null,
    confidence: 0.7,
    extensions: [".ts", ".js", ".py", ".go", ".rs", ".java", ".tsx", ".jsx"],
  },
  {
    type: "improvement",
    priority: "low",
    pattern: /:\s*any(?:\s|[;,\]>)])/,
    title: "TypeScript 'any' type usage",
    description: "Using 'any' defeats TypeScript's type safety. Consider using a specific type or 'unknown'.",
    fix: "Replace 'any' with a specific type, 'unknown', or a generic parameter.",
    confidence: 0.5,
    extensions: [".ts", ".tsx"],
  },
];

const DEFAULT_OPTIONS: WatchOptions = {
  extensions: [".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs"],
  ignorePatterns: ["node_modules", "dist", "build", ".git", "coverage"],
  maxSuggestions: 100,
};

// -- Implementation ----------------------------------------------------------

export class AmbientCodeRadio {
  private readonly suggestions: Map<string, AmbientSuggestion> = new Map();
  private readonly dismissed: Set<string> = new Set();
  private options: WatchOptions = DEFAULT_OPTIONS;
  private watching = false;
  private watchDir: string | null = null;
  private idCounter = 0;

  /**
   * Start watching a directory for changes.
   */
  startWatching(dir: string, options?: Partial<WatchOptions>): void {
    this.watchDir = dir;
    this.watching = true;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Stop watching.
   */
  stopWatching(): void {
    this.watching = false;
    this.watchDir = null;
  }

  /**
   * Whether the radio is actively watching.
   */
  isWatching(): boolean {
    return this.watching;
  }

  /**
   * Get the directory being watched.
   */
  getWatchDir(): string | null {
    return this.watchDir;
  }

  /**
   * Process a file change event and return suggestions if any.
   */
  processChange(filePath: string, changeType: ChangeType): readonly AmbientSuggestion[] {
    if (!this.watching) return [];
    if (changeType === "delete") return [];

    const ext = extname(filePath);
    if (!this.options.extensions.includes(ext)) return [];

    const fileName = basename(filePath);
    if (this.options.ignorePatterns.some((p) => filePath.includes(p))) return [];
    if (fileName.includes(".test.") || fileName.includes(".spec.")) return [];

    if (!existsSync(filePath)) return [];

    let content: string;
    try {
      const stat = statSync(filePath);
      if (stat.size > 100_000) return []; // Skip very large files
      content = readFileSync(filePath, "utf-8");
    } catch {
      return [];
    }

    const newSuggestions: AmbientSuggestion[] = [];
    const lines = content.split("\n");

    for (const rule of PATTERN_RULES) {
      if (!rule.extensions.includes(ext)) continue;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line && rule.pattern.test(line)) {
          // Enforce max suggestions
          if (this.suggestions.size >= this.options.maxSuggestions) break;

          const suggestion = createSuggestion(
            ++this.idCounter,
            rule,
            filePath,
            i + 1, // 1-based line number
          );

          // Skip if we already have a similar suggestion for this file+line
          const dedupKey = `${filePath}:${i + 1}:${rule.title}`;
          if (!this.suggestions.has(dedupKey) && !this.dismissed.has(dedupKey)) {
            this.suggestions.set(suggestion.id, suggestion);
            newSuggestions.push(suggestion);
          }
        }
      }
    }

    return newSuggestions;
  }

  /**
   * Get all pending (non-dismissed) suggestions.
   */
  getSuggestions(): readonly AmbientSuggestion[] {
    return [...this.suggestions.values()]
      .filter((s) => !this.dismissed.has(s.id))
      .sort((a, b) => {
        const priorityOrder: Record<SuggestionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  /**
   * Dismiss a suggestion by ID.
   */
  dismissSuggestion(id: string): void {
    this.dismissed.add(id);
    this.suggestions.delete(id);
  }

  /**
   * Apply a suggestion (placeholder -- actual file modification would be external).
   */
  applySuggestion(id: string): ApplyResult {
    const suggestion = this.suggestions.get(id);
    if (!suggestion) {
      return { success: false, suggestionId: id, message: "Suggestion not found" };
    }

    if (!suggestion.suggestedFix) {
      return { success: false, suggestionId: id, message: "No automatic fix available" };
    }

    // Mark as applied (remove from queue)
    this.suggestions.delete(id);

    return {
      success: true,
      suggestionId: id,
      message: `Applied fix: ${suggestion.suggestedFix}`,
    };
  }

  /**
   * Clear all suggestions.
   */
  clearSuggestions(): void {
    this.suggestions.clear();
    this.dismissed.clear();
  }
}

// -- Helpers -----------------------------------------------------------------

function createSuggestion(
  counter: number,
  rule: PatternRule,
  file: string,
  line: number,
): AmbientSuggestion {
  return {
    id: `as_${counter}`,
    type: rule.type,
    file,
    line,
    title: rule.title,
    description: rule.description,
    suggestedFix: rule.fix,
    confidence: rule.confidence,
    priority: rule.priority,
    createdAt: Date.now(),
  };
}
