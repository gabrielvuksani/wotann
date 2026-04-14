/**
 * Cost prompt module — session cost, budget awareness, and cost-efficient behavior.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const costPromptModule: PromptModuleEntry = {
  name: "cost",
  priority: 80,
  build(ctx: PromptContext): readonly string[] {
    const lines: string[] = [`Session cost: $${ctx.sessionCost.toFixed(4)}`];

    if (ctx.budgetRemaining > 0) {
      lines.push(`Budget remaining: $${ctx.budgetRemaining.toFixed(2)}`);
      const pctUsed = ((1 - ctx.budgetRemaining / (ctx.sessionCost + ctx.budgetRemaining)) * 100);
      if (pctUsed > 80) {
        lines.push("WARNING: Over 80% of budget consumed. Be concise. Avoid unnecessary tool calls.");
      } else if (pctUsed > 60) {
        lines.push("Note: Over 60% of budget consumed. Optimize for efficiency.");
      }
    }

    // Cost-aware behavior hint
    lines.push("Show cost predictions before expensive operations. Prefer cheaper models for simple tasks.");

    return lines;
  },
};
