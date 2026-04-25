/**
 * .pr-content — writes a PR title + summary + test plan from the diff.
 *
 * WHAT: a Jean-style dev-workflow magic command that produces the
 *       narrative content for a pull request: a concise title, a
 *       motivated summary, and a test-plan checklist.
 *
 * WHY:  the body of a PR is where reviewers form their first impression.
 *       Letting the agent draft a high-quality body lifts the floor on
 *       PR quality across the project.
 *
 * WHERE: invoked via `.pr-content` (defaults base to `main`) or
 *        `.pr-content base=<branch>` to compute the diff against a
 *        non-default base branch.
 *
 * HOW:  pure prompt-shaper. The systemAugment instructs the agent to
 *       compute the diff via `git diff <base>...HEAD`, the commit log
 *       via `git log <base>..HEAD`, and to produce structured content
 *       in the canonical format the project uses (summary + test plan).
 */

import type { MagicCommandHandler } from "../types.js";

const DEFAULT_BASE = "main";

function parseBaseFromInput(raw: string): string {
  // Accepts "base=<branch>" or just "<branch>" or "" (for default).
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_BASE;
  const eq = trimmed.match(/^base\s*=\s*(\S+)/);
  if (eq && eq[1]) return eq[1];
  return trimmed.split(/\s+/)[0] ?? DEFAULT_BASE;
}

export const handlePrContent: MagicCommandHandler = (input) => {
  const base = parseBaseFromInput(input);
  return {
    ok: true,
    prompt: [
      `Generate pull-request content for the current branch against base \`${base}\`.`,
      "",
      "Workflow:",
      `  1. Run \`git diff ${base}...HEAD\` to read the full diff.`,
      `  2. Run \`git log ${base}..HEAD --oneline\` to read the commit history.`,
      "  3. Synthesize a PR title under 72 characters (Conventional Commit style).",
      "  4. Compose a PR body using this canonical structure:",
      "",
      "       ## Summary",
      "       <2-4 bullet points describing what changed and WHY it changed>",
      "",
      "       ## Test plan",
      "       - [ ] <concrete verification step>",
      "       - [ ] <another step>",
      "",
      "  5. Output the title and body. DO NOT run `gh pr create` until the user approves.",
      "",
      "If the diff is too large to summarize in 4 bullets, group changes by theme and suggest splitting into multiple PRs.",
    ].join("\n"),
    systemAugment: [
      "When writing PR content:",
      "  - The summary captures WHY each change was made, not just what.",
      "  - The test plan must be actionable — each item should be verifiable in 1-2 minutes.",
      "  - Mention any breaking changes prominently; never hide them in the body.",
      "  - If the diff suggests follow-up work (TODOs, missing tests), note it explicitly.",
      "  - Use `gh pr create --draft --title <t> --body <b>` only after the user approves the content.",
      "  - Save the proposed content to memory with `topic_key=prs/<branch-name>` so the user can edit and re-use.",
    ].join("\n"),
  };
};
