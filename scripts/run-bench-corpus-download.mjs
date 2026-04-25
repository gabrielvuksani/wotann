#!/usr/bin/env node
/**
 * V9 §T2.1 — LongMemEval corpus download helper.
 *
 * Wraps `scripts/download-longmemeval.mjs` so the recurring "fetch the
 * corpus, sanity-check it, mention it in BENCHMARKS.md" workflow is one
 * command instead of three. The downstream downloader is already
 * opt-in; this helper passes `--yes` on its behalf because the user
 * has chosen to invoke this wrapper explicitly.
 *
 * Audit context: the V9 audit found `.wotann/benchmarks/longmemeval/`
 * empty on a fresh clone — the downloader exists but nobody had run
 * it yet. This wrapper closes the loop:
 *
 *   1. spawns the downloader with --yes,
 *   2. counts files and bytes in the destination directory,
 *   3. updates `docs/BENCHMARKS.md` "Historical results" with a
 *      "corpus fetched" note (only on success — honest stub on
 *      failure that prints the downloader's exit code + stderr and
 *      DOES NOT touch the docs).
 *
 * This script does NOT execute the network fetch in CI; it is a
 * developer-side helper. The `benchmark-nightly.yml` workflow uses
 * the underlying downloader directly with the secret-gated --yes
 * pass-through so this wrapper is never on the CI hot path.
 *
 * Usage:
 *   node scripts/run-bench-corpus-download.mjs
 *   node scripts/run-bench-corpus-download.mjs --variant=oracle
 *   node scripts/run-bench-corpus-download.mjs --skip-docs
 *   node scripts/run-bench-corpus-download.mjs --dry-run
 *
 * Flags:
 *   --variant=s|m|oracle  Forwarded to download-longmemeval.mjs.
 *                          Default: s (115k-token history).
 *   --out-dir=PATH         Forwarded to download-longmemeval.mjs.
 *                          Default: <cwd>/.wotann/benchmarks/longmemeval
 *   --skip-docs            Don't touch docs/BENCHMARKS.md.
 *   --dry-run              Forward --dry-run; no fetch, no docs change.
 *   --force                Forward --force to overwrite existing file.
 *   -h, --help             Show this message.
 *
 * Exit codes mirror `download-longmemeval.mjs`:
 *   0 success, 1 missing --yes (cannot happen here), 2 disk space,
 *   3 download / corruption, 4 invalid flag, 5 docs update failed.
 */

import { spawn } from "node:child_process";
import { readdir, stat, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, cwd, exit, stderr, stdout } from "node:process";

// ── Constants ─────────────────────────────────────────

const VALID_VARIANTS = new Set(["s", "m", "oracle"]);

/**
 * Minimum size in bytes the LongMemEval `s` corpus is expected to
 * weigh in at. The HuggingFace JSON hovers around ~80 MB; we treat
 * any file under 10 MB as a likely truncation / mirror failure.
 */
const MIN_CORPUS_BYTES = 10 * 1024 * 1024; // 10 MB

const HISTORICAL_TABLE_HEADER = "### Historical results";
const FETCHED_NOTE_PREFIX = "_corpus fetched_";

// ── CLI parsing ───────────────────────────────────────

/**
 * Parse argv. Same shape as `download-longmemeval.mjs::parseArgs` but
 * with a few wrapper-only flags. Unknown flags exit with code 4.
 */
