import type { MagicCommandHandler } from "../types.js";

export const handleReview: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Review the most recently shared code with severity-tiered findings (CRITICAL / HIGH / MEDIUM / LOW). Cite line numbers. Skip nits unless asked."
        : `Review the following code with severity-tiered findings:\n\n${trimmed}`,
    systemAugment:
      "When reviewing: focus on correctness, security, error handling, immutability, and test coverage. Categorize findings as CRITICAL / HIGH / MEDIUM / LOW. Cite specific lines and explain WHY each finding matters.",
  };
};
