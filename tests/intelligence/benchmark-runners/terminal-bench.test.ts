/**
 * TerminalBench runner tests — covers the NEW Phase-E features:
 *   - BlockedCorpusError path + fetch command
 *   - Trajectory JSONL sink
 *   - Dry-run validation report
 *   - Parity target exposed on the report
 *
 * Legacy tests for smoke-corpus + query dispatch stay in the
 * sibling benchmark-runners.test.ts file for backwards compatibility.
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  runTerminalBench,
  loadTerminalBenchTasks,
  dryRunTerminalBench,
  TERMINAL_BENCH_PARITY_PASS_AT_1,
  type RunnerRuntime,
} from "../../../src/intelligence/benchmark-runners/terminal-bench.js";
import { isBlockedCorpusError } from "../../../src/intelligence/benchmark-runners/shared.js";
import type { StreamChunk } from "../../../src/providers/types.js";
import type { WotannQueryOptions } from "../../../src/core/types.js";
import type { VerificationEvidence } from "../../../src/autopilot/types.js";

type VerifyResult = {
  completed: boolean;
  score: number;
  evidence: readonly VerificationEvidence[];
};

function makeFakeRuntime(opts: { verifyResult?: VerifyResult }): RunnerRuntime {
  async function* query(_options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    yield { type: "text", content: "fake response", provider: "openai" };
  }
  async function verifyCompletion(): Promise<VerifyResult> {
    return opts.verifyResult ?? { completed: true, score: 0.9, evidence: [] };
  }
  return { query, verifyCompletion };
}

// ── Blocked-corpus ────────────────────────────────────

describe("terminal-bench blocked corpus", () => {
  it("throws BlockedCorpusError when requireCorpus=true and no on-disk corpus", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      expect(() => loadTerminalBenchTasks(tmpDir, { requireCorpus: true })).toThrow(
        /BLOCKED-NEEDS-CORPUS/,
      );
      try {
        loadTerminalBenchTasks(tmpDir, { requireCorpus: true });
      } catch (e) {
        expect(isBlockedCorpusError(e)).toBe(true);
        if (isBlockedCorpusError(e)) {
          expect(e.benchmark).toBe("terminal-bench");
          expect(e.fetchCommand).toContain("git clone");
          expect(e.fetchCommand).toContain("laude-institute/terminal-bench");
          expect(e.fetchCommand).not.toContain("tbench-ai/terminal-bench");
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads on-disk corpus at the new layout path", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const corpusDir = join(tmpDir, ".wotann", "benchmarks", "terminal-bench");
      mkdirSync(corpusDir, { recursive: true });
      const line = JSON.stringify({
        id: "disk-1",
        prompt: "Disk-loaded task",
        difficulty: "easy",
      });
      writeFileSync(join(corpusDir, "terminal-bench-tasks.jsonl"), `${line}\n`);
      const tasks = loadTerminalBenchTasks(tmpDir);
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe("disk-1");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads legacy on-disk corpus path for backwards compatibility", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const legacyDir = join(tmpDir, ".wotann", "benchmarks");
      mkdirSync(legacyDir, { recursive: true });
      const line = JSON.stringify({ id: "legacy-1", prompt: "Legacy task" });
      writeFileSync(join(legacyDir, "terminal-bench-tasks.jsonl"), `${line}\n`);
      const tasks = loadTerminalBenchTasks(tmpDir);
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe("legacy-1");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Trajectory + parity ───────────────────────────────

describe("terminal-bench trajectory + parity", () => {
  it("emits JSONL trajectory file with run-start + task-result + run-end", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      expect(existsSync(report.trajectoryPath)).toBe(true);
      const lines = readFileSync(report.trajectoryPath, "utf-8").trim().split("\n");
      const types = lines.map((l) => (JSON.parse(l) as Record<string, unknown>)["type"]);
      expect(types).toContain("run-start");
      expect(types).toContain("task-result");
      expect(types).toContain("run-end");
      rmSync(report.trajectoryPath, { force: true });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exposes the Claude Mythos parity target on the report", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    const prev = process.env["WOTANN_TB_REAL"];
    try {
      delete process.env["WOTANN_TB_REAL"]; // force simple-mode for this assertion
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      expect(report.parityTargetPassAt1).toBe(TERMINAL_BENCH_PARITY_PASS_AT_1);
      expect(report.mode).toBe("simple");
    } finally {
      if (prev === undefined) delete process.env["WOTANN_TB_REAL"];
      else process.env["WOTANN_TB_REAL"] = prev;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("switches mode='real' on the report when WOTANN_TB_REAL=1", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    const prev = process.env["WOTANN_TB_REAL"];
    try {
      process.env["WOTANN_TB_REAL"] = "1";
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      expect(report.mode).toBe("real");
    } finally {
      if (prev === undefined) delete process.env["WOTANN_TB_REAL"];
      else process.env["WOTANN_TB_REAL"] = prev;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("treats WOTANN_TB_REAL=0 / other values as simple mode (strict equality to '1')", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    const prev = process.env["WOTANN_TB_REAL"];
    try {
      process.env["WOTANN_TB_REAL"] = "0";
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.8, evidence: [] },
      });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      expect(report.mode).toBe("simple");

      process.env["WOTANN_TB_REAL"] = "true";
      const report2 = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      expect(report2.mode).toBe("simple");
    } finally {
      if (prev === undefined) delete process.env["WOTANN_TB_REAL"];
      else process.env["WOTANN_TB_REAL"] = prev;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Dry-run ───────────────────────────────────────────

describe("terminal-bench dry-run", () => {
  it("validates setup and reports corpus size + runtime presence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const runtime = makeFakeRuntime({});
      const report = dryRunTerminalBench(runtime, tmpDir);
      expect(report.benchmark).toBe("terminal-bench");
      expect(report.corpusSize).toBeGreaterThan(0); // smoke
      const corpusCheck = report.checks.find((c) => c.name === "corpus");
      const runtimeCheck = report.checks.find((c) => c.name === "runtime");
      const dockerCheck = report.checks.find((c) => c.name === "docker");
      expect(corpusCheck).toBeDefined();
      expect(runtimeCheck?.ok).toBe(true);
      expect(dockerCheck).toBeDefined(); // docker check present regardless of result
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports blockedReason when requireCorpus=true and no disk corpus", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const report = dryRunTerminalBench(null, tmpDir, { requireCorpus: true });
      expect(report.ready).toBe(false);
      expect(report.blockedReason).toContain("BLOCKED-NEEDS-CORPUS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
