#!/usr/bin/env node
/**
 * TerminalBench 2.0 corpus downloader.
 *
 * Clones the 89-task Laude Institute TerminalBench repository into
 * `.wotann/benchmarks/terminal-bench/src/`, then invokes
 * `scripts/terminal-bench-extract.mjs` to produce the flat
 * `terminal-bench-tasks.jsonl` the runner loads.
 *
 * This script is INTENTIONALLY opt-in and NEVER auto-runs in CI — the
 * corpus is ~1-3 GB with Docker assets, and CI environments typically
 * can't accommodate it. The exit-code contract parallels
 * `scripts/download-longmemeval.mjs` so a common runbook works for
 * both benchmarks.
 *
 * Usage:
 *   node scripts/download-terminal-bench-corpus.mjs --yes
 *   node scripts/download-terminal-bench-corpus.mjs --dry-run
 *   node scripts/download-terminal-bench-corpus.mjs --yes --force
 *
 * Flags:
 *   --yes        Confirm license + corpus consent (REQUIRED for download)
 *   --dry-run    Print the plan but do not clone / extract
 *   --force      Remove an existing clone and re-fetch
 *   --out-dir=PATH   Override destination root (default: <cwd>/.wotann/benchmarks/terminal-bench)
 *   -h, --help   Print usage
 *
 * Exit codes (aligned with scripts/download-longmemeval.mjs):
 *   0 — success (clone + extract done, or dry-run done, or corpus already present)
 *   1 — user did not pass --yes
 *   2 — disk-space check failed (< 10 GB free on destination partition)
 *   3 — clone / extract failed (network, git error, extract error)
 *   4 — invalid flag / usage error
 */

import { mkdir, stat, rm, access } from "node:fs/promises";
import { constants, statfsSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { argv, cwd, exit, stderr, stdout } from "node:process";

// ── Config ────────────────────────────────────────────

const UPSTREAM_REPO = "https://github.com/laude-institute/terminal-bench";
const MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB (matches P0-8 spec)
const DEFAULT_OUT = ".wotann/benchmarks/terminal-bench";
const EXTRACT_SCRIPT = "scripts/terminal-bench-extract.mjs";

// ── CLI parsing ───────────────────────────────────────

/**
 * Parse argv into an options object. Rejects unknown flags with exit 4.
 */
function parseArgs(args) {
  const opts = {
    yes: false,
    dryRun: false,
    force: false,
    outDir: null,
    help: false,
  };
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--out-dir=")) opts.outDir = arg.slice("--out-dir=".length);
    else {
      stderr.write(`Unknown flag: ${arg}\n`);
      exit(4);
    }
  }
  return opts;
}

const USAGE = `
TerminalBench 2.0 corpus downloader

This script clones the Laude Institute TerminalBench repository and
extracts the task set into a JSONL the WOTANN runner can load.

  Upstream:  ${UPSTREAM_REPO}
  Disk need: ~${(MIN_FREE_BYTES / 1e9).toFixed(0)} GB (clone + Docker assets)

USAGE:
  node scripts/download-terminal-bench-corpus.mjs --yes [flags]

FLAGS:
  --yes            Confirm corpus download + license (REQUIRED)
  --dry-run        Print plan; do not clone
  --force          Remove existing clone and re-fetch
  --out-dir=PATH   Custom destination (default: .wotann/benchmarks/terminal-bench)
  -h, --help       Show this message

EXIT CODES:
  0 — success
  1 — missing --yes confirmation
  2 — insufficient disk space (need ${(MIN_FREE_BYTES / 1e9).toFixed(0)} GB)
  3 — git clone / extract failed
  4 — invalid flag or usage error

This script does not run automatically in CI or tests. That is by design.
`.trimStart();

// ── Disk check ────────────────────────────────────────

/**
 * Check free space on the partition holding `path`. Returns null if the
 * platform doesn't support statfs; otherwise returns bytes free.
 */
function freeBytesFor(path) {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

// ── Shell helper ──────────────────────────────────────

/**
 * Stream-spawn a command with live stdout/stderr inheritance. Resolves
 * with exit code; rejects only on spawn-level failure (binary missing).
 */
function runStreaming(cmd, args, opts = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code ?? -1));
  });
}

// ── Main ──────────────────────────────────────────────

