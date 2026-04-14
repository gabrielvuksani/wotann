/**
 * Project prompt module -- working dir, git branch, recent changes.
 * Enhanced with domain-specific skill routing (Phase 13C).
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";
import { classifyTaskDomain, getDomainContext } from "../../intelligence/domain-skill-router.js";

export const projectPromptModule: PromptModuleEntry = {
  name: "project",
  priority: 90,
  build(ctx: PromptContext): readonly string[] {
    const lines: string[] = [`Working directory: ${ctx.workingDir}`];
    if (ctx.gitBranch) {
      lines.push(`Git branch: ${ctx.gitBranch}`);
    }
    if (ctx.recentFiles && ctx.recentFiles.length > 0) {
      lines.push(`Recent files: ${ctx.recentFiles.slice(0, 5).join(", ")}`);
    }

    // Domain-specific skill routing (Phase 13C — +3-5% accuracy)
    // Classify the task domain from recent files and inject domain context
    if (!ctx.isMinimal && ctx.recentFiles && ctx.recentFiles.length > 0) {
      const domain = classifyTaskDomain("", ctx.recentFiles);
      const domainCtx = getDomainContext(domain);
      if (domainCtx) {
        lines.push(domainCtx);
      }
    }

    return lines;
  },
};
