/**
 * Mandatory Planning Enforcement Middleware.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Models that plan before coding score 15-30% higher."
 * This is the SINGLE BIGGEST accuracy gain from harness engineering.
 *
 * KEY INSIGHT: enforcement > suggestion.
 * Prompt-based "please plan first" is ignored 40% of the time.
 * Hook-enforced "BLOCKED until plan exists" works 100% of the time.
 *
 * This middleware BLOCKS all modifying tool calls (Write, Edit, Bash)
 * until the agent has created an explicit plan. The plan can be:
 * 1. A TaskCreate/todo_write tool call (detected by tool name)
 * 2. An inline plan in the assistant's message (detected by patterns)
 * 3. Explicitly marked by external code (e.g., the hook engine)
 *
 * Read-only tools (Read, Grep, Glob, LSP, WebSearch) are ALWAYS allowed
 * because research before planning is the correct workflow.
 *
 * COMPLEXITY GATING:
 * Simple tasks (< complexity threshold) bypass planning enforcement.
 * This prevents friction on trivial requests like "fix the typo on line 42".
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// -- Tool Classification -----------------------------------------------

/** Tools that are always allowed even without a plan (read-only / research). */
const ALWAYS_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "LSP",
  "WebSearch",
  "WebFetch",
  "TaskCreate",
  "TodoWrite",
  "todo_write",
]);

/** Tools that create plans when called. */
const PLANNING_TOOLS: ReadonlySet<string> = new Set(["TaskCreate", "TodoWrite", "todo_write"]);

/** Tools that are modifying and require a plan first. */
const MODIFYING_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "Bash", "ComputerUse"]);

// -- Inline Plan Detection ---------------------------------------------

/**
 * Patterns in assistant content that indicate an inline plan.
 * These detect structured plans written as part of the response.
 */
const PLAN_CONTENT_PATTERNS: readonly RegExp[] = [
  // Explicit plan headers
  /^#+\s*(?:Plan|Implementation Plan|Steps|Approach|Strategy)\b/im,
  // Numbered list with 3+ items (a real plan, not just options)
  /^\s*(?:1[.)]\s+.+\n\s*2[.)]\s+.+\n\s*3[.)]\s+.+)/m,
  // Step-by-step markers
  /\bstep\s+1\b.*\bstep\s+2\b.*\bstep\s+3\b/is,
  // Phase markers
  /\bphase\s+1\b.*\bphase\s+2\b/is,
  // Checklist format
  /^\s*[-*]\s+\[[ x]\]\s+.+\n\s*[-*]\s+\[[ x]\]\s+.+/m,
];

/**
 * Detect if text contains an inline plan.
 */
