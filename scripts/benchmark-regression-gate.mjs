#!/usr/bin/env node
/**
 * V9 T2.4 — Regression gate for nightly benchmarks.
 *
 * Reads the History table from docs/BENCHMARKS.md, computes the
 * rolling median over the last N runs, and exits 1 when the latest
 * run's overall accuracy drops more than `--threshold-pct` below
 * that median. Otherwise exits 0.
 *
 * Flags:
 *   --doc <path>            BENCHMARKS.md path (required)
 *   --threshold-pct <n>     Allowed drop, percentage points (default 5)
 *   --window <n>            Rolling window size (default 7)
 *
 * Pure stdlib; no spawning, no network.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = { doc: null, threshold: 5, window: 7 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--doc=")) out.doc = a.slice(6);
    else if (a === "--doc" && i + 1 < argv.length) out.doc = argv[++i];
    else if (a.startsWith("--threshold-pct=")) out.threshold = Number(a.slice(16));
    else if (a === "--threshold-pct" && i + 1 < argv.length) out.threshold = Number(argv[++i]);
    else if (a.startsWith("--window=")) out.window = Number(a.slice(9));
    else if (a === "--window" && i + 1 < argv.length) out.window = Number(argv[++i]);
  }
  return out;
}

const BEGIN_MARKER = "<!-- BENCHMARKS:BEGIN -->";
const END_MARKER = "<!-- BENCHMARKS:END -->";

function readHistory(content) {
  const begin = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return [];
  const body = content.slice(begin + BEGIN_MARKER.length, end);
  const rows = [];
  const pattern = /\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)%\s*\|/g;
  for (const m of body.matchAll(pattern)) {
    rows.push({
      date: m[1],
      variant: m[2],
      instances: Number(m[3]),
      overallPct: Number(m[4]),
    });
  }
  return rows;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.doc) {
    process.stderr.write("error: --doc <path> required\n");
    process.exit(2);
  }
  const docPath = resolve(args.doc);
  if (!existsSync(docPath)) {
    process.stderr.write(`error: ${docPath} does not exist; nothing to gate\n`);
    process.exit(0);
  }
  if (!Number.isFinite(args.threshold) || args.threshold <= 0) {
    process.stderr.write("error: --threshold-pct must be a positive finite number\n");
    process.exit(2);
  }
  const history = readHistory(readFileSync(docPath, "utf8"));
  if (history.length < 2) {
    process.stderr.write(`[info] only ${history.length} runs in history; gate skipped\n`);
    process.exit(0);
  }
  const latest = history[history.length - 1];
  const window = history.slice(-1 - args.window, -1);
  if (window.length === 0) {
    process.stderr.write("[info] no prior runs in window; gate skipped\n");
    process.exit(0);
  }
  const med = median(window.map((r) => r.overallPct));
  const drop = med - latest.overallPct;
  process.stderr.write(
    `[gate] latest=${latest.overallPct.toFixed(1)}% median(${window.length})=${med.toFixed(1)}% drop=${drop.toFixed(2)}pp threshold=${args.threshold}pp\n`,
  );
  if (drop > args.threshold) {
    process.stderr.write(
      `[FAIL] regression: ${latest.date} dropped ${drop.toFixed(2)}pp below the rolling median\n`,
    );
    process.exit(1);
  }
  process.stderr.write("[ok] no regression\n");
}

main();
