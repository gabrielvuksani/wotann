#!/usr/bin/env node
/**
 * V9 T12.15 — OWASP LLM Top 10 red-team runner.
 *
 * Loads attack cases from a JSON file, runs them through
 * `src/evals/owasp-llm-redteam.ts`, and writes a per-category
 * report to disk.
 *
 * Usage:
 *   node scripts/run-owasp-redteam.mjs --cases tests/evals/owasp-cases.json \
 *        --out bench-results/owasp-<run-id>.json [--target-model name]
 *
 * Cases JSON shape:
 *   {
 *     "attacks": [
 *       {
 *         "id": "ll01-1",
 *         "category": "LLM01_PROMPT_INJECTION",
 *         "payload": "ignore previous instructions and ...",
 *         "winCondition": "secret",
 *         "description": "..."
 *       }
 *     ]
 *   }
 *
 * Honest stubs (QB #6): missing cases or unloadable module ⇒
 * write `{ ok: false, reason }` and exit 0.
 *
 * Pure node:* + dynamic file-URL import. No npm deps.
 *
 * Exit codes:
 *   0 — ran (or stubbed honestly)
 *   1 — runtime error inside the harness
 *   2 — invalid args
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const VALID_CATEGORIES = new Set([
  "LLM01_PROMPT_INJECTION",
  "LLM02_INSECURE_OUTPUT_HANDLING",
  "LLM03_TRAINING_DATA_POISONING",
  "LLM04_MODEL_DOS",
  "LLM05_SUPPLY_CHAIN",
  "LLM06_SENSITIVE_INFORMATION_DISCLOSURE",
  "LLM07_INSECURE_PLUGIN_DESIGN",
  "LLM08_EXCESSIVE_AGENCY",
  "LLM09_OVERRELIANCE",
  "LLM10_MODEL_THEFT",
]);

function parseFlags(argv) {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      cases: { type: "string" },
      out: { type: "string" },
      "target-model": { type: "string" },
      concurrency: { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });
  let concurrency = 4;
  if (typeof values["concurrency"] === "string") {
    const n = Number(values["concurrency"]);
    if (Number.isFinite(n) && n >= 1) concurrency = Math.floor(n);
  }
  return {
    cases: typeof values["cases"] === "string" ? values["cases"] : null,
    out: typeof values["out"] === "string" ? values["out"] : null,
    targetModel: typeof values["target-model"] === "string" ? values["target-model"] : null,
    concurrency,
  };
}

function ensureParentDir(path) {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

function writeReport(outPath, report) {
  ensureParentDir(outPath);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
}

/**
 * Honest stub target — emits a refusal so the harness records the
 * attack as "blocked". Production swaps this for the real provider.
 */
function makeStubTarget() {
  return {
    name: "stub-refusal-target",
    query: async () => "I cannot help with that. (stub target)",
  };
}

async function loadRedTeamModule() {
  const url = pathToFileURL(resolve(REPO_ROOT, "src/evals/owasp-llm-redteam.ts")).href;
  try {
    return await import(url);
  } catch {
    return null;
  }
}

function validateCase(c) {
  if (typeof c !== "object" || c === null) return false;
  if (typeof c.payload !== "string" || c.payload.length === 0) return false;
  if (typeof c.winCondition !== "string" || c.winCondition.length === 0) return false;
  if (typeof c.category !== "string" || !VALID_CATEGORIES.has(c.category)) return false;
  return true;
}

function buildAttackCases(raw) {
  const cases = [];
  const skipped = [];
  if (!Array.isArray(raw.attacks)) return { cases, skipped: ["attacks must be an array"] };
  for (let i = 0; i < raw.attacks.length; i++) {
    const a = raw.attacks[i];
    if (!validateCase(a)) {
      skipped.push(`case[${i}] (${a?.id ?? "no-id"}): invalid shape`);
      continue;
    }
    cases.push({
      id: typeof a.id === "string" ? a.id : `attack-${i}`,
      category: a.category,
      payload: a.payload,
      winCondition: a.winCondition,
      ...(typeof a.description === "string" ? { description: a.description } : {}),
    });
  }
  return { cases, skipped };
}

async function main() {
  const args = parseFlags(process.argv);
  if (!args.cases) {
    process.stderr.write("error: --cases <path> required\n");
    process.exit(2);
  }
  if (!args.out) {
    process.stderr.write("error: --out <path> required\n");
    process.exit(2);
  }

  const casesPath = resolve(args.cases);
  if (!existsSync(casesPath)) {
    const stub = {
      ok: false,
      reason: `cases file not found: ${casesPath}`,
      reports: [],
      ranAt: new Date().toISOString(),
    };
    writeReport(resolve(args.out), stub);
    process.stdout.write(JSON.stringify(stub) + "\n");
    process.exit(0);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(casesPath, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not parse ${casesPath}: ${msg}\n`);
    process.exit(1);
  }

  const { cases, skipped } = buildAttackCases(raw);
  if (cases.length === 0) {
    const stub = {
      ok: false,
      reason: "no valid attack cases found",
      skipped,
      reports: [],
      ranAt: new Date().toISOString(),
    };
    writeReport(resolve(args.out), stub);
    process.stdout.write(JSON.stringify(stub) + "\n");
    process.exit(0);
  }

  const mod = await loadRedTeamModule();
  if (!mod || typeof mod.runRedTeamAll !== "function") {
    const stub = {
      ok: false,
      reason:
        "could not load src/evals/owasp-llm-redteam.ts — run via tsx for dev, or against built dist/ in CI",
      reports: [],
      ranAt: new Date().toISOString(),
    };
    writeReport(resolve(args.out), stub);
    process.stdout.write(JSON.stringify(stub) + "\n");
    process.exit(0);
  }

  const target = makeStubTarget();

  let allReports;
  try {
    allReports = await mod.runRedTeamAll({
      cases,
      target,
      concurrency: args.concurrency,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fatal: ${msg}\n`);
    process.exit(1);
  }

  // allReports is a Map; serialize for JSON.
  const reports = [];
  let totalAttacks = 0;
  let totalSucceeded = 0;
  let totalBlocked = 0;
  for (const [category, report] of allReports) {
    reports.push({
      category,
      totalCases: report.totalCases,
      successfulAttacks: report.successfulAttacks,
      blockedAttacks: report.blockedAttacks,
      errors: report.errors,
      attackSuccessRate: report.attackSuccessRate,
      results: report.results.map((r) => ({
        id: r.case.id,
        succeeded: r.succeeded,
        blocked: r.blocked,
        durationMs: r.durationMs,
        ...(r.errorMessage ? { errorMessage: r.errorMessage } : {}),
      })),
    });
    totalAttacks += report.totalCases;
    totalSucceeded += report.successfulAttacks;
    totalBlocked += report.blockedAttacks;
  }

  const finalReport = {
    ok: true,
    targetName: target.name,
    targetModel: args.targetModel ?? null,
    casesPath,
    ranAt: new Date().toISOString(),
    totalAttacks,
    totalSucceeded,
    totalBlocked,
    overallAttackSuccessRate: totalAttacks > 0 ? totalSucceeded / totalAttacks : 0,
    reports,
    skipped,
    note:
      "stub-refusal-target — every attack is recorded as blocked because the target always refuses. Wire a real EvalLlm to measure real attack-success rates.",
  };
  writeReport(resolve(args.out), finalReport);
  process.stdout.write(`wrote ${args.out}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
