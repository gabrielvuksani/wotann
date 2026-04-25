import type { MagicCommandHandler } from "../types.js";

export const handleExplain: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Explain how the most recently shared code works. Cover the data flow, control flow, key invariants, and surprising-on-first-read pieces."
        : `Explain how the following code works:\n\n${trimmed}`,
    systemAugment:
      "When explaining code: lead with the WHY (what problem does this solve), then HOW (data + control flow). Call out invariants and gotchas. Skip explaining obvious mechanics — assume the reader knows the language.",
  };
};
