/**
 * .investigate-issue — pulls a GitHub issue + comments, summarizes the
 * context, lists impacted files, and proposes root-cause investigation
 * steps.
 *
 * WHAT: a Jean-style dev-workflow magic command that turns an issue URL
 *       (or repo#number) into a triage report the agent can act on.
 *
 * WHY:  triaging an issue manually is a 5-step ritual (read issue, read
 *       comments, locate files, identify likely root cause, propose
 *       next steps). Compressing that into one shortcut saves time on
 *       every bug report.
 *
 * WHERE: invoked via `.investigate-issue <url-or-id>` at the prompt.
 *        The runtime resolves it through magic-commands -> getHandler
 *        -> this function.
 *
 * HOW:  the handler is a pure prompt-shaper. It expands the user's
 *       input into a structured prompt + systemAugment that tells the
 *       agent what tools to use (the `gh` CLI for issue data, `git
 *       grep` for impacted files). Honest-stub semantics: if `gh` is
 *       not on the PATH at runtime, the agent reports that and falls
 *       back to whatever URL fetcher is available.
 */

import type { MagicCommandHandler } from "../types.js";

export const handleInvestigateIssue: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: true,
      prompt:
        "Ask the user for the GitHub issue URL or `<owner>/<repo>#<number>` they want investigated. Example: .investigate-issue facebook/react#19234. Once they reply, run the investigate-issue flow.",
      systemAugment:
        "The .investigate-issue command requires a target issue. Prompt the user for it and don't fabricate one. When provided, use `gh issue view <number>` to fetch body and comments.",
    };
  }
  return {
    ok: true,
    prompt: [
      `Investigate the following GitHub issue: ${trimmed}`,
      "",
      "Produce a triage report with these sections:",
      "  1. Issue summary (title + 2-3 sentence restatement of the problem)",
      "  2. Reproduction steps (extracted from the issue body and comments)",
      "  3. Comments digest (1 line per substantive comment)",
      "  4. Impacted files (locate by symbol name, error message, stack frame)",
      "  5. Hypothesis (1-3 candidate root causes, ranked)",
      "  6. Next investigation steps (concrete commands or files to read)",
      "",
      "Do not propose a fix yet. The goal is to triage, not to patch.",
    ].join("\n"),
    systemAugment: [
      "When investigating an issue:",
      "  - Use `gh issue view <number>` to fetch issue body and comments. If `gh` is unavailable, say so and fall back to a WebFetch.",
      "  - Use `git grep` and `rg` to locate impacted files by error message, symbol, or stack frame.",
      "  - Cite each conclusion with the source (issue comment, file line, log line).",
      "  - If the issue is too vague to investigate, list the missing information and stop. Do not invent.",
      "  - Save the triage report to memory with `topic_key=cases/issue-<number>` so future sessions can resume.",
    ].join("\n"),
  };
};
