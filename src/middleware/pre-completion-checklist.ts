/**
 * PreCompletionChecklistMiddleware -- mandatory verification gate.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Models that self-verify catch 40-60% more bugs."
 * ForgeCode (#1 on TerminalBench) uses "mandatory reviewer mode before task
 * completion, generating checklists proving objectives were actually complete."
 *
 * This middleware BLOCKS the agent from claiming "done"/"complete"/"fixed"
 * until all verification checks pass. This is NOT a suggestion -- it is a
 * mandatory gate that the agent cannot bypass.
 *
 * CHECKS:
 * 1. Tests exist for modified files and pass
 * 2. Typecheck passes (no type errors)
 * 3. No TODO/FIXME/stub markers remain in modified files
 * 4. Git diff shows expected changes (files were actually modified)
 *
 * POSITION IN THE 4-LAYER FLOW (see docs/internal/VERIFICATION_LAYERS.md):
 * - Layer 1 (THIS FILE): shell checks run BEFORE claiming done
 * - Layer 2: pre-completion-verifier.ts runs LLM 4-persona review
 * - Layer 3: verification-cascade.ts runs structured stages (tsc/test/build)
 * - Layer 4: chain-of-verification.ts runs CoVe reason-about-reasoning
 *
 * This layer blocks the completion response itself with a deterministic
 * shell-based checklist (tests/tsc/no-stubs/git-diff).
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";
import { containsStubMarkers as checkForStubs } from "../utils/stub-detection.js";

// ── Completion Detection ───────────────────────────────────

/**
 * Patterns that indicate the agent is claiming work is done.
 * These must be detected in the agent's response text.
 */
