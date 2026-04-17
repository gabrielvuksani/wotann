/**
 * Non-Interactive Benchmark Mode Middleware.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Agents that ask clarification questions during benchmarks waste
 *  turns and score 5-10% lower. Force commitment to best interpretation."
 *
 * When --non-interactive is active (or CI=true, WOTANN_NON_INTERACTIVE=1):
 * - BLOCK all clarification questions from reaching the user
 * - Inject a tail-position directive forcing the agent to commit
 * - Override the clarification middleware's ambiguity detection
 * - Suppress "before I proceed" / "would you like" / "shall I" patterns
 *
 * DETECTION:
 * Non-interactive mode is detected from environment variables and flags:
 * - --non-interactive CLI flag (set in session context)
 * - CI=true (GitHub Actions, GitLab CI, etc.)
 * - WOTANN_NON_INTERACTIVE=1 (explicit opt-in)
 * - NO_TTY / !process.stdout.isTTY (no terminal attached)
 *
 * This middleware operates in the `before` phase to inject the directive
 * and in the `after` phase to catch and suppress clarification responses.
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// -- Clarification Detection Patterns ----------------------------------

/**
 * Patterns indicating the agent is asking a clarification question
 * instead of proceeding with its best interpretation.
 */
const CLARIFICATION_PATTERNS: readonly RegExp[] = [
  /\b(?:would you like|do you want|shall I|should I)\b/i,
  /\b(?:did you mean|could you (?:clarify|specify|confirm))\b/i,
  /\b(?:which (?:one|approach|option)|what (?:do you|would you))\b/i,
  /\b(?:before I (?:proceed|continue|start))\b/i,
  /\b(?:I (?:have|need) (?:a |some )?(?:question|clarification))\b/i,
  /\b(?:can you (?:provide|specify|confirm|clarify))\b/i,
  /\b(?:I'm not sure (?:if|whether|what))\b/i,
  /\?.*\b(?:or|alternatively|prefer)\b.*\?/i,
  /\b(?:a few (?:options|approaches|possibilities))\b/i,
  /\b(?:option (?:1|2|3|A|B|C))\b.*\b(?:option (?:1|2|3|A|B|C))\b/i,
];

// -- Non-Interactive Directive (tail-positioned for recency bias) ------

const NON_INTERACTIVE_DIRECTIVE = [
  "",
  "--- NON-INTERACTIVE MODE ACTIVE ---",
  "There is NO human to answer questions. You are running autonomously.",
  "RULES:",
  "1. DO NOT ask clarification questions under any circumstance.",
  "2. DO NOT present options and ask which to choose.",
  "3. DO NOT say 'before I proceed' or 'would you like'.",
  "4. Commit to your BEST interpretation and execute immediately.",
  "5. If multiple approaches are viable, choose the most standard one.",
  "6. If information is missing, make reasonable assumptions and document them.",
  "7. Every turn spent asking questions is a turn wasted on the benchmark.",
  "--- END NON-INTERACTIVE DIRECTIVE ---",
].join("\n");

// -- Environment Detection --------------------------------------------

/**
 * Detect whether non-interactive mode should be active.
 * Checks multiple signals from the environment.
 */
export function detectNonInteractiveMode(): boolean {
  // Explicit env var
  if (process.env["WOTANN_NON_INTERACTIVE"] === "1") return true;
  if (process.env["WOTANN_NON_INTERACTIVE"] === "true") return true;

  // CI environment (GitHub Actions, GitLab CI, CircleCI, etc.)
  if (process.env["CI"] === "true") return true;
  if (process.env["GITHUB_ACTIONS"] === "true") return true;
  if (process.env["GITLAB_CI"] === "true") return true;

  // TerminalBench runner
  if (process.env["TERMINALBENCH"] === "1") return true;
  if (process.env["TB_RUNNER"] === "1") return true;

  // No TTY attached (piped input)
  if (!process.stdout.isTTY) return true;

  return false;
}

// -- Detection Utility ------------------------------------------------

/**
 * Check if a response text contains clarification questions.
 * Returns matched patterns for diagnostics.
 */
export function detectClarificationQuestions(text: string): {
  readonly detected: boolean;
  readonly patterns: readonly string[];
} {
  const matched: string[] = [];
  for (const pattern of CLARIFICATION_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) {
      matched.push(match[0]);
    }
  }
  return { detected: matched.length > 0, patterns: matched };
}

// -- Middleware State --------------------------------------------------

export interface NonInteractiveState {
  readonly isNonInteractive: boolean;
  readonly suppressedCount: number;
  readonly lastSuppressedTurn: number;
}

// -- Middleware Class --------------------------------------------------

/**
 * NonInteractiveMiddleware blocks clarification questions and injects
 * a forcing directive when running without a human operator.
 *
 * Before hook: injects the non-interactive directive at the tail of
 * the user message (recency bias position) and overrides the
 * clarification middleware's needsClarification flag.
 *
 * After hook: catches agent responses that still ask questions and
 * injects a correction forcing commitment.
 */
export class NonInteractiveMiddleware {
  private isNonInteractive: boolean;
  private suppressedCount = 0;
  private lastSuppressedTurn = 0;

  constructor(forceNonInteractive?: boolean) {
    this.isNonInteractive = forceNonInteractive ?? detectNonInteractiveMode();
  }

  /**
   * Enable or disable non-interactive mode at runtime.
   */
  setNonInteractive(value: boolean): void {
    this.isNonInteractive = value;
  }

  /**
   * Check if non-interactive mode is active.
   */
  isActive(): boolean {
    return this.isNonInteractive;
  }

  /**
   * Get suppression statistics.
   */
  getState(): NonInteractiveState {
    return {
      isNonInteractive: this.isNonInteractive,
      suppressedCount: this.suppressedCount,
      lastSuppressedTurn: this.lastSuppressedTurn,
    };
  }

  /**
   * Reset state for a new task.
   */
  reset(): void {
    this.suppressedCount = 0;
    this.lastSuppressedTurn = 0;
  }
}

// -- Pipeline Middleware Adapter ---------------------------------------

/**
 * Create a Middleware adapter for the non-interactive suppressor.
 * Runs at order 19 (after system notifications at 18) to be the
 * last thing the agent sees in context.
 */
export function createNonInteractiveMiddleware(instance: NonInteractiveMiddleware): Middleware {
  // Turn counter lives on the NonInteractiveMiddleware instance
  // (instance.currentTurn) — the prior local was dead code incrementing
  // a shadow counter that nothing ever read. Removed session-5.
  return {
    name: "NonInteractive",
    order: 19,
    before(ctx: MiddlewareContext): MiddlewareContext {
      if (!instance.isActive()) return ctx;

      // Override the clarification middleware: never request clarification
      // Inject the non-interactive directive at the tail of the message
      return {
        ...ctx,
        needsClarification: false,
        ambiguityScore: 0,
        userMessage: `${ctx.userMessage}${NON_INTERACTIVE_DIRECTIVE}`,
      };
    },
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      if (!instance.isActive()) return result;

      // Detect if the agent's response contains clarification questions
      const detection = detectClarificationQuestions(result.content);
      if (detection.detected) {
        // Suppress by injecting a correction
        const correction = [
          "[NON-INTERACTIVE SUPPRESSION]",
          `Clarification question detected: ${detection.patterns.join(", ")}`,
          "STOP asking questions. Commit to your best interpretation and proceed.",
          "Re-read the task, make reasonable assumptions, and execute.",
        ].join("\n");

        return {
          ...result,
          followUp: correction,
        };
      }

      return result;
    },
  };
}
