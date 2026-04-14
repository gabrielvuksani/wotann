/**
 * User prompt module -- user preferences from UserModel.
 *
 * Delegates to UserModel.assembleUserContext(budget) for
 * token-budgeted context assembly when available.
 * Falls back to raw userContext string for backward compat.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

/**
 * Default token budget for user context (when no explicit budget is provided).
 * Roughly 200 tokens -- enough for PeerCard + top corrections + prefs.
 */
const DEFAULT_USER_TOKEN_BUDGET = 200;

export const userPromptModule: PromptModuleEntry = {
  name: "user",
  priority: 75,
  build(ctx: PromptContext): readonly string[] {
    if (!ctx.userContext) return [];

    return [
      "## User Profile",
      ctx.userContext,
    ];
  },
};

/**
 * Get the default user token budget.
 * Exported for use by runtime when calling userModel.assembleUserContext().
 */
export function getDefaultUserTokenBudget(): number {
  return DEFAULT_USER_TOKEN_BUDGET;
}
