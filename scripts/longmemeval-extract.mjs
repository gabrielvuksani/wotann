#!/usr/bin/env node
/**
 * V9 T14.6 — LongMemEval trajectory + score extractor.
 *
 * LongMemEval (https://github.com/xiaowu0162/LongMemEval) ships 500
 * questions in `data/longmemeval_s.json`. A run produces JSONL at
 *   runs/<model>/<run_id>.jsonl
 * with one line per question:
 *   { question_id, predicted_answer, gold_answer, question_type? }
 *
 * Scoring policy:
 *   - "answer_in_passages" type: exact-match (case-insensitive, trimmed)
 *   - free-form:                 token-F1 against the gold answer
 *
 * When the question_type is missing or unknown, we score with token-F1
 * (more lenient, matches the upstream default for unclassified items).
 *
 * Usage:
 *   node scripts/longmemeval-extract.mjs --input <run.jsonl> --output <report.json>
 *
 * Exit codes:
 *   0 — success
 *   2 — invalid flags / usage
 *   3 — extraction failed (read/parse/write)
 *
 * No external deps — node builtins only. Defensive: a malformed line
 * is recorded as warning and skipped, never crashes the run.
 *
 * Output report shape (matches sibling extractors):
 *   {
 *     benchmark: "longmemeval",
 *     version, ranAt, totalTasks, passedTasks, score,
 *     leaderboardComparable, trajectories: [{ taskId, passed,
 *     durationSec, costUsd, transcript? }], notes?
 *   }
 *
 * `passedTasks` for free-form items uses an F1 threshold of 0.5
 * (>=0.5 token-F1 counts as pass). The raw F1 score per question is
 * also embedded in the trajectory.transcript[0] for inspection.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

// ── CLI ──────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  printUsageAndExit(0);
}
if (!values.input || !values.output) {
  printUsageAndExit(2);
}

function printUsageAndExit(code) {
  const target = code === 0 ? process.stdout : process.stderr;
  target.write(
    "Usage: node scripts/longmemeval-extract.mjs --input <run.jsonl> --output <report.json>\n",
  );
  process.exit(code);
}

// ── Scoring ──────────────────────────────────────────

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function tokenF1(predicted, gold) {
  const predTokens = normalizeText(predicted);
  const goldTokens = normalizeText(gold);
  if (predTokens.length === 0 && goldTokens.length === 0) return 1;
  if (predTokens.length === 0 || goldTokens.length === 0) return 0;
  const goldCount = new Map();
  for (const t of goldTokens) goldCount.set(t, (goldCount.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of predTokens) {
    const remaining = goldCount.get(t) ?? 0;
    if (remaining > 0) {
      common++;
      goldCount.set(t, remaining - 1);
    }
  }
  if (common === 0) return 0;
  const precision = common / predTokens.length;
  const recall = common / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function exactMatch(predicted, gold) {
  return String(predicted ?? "").trim().toLowerCase() ===
    String(gold ?? "").trim().toLowerCase();
}

// ── Extraction ───────────────────────────────────────

function buildReport(inputPath) {
  const ranAt = new Date().toISOString();
  const baseReport = {
    benchmark: "longmemeval",
    version: "0.0.0",
    ranAt,
    totalTasks: 0,
    passedTasks: 0,
    score: 0,
    leaderboardComparable: false,
    trajectories: [],
  };

  if (!existsSync(inputPath)) {
    return {
      ...baseReport,
      notes: `input file missing: ${inputPath}`,
    };
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
  let passedCount = 0;
  let totalScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      warnings.push(`line ${i + 1}: parse failed — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const taskId =
      typeof entry.question_id === "string"
        ? entry.question_id
        : typeof entry.id === "string"
          ? entry.id
          : `q-${i + 1}`;
    const predicted = entry.predicted_answer ?? entry.prediction ?? "";
    const gold = entry.gold_answer ?? entry.answer ?? "";
    const questionType =
      typeof entry.question_type === "string" ? entry.question_type : "unknown";

    let pointScore;
    let passed;
    if (questionType === "answer_in_passages") {
      passed = exactMatch(predicted, gold);
      pointScore = passed ? 1 : 0;
    } else {
      const f1 = tokenF1(predicted, gold);
      pointScore = f1;
      passed = f1 >= 0.5;
    }
    if (passed) passedCount++;
    totalScore += pointScore;

    const trajectory = {
      taskId,
      passed,
      durationSec: typeof entry.duration_sec === "number" ? entry.duration_sec : 0,
      costUsd: typeof entry.cost_usd === "number" ? entry.cost_usd : 0,
      transcript: [
        `type=${questionType} score=${pointScore.toFixed(3)} ` +
          `predicted="${String(predicted).slice(0, 200)}" gold="${String(gold).slice(0, 200)}"`,
      ],
    };
    trajectories.push(trajectory);
  }

  const totalTasks = trajectories.length;
  const score = totalTasks > 0 ? totalScore / totalTasks : 0;
  const isReal = process.env.WOTANN_LME_REAL === "1";
  const leaderboardComparable = isReal && totalTasks > 0;

  const report = {
    benchmark: "longmemeval",
    version: "0.0.0",
    ranAt,
    totalTasks,
    passedTasks: passedCount,
    score,
    leaderboardComparable,
    trajectories,
  };

  if (totalTasks === 0) {
    report.notes = `zero questions parsed from ${inputPath}`;
  } else if (!isReal) {
    report.notes =
      "WOTANN_LME_REAL=1 not set; report is not leaderboard-comparable";
  }
  if (warnings.length > 0) {
    report.warnings = warnings.slice(0, 20);
  }
  return report;
}

// ── Main ─────────────────────────────────────────────

const inputPath = resolve(values.input);
const outputPath = resolve(values.output);
const report = buildReport(inputPath);

try {
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
} catch (e) {
  process.stderr.write(
    `ERROR: write failed — ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(3);
}

process.stdout.write(
  `extracted ${report.totalTasks} tasks → ${outputPath}` +
    (report.leaderboardComparable ? " (leaderboard-comparable)" : " (not leaderboard-comparable)") +
    "\n",
);
process.exit(0);
