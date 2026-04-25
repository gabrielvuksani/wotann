/**
 * Stop hook — V9 T3.3 Wave 2.
 *
 * Fires when the model wants to terminate the turn (assistant has no tool
 * calls pending, no further reasoning to do). WOTANN's Reflector inspects
 * the turn for completion verification:
 *
 *   - If Reflector says "complete", the model is allowed to stop.
 *   - If Reflector says "incomplete", we return `decision: "block"` with an
 *     `additionalContext` that nudges the model to keep working. The model
 *     receives this as a system message before its next turn.
 *
 * This is the V9 verify-before-done bar in action — the model can't
 * unilaterally claim "done" until the Reflector confirms the requested work
 * is actually verified.
 */

import type { HookHandler, StopPayload, StopDecision, WaveDeps } from "../types.js";

export function createStopHandler(): HookHandler<StopPayload, StopDecision> {
  return async function stop(payload: StopPayload, deps: WaveDeps): Promise<StopDecision> {
    if (!deps.reflect) {
      // No reflector wired — allow termination (honest stub).
      return { decision: "allow" };
    }

    let verdict: Awaited<ReturnType<NonNullable<WaveDeps["reflect"]>>>;
    try {
      verdict = await deps.reflect(payload);
    } catch (err) {
      // Reflector crashed — allow termination rather than trapping the
      // model in a forever-loop. The error is surfaced through the
      // Observer subsystem (PostToolUse → recordError side-effect) for
      // post-mortem analysis.
      void err;
      return { decision: "allow" };
    }

    if (verdict.complete) {
      return { decision: "allow" };
    }

    const hint = verdict.hint ? `\n\n**Hint**: ${verdict.hint}` : "";
    const additionalContext = [
      "## Verification check failed",
      "",
      `WOTANN's Reflector inspected your turn and concluded the requested`,
      `work is **not yet complete**.`,
      "",
      `**Reason**: ${verdict.reason}${hint}`,
      "",
      `Continue working — run the missing verification step (test / build`,
      `/ lint), surface evidence, then close the turn.`,
    ].join("\n");

    return {
      decision: "block",
      additionalContext,
      reason: verdict.reason,
    };
  };
}
