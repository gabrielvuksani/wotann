#!/usr/bin/env node
/**
 * runtime-lane6-audit.mjs — V9 Tier 14.5.
 *
 * Runtime output verifier. Answers the simple question: is WOTANN
 * actually producing the state it claims to be producing, session
 * over session? Every check compares a "before" snapshot against an
 * "after" snapshot of the runtime-owned files that prior sessions
 * have silently failed to populate.
 *
 * Specific Lane-6 checks (from V9 T14.5):
 *   1. `memory_entries` table fills in fresh sessions (not just
 *      `auto_capture`)
 *   2. `token-stats.json` non-zero after each session
 *   3. `knowledge-graph.json` populates when autoPopulateKG=1
 *   4. Dreams process actual entries (not zero every run)
 *   5. USER.md learns across sessions (not template)
 *   6. session_start / session_end ratio reasonable (not 1:600)
 *
 * Usage:
 *   node scripts/runtime-lane6-audit.mjs snapshot --tag=before
 *   # ... run one or more WOTANN sessions ...
 *   node scripts/runtime-lane6-audit.mjs snapshot --tag=after
 *   node scripts/runtime-lane6-audit.mjs compare --before=before --after=after
 *
 * Snapshots land in .wotann/audits/<tag>.json so they survive
 * across shell sessions. `compare` outputs a structured finding per
 * check + a final verdict (PASS / WARN / FAIL).
 *
 * No external deps — node stdlib only.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const WOTANN_DIR = join(REPO_ROOT, ".wotann");
const AUDIT_DIR = join(WOTANN_DIR, "audits");

// ── Helpers ───────────────────────────────────────────────────────────────

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function safeReadText(path) {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function safeStat(path) {
  try {
    return existsSync(path) ? statSync(path) : null;
  } catch {
    return null;
  }
}

function safeCountSqliteRows(dbPath, table) {
  // Node stdlib only — no better-sqlite3. Use the sqlite3 CLI if present.
  // If not present, return null and let the caller treat it as "unknown".
  try {
    const { spawnSync } = require("node:child_process");
    const res = spawnSync("sqlite3", [dbPath, `SELECT COUNT(*) FROM ${table};`], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (res.status !== 0) return null;
    const n = Number(res.stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Node's ESM doesn't give us `require` by default — synthesize it for the
// single SQLite fallback above. Use createRequire.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Snapshotter ───────────────────────────────────────────────────────────

function takeSnapshot() {
  const memoryDb = join(WOTANN_DIR, "memory.db");
  const tokenStats = join(WOTANN_DIR, "token-stats.json");
  const kgJson = join(WOTANN_DIR, "knowledge-graph.json");
  const userMd = join(WOTANN_DIR, "USER.md");
  const sessionsDir = join(WOTANN_DIR, "sessions");
  const dreamsLog = join(WOTANN_DIR, "dreams.log");

  // Count session_start vs session_end markers if a sessions/ directory
  // exists. Each file in sessions/ is treated as one session.
  let sessionFiles = 0;
  let sessionEnds = 0;
  if (existsSync(sessionsDir)) {
    try {
      for (const name of readdirSync(sessionsDir)) {
        const full = join(sessionsDir, name);
        const st = safeStat(full);
        if (!st || !st.isFile()) continue;
        sessionFiles++;
        const txt = safeReadText(full);
        if (txt && /"type"\s*:\s*"session_end"/.test(txt)) sessionEnds++;
      }
    } catch {
      // ignore
    }
  }

  // Token stats — either JSON with a `totalTokens`-like field or raw
  // per-session rows. We don't prescribe the shape; we just grab the
  // file size + any numeric-looking total at the top.
  const tokenStatsParsed = safeReadJson(tokenStats);
  const tokenStatsTotal =
    tokenStatsParsed && typeof tokenStatsParsed === "object"
      ? Number(
          tokenStatsParsed.totalTokens ??
            tokenStatsParsed.total_tokens ??
            tokenStatsParsed.total ??
            0,
        ) || 0
      : 0;

  // Knowledge graph — count top-level nodes/edges if possible.
  const kgParsed = safeReadJson(kgJson);
  const kgNodes =
    kgParsed && typeof kgParsed === "object" && Array.isArray(kgParsed.nodes)
      ? kgParsed.nodes.length
      : 0;
  const kgEdges =
    kgParsed && typeof kgParsed === "object" && Array.isArray(kgParsed.edges)
      ? kgParsed.edges.length
      : 0;

  // USER.md heuristic — if it's the shipped template, a simple
  // character-count + landmark-string match will stay stable over
  // time. We don't need to classify "learned"; we need to know if
  // the content changed between snapshots.
  const userMdText = safeReadText(userMd) ?? "";
  const userMdHash = simpleHash(userMdText);

  // Dream processor — we don't have a canonical output file, so we
  // infer from dreams.log when it exists. Count non-empty lines.
  const dreamsText = safeReadText(dreamsLog) ?? "";
  const dreamsLines = dreamsText
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0).length;

  // Memory entries — try sqlite3 CLI; fall back to db file size as a
  // very rough "growing" signal.
  const memoryEntriesCount = safeCountSqliteRows(memoryDb, "memory_entries");
  const autoCaptureCount = safeCountSqliteRows(memoryDb, "auto_capture");
  const memoryDbSize = safeStat(memoryDb)?.size ?? 0;

  return {
    capturedAt: new Date().toISOString(),
    memoryEntriesCount,
    autoCaptureCount,
    memoryDbSize,
    tokenStatsTotal,
    tokenStatsSize: safeStat(tokenStats)?.size ?? 0,
    kgNodes,
    kgEdges,
    kgSize: safeStat(kgJson)?.size ?? 0,
    userMdHash,
    userMdSize: userMdText.length,
    dreamsLines,
    sessionFiles,
    sessionEnds,
  };
}

function simpleHash(text) {
  // 32-bit FNV-1a — collision chance irrelevant at audit scale; all
  // we care about is "did the content change between snapshots".
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ── Comparator ────────────────────────────────────────────────────────────

function compareSnapshots(before, after) {
  const findings = [];

  // Check 1 — memory_entries fills (not just auto_capture)
  if (after.memoryEntriesCount !== null && before.memoryEntriesCount !== null) {
    const delta = after.memoryEntriesCount - before.memoryEntriesCount;
    findings.push({
      id: "check-1",
      label: "memory_entries growth (promoted memories)",
      status: delta > 0 ? "PASS" : "FAIL",
      detail: `Δ = ${delta} rows`,
      reason:
        delta > 0
          ? undefined
          : "memory_entries did not grow. Only auto_capture promoted? Check promotion pipeline.",
    });
  } else {
    findings.push({
      id: "check-1",
      label: "memory_entries growth",
      status: "SKIP",
      detail: "sqlite3 CLI unavailable or DB missing; using db size instead",
      reason: `db size Δ = ${after.memoryDbSize - before.memoryDbSize} bytes`,
    });
  }

  // Check 2 — token-stats.json non-zero
  findings.push({
    id: "check-2",
    label: "token-stats.json non-zero",
    status:
      after.tokenStatsTotal > 0
        ? "PASS"
        : after.tokenStatsSize > 0
          ? "WARN"
          : "FAIL",
    detail: `total=${after.tokenStatsTotal}, size=${after.tokenStatsSize}`,
    reason:
      after.tokenStatsTotal > 0
        ? undefined
        : "Token accounting is 0 after the session(s). Likely the same input=0 regression seen in 812 sessions.",
  });

  // Check 3 — knowledge-graph.json populates
  const kgGrew = after.kgNodes > before.kgNodes || after.kgEdges > before.kgEdges;
  findings.push({
    id: "check-3",
    label: "knowledge-graph.json populates (autoPopulateKG)",
    status: after.kgNodes > 0 ? "PASS" : kgGrew ? "WARN" : "FAIL",
    detail: `nodes ${before.kgNodes}→${after.kgNodes}, edges ${before.kgEdges}→${after.kgEdges}`,
    reason:
      after.kgNodes > 0
        ? undefined
        : "KG has 0 nodes. Either autoPopulateKG=0 or the builder never fires.",
  });

  // Check 4 — Dreams process entries (not zero every run)
  const dreamsDelta = after.dreamsLines - before.dreamsLines;
  findings.push({
    id: "check-4",
    label: "dreams process entries (non-zero)",
    status: dreamsDelta > 0 ? "PASS" : "FAIL",
    detail: `dreams.log lines Δ = ${dreamsDelta}`,
    reason:
      dreamsDelta > 0
        ? undefined
        : "No new dream entries. Dream runner either didn't fire or produced zero entries.",
  });

  // Check 5 — USER.md learns across sessions (not template)
  const userChanged = before.userMdHash !== after.userMdHash;
  findings.push({
    id: "check-5",
    label: "USER.md learns (content changed)",
    status: userChanged ? "PASS" : "WARN",
    detail: `hash ${before.userMdHash}→${after.userMdHash}, size ${before.userMdSize}→${after.userMdSize}`,
    reason: userChanged
      ? undefined
      : "USER.md byte-identical across snapshots. Either nothing was learned or writer never fired.",
  });

  // Check 6 — session_start / session_end ratio reasonable
  const sessionDelta = after.sessionFiles - before.sessionFiles;
  const endDelta = after.sessionEnds - before.sessionEnds;
  const ratio = sessionDelta > 0 ? endDelta / sessionDelta : null;
  findings.push({
    id: "check-6",
    label: "session_start / session_end ratio sane",
    status:
      sessionDelta === 0
        ? "SKIP"
        : ratio !== null && ratio >= 0.5
          ? "PASS"
          : "FAIL",
    detail: `Δ sessions=${sessionDelta}, Δ session_end=${endDelta}, ratio=${ratio?.toFixed(2) ?? "n/a"}`,
    reason:
      ratio !== null && ratio < 0.5
        ? `end/start ratio ${ratio.toFixed(2)} suggests session_end markers are missing.`
        : undefined,
  });

  // Overall verdict
  const anyFail = findings.some((f) => f.status === "FAIL");
  const anyWarn = findings.some((f) => f.status === "WARN");
  const verdict = anyFail ? "FAIL" : anyWarn ? "WARN" : "PASS";

  return { verdict, findings };
}

// ── CLI dispatch ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k] = v ?? true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function usage() {
  return [
    "usage:",
    "  node scripts/runtime-lane6-audit.mjs snapshot --tag=<name>",
    "  node scripts/runtime-lane6-audit.mjs compare --before=<tag> --after=<tag>",
    "",
    "Snapshots land in .wotann/audits/<tag>.json.",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });

  if (cmd === "snapshot") {
    const tag = args.tag;
    if (!tag || typeof tag !== "string") {
      console.error("error: --tag=<name> is required for snapshot");
      console.error(usage());
      process.exit(2);
    }
    const snap = takeSnapshot();
    const out = join(AUDIT_DIR, `${tag}.json`);
    writeFileSync(out, JSON.stringify(snap, null, 2), "utf-8");
    console.log(`wrote ${out}`);
    return;
  }

  if (cmd === "compare") {
    const beforeTag = args.before;
    const afterTag = args.after;
    if (!beforeTag || !afterTag) {
      console.error("error: --before=<tag> and --after=<tag> are both required");
      console.error(usage());
      process.exit(2);
    }
    const before = safeReadJson(join(AUDIT_DIR, `${beforeTag}.json`));
    const after = safeReadJson(join(AUDIT_DIR, `${afterTag}.json`));
    if (!before || !after) {
      console.error(
        `error: could not read snapshot files (.wotann/audits/${beforeTag}.json or .../${afterTag}.json)`,
      );
      process.exit(2);
    }
    const report = compareSnapshots(before, after);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.verdict === "FAIL" ? 1 : 0);
  }

  console.error(usage());
  process.exit(2);
}

// Only run main() when invoked directly — allow tests to import the
// pure helpers without triggering the CLI.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  main();
}

export {
  takeSnapshot,
  compareSnapshots,
  simpleHash,
};
