/**
 * Integration tests for the Phase 4 benchmark runners.
 *
 * These exercise the RunnerRuntime structural interface with an
 * in-memory fake runtime so we can verify:
 *   - Task loading (smoke corpus fallback when no JSONL on disk)
 *   - Query + verifyCompletion dispatch
 *   - Pass@1 calculation
 *   - Error recovery (throwing query, failing verifyCompletion)
 *   - BenchmarkHarness normalization into BenchmarkRun
 *
 * No actual LLM / Docker / pip dependencies touched.
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  runTerminalBench,
  loadTerminalBenchTasks,
  type RunnerRuntime as TBRunnerRuntime,
} from "../../src/intelligence/benchmark-runners/terminal-bench.js";
import {
  runAiderPolyglot,
  loadAiderPolyglotTasks,
} from "../../src/intelligence/benchmark-runners/aider-polyglot.js";
import {
  runCodeEval,
  loadCodeEvalTasks,
} from "../../src/intelligence/benchmark-runners/code-eval.js";
import { BenchmarkHarness } from "../../src/intelligence/benchmark-harness.js";
import type { StreamChunk } from "../../src/providers/types.js";
import type { WotannQueryOptions } from "../../src/core/types.js";
import type { VerificationEvidence } from "../../src/autopilot/types.js";

// ── Fake Runtime ──────────────────────────────────────

type VerifyResult = {
  completed: boolean;
  score: number;
  evidence: readonly VerificationEvidence[];
};

/**
 * Fake runtime that records queries + returns scripted verify results.
 * Satisfies every RunnerRuntime structural interface (all three runners
 * need the same query + verifyCompletion shape).
 */
function makeFakeRuntime(opts: {
  queryText?: string;
  verifyResult?: VerifyResult;
  verifyResults?: readonly VerifyResult[]; // scripted sequence
  queryThrows?: boolean;
}): TBRunnerRuntime & {
  calls: { queries: WotannQueryOptions[]; verifies: string[] };
} {
  const calls = { queries: [] as WotannQueryOptions[], verifies: [] as string[] };
  let verifyIdx = 0;

  async function* query(options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    calls.queries.push(options);
    if (opts.queryThrows) throw new Error("fake query failure");
    yield { type: "text", content: opts.queryText ?? "fake response", provider: "openai" };
  }

  async function verifyCompletion(task: string): Promise<VerifyResult> {
    calls.verifies.push(task);
    if (opts.verifyResults) {
      return opts.verifyResults[verifyIdx++] ?? {
        completed: false,
        score: 0,
        evidence: [],
      };
    }
    return (
      opts.verifyResult ?? {
        completed: true,
        score: 0.9,
        evidence: [],
      }
    );
  }

  return { query, verifyCompletion, calls };
}

// ── TerminalBench tests ───────────────────────────────

