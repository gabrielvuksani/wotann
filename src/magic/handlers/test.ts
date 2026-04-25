import type { MagicCommandHandler } from "../types.js";

export const handleTest: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  return {
    ok: true,
    prompt:
      trimmed.length === 0
        ? "Generate a comprehensive test suite for the most recently shared code. Cover the happy path plus 3-5 edge cases."
        : `Generate tests for the following:\n\n${trimmed}`,
    systemAugment:
      "When generating tests: prefer the project's existing test framework (vitest / jest / pytest / go test) and naming conventions. Cover happy path, error paths, boundary cases, and (when applicable) async timing.",
  };
};
