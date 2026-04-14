/**
 * Tool Error Handler Middleware.
 *
 * Wraps all tool calls in try/catch. On error, returns a structured
 * AgentResult so the agent sees the failure and self-corrects instead
 * of crashing the entire pipeline.
 *
 * From open-swe/deer-flow pattern: tool execution errors are converted
 * to error messages rather than propagated as exceptions.
 *
 * Runs in the `after` phase at order 6 (between LSP at 5 and Summarization at 7).
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// -- Types ----------------------------------------------------------------

export interface ToolError {
  readonly message: string;
  readonly stack?: string;
  readonly recoverable: boolean;
}

export interface ToolErrorStats {
  readonly totalErrors: number;
  readonly recoverableErrors: number;
  readonly nonRecoverableErrors: number;
  readonly errorsByTool: ReadonlyMap<string, number>;
}

// -- Middleware Class ------------------------------------------------------

/**
 * ToolErrorHandlerMiddleware catches exceptions from tool execution and
 * converts them to structured error results. This prevents a single
 * failing tool from crashing the agent loop — instead, the model
 * receives an error message and can attempt a different approach.
 */
export class ToolErrorHandlerMiddleware {
  private totalErrors = 0;
  private recoverableErrors = 0;
  private nonRecoverableErrors = 0;
  private readonly errorsByTool: Map<string, number> = new Map();

  /**
   * Non-recoverable error patterns — these indicate systemic failures
   * that retrying won't fix (out of memory, permission denied, etc.).
   */
  private static readonly NON_RECOVERABLE_PATTERNS: readonly RegExp[] = [
    /out of memory/i,
    /ENOMEM/,
    /permission denied/i,
    /EACCES/,
    /EPERM/,
    /disk quota exceeded/i,
    /ENOSPC/,
  ];

  /**
   * Determine if an error is recoverable (the model should retry with
   * a different approach) or non-recoverable (something is fundamentally broken).
   */
  isRecoverable(errorMessage: string): boolean {
    return !ToolErrorHandlerMiddleware.NON_RECOVERABLE_PATTERNS.some((p) =>
      p.test(errorMessage),
    );
  }

  /**
   * Build a structured ToolError from an unknown caught value.
   */
  buildToolError(error: unknown): ToolError {
    const message =
      error instanceof Error ? error.message : String(error);
    const stack =
      error instanceof Error
        ? error.stack?.split("\n").slice(0, 3).join("\n")
        : undefined;
    const recoverable = this.isRecoverable(message);

    return { message, stack, recoverable };
  }

  /**
   * Build an AgentResult representing a tool failure.
   * The content field contains a human-readable error description
   * that the model can use to self-correct.
   */
  buildErrorResult(
    toolError: ToolError,
    toolName?: string,
  ): AgentResult {
    const prefix = toolName
      ? `Tool "${toolName}" execution failed`
      : "Tool execution failed";

    const recoverHint = toolError.recoverable
      ? "This error may be recoverable — try a different approach."
      : "This error is non-recoverable — do not retry the same operation.";

    const content = [
      `${prefix}: ${toolError.message}`,
      toolError.stack ? `\nStack (truncated):\n${toolError.stack}` : "",
      `\n${recoverHint}`,
    ]
      .filter(Boolean)
      .join("");

    return {
      content,
      success: false,
      toolName,
      followUp: toolError.recoverable
        ? "Consider an alternative approach or different tool."
        : undefined,
    };
  }

  /**
   * Record an error for statistics tracking.
   */
  recordError(toolName: string | undefined, recoverable: boolean): void {
    this.totalErrors++;
    if (recoverable) {
      this.recoverableErrors++;
    } else {
      this.nonRecoverableErrors++;
    }

    if (toolName) {
      const current = this.errorsByTool.get(toolName) ?? 0;
      this.errorsByTool.set(toolName, current + 1);
    }
  }

  /**
   * Get error statistics for diagnostics.
   */
  getStats(): ToolErrorStats {
    return {
      totalErrors: this.totalErrors,
      recoverableErrors: this.recoverableErrors,
      nonRecoverableErrors: this.nonRecoverableErrors,
      errorsByTool: new Map(this.errorsByTool),
    };
  }

  /**
   * Reset statistics for a new session.
   */
  reset(): void {
    this.totalErrors = 0;
    this.recoverableErrors = 0;
    this.nonRecoverableErrors = 0;
    this.errorsByTool.clear();
  }
}

// -- Pipeline Middleware Adapter -------------------------------------------

/**
 * Create a Middleware adapter for the tool error handler.
 * Runs at order 6 (between LSP and Summarization).
 * Operates in the `after` phase to catch tool execution errors
 * and convert them to structured error results.
 */
export function createToolErrorHandlerMiddleware(
  instance: ToolErrorHandlerMiddleware,
): Middleware {
  return {
    name: "ToolErrorHandler",
    order: 6,
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      // In the normal flow, errors won't reach here as exceptions — they'll
      // be caught earlier. This middleware catches logical errors in tool results
      // (e.g., a tool that returns success: false with no useful content).
      if (result.success === false && !result.content) {
        const toolError = instance.buildToolError(
          new Error("Tool returned failure with no error details"),
        );
        instance.recordError(result.toolName, toolError.recoverable);
        return instance.buildErrorResult(toolError, result.toolName);
      }

      return result;
    },
  };
}

/**
 * Wrap an async operation with tool error handling.
 * Use this to wrap individual tool invocations so exceptions
 * are caught and converted to structured AgentResult errors.
 *
 * Example:
 *   const result = await withToolErrorHandling(handler, () => executeTool(args), "bash");
 */
export async function withToolErrorHandling(
  handler: ToolErrorHandlerMiddleware,
  operation: () => Promise<AgentResult>,
  toolName?: string,
): Promise<AgentResult> {
  try {
    return await operation();
  } catch (error: unknown) {
    const toolError = handler.buildToolError(error);
    handler.recordError(toolName, toolError.recoverable);
    return handler.buildErrorResult(toolError, toolName);
  }
}
