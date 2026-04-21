#!/usr/bin/env node
/**
 * LongMemEval corpus downloader.
 *
 * Fetches the 500-instance LongMemEval dataset (Wu et al. ICLR 2025) from
 * HuggingFace into `.wotann/benchmarks/longmemeval/`. This script is
 * INTENTIONALLY opt-in and NEVER auto-runs in CI — the dataset is
 * user-licensed content that a CI system must not silently pull.
 *
 * Usage:
 *   node scripts/download-longmemeval.mjs --yes
 *   node scripts/download-longmemeval.mjs --yes --variant oracle
 *   node scripts/download-longmemeval.mjs --dry-run
 *
 * Flags:
 *   --yes            Confirm license + corpus consent (REQUIRED)
 *   --variant=s|m|oracle   Which JSON file to fetch (default: s)
 *   --out-dir=PATH   Override destination (default: <cwd>/.wotann/benchmarks/longmemeval)
 *   --dry-run        Print what would happen but don't fetch
 *   --force          Overwrite existing file instead of refusing
 *
 * Exit codes:
 *   0 — success (file downloaded or already present)
 *   1 — user did not pass --yes
 *   2 — disk-space check failed (< 2 GB free on destination partition)
 *   3 — download failed (network, HTTP error, corrupt content)
 *   4 — invalid flag / usage error
 */

import { mkdir, stat, writeFile, access } from "node:fs/promises";
import { constants, statfsSync } from "node:fs";
import { resolve, join } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";

// ── Config ────────────────────────────────────────────

const DATASET_BASE = "https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main";
const VALID_VARIANTS = new Set(["s", "m", "oracle"]);
const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// ── CLI parsing ───────────────────────────────────────

/**
 * Parse argv into an options object. Rejects unknown flags with exit code 4.
 */
function parseArgs(args) {
  const opts = {
    yes: false,
    variant: "s",
    outDir: null,
    dryRun: false,
    force: false,
    help: false,
  };
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--variant=")) opts.variant = arg.slice("--variant=".length);
    else if (arg.startsWith("--out-dir=")) opts.outDir = arg.slice("--out-dir=".length);
    else {
      stderr.write(`Unknown flag: ${arg}\n`);
      exit(4);
    }
  }
  if (!VALID_VARIANTS.has(opts.variant)) {
    stderr.write(
      `Invalid --variant "${opts.variant}". Must be one of: ${[...VALID_VARIANTS].join(", ")}\n`,
    );
    exit(4);
  }
  return opts;
}

// ── Usage banner ──────────────────────────────────────

const USAGE = `
LongMemEval corpus downloader

This script fetches the 500-instance LongMemEval dataset from HuggingFace:
  https://huggingface.co/datasets/xiaowu0162/longmemeval

The dataset is user-licensed content. By passing --yes you confirm that
you have read and agree to the HuggingFace dataset license terms.

USAGE:
  node scripts/download-longmemeval.mjs --yes [flags]

FLAGS:
  --yes            Confirm license and corpus download (REQUIRED)
  --variant=s|m|oracle
                   Which split to download (default: s — 115k-token history)
  --out-dir=PATH   Custom destination (default: .wotann/benchmarks/longmemeval)
  --dry-run        Print plan; do not fetch
  --force          Overwrite existing corpus file
  -h, --help       Show this message

EXAMPLES:
  # Download the default "s" variant after reading the license.
  node scripts/download-longmemeval.mjs --yes

  # Preview the plan without downloading.
  node scripts/download-longmemeval.mjs --dry-run

  # Pull the oracle-evidence variant.
  node scripts/download-longmemeval.mjs --yes --variant=oracle

This script does not run automatically in CI or tests. That is by design —
the dataset is user-licensed content that must only be fetched on explicit
user consent.
`.trimStart();

// ── Disk check ────────────────────────────────────────

/**
 * Check free space on the partition that holds `path`. Returns null if the
 * platform doesn't support statfs; otherwise returns bytes free.
 */
function freeBytesFor(path) {
  try {
    const stats = statfsSync(path);
    // `bavail * bsize` = bytes available to an unprivileged user.
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

// ── Fetch helper ──────────────────────────────────────

/**
 * Stream a URL into a Buffer. Fails fast on non-2xx responses with a
 * structured error so the caller can format a diagnostic.
 */
async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

// ── Main ──────────────────────────────────────────────

async function main() {
  const args = argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help) {
    stdout.write(USAGE);
    exit(0);
  }

  // Gate 1: --yes is required unless --dry-run.
  if (!opts.yes && !opts.dryRun) {
    stderr.write(USAGE);
    stderr.write(
      `\nERROR: This script requires --yes to confirm license acceptance.\n` +
        `       Or pass --dry-run to preview without downloading.\n`,
    );
    exit(1);
  }

  // Resolve destination.
  const outDir = opts.outDir
    ? resolve(opts.outDir)
    : resolve(cwd(), ".wotann", "benchmarks", "longmemeval");
  const fileName = `longmemeval_${opts.variant}.json`;
  const outFile = join(outDir, fileName);
  const url = `${DATASET_BASE}/${fileName}`;

  // Plan output.
  const plan = {
    action: opts.dryRun ? "dry-run" : "download",
    variant: opts.variant,
    url,
    outFile,
    force: opts.force,
  };
  stdout.write(`\nLongMemEval downloader plan:\n${JSON.stringify(plan, null, 2)}\n`);

  if (opts.dryRun) {
    stdout.write(`\n[dry-run] Would fetch ${url}\n           -> ${outFile}\n`);
    exit(0);
  }

  // Ensure parent directory exists.
  await mkdir(outDir, { recursive: true });

  // Gate 2: disk-space check.
  const free = freeBytesFor(outDir);
  if (free !== null && free < MIN_FREE_BYTES) {
    stderr.write(
      `\nERROR: Not enough free space on ${outDir}.\n` +
        `       Available: ${(free / 1e9).toFixed(2)} GB\n` +
        `       Required:  ${(MIN_FREE_BYTES / 1e9).toFixed(0)} GB\n`,
    );
    exit(2);
  }

  // Existing-file guard.
  try {
    await access(outFile, constants.F_OK);
    if (!opts.force) {
      stdout.write(
        `\nFile already exists: ${outFile}\n` +
          `Pass --force to overwrite.\n`,
      );
      exit(0);
    }
  } catch {
    // File doesn't exist — proceed.
  }

  // Fetch.
  stdout.write(`\nDownloading ${url}...\n`);
  let buf;
  try {
    buf = await fetchBuffer(url);
  } catch (e) {
    stderr.write(`\nERROR: download failed — ${e instanceof Error ? e.message : String(e)}\n`);
    exit(3);
  }

  // Basic sanity — content must parse as a JSON array.
  let parsed;
  try {
    parsed = JSON.parse(buf.toString("utf-8"));
  } catch (e) {
    stderr.write(`\nERROR: downloaded content is not valid JSON: ${e instanceof Error ? e.message : String(e)}\n`);
    exit(3);
  }
  if (!Array.isArray(parsed)) {
    stderr.write(`\nERROR: downloaded content is not a JSON array.\n`);
    exit(3);
  }

  await writeFile(outFile, buf);

  const written = await stat(outFile);
  stdout.write(
    `\nOK: wrote ${written.size.toLocaleString()} bytes to ${outFile}\n` +
      `    instances: ${parsed.length}\n`,
  );
  exit(0);
}

main().catch((err) => {
  stderr.write(
    `\nFATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  exit(3);
});
