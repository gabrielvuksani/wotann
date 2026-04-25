/**
 * Magic Commands registry — V9 Tier 12 T12.17.
 *
 * Maps the dot-prefixed shortcuts to handlers. Pure module — no
 * runtime state, no env reads.
 *
 * Two cohorts:
 *   1. Utility commands (fix, test, review, refactor, explain, docstring,
 *      format, optimize) — operate on a code blob the user shares.
 *   2. Dev-workflow commands (investigate-issue/pr/workflow, ai-commit,
 *      pr-content, merge-conflict, release-notes) — operate on the
 *      project's git/GH state to produce structured workflow output.
 */

import type { MagicCommand, MagicCommandHandler, MagicCommandId } from "./types.js";
import { handleFix } from "./handlers/fix.js";
import { handleTest } from "./handlers/test.js";
import { handleReview } from "./handlers/review.js";
import { handleRefactor } from "./handlers/refactor.js";
import { handleExplain } from "./handlers/explain.js";
import { handleDocstring } from "./handlers/docstring.js";
import { handleFormat } from "./handlers/format.js";
import { handleOptimize } from "./handlers/optimize.js";
import { handleInvestigateIssue } from "./handlers/investigate-issue.js";
import { handleInvestigatePr } from "./handlers/investigate-pr.js";
import { handleInvestigateWorkflow } from "./handlers/investigate-workflow.js";
import { handleAiCommit } from "./handlers/ai-commit.js";
import { handlePrContent } from "./handlers/pr-content.js";
import { handleMergeConflict } from "./handlers/merge-conflict.js";
import { handleReleaseNotes } from "./handlers/release-notes.js";

export const MAGIC_COMMANDS: readonly MagicCommand[] = [
  {
    id: "fix",
    trigger: ".fix",
    description: "Fix bugs in the supplied code or context",
    category: "fix",
  },
  {
    id: "test",
    trigger: ".test",
    description: "Generate tests for the supplied code",
    category: "review",
  },
  {
    id: "review",
    trigger: ".review",
    description: "Review the supplied code for quality + correctness",
    category: "review",
  },
  {
    id: "refactor",
    trigger: ".refactor",
    description: "Refactor the supplied code for clarity",
    category: "refactor",
  },
  {
    id: "explain",
    trigger: ".explain",
    description: "Explain how the supplied code works",
    category: "explain",
  },
  {
    id: "docstring",
    trigger: ".docstring",
    description: "Add documentation comments to the supplied code",
    category: "explain",
  },
  {
    id: "format",
    trigger: ".format",
    description: "Format the supplied code per project style",
    category: "format",
  },
  {
    id: "optimize",
    trigger: ".optimize",
    description: "Optimize the supplied code for performance",
    category: "refactor",
  },
  // V9 Tier 12 T12.17 — Jean dev-workflow commands.
  {
    id: "investigate-issue",
    trigger: ".investigate-issue",
    description: "Triage a GitHub issue: summary, impacted files, hypothesis, next steps",
    category: "investigate",
  },
  {
    id: "investigate-pr",
    trigger: ".investigate-pr",
    description: "Review a GitHub PR: diff, tests, comments, severity-tagged concerns",
    category: "investigate",
  },
  {
    id: "investigate-workflow",
    trigger: ".investigate-workflow",
    description: "Root-cause a GitHub Actions workflow failure from its logs",
    category: "investigate",
  },
  {
    id: "ai-commit",
    trigger: ".ai-commit",
    description: "Stage relevant files and write a Conventional Commit message",
    category: "git",
  },
  {
    id: "pr-content",
    trigger: ".pr-content",
    description: "Draft a PR title, summary, and test plan from the current branch diff",
    category: "git",
  },
  {
    id: "merge-conflict",
    trigger: ".merge-conflict",
    description: "Walk merge-conflict blocks in a file and propose justified resolutions",
    category: "git",
  },
  {
    id: "release-notes",
    trigger: ".release-notes",
    description: "Generate release notes from a commit range (defaults to latest tag..HEAD)",
    category: "release",
  },
];

const HANDLERS: Readonly<Record<MagicCommandId, MagicCommandHandler>> = {
  fix: handleFix,
  test: handleTest,
  review: handleReview,
  refactor: handleRefactor,
  explain: handleExplain,
  docstring: handleDocstring,
  format: handleFormat,
  optimize: handleOptimize,
  // V9 Tier 12 T12.17 — Jean dev-workflow handlers.
  "investigate-issue": handleInvestigateIssue,
  "investigate-pr": handleInvestigatePr,
  "investigate-workflow": handleInvestigateWorkflow,
  "ai-commit": handleAiCommit,
  "pr-content": handlePrContent,
  "merge-conflict": handleMergeConflict,
  "release-notes": handleReleaseNotes,
};

export function getHandler(id: MagicCommandId): MagicCommandHandler {
  return HANDLERS[id];
}
