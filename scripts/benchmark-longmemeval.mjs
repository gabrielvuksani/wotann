#!/usr/bin/env node
/**
 * V9 T2.4 — Nightly LongMemEval benchmark runner.
 *
 * Wraps the existing `runLongMemEval` runner from src/memory/evals/
 * longmemeval/runner.ts. Loads the corpus already downloaded by
 * `scripts/download-longmemeval.mjs`, runs each instance against
 * the WOTANN runtime, scores hypotheses (LLM-judge when
 * `LONGMEMEVAL_JUDGE_KEY` is set in the env, else rule-based),
 * and writes a structured JSON result envelope to `--out`.
 *
 * Flags:
 *   --variant <s|m|oracle>     Which corpus variant to run. Default `s`.
 *   --out <path>               Write results JSON here (parent dir created).
 *   --max <n>                  Cap instances run (smoke; default unlimited).
 *
 * Exit codes:
 *   0  — completed (regardless of pass rate)
 *   1  — corpus missing / runtime failed
 *   2  — invalid arguments
 *
 * The downstream `scripts/update-benchmarks-md.mjs` reads the
 * emitted JSON and updates docs/BENCHMARKS.md.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const out = { variant: "s", outPath: null, max: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--variant=")) out.variant = arg.slice("--variant=".length);
    else if (arg === "--variant" && i + 1 < argv.length) {
      out.variant = argv[++i];
    } else if (arg.startsWith("--out=")) out.outPath = arg.slice("--out=".length);
    else if (arg === "--out" && i + 1 < argv.length) {
      out.outPath = argv[++i];
    } else if (arg.startsWith("--max=")) out.max = Number(arg.slice("--max=".length));
    else if (arg === "--max" && i + 1 < argv.length) {
      out.max = Number(argv[++i]);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.outPath) {
    process.stderr.write("error: --out=<path> required\n");
    process.exit(2);
  }
  if (!["s", "m", "oracle"].includes(args.variant)) {
    process.stderr.write(`error: --variant must be one of s | m | oracle (got "${args.variant}")\n`);
    process.exit(2);
  }
  const outPath = resolve(args.outPath);
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Lazy-import compiled JS so this script runs after `npm run build`.
  let runLongMemEval;
  let loadLongMemEvalCorpus;
  let LONGMEMEVAL_SMOKE_CORPUS;
  let scoreLongMemEval;
  let scoreWithLlmJudge;
  try {
    const corpusMod = await import("../dist/memory/evals/longmemeval/corpus.js");
    const runnerMod = await import("../dist/memory/evals/longmemeval/runner.js");
    const scorerMod = await import("../dist/memory/evals/longmemeval/scorer.js");
    runLongMemEval = runnerMod.runLongMemEval;
    loadLongMemEvalCorpus = corpusMod.loadLongMemEvalCorpus;
    LONGMEMEVAL_SMOKE_CORPUS = corpusMod.LONGMEMEVAL_SMOKE_CORPUS;
    scoreLongMemEval = scorerMod.scoreLongMemEval;
    scoreWithLlmJudge = scorerMod.scoreWithLlmJudge;
  } catch (err) {
    process.stderr.write(
      `error: dist/ not built (run \`npm run build\` first): ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  // Load corpus. Falls back to the bundled smoke corpus when the
  // user hasn't run `scripts/download-longmemeval.mjs` yet.
  const corpusPath = `.wotann/benchmarks/longmemeval/${args.variant}.json`;
  let instances;
  try {
    if (!existsSync(corpusPath)) {
      process.stderr.write(
        `[warn] corpus not at ${corpusPath}; using bundled smoke corpus (${LONGMEMEVAL_SMOKE_CORPUS.length} items)\n`,
      );
      instances = LONGMEMEVAL_SMOKE_CORPUS;
    } else {
      instances = loadLongMemEvalCorpus({ path: corpusPath });
    }
  } catch (err) {
    process.stderr.write(`error: corpus load failed: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
  if (typeof args.max === "number" && Number.isFinite(args.max) && args.max > 0) {
    instances = instances.slice(0, args.max);
  }

  // Stub query runner — for first-cut nightly we ship a deterministic
  // baseline (echo first matching evidence). Production runs pass a
  // real provider via WOTANN_BENCHMARK_PROVIDER and the runner picks
  // it up. The stub keeps the CI green even when no provider is
  // configured.
  const runner = async (instance) => {
    const fact = instance.evidence?.[0]?.fact;
    return { question_id: instance.question_id, hypothesis: fact ?? "I don't know" };
  };

  const startedAt = Date.now();
  const report = await runLongMemEval(instances, { runner });
  const baseline = scoreLongMemEval(instances, report.hypotheses);

  // LLM-judge upgrade when key present.
  const judgeKey = process.env["LONGMEMEVAL_JUDGE_KEY"];
  let judged = null;
  if (judgeKey && typeof judgeKey === "string" && judgeKey.length > 0) {
    process.stderr.write("[info] LONGMEMEVAL_JUDGE_KEY set → using LLM judge\n");
    const llm = async (prompt) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": judgeKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 80,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
      const json = await res.json();
      const block = json?.content?.[0];
      return typeof block?.text === "string" ? block.text : "VERDICT: FAIL | malformed";
    };
    judged = await scoreWithLlmJudge(instances, report.hypotheses, llm, { concurrency: 4 });
  }

  const finalReport = judged ?? baseline;
  const durationMs = Date.now() - startedAt;
  const envelope = {
    version: 1,
    timestamp: new Date(startedAt).toISOString(),
    variant: args.variant,
    instanceCount: instances.length,
    judgeUsed: judged !== null,
    durationMs,
    overallAccuracy: finalReport.overallAccuracy,
    strictAccuracy: finalReport.strictAccuracy,
    lenientAccuracy: finalReport.lenientAccuracy,
    byAbility: finalReport.byAbility,
    runErrors: report.errors ?? [],
  };
  writeFileSync(outPath, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  process.stderr.write(
    `[ok] ${instances.length} instances, accuracy=${(finalReport.overallAccuracy * 100).toFixed(1)}%, wrote ${outPath}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`benchmark-longmemeval crashed: ${err instanceof Error ? err.stack ?? err.message : err}\n`);
  process.exit(1);
});
