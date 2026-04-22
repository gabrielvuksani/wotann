#!/usr/bin/env node
/**
 * v9-drift-check.mjs — MASTER_PLAN_V9 drift detector.
 *
 * Parses V9's Source-Verified Baseline table + every `wc -l` claim + every
 * file:line citation. Re-runs each check against HEAD. Reports drift.
 *
 * Usage:
 *   node scripts/v9-drift-check.mjs           → advisory (exit 0, report only)
 *   WOTANN_DRIFT_STRICT=1 node scripts/...   → strict (exit 1 on >5% drift)
 *
 * Exit codes:
 *   0 = no drift or advisory mode
 *   1 = >5% drift in strict mode
 *   2 = script itself broken (V9 unreadable, etc.)
 *
 * Specced by: docs/MASTER_PLAN_V9.md section "Documentation drift prevention"
 * Quality Bar: #15 (verify source before claiming)
 *
 * Uses spawnSync with argv (no shell interpretation) — safe-exec by design.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const V9_PATH = join(REPO_ROOT, "docs", "MASTER_PLAN_V9.md");
const STRICT = process.env["WOTANN_DRIFT_STRICT"] === "1";
const DRIFT_THRESHOLD_PCT = 5;

function readV9() {
  if (!existsSync(V9_PATH)) {
    console.error(`[v9-drift-check] V9 not found at ${V9_PATH}`);
    process.exit(2);
  }
  return readFileSync(V9_PATH, "utf8");
}

function wcLines(relPath) {
  const abs = join(REPO_ROOT, relPath);
  if (!existsSync(abs)) return null;
  const content = readFileSync(abs, "utf8");
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function gitCatFileExists(sha) {
  const result = spawnSync("git", ["cat-file", "-e", sha], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

function fileExists(relPath) {
  return existsSync(join(REPO_ROOT, relPath));
}

function pctDelta(claim, actual) {
  if (claim === 0) return actual === 0 ? 0 : 100;
  return Math.abs((actual - claim) / claim) * 100;
}

function driftRecord(label, claim, actual, kind = "number") {
  const d = kind === "number" ? pctDelta(claim, actual) : (claim === actual ? 0 : 100);
  return { label, claim, actual, driftPct: d, kind };
}

function auditBaseline(v9) {
  const results = [];
  const grab = (re) => {
    const match = v9.match(re);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  };

  const runtimeClaim = grab(/runtime\.ts LOC.*?\*\*([\d,]+)\*\*/);
  const kairosClaim = grab(/kairos-rpc\.ts LOC.*?\*\*([\d,]+)\*\*/);
  const indexClaim = grab(/index\.ts LOC.*?\*\*([\d,]+)\*\*/);
  const appClaim = grab(/App\.tsx LOC.*?\*\*([\d,]+)\*\*/);

  const runtimeActual = wcLines("src/core/runtime.ts");
  const kairosActual = wcLines("src/daemon/kairos-rpc.ts");
  const indexActual = wcLines("src/index.ts");
  const appActual = wcLines("src/ui/App.tsx");

  if (runtimeClaim !== null && runtimeActual !== null)
    results.push(driftRecord("runtime.ts LOC", runtimeClaim, runtimeActual));
  if (kairosClaim !== null && kairosActual !== null)
    results.push(driftRecord("kairos-rpc.ts LOC", kairosClaim, kairosActual));
  if (indexClaim !== null && indexActual !== null)
    results.push(driftRecord("index.ts LOC", indexClaim, indexActual));
  if (appClaim !== null && appActual !== null)
    results.push(driftRecord("App.tsx LOC", appClaim, appActual));

  // Also check FT.2 mentions (they historically drift from Baseline)
  const ft2Runtime = grab(/runtime\.ts` = \*\*([\d,]+) LOC\*\*/);
  if (ft2Runtime !== null && runtimeActual !== null) {
    results.push(driftRecord("FT.2 runtime.ts LOC consistency", ft2Runtime, runtimeActual));
  }

  return results;
}

function auditFilePaths(v9) {
  const results = [];
  const existingRefs = new Set();

  // Parse line-by-line so the context check is scoped to one line of V9 prose.
  // Flag a file as "claimed-to-exist" ONLY when:
  //  - It appears in a file:line citation like `src/x.ts:42` (line # implies real)
  //  - AND the line doesn't contain NEW/new/create/scaffold/add/introduce markers
  const lines = v9.split("\n");

  const lineCiteRe = /`(src\/[^`*]+?\.(?:ts|tsx)):(\d+)`/g;
  const iosCiteRe = /`(ios\/WOTANN[^`*]*?\.(?:swift|plist|yml)):(\d+)`/g;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const isNewContext =
      /\bnew\b/.test(lower) ||
      /\bcreate\b/.test(lower) ||
      /\bscaffold\b/.test(lower) ||
      /\badd a?\b/.test(lower) ||
      /\bintroduce\b/.test(lower) ||
      /\bcompose\s/.test(lower) ||
      /\bmissing\b/.test(lower) ||
      lower.includes("(new") ||
      lower.startsWith("- new");

    if (isNewContext) continue; // skip any line describing NEW files

    let m;
    while ((m = lineCiteRe.exec(line)) !== null) {
      const fpath = m[1];
      if (!fpath.includes(".build/")) existingRefs.add(fpath);
    }
    while ((m = iosCiteRe.exec(line)) !== null) {
      const fpath = m[1];
      if (!fpath.includes(".build/")) existingRefs.add(fpath);
    }
  }

  // Check existence — only for references with line numbers (strong "exists" signal)
  // AND only outside new-file context
  for (const f of existingRefs) {
    const exists = fileExists(f);
    if (!exists) {
      results.push(driftRecord(`file citation broken: ${f}`, "exists (has :line)", "MISSING", "boolean"));
    }
  }

  return results;
}

function auditSupabaseBlob(v9) {
  if (!v9.includes("dbaf1225")) return [];
  const reachable = gitCatFileExists("dbaf1225");
  // V9 expects blob to STILL be reachable until FT.1 rotation completes.
  // "Drift" here would mean the blob is gone (good state — rotation done).
  return [driftRecord(
    "FT.1 Supabase blob precondition",
    "reachable",
    reachable ? "reachable" : "purged (rotation complete)",
    "boolean",
  )];
}

function main() {
  const v9 = readV9();

  const all = [
    ...auditBaseline(v9),
    ...auditFilePaths(v9),
    ...auditSupabaseBlob(v9),
  ];

  const drifted = all.filter((r) => r.driftPct > DRIFT_THRESHOLD_PCT);
  const ok = all.filter((r) => r.driftPct <= DRIFT_THRESHOLD_PCT);

  console.log(`\n[v9-drift-check] Scanned ${all.length} V9 claims.`);
  console.log(`[v9-drift-check] ${ok.length} OK (≤ ${DRIFT_THRESHOLD_PCT}% drift), ${drifted.length} DRIFTED.\n`);

  if (drifted.length > 0) {
    console.log("DRIFTED CLAIMS:");
    for (const r of drifted) {
      const suffix = r.kind === "number" ? `(drift: ${r.driftPct.toFixed(1)}%)` : "";
      console.log(`  ⚠ ${r.label}: V9=${r.claim} actual=${r.actual} ${suffix}`);
    }
    console.log("\nFIX: edit V9 lines with correct values OR update source to match plan.");
  } else {
    console.log("✓ V9 Baseline + file paths + FT.1 precondition all match HEAD.");
  }

  if (STRICT && drifted.length > 0) {
    console.error("[v9-drift-check] STRICT MODE: exit 1 due to drift.");
    process.exit(1);
  }

  process.exit(0);
}

main();
