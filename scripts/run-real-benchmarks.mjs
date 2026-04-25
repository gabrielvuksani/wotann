#!/usr/bin/env node
/**
 * V9 T14.6 — orchestrator for the 6 leaderboard-comparable extractors.
 *
 * Discovers benchmark run directories under `bench-results/<bench>/<run-id>/`,
 * dispatches each *-extract.mjs sibling with the right --input/--output,
 * collects all 6 reports into `bench-results/summary.json`, and prints a
 * markdown summary table to stdout.
 *
 * Default expected directory layout (override with --root <DIR>):
 *   <root>/
 *     terminal-bench/<run-id>/         — input dir for terminal-bench
 *     longmemeval/<run-id>.jsonl       — input file for longmemeval
 *     swe-bench/<run-id>/              — input dir for swe-bench
 *     bfcl/<run-id>/                   — input dir for bfcl
 *     gaia/<run-id>.jsonl              — input file for gaia
 *     webarena/<run-id>/               — input dir for webarena
 *
 * Each benchmark's MOST RECENT run is selected by mtime. To run a
 * specific run-id, set WOTANN_BENCH_RUN_ID=<id>.
 *
 * Usage:
 *   node scripts/run-real-benchmarks.mjs [--root <bench-results-dir>] [--out <summary.json>]
 *
 * Exit codes:
 *   0 — at least one extraction succeeded
 *   2 — invalid flags / usage
 *   3 — root dir missing or no benchmarks discovered
 *
 * Honest stub: when no run directories exist, writes summary.json with
 * 0 reports and a `notes` field, prints a friendly "nothing to do".
 */

import { writeFileSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) printUsageAndExit(0);

function printUsageAndExit(code) {
  const target = code === 0 ? process.stdout : process.stderr;
  target.write(
    "Usage: node scripts/run-real-benchmarks.mjs [--root <bench-results-dir>] [--out <summary.json>]\n",
  );
  process.exit(code);
}

// ── Constants ────────────────────────────────────────

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Each entry: { name, dir, ext, script, kind }
 *  - dir:     subdir under <root> for this benchmark
 *  - ext:     the run artifact extension (".jsonl" or "" for dir-mode)
 *  - script:  extraction script filename
 *  - kind:    "dir" | "file" — whether the run artifact is a dir or file
 */
const BENCHMARKS = [
  {
    name: "terminal-bench",
    dir: "terminal-bench",
    kind: "dir",
    script: "terminal-bench-extract.mjs",
  },
  {
    name: "longmemeval",
    dir: "longmemeval",
    kind: "file",
    ext: ".jsonl",
    script: "longmemeval-extract.mjs",
  },
  {
    name: "swe-bench",
    dir: "swe-bench",
    kind: "dir",
    script: "swebench-extract.mjs",
  },
  {
    name: "bfcl",
    dir: "bfcl",
    kind: "dir",
    script: "bfcl-extract.mjs",
  },
  {
    name: "gaia",
    dir: "gaia",
    kind: "file",
    ext: ".jsonl",
    script: "gaia-extract.mjs",
  },
  {
    name: "webarena",
    dir: "webarena",
    kind: "dir",
    script: "webarena-extract.mjs",
  },
];

// ── Discovery ────────────────────────────────────────

