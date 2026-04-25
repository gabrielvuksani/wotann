import type { MagicCommandHandler } from "../types.js";

export const handleFix: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Identify and fix any bugs in the most recently shared code or test failure. Explain the root cause and propose minimal-diff fixes."
        : `Fix bugs in the following:\n\n${trimmed}`,
    systemAugment:
      "When fixing bugs: identify the root cause first, propose the minimal diff, and run the test suite (or describe how to run it) to verify the fix.",
  };
};