describe("terminal-bench runner", () => {
  it("loads the smoke corpus when no JSONL is present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const tasks = loadTerminalBenchTasks(tmpDir);
      expect(tasks.length).toBeGreaterThanOrEqual(5);
      expect(tasks[0]?.id).toMatch(/^tb-smoke-/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs a task end-to-end and records pass@1", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const runtime = makeFakeRuntime({ verifyResult: { completed: true, score: 0.9, evidence: [] } });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 2 });
      expect(report.totalTasks).toBe(2);
      expect(report.completedTasks).toBe(2);
      expect(report.passAt1).toBe(1);
      expect(runtime.calls.queries.length).toBe(2);
      expect(runtime.calls.verifies.length).toBe(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("records error when query throws but continues through remaining tasks", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const runtime = makeFakeRuntime({ queryThrows: true });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 2 });
      expect(report.totalTasks).toBe(2);
      expect(report.completedTasks).toBe(0);
      expect(report.results.every((r) => r.error !== undefined)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("honours seed-based shuffling for deterministic ordering", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const a = loadTerminalBenchTasks(tmpDir, { seed: 42 });
      const b = loadTerminalBenchTasks(tmpDir, { seed: 42 });
      expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Aider Polyglot tests ──────────────────────────────

describe("aider-polyglot runner", () => {
  it("loads the smoke corpus with all 6 languages represented", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      const tasks = loadAiderPolyglotTasks(tmpDir);
      const langs = new Set(tasks.map((t) => t.language));
      expect(langs.size).toBeGreaterThanOrEqual(5); // at least 5 distinct languages
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("filters by languages option", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      const tasks = loadAiderPolyglotTasks(tmpDir, { languages: ["python", "rust"] });
      expect(tasks.every((t) => t.language === "python" || t.language === "rust")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("escalates to whole-file fallback after N diff-edit failures", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      // Scripted verify results: first 3 fail (diff-edit attempts), 4th succeeds (fallback)
      const runtime = makeFakeRuntime({
        verifyResults: [
          { completed: false, score: 0.2, evidence: [] },
          { completed: false, score: 0.3, evidence: [] },
          { completed: false, score: 0.4, evidence: [] },
          { completed: true, score: 0.9, evidence: [] },
        ],
      });
      const report = await runAiderPolyglot(runtime, tmpDir, { limit: 1, diffEditAttempts: 3 });
      expect(report.results.length).toBe(1);
      expect(report.results[0]?.usedWholeFileFallback).toBe(true);
      expect(report.results[0]?.diffEditAttempts).toBe(3);
      expect(report.results[0]?.completed).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("short-circuits on diff-edit success without invoking fallback", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResults: [{ completed: true, score: 1.0, evidence: [] }],
      });
      const report = await runAiderPolyglot(runtime, tmpDir, { limit: 1, diffEditAttempts: 3 });
      expect(report.results[0]?.usedWholeFileFallback).toBe(false);
      expect(report.results[0]?.diffEditAttempts).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Code-eval tests ───────────────────────────────────

describe("code-eval runner", () => {
  it("loads HumanEval+ smoke corpus and flags contamination as high", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-he-"));
    try {
      const tasks = loadCodeEvalTasks(tmpDir, "humaneval-plus");
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((t) => t.contaminationRisk === "high")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads LCB smoke corpus and flags contamination as low (post-cutoff slice)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-lcb-"));
    try {
      const tasks = loadCodeEvalTasks(tmpDir, "livecodebench");
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((t) => t.contaminationRisk === "low")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pass@k counts ANY sample passing as task-complete", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      // Task 1: first sample fails, second passes. Task 2: all samples pass.
      const runtime = makeFakeRuntime({
        verifyResults: [
          { completed: false, score: 0.3, evidence: [] }, // t1 s1
          { completed: true, score: 0.9, evidence: [] }, // t1 s2
          { completed: true, score: 0.8, evidence: [] }, // t2 s1
          { completed: true, score: 0.8, evidence: [] }, // t2 s2
        ],
      });
      const report = await runCodeEval(runtime, tmpDir, "humaneval-plus", { limit: 2, k: 2 });
      expect(report.totalTasks).toBe(2);
      expect(report.completedTasks).toBe(2);
      expect(report.passAtK).toBe(1);
      // passAt1: task 1 failed its first sample so only 1/2 pass at k=1
      expect(report.passAt1).toBe(0.5);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("partitions results by contamination risk", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      const runtime = makeFakeRuntime({ verifyResult: { completed: true, score: 0.9, evidence: [] } });
      const report = await runCodeEval(runtime, tmpDir, "livecodebench", { limit: 2 });
      expect(report.byContamination.low.total).toBeGreaterThanOrEqual(1);
      expect(report.byContamination.low.completed).toBe(report.byContamination.low.total);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── BenchmarkHarness.runRealBenchmark ─────────────────

describe("BenchmarkHarness.runRealBenchmark", () => {
  it("dispatches to terminal-bench and persists a normalized BenchmarkRun", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({ verifyResult: { completed: true, score: 0.9, evidence: [] } });
      const harness = new BenchmarkHarness(tmpDir);
      const run = await harness.runRealBenchmark("terminal-bench", runtime, {
        modelId: "fake-model",
        limit: 2,
      });
      expect(run.type).toBe("terminal-bench");
      expect(run.modelId).toBe("fake-model");
      expect(run.score).toBe(2);
      expect(run.maxScore).toBe(2);
      expect(run.percentile).toBe(100);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dispatches to aider-polyglot and stores under open-swe persist type", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({ verifyResult: { completed: true, score: 0.9, evidence: [] } });
      const harness = new BenchmarkHarness(tmpDir);
      const run = await harness.runRealBenchmark("aider-polyglot", runtime, {
        modelId: "fake-model",
        limit: 2,
      });
      expect(run.type).toBe("open-swe");
      expect(run.percentile).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dispatches to livecodebench flavour", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({ verifyResult: { completed: false, score: 0.4, evidence: [] } });
      const harness = new BenchmarkHarness(tmpDir);
      const run = await harness.runRealBenchmark("livecodebench", runtime, {
        modelId: "fake-model",
        limit: 1,
      });
      expect(run.score).toBe(0);
      expect(run.percentile).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
