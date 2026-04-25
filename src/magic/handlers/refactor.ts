import type { MagicCommandHandler } from "../types.js";

export const handleRefactor: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Refactor the most recently shared code for clarity and maintainability. Preserve behavior; document each change."
        : `Refactor the following for clarity:\n\n${trimmed}`,
    systemAugment:
      "When refactoring: preserve observable behavior. Prefer immutable data, small functions, and meaningful names. Run tests after each change. Document each refactor in the commit message.",
  };
};
