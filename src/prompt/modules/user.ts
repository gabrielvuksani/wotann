/**
 * User prompt module — renders user preferences from UserModel.
 *
 * The runtime calls `UserModelManager.getPromptContext()` and passes the
 * assembled string to the prompt pipeline via `ctx.userContext`. This
 * module just wraps that string in a labelled section; the token budget
 * is enforced upstream in `UserModelManager.assembleUserContext()`.
 *
 * S4-10: Previously exported a `DEFAULT_USER_TOKEN_BUDGET = 200` constant
 * that no caller used. Removed along with the stray `getDefaultUserTokenBudget`
 * getter. If a caller ever needs a default budget, it now lives alongside
 * the actual assembler in src/identity/user-model.ts.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const userPromptModule: PromptModuleEntry = {
  name: "user",
  priority: 75,
  build(ctx: PromptContext): readonly string[] {
    if (!ctx.userContext) return [];
    return ["## User Profile", ctx.userContext];
  },
};
