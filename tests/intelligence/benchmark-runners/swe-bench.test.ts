/**
 * SWE-bench Verified runner tests.
 *
 * Verify:
 *   - Smoke corpus loads (3 realistic-shaped tasks)
 *   - BlockedCorpusError thrown when requireCorpus + missing on-disk corpus
 *   - runSweBench dispatches query + verifyCompletion per task
 *   - Patch extraction from <<<PATCH>>> and ```diff fences works
 *   - Dry-run validates without executing
 *   - Parity target is exposed on the report
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  runSweBench,
  loadSweBenchTasks,
  dryRunSweBench,
  SWE_BENCH_PARITY_PASS_AT_1,
  type RunnerRuntime,
} from "../../../src/intelligence/benchmark-runners/swe-bench.js";
import { isBlockedCorpusError } from "../../../src/intelligence/benchmark-runners/shared.js";
import type { StreamChunk } from "../../../src/providers/types.js";
import type { WotannQueryOptions } from "../../../src/core/types.js";
import type { VerificationEvidence } from "../../../src/autopilot/types.js";

// ── Fake runtime ──────────────────────────────────────

type VerifyResult = {
  completed: boolean;
  score: number;
  evidence: readonly VerificationEvidence[];
};

function makeFakeRuntime(opts: {
  queryText?: string;
  verifyResult?: VerifyResult;
  queryThrows?: boolean;
}): RunnerRuntime & {
  calls: { queries: WotannQueryOptions[]; verifies: string[] };
} {
  const calls = { queries: [] as WotannQueryOptions[], verifies: [] as string[] };
  async function* query(options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    calls.queries.push(options);
    if (opts.queryThrows) throw new Error("fake query failure");
    yield { type: "text", content: opts.queryText ?? "no patch here", provider: "openai" };
  }
  async function verifyCompletion(task: string): Promise<VerifyResult> {
    calls.verifies.push(task);
    return opts.verifyResult ?? { completed: true, score: 0.9, evidence: [] };
  }
  return { query, verifyCompletion, calls };
}

// ── Smoke loader ──────────────────────────────────────

describe("swe-bench smoke corpus", () => {
  it("loads 3 smoke tasks when corpus absent and requireCorpus=false", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const tasks = loadSweBenchTasks(tmpDir);
      expect(tasks.length).toBe(3);
      expect(tasks[0]?.id).toMatch(/^swe-smoke-/);
      // Each smoke task has a realistic shape
      for (const t of tasks) {
        expect(t.repo).toMatch(/^[a-z]+\/[a-z]+$/);
        expect(t.baseCommit).toBeTruthy();
        expect(t.problemStatement.length).toBeGreaterThan(20);
        expect(Array.isArray(t.passToPass)).toBe(true);
        expect(Array.isArray(t.failToPass)).toBe(true);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Blocked-corpus ────────────────────────────────────

describe("swe-bench blocked corpus", () => {
  it("throws BlockedCorpusError with fetch command when requireCorpus=true and missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      expect(() => loadSweBenchTasks(tmpDir, { requireCorpus: true })).toThrow(/BLOCKED-NEEDS-CORPUS/);
      try {
        loadSweBenchTasks(tmpDir, { requireCorpus: true });
      } catch (e) {
        expect(isBlockedCorpusError(e)).toBe(true);
        if (isBlockedCorpusError(e)) {
          expect(e.benchmark).toBe("swe-bench-verified");
          expect(e.fetchCommand).toContain("curl");
          expect(e.fetchCommand).toContain("SWE-bench_Verified");
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads real on-disk corpus when present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const corpusDir = join(tmpDir, ".wotann", "benchmarks", "swe-bench");
      mkdirSync(corpusDir, { recursive: true });
      const line = JSON.stringify({
        id: "custom-1",
        repo: "flask/flask",
        baseCommit: "aaaaaaa",
        problemStatement: "Some real problem",
        passToPass: ["test_x"],
        failToPass: ["test_y"],
      });
      writeFileSync(join(corpusDir, "swe-bench-verified-tasks.jsonl"), `${line}\n`);
      const tasks = loadSweBenchTasks(tmpDir);
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe("custom-1");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Runner execution ──────────────────────────────────

describe("swe-bench runner", () => {
  it("runs smoke corpus end-to-end and records pass@1", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.85, evidence: [] },
      });
      const report = await runSweBench(runtime, tmpDir, { limit: 2 });
      expect(report.totalTasks).toBe(2);
      expect(report.completedTasks).toBe(2);
      expect(report.passAt1).toBe(1);
      expect(report.parityTargetPassAt1).toBe(SWE_BENCH_PARITY_PASS_AT_1);
      expect(report.trajectoryPath).toMatch(/bench-runs/);
      expect(runtime.calls.queries.length).toBe(2);
      expect(runtime.calls.verifies.length).toBe(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("records error and continues when query throws", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const runtime = makeFakeRuntime({ queryThrows: true });
      const report = await runSweBench(runtime, tmpDir, { limit: 2 });
      expect(report.totalTasks).toBe(2);
      expect(report.completedTasks).toBe(0);
      expect(report.results.every((r) => r.error !== undefined)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts patch from <<<PATCH>>> markers", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const runtime = makeFakeRuntime({
        queryText:
          "Here's my fix: <<<PATCH>>>\ndiff --git a/file.py b/file.py\n+new line\n<<<END>>>\nDone.",
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runSweBench(runtime, tmpDir, { limit: 1 });
      expect(report.results[0]?.proposedPatch).toContain("diff --git");
      expect(report.results[0]?.proposedPatch).toContain("+new line");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts patch from ```diff fences as fallback", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const runtime = makeFakeRuntime({
        queryText: "```diff\n--- a\n+++ b\n+fix\n```",
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runSweBench(runtime, tmpDir, { limit: 1 });
      expect(report.results[0]?.proposedPatch).toContain("+fix");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("emits a trajectory file with run-start, task-result, run-end entries", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runSweBench(runtime, tmpDir, { limit: 1 });
      const { readFileSync, existsSync, rmSync: rm } = await import("node:fs");
      expect(existsSync(report.trajectoryPath)).toBe(true);
      const lines = readFileSync(report.trajectoryPath, "utf-8").trim().split("\n");
      const types = lines.map((l) => (JSON.parse(l) as Record<string, unknown>)["type"]);
      expect(types).toContain("run-start");
      expect(types).toContain("task-result");
      expect(types).toContain("run-end");
      rm(report.trajectoryPath, { force: true });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Dry-run ───────────────────────────────────────────

describe("swe-bench dry-run", () => {
  it("reports ready=true when smoke fallback is acceptable and runtime present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const runtime = makeFakeRuntime({});
      const report = dryRunSweBench(runtime, tmpDir);
      expect(report.benchmark).toBe("swe-bench-verified");
      expect(report.corpusSize).toBe(3); // smoke
      expect(report.ready).toBe(true);
      expect(report.checks.some((c) => c.name === "corpus")).toBe(true);
      expect(report.checks.some((c) => c.name === "runtime")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports ready=false when requireCorpus=true and no on-disk corpus", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-swe-"));
    try {
      const report = dryRunSweBench(null, tmpDir, { requireCorpus: true });
      expect(report.ready).toBe(false);
      expect(report.blockedReason).toContain("BLOCKED-NEEDS-CORPUS");
      // corpus check should report as "no"
      const corpusCheck = report.checks.find((c) => c.name === "corpus");
      expect(corpusCheck?.ok).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
