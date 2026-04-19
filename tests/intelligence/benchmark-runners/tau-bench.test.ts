/**
 * τ-bench runner tests.
 *
 * Verify:
 *   - Smoke corpus loads with both retail + airline tasks
 *   - Domain filtering works
 *   - BlockedCorpusError on missing corpus when required
 *   - Policy injection is visible in the transcript (when on) and absent (when off)
 *   - Per-domain breakdown in the report
 *   - Dry-run validates setup
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  runTauBench,
  loadTauBenchTasks,
  dryRunTauBench,
  type RunnerRuntime,
} from "../../../src/intelligence/benchmark-runners/tau-bench.js";
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
  verifyResult?: VerifyResult;
  queryThrows?: boolean;
}): RunnerRuntime & {
  calls: { queries: WotannQueryOptions[]; verifies: string[] };
} {
  const calls = { queries: [] as WotannQueryOptions[], verifies: [] as string[] };
  async function* query(options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    calls.queries.push(options);
    if (opts.queryThrows) throw new Error("fake query failure");
    yield { type: "text", content: "policy-aware response", provider: "openai" };
  }
  async function verifyCompletion(task: string): Promise<VerifyResult> {
    calls.verifies.push(task);
    return opts.verifyResult ?? { completed: true, score: 0.9, evidence: [] };
  }
  return { query, verifyCompletion, calls };
}

// ── Smoke loader ──────────────────────────────────────

describe("tau-bench smoke corpus", () => {
  it("loads retail + airline tasks", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const tasks = loadTauBenchTasks(tmpDir);
      expect(tasks.length).toBeGreaterThan(4); // 4 retail + 4 airline
      const domains = new Set(tasks.map((t) => t.domain));
      expect(domains.has("retail")).toBe(true);
      expect(domains.has("airline")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("filters by domains option", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const tasks = loadTauBenchTasks(tmpDir, { domains: ["retail"] });
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((t) => t.domain === "retail")).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Blocked-corpus ────────────────────────────────────

describe("tau-bench blocked corpus", () => {
  it("throws BlockedCorpusError when requireCorpus=true and missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      expect(() => loadTauBenchTasks(tmpDir, { requireCorpus: true })).toThrow(/BLOCKED-NEEDS-CORPUS/);
      try {
        loadTauBenchTasks(tmpDir, { requireCorpus: true });
      } catch (e) {
        expect(isBlockedCorpusError(e)).toBe(true);
        if (isBlockedCorpusError(e)) {
          expect(e.benchmark).toBe("tau-bench");
          expect(e.fetchCommand).toContain("git clone");
          expect(e.fetchCommand).toContain("sierra-research/tau-bench");
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads real on-disk corpus when present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const corpusDir = join(tmpDir, ".wotann", "benchmarks", "tau-bench");
      mkdirSync(corpusDir, { recursive: true });
      const retailLine = JSON.stringify({
        id: "custom-retail",
        domain: "retail",
        userMessage: "I want a refund on a 2-year-old item.",
      });
      writeFileSync(join(corpusDir, "retail-tasks.jsonl"), `${retailLine}\n`);
      const tasks = loadTauBenchTasks(tmpDir);
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe("custom-retail");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Runner execution ──────────────────────────────────

describe("tau-bench runner with policy injection", () => {
  it("injects policy into the query prompt (default on)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTauBench(runtime, tmpDir, { limit: 1, domains: ["retail"] });
      expect(report.policyInjectionEnabled).toBe(true);
      expect(report.results[0]?.policyInjected).toBe(true);
      expect(report.results[0]?.policyId).toBe("tau-bench-retail-v1");
      // Query prompt should contain policy content markers
      const firstPrompt = runtime.calls.queries[0]?.prompt;
      expect(firstPrompt).toContain("Active Policy");
      expect(firstPrompt).toMatch(/refund|policy/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips policy injection when injectPolicy=false (ablation mode)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTauBench(runtime, tmpDir, {
        limit: 1,
        domains: ["retail"],
        injectPolicy: false,
      });
      expect(report.policyInjectionEnabled).toBe(false);
      expect(report.results[0]?.policyInjected).toBe(false);
      expect(report.results[0]?.policyId).toBeUndefined();
      // Query prompt should NOT contain the policy header
      const firstPrompt = runtime.calls.queries[0]?.prompt;
      expect(firstPrompt).not.toContain("Active Policy");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("partitions results byDomain correctly", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTauBench(runtime, tmpDir, { limit: 4 });
      const totalByDomain = report.byDomain.retail.total + report.byDomain.airline.total;
      expect(totalByDomain).toBe(report.totalTasks);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("records error when query throws and sets policyInjected correctly", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const runtime = makeFakeRuntime({ queryThrows: true });
      const report = await runTauBench(runtime, tmpDir, { limit: 1, domains: ["retail"] });
      expect(report.results[0]?.error).toBeDefined();
      expect(report.results[0]?.completed).toBe(false);
      // Policy should still be marked as "would have been injected"
      expect(report.results[0]?.policyInjected).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("emits trajectory including policy metadata per task", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const runtime = makeFakeRuntime({
        verifyResult: { completed: true, score: 0.9, evidence: [] },
      });
      const report = await runTauBench(runtime, tmpDir, { limit: 1, domains: ["retail"] });
      expect(existsSync(report.trajectoryPath)).toBe(true);
      const lines = readFileSync(report.trajectoryPath, "utf-8").trim().split("\n");
      const taskResult = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((e) => e["type"] === "task-result");
      expect(taskResult).toBeDefined();
      const meta = taskResult?.["meta"] as Record<string, unknown> | undefined;
      expect(meta?.["policyInjected"]).toBe(true);
      expect(meta?.["policyId"]).toBe("tau-bench-retail-v1");
      rmSync(report.trajectoryPath, { force: true });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Dry-run ───────────────────────────────────────────

describe("tau-bench dry-run", () => {
  it("reports corpus sizes + policy availability", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const runtime = makeFakeRuntime({});
      const report = dryRunTauBench(runtime, tmpDir);
      expect(report.benchmark).toBe("tau-bench");
      expect(report.corpusSize).toBeGreaterThan(0);
      // Both retail + airline policies are built-in
      const retailPolicy = report.checks.find((c) => c.name === "policy-retail");
      const airlinePolicy = report.checks.find((c) => c.name === "policy-airline");
      expect(retailPolicy?.ok).toBe(true);
      expect(airlinePolicy?.ok).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("flags blocked when requireCorpus=true and no disk corpus", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-tau-"));
    try {
      const report = dryRunTauBench(null, tmpDir, { requireCorpus: true });
      expect(report.ready).toBe(false);
      expect(report.blockedReason).toContain("BLOCKED-NEEDS-CORPUS");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
