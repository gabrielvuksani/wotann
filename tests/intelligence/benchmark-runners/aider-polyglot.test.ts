/**
 * Aider Polyglot runner tests — covers the NEW Phase-E additions:
 *   - pass@1 vs pass@2 distinction (Aider-official 2-attempt scoring)
 *   - BlockedCorpusError on missing 225-problem corpus when required
 *   - Trajectory JSONL emit with per-task language metadata
 *   - Dry-run validation
 *   - Parity target exposed on report
 *
 * Legacy test coverage for diff→fallback + language filtering stays in
 * the parent tests/intelligence/benchmark-runners.test.ts file.
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  runAiderPolyglot,
  loadAiderPolyglotTasks,
  dryRunAiderPolyglot,
  AIDER_POLYGLOT_PARITY_PASS_AT_2,
  type RunnerRuntime,
} from "../../../src/intelligence/benchmark-runners/aider-polyglot.js";
import { isBlockedCorpusError } from "../../../src/intelligence/benchmark-runners/shared.js";
import type { StreamChunk } from "../../../src/providers/types.js";
import type { WotannQueryOptions } from "../../../src/core/types.js";
import type { VerificationEvidence } from "../../../src/autopilot/types.js";

type VerifyResult = {
  completed: boolean;
  score: number;
  evidence: readonly VerificationEvidence[];
};

function makeFakeRuntime(opts: {
  verifyResults?: readonly VerifyResult[];
  verifyResult?: VerifyResult;
}): RunnerRuntime {
  let idx = 0;
  async function* query(_options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    yield { type: "text", content: "fake", provider: "openai" };
  }
  async function verifyCompletion(): Promise<VerifyResult> {
    if (opts.verifyResults) {
      return opts.verifyResults[idx++] ?? { completed: false, score: 0, evidence: [] };
    }
    return opts.verifyResult ?? { completed: true, score: 0.9, evidence: [] };
  }
  return { query, verifyCompletion };
}

describe("aider-polyglot pass@1 vs pass@2", () => {
  it("pass@1 counts only first-diff-attempt successes; pass@2 counts any attempt", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      // Task 1: first diff passes (attempt 1 → pass@1 ✓, pass@2 ✓)
      // Task 2: first diff fails, fallback passes (pass@1 ✗, pass@2 ✓)
      const runtime = makeFakeRuntime({
        verifyResults: [
          { completed: true, score: 0.9, evidence: [] }, // t1 diff
          { completed: false, score: 0.3, evidence: [] }, // t2 diff
          { completed: true, score: 0.85, evidence: [] }, // t2 fallback
        ],
      });
      const report = await runAiderPolyglot(runtime, tmpDir, { limit: 2, diffEditAttempts: 1 });
      expect(report.totalTasks).toBe(2);
      expect(report.completedTasks).toBe(2);
      expect(report.passAt1).toBe(0.5); // only task 1 passed on first attempt
      expect(report.passAt2).toBe(1); // both passed across the 2 attempts
      expect(report.parityTargetPassAt2).toBe(AIDER_POLYGLOT_PARITY_PASS_AT_2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passedFirstAttempt flag is set correctly on per-task result", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResults: [{ completed: true, score: 0.9, evidence: [] }],
      });
      const report = await runAiderPolyglot(runtime, tmpDir, { limit: 1, diffEditAttempts: 1 });
      expect(report.results[0]?.passedFirstAttempt).toBe(true);
      expect(report.results[0]?.usedWholeFileFallback).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("aider-polyglot blocked corpus", () => {
  it("throws BlockedCorpusError with 225-problem hint when requireCorpus=true", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      expect(() => loadAiderPolyglotTasks(tmpDir, { requireCorpus: true })).toThrow(
        /BLOCKED-NEEDS-CORPUS/,
      );
      try {
        loadAiderPolyglotTasks(tmpDir, { requireCorpus: true });
      } catch (e) {
        expect(isBlockedCorpusError(e)).toBe(true);
        if (isBlockedCorpusError(e)) {
          expect(e.benchmark).toBe("aider-polyglot");
          expect(e.fetchCommand).toContain("Aider-AI/polyglot-benchmark");
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("aider-polyglot trajectory + dry-run", () => {
  it("trajectory JSONL records per-task language + attempt metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runAiderPolyglot(runtime, tmpDir, { limit: 1, diffEditAttempts: 1 });
      expect(existsSync(report.trajectoryPath)).toBe(true);
      const lines = readFileSync(report.trajectoryPath, "utf-8").trim().split("\n");
      const taskResult = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((e) => e["type"] === "task-result");
      const meta = taskResult?.["meta"] as Record<string, unknown> | undefined;
      expect(meta?.["language"]).toBeDefined();
      expect(typeof meta?.["passedFirstAttempt"]).toBe("boolean");
      rmSync(report.trajectoryPath, { force: true });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dry-run reports readiness based on corpus + runtime presence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-aider-"));
    try {
      const runtime = makeFakeRuntime({});
      const report = dryRunAiderPolyglot(runtime, tmpDir);
      expect(report.benchmark).toBe("aider-polyglot");
      expect(report.corpusSize).toBeGreaterThan(0);
      expect(report.checks.some((c) => c.name === "corpus")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
