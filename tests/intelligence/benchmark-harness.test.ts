import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BenchmarkHarness,
  type BenchmarkType,
  type BenchmarkRun,
} from "../../src/intelligence/benchmark-harness.js";

// Use a unique temp directory for each test run to avoid collisions
const TEST_STORAGE_DIR = join(
  process.env["TMPDIR"] ?? "/tmp",
  `wotann-bench-test-${randomUUID().slice(0, 8)}`,
);

describe("BenchmarkHarness", () => {
  let harness: BenchmarkHarness;

  beforeEach(() => {
    // Clean slate for each test
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true });
    }
    mkdirSync(TEST_STORAGE_DIR, { recursive: true });
    harness = new BenchmarkHarness(TEST_STORAGE_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true });
    }
  });

  // -- runBenchmark ----------------------------------------------------------

  describe("runBenchmark", () => {
    it("runs accuracy benchmark and returns a valid BenchmarkRun", async () => {
      const run = await harness.runBenchmark("accuracy", "claude-opus-4");

      expect(run.id).toBeDefined();
      expect(run.type).toBe("accuracy");
      expect(run.modelId).toBe("claude-opus-4");
      expect(run.score).toBeGreaterThanOrEqual(0);
      expect(run.maxScore).toBeGreaterThan(0);
      expect(run.percentile).toBeGreaterThanOrEqual(0);
      expect(run.percentile).toBeLessThanOrEqual(100);
      expect(run.details.length).toBe(10); // 10 accuracy questions
      expect(run.timestamp).toBeGreaterThan(0);
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("runs terminal-bench benchmark with 5 tests", async () => {
      const run = await harness.runBenchmark("terminal-bench", "gpt-4-turbo");

      expect(run.type).toBe("terminal-bench");
      expect(run.details.length).toBe(5);
    });

    it("runs open-swe benchmark with 5 tests", async () => {
      const run = await harness.runBenchmark("open-swe", "claude-sonnet-4");

      expect(run.type).toBe("open-swe");
      expect(run.details.length).toBe(5);
    });

    it("runs memory-eval benchmark with 20 tests", async () => {
      const run = await harness.runBenchmark("memory-eval", "gpt-3.5-turbo");

      expect(run.type).toBe("memory-eval");
      expect(run.details.length).toBe(20);
    });

    it("persists the run as a JSON file", async () => {
      const run = await harness.runBenchmark("accuracy", "test-model");

      const benchDir = join(TEST_STORAGE_DIR, ".wotann", "benchmarks", "accuracy");
      const files = readdirSync(benchDir).filter((f) => f.endsWith(".json"));

      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`${run.id}.json`);
    });

    it("includes detail entries with test IDs and expected values", async () => {
      const run = await harness.runBenchmark("accuracy", "test-model");

      for (const detail of run.details) {
        expect(detail.testId).toBeDefined();
        expect(detail.expected).toBeDefined();
        expect(detail.actual).toBeDefined();
        expect(typeof detail.passed).toBe("boolean");
        expect(typeof detail.score).toBe("number");
      }
    });

    it("throws for unknown benchmark type", async () => {
      await expect(
        harness.runBenchmark("nonexistent" as BenchmarkType, "test"),
      ).rejects.toThrow("Unknown benchmark type");
    });
  });

  // -- getHistory ------------------------------------------------------------

  describe("getHistory", () => {
    it("returns empty history when no runs exist", () => {
      const history = harness.getHistory("accuracy");

      expect(history.type).toBe("accuracy");
      expect(history.runs).toHaveLength(0);
      expect(history.bestScore).toBe(0);
      expect(history.trend).toBe("stable");
      expect(history.avgImprovement).toBe(0);
    });

    it("returns history with runs sorted by timestamp", async () => {
      await harness.runBenchmark("accuracy", "model-a");
      await harness.runBenchmark("accuracy", "model-b");
      await harness.runBenchmark("accuracy", "model-c");

      const history = harness.getHistory("accuracy");

      expect(history.runs).toHaveLength(3);
      for (let i = 1; i < history.runs.length; i++) {
        expect(history.runs[i]!.timestamp).toBeGreaterThanOrEqual(
          history.runs[i - 1]!.timestamp,
        );
      }
    });

    it("calculates bestScore correctly", async () => {
      // Run multiple benchmarks — all simulated, so scores are 0
      await harness.runBenchmark("accuracy", "model-a");
      await harness.runBenchmark("accuracy", "model-b");

      // Manually inject a run with a higher score
      injectRun(TEST_STORAGE_DIR, {
        id: "injected-best",
        type: "accuracy",
        score: 8,
        maxScore: 10,
        percentile: 80,
        details: [],
        modelId: "injected",
        timestamp: Date.now(),
        durationMs: 100,
      });

      const history = harness.getHistory("accuracy");

      expect(history.bestScore).toBe(80);
    });
  });

  // -- getBestScore ----------------------------------------------------------

  describe("getBestScore", () => {
    it("returns 0 when no runs exist", () => {
      expect(harness.getBestScore("terminal-bench")).toBe(0);
    });

    it("returns the highest percentile from all runs", async () => {
      injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 60));
      injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 85));
      injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 72));

      expect(harness.getBestScore("accuracy")).toBe(85);
    });
  });

  // -- detectTrend -----------------------------------------------------------

  describe("detectTrend", () => {
    it("returns stable when fewer than 2 runs exist", () => {
      expect(harness.detectTrend("accuracy")).toBe("stable");
    });

    it("returns stable for a single run", async () => {
      await harness.runBenchmark("accuracy", "test");

      expect(harness.detectTrend("accuracy")).toBe("stable");
    });

    it("detects improving trend from ascending scores", () => {
      const baseTime = Date.now();
      for (let i = 0; i < 5; i++) {
        injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 50 + i * 10, baseTime + i * 1000));
      }

      // Scores: 50, 60, 70, 80, 90 — clearly improving
      expect(harness.detectTrend("accuracy", 5)).toBe("improving");
    });

    it("detects declining trend from descending scores", () => {
      const baseTime = Date.now();
      for (let i = 0; i < 5; i++) {
        injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 90 - i * 10, baseTime + i * 1000));
      }

      // Scores: 90, 80, 70, 60, 50 — clearly declining
      expect(harness.detectTrend("accuracy", 5)).toBe("declining");
    });

    it("detects stable trend for flat scores", () => {
      const baseTime = Date.now();
      for (let i = 0; i < 5; i++) {
        injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 75, baseTime + i * 1000));
      }

      expect(harness.detectTrend("accuracy", 5)).toBe("stable");
    });

    it("uses only the last windowSize runs", () => {
      const baseTime = Date.now();
      // First 5 runs: improving
      for (let i = 0; i < 5; i++) {
        injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 30 + i * 10, baseTime + i * 1000));
      }
      // Last 3 runs: flat at 75
      for (let i = 0; i < 3; i++) {
        injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 75, baseTime + (5 + i) * 1000));
      }

      // Window of 3 → should see stable (75, 75, 75)
      expect(harness.detectTrend("accuracy", 3)).toBe("stable");
    });
  });

  // -- exportAll -------------------------------------------------------------

  describe("exportAll", () => {
    it("returns empty array when no runs exist", () => {
      expect(harness.exportAll()).toHaveLength(0);
    });

    it("exports runs across all benchmark types", async () => {
      await harness.runBenchmark("accuracy", "model-a");
      await harness.runBenchmark("terminal-bench", "model-b");

      const all = harness.exportAll();

      expect(all.length).toBe(2);
      const types = all.map((r) => r.type);
      expect(types).toContain("accuracy");
      expect(types).toContain("terminal-bench");
    });

    it("returns runs sorted by timestamp", async () => {
      injectRun(TEST_STORAGE_DIR, createMockRun("accuracy", 50, 3000));
      injectRun(TEST_STORAGE_DIR, createMockRun("terminal-bench", 60, 1000));
      injectRun(TEST_STORAGE_DIR, createMockRun("open-swe", 70, 2000));

      const all = harness.exportAll();

      expect(all).toHaveLength(3);
      for (let i = 1; i < all.length; i++) {
        expect(all[i]!.timestamp).toBeGreaterThanOrEqual(all[i - 1]!.timestamp);
      }
    });

    it("ignores corrupted JSON files", () => {
      const benchDir = join(TEST_STORAGE_DIR, ".wotann", "benchmarks", "accuracy");
      mkdirSync(benchDir, { recursive: true });
      writeFileSync(join(benchDir, "corrupted.json"), "NOT JSON{{{");

      // Should not throw
      const all = harness.exportAll();
      expect(all).toHaveLength(0);
    });
  });
});

// -- Test helpers ------------------------------------------------------------

function createMockRun(
  type: BenchmarkType,
  percentile: number,
  timestamp?: number,
): BenchmarkRun {
  return {
    id: randomUUID(),
    type,
    score: percentile,
    maxScore: 100,
    percentile,
    details: [],
    modelId: "mock-model",
    timestamp: timestamp ?? Date.now(),
    durationMs: 50,
  };
}

function injectRun(storageDir: string, run: BenchmarkRun): void {
  const benchDir = join(storageDir, ".wotann", "benchmarks", run.type);
  mkdirSync(benchDir, { recursive: true });
  writeFileSync(join(benchDir, `${run.id}.json`), JSON.stringify(run, null, 2));
}