function parseArgs(args) {
  const opts = {
    variant: "s",
    outDir: null,
    dryRun: false,
    force: false,
    skipDocs: false,
    help: false,
  };
  for (const arg of args) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--skip-docs") opts.skipDocs = true;
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

const USAGE = `
LongMemEval corpus download wrapper (V9 §T2.1)

Wraps scripts/download-longmemeval.mjs and updates docs/BENCHMARKS.md
with a "corpus fetched" note when the download succeeds.

USAGE:
  node scripts/run-bench-corpus-download.mjs [flags]

FLAGS:
  --variant=s|m|oracle   Which split to fetch (default: s)
  --out-dir=PATH         Override destination directory
  --skip-docs            Don't touch docs/BENCHMARKS.md
  --dry-run              Forward --dry-run; no fetch, no docs update
  --force                Forward --force to the downloader
  -h, --help             Show this message

This wrapper passes --yes to the downloader on the user's behalf.
Pass --dry-run if you only want to preview the plan.
`.trimStart();

// ── Path helpers ──────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DOWNLOAD_SCRIPT = join(REPO_ROOT, "scripts", "download-longmemeval.mjs");
const DEFAULT_OUT_DIR = join(REPO_ROOT, ".wotann", "benchmarks", "longmemeval");
const BENCHMARKS_DOC = join(REPO_ROOT, "docs", "BENCHMARKS.md");

// ── Spawn helper ──────────────────────────────────────

/**
 * Run the downloader with the given flags. Inherit stdio so the user
 * sees the downloader's progress directly. Returns the exit code so
 * the wrapper can propagate it.
 */
function spawnDownloader(flags) {
  return new Promise((resolveExit) => {
    const child = spawn("node", [DOWNLOAD_SCRIPT, ...flags], {
      stdio: "inherit",
      cwd: REPO_ROOT,
    });
    child.on("close", (code) => resolveExit(code ?? 1));
    child.on("error", (err) => {
      stderr.write(`spawn failed: ${err.message}\n`);
      resolveExit(3);
    });
  });
}

// ── Sanity check ──────────────────────────────────────

/**
 * Verify the destination directory has a corpus file that's the right
 * shape: at least one `.json` file, total size above MIN_CORPUS_BYTES.
 *
 * Returns { fileCount, totalBytes, files } on success or null when the
 * directory is empty / missing. The caller decides whether to fail.
 */
async function sanityCheck(outDir) {
  try {
    await access(outDir, constants.F_OK);
  } catch {
    return null;
  }
  const entries = await readdir(outDir, { withFileTypes: true });
  const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
  if (jsonFiles.length === 0) return null;

  let totalBytes = 0;
  const files = [];
  for (const f of jsonFiles) {
    const p = join(outDir, f.name);
    const s = await stat(p);
    totalBytes += s.size;
    files.push({ name: f.name, bytes: s.size });
  }
  return {
    fileCount: jsonFiles.length,
    totalBytes,
    files,
  };
}

// ── Docs updater ──────────────────────────────────────

/**
 * Patch docs/BENCHMARKS.md "Historical results" section so the next
 * visitor sees the corpus has been fetched. Idempotent — if the
 * "_corpus fetched_" line is already present it's replaced with the
 * fresh timestamp instead of duplicated.
 *
 * Returns true on successful write. False on any failure (file
 * missing, no header, write error). Honest stub: never throws.
 */
async function updateBenchmarksDoc({ variant, totalBytes, fileCount }) {
  let doc;
  try {
    doc = await readFile(BENCHMARKS_DOC, "utf-8");
  } catch (err) {
    stderr.write(
      `[docs] could not read ${BENCHMARKS_DOC}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  }

  const headerIdx = doc.indexOf(HISTORICAL_TABLE_HEADER);
  if (headerIdx < 0) {
    stderr.write(
      `[docs] could not find header "${HISTORICAL_TABLE_HEADER}" in ${BENCHMARKS_DOC}; skipping update.\n`,
    );
    return false;
  }

  const isoDate = new Date().toISOString().slice(0, 10);
  const sizeMb = (totalBytes / (1024 * 1024)).toFixed(1);
  const note =
    `${FETCHED_NOTE_PREFIX} on ${isoDate} — ` +
    `variant=${variant}, files=${fileCount}, total=${sizeMb} MB. ` +
    `Run \`node scripts/run-bench-corpus-download.mjs\` to refresh._`;

  // Find the line right after the table header. The header line is
  // followed by a blank line, then a 2-row markdown table. The note
  // belongs immediately under the header.
  const headerEnd = doc.indexOf("\n", headerIdx) + 1;

  // Replace any existing "_corpus fetched_" line so we don't pile up
  // duplicates across re-runs. Search forward from the header through
  // to the next blank line / next header.
  const sectionEnd = doc.indexOf("\n###", headerEnd);
  const sectionText = doc.slice(headerEnd, sectionEnd === -1 ? undefined : sectionEnd);
  const cleanedSection = sectionText
    .split("\n")
    .filter((l) => !l.trim().startsWith(FETCHED_NOTE_PREFIX))
    .join("\n");

  const before = doc.slice(0, headerEnd);
  const after = sectionEnd === -1 ? "" : doc.slice(sectionEnd);
  const updated = `${before}\n${note}\n${cleanedSection.replace(/^\n+/, "")}${after}`;

  try {
    await writeFile(BENCHMARKS_DOC, updated, "utf-8");
  } catch (err) {
    stderr.write(
      `[docs] write failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  }

  stdout.write(`[docs] updated ${BENCHMARKS_DOC} with corpus-fetched note.\n`);
  return true;
}

// ── Main ──────────────────────────────────────────────

async function main() {
  const args = argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help) {
    stdout.write(USAGE);
    exit(0);
  }

  // Resolve destination up-front so sanity-check + docs both see
  // the same path the downloader will use.
  const outDir = opts.outDir ? resolve(opts.outDir) : DEFAULT_OUT_DIR;

  // Build downloader flags. We add --yes on behalf of the user so
  // the wrapper is one-command.
  const downloaderFlags = ["--yes", `--variant=${opts.variant}`];
  if (opts.outDir) downloaderFlags.push(`--out-dir=${outDir}`);
  if (opts.dryRun) downloaderFlags.push("--dry-run");
  if (opts.force) downloaderFlags.push("--force");

  stdout.write(
    `\n[wrapper] V9 §T2.1 — running download-longmemeval.mjs ${downloaderFlags.join(" ")}\n` +
      `[wrapper] cwd=${cwd()}\n` +
      `[wrapper] script=${DOWNLOAD_SCRIPT}\n` +
      `[wrapper] outDir=${outDir}\n\n`,
  );

  const code = await spawnDownloader(downloaderFlags);
  if (code !== 0) {
    stderr.write(
      `\n[wrapper] downloader exited with code ${code}; corpus NOT fetched.\n` +
        `[wrapper] docs/BENCHMARKS.md was NOT updated.\n`,
    );
    exit(code);
  }

  // Dry-run path doesn't write anything to disk so skip checks.
  if (opts.dryRun) {
    stdout.write(`\n[wrapper] dry-run complete; no further work.\n`);
    exit(0);
  }

  // Sanity-check the corpus directory.
  const summary = await sanityCheck(outDir);
  if (summary === null) {
    stderr.write(
      `\n[wrapper] sanity-check failed — ${outDir} has no .json files.\n` +
        `[wrapper] docs/BENCHMARKS.md was NOT updated.\n`,
    );
    exit(3);
  }
  if (summary.totalBytes < MIN_CORPUS_BYTES) {
    stderr.write(
      `\n[wrapper] sanity-check failed — corpus only ${summary.totalBytes.toLocaleString()} bytes ` +
        `(< ${MIN_CORPUS_BYTES.toLocaleString()} bytes minimum).\n` +
        `[wrapper] Likely truncated or mirror failure. Re-run with --force to retry.\n` +
        `[wrapper] docs/BENCHMARKS.md was NOT updated.\n`,
    );
    exit(3);
  }

  stdout.write(
    `\n[wrapper] sanity-check OK — files=${summary.fileCount}, bytes=${summary.totalBytes.toLocaleString()}\n`,
  );
  for (const f of summary.files) {
    stdout.write(`           ${f.name}: ${f.bytes.toLocaleString()} bytes\n`);
  }

  // Update docs unless skipped.
  if (!opts.skipDocs) {
    const ok = await updateBenchmarksDoc({
      variant: opts.variant,
      totalBytes: summary.totalBytes,
      fileCount: summary.fileCount,
    });
    if (!ok) {
      // Honest stub: download succeeded but docs update failed. Exit
      // 5 so callers see the partial-success without us claiming
      // total success.
      stderr.write(
        `\n[wrapper] PARTIAL SUCCESS — corpus fetched, docs update failed.\n` +
          `[wrapper] Re-run with --skip-docs if you want to bypass the docs step.\n`,
      );
      exit(5);
    }
  }

  stdout.write(`\n[wrapper] done.\n`);
  exit(0);
}

main().catch((err) => {
  stderr.write(
    `\n[wrapper] FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  exit(3);
});
