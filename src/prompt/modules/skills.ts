/**
 * Skills prompt module — available skills (names only, loaded JIT when invoked).
 * Progressive disclosure: zero token cost for unused skills. Full content loaded on demand.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const skillsPromptModule: PromptModuleEntry = {
  name: "skills",
  priority: 65,
  build(ctx: PromptContext): readonly string[] {
    if (!ctx.skillNames || ctx.skillNames.length === 0) return [];

    const count = ctx.skillNames.length;
    const names = ctx.skillNames.slice(0, 25).join(", ");
    const truncated = count > 25 ? ` (+${count - 25} more)` : "";

    return [
      `Available skills (${count}): ${names}${truncated}.`,
      "Skills are loaded just-in-time when invoked — zero cost until used.",
      "Invoke via /skill-name or auto-detected from context.",
      "Skills cover: security, testing, debugging, deployment, code review, research, and more.",
    ];
  },
};