async function main() {
  const args = argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help) {
    stdout.write(USAGE);
    exit(0);
  }

  // Gate 1: --yes required unless --dry-run.
  if (!opts.yes && !opts.dryRun) {
    stderr.write(USAGE);
    stderr.write(
      `\nERROR: This script requires --yes to confirm corpus download.\n` +
        `       Or pass --dry-run to preview without fetching.\n`,
    );
    exit(1);
  }

  const outRoot = opts.outDir ? resolve(opts.outDir) : resolve(cwd(), DEFAULT_OUT);
  const srcDir = join(outRoot, "src");
  const jsonlPath = join(outRoot, "terminal-bench-tasks.jsonl");

  const plan = {
    action: opts.dryRun ? "dry-run" : "clone+extract",
    upstream: UPSTREAM_REPO,
    outRoot,
    srcDir,
    jsonlPath,
    force: opts.force,
  };
  stdout.write(`\nTerminalBench downloader plan:\n${JSON.stringify(plan, null, 2)}\n`);

  if (opts.dryRun) {
    stdout.write(
      `\n[dry-run] Would:\n` +
        `  1. mkdir -p ${outRoot}\n` +
        `  2. git clone --depth 1 ${UPSTREAM_REPO} ${srcDir}\n` +
        `  3. node ${EXTRACT_SCRIPT} --src ${srcDir} --out ${jsonlPath}\n`,
    );
    exit(0);
  }

  // Ensure parent directory exists.
  await mkdir(outRoot, { recursive: true });

  // Gate 2: disk-space check.
  const free = freeBytesFor(outRoot);
  if (free !== null && free < MIN_FREE_BYTES) {
    stderr.write(
      `\nERROR: Not enough free space on ${outRoot}.\n` +
        `       Available: ${(free / 1e9).toFixed(2)} GB\n` +
        `       Required:  ${(MIN_FREE_BYTES / 1e9).toFixed(0)} GB\n`,
    );
    exit(2);
  }

  // Existing clone guard.
  const srcExists = existsSync(srcDir);
  if (srcExists && !opts.force) {
    stdout.write(
      `\nClone already exists: ${srcDir}\n` +
        `Pass --force to remove and re-fetch.\n` +
        `Running extract against existing clone...\n`,
    );
  } else if (srcExists && opts.force) {
    stdout.write(`\n--force: removing existing ${srcDir}...\n`);
    try {
      await rm(srcDir, { recursive: true, force: true });
    } catch (e) {
      stderr.write(`\nERROR: failed to remove existing clone: ${e instanceof Error ? e.message : String(e)}\n`);
      exit(3);
    }
  }

  // Clone (if not already present).
  if (!existsSync(srcDir)) {
    stdout.write(`\nCloning ${UPSTREAM_REPO} → ${srcDir}...\n`);
    let cloneCode;
    try {
      cloneCode = await runStreaming("git", ["clone", "--depth", "1", UPSTREAM_REPO, srcDir]);
    } catch (e) {
      stderr.write(`\nERROR: git clone spawn failed: ${e instanceof Error ? e.message : String(e)}\n`);
      exit(3);
    }
    if (cloneCode !== 0) {
      stderr.write(`\nERROR: git clone exited with code ${cloneCode}\n`);
      exit(3);
    }
  }

  // Extract — call the sibling script. It's responsible for walking the
  // cloned repo and producing a flat JSONL the runner can read.
  const extractScript = resolve(cwd(), EXTRACT_SCRIPT);
  if (!existsSync(extractScript)) {
    stderr.write(`\nERROR: extract script missing at ${extractScript}\n`);
    exit(3);
  }
  stdout.write(`\nRunning extract: ${EXTRACT_SCRIPT}\n`);
  let extractCode;
  try {
    extractCode = await runStreaming("node", [extractScript, "--src", srcDir, "--out", jsonlPath]);
  } catch (e) {
    stderr.write(`\nERROR: extract spawn failed: ${e instanceof Error ? e.message : String(e)}\n`);
    exit(3);
  }
  if (extractCode !== 0) {
    stderr.write(`\nERROR: extract script exited with code ${extractCode}\n`);
    exit(3);
  }

  // Verify the jsonl actually landed.
  try {
    await access(jsonlPath, constants.F_OK);
  } catch {
    stderr.write(`\nERROR: extract reported success but ${jsonlPath} is missing\n`);
    exit(3);
  }
  const written = await stat(jsonlPath);
  stdout.write(
    `\nOK: wrote ${written.size.toLocaleString()} bytes to ${jsonlPath}\n`,
  );
  exit(0);
}

main().catch((err) => {
  stderr.write(
    `\nFATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  exit(3);
});
