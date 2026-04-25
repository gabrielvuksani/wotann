#!/usr/bin/env node
/**
 * V9 T12.15 — Ragas runner.
 *
 * Loads RAG test cases from a JSON file, calls the metric harness from
 * `src/evals/ragas-metrics.ts`, and writes per-case scores to disk.
 *
 * Usage:
 *   node scripts/run-ragas.mjs --cases tests/evals/ragas-cases.json \
 *        --out bench-results/ragas-<run-id>.json [--metrics faithfulness,answer_relevancy]
 *
 * Cases JSON shape:
 *   {
 *     "samples": [
 *       {
 *         "id": "rag1",
 *         "question": "What is X?",
 *         "contexts": ["passage 1", "passage 2"],
 *         "answer": "X is a thing.",
 *         "groundTruth": "X is a thing per source A."
 *       }
 *     ]
 *   }
 *
 * Honest stubs (QB #6): missing cases or unloadable module ⇒
 * write `{ ok: false, reason }` and exit 0. Never silently treat
 * absence as success.
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

const ALL_METRICS = ["faithfulness", "answer_relevancy", "context_precision", "context_recall"];

function parseFlags(argv) {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      cases: { type: "string" },
      out: { type: "string" },
      metrics: { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });
  let metrics = null;
  if (typeof values["metrics"] === "string") {
    const parts = values["metrics"]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 0) metrics = parts;
  }
  return {
    cases: typeof values["cases"] === "string" ? values["cases"] : null,
    out: typeof values["out"] === "string" ? values["out"] : null,
    metrics,
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

function makeStubJudge(reason) {
  return {
    name: "stub-judge",
    query: async () => `cannot judge: ${reason}\nSCORE: 0`,
  };
}

async function loadRagasModule() {
  const url = pathToFileURL(resolve(REPO_ROOT, "src/evals/ragas-metrics.ts")).href;
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
  if (!Array.isArray(raw.samples) || raw.samples.length === 0) {
    return { ok: false, reason: "'samples' must be a non-empty array" };
  }
  return { ok: true };
}

function validateSample(s) {
  if (typeof s !== "object" || s === null) return false;
  if (typeof s.question !== "string") return false;
  if (!Array.isArray(s.contexts)) return false;
  if (typeof s.answer !== "string") return false;
  return true;
}

function filterMetrics(requested) {
  if (!requested) return ALL_METRICS;
  const allowed = new Set(ALL_METRICS);
  return requested.filter((m) => allowed.has(m));
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
      samples: [],
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
      samples: [],
      ranAt: new Date().toISOString(),
    };
    writeReport(resolve(args.out), stub);
    process.stdout.write(JSON.stringify(stub) + "\n");
    process.exit(0);
  }

  const mod = await loadRagasModule();
  if (!mod || typeof mod.runRagasReport !== "function") {
    const stub = {
      ok: false,
      reason:
        "could not load src/evals/ragas-metrics.ts — run via tsx for dev, or against built dist/ in CI",
      samples: [],
      ranAt: new Date().toISOString(),
    };
    writeReport(resolve(args.out), stub);
    process.stdout.write(JSON.stringify(stub) + "\n");
    process.exit(0);
  }

  const judge = makeStubJudge("no real judge wired (stub mode)");
  const wantMetrics = filterMetrics(args.metrics);

  const perSample = [];
  for (const s of raw.samples) {
    if (!validateSample(s)) {
      perSample.push({
        id: typeof s?.id === "string" ? s.id : `sample-${perSample.length}`,
        error: "malformed sample (missing question/contexts/answer)",
      });
      continue;
    }
    const sample = {
      question: s.question,
      contexts: s.contexts,
      answer: s.answer,
      ...(typeof s.groundTruth === "string" ? { groundTruth: s.groundTruth } : {}),
    };
    try {
      const report = await mod.runRagasReport(sample, judge, wantMetrics);
      perSample.push({
        id: typeof s.id === "string" ? s.id : `sample-${perSample.length}`,
        aggregate: report.aggregate,
        callsMade: report.callsMade,
        metrics: report.metrics,
      });
    } catch (err) {
      perSample.push({
        id: typeof s.id === "string" ? s.id : `sample-${perSample.length}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const report = {
    ok: true,
    judgeName: judge.name,
    metricsRequested: wantMetrics,
    casesPath,
    ranAt: new Date().toISOString(),
    totalSamples: perSample.length,
    samples: perSample,
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
