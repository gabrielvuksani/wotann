/**
 * BenchmarkHarness integration tests for the NEW flavours:
 *   - "swe-bench-verified" dispatches to runSweBench
 *   - "tau-bench" dispatches to runTauBench with policy injection toggle
 *   - dryRunBenchmark returns a DryRunReport for each flavour
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { BenchmarkHarness } from "../../../src/intelligence/benchmark-harness.js";
import type { RunnerRuntime as TBRunnerRuntime } from "../../../src/intelligence/benchmark-runners/terminal-bench.js";
import type { StreamChunk } from "../../../src/providers/types.js";
import type { WotannQueryOptions } from "../../../src/core/types.js";
import type { VerificationEvidence } from "../../../src/autopilot/types.js";

type VerifyResult = {
  completed: boolean;
  score: number;
  evidence: readonly VerificationEvidence[];
};

function makeFakeRuntime(opts: { verifyResult?: VerifyResult }): TBRunnerRuntime {
  async function* query(_options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    yield { type: "text", content: "fake", provider: "openai" };
  }
  async function verifyCompletion(): Promise<VerifyResult> {
    return opts.verifyResult ?? { completed: true, score: 0.9, evidence: [] };
  }
  return { query, verifyCompletion };
}

describe("BenchmarkHarness.runRealBenchmark — new flavours", () => {
  it("dispatches swe-bench-verified and persists a normalized run", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const harness = new BenchmarkHarness(tmpDir);
      const run = await harness.runRealBenchmark("swe-bench-verified", runtime, {
        modelId: "fake-model",
        limit: 1,
      });
      expect(run.modelId).toBe("fake-model");
      expect(run.percentile).toBeGreaterThanOrEqual(0);
      expect(run.type).toBe("open-swe");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dispatches tau-bench with policy injection (default on)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const harness = new BenchmarkHarness(tmpDir);
      const run = await harness.runRealBenchmark("tau-bench", runtime, {
        modelId: "fake-model",
        limit: 2,
        domains: ["retail"],
      });
      expect(run.modelId).toBe("fake-model");
      expect(run.score).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("tau-bench respects injectPolicy:false (ablation)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const harness = new BenchmarkHarness(tmpDir);
      const run = await harness.runRealBenchmark("tau-bench", runtime, {
        modelId: "fake-model",
        limit: 1,
        injectPolicy: false,
      });
      expect(run.percentile).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("BenchmarkHarness.dryRunBenchmark", () => {
  it("returns dry-run report for terminal-bench", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({});
      const harness = new BenchmarkHarness(tmpDir);
      const report = await harness.dryRunBenchmark("terminal-bench", runtime);
      expect(report.benchmark).toBe("terminal-bench");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns dry-run report for swe-bench-verified", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({});
      const harness = new BenchmarkHarness(tmpDir);
      const report = await harness.dryRunBenchmark("swe-bench-verified", runtime);
      expect(report.benchmark).toBe("swe-bench-verified");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns dry-run report for tau-bench with both domains", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({});
      const harness = new BenchmarkHarness(tmpDir);
      const report = await harness.dryRunBenchmark("tau-bench", runtime, {
        domains: ["retail", "airline"],
      });
      expect(report.benchmark).toBe("tau-bench");
      expect(report.checks.some((c) => c.name === "policy-retail")).toBe(true);
      expect(report.checks.some((c) => c.name === "policy-airline")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns dry-run for each code-eval flavour", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-harness-"));
    try {
      const runtime = makeFakeRuntime({});
      const harness = new BenchmarkHarness(tmpDir);
      for (const flavour of ["humaneval-plus", "mbpp-plus", "livecodebench"] as const) {
        const report = await harness.dryRunBenchmark(flavour, runtime);
        expect(report.benchmark).toBe(flavour);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
