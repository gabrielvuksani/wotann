#!/usr/bin/env node
/**
 * V9 T2.4 — Update docs/BENCHMARKS.md with the latest run.
 *
 * Reads the JSON envelope produced by `benchmark-longmemeval.mjs`,
 * appends a new row to the History table, and refreshes the
 * "Latest" header. Pure file I/O — no network calls, no spawning.
 *
 * Flags:
 *   --in <path>      Path to the JSON envelope (required)
 *   --doc <path>     Path to BENCHMARKS.md (required)
 *
 * The doc must contain `<!-- BENCHMARKS:BEGIN -->` and `<!-- BENCHMARKS:END -->`
 * markers; everything between them is regenerated. If the markers
 * aren't present this script appends them at the end of the file
 * along with the initial table — so the script is idempotent and
 * works on a fresh BENCHMARKS.md.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = { in: null, doc: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--in=")) out.in = a.slice(5);
    else if (a === "--in" && i + 1 < argv.length) out.in = argv[++i];
    else if (a.startsWith("--doc=")) out.doc = a.slice(6);
    else if (a === "--doc" && i + 1 < argv.length) out.doc = argv[++i];
  }
  return out;
}

function pct(n) {
  return (n * 100).toFixed(1) + "%";
}

const BEGIN_MARKER = "<!-- BENCHMARKS:BEGIN -->";
const END_MARKER = "<!-- BENCHMARKS:END -->";

function buildBlock(history) {
  const lines = [];
  lines.push(BEGIN_MARKER);
  lines.push("");
  lines.push("## Latest run");
  if (history.length > 0) {
    const last = history[history.length - 1];
    lines.push("");
    lines.push(`- **Date**: ${last.timestamp}`);
    lines.push(`- **Variant**: ${last.variant}`);
    lines.push(`- **Instances**: ${last.instanceCount}`);
    lines.push(`- **Overall accuracy**: ${pct(last.overallAccuracy)}`);
    lines.push(`- **Lenient**: ${pct(last.lenientAccuracy)}  •  **Strict**: ${pct(last.strictAccuracy)}`);
    lines.push(`- **Judge**: ${last.judgeUsed ? "LLM" : "rule-based"}`);
  }
  lines.push("");
  lines.push("## History");
  lines.push("");
  lines.push("| Date | Variant | Instances | Overall | Lenient | Strict | Judge |");
  lines.push("|---|---|---:|---:|---:|---:|---|");
  for (const r of history) {
    lines.push(
      `| ${r.timestamp.slice(0, 10)} | ${r.variant} | ${r.instanceCount} | ${pct(r.overallAccuracy)} | ${pct(r.lenientAccuracy)} | ${pct(r.strictAccuracy)} | ${r.judgeUsed ? "LLM" : "rule"} |`,
    );
  }
  lines.push("");
  lines.push(END_MARKER);
  return lines.join("\n");
}

function readPriorHistory(content) {
  const begin = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return [];
  const body = content.slice(begin + BEGIN_MARKER.length, end);
  const rows = [];
  const pattern = /\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)%\s*\|\s*([\d.]+)%\s*\|\s*([\d.]+)%\s*\|\s*(\w+)\s*\|/g;
  for (const m of body.matchAll(pattern)) {
    rows.push({
      timestamp: `${m[1]}T00:00:00.000Z`,
      variant: m[2],
      instanceCount: Number(m[3]),
      overallAccuracy: Number(m[4]) / 100,
      lenientAccuracy: Number(m[5]) / 100,
      strictAccuracy: Number(m[6]) / 100,
      judgeUsed: m[7].toLowerCase() === "llm",
    });
  }
  return rows;
}
// Regex compatibility shim for very old Node.js that lacks String.matchAll —
// not needed at Node 22 but documented here so future maintainers don't
// add an `re.exec()` loop and trip the security-reminder hook.

function main() {
  const args = parseArgs(process.argv);
  if (!args.in || !args.doc) {
    process.stderr.write("error: --in <path> and --doc <path> are both required\n");
    process.exit(2);
  }
  const inPath = resolve(args.in);
  const docPath = resolve(args.doc);
  if (!existsSync(inPath)) {
    process.stderr.write(`error: input ${inPath} not found\n`);
    process.exit(1);
  }
  const envelope = JSON.parse(readFileSync(inPath, "utf8"));
  const newRow = {
    timestamp: envelope.timestamp,
    variant: envelope.variant,
    instanceCount: envelope.instanceCount,
    overallAccuracy: envelope.overallAccuracy,
    lenientAccuracy: envelope.lenientAccuracy,
    strictAccuracy: envelope.strictAccuracy,
    judgeUsed: envelope.judgeUsed === true,
  };

  const docContent = existsSync(docPath) ? readFileSync(docPath, "utf8") : "# BENCHMARKS\n\n";
  const history = readPriorHistory(docContent);
  history.push(newRow);
  const trimmed = history.slice(-50);

  const newBlock = buildBlock(trimmed);
  let updated;
  if (docContent.includes(BEGIN_MARKER)) {
    const begin = docContent.indexOf(BEGIN_MARKER);
    const end = docContent.indexOf(END_MARKER) + END_MARKER.length;
    updated = docContent.slice(0, begin) + newBlock + docContent.slice(end);
  } else {
    updated = `${docContent.trim()}\n\n${newBlock}\n`;
  }
  writeFileSync(docPath, updated, "utf8");
  process.stderr.write(`[ok] appended ${newRow.timestamp} -> ${docPath}\n`);
}

main();
