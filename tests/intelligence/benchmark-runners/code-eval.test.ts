/**
 * Code-eval runner tests — NEW Phase-E additions:
 *   - LCB contamination awareness via modelCutoff + releaseDate
 *   - releasedAfter filter excludes pre-cutoff tasks
 *   - BlockedCorpusError when requireCorpus=true
 *   - Trajectory JSONL with contamination metadata per task
 *   - Dry-run validation includes lcb-cutoff check
 *
 * Legacy test coverage for pass@k + HumanEval+/MBPP+ contamination lives
 * in the parent tests/intelligence/benchmark-runners.test.ts file.
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  runCodeEval,
  loadCodeEvalTasks,
  dryRunCodeEval,
  type RunnerRuntime,
} from "../../../src/intelligence/benchmark-runners/code-eval.js";
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
    yield { type: "text", content: "fake", provider: "openai" };
  }
  async function verifyCompletion(): Promise<VerifyResult> {
    return opts.verifyResult ?? { completed: true, score: 0.9, evidence: [] };
  }
  return { query, verifyCompletion };
}

// ── LCB contamination awareness ───────────────────────

describe("code-eval LCB contamination awareness", () => {
  it("bumps low-risk LCB task to medium when releaseDate <= modelCutoff", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      // Set modelCutoff AFTER both smoke LCB tasks' releaseDate so they get bumped.
      // Smoke LCB tasks: 2025-09-15 and 2025-11-03. Cutoff 2025-12-01 covers both.
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runCodeEval(runtime, tmpDir, "livecodebench", {
        limit: 2,
        modelCutoff: "2025-12-01",
      });
      // Effective risk should be "medium" for both (bumped from "low")
      expect(report.byContamination.medium.total).toBe(2);
      expect(report.byContamination.low.total).toBe(0);
      expect(report.modelCutoff).toBe("2025-12-01");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps low-risk LCB task as low when releaseDate > modelCutoff", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      // Cutoff BEFORE smoke task release dates — tasks stay post-cutoff
      const report = await runCodeEval(runtime, tmpDir, "livecodebench", {
        limit: 2,
        modelCutoff: "2025-06-01",
      });
      expect(report.byContamination.low.total).toBe(2);
      expect(report.byContamination.medium.total).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("releasedAfter filter excludes pre-cutoff tasks entirely", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      const corpusDir = join(tmpDir, ".wotann", "benchmarks", "code-eval");
      mkdirSync(corpusDir, { recursive: true });
      const tasks = [
        {
          id: "post-1",
          flavour: "livecodebench",
          prompt: "post-cutoff",
          contaminationRisk: "low",
          releaseDate: "2025-12-01",
        },
        {
          id: "pre-1",
          flavour: "livecodebench",
          prompt: "pre-cutoff",
          contaminationRisk: "low",
          releaseDate: "2025-01-01",
        },
      ];
      writeFileSync(
        join(corpusDir, "livecodebench-tasks.jsonl"),
        tasks.map((t) => JSON.stringify(t)).join("\n") + "\n",
      );
      const filtered = loadCodeEvalTasks(tmpDir, "livecodebench", {
        releasedAfter: "2025-06-01",
      });
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.id).toBe("post-1");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── BlockedCorpusError ────────────────────────────────

describe("code-eval blocked corpus", () => {
  it("throws BlockedCorpusError when requireCorpus=true and missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      expect(() => loadCodeEvalTasks(tmpDir, "humaneval-plus", { requireCorpus: true })).toThrow(
        /BLOCKED-NEEDS-CORPUS/,
      );
      try {
        loadCodeEvalTasks(tmpDir, "humaneval-plus", { requireCorpus: true });
      } catch (e) {
        expect(isBlockedCorpusError(e)).toBe(true);
        if (isBlockedCorpusError(e)) {
          expect(e.benchmark).toBe("humaneval-plus");
          expect(e.fetchCommand).toContain("evalplus");
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Trajectory ────────────────────────────────────────

describe("code-eval trajectory + metadata", () => {
  it("records contamination metadata per task in trajectory JSONL", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runCodeEval(runtime, tmpDir, "livecodebench", {
        limit: 1,
        modelCutoff: "2025-12-01",
      });
      expect(existsSync(report.trajectoryPath)).toBe(true);
      const lines = readFileSync(report.trajectoryPath, "utf-8").trim().split("\n");
      const taskResult = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((e) => e["type"] === "task-result");
      const meta = taskResult?.["meta"] as Record<string, unknown> | undefined;
      expect(meta?.["contaminationRisk"]).toBe("low");
      expect(meta?.["effectiveContaminationRisk"]).toBe("medium"); // bumped
      expect(meta?.["flavour"]).toBe("livecodebench");
      rmSync(report.trajectoryPath, { force: true });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Dry-run ───────────────────────────────────────────

describe("code-eval dry-run", () => {
  it("adds an lcb-cutoff check when flavour is livecodebench and no cutoff set", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      const runtime = makeFakeRuntime({});
      const report = dryRunCodeEval(runtime, tmpDir, "livecodebench");
      const cutoffCheck = report.checks.find((c) => c.name === "lcb-cutoff");
      expect(cutoffCheck).toBeDefined();
      expect(cutoffCheck?.ok).toBe(true); // informational
      expect(cutoffCheck?.detail).toContain("cutoff-based filtering");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("no lcb-cutoff check for humaneval-plus / mbpp-plus flavours", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-ce-"));
    try {
      const runtime = makeFakeRuntime({});
      const report = dryRunCodeEval(runtime, tmpDir, "humaneval-plus");
      const cutoffCheck = report.checks.find((c) => c.name === "lcb-cutoff");
      expect(cutoffCheck).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
