#!/usr/bin/env node
/**
 * V9 T14.6 — WebArena extractor.
 *
 * WebArena (https://webarena.dev/) writes one JSON file per task in the
 * run directory:
 *   <run-dir>/<task_id>.json
 *     { trajectory, success, score?, intent?, reward? }
 * OR a single results.json with all tasks aggregated.
 *
 * Headline metric: success rate across all tasks (binary success per
 * task). We tolerate either layout.
 *
 * Usage:
 *   node scripts/webarena-extract.mjs --input <run-dir> --output <report.json>
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
    "Usage: node scripts/webarena-extract.mjs --input <run-dir> --output <report.json>\n",
  );
  process.exit(code);
}

// ── Build report ─────────────────────────────────────

function readPerTaskFiles(runDir) {
  const entries = readdirSync(runDir, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".json")) continue;
    if (ent.name === "results.json" || ent.name === "summary.json") continue;
    const path = join(runDir, ent.name);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8"));
      // Accept either an array of per-task entries or a single object
      if (Array.isArray(parsed)) {
        for (const entry of parsed) out.push({ entry, source: ent.name });
      } else {
        out.push({ entry: parsed, source: ent.name });
      }
    } catch {
      // skip malformed
    }
  }
  return out;
}

function readAggregateFile(runDir) {
  for (const candidate of ["results.json", "summary.json"]) {
    const path = join(runDir, candidate);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8"));
      if (Array.isArray(parsed)) return parsed.map((e) => ({ entry: e, source: candidate }));
      if (Array.isArray(parsed?.tasks)) {
        return parsed.tasks.map((e) => ({ entry: e, source: candidate }));
      }
      if (Array.isArray(parsed?.results)) {
        return parsed.results.map((e) => ({ entry: e, source: candidate }));
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

function buildReport(runDir) {
  const ranAt = new Date().toISOString();
  const baseReport = {
    benchmark: "webarena",
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
  let stat;
  try {
    stat = statSync(runDir);
  } catch (e) {
    return {
      ...baseReport,
      notes: `cannot stat run dir: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!stat.isDirectory()) {
    return { ...baseReport, notes: `run path is not a directory: ${runDir}` };
  }

  // Prefer aggregate file when present; fall back to per-task files.
  let entries = readAggregateFile(runDir);
  if (entries === null || entries.length === 0) {
    entries = readPerTaskFiles(runDir);
  }
  if (entries.length === 0) {
    return { ...baseReport, notes: `no parseable .json files under ${runDir}` };
  }

  const trajectories = [];
  for (const { entry, source } of entries) {
    const taskId =
      typeof entry?.task_id === "string"
        ? entry.task_id
        : typeof entry?.id === "string"
          ? entry.id
          : typeof entry?.intent === "string"
            ? entry.intent.slice(0, 60)
            : basename(source, ".json");
    const passed =
      entry?.success === true ||
      entry?.passed === true ||
      (typeof entry?.score === "number" && entry.score >= 1) ||
      (typeof entry?.reward === "number" && entry.reward >= 1);
    const trajectory = {
      taskId,
      passed,
      durationSec: typeof entry?.duration_sec === "number" ? entry.duration_sec : 0,
      costUsd: typeof entry?.cost_usd === "number" ? entry.cost_usd : 0,
    };
    if (Array.isArray(entry?.trajectory)) {
      const transcript = entry.trajectory
        .filter((s) => typeof s === "string")
        .slice(-20);
      if (transcript.length > 0) trajectory.transcript = transcript;
    }
    trajectories.push(trajectory);
  }

  const totalTasks = trajectories.length;
  const passedTasks = trajectories.filter((t) => t.passed).length;
  const score = totalTasks > 0 ? passedTasks / totalTasks : 0;
  const isReal = process.env.WOTANN_WEBARENA_REAL === "1";
  const leaderboardComparable = isReal && totalTasks > 0;

  const report = {
    benchmark: "webarena",
    version: "0.0.0",
    ranAt,
    totalTasks,
    passedTasks,
    score,
    leaderboardComparable,
    trajectories,
  };

  const notes = [];
  if (!isReal) notes.push("WOTANN_WEBARENA_REAL=1 not set");
  if (totalTasks === 0) notes.push(`zero tasks under ${runDir}`);
  if (notes.length > 0) report.notes = notes.join("; ");
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
