/**
 * .investigate-pr — reviews a pull request's diff, tests, and reviewer
 * comments; surfaces concerns; and suggests follow-up changes.
 *
 * WHAT: a Jean-style dev-workflow magic command that produces a
 *       structured PR-review brief from a PR URL or `<owner>/<repo>#<number>`.
 *
 * WHY:  reviewing a PR manually requires reading the diff, checking the
 *       tests, parsing reviewer comments, and synthesizing the state of
 *       the discussion. The shortcut compresses that into a single
 *       prompt-shape so the agent always covers the same checklist.
 *
 * WHERE: invoked via `.investigate-pr <url-or-id>`. The CLI resolves
 *        through magic-commands -> getHandler -> this function.
 *
 * HOW:  pure prompt-shaper. The systemAugment instructs the agent to
 *       use `gh pr view --json ...` and `gh pr diff` if available;
 *       otherwise fall back to fetching the patch via the public API.
 *       The output structure is canonical (matches the code-review
 *       skill's verdict format).
 */

import type { MagicCommandHandler } from "../types.js";

export const handleInvestigatePr: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: true,
      prompt:
        "Ask the user for the PR URL or `<owner>/<repo>#<number>` they want investigated. Example: .investigate-pr facebook/react#28000. Once they reply, run the investigate-pr flow.",
      systemAugment:
        "The .investigate-pr command requires a target PR. Prompt the user for it and don't fabricate one. When provided, use `gh pr view <number>` to fetch diff and reviews.",
    };
  }
  return {
    ok: true,
    prompt: [
      `Investigate the following pull request: ${trimmed}`,
      "",
      "Produce a structured review with these sections:",
      "  1. PR summary (title + 2-3 sentence restatement of the change)",
      "  2. Diff overview (files changed, +/- LOC, scope of the change)",
      "  3. Tests (new tests, modified tests, missing test coverage)",
      "  4. Reviewer comment digest (1 line per outstanding concern)",
      "  5. Concerns (correctness, security, design, performance) with severity tags",
      "  6. Suggested changes (concrete patches, ranked by importance)",
      "  7. Verdict: APPROVE | APPROVE_WITH_NITS | REQUEST_CHANGES | REJECT",
      "",
      "If the PR is too large to review in one pass, identify the riskiest files and review those first.",
    ].join("\n"),
    systemAugment: [
      "When investigating a PR:",
      "  - Use `gh pr view <number> --json title,body,reviewDecision,comments,files` to fetch metadata.",
      "  - Use `gh pr diff <number>` to fetch the diff. If `gh` is unavailable, say so and fall back to a WebFetch of the .diff URL.",
      "  - Apply the `code-review` skill's 6-pass methodology where time permits.",
      "  - Cite specific files and line numbers for every concern.",
      "  - Tag concerns with severity: CRITICAL, HIGH, MEDIUM, LOW.",
      "  - Save the review to memory with `topic_key=reviews/<branch-or-number>`.",
    ].join("\n"),
  };
};