function pickMostRecentRun(parentDir, kind, ext) {
  if (!existsSync(parentDir)) return null;
  let entries;
  try {
    entries = readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const explicitId = process.env.WOTANN_BENCH_RUN_ID;
  let candidates = entries.filter((e) => {
    if (kind === "dir" && !e.isDirectory()) return false;
    if (kind === "file" && !e.isFile()) return false;
    if (kind === "file" && ext && !e.name.endsWith(ext)) return false;
    if (explicitId && e.name !== explicitId && !e.name.startsWith(`${explicitId}.`)) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  // Sort by mtime (newest first)
  const ranked = candidates
    .map((e) => {
      const path = join(parentDir, e.name);
      let mtime = 0;
      try {
        mtime = statSync(path).mtimeMs;
      } catch {
        // unreadable — skip
      }
      return { name: e.name, path, mtime };
    })
    .filter((r) => r.mtime > 0)
    .sort((a, b) => b.mtime - a.mtime);
  return ranked.length > 0 ? ranked[0].path : null;
}

// ── Subprocess dispatch ──────────────────────────────

function execNoThrow(file, args, env) {
  return new Promise((resolveProm) => {
    execFile(
      file,
      args,
      { env: { ...process.env, ...env }, timeout: 30 * 60 * 1000 },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof (error).code === "number"
            ? Number(error.code)
            : error
              ? 1
              : 0;
        resolveProm({
          exitCode,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? (error instanceof Error ? error.message : ""),
        });
      },
    );
  });
}

// ── Main ─────────────────────────────────────────────

const root = resolve(values.root ?? "bench-results");
const summaryOut = resolve(values.out ?? join(root, "summary.json"));

if (!existsSync(root)) {
  // Honest stub: write the summary only if the OUTPUT dir exists (we
  // don't silently mkdir into a path the user didn't specify). When
  // both root and output dir are missing, we emit a stderr explanation
  // and exit 3 without writing a phantom file.
  const stub = {
    ranAt: new Date().toISOString(),
    root,
    reports: [],
    notes: `bench-results root missing: ${root}. Run benchmarks first.`,
  };
  let wroteStub = false;
  if (existsSync(dirname(summaryOut))) {
    try {
      writeFileSync(summaryOut, JSON.stringify(stub, null, 2));
      wroteStub = true;
    } catch {
      // fall through — stderr explains
    }
  }
  process.stderr.write(
    `No bench-results root at ${root}; ` +
      (wroteStub ? `wrote stub summary to ${summaryOut}` : `summary not written (output dir missing)`) +
      `\n`,
  );
  process.exit(3);
}

const reports = [];
const failures = [];

for (const bench of BENCHMARKS) {
  const benchDir = join(root, bench.dir);
  const inputPath = pickMostRecentRun(benchDir, bench.kind, bench.ext);
  const reportPath = join(benchDir, `report-${bench.name}.json`);

  if (inputPath === null) {
    reports.push({
      name: bench.name,
      status: "no-runs",
      reportPath: null,
      report: {
        benchmark: bench.name,
        totalTasks: 0,
        passedTasks: 0,
        score: 0,
        leaderboardComparable: false,
        notes: `no run artifact found under ${benchDir}`,
      },
    });
    continue;
  }

  const scriptPath = join(SCRIPTS_DIR, bench.script);
  if (!existsSync(scriptPath)) {
    failures.push(`${bench.name}: extraction script missing at ${scriptPath}`);
    continue;
  }

  const result = await execNoThrow("node", [
    scriptPath,
    "--input",
    inputPath,
    "--output",
    reportPath,
  ]);

  if (result.exitCode !== 0) {
    failures.push(
      `${bench.name}: exit=${result.exitCode} stderr=${result.stderr.slice(0, 300)}`,
    );
    reports.push({
      name: bench.name,
      status: "failed",
      reportPath,
      stderr: result.stderr.slice(0, 1000),
    });
    continue;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf-8"));
  } catch (e) {
    failures.push(
      `${bench.name}: report unreadable — ${e instanceof Error ? e.message : String(e)}`,
    );
    reports.push({ name: bench.name, status: "unparseable", reportPath });
    continue;
  }

  reports.push({
    name: bench.name,
    status: "ok",
    inputPath,
    reportPath,
    report: parsed,
  });
}

const summary = {
  ranAt: new Date().toISOString(),
  root,
  reports,
  failures,
};

try {
  writeFileSync(summaryOut, JSON.stringify(summary, null, 2));
} catch (e) {
  process.stderr.write(
    `ERROR: cannot write summary — ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(3);
}

// ── Markdown table ───────────────────────────────────

const headerRow =
  "| Benchmark | Status | Total | Passed | Score | Leaderboard? | Notes |";
const dividerRow =
  "|-----------|--------|-------|--------|-------|--------------|-------|";
process.stdout.write(`${headerRow}\n${dividerRow}\n`);
for (const r of reports) {
  const rep = r.report ?? {};
  const total = typeof rep.totalTasks === "number" ? rep.totalTasks : 0;
  const passed = typeof rep.passedTasks === "number" ? rep.passedTasks : 0;
  const score = typeof rep.score === "number" ? (rep.score * 100).toFixed(1) + "%" : "n/a";
  const lb = rep.leaderboardComparable === true ? "yes" : "no";
  const notes = (rep.notes ?? "").toString().slice(0, 60);
  process.stdout.write(
    `| ${r.name} | ${r.status} | ${total} | ${passed} | ${score} | ${lb} | ${notes} |\n`,
  );
}
process.stdout.write(`\nWrote ${reports.length} reports → ${summaryOut}\n`);
if (failures.length > 0) {
  process.stdout.write(`Failures: ${failures.length}\n`);
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
}

const anyOk = reports.some((r) => r.status === "ok");
process.exit(anyOk ? 0 : 3);
