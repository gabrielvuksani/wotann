#!/usr/bin/env node
/**
 * V9 T2.4 — Regression gate for nightly benchmarks.
 *
 * Two operating modes:
 *
 *   1. DOC mode (existing CI integration):
 *        node scripts/benchmark-regression-gate.mjs --doc=docs/BENCHMARKS.md \
 *             --threshold-pct=5 --window=7
 *      Reads the History table from BENCHMARKS.md, computes the rolling
 *      median over the last N runs, and exits 1 when the latest run's
 *      overall accuracy drops more than `--threshold-pct` below that median.
 *
 *   2. JSON mode (new V9 T2.4 shape):
 *        node scripts/benchmark-regression-gate.mjs \
 *             --baseline=bench-results/baseline.json \
 *             --current=bench-results/<run-id>.json \
 *             --threshold-pct=2
 *      Reads a previous run from baseline.json and a new run from the
 *      current json. Compares per-benchmark scores and flags any that
 *      regress by more than `--threshold-pct` (default 2). Exits 0 on
 *      no regression, 1 on regression. Prints a markdown table.
 *
 * Pure stdlib; no spawning, no network. Per-call state (no module globals).
 *
 * Exit codes:
 *   0 — no regression (or insufficient data to gate)
 *   1 — regression detected
 *   2 — invalid args / unreadable inputs
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

// ── Args ─────────────────────────────────────────────────

function parseFlags(argv) {
  // Use parseArgs in tolerant mode so --doc, --baseline, --current,
  // --threshold-pct, --window, --json all coexist.
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      doc: { type: "string" },
      baseline: { type: "string" },
      current: { type: "string" },
      "threshold-pct": { type: "string" },
      window: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });
  const out = {
    doc: typeof values["doc"] === "string" ? values["doc"] : null,
    baseline: typeof values["baseline"] === "string" ? values["baseline"] : null,
    current: typeof values["current"] === "string" ? values["current"] : null,
    threshold: 5,
    window: 7,
    json: values["json"] === true,
  };
  if (typeof values["threshold-pct"] === "string") {
    const n = Number(values["threshold-pct"]);
    if (Number.isFinite(n) && n > 0) out.threshold = n;
  }
  if (typeof values["window"] === "string") {
    const n = Number(values["window"]);
    if (Number.isFinite(n) && n >= 1) out.window = Math.floor(n);
  }
  // JSON mode default threshold is 2pp per V9 spec when --doc isn't set.
  if (out.doc === null && out.baseline !== null && out.current !== null) {
    if (typeof values["threshold-pct"] !== "string") out.threshold = 2;
  }
  return out;
}

// ── DOC mode helpers ─────────────────────────────────────

const BEGIN_MARKER = "<!-- BENCHMARKS:BEGIN -->";
const END_MARKER = "<!-- BENCHMARKS:END -->";

function readHistoryFromDoc(content) {
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

function runDocMode(args) {
  const docPath = resolve(args.doc);
  if (!existsSync(docPath)) {
    process.stderr.write(`error: ${docPath} does not exist; nothing to gate\n`);
    process.exit(0);
  }
  if (!Number.isFinite(args.threshold) || args.threshold <= 0) {
    process.stderr.write("error: --threshold-pct must be a positive finite number\n");
    process.exit(2);
  }
  const history = readHistoryFromDoc(readFileSync(docPath, "utf8"));
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
  process.exit(0);
}

// ── JSON mode helpers ────────────────────────────────────

/**
 * Defensive JSON parser. Returns null when the file is missing or
 * unparseable; logs to stderr.
 */