export function detectInlinePlan(text: string): boolean {
  return PLAN_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

// -- Middleware State ---------------------------------------------------

export interface PlanEnforcementState {
  readonly planCreated: boolean;
  readonly blockedAttempts: number;
  readonly planMethod: "tool" | "inline" | "external" | null;
  readonly planCreatedAtTurn: number;
  readonly enforcing: boolean;
}

// -- Middleware Class ---------------------------------------------------

/**
 * PlanEnforcementMiddleware tracks plan state and provides the logic
 * for blocking/allowing tool calls. The actual pipeline integration
 * is done via createPlanEnforcementMiddleware().
 */
export class PlanEnforcementMiddleware {
  private planCreated = false;
  private planMethod: "tool" | "inline" | "external" | null = null;
  private planCreatedAtTurn = 0;
  private blockedAttempts = 0;
  private currentTurn = 0;
  private enforcing = true;

  /** Complexity threshold below which planning is not enforced. */
  private readonly complexityThreshold: "low" | "medium" | "high";

  constructor(complexityThreshold: "low" | "medium" | "high" = "low") {
    this.complexityThreshold = complexityThreshold;
  }

  /**
   * Record that a tool call was made. If it is a planning tool,
   * mark the plan as created.
   */
  recordToolCall(toolName: string): void {
    if (PLANNING_TOOLS.has(toolName) && !this.planCreated) {
      this.planCreated = true;
      this.planMethod = "tool";
      this.planCreatedAtTurn = this.currentTurn;
    }
  }

  /**
   * Check assistant content for inline plans.
   */
  checkAssistantContent(content: string): boolean {
    if (this.planCreated) return true;

    if (detectInlinePlan(content)) {
      this.planCreated = true;
      this.planMethod = "inline";
      this.planCreatedAtTurn = this.currentTurn;
      return true;
    }
    return false;
  }

  /**
   * Mark the plan as created externally (e.g., from the hook engine).
   */
  markPlanCreated(): void {
    if (!this.planCreated) {
      this.planCreated = true;
      this.planMethod = "external";
      this.planCreatedAtTurn = this.currentTurn;
    }
  }

  /**
   * Check if a tool call should be allowed.
   * Returns null if allowed, or a block message if not.
   */
  checkToolCall(toolName: string, complexity?: "low" | "medium" | "high"): string | null {
    // If not enforcing, allow everything
    if (!this.enforcing) return null;

    // If plan exists, allow everything
    if (this.planCreated) return null;

    // Research/planning tools are always allowed
    if (ALWAYS_ALLOWED_TOOLS.has(toolName)) {
      this.recordToolCall(toolName);
      return null;
    }

    // Skip enforcement for simple tasks
    if (complexity && this.shouldSkipEnforcement(complexity)) return null;

    // Only block modifying tools
    if (!MODIFYING_TOOLS.has(toolName)) return null;

    // Block: no plan yet
    this.blockedAttempts++;
    return [
      `BLOCKED: Cannot use ${toolName} before creating a plan.`,
      "",
      `This is attempt #${this.blockedAttempts} to use a modifying tool without a plan.`,
      "",
      "You MUST create a plan first. Options:",
      "1. Use TaskCreate/todo_write to create an explicit plan",
      "2. Write an inline plan with numbered steps (3+ steps)",
      "",
      "Allowed WITHOUT a plan: Read, Glob, Grep, WebSearch (research first).",
      "",
      "Your plan should cover:",
      "- Files to read and understand first",
      "- Files to create or modify",
      "- Order of changes (dependencies)",
      "- Verification steps (tests, typecheck)",
    ].join("\n");
  }

  /**
   * Advance the turn counter.
   */
  advanceTurn(): void {
    this.currentTurn++;
  }

  /**
   * Enable or disable enforcement at runtime.
   */
  setEnforcing(value: boolean): void {
    this.enforcing = value;
  }

  /**
   * Check if a plan has been created.
   */
  hasPlan(): boolean {
    return this.planCreated;
  }

  /**
   * Get the current enforcement state.
   */
  getState(): PlanEnforcementState {
    return {
      planCreated: this.planCreated,
      blockedAttempts: this.blockedAttempts,
      planMethod: this.planMethod,
      planCreatedAtTurn: this.planCreatedAtTurn,
      enforcing: this.enforcing,
    };
  }

  /**
   * Reset for a new task.
   */
  reset(): void {
    this.planCreated = false;
    this.planMethod = null;
    this.planCreatedAtTurn = 0;
    this.blockedAttempts = 0;
    this.currentTurn = 0;
    this.enforcing = true;
  }

  // -- Private ---------------------------------------------------------

  /**
   * Determine if enforcement should be skipped based on task complexity.
   * Simple tasks (fixing a typo, renaming a variable) don't need a plan.
   */
  private shouldSkipEnforcement(complexity: "low" | "medium" | "high"): boolean {
    const order: Record<string, number> = { low: 0, medium: 1, high: 2 };
    return (order[complexity] ?? 1) <= (order[this.complexityThreshold] ?? 0);
  }
}

// -- Pipeline Middleware Adapter ----------------------------------------

/**
 * Create a Middleware adapter that integrates PlanEnforcementMiddleware
 * into the pipeline. Runs at order 20 (early in the extended pipeline)
 * to gate tool calls before they execute.
 */
export function createPlanEnforcementMiddleware(instance: PlanEnforcementMiddleware): Middleware {
  return {
    name: "PlanEnforcement",
    order: 20,
    before(ctx: MiddlewareContext): MiddlewareContext {
      instance.advanceTurn();
      return ctx;
    },
    after(ctx: MiddlewareContext, result: AgentResult): AgentResult {
      // Check assistant content for inline plans
      if (result.content) {
        instance.checkAssistantContent(result.content);
      }

      // Record the tool call (may mark plan as created)
      if (result.toolName) {
        instance.recordToolCall(result.toolName);

        // Check if this tool call should be blocked
        const blockMessage = instance.checkToolCall(result.toolName, ctx.complexity);
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
