/**
 * PreCompact hook — V9 T3.3 Wave 2 + WAL Protocol.
 *
 * Fires *before* the Claude binary runs context compaction. WOTANN uses this
 * window to write critical session state to durable storage (Engram) before
 * the in-memory conversation is rewritten.
 *
 * This is the V9 WAL Protocol's "before destructive operation" save point.
 * The hook always returns `allow` — we never block compaction. WOTANN's job
 * is to make sure the next session can recover, not to prevent compaction.
 */

import type { HookHandler, PreCompactPayload, HookDecision, WaveDeps } from "../types.js";

export function createPreCompactHandler(): HookHandler<PreCompactPayload, HookDecision> {
  return async function preCompact(
    payload: PreCompactPayload,
    deps: WaveDeps,
  ): Promise<HookDecision> {
    if (deps.walSave) {
      try {
        // 5-second budget for the WAL write — compaction is otherwise blocked.
        await Promise.race([
          deps.walSave(payload.sessionId, payload.approxTokens),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch {
        // WAL save failures are advisory — we still allow compaction so the
        // session keeps running. The error surfaces in the bridge log.
      }
    }
    return { action: "allow" };
  };
}
