#!/usr/bin/env node
/**
 * V9 T14.6 — GAIA (general AI assistant benchmark) extractor.
 *
 * GAIA (https://huggingface.co/datasets/gaia-benchmark/GAIA) writes
 * JSONL run output. Each line is one task evaluation:
 *   { task_id, model_answer, gold_answer?, level, ... }
 *
 * Levels 1/2/3 reflect difficulty. The leaderboard reports a per-level
 * score and an overall (macro-)average. We aggregate both.
 *
 * Scoring: GAIA's official metric is exact-match (case-insensitive,
 * whitespace-normalized) against gold_answer. When gold_answer is
 * absent (the held-out test set), we cannot score — we still report
 * task counts and per-level distribution, but mark
 * leaderboardComparable=false.
 *
 * Usage:
 *   node scripts/gaia-extract.mjs --input <run.jsonl> --output <report.json>
 *
 * Exit codes:
 *   0 — success
 *   2 — invalid flags / usage
 *   3 — extraction failed
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
    "Usage: node scripts/gaia-extract.mjs --input <run.jsonl> --output <report.json>\n",
  );
  process.exit(code);
}

// ── Scoring ──────────────────────────────────────────

function normalize(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function exactMatch(predicted, gold) {
  return normalize(predicted) === normalize(gold);
}

// ── Build report ─────────────────────────────────────

function buildReport(inputPath) {
  const ranAt = new Date().toISOString();
  const baseReport = {
    benchmark: "gaia",
    version: "0.0.0",
    ranAt,
    totalTasks: 0,
    passedTasks: 0,
    score: 0,
    leaderboardComparable: false,
    trajectories: [],
  };

  if (!existsSync(inputPath)) {
    return { ...baseReport, notes: `input file missing: ${inputPath}` };
  }

  let raw;
  try {
    raw = readFileSync(inputPath, "utf-8");
  } catch (e) {
    return {
      ...baseReport,
      notes: `cannot read input: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const trajectories = [];
  const warnings = [];
  const perLevel = new Map(); // level -> { total, passed }
  let hasAnyGold = false;

  for (let i = 0; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (e) {
      warnings.push(`line ${i + 1}: parse failed — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const taskId =
      typeof entry.task_id === "string"
        ? entry.task_id
        : typeof entry.id === "string"
          ? entry.id
          : `t-${i + 1}`;
    const predicted = entry.model_answer ?? entry.prediction ?? "";
    const gold = entry.gold_answer ?? entry.answer ?? null;
    const level =
      typeof entry.level === "number"
        ? entry.level
        : typeof entry.level === "string"
          ? parseInt(entry.level, 10) || 0
          : 0;

    let passed = false;
    if (gold !== null && gold !== undefined && gold !== "") {
      hasAnyGold = true;
      passed = exactMatch(predicted, gold);
    }

    if (!perLevel.has(level)) perLevel.set(level, { total: 0, passed: 0 });
    const bucket = perLevel.get(level);
    bucket.total++;
    if (passed) bucket.passed++;

    trajectories.push({
      taskId,
      passed,
      durationSec: typeof entry.duration_sec === "number" ? entry.duration_sec : 0,
      costUsd: typeof entry.cost_usd === "number" ? entry.cost_usd : 0,
      transcript: [
        `level=${level} predicted="${String(predicted).slice(0, 200)}" ` +
          (gold !== null && gold !== undefined
            ? `gold="${String(gold).slice(0, 200)}"`
            : "gold=<unavailable>"),
      ],
    });
  }

  const totalTasks = trajectories.length;
  const passedTasks = trajectories.filter((t) => t.passed).length;
  // Macro-average over levels (matches GAIA leaderboard convention).
  let levelAccs = [];
  for (const [, bucket] of perLevel) {
    if (bucket.total > 0) levelAccs.push(bucket.passed / bucket.total);
  }
  const macroScore =
    levelAccs.length > 0 ? levelAccs.reduce((s, x) => s + x, 0) / levelAccs.length : 0;
  const microScore = totalTasks > 0 ? passedTasks / totalTasks : 0;

  const isReal = process.env.WOTANN_GAIA_REAL === "1";
  const leaderboardComparable = isReal && hasAnyGold && totalTasks > 0;

  const report = {
    benchmark: "gaia",
    version: "0.0.0",
    ranAt,
    totalTasks,
    passedTasks,
    score: macroScore, // headline = macro over levels
    leaderboardComparable,
    trajectories,
    perLevel: Object.fromEntries(
      Array.from(perLevel.entries()).map(([level, b]) => [
        level,
        { total: b.total, passed: b.passed, accuracy: b.total > 0 ? b.passed / b.total : 0 },
      ]),
    ),
    microScore,
  };

  const notes = [];
  if (!isReal) notes.push("WOTANN_GAIA_REAL=1 not set");
  if (!hasAnyGold) notes.push("no gold_answer fields found — score is unreliable");
  if (totalTasks === 0) notes.push(`zero tasks parsed from ${inputPath}`);
  if (notes.length > 0) report.notes = notes.join("; ");
  if (warnings.length > 0) report.warnings = warnings.slice(0, 20);
  return report;
}

// ── Main ─────────────────────────────────────────────

const inputPath = resolve(values.input);
const outPath = resolve(values.output);
const report = buildReport(inputPath);

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
