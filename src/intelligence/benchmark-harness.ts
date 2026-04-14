/**
 * Benchmark Scoring Harness — measures WOTANN's performance on standard
 * benchmarks and tracks improvement over time.
 *
 * Built-in benchmark types:
 *   - accuracy: basic instruction following (10 questions)
 *   - memory-eval: memory retrieval quality (20 questions)
 *   - terminal-bench: coding tasks (5 placeholder tasks)
 *   - open-swe: issue resolution (5 placeholder tasks)
 *
 * Each run is persisted as JSON in {storageDir}/.wotann/benchmarks/{type}/{runId}.json
 * Trend detection uses a sliding window over the last N runs.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// -- Types -------------------------------------------------------------------

export type BenchmarkType = "terminal-bench" | "open-swe" | "memory-eval" | "accuracy";

export interface BenchmarkDetail {
  readonly testId: string;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
  readonly score: number;
}

export interface BenchmarkRun {
  readonly id: string;
  readonly type: BenchmarkType;
  readonly score: number;
  readonly maxScore: number;
  readonly percentile: number;
  readonly details: readonly BenchmarkDetail[];
  readonly modelId: string;
  readonly timestamp: number;
  readonly durationMs: number;
}

export interface BenchmarkHistory {
  readonly type: BenchmarkType;
  readonly runs: readonly BenchmarkRun[];
  readonly bestScore: number;
  readonly trend: "improving" | "stable" | "declining";
  readonly avgImprovement: number;
}

// -- Built-in test cases -----------------------------------------------------

interface TestCase {
  readonly id: string;
  readonly prompt: string;
  readonly expected: string;
  readonly maxScore: number;
}

const ACCURACY_TESTS: readonly TestCase[] = [
  { id: "acc-01", prompt: "What is 2 + 2?", expected: "4", maxScore: 1 },
  { id: "acc-02", prompt: "Capital of France?", expected: "Paris", maxScore: 1 },
  { id: "acc-03", prompt: "Largest planet in our solar system?", expected: "Jupiter", maxScore: 1 },
  { id: "acc-04", prompt: "What language is TypeScript compiled to?", expected: "JavaScript", maxScore: 1 },
  { id: "acc-05", prompt: "What does HTTP stand for?", expected: "HyperText Transfer Protocol", maxScore: 1 },
  { id: "acc-06", prompt: "Binary representation of 10?", expected: "1010", maxScore: 1 },
  { id: "acc-07", prompt: "What is the time complexity of binary search?", expected: "O(log n)", maxScore: 1 },
  { id: "acc-08", prompt: "What git command creates a new branch?", expected: "git branch", maxScore: 1 },
  { id: "acc-09", prompt: "File extension for TypeScript?", expected: ".ts", maxScore: 1 },
  { id: "acc-10", prompt: "What does JSON stand for?", expected: "JavaScript Object Notation", maxScore: 1 },
];

const TERMINAL_BENCH_TESTS: readonly TestCase[] = [
  { id: "tb-01", prompt: "Create a file called hello.txt with 'Hello World'", expected: "file-created", maxScore: 2 },
  { id: "tb-02", prompt: "Write a function that reverses a string", expected: "function-written", maxScore: 2 },
  { id: "tb-03", prompt: "Generate a test for the reverse function", expected: "test-generated", maxScore: 2 },
  { id: "tb-04", prompt: "Refactor a nested if-else into early returns", expected: "refactored", maxScore: 2 },
  { id: "tb-05", prompt: "Debug: fix off-by-one in array loop", expected: "bug-fixed", maxScore: 2 },
];

const OPEN_SWE_TESTS: readonly TestCase[] = [
  { id: "swe-01", prompt: "Fix: TypeError when accessing undefined property", expected: "null-check-added", maxScore: 2 },
  { id: "swe-02", prompt: "Fix: race condition in async initialization", expected: "await-added", maxScore: 2 },
  { id: "swe-03", prompt: "Fix: incorrect sort order for dates", expected: "comparator-fixed", maxScore: 2 },
  { id: "swe-04", prompt: "Fix: memory leak from unclosed event listener", expected: "listener-removed", maxScore: 2 },
  { id: "swe-05", prompt: "Fix: SQL injection in user search query", expected: "parameterized", maxScore: 2 },
];

const MEMORY_EVAL_TESTS: readonly TestCase[] = Array.from({ length: 20 }, (_, i) => ({
  id: `mem-${String(i + 1).padStart(2, "0")}`,
  prompt: `Memory recall question ${i + 1}`,
  expected: `expected-answer-${i + 1}`,
  maxScore: 1,
}));

const TEST_SUITES: ReadonlyMap<BenchmarkType, readonly TestCase[]> = new Map([
  ["accuracy", ACCURACY_TESTS],
  ["terminal-bench", TERMINAL_BENCH_TESTS],
  ["open-swe", OPEN_SWE_TESTS],
  ["memory-eval", MEMORY_EVAL_TESTS],
]);

// -- Implementation ----------------------------------------------------------

export class BenchmarkHarness {
  private readonly baseDir: string;

  constructor(storageDir: string) {
    this.baseDir = join(storageDir, ".wotann", "benchmarks");
    ensureDir(this.baseDir);
  }

  /**
   * Run a specific benchmark type.
   * Executes all test cases and persists the result.
   */
  async runBenchmark(type: BenchmarkType, modelId: string): Promise<BenchmarkRun> {
    const tests = TEST_SUITES.get(type);
    if (!tests) {
      throw new Error(`Unknown benchmark type: ${type}`);
    }

    const startTime = Date.now();
    const details: BenchmarkDetail[] = [];
    let totalScore = 0;
    let maxPossible = 0;

    for (const test of tests) {
      // Placeholder execution: simulate running the test.
      // In production, this would call the model and evaluate output.
      const result = simulateTestExecution(test);
      details.push(result);
      totalScore += result.score;
      maxPossible += test.maxScore;
    }

    const percentile = maxPossible > 0
      ? Math.round((totalScore / maxPossible) * 100)
      : 0;

    const run: BenchmarkRun = {
      id: randomUUID(),
      type,
      score: totalScore,
      maxScore: maxPossible,
      percentile,
      details,
      modelId,
      timestamp: Date.now(),
      durationMs: Date.now() - startTime,
    };

    this.persistRun(run);
    return run;
  }

  /**
   * Get full history for a benchmark type, including trend analysis.
   */
  getHistory(type: BenchmarkType): BenchmarkHistory {
    const runs = this.loadRuns(type);
    const bestScore = runs.reduce(
      (max, r) => Math.max(max, r.percentile),
      0,
    );
    const trend = this.detectTrend(type, 5);
    const avgImprovement = computeAvgImprovement(runs);

    return { type, runs, bestScore, trend, avgImprovement };
  }

  /**
   * Get the best percentile score across all runs for a benchmark type.
   */
  getBestScore(type: BenchmarkType): number {
    const runs = this.loadRuns(type);
    return runs.reduce((max, r) => Math.max(max, r.percentile), 0);
  }

  /**
   * Detect performance trend from the last N runs.
   *
   * Uses linear regression slope over the window:
   *   slope > 2%  → "improving"
   *   slope < -2% → "declining"
   *   otherwise   → "stable"
   */
  detectTrend(
    type: BenchmarkType,
    windowSize: number = 5,
  ): "improving" | "stable" | "declining" {
    const runs = this.loadRuns(type);

    if (runs.length < 2) {
      return "stable";
    }

    const window = runs.slice(-windowSize);
    const scores = window.map((r) => r.percentile);
    const slope = linearRegressionSlope(scores);

    if (slope > 2) return "improving";
    if (slope < -2) return "declining";
    return "stable";
  }

  /**
   * Export all benchmark runs across all types for external analysis.
   */
  exportAll(): readonly BenchmarkRun[] {
    const allTypes: readonly BenchmarkType[] = [
      "accuracy",
      "terminal-bench",
      "open-swe",
      "memory-eval",
    ];

    const allRuns: BenchmarkRun[] = [];
    for (const type of allTypes) {
      allRuns.push(...this.loadRuns(type));
    }

    return allRuns.sort((a, b) => a.timestamp - b.timestamp);
  }

  // -- Persistence -----------------------------------------------------------

  private persistRun(run: BenchmarkRun): void {
    const typeDir = join(this.baseDir, run.type);
    ensureDir(typeDir);

    const filePath = join(typeDir, `${run.id}.json`);
    writeFileSync(filePath, JSON.stringify(run, null, 2));
  }

  private loadRuns(type: BenchmarkType): readonly BenchmarkRun[] {
    const typeDir = join(this.baseDir, type);

    if (!existsSync(typeDir)) {
      return [];
    }

    const files = readdirSync(typeDir).filter((f) => f.endsWith(".json"));
    const runs: BenchmarkRun[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(typeDir, file), "utf-8");
        const run = JSON.parse(content) as BenchmarkRun;
        runs.push(run);
      } catch {
        // Skip corrupted files
      }
    }

    return runs.sort((a, b) => a.timestamp - b.timestamp);
  }
}

// -- Pure helpers ------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Simulate running a test case.
 * In production, this would invoke the model and evaluate output.
 * For now, returns a placeholder result with partial scoring.
 */
function simulateTestExecution(test: TestCase): BenchmarkDetail {
  return {
    testId: test.id,
    passed: false,
    expected: test.expected,
    actual: "placeholder-not-executed",
    score: 0,
  };
}

/**
 * Compute linear regression slope over a sequence of scores.
 * Returns the slope per run (positive = improving, negative = declining).
 */
function linearRegressionSlope(scores: readonly number[]): number {
  const n = scores.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const score = scores[i]!;
    sumX += i;
    sumY += score;
    sumXY += i * score;
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Compute average improvement between consecutive runs.
 */
function computeAvgImprovement(runs: readonly BenchmarkRun[]): number {
  if (runs.length < 2) return 0;

  let totalDiff = 0;
  for (let i = 1; i < runs.length; i++) {
    totalDiff += runs[i]!.percentile - runs[i - 1]!.percentile;
  }

  return Math.round((totalDiff / (runs.length - 1)) * 100) / 100;
}
