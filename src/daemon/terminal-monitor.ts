/**
 * Terminal Output Monitor — watches shell command outputs for errors
 * and proactively suggests fixes. Inspired by Windsurf's terminal awareness.
 */

// ── Types ────────────────────────────────────────────────────

export interface TerminalEvent {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number;
  readonly timestamp: number;
  readonly hasError: boolean;
  readonly errorType?: string;
  readonly suggestedFix?: string;
}

// ── Error Patterns ───────────────────────────────────────────

interface ErrorPattern {
  readonly pattern: RegExp;
  readonly errorType: string;
  readonly suggestedFix: string;
}

const ERROR_PATTERNS: readonly ErrorPattern[] = [
  {
    pattern: /npm ERR!.*[Mm]issing script/,
    errorType: "missing-script",
    suggestedFix: "Check package.json scripts section",
  },
  {
    pattern: /ENOENT/,
    errorType: "file-not-found",
    suggestedFix: "File or directory not found: check the path",
  },
  {
    pattern: /EACCES|Permission denied/i,
    errorType: "permission-denied",
    suggestedFix: "Permission denied: try with sudo or fix file permissions",
  },
  {
    pattern: /Module not found|Cannot find module/,
    errorType: "missing-module",
    suggestedFix: "Missing dependency: run npm install",
  },
  {
    pattern: /SyntaxError/,
    errorType: "syntax-error",
    suggestedFix: "Syntax error in code: check the file for typos",
  },
  {
    pattern: /EADDRINUSE/,
    errorType: "port-in-use",
    suggestedFix: "Port already in use: kill the existing process or use a different port",
  },
  {
    pattern: /TypeError/,
    errorType: "type-error",
    suggestedFix: "Runtime error: check variable types and definitions",
  },
  {
    pattern: /ReferenceError/,
    errorType: "reference-error",
    suggestedFix: "Runtime error: check variable types and definitions",
  },
  {
    pattern: /^fatal:|^error:.*git|^hint:/m,
    errorType: "git-error",
    suggestedFix: "Git operation failed: check branch state and remote",
  },
];

// ── Constants ────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY = 50;

// ── Helpers ──────────────────────────────────────────────────

function detectError(
  output: string,
  exitCode: number,
): { readonly hasError: boolean; readonly errorType?: string; readonly suggestedFix?: string } {
  // Check each pattern against the output
  for (const { pattern, errorType, suggestedFix } of ERROR_PATTERNS) {
    if (pattern.test(output)) {
      return { hasError: true, errorType, suggestedFix };
    }
  }

  // Non-zero exit code with no recognized pattern
  if (exitCode !== 0) {
    return {
      hasError: true,
      errorType: "unknown-error",
      suggestedFix: `Command failed with exit code ${exitCode}`,
    };
  }

  return { hasError: false };
}

// ── Monitor ──────────────────────────────────────────────────

export class TerminalMonitor {
  private readonly maxHistory: number;
  private readonly events: TerminalEvent[];

  constructor(maxHistory?: number) {
    this.maxHistory = maxHistory ?? DEFAULT_MAX_HISTORY;
    this.events = [];
  }

  /** Record a command execution result. Returns the created event. */
  record(command: string, output: string, exitCode: number): TerminalEvent {
    const { hasError, errorType, suggestedFix } = detectError(output, exitCode);

    const event: TerminalEvent = {
      command,
      output,
      exitCode,
      timestamp: Date.now(),
      hasError,
      ...(errorType !== undefined ? { errorType } : {}),
      ...(suggestedFix !== undefined ? { suggestedFix } : {}),
    };

    this.events.push(event);

    // Trim oldest entries beyond the cap
    if (this.events.length > this.maxHistory) {
      this.events.splice(0, this.events.length - this.maxHistory);
    }

    return event;
  }

  /** Get recent terminal events (most recent first). */
  getRecent(limit?: number): readonly TerminalEvent[] {
    const cap = limit ?? this.events.length;
    return [...this.events].reverse().slice(0, cap);
  }

  /** Get only error events (most recent first). */
  getErrors(limit?: number): readonly TerminalEvent[] {
    const errors = this.events.filter((e) => e.hasError);
    const reversed = [...errors].reverse();
    return limit !== undefined ? reversed.slice(0, limit) : reversed;
  }

  /** Get the most recent error event with a suggested fix, or null. */
  getLastErrorWithSuggestion(): TerminalEvent | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event !== undefined && event.hasError && event.suggestedFix !== undefined) {
        return event;
      }
    }
    return null;
  }

  /** Clear all history. */
  clear(): void {
    this.events.length = 0;
  }
}
