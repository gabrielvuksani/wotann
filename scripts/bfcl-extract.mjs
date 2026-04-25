#!/usr/bin/env node
/**
 * V9 T14.6 — Berkeley Function Call Leaderboard (BFCL) extractor.
 *
 * BFCL (https://gorilla.cs.berkeley.edu/leaderboard.html) outputs JSONL
 * per category. After running the upstream evaluator, scores live at
 *   <run-dir>/score/<category>.json
 * Each <category>.json contains aggregate metrics for that subset:
 *   simple, multiple, parallel, parallel_multiple, java, javascript,
 *   sql, executable, ast, irrelevance, etc.
 *
 * Per-category JSON shape (BFCL v3, liberal):
 *   {
 *     "accuracy": 0.0-1.0,
 *     "total_count": int,
 *     "correct_count": int,
 *     "model_name": str?
 *   }
 *
 * The leaderboard headline number is the macro-average across the live
 * categories. We compute it here AS AN AGGREGATE, but mark
 * leaderboardComparable=false unless WOTANN_BFCL_REAL=1 (since we only
 * see whichever categories the user ran — partial coverage is a common
 * footgun on the leaderboard).
 *
 * Usage:
 *   node scripts/bfcl-extract.mjs --input <run-dir> --output <report.json>
 *
 * Exit codes:
 *   0 — success
 *   2 — invalid flags / usage
 *   3 — extraction failed
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) printUsageAndExit(0);
if (!values.input || !values.output) printUsageAndExit(2);

function printUsageAndExit(code) {
  const target = code === 0 ? process.stdout : process.stderr;
  target.write(
    "Usage: node scripts/bfcl-extract.mjs --input <run-dir> --output <report.json>\n",
  );
  process.exit(code);
}

// ── Build report ─────────────────────────────────────

function buildReport(runDir) {
  const ranAt = new Date().toISOString();
  const baseReport = {
    benchmark: "bfcl",
    version: "0.0.0",
    ranAt,
    totalTasks: 0,
    passedTasks: 0,
    score: 0,
    leaderboardComparable: false,
    trajectories: [],
  };

  if (!existsSync(runDir)) {
    return { ...baseReport, notes: `run directory missing: ${runDir}` };
  }
  // Tolerate either <run-dir>/score/*.json or <run-dir>/*.json layouts
  let scoreDir = join(runDir, "score");
  if (!existsSync(scoreDir)) {
    scoreDir = runDir;
  }
  let entries;
  try {
    entries = readdirSync(scoreDir, { withFileTypes: true });
  } catch (e) {
    return {
      ...baseReport,
      notes: `cannot read scores: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const scoreFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => join(scoreDir, e.name));
  if (scoreFiles.length === 0) {
    return { ...baseReport, notes: `no per-category .json files found under ${scoreDir}` };
  }

  const trajectories = [];
  const warnings = [];
  let totalCount = 0;
  let correctCount = 0;

  for (const path of scoreFiles) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8"));
    } catch (e) {
      warnings.push(`${basename(path)}: parse failed — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const category = basename(path, ".json");
    const accuracy =
      typeof parsed.accuracy === "number"
        ? parsed.accuracy
        : typeof parsed.score === "number"
          ? parsed.score
          : null;
    const total =
      typeof parsed.total_count === "number"
        ? parsed.total_count
        : typeof parsed.total === "number"
          ? parsed.total
          : 0;
    const correct =
      typeof parsed.correct_count === "number"
        ? parsed.correct_count
        : typeof parsed.correct === "number"
          ? parsed.correct
          : accuracy !== null && total > 0
            ? Math.round(accuracy * total)
            : 0;

    if (accuracy === null && total === 0) {
      warnings.push(`${basename(path)}: no accuracy/total fields`);
      continue;
    }

    totalCount += total;
    correctCount += correct;

    trajectories.push({
      taskId: category,
      passed: accuracy !== null && accuracy >= 0.99, // category fully solved counts as pass
      durationSec: 0,
      costUsd: 0,
      transcript: [
        `category=${category} accuracy=${(accuracy ?? 0).toFixed(4)} ` +
          `correct=${correct}/${total}`,
      ],
    });
  }

  const microScore = totalCount > 0 ? correctCount / totalCount : 0;
  const isReal = process.env.WOTANN_BFCL_REAL === "1";
  const leaderboardComparable = isReal && trajectories.length > 0;

  const report = {
    benchmark: "bfcl",
    version: "0.0.0",
    ranAt,
    totalTasks: totalCount,
    passedTasks: correctCount,
    score: microScore,
    leaderboardComparable,
    trajectories,
  };

  const notes = [];
  if (!isReal) notes.push("WOTANN_BFCL_REAL=1 not set");
  if (trajectories.length === 0) notes.push("zero categories parsed");
  if (notes.length > 0) report.notes = notes.join("; ");
  if (warnings.length > 0) report.warnings = warnings.slice(0, 20);
  return report;
}

// ── Main ─────────────────────────────────────────────

const runDir = resolve(values.input);
const outPath = resolve(values.output);
const report = buildReport(runDir);

try {
  writeFileSync(outPath, JSON.stringify(report, null, 2));
} catch (e) {
  process.stderr.write(
    `ERROR: write failed — ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(3);
}

process.stdout.write(
  `extracted ${report.totalTasks} tasks → ${outPath}` +
    (report.leaderboardComparable ? " (leaderboard-comparable)" : " (not leaderboard-comparable)") +
    "\n",
);
process.exit(0);
