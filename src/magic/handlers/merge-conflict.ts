/**
 * .merge-conflict — helps resolve merge conflicts by analyzing both
 * sides of each conflict block and suggesting a resolution.
 *
 * WHAT: a Jean-style dev-workflow magic command that takes a path with
 *       merge-conflict markers and produces a structured resolution.
 *
 * WHY:  merge conflicts are dangerous — a wrong resolution can revert
 *       a feature, drop a fix, or corrupt the repository. The shortcut
 *       forces the agent to walk through each conflict block
 *       deliberately, surface the semantic intent of both sides, and
 *       propose a resolution the user can review.
 *
 * WHERE: invoked via `.merge-conflict <file>`. The handler shapes a
 *        prompt that walks the agent through reading both sides and
 *        proposing a merged version.
 *
 * HOW:  pure prompt-shaper. The systemAugment instructs the agent to
 *       read the file with conflict markers in place, identify each
 *       `<<<<<<<` ... `=======` ... `>>>>>>>` block, analyze both sides
 *       (using `git log` to understand each side's history), and
 *       propose a resolution. Honest-stubs: if the file is not in a
 *       conflict state, the handler reports that and exits.
 */

import type { MagicCommandHandler } from "../types.js";

export const handleMergeConflict: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: true,
      prompt:
        "Ask the user for the file path with merge-conflict markers they want resolved. Example: .merge-conflict src/auth/login.ts. Once they reply, analyze both sides of each <<<<<<< / ======= / >>>>>>> block and propose a resolution.",
      systemAugment:
        "The .merge-conflict command requires a target file. Prompt the user for it and don't fabricate one. When provided, read the file, analyze the conflict markers, propose a resolution that preserves the intent of BOTH sides where they don't actually conflict.",
    };
  }
  return {
    ok: true,
    prompt: [
      `Resolve merge conflicts in the file: ${trimmed}`,
      "",
      "Workflow:",
      "  1. Read the file. Verify it actually contains `<<<<<<<` / `=======` / `>>>>>>>` markers.",
      "  2. If no markers are found, report that the file has no active conflicts and exit.",
      "  3. For each conflict block:",
      "       a. Identify the OURS side and the THEIRS side.",
      "       b. Run `git log --oneline -5 HEAD -- " +
        trimmed +
        "` and `git log --oneline -5 MERGE_HEAD -- " +
        trimmed +
        "` to learn the recent history of each side.",
      "       c. Describe what each side is trying to accomplish (semantic intent, not just diff).",
      "       d. Propose a resolution that preserves both intents. If the intents are mutually exclusive, surface the conflict to the user and stop.",
      "       e. Note any tests that should be added or run after the resolution.",
      "  4. Output a unified resolution proposal with the conflict markers removed.",
      "  5. DO NOT write the resolution to disk until the user approves.",
      "",
      "Quality bar: never silently choose one side. Every block needs a justified resolution.",
    ].join("\n"),
    systemAugment: [
      "When resolving merge conflicts:",
      "  - Read both branches' history before choosing — recent intent beats raw diff.",
      "  - If the conflict involves tests, run the tests both ways to learn what each side proves.",
      "  - Preserve immutability: if both sides add a field, include both. If both sides remove a field, ask the user.",
      "  - For binary conflicts, refuse to auto-resolve; surface to the user.",
      "  - After applying the resolution, re-run the project's typecheck + tests before claiming done.",
      "  - Save the resolution rationale to memory with `topic_key=merges/<file-or-branch>`.",
    ].join("\n"),
  };
};
