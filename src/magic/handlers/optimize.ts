import type { MagicCommandHandler } from "../types.js";

export const handleOptimize: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Optimize the most recently shared code for performance. Identify the hot path, propose specific changes, and explain the expected complexity / wall-clock improvement."
        : `Optimize the following for performance:\n\n${trimmed}`,
    systemAugment:
      "When optimizing: profile first (or describe how to profile). Improve algorithmic complexity before micro-optimizations. State BEFORE → AFTER complexity for each change. Preserve behavior; never trade correctness for speed.",
  };
};
