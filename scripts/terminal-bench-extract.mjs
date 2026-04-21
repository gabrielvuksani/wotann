#!/usr/bin/env node
/**
 * TerminalBench task/results extractor.
 *
 * Two roles:
 *
 *   1. CORPUS EXTRACTOR (default). Walks a cloned TerminalBench repo
 *      (--src DIR) and produces a flat JSONL (one task per line) at
 *      --out PATH. Used by `scripts/download-terminal-bench-corpus.mjs`
 *      immediately after cloning.
 *
 *      The TerminalBench repo layout (as of v2.0 / Laude Institute):
 *        terminal-bench/
 *          tasks/
 *            <task-id>/
 *              task.yaml         — task metadata (id, prompt, difficulty)
 *              Dockerfile        — docker-image build context (optional)
 *              solution.sh       — grader command (optional)
 *              ...
 *      Each tasks/<task-id>/task.yaml becomes one JSONL line. The
 *      script is intentionally LIBERAL: a task dir without a
 *      parseable task.yaml is skipped with a warning rather than
 *      failing the whole run, so a single malformed task doesn't
 *      block 88 others.
 *
 *   2. RESULTS EXTRACTOR (when stdin piped). If stdin is piped with
 *      `tb run` stdout, this script extracts the JSON results blob and
 *      emits it to stdout as normalized JSON. Mirrors the in-process
 *      `parseTbStdout` function from terminal-bench.ts — useful when a
 *      user ran `tb run` manually and wants to ingest the output.
 *
 * Usage:
 *   # Corpus extraction:
 *   node scripts/terminal-bench-extract.mjs --src <clone> --out <jsonl>
 *
 *   # Results extraction (stdin piping):
 *   tb run ... | node scripts/terminal-bench-extract.mjs --results
 *
 *   # Dry-run (corpus): count tasks, don't write:
 *   node scripts/terminal-bench-extract.mjs --src <clone> --dry-run
 *
 * Exit codes:
 *   0 — success
 *   3 — extract failed (missing src, parse error, write failure, no tasks)
 *   4 — invalid flag or usage error
 *
 * No external npm deps, no subprocess dispatch — we only read files
 * and stdin. The minimal hand-rolled YAML-ish reader understands
 * only the keys TerminalBench actually emits (id, instruction,
 * difficulty, category, docker_image). If an upstream shape change
 * breaks this extractor we log the offending file and skip.
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { argv, stdin, stdout, stderr, exit } from "node:process";

// ── CLI parsing ───────────────────────────────────────

function parseArgs(args) {
  const opts = {
    src: null,
    out: null,
    dryRun: false,
    resultsMode: false,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--src" && i + 1 < args.length) {
      opts.src = args[++i];
    } else if (a === "--out" && i + 1 < args.length) {
      opts.out = args[++i];
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--results") {
      opts.resultsMode = true;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    } else if (a.startsWith("--src=")) {
      opts.src = a.slice("--src=".length);
    } else if (a.startsWith("--out=")) {
      opts.out = a.slice("--out=".length);
    } else {
      stderr.write(`Unknown flag: ${a}\n`);
      exit(4);
    }
  }
  return opts;
}

const USAGE = `
TerminalBench task/results extractor

Mode A (corpus):  Walk a cloned TerminalBench repo and write one JSONL
                  line per task.
Mode B (results): Read tb-run stdout on stdin; emit the JSON results
                  blob to stdout.

USAGE:
  node scripts/terminal-bench-extract.mjs --src <clone-dir> --out <jsonl>
  node scripts/terminal-bench-extract.mjs --results < tb-output.log

FLAGS:
  --src PATH     Path to cloned TerminalBench repo (mode A)
  --out PATH     Output JSONL path (mode A)
  --dry-run      Count tasks and print summary; do not write (mode A)
  --results      Read stdin, extract JSON results blob (mode B)
  -h, --help     Show this message

EXIT CODES:
  0 — success
  3 — extract failed
  4 — invalid flag
`.trimStart();

// ── Minimal YAML-ish reader ───────────────────────────

/**
 * Parse a tiny subset of YAML sufficient for TerminalBench task.yaml:
 *   - top-level `key: value` pairs (strings, quoted strings, numbers, booleans)
 *   - `|` / `>` folded block scalars (for multi-line instructions)
 *   - `#` line comments
 *
 * Returns a plain object. Unknown structures (lists-of-maps, nested
 * objects) are collapsed to raw strings to keep behavior predictable.
 */
function parseTinyYaml(text) {
  const out = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = (m[2] ?? "").trim();
    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      // Block scalar: capture indented lines.
      const blockLines = [];
      i++;
      while (i < lines.length) {
        const bl = lines[i] ?? "";
        if (bl.length > 0 && !/^\s/.test(bl)) break;
        blockLines.push(bl.replace(/^ {2,}/, ""));
        i++;
      }
      const joiner = rest.startsWith(">") ? " " : "\n";
      out[key] = blockLines.join(joiner).trim();
      continue;
    }
    let value = rest;
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === "true") out[key] = true;
    else if (value === "false") out[key] = false;
    else if (value === "null" || value === "~" || value === "") out[key] = null;
    else if (/^-?\d+$/.test(value)) out[key] = parseInt(value, 10);
    else if (/^-?\d+\.\d+$/.test(value)) out[key] = parseFloat(value);
    else out[key] = value;
    i++;
  }
  return out;
}

// ── Corpus mode ───────────────────────────────────────

