/**
 * .release-notes — generates release notes from a commit range.
 *
 * WHAT: a Jean-style dev-workflow magic command that turns the commit
 *       range between two tags into a structured release-notes
 *       document grouped by category (feat, fix, refactor, docs, ...).
 *
 * WHY:  release notes are the user-facing record of every shipped
 *       version. Hand-writing them is slow and inconsistent. A
 *       deterministic handler that consumes Conventional Commit
 *       history produces consistent, readable notes the maintainer
 *       can polish in minutes.
 *
 * WHERE: invoked via:
 *          .release-notes                    — from latest tag -> HEAD
 *          .release-notes from=<tag>         — from <tag> -> HEAD
 *          .release-notes from=<tag> to=<tag> — explicit range
 *
 * HOW:  pure prompt-shaper. The systemAugment instructs the agent to
 *       use `git tag --list --sort=-version:refname` for tag
 *       discovery, `git log <from>..<to>` to enumerate commits, and
 *       to group by Conventional Commit type. Honest-stubs: if no
 *       tags exist, report and ask the user to provide an explicit
 *       range.
 */

import type { MagicCommandHandler } from "../types.js";

interface RangeArgs {
  readonly from?: string;
  readonly to?: string;
}

function parseRange(raw: string): RangeArgs {
  // Accepts "from=<X>", "to=<Y>", whitespace-separated, in any order.
  const args: { from?: string; to?: string } = {};
  for (const tok of raw.trim().split(/\s+/)) {
    if (tok.length === 0) continue;
    const m = tok.match(/^(from|to)\s*=\s*(\S+)$/);
    if (!m) continue;
    if (m[1] === "from") args.from = m[2];
    else if (m[1] === "to") args.to = m[2];
  }
  return args;
}

export const handleReleaseNotes: MagicCommandHandler = (input) => {
  const range = parseRange(input);
  const fromLabel = range.from ?? "<latest tag>";
  const toLabel = range.to ?? "HEAD";
  return {
    ok: true,
    prompt: [
      `Generate release notes for the commit range ${fromLabel}..${toLabel}.`,
      "",
      "Workflow:",
      `  1. Determine the FROM tag:`,
      range.from
        ? `       Use the user-supplied tag: ${range.from}.`
        : "       Run `git tag --list --sort=-version:refname` and pick the most recent tag. If no tags exist, ask the user for an explicit FROM commit and stop.",
      "  2. Determine the TO ref:",
      range.to ? `       Use the user-supplied ref: ${range.to}.` : "       Use HEAD by default.",
      "  3. Run `git log <from>..<to> --pretty=format:%H%x09%s%x09%an` to enumerate commits.",
      "  4. Parse each commit message. Group by Conventional Commit type:",
      "       - feat   -> ## New Features",
      "       - fix    -> ## Bug Fixes",
      "       - perf   -> ## Performance",
      "       - refactor -> ## Refactors",
      "       - docs   -> ## Documentation",
      "       - test   -> ## Tests",
      "       - chore  -> ## Chores (skip if empty)",
      "       - other  -> ## Other Changes",
      "  5. Within each section, list one bullet per commit:",
      "       - <subject> (<short-sha> by <author>)",
      "  6. At the top, write a 2-3 sentence narrative summary of the release.",
      "  7. At the bottom, list breaking changes if any commits include `BREAKING CHANGE:` in their body.",
      "  8. Output the markdown. DO NOT publish until the user approves.",
    ].join("\n"),
    systemAugment: [
      "When generating release notes:",
      "  - Read `BREAKING CHANGE:` footers from commit bodies, not just the subject line.",
      "  - If a commit message is non-Conventional, include it under `## Other Changes` rather than guessing the type.",
      "  - Skip merge commits unless they introduce new content not present in the merged commits.",
      "  - Surface contributor names; thank-yous improve community feel.",
      "  - If `git log` returns zero commits in the range, report that and ask whether the wrong tags were chosen.",
      "  - Save the proposed notes to memory with `topic_key=releases/<to>` so they can be edited and re-used.",
    ].join("\n"),
  };
};
