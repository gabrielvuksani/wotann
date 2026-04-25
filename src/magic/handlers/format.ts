import type { MagicCommandHandler } from "../types.js";

export const handleFormat: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Format the most recently shared code per the project's style (prettier / eslint / black / gofmt). Output the formatted source only."
        : `Format the following per project style:\n\n${trimmed}`,
    systemAugment:
      "When formatting: respect the project's existing formatter config. Don't introduce stylistic changes outside what the formatter would do. If unsure of the formatter, ask before making semantic changes.",
  };
};