/**
 * Walk `<src>/tasks/*` and emit a TerminalBench task object per task
 * that has a parseable task.yaml. Liberal on missing fields — a task
 * without a prompt is skipped with a warning.
 */
async function extractCorpus(srcDir) {
  const tasksDir = join(srcDir, "tasks");
  if (!existsSync(tasksDir)) {
    throw new Error(`expected tasks dir at ${tasksDir} (is this a TerminalBench clone?)`);
  }
  const entries = await readdir(tasksDir, { withFileTypes: true });
  const tasks = [];
  const warnings = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const taskDir = join(tasksDir, ent.name);
    const yamlPath = join(taskDir, "task.yaml");
    if (!existsSync(yamlPath)) {
      warnings.push(`${ent.name}: no task.yaml`);
      continue;
    }
    let parsed;
    try {
      const text = await readFile(yamlPath, "utf-8");
      parsed = parseTinyYaml(text);
    } catch (e) {
      warnings.push(`${ent.name}: parse failed — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // TerminalBench 2.0 uses `instruction` (primary prompt); older versions
    // used `prompt`. We accept either.
    const prompt =
      typeof parsed.instruction === "string"
        ? parsed.instruction
        : typeof parsed.prompt === "string"
          ? parsed.prompt
          : null;
    if (prompt === null || prompt.length === 0) {
      warnings.push(`${ent.name}: no instruction/prompt field`);
      continue;
    }
    const id = typeof parsed.id === "string" ? parsed.id : ent.name;
    const difficulty = typeof parsed.difficulty === "string" ? parsed.difficulty : undefined;
    const dockerImage =
      typeof parsed.docker_image === "string" ? parsed.docker_image : undefined;
    const graderCommand =
      typeof parsed.solution === "string"
        ? parsed.solution
        : typeof parsed.grader === "string"
          ? parsed.grader
          : undefined;
    const task = { id, prompt };
    if (difficulty !== undefined) task.difficulty = difficulty;
    if (dockerImage !== undefined) task.dockerImage = dockerImage;
    if (graderCommand !== undefined) task.graderCommand = graderCommand;
    tasks.push(task);
  }
  return { tasks, warnings };
}

// ── Results mode ──────────────────────────────────────

/**
 * Read stdin, find the last line that looks like a JSON object with a
 * `results` array, emit it to stdout. Mirrors parseTbStdout in
 * terminal-bench.ts so both callers use the same contract.
 */
async function extractResults() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  const text = buf.toString("utf-8");
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("{") && line.includes('"results"')) {
      try {
        const obj = JSON.parse(line);
        stdout.write(JSON.stringify(obj, null, 2) + "\n");
        return 0;
      } catch {
        stderr.write(`\nERROR: candidate line is not valid JSON: ${line.slice(0, 120)}\n`);
        return 3;
      }
    }
  }
  stderr.write(`\nERROR: no JSON results blob found on stdin\n`);
  return 3;
}

// ── Main ──────────────────────────────────────────────

async function main() {
  const opts = parseArgs(argv.slice(2));

  if (opts.help) {
    stdout.write(USAGE);
    exit(0);
  }

  if (opts.resultsMode) {
    const code = await extractResults();
    exit(code);
  }

  if (opts.src === null) {
    stderr.write(USAGE);
    stderr.write(`\nERROR: --src is required for corpus extraction\n`);
    exit(4);
  }

  const srcDir = resolve(opts.src);
  if (!existsSync(srcDir)) {
    stderr.write(`\nERROR: --src path does not exist: ${srcDir}\n`);
    exit(3);
  }
  const srcStat = await stat(srcDir);
  if (!srcStat.isDirectory()) {
    stderr.write(`\nERROR: --src is not a directory: ${srcDir}\n`);
    exit(3);
  }

  let result;
  try {
    result = await extractCorpus(srcDir);
  } catch (e) {
    stderr.write(`\nERROR: extract failed — ${e instanceof Error ? e.message : String(e)}\n`);
    exit(3);
  }

  stdout.write(`\nExtracted ${result.tasks.length} task(s).\n`);
  if (result.warnings.length > 0) {
    stdout.write(`Warnings (${result.warnings.length}):\n`);
    for (const w of result.warnings.slice(0, 10)) stdout.write(`  - ${w}\n`);
    if (result.warnings.length > 10) {
      stdout.write(`  ... and ${result.warnings.length - 10} more\n`);
    }
  }

  if (result.tasks.length === 0) {
    stderr.write(`\nERROR: zero tasks extracted — corpus is empty or shape has drifted\n`);
    exit(3);
  }

  if (opts.dryRun) {
    stdout.write(`\n[dry-run] Would write ${result.tasks.length} lines\n`);
    exit(0);
  }

  if (opts.out === null) {
    stderr.write(`\nERROR: --out is required (or pass --dry-run)\n`);
    exit(4);
  }

  const outPath = resolve(opts.out);
  const body = result.tasks.map((t) => JSON.stringify(t)).join("\n") + "\n";
  try {
    await writeFile(outPath, body, "utf-8");
  } catch (e) {
    stderr.write(`\nERROR: write failed — ${e instanceof Error ? e.message : String(e)}\n`);
    exit(3);
  }

  stdout.write(`\nOK: wrote ${body.length.toLocaleString()} bytes → ${outPath}\n`);
  exit(0);
}

main().catch((err) => {
  stderr.write(
    `\nFATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  exit(3);
});
