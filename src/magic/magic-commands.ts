/**
 * Magic Commands registry — V9 Tier 12 T12.17.
 *
 * Maps the 8 dot-prefixed shortcuts to handlers. Pure module — no
 * runtime state, no env reads.
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
};

export function getHandler(id: MagicCommandId): MagicCommandHandler {
  return HANDLERS[id];
}
