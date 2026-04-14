/**
 * Auto-Commit -- create atomic conventional commits after each verified task.
 * GSD-inspired: every autonomous subtask that passes verification gets committed.
 *
 * Generates conventional commit messages from task context.
 * Only commits when verification (tests) pass.
 * Tracks commit history for audit trail.
 */

import { randomUUID } from "node:crypto";

// -- Types -------------------------------------------------------------------

export type ConventionalType = "feat" | "fix" | "refactor" | "test" | "docs" | "chore" | "perf" | "ci" | "build" | "style";

export interface ConventionalCommit {
  readonly type: ConventionalType;
  readonly scope: string | null;
  readonly description: string;
  readonly body: string | null;
  readonly breaking: boolean;
  readonly formatted: string;
}

export interface CommitResult {
  readonly success: boolean;
  readonly commitHash: string | null;
  readonly message: string;
  readonly filesCommitted: readonly string[];
  readonly timestamp: number;
}

export interface CommitRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly task: string;
  readonly commit: ConventionalCommit;
  readonly result: CommitResult;
  readonly timestamp: number;
}

// -- Type detection ----------------------------------------------------------

const TYPE_PATTERNS: ReadonlyArray<readonly [RegExp, ConventionalType]> = [
  [/\b(?:add|create|implement|new|feature)\b/i, "feat"],
  [/\b(?:fix|bug|patch|resolve|repair|correct)\b/i, "fix"],
  [/\b(?:refactor|restructure|reorganize|clean|simplify)\b/i, "refactor"],
  [/\b(?:test|spec|coverage|tdd)\b/i, "test"],
  [/\b(?:doc|readme|comment|jsdoc)\b/i, "docs"],
  [/\b(?:perf|optim|speed|fast|cache)\b/i, "perf"],
  [/\b(?:ci|pipeline|workflow|deploy)\b/i, "ci"],
  [/\b(?:build|bundle|compile|package)\b/i, "build"],
  [/\b(?:style|format|lint|whitespace)\b/i, "style"],
];

const SCOPE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:auth|login|oauth|session)\b/i, "auth"],
  [/\b(?:api|endpoint|route|rest)\b/i, "api"],
  [/\b(?:ui|component|page|layout|style)\b/i, "ui"],
  [/\b(?:db|database|migration|query|sql)\b/i, "db"],
  [/\b(?:config|settings|env)\b/i, "config"],
  [/\b(?:security|xss|csrf|injection)\b/i, "security"],
  [/\b(?:memory|store|cache)\b/i, "memory"],
  [/\b(?:hook|middleware|plugin)\b/i, "hooks"],
  [/\b(?:test|spec)\b/i, "tests"],
];

// -- Implementation ----------------------------------------------------------

export class AutoCommitter {
  private readonly records: CommitRecord[] = [];
  private readonly currentSessionId: string;

  constructor(sessionId?: string) {
    this.currentSessionId = sessionId ?? `session_${randomUUID().slice(0, 8)}`;
  }

  /**
   * Generate a conventional commit message from task context.
   */
  generateCommitMessage(
    task: string,
    changes: readonly string[],
    result: string,
  ): ConventionalCommit {
    const type = detectType(task, changes);
    const scope = detectScope(task, changes);
    const description = buildDescription(task, type);
    const body = changes.length > 0
      ? `Files changed:\n${changes.map((f) => `- ${f}`).join("\n")}\n\nResult: ${truncate(result, 200)}`
      : null;

    const breaking = /\bbreaking\b/i.test(task) || /\bBREAKING[\s_-]?CHANGE\b/.test(task);

    const scopePart = scope ? `(${scope})` : "";
    const breakingMark = breaking ? "!" : "";
    const formatted = `${type}${scopePart}${breakingMark}: ${description}`;

    return { type, scope, description, body, breaking, formatted };
  }

  /**
   * Commit only if verification (tests) passed.
   */
  commitIfVerified(
    workingDir: string,
    task: string,
    changes: readonly string[],
    testsPassed: boolean,
  ): CommitResult | null {
    if (!testsPassed) {
      return null;
    }

    const commit = this.generateCommitMessage(task, changes, "Tests passed");
    const result = simulateCommit(workingDir, commit, changes);

    this.records.push({
      id: `cr_${randomUUID().slice(0, 8)}`,
      sessionId: this.currentSessionId,
      task,
      commit,
      result,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Get commit history for the current session.
   */
  getSessionCommits(sessionId?: string): readonly CommitRecord[] {
    const targetSession = sessionId ?? this.currentSessionId;
    return this.records.filter((r) => r.sessionId === targetSession);
  }

  /**
   * Get all commit records.
   */
  getAllRecords(): readonly CommitRecord[] {
    return [...this.records];
  }

  /**
   * Get current session ID.
   */
  getSessionId(): string {
    return this.currentSessionId;
  }
}

// -- Helpers -----------------------------------------------------------------

function detectType(task: string, changes: readonly string[]): ConventionalType {
  const combined = `${task} ${changes.join(" ")}`;

  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(combined)) return type;
  }

  return "chore";
}

function detectScope(task: string, changes: readonly string[]): string | null {
  const combined = `${task} ${changes.join(" ")}`;

  for (const [pattern, scope] of SCOPE_PATTERNS) {
    if (pattern.test(combined)) return scope;
  }

  // Try to infer scope from file paths
  if (changes.length > 0) {
    const firstDir = changes[0]?.split("/")[1];
    if (firstDir && firstDir.length <= 15) return firstDir;
  }

  return null;
}

function buildDescription(task: string, _type: ConventionalType): string {
  // Remove common prefixes and normalize
  let desc = task
    .replace(/^(?:implement|add|create|fix|update|refactor|write|build)\s+/i, "")
    .trim();

  // Lowercase first char, remove trailing period
  if (desc.length > 0) {
    desc = desc[0]!.toLowerCase() + desc.slice(1);
  }
  desc = desc.replace(/\.$/, "");

  // Truncate to conventional commit limit
  return truncate(desc, 72);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function simulateCommit(
  _workingDir: string,
  commit: ConventionalCommit,
  changes: readonly string[],
): CommitResult {
  // In production, this would run git commands.
  // Here we simulate a successful commit.
  const hash = randomUUID().slice(0, 7);

  return {
    success: true,
    commitHash: hash,
    message: commit.formatted,
    filesCommitted: changes,
    timestamp: Date.now(),
  };
}
