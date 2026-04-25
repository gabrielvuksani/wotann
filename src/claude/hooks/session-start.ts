/**
 * SessionStart hook — V9 T3.3 Wave 2.
 *
 * Fires when a Claude session begins. WOTANN uses this to:
 *   1. Inject persona / role context if a customSystemPrompt is configured.
 *   2. Replay any WAL state from a prior crashed session (per WAL Protocol
 *      `~/.claude/rules/wal-protocol.md`).
 *   3. Record the session id for downstream telemetry correlation.
 *
 * Returns `inject` with the recovered context if WAL recovery hits anything,
 * else `allow`. The Claude SDK threads `additionalContext` into the model's
 * first system turn.
 */

import type { HookHandler, SessionStartPayload, HookDecision, WaveDeps } from "../types.js";

/**
 * Build the SessionStart handler. Closes over deps so the HTTP server can
 * register it with `(payload) => handler(payload, deps)`.
 */
export function createSessionStartHandler(): HookHandler<SessionStartPayload, HookDecision> {
  return async function sessionStart(payload, deps: WaveDeps): Promise<HookDecision> {
    const recovered: string[] = [];

    // 1) WAL replay — only on a resumed session. Fresh sessions skip this.
    if (payload.resumed && deps.memoryRecall) {
      try {
        const wal = await deps.memoryRecall(`__wal__:${payload.sessionId}`, payload.sessionId);
        if (wal.hits > 0 && wal.contextBlock.trim().length > 0) {
          recovered.push(`## Recovered session state (WAL replay)\n\n${wal.contextBlock.trim()}`);
        }
      } catch {
        // Swallow — WAL read failure is recoverable; session continues.
      }
    }

    // 2) Boot-time memory recall — pull recent session summaries so the
    //    model knows where it left off across the long-context window.
    if (deps.memoryRecall) {
      try {
        const recent = await deps.memoryRecall("session_summary", payload.sessionId);
        if (recent.hits > 0) {
          recovered.push(
            `## Recent session memory (top ${recent.hits})\n\n${recent.contextBlock.trim()}`,
          );
        }
      } catch {
        // Swallow — boot recall is advisory.
      }
    }

    if (recovered.length === 0) {
      return { action: "allow" };
    }

    return {
      action: "inject",
      additionalContext: recovered.join("\n\n---\n\n"),
    };
  };
}
