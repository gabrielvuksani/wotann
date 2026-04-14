/**
 * History prompt module -- compact summary of what happened so far this session.
 * Keeps the model oriented without replaying entire conversation history.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const historyPromptModule: PromptModuleEntry = {
  name: "history",
  priority: 45,
  build(ctx: PromptContext): readonly string[] {
    const parts: string[] = [];

    if (ctx.sessionSummary) {
      parts.push("## Session So Far");
      parts.push(ctx.sessionSummary);
    }

    if (ctx.instinctHints && ctx.instinctHints.length > 0) {
      parts.push("Learned patterns active this session:");
      for (const hint of ctx.instinctHints.slice(0, 5)) {
        parts.push(`- ${hint}`);
      }
    }

    if (ctx.learningHints && ctx.learningHints.length > 0) {
      parts.push("Cross-session learnings:");
      for (const hint of ctx.learningHints.slice(0, 3)) {
        parts.push(`- ${hint}`);
      }
    }

    return parts;
  },
};
