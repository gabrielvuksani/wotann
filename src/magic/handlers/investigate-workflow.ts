/**
 * .investigate-workflow — pulls GitHub Actions failure logs, identifies
 * the root cause, and suggests a fix.
 *
 * WHAT: a Jean-style dev-workflow magic command that turns a workflow
 *       run id (or URL) into a root-cause analysis with concrete next
 *       steps.
 *
 * WHY:  CI failures are noisy. Most of the time the actual error is
 *       buried in 200K lines of log output. The shortcut focuses the
 *       agent on the failing step + the failing assertion + the recent
 *       commit that introduced the regression.
 *
 * WHERE: invoked via `.investigate-workflow <run-id-or-url>`. Resolved
 *        through magic-commands -> getHandler -> this function.
 *
 * HOW:  pure prompt-shaper. The systemAugment instructs the agent to
 *       use `gh run view <id> --log` for log access; honest-stubs to
 *       a "gh CLI not available" note if `gh` cannot be invoked.
 */

import type { MagicCommandHandler } from "../types.js";

export const handleInvestigateWorkflow: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: true,
      prompt:
        "Ask the user for the workflow run ID or URL they want investigated. Example: .investigate-workflow 123456789. Once they reply, pull the failure logs and root-cause it.",
      systemAugment:
        "The .investigate-workflow command requires a target run. Prompt the user for it and don't fabricate one. When provided, use `gh run view <id> --log-failed` to fetch failure logs.",
    };
  }
  return {
    ok: true,
    prompt: [
      `Investigate the following GitHub Actions workflow run: ${trimmed}`,
      "",
      "Produce a root-cause report with these sections:",
      "  1. Run summary (workflow name, trigger, conclusion, duration)",
      "  2. Failing job(s) (job names + the step that failed inside each)",
      "  3. Failing assertion / error (exact log lines, with file:line if a test)",
      "  4. Recent commits in the run's branch (top 5 — the regression likely lives here)",
      "  5. Hypothesis (1-3 candidate causes, ranked by likelihood)",
      "  6. Suggested fix (concrete patch direction or command to reproduce locally)",
      "  7. Verification plan (how to confirm the fix works before re-pushing)",
      "",
      "Do not modify CI configuration unless the root cause is actually in the workflow YAML.",
    ].join("\n"),
    systemAugment: [
      "When investigating a workflow failure:",
      "  - Use `gh run view <id>` for metadata and `gh run view <id> --log` for logs. If `gh` is unavailable, say so and ask for a log paste.",
      "  - Filter the log to the failing step only — full logs are noise.",
      "  - Use `git log --oneline <branch> -20` to find candidate regression commits.",
      "  - When a test failed, locate the test file and read the failing assertion before guessing.",
      "  - Save the root-cause analysis to memory with `topic_key=cases/ci-<run-id>`.",
    ].join("\n"),
  };
};
