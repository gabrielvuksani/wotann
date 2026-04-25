#!/usr/bin/env node
/**
 * V9 T12.15 — G-Eval runner.
 *
 * Loads test cases from a JSON file, calls the LLM judge from
 * `src/evals/g-eval.ts`, and writes a per-case score report to disk.
 *
 * Usage:
 *   node scripts/run-g-eval.mjs --cases tests/evals/geval-cases.json \
 *        --out bench-results/geval-<run-id>.json [--target-model name]
 *
 * Honest stubs: when the cases file is missing, we exit 0 with an
 * `{ ok: false, reason }` JSON written to stdout — never silently
 * succeed (QB #6).
 *
 * No npm deps. Pure node:* + dynamic import of the TS module via
 * file URL (consumer runs via tsx for dev or against built dist/ in CI).
 *
 * Cases JSON shape:
 *   {
 *     "rubric": {
 *       "criteria": [
 *         { "name": "coherence", "description": "...", "scoreScale": 5 }
 *       ],
 *       "aggregator": "mean"
 *     },
 *     "cases": [
 *       { "id": "c1", "candidate": "answer text", "reference": "gold", "source": "..." }
 *     ]
 *   }
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

function parseFlags(argv) {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      cases: { type: "string" },
      out: { type: "string" },
      "target-model": { type: "string" },
      "target-name": { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });
  return {
    cases: typeof values["cases"] === "string" ? values["cases"] : null,
    out: typeof values["out"] === "string" ? values["out"] : null,
    targetModel:
      typeof values["target-model"] === "string"
        ? values["target-model"]
        : typeof values["target-name"] === "string"
          ? values["target-name"]
          : null,
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
 * Honest stub LLM judge — returns abstention if no real judge is wired.
 * The runner uses this when WOTANN_GEVAL_JUDGE is not set up; the
 * report's `ok: false` flag flags that the run was a stub.
 */
function makeStubJudge(reason) {
  return {
    name: "stub-judge",
    query: async () => `cannot judge: ${reason}\nSCORE: 1`,
  };
}

async function loadGEvalModule() {
  const url = pathToFileURL(resolve(REPO_ROOT, "src/evals/g-eval.ts")).href;
  try {
    return await import(url);
  } catch {
    return null;
  }
}

function validateCasesJson(raw) {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "cases JSON must be an object" };
  }
  const obj = raw;
  if (typeof obj.rubric !== "object" || obj.rubric === null) {
    return { ok: false, reason: "missing 'rubric' object" };
  }
  if (!Array.isArray(obj.rubric.criteria) || obj.rubric.criteria.length === 0) {
    return { ok: false, reason: "rubric.criteria must be a non-empty array" };
  }
  if (!Array.isArray(obj.cases) || obj.cases.length === 0) {
    return { ok: false, reason: "'cases' must be a non-empty array" };
  }
  return { ok: true };
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
      cases: [],
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

  const validation = validateCasesJson(raw);
  if (!validation.ok) {
    const stub = {
      ok: false,
      reason: validation.reason,
      cases: [],
      ranAt: new Date().toISOString(),
    };
    writeReport(resolve(args.out), stub);
    process.stdout.write(JSON.stringify(stub) + "\n");
    process.exit(0);
  }

  const mod = await loadGEvalModule();
  if (!mod || typeof mod.runGEval !== "function") {
    const stub = {
      ok: false,
      reason:
        "could not load src/evals/g-eval.ts — run via tsx for dev, or against built dist/ in CI",
      cases: [],
      ranAt: new Date().toISOString(),
    };
    writeReport(resolve(args.out), stub);
    process.stdout.write(JSON.stringify(stub) + "\n");
    process.exit(0);
  }

  // For now we ship a stub judge; production swaps this for the
  // configured provider. This is honest per QB #6 — the report's
  // `ok` flag clearly says the run used a stub.
  const judge = makeStubJudge("no real judge wired (stub mode)");

  const perCase = [];
  for (const c of raw.cases) {
    if (typeof c !== "object" || c === null) continue;
    if (typeof c.candidate !== "string") continue;
    const req = {
      rubric: raw.rubric,
      candidate: c.candidate,
      ...(typeof c.reference === "string" ? { reference: c.reference } : {}),
      ...(typeof c.source === "string" ? { source: c.source } : {}),
    };
    try {
      const result = await mod.runGEval(req, judge);
      perCase.push({
        id: typeof c.id === "string" ? c.id : `case-${perCase.length}`,
        aggregate: result.aggregate,
        abstentions: result.abstentions,
        callsMade: result.callsMade,
        scores: result.scores,
      });
    } catch (err) {
      perCase.push({
        id: typeof c.id === "string" ? c.id : `case-${perCase.length}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const report = {
    ok: true,
    judgeName: judge.name,
    targetModel: args.targetModel ?? null,
    casesPath,
    ranAt: new Date().toISOString(),
    totalCases: perCase.length,
    cases: perCase,
    note:
      "stub-judge mode — every score reflects a hardcoded fallback. Wire a real EvalLlm to get production scores.",
  };
  writeReport(resolve(args.out), report);
  process.stdout.write(`wrote ${args.out}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
