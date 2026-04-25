#!/usr/bin/env node
/**
 * Top-level driver for the WOTANN PR-checks GitHub Action.
 *
 * V9 T12.5: invoked from `.github/workflows/pr-checks.yml` after the diff
 * has been written to disk by `gh pr diff`. Reads env vars set by the
 * workflow, runs all `.wotann/checks/*.md` against the diff, and emits
 * a Check Run per result.
 *
 * Env vars expected:
 *   GITHUB_TOKEN     — auth for GitHub Checks API
 *   GITHUB_REPOSITORY — `owner/name`
 *   PR_HEAD_SHA      — head SHA of the PR
 *   PR_DIFF_PATH     — path to the unified-diff file on disk
 *   WOTANN_CHECKS_DIR — directory of `.md` check defs (default `.wotann/checks`)
 *
 * Exits:
 *   0 — all checks passed (or only neutral/advisory failures)
 *   1 — at least one blocking check failed
 *   2 — harness failure (bad config, missing diff, etc.)
 *
 * QB #6: every error path is honest — explicit message, non-zero exit.
 */

import { loadPrDiff } from "../dist/pr-checks/diff-loader.js";
import { runPrChecks, runCheckEcho } from "../dist/pr-checks/pr-runner.js";
import { emitAllChecks } from "../dist/pr-checks/check-emitter.js";

async function main() {
  const repo = process.env["GITHUB_REPOSITORY"] ?? "";
  const headSha = process.env["PR_HEAD_SHA"] ?? "";
  const token = process.env["GITHUB_TOKEN"] ?? "";
  const diffPath = process.env["PR_DIFF_PATH"] ?? "";
  const checksDir = process.env["WOTANN_CHECKS_DIR"] ?? ".wotann/checks";

  if (!repo || !headSha || !token || !diffPath) {
    console.error(
      "[pr-checks] missing required env: GITHUB_REPOSITORY, PR_HEAD_SHA, GITHUB_TOKEN, PR_DIFF_PATH",
    );
    process.exit(2);
  }

  const loaded = await loadPrDiff({ mode: "file", filePath: diffPath });
  if (!loaded.ok) {
    console.error(`[pr-checks] diff load failed: ${loaded.error}`);
    process.exit(2);
  }

  const summary = await runPrChecks({
    checksDir,
    prDiff: loaded.diff,
    runCheck: runCheckEcho,
  });

  console.log(
    JSON.stringify(
      {
        overall: summary.overall,
        totalDurationMs: summary.totalDurationMs,
        results: summary.results,
      },
      null,
      2,
    ),
  );

  const emit = await emitAllChecks(summary, { repo, headSha, token });
  const failedEmits = emit.filter((e) => !e.ok);
  if (failedEmits.length > 0) {
    console.warn(`[pr-checks] ${failedEmits.length} check-run emit(s) failed`);
    for (const f of failedEmits) {
      console.warn(`  - status=${f.statusCode ?? "?"} attempts=${f.attempts} err=${f.error ?? ""}`);
    }
  }

  if (summary.overall === "failure") {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`[pr-checks] uncaught: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exit(2);
});
