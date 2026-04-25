/**
 * UserPromptSubmit hook — V9 T3.3 Wave 2.
 *
 * Fires when the user types a message and presses Enter. WOTANN uses this to:
 *   1. Run the MemoryInjector — pull TEMPR-ranked memory hits and prepend
 *      them as `additionalContext`.
 *   2. Run the SkillDispatcher — match keywords / intent and load any
 *      relevant skill bodies into the same context block.
 *
 * Returns `inject` with the combined context. If both subsystems return
 * empty, returns `allow` so Claude proceeds with the raw prompt.
 *
 * Two-phase rationale: MemoryInjector and SkillDispatcher are dispatched
 * concurrently because they read disjoint subsystems (FTS5 vs skill
 * registry) and have no inter-dependency. Combined latency budget is
 * ≤200ms p50; either one alone is ~80ms.
 */

import type { HookHandler, UserPromptSubmitPayload, HookDecision, WaveDeps } from "../types.js";

export function createUserPromptSubmitHandler(): HookHandler<
  UserPromptSubmitPayload,
  HookDecision
> {
  return async function userPromptSubmit(
    payload: UserPromptSubmitPayload,
    deps: WaveDeps,
  ): Promise<HookDecision> {
    const memoryP = deps.memoryRecall
      ? safeRecall(() => deps.memoryRecall!(payload.prompt, payload.sessionId))
      : Promise.resolve(null);

    const skillsP = deps.skillDispatch
      ? safeDispatch(() => deps.skillDispatch!(payload.prompt))
      : Promise.resolve(null);

    const [mem, skills] = await Promise.all([memoryP, skillsP]);

    const blocks: string[] = [];
    if (mem && mem.hits > 0 && mem.contextBlock.trim()) {
      blocks.push(`## Relevant memory (top ${mem.hits})\n\n${mem.contextBlock.trim()}`);
    }
    if (skills && skills.skillIds.length > 0 && skills.contextBlock.trim()) {
      blocks.push(
        `## Auto-loaded skills (${skills.skillIds.join(", ")})\n\n${skills.contextBlock.trim()}`,
      );
    }

    if (blocks.length === 0) {
      return { action: "allow" };
    }

    return {
      action: "inject",
      additionalContext: blocks.join("\n\n---\n\n"),
    };
  };
}

async function safeRecall(
  fn: () => Promise<{ readonly contextBlock: string; readonly hits: number }>,
): Promise<{ readonly contextBlock: string; readonly hits: number } | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function safeDispatch(
  fn: () => Promise<{ readonly skillIds: readonly string[]; readonly contextBlock: string }>,
): Promise<{ readonly skillIds: readonly string[]; readonly contextBlock: string } | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