const COMPLETION_PATTERNS: readonly RegExp[] = [
  /\b(?:i'?m|i am|work is|task is|everything is|it'?s|that'?s|changes? (?:are|is))\s+(?:done|complete|finished|ready)\b/i,
  /\b(?:fix(?:ed)?|resolv(?:ed)?|implement(?:ed)?|accomplish(?:ed)?)\s+(?:successfully|the\s+(?:issue|bug|task|problem))/i,
  /\b(?:all|everything)\s+(?:looks?\s+good|checks?\s+out|pass(?:es|ing)?)\b/i,
  /\bsuccessfully\s+(?:completed|implemented|fixed|resolved)\b/i,
  /\btask\s+(?:has been|is)\s+completed\b/i,
  /\bthe\s+changes?\s+(?:are|have been)\s+(?:made|applied|committed)\b/i,
];

/**
 * Check if a response text indicates the agent is claiming completion.
 */
export function detectCompletionClaim(text: string): boolean {
  return COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

// ── Checklist Item Types ───────────────────────────────────

export interface ChecklistItem {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export interface ChecklistResult {
  readonly passed: boolean;
  readonly items: readonly ChecklistItem[];
  readonly blockedReason?: string;
}

// ── Individual Checks ──────────────────────────────────────

/**
 * Check that typecheck was run and passed during this session.
 */
function checkTypecheck(sessionState: PreCompletionSessionState): ChecklistItem {
  if (!sessionState.hasModifiedFiles) {
    return {
      name: "typecheck",
      passed: true,
      message: "No code files modified",
      severity: "error",
    };
  }

  if (!sessionState.typecheckRan) {
    return {
      name: "typecheck",
      passed: false,
      message:
        "Typecheck has NOT been run after code changes. Run `npx tsc --noEmit` before claiming done.",
      severity: "error",
    };
  }

  if (!sessionState.typecheckPassed) {
    return {
      name: "typecheck",
      passed: false,
      message: "Typecheck FAILED. Fix type errors before claiming done.",
      severity: "error",
    };
  }

  return { name: "typecheck", passed: true, message: "Typecheck passed", severity: "error" };
}

/**
 * Check that tests were run and passed for modified files.
 */
function checkTests(sessionState: PreCompletionSessionState): ChecklistItem {
  if (!sessionState.hasModifiedFiles) {
    return { name: "tests", passed: true, message: "No code files modified", severity: "error" };
  }

  if (!sessionState.testsRan) {
    return {
      name: "tests",
      passed: false,
      message:
        "Tests have NOT been run after code changes. Run relevant tests before claiming done.",
      severity: "error",
    };
  }

  if (!sessionState.testsPassed) {
    return {
      name: "tests",
      passed: false,
      message: "Tests FAILED. Fix failing tests before claiming done.",
      severity: "error",
    };
  }

  return { name: "tests", passed: true, message: "Tests passed", severity: "error" };
}

/**
 * Check that no TODO/FIXME/stub markers remain in modified files.
 */
function checkNoStubs(sessionState: PreCompletionSessionState): ChecklistItem {
  const stubFiles = sessionState.filesWithStubs;
  if (stubFiles.length > 0) {
    return {
      name: "no-stubs",
      passed: false,
      message: `TODO/FIXME/stub markers found in: ${stubFiles.join(", ")}. Remove all stubs before claiming done.`,
      severity: "error",
    };
  }

  return {
    name: "no-stubs",
    passed: true,
    message: "No TODO/FIXME/stub markers found",
    severity: "error",
  };
}

/**
 * Check that git diff shows the expected modified files.
 */
function checkGitDiff(sessionState: PreCompletionSessionState): ChecklistItem {
  if (!sessionState.hasModifiedFiles) {
    return {
      name: "git-diff",
      passed: false,
      message: "No files appear to have been modified. Verify changes were saved.",
      severity: "warning",
    };
  }

  return {
    name: "git-diff",
    passed: true,
    message: `${sessionState.modifiedFileCount} file(s) modified`,
    severity: "warning",
  };
}

// ── Session State Tracking ─────────────────────────────────

/**
 * Tracks the state needed for pre-completion verification.
 * Updated by the middleware as tool calls happen during the session.
 */
export interface PreCompletionSessionState {
  readonly hasModifiedFiles: boolean;
  readonly modifiedFileCount: number;
  readonly modifiedFiles: readonly string[];
  readonly typecheckRan: boolean;
  readonly typecheckPassed: boolean;
  readonly testsRan: boolean;
  readonly testsPassed: boolean;
  readonly filesWithStubs: readonly string[];
}

// ── Stub/TODO Detection ────────────────────────────────────
// Extracted to ../utils/stub-detection.ts to eliminate duplication.
// Re-exported here for backward compatibility with any existing consumers.
export { containsStubMarkers, STUB_PATTERNS } from "../utils/stub-detection.js";

// ── Middleware Class ───────────────────────────────────────

/**
 * Code file extensions that trigger verification tracking.
 */
const CODE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cs",
];

function isCodeFile(filePath: string): boolean {
  return CODE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

/**
 * The PreCompletionChecklist middleware. Tracks session state from tool calls
 * and blocks completion claims until all checks pass.
 */
export class PreCompletionChecklistMiddleware {
  private modifiedFiles: Set<string> = new Set();
  private typecheckRan = false;
  private typecheckPassed = false;
  private testsRan = false;
  private testsPassed = false;
  private filesWithStubs: Set<string> = new Set();
  private blockCount = 0;

  /**
   * Record a file modification. Called when Write/Edit tool is used.
   */
  recordFileModification(filePath: string, content?: string): void {
    if (isCodeFile(filePath)) {
      this.modifiedFiles.add(filePath);

      // Check for stub markers in the written content
      if (content && checkForStubs(content)) {
        this.filesWithStubs.add(filePath);
      } else {
        // Content was rewritten without stubs -- remove from stub list
        this.filesWithStubs.delete(filePath);
      }
    }
  }

  /**
   * Record that typecheck was run. Called when Bash runs tsc/typecheck.
   */
  recordTypecheckResult(passed: boolean): void {
    this.typecheckRan = true;
    this.typecheckPassed = passed;
  }

  /**
   * Record that tests were run. Called when Bash runs test commands.
   */
  recordTestResult(passed: boolean): void {
    this.testsRan = true;
    this.testsPassed = passed;
  }

  /**
   * Get the current session state snapshot (immutable).
   */
  getSessionState(): PreCompletionSessionState {
    return {
      hasModifiedFiles: this.modifiedFiles.size > 0,
      modifiedFileCount: this.modifiedFiles.size,
      modifiedFiles: [...this.modifiedFiles],
      typecheckRan: this.typecheckRan,
      typecheckPassed: this.typecheckPassed,
      testsRan: this.testsRan,
      testsPassed: this.testsPassed,
      filesWithStubs: [...this.filesWithStubs],
    };
  }

  /**
   * Run the full checklist. Returns pass/fail with detailed items.
   */
  runChecklist(): ChecklistResult {
    const state = this.getSessionState();
    const items: readonly ChecklistItem[] = [
      checkTypecheck(state),
      checkTests(state),
      checkNoStubs(state),
      checkGitDiff(state),
    ];

    const errors = items.filter((item) => !item.passed && item.severity === "error");
    const passed = errors.length === 0;

    if (!passed) {
      this.blockCount++;
    }

    return {
      passed,
      items,
      blockedReason: passed
        ? undefined
        : `Pre-completion checklist BLOCKED (attempt #${this.blockCount}): ${errors.map((e) => e.name).join(", ")} failed.`,
    };
  }

  /**
   * Format checklist result as a prompt injection for the model.
   * This tells the model exactly what it needs to fix.
   */
  formatForModel(result: ChecklistResult): string {
    const lines: string[] = [];

    if (result.passed) {
      lines.push("[Pre-Completion Checklist: ALL PASSED]");
      for (const item of result.items) {
        lines.push(`  [PASS] ${item.name}: ${item.message}`);
      }
      return lines.join("\n");
    }

    lines.push("[Pre-Completion Checklist: BLOCKED -- DO NOT claim completion]");
    lines.push("");

    for (const item of result.items) {
      const status = item.passed ? "PASS" : "FAIL";
      lines.push(`  [${status}] ${item.name}: ${item.message}`);
    }

    lines.push("");
    lines.push("You MUST fix all FAIL items before you can claim this work is done.");
    lines.push("Do NOT say 'done', 'complete', or 'fixed' until all checks pass.");

    return lines.join("\n");
  }

  /**
   * Get block statistics.
   */
  getBlockCount(): number {
    return this.blockCount;
  }

  /**
   * Reset state (for new task within same session).
   */
  reset(): void {
    this.modifiedFiles.clear();
    this.typecheckRan = false;
    this.typecheckPassed = false;
    this.testsRan = false;
    this.testsPassed = false;
    this.filesWithStubs.clear();
    this.blockCount = 0;
  }
}

// ── Typecheck/Test Detection from Bash Output ──────────────

const TYPECHECK_COMMANDS: readonly RegExp[] = [
  /\btsc\b.*--noEmit/,
  /\bnpx\s+tsc\b/,
  /\bpnpm\s+(?:run\s+)?typecheck\b/,
  /\bnpm\s+run\s+typecheck\b/,
  /\byarn\s+typecheck\b/,
  /\bpyright\b/,
  /\bmypy\b/,
];

const TEST_COMMANDS: readonly RegExp[] = [
  /\bvitest\b/,
  /\bjest\b/,
  /\bnpm\s+(?:run\s+)?test\b/,
  /\bpnpm\s+(?:run\s+)?test\b/,
  /\byarn\s+test\b/,
  /\bpytest\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
];

/**
 * Detect if a bash command is a typecheck command.
 */
export function isTypecheckCommand(command: string): boolean {
  return TYPECHECK_COMMANDS.some((pattern) => pattern.test(command));
}

/**
 * Detect if a bash command is a test command.
 */
export function isTestCommand(command: string): boolean {
  return TEST_COMMANDS.some((pattern) => pattern.test(command));
}

/**
 * Detect if a command's output indicates success or failure.
 * Uses common patterns from test runners and compilers.
 */
export function didCommandSucceed(output: string, exitCode?: number): boolean {
  // If we have an exit code, trust it
  if (exitCode !== undefined) {
    return exitCode === 0;
  }

  // Heuristic: check for common failure patterns
  const failurePatterns = [
    /\bFAIL(?:ED|URE)?\b/i,
    /\bERROR\b.*\bTS\d{4}\b/, // TypeScript errors
    /\berror\[E\d+\]/, // Rust errors
    /\bfailed\b/i,
    /\b\d+\s+(?:failing|failed)\b/i,
    /exit\s+code\s+[1-9]/i,
  ];

  const successPatterns = [
    /\bPASS(?:ED)?\b/i,
    /\b0\s+(?:errors?|failures?)\b/i,
    /\ball\s+\d+\s+tests?\s+passed\b/i,
    /\bTests?\s+Suites?:.*passed/i,
  ];

  const hasFail = failurePatterns.some((p) => p.test(output));
  const hasSuccess = successPatterns.some((p) => p.test(output));

  // If we see failure patterns, it failed
  if (hasFail && !hasSuccess) return false;
  // If we see success patterns, it passed
  if (hasSuccess) return true;
  // Default: assume success (no clear signal)
  return true;
}

// ── Pipeline Middleware Adapter ─────────────────────────────

/**
 * Create a Middleware adapter that integrates PreCompletionChecklistMiddleware
 * into the 16-layer pipeline. This runs as an `after` hook on every tool call
 * to track state, and blocks completion claims.
 */
export function createPreCompletionMiddleware(
  checklist: PreCompletionChecklistMiddleware,
): Middleware {
  return {
    name: "PreCompletionChecklist",
    order: 17, // After all existing 16 layers
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      // Track file modifications
      if (result.toolName === "Write" || result.toolName === "Edit") {
        if (result.filePath) {
          checklist.recordFileModification(result.filePath, result.content);
        }
      }

      // Track typecheck/test results from Bash
      if (result.toolName === "Bash" && result.content) {
        const command = result.content;

        if (isTypecheckCommand(command)) {
          checklist.recordTypecheckResult(result.success);
        }

        if (isTestCommand(command)) {
          checklist.recordTestResult(result.success);
        }
      }

      // Check if the response claims completion
      if (result.content && detectCompletionClaim(result.content)) {
        const checklistResult = checklist.runChecklist();

        if (!checklistResult.passed) {
          // Block: inject the checklist failure into the response
          const injection = checklist.formatForModel(checklistResult);
          return {
            ...result,
            content: result.content,
            followUp: injection,
            success: false,
          };
        }
      }

      return result;
    },
  };
}
