/**
 * .ai-commit — stages relevant files and writes a Conventional Commit
 * message describing the changes.
 *
 * WHAT: a Jean-style dev-workflow magic command that turns "I made some
 *       changes" into "here's the commit, ready to push" without the
 *       user writing the message themselves.
 *
 * WHY:  good commit messages are a discipline most engineers skip when
 *       in flow. A handler that generates a Conventional Commit from
 *       the diff lets the user keep momentum without losing log quality.
 *
 * WHERE: invoked via `.ai-commit` (no args) or `.ai-commit <scope-hint>`
 *        for a hint about the conventional-commit scope.
 *
 * HOW:  pure prompt-shaper. The systemAugment instructs the agent to
 *       run `git status` + `git diff --staged` (or `git diff` if
 *       nothing is staged) + recent log to infer style, then propose
 *       the commit. The handler defaults to dryRun semantics: surface
 *       the message; let the user confirm before running `git commit`.
 */

import type { MagicCommandHandler } from "../types.js";

export const handleAiCommit: MagicCommandHandler = (input) => {
  const trimmed = input.trim();
  const scopeHint = trimmed.length === 0 ? "" : ` Scope hint from user: ${trimmed}.`;
  return {
    ok: true,
    prompt: [
      `Generate a Conventional Commit for the current working tree changes.${scopeHint}`,
      "",
      "Workflow:",
      "  1. Run `git status` to see all modifications.",
      "  2. Run `git diff` (or `git diff --staged` if anything is already staged) to read the changes.",
      "  3. Run `git log --oneline -10` to learn the project's commit style.",
      "  4. Decide which files to stage — exclude .env, secrets, and unrelated files.",
      "  5. Compose a Conventional Commit message:",
      "       <type>(<scope>): <short summary>",
      "       <blank line>",
      "       <2-3 sentence body explaining the WHY>",
      "  6. Show the message to the user. DO NOT run `git commit` until the user approves.",
      "  7. If the user approves, stage the chosen files and create the commit.",
      "",
      "Allowed types: feat, fix, refactor, docs, test, chore, perf, build, ci, style.",
      "Pick the type that best matches the dominant change. If multiple types apply, prefer the change that delivers user-visible value.",
    ].join("\n"),
    systemAugment: [
      "When generating a commit message:",
      "  - The message captures WHY, not WHAT. The diff already shows what changed.",
      "  - Keep the summary line under 72 characters.",
      "  - Never stage with `git add -A` or `git add .` — name files explicitly to avoid leaking secrets.",
      "  - If the diff contains multiple unrelated changes, propose splitting into multiple commits.",
      "  - If the diff appears to contain secrets or credentials, refuse to commit and warn the user.",
      "  - Honor the user's existing commit-signing preferences. Never disable hooks or signatures.",
    ].join("\n"),
  };
};
