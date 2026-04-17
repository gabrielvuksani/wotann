/**
 * Tool Use/Result Pair Validator Middleware.
 *
 * Prevents malformed API calls where tool_use blocks don't have matching
 * tool_result blocks (or vice versa). This is a defensive pattern from
 * oh-my-openagent that catches silent API errors before they reach the provider.
 *
 * Runs in the `before` phase at order 0 (first middleware — runs before
 * everything else) to validate conversation history integrity.
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import type { AgentMessage } from "../core/types.js";

// -- Types ----------------------------------------------------------------

export interface PairValidationResult {
  readonly valid: boolean;
  readonly orphanedToolUses: readonly OrphanedToolUse[];
  readonly repairsApplied: number;
}

export interface OrphanedToolUse {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly index: number;
}

export interface PairValidatorStats {
  readonly totalValidations: number;
  readonly totalRepairs: number;
  readonly totalOrphansFound: number;
}

// -- Middleware Class ------------------------------------------------------

/**
 * ToolPairValidatorMiddleware scans conversation history for unmatched
 * tool_use/tool_result pairs and injects synthetic results when needed.
 */
export class ToolPairValidatorMiddleware {
  private totalValidations = 0;
  private totalRepairs = 0;
  private totalOrphansFound = 0;

  /**
   * Validate that all tool_use messages in the history have matching
   * tool_result responses. Returns orphaned tool_use entries.
   */
  validate(history: readonly AgentMessage[]): PairValidationResult {
    this.totalValidations++;

    const toolUseIds = new Map<string, { toolName: string; index: number }>();
    const toolResultIds = new Set<string>();

    for (let i = 0; i < history.length; i++) {
      const msg = history[i]!;

      if (msg.role === "assistant" && msg.toolCallId && msg.toolName) {
        toolUseIds.set(msg.toolCallId, { toolName: msg.toolName, index: i });
      }

      if (msg.role === "tool" && msg.toolCallId) {
        toolResultIds.add(msg.toolCallId);
      }
    }

    const orphaned: OrphanedToolUse[] = [];

    for (const [callId, entry] of toolUseIds) {
      if (!toolResultIds.has(callId)) {
        orphaned.push({
          toolCallId: callId,
          toolName: entry.toolName,
          index: entry.index,
        });
      }
    }

    if (orphaned.length > 0) {
      this.totalOrphansFound += orphaned.length;
    }

    return {
      valid: orphaned.length === 0,
      orphanedToolUses: orphaned,
      repairsApplied: 0,
    };
  }

  /**
   * Build synthetic tool_result messages to repair orphaned tool_use blocks.
   * Returns new AgentMessage entries that should be appended to the history.
   */
  buildRepairMessages(orphans: readonly OrphanedToolUse[]): readonly AgentMessage[] {
    const repairs: AgentMessage[] = [];

    for (const orphan of orphans) {
      this.totalRepairs++;
      repairs.push({
        role: "tool",
        content: `[ToolPairValidator] Synthetic result: tool_use for "${orphan.toolName}" (id: ${orphan.toolCallId}) had no matching tool_result. This may indicate a dropped response or timeout.`,
        toolCallId: orphan.toolCallId,
        toolName: orphan.toolName,
      });
    }

    return repairs;
  }

  /**
   * Get validation statistics for diagnostics.
   */
  getStats(): PairValidatorStats {
    return {
      totalValidations: this.totalValidations,
      totalRepairs: this.totalRepairs,
      totalOrphansFound: this.totalOrphansFound,
    };
  }

  /**
   * Reset statistics for a new session.
   */
  reset(): void {
    this.totalValidations = 0;
    this.totalRepairs = 0;
    this.totalOrphansFound = 0;
  }
}

// -- Pipeline Middleware Adapter -------------------------------------------

/**
 * Create a Middleware adapter for the tool pair validator.
 * Runs at order 0 (first middleware — validates before anything else runs).
 * Operates in the `before` phase to validate conversation history integrity.
 */
export function createToolPairValidatorMiddleware(
  instance: ToolPairValidatorMiddleware,
): Middleware {
  return {
    name: "ToolPairValidator",
    order: 0,
    before(ctx: MiddlewareContext): MiddlewareContext {
      const result = instance.validate(ctx.recentHistory);

      if (result.valid) return ctx;

      // Inject synthetic tool_result messages for orphaned tool_use blocks
      const repairs = instance.buildRepairMessages(result.orphanedToolUses);

      const toolNames = result.orphanedToolUses
        .map((o) => `${o.toolName}(${o.toolCallId})`)
        .join(", ");

      const traceNote = `[ToolPairValidator] Repaired ${repairs.length} orphaned tool_use(s): ${toolNames}`;

      const repairedHistory: readonly AgentMessage[] = [
        ...ctx.recentHistory,
        ...repairs,
      ];

      return {
        ...ctx,
        recentHistory: repairedHistory,
        // Surface the repair in the user-visible context
        cachedResponse: ctx.cachedResponse
          ? `${ctx.cachedResponse}\n${traceNote}`
          : traceNote,
      };
    },
  };
}
