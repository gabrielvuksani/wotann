#!/usr/bin/env node
/**
 * V9 T14.6 — SWE-bench Verified trajectory + score extractor.
 *
 * SWE-bench Verified (https://www.swebench.com/) writes:
 *   <run-dir>/predictions.json     — one model patch per instance
 *   <run-dir>/eval_results.json    — pass/fail per instance (optional)
 *
 * Real evaluation requires running each patch in a per-instance docker
 * container, which is out of scope for an extraction script. We:
 *   1. Parse predictions.json to get the instance count + model.
 *   2. If eval_results.json is present, derive pass-rate from it.
 *   3. Otherwise emit a stub report with leaderboardComparable=false.
 *
 * predictions.json shape (one of two upstream formats — we accept both):
 *   - JSONL: one {instance_id, model_name_or_path, model_patch} per line
 *   - JSON:  { predictions: [{instance_id, ...}], ... }
 *
 * eval_results.json shape (when present):
 *   { instance_id_to_resolved: { "<id>": true|false, ... }, ... }
 *   OR
 *   { resolved_ids: [...], unresolved_ids: [...] }
 *
 * Usage:
 *   node scripts/swebench-extract.mjs --input <run-dir> --output <report.json>
 *
 * Exit codes:
 *   0 — success
 *   2 — invalid flags / usage
 *   3 — extraction failed
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
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
    "Usage: node scripts/swebench-extract.mjs --input <run-dir> --output <report.json>\n",
  );
  process.exit(code);
}

// ── Predictions parsing ──────────────────────────────

function parsePredictions(predictionsPath) {
  const raw = readFileSync(predictionsPath, "utf-8");
  const trimmed = raw.trim();
  // Try single JSON document first (covers SWE-bench's array/object form).
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.predictions)) return parsed.predictions;
    // Single-object case (one prediction): wrap in array.
    if (parsed && typeof parsed === "object" && typeof parsed.instance_id === "string") {
      // But only treat as single-pred if file extension hints `.json` not `.jsonl`,
      // or there's no second object; we fall through to JSONL path otherwise.
      if (!predictionsPath.endsWith(".jsonl")) return [parsed];
    }
  } catch {
    // fallthrough — try JSONL
  }
  // JSONL fallback: parse line-by-line, skip malformed.
  const out = [];
  const lines = trimmed.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i < lines.length; i++) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

// ── Eval results parsing ─────────────────────────────

function parseEvalResults(evalPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(evalPath, "utf-8"));
  } catch {
    return null;
  }
  // Format 1: instance_id_to_resolved map
  if (parsed && typeof parsed.instance_id_to_resolved === "object") {
    const map = parsed.instance_id_to_resolved;
    const resolved = new Set();
    for (const [id, val] of Object.entries(map)) {
      if (val === true) resolved.add(id);
    }
    return { resolved };
  }
  // Format 2: resolved_ids array
  if (Array.isArray(parsed?.resolved_ids)) {
    return { resolved: new Set(parsed.resolved_ids.map(String)) };
  }
  return null;
}

// ── Build report ─────────────────────────────────────

function buildReport(runDir) {
  const ranAt = new Date().toISOString();
  const baseReport = {
    benchmark: "swe-bench-verified",
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

  // predictions.json — required
  const predictionsPath = join(runDir, "predictions.json");
  const predictionsJsonl = join(runDir, "predictions.jsonl");
  const predFile = existsSync(predictionsPath)
    ? predictionsPath
    : existsSync(predictionsJsonl)
      ? predictionsJsonl
      : null;
  if (predFile === null) {
    return {
      ...baseReport,
      notes: `predictions.json[l] missing under ${runDir}`,
    };
  }

  let predictions;
  try {
    predictions = parsePredictions(predFile);
  } catch (e) {
    return {
      ...baseReport,
      notes: `predictions parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // eval_results.json — optional but required for a comparable score
  const evalPath = join(runDir, "eval_results.json");
  const evalResults = existsSync(evalPath) ? parseEvalResults(evalPath) : null;

  const trajectories = [];
  for (const pred of predictions) {
    const taskId =
      typeof pred?.instance_id === "string" ? pred.instance_id : "unknown";
    const passed = evalResults !== null ? evalResults.resolved.has(taskId) : false;
    const trajectory = {
      taskId,
      passed,
      durationSec: typeof pred?.duration_sec === "number" ? pred.duration_sec : 0,
      costUsd: typeof pred?.cost_usd === "number" ? pred.cost_usd : 0,
    };
    if (typeof pred?.model_patch === "string" && pred.model_patch.length > 0) {
      trajectory.transcript = [
        `model=${pred.model_name_or_path ?? "unknown"} patch_bytes=${pred.model_patch.length}`,
      ];
    }
    trajectories.push(trajectory);
  }

  const totalTasks = trajectories.length;
  const passedTasks = trajectories.filter((t) => t.passed).length;
  const score = totalTasks > 0 ? passedTasks / totalTasks : 0;

  // SWE-bench is leaderboard-comparable iff (a) eval_results.json is
  // present (we have actual pass/fail evidence) AND (b) the run was
  // declared real via env. Without eval_results we emit the predictions
  // count + 0% score with a clear note.
  const isReal = process.env.WOTANN_SWE_REAL === "1";
  const leaderboardComparable = isReal && evalResults !== null && totalTasks > 0;

  const report = {
    benchmark: "swe-bench-verified",
    version: "0.0.0",
    ranAt,
    totalTasks,
    passedTasks,
    score,
    leaderboardComparable,
    trajectories,
  };

  const notes = [];
  if (!isReal) notes.push("WOTANN_SWE_REAL=1 not set");
  if (evalResults === null) notes.push("eval_results.json missing — score is unreliable");
  if (totalTasks === 0) notes.push(`zero predictions parsed from ${predFile}`);
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
