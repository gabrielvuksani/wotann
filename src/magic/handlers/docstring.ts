import type { MagicCommandHandler } from "../types.js";

export const handleDocstring: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Add documentation comments to the most recently shared functions / classes. Cover params, return value, side effects, and one example call."
        : `Add documentation comments to:\n\n${trimmed}`,
    systemAugment:
      "When writing docstrings: use the project's idiom (TSDoc / JSDoc / docstrings). Cover params, return, side-effects, and surprising behavior. Include ONE concrete usage example. Keep prose tight — no marketing language.",
  };
};
