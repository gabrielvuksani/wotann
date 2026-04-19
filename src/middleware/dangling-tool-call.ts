/**
 * DanglingToolCallMiddleware — repair AI messages whose tool_use entries
 * lack a matching tool_result.
 *
 * Ported from deer-flow (bytedance/deer-flow) Lane 2:
 *   packages/harness/deerflow/agents/middlewares/dangling_tool_call_middleware.py
 *
 * Failure mode handled:
 *   - User interrupts the agent mid-tool-call; the assistant message
 *     contains a tool_use with no following tool_result.
 *   - A provider drops a tool result silently; the next turn would fail
 *     strict-pair validation at the provider boundary.
 *
 * Distinction from `tool-pair-validator.ts`:
 *   - ToolPairValidator scans *everywhere* and repairs ANY orphan.
 *   - DanglingToolCall is scoped to the "last assistant turn" — the
 *     common interrupt case — and inserts the placeholder *immediately
 *     after* the offending assistant message so message ordering is
 *     preserved (not appended to the tail).
 *
 * These two layers are complementary: WOTANN keeps the broad validator
 * at order 0 and adds dangling-tool-call scoped to the most recent turn
 * at order 4.5 (right after the sandbox layer, mirroring deer-flow's
 * chain position).
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import type { AgentMessage } from "../core/types.js";

// -- Types ----------------------------------------------------------------

export interface DanglingPatch {
  readonly toolCallId: string;
  readonly toolName: string;
  /** Index in the original history AFTER which the patch was inserted. */
  readonly afterIndex: number;
}

export interface DanglingStats {
  readonly totalScans: number;
  readonly totalPatches: number;
}

// -- Middleware Class ------------------------------------------------------

/**
 * DanglingToolCallMiddleware inserts placeholder tool messages immediately
 * after assistant messages whose tool_use calls lack a matching tool_result.
 * Preserves ordering — placeholders are inserted in-place, not appended.
 */
export class DanglingToolCallMiddleware {
  private totalScans = 0;
  private totalPatches = 0;

  /**
   * Scan history and return a new history with placeholders inserted
   * directly after each dangling assistant message. Returns the original
   * reference when no patching is needed.
   */
  patch(history: readonly AgentMessage[]): {
    readonly history: readonly AgentMessage[];
    readonly patches: readonly DanglingPatch[];
  } {
    this.totalScans++;

    // Collect tool result IDs
    const existingToolResults = new Set<string>();
    for (const msg of history) {
      if (msg.role === "tool" && msg.toolCallId) {
        existingToolResults.add(msg.toolCallId);
      }
    }

    // Check if any patching is needed
    let needsPatch = false;
    for (const msg of history) {
      if (
        msg.role === "assistant" &&
        msg.toolCallId &&
        msg.toolName &&
        !existingToolResults.has(msg.toolCallId)
      ) {
        needsPatch = true;
        break;
      }
    }

    if (!needsPatch) {
      return { history, patches: [] };
    }

    // Build new list with patches inserted after each dangling assistant msg
    const patched: AgentMessage[] = [];
    const patches: DanglingPatch[] = [];
    const alreadyPatched = new Set<string>();

    for (let i = 0; i < history.length; i++) {
      const msg = history[i]!;
      patched.push(msg);

      if (
        msg.role === "assistant" &&
        msg.toolCallId &&
        msg.toolName &&
        !existingToolResults.has(msg.toolCallId) &&
        !alreadyPatched.has(msg.toolCallId)
      ) {
        const placeholder: AgentMessage = {
          role: "tool",
          content: "[Tool call was interrupted and did not return a result.]",
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
        };
        patched.push(placeholder);
        patches.push({
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          afterIndex: i,
        });
        alreadyPatched.add(msg.toolCallId);
        this.totalPatches++;
      }
    }

    return { history: patched, patches };
  }

  getStats(): DanglingStats {
    return {
      totalScans: this.totalScans,
      totalPatches: this.totalPatches,
    };
  }

  reset(): void {
    this.totalScans = 0;
    this.totalPatches = 0;
  }
}

// -- Pipeline adapter -----------------------------------------------------

export function createDanglingToolCallMiddleware(instance: DanglingToolCallMiddleware): Middleware {
  return {
    name: "DanglingToolCall",
    order: 4.5,
    before(ctx: MiddlewareContext): MiddlewareContext {
      const { history, patches } = instance.patch(ctx.recentHistory);
      if (patches.length === 0) return ctx;

      const traceNote = `[DanglingToolCall] Patched ${patches.length} interrupted tool call(s): ${patches
        .map((p) => `${p.toolName}(${p.toolCallId})`)
        .join(", ")}`;

      return {
        ...ctx,
        recentHistory: history,
        cachedResponse: ctx.cachedResponse ? `${ctx.cachedResponse}\n${traceNote}` : traceNote,
      };
    },
  };
}