function readJsonFile(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    process.stderr.write(`[warn] ${abs} does not exist\n`);
    return null;
  }
  try {
    const raw = readFileSync(abs, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[error] could not parse ${abs}: ${msg}\n`);
    return null;
  }
}

/**
 * Normalize a benchmark JSON into a Map<benchName, score>. Accepts
 * several shapes:
 *
 *   { "results": { "swebench": 0.42, "gaia": 0.81 } }
 *   { "scores":  { "swebench": 42,    "gaia": 81 } }
 *   { "benchmarks": [{ "name": "swebench", "score": 0.42 }] }
 *
 * Returns an empty map when the shape is not recognized.
 */
function extractScores(data) {
  const out = new Map();
  if (!data || typeof data !== "object") return out;

  const candidate = data.results ?? data.scores ?? null;
  if (candidate && typeof candidate === "object") {
    for (const [k, v] of Object.entries(candidate)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out.set(k, n);
    }
    return out;
  }

  if (Array.isArray(data.benchmarks)) {
    for (const entry of data.benchmarks) {
      if (typeof entry !== "object" || entry === null) continue;
      const name = typeof entry.name === "string" ? entry.name : null;
      const raw = entry.score ?? entry.value ?? entry.pct ?? null;
      const score = typeof raw === "number" ? raw : Number(raw);
      if (name && Number.isFinite(score)) out.set(name, score);
    }
  }
  return out;
}

/**
 * Normalize a numeric score onto a 0..100 percentage scale. Inputs
 * arriving as 0..1 are scaled up; inputs already in 0..100 pass through.
 */
function toPct(score) {
  if (score >= 0 && score <= 1) return score * 100;
  return score;
}

function compareScores(baseline, current, thresholdPct) {
  const rows = [];
  const allKeys = new Set([...baseline.keys(), ...current.keys()]);
  for (const key of [...allKeys].sort()) {
    const b = baseline.get(key);
    const c = current.get(key);
    if (b === undefined || c === undefined) {
      rows.push({
        name: key,
        baseline: b ?? null,
        current: c ?? null,
        deltaPct: null,
        regressed: false,
        note: b === undefined ? "new benchmark" : "missing in current",
      });
      continue;
    }
    const bPct = toPct(b);
    const cPct = toPct(c);
    const delta = cPct - bPct;
    const regressed = delta < 0 && Math.abs(delta) > thresholdPct;
    rows.push({
      name: key,
      baseline: bPct,
      current: cPct,
      deltaPct: delta,
      regressed,
      note: regressed ? "REGRESSION" : "ok",
    });
  }
  return rows;
}

function renderMarkdownTable(rows, thresholdPct) {
  const lines = [];
  lines.push("# Benchmark Regression Gate");
  lines.push("");
  lines.push(`Threshold: ${thresholdPct.toFixed(2)}pp`);
  lines.push("");
  lines.push("| Benchmark | Baseline | Current | Delta (pp) | Status |");
  lines.push("|---|---:|---:|---:|---|");
  for (const r of rows) {
    const b = r.baseline === null ? "—" : `${r.baseline.toFixed(2)}%`;
    const c = r.current === null ? "—" : `${r.current.toFixed(2)}%`;
    const d = r.deltaPct === null ? "—" : (r.deltaPct >= 0 ? "+" : "") + r.deltaPct.toFixed(2);
    lines.push(`| ${r.name} | ${b} | ${c} | ${d} | ${r.note} |`);
  }
  return lines.join("\n");
}

function runJsonMode(args) {
  if (!args.baseline || !args.current) {
    process.stderr.write("error: --baseline and --current both required for JSON mode\n");
    process.exit(2);
  }
  const baselineData = readJsonFile(args.baseline);
  const currentData = readJsonFile(args.current);
  if (baselineData === null) {
    process.stderr.write("[info] baseline missing; gate skipped (treating as first run)\n");
    process.exit(0);
  }
  if (currentData === null) {
    process.stderr.write("error: --current file is required and must parse\n");
    process.exit(2);
  }
  const baselineScores = extractScores(baselineData);
  const currentScores = extractScores(currentData);
  if (currentScores.size === 0) {
    process.stderr.write("error: current run produced no parseable scores\n");
    process.exit(2);
  }
  if (baselineScores.size === 0) {
    process.stderr.write("[info] baseline empty; gate skipped (no benchmarks to compare)\n");
    process.exit(0);
  }
  const rows = compareScores(baselineScores, currentScores, args.threshold);
  const regressions = rows.filter((r) => r.regressed);

  const md = renderMarkdownTable(rows, args.threshold);
  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          threshold: args.threshold,
          rows,
          regressions: regressions.map((r) => r.name),
          regressed: regressions.length > 0,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(md + "\n");
  }

  if (regressions.length > 0) {
    process.stderr.write(
      `[FAIL] ${regressions.length} regression(s) > ${args.threshold}pp: ${regressions.map((r) => r.name).join(", ")}\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`[ok] no regressions (${rows.length} benchmark(s) compared)\n`);
  process.exit(0);
}

// ── Entry point ──────────────────────────────────────────

function main() {
  const args = parseFlags(process.argv);
  if (args.doc) {
    runDocMode(args);
    return;
  }
  if (args.baseline && args.current) {
    runJsonMode(args);
    return;
  }
  process.stderr.write(
    "error: provide either --doc <path> (markdown mode) or --baseline + --current (json mode)\n",
  );
  process.exit(2);
}

main();

// Pure helpers exported for tests / external consumers.
export { extractScores, compareScores, renderMarkdownTable, toPct };
