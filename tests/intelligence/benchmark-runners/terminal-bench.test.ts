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
  isTbCliAvailable,
  resolveTbAgentScript,
  probeRealModePreconditions,
  parseTbStdout,
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

  it("switches toward mode='real' when WOTANN_TB_REAL=1 (degrades to 'simple' iff preflight fails)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    const prev = process.env["WOTANN_TB_REAL"];
    const prevDispatch = process.env["WOTANN_TB_DISPATCH"];
    try {
      process.env["WOTANN_TB_REAL"] = "1";
      delete process.env["WOTANN_TB_DISPATCH"]; // don't actually exec tb run
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      // Mode = "real" when preflight succeeds (tb CLI + agent + corpus all present).
      // Mode = "simple" when any precondition fails, with realModeIssue populated.
      if (report.mode === "real") {
        expect(report.realModeIssue).toBeUndefined();
      } else {
        expect(report.mode).toBe("simple");
        expect(report.realModeIssue).toBeDefined();
      }
    } finally {
      if (prev === undefined) delete process.env["WOTANN_TB_REAL"];
      else process.env["WOTANN_TB_REAL"] = prev;
      if (prevDispatch === undefined) delete process.env["WOTANN_TB_DISPATCH"];
      else process.env["WOTANN_TB_DISPATCH"] = prevDispatch;
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

// ── isTbCliAvailable probe ────────────────────────────

describe("isTbCliAvailable", () => {
  it("returns a boolean-tagged struct; unavailable path includes install hint", () => {
    const probe = isTbCliAvailable();
    expect(typeof probe.available).toBe("boolean");
    if (!probe.available) {
      expect(probe.reason).toBeDefined();
      expect(probe.reason).toMatch(/install-terminal-bench|tb CLI/);
    }
  });
});

// ── resolveTbAgentScript ──────────────────────────────

describe("resolveTbAgentScript", () => {
  it("resolves to an absolute path ending in python-scripts/tb_agent.py", () => {
    const path = resolveTbAgentScript();
    expect(path.startsWith("/")).toBe(true);
    expect(path.endsWith("python-scripts/tb_agent.py")).toBe(true);
  });

  it("points at a file that actually exists on disk", () => {
    const path = resolveTbAgentScript();
    expect(existsSync(path)).toBe(true);
  });
});

// ── probeRealModePreconditions ────────────────────────

describe("probeRealModePreconditions", () => {
  it("reports ready=false when corpus directory is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    try {
      const probe = probeRealModePreconditions(tmpDir);
      expect(probe.ready).toBe(false);
      // Reason is whichever precondition fails FIRST. CLI probe runs first,
      // so in CI (no tb) we see the CLI reason. If a dev has tb installed
      // we'd see the corpus reason instead.
      expect(probe.reason).toMatch(/tb CLI|corpus directory missing/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── parseTbStdout ─────────────────────────────────────

describe("parseTbStdout", () => {
  it("returns null when no JSON results blob is present", () => {
    const stdout = "[tb] starting run\n[tb] task 1 of 89\n[tb] done\n";
    expect(parseTbStdout(stdout)).toBeNull();
  });

  it("extracts and maps the results array from a final JSON line", () => {
    const blob = JSON.stringify({
      results: [
        {
          task_id: "tb-demo-01",
          prompt: "demo prompt",
          completed: true,
          score: 1,
          duration_ms: 1234,
          transcript: ["step 1", "step 2"],
        },
        {
          task_id: "tb-demo-02",
          prompt: "demo prompt 2",
          completed: false,
          score: 0,
          duration_ms: 500,
          transcript: [],
          error: "timeout",
        },
      ],
    });
    const stdout = `[tb] progress line\n[tb] more\n${blob}\n`;
    const parsed = parseTbStdout(stdout);
    expect(parsed).not.toBeNull();
    if (parsed !== null) {
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0]?.task.id).toBe("tb-demo-01");
      expect(parsed.results[0]?.completed).toBe(true);
      expect(parsed.results[0]?.durationMs).toBe(1234);
      expect(parsed.results[1]?.completed).toBe(false);
      expect(parsed.results[1]?.error).toBe("timeout");
    }
  });

  it("tolerates malformed result entries by coercing to sane defaults", () => {
    const blob = JSON.stringify({ results: [{}, { task_id: 42, completed: "yes" }] });
    const parsed = parseTbStdout(blob);
    expect(parsed).not.toBeNull();
    if (parsed !== null) {
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0]?.task.id).toBe("unknown");
      expect(parsed.results[0]?.completed).toBe(false);
      expect(parsed.results[0]?.score).toBe(0);
      expect(parsed.results[1]?.task.id).toBe("unknown"); // non-string task_id coerced
      expect(parsed.results[1]?.completed).toBe(false); // non-boolean completed coerced
    }
  });
});

// ── realModeIssue field on TerminalBenchReport ────────

describe("terminal-bench realModeIssue field", () => {
  it("is undefined when WOTANN_TB_REAL is unset", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    const prev = process.env["WOTANN_TB_REAL"];
    try {
      delete process.env["WOTANN_TB_REAL"];
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.8, evidence: [] },
      });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      expect(report.realModeIssue).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env["WOTANN_TB_REAL"];
      else process.env["WOTANN_TB_REAL"] = prev;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("is populated when WOTANN_TB_REAL=1 but prerequisites are missing", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tb-"));
    const prev = process.env["WOTANN_TB_REAL"];
    const prevDispatch = process.env["WOTANN_TB_DISPATCH"];
    try {
      process.env["WOTANN_TB_REAL"] = "1";
      // Do NOT set WOTANN_TB_DISPATCH — we only test the preflight/fallback path
      delete process.env["WOTANN_TB_DISPATCH"];
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.8, evidence: [] },
      });
      const report = await runTerminalBench(runtime, tmpDir, { limit: 1 });
      // In CI / on a dev box without tb + corpus, preflight fails, mode
      // degrades to simple, and realModeIssue is populated.
      const probe = probeRealModePreconditions(tmpDir);
      if (!probe.ready) {
        expect(report.mode).toBe("simple");
        expect(report.realModeIssue).toBeDefined();
      } else {
        // Unusual path: dev has tb installed AND the corpus is on disk —
        // then the preflight passes, mode stays "real" (since dispatch
        // is gated behind WOTANN_TB_DISPATCH=1 which we didn't set).
        expect(report.mode).toBe("real");
        expect(report.realModeIssue).toBeUndefined();
      }
    } finally {
      if (prev === undefined) delete process.env["WOTANN_TB_REAL"];
      else process.env["WOTANN_TB_REAL"] = prev;
      if (prevDispatch === undefined) delete process.env["WOTANN_TB_DISPATCH"];
      else process.env["WOTANN_TB_DISPATCH"] = prevDispatch;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
