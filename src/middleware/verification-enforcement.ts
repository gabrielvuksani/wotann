/**
 * Verification Enforcement Middleware (PreCompletionChecklist integration).
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Models that self-verify catch 40-60% more bugs."
 * ForgeCode (#1 on TerminalBench) uses "mandatory reviewer mode before task
 * completion, generating checklists proving objectives were actually complete."
 *
 * This middleware consolidates all verification concerns into a single gate:
 * 1. Tests pass (run test command, check exit code)
 * 2. Typecheck clean (run tsc, check exit code)
 * 3. No TODO/FIXME/stubs in modified files
 * 4. Git diff shows expected changes
 *
 * DIFFERENCE FROM EXISTING FILES:
 * - forced-verification.ts: runs AFTER each Write/Edit (incremental, per-tool)
 * - pre-completion-checklist.ts: checks BEFORE claiming done (final gate class)
 * - THIS FILE: orchestrates both into a unified middleware layer that
 *   blocks the completion response itself with actionable feedback.
 *
 * This is the middleware pipeline integration point. It delegates to
 * PreCompletionChecklistMiddleware for the actual checks, and to
 * ForcedVerificationMiddleware for per-file incremental verification.
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";
import {
  type PreCompletionChecklistMiddleware,
  type ChecklistResult,
  detectCompletionClaim,
  isTypecheckCommand,
  isTestCommand,
} from "./pre-completion-checklist.js";
// -- Stub/TODO Patterns ------------------------------------------------
// Extracted to ../utils/stub-detection.ts to eliminate duplication.
// Re-exported for backward compatibility.

/**
 * Code file extensions that require verification.
 */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".java", ".cs", ".rb", ".php", ".swift", ".kt",
]);

// -- Types -------------------------------------------------------------

export interface VerificationEnforcementState {
  readonly modifiedFiles: readonly string[];
  readonly filesWithStubs: readonly string[];
  readonly typecheckRan: boolean;
  readonly typecheckPassed: boolean;
  readonly testsRan: boolean;
  readonly testsPassed: boolean;
  readonly completionBlockCount: number;
  readonly lastChecklistResult: ChecklistResult | null;
}

// -- Middleware Class ---------------------------------------------------

/**
 * VerificationEnforcementMiddleware wraps the PreCompletionChecklistMiddleware
 * and adds additional tracking for the middleware pipeline.
 *
 * It operates in two modes:
 * 1. TRACKING MODE (after hook): records tool results to build session state
 * 2. GATE MODE (after hook on completion claims): blocks completion if checks fail
 */
export class VerificationEnforcementMiddleware {
  private readonly checklist: PreCompletionChecklistMiddleware;
  private lastChecklistResult: ChecklistResult | null = null;
  private completionBlockCount = 0;

  constructor(checklist: PreCompletionChecklistMiddleware) {
    this.checklist = checklist;
  }

  /**
   * Process a tool result for tracking purposes.
   * Updates the checklist state based on tool calls.
   */
  trackToolResult(result: AgentResult): void {
    // Track file modifications from Write/Edit
    if (
      (result.toolName === "Write" || result.toolName === "Edit") &&
      result.filePath
    ) {
      this.checklist.recordFileModification(result.filePath, result.content);
    }

    // Track typecheck/test results from Bash commands
    if (result.toolName === "Bash" && result.content) {
      if (isTypecheckCommand(result.content)) {
        this.checklist.recordTypecheckResult(result.success);
      }
      if (isTestCommand(result.content)) {
        this.checklist.recordTestResult(result.success);
      }
    }
  }

  /**
   * Check if a response is claiming completion.
   * If so, run the checklist and block if checks fail.
   * Returns null if no blocking needed, or a block message.
   */
  checkCompletion(responseText: string): string | null {
    if (!detectCompletionClaim(responseText)) return null;

    const result = this.checklist.runChecklist();
    this.lastChecklistResult = result;

    if (result.passed) return null;

    this.completionBlockCount++;
    return this.formatBlockMessage(result);
  }

  /**
   * Get the current enforcement state.
   */
  getState(): VerificationEnforcementState {
    const sessionState = this.checklist.getSessionState();
    return {
      modifiedFiles: [...sessionState.modifiedFiles],
      filesWithStubs: [...sessionState.filesWithStubs],
      typecheckRan: sessionState.typecheckRan,
      typecheckPassed: sessionState.typecheckPassed,
      testsRan: sessionState.testsRan,
      testsPassed: sessionState.testsPassed,
      completionBlockCount: this.completionBlockCount,
      lastChecklistResult: this.lastChecklistResult,
    };
  }

  /**
   * Reset for a new task.
   */
  reset(): void {
    this.checklist.reset();
    this.lastChecklistResult = null;
    this.completionBlockCount = 0;
  }

  // -- Private ---------------------------------------------------------

  /**
   * Format a detailed block message that tells the model exactly what to fix.
   */
  private formatBlockMessage(result: ChecklistResult): string {
    const lines: string[] = [
      "[VERIFICATION ENFORCEMENT: COMPLETION BLOCKED]",
      "",
      `Attempt #${this.completionBlockCount} to claim completion. Checklist results:`,
      "",
    ];

    for (const item of result.items) {
      const icon = item.passed ? "PASS" : "FAIL";
      lines.push(`  [${icon}] ${item.name}: ${item.message}`);
    }

    const failures = result.items.filter((i) => !i.passed);
    if (failures.length > 0) {
      lines.push("");
      lines.push("REQUIRED ACTIONS:");
      for (const failure of failures) {
        lines.push(`  - ${failure.message}`);
      }
    }

    lines.push("");
    lines.push("You MUST fix ALL failures before claiming this work is done.");
    lines.push("Do NOT say 'done', 'complete', or 'fixed' until all checks pass.");

    return lines.join("\n");
  }
}

// -- Content Analysis Utilities ----------------------------------------
// containsStubMarkers imported from ../utils/stub-detection.js
export { containsStubMarkers } from "../utils/stub-detection.js";

/**
 * Check if a file path is a code file that requires verification.
 */
export function isCodeFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return CODE_EXTENSIONS.has(ext);
}

// -- Pipeline Middleware Adapter ----------------------------------------

/**
 * Create a Middleware adapter that integrates VerificationEnforcementMiddleware
 * into the pipeline. Runs at order 21 (after plan enforcement at 20).
 *
 * This wraps the PreCompletionChecklistMiddleware with a unified pipeline
 * interface that handles both incremental tracking and completion gating.
 */
export function createVerificationEnforcementMiddleware(
  instance: VerificationEnforcementMiddleware,
): Middleware {
  return {
    name: "VerificationEnforcement",
    order: 21,
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      // Track all tool results for checklist state
      instance.trackToolResult(result);

      // Check if the response claims completion
      if (result.content) {
        const blockMessage = instance.checkCompletion(result.content);
        if (blockMessage) {
          return {
            ...result,
            success: false,
            followUp: blockMessage,
          };
        }
      }

      return result;
    },
  };
}
