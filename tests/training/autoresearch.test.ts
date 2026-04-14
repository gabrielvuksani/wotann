import { describe, it, expect, vi } from "vitest";
import {
  AutoresearchEngine,
  ExperimentJournal,
  type ExperimentConfig,
  type MetricResult,
  type ModificationGenerator,
  type FileReader,
  type FileWriter,
} from "../../src/training/autoresearch.js";

// ── Experiment Journal Tests ───────────────────────────────

describe("ExperimentJournal", () => {
  it("starts empty", () => {
    const journal = new ExperimentJournal("exp-1");
    expect(journal.getEntries()).toHaveLength(0);
    expect(journal.getSize()).toBe(0);
  });

  it("records entries with experiment ID and timestamp", () => {
    const journal = new ExperimentJournal("exp-1");
    const entry = journal.record({
      cycle: 0,
      modification: {
        id: "mod-1",
        targetFile: "test.ts",
        description: "added cache",
        timestamp: new Date().toISOString(),
        reasoning: "improve speed",
      },
      metricBefore: { value: 100 },
      metricAfter: { value: 90 },
      improvement: 10,
      kept: true,
      diffs: "- old\n+ new",
    });

    expect(entry.experimentId).toBe("exp-1");
    expect(entry.timestamp).toBeTruthy();
    expect(journal.getSize()).toBe(1);
  });

  it("separates kept and discarded entries", () => {
    const journal = new ExperimentJournal("exp-1");
    const base = {
      modification: {
        id: "mod-1",
        targetFile: "test.ts",
        description: "change",
        timestamp: new Date().toISOString(),
        reasoning: "test",
      },
      metricBefore: { value: 100 },
      metricAfter: { value: 95 },
      diffs: "diff",
    };

    journal.record({ ...base, cycle: 0, improvement: 5, kept: true });
    journal.record({ ...base, cycle: 1, improvement: -2, kept: false });
    journal.record({ ...base, cycle: 2, improvement: 3, kept: true });

    expect(journal.getKeptEntries()).toHaveLength(2);
    expect(journal.getDiscardedEntries()).toHaveLength(1);
  });

  it("finds the best entry by improvement", () => {
    const journal = new ExperimentJournal("exp-1");
    const base = {
      modification: {
        id: "mod-1",
        targetFile: "test.ts",
        description: "change",
        timestamp: new Date().toISOString(),
        reasoning: "test",
      },
      metricBefore: { value: 100 },
      diffs: "diff",
    };

    journal.record({ ...base, cycle: 0, metricAfter: { value: 95 }, improvement: 5, kept: true });
    journal.record({ ...base, cycle: 1, metricAfter: { value: 80 }, improvement: 20, kept: true });
    journal.record({ ...base, cycle: 2, metricAfter: { value: 90 }, improvement: 10, kept: true });

    const best = journal.getBestEntry();
    expect(best?.cycle).toBe(1);
    expect(best?.improvement).toBe(20);
  });

  it("calculates total improvement from kept entries", () => {
    const journal = new ExperimentJournal("exp-1");
    const base = {
      modification: {
        id: "mod-1",
        targetFile: "test.ts",
        description: "change",
        timestamp: new Date().toISOString(),
        reasoning: "test",
      },
      metricBefore: { value: 100 },
      metricAfter: { value: 90 },
      diffs: "diff",
    };

    journal.record({ ...base, cycle: 0, improvement: 5, kept: true });
    journal.record({ ...base, cycle: 1, improvement: -2, kept: false }); // discarded, not counted
    journal.record({ ...base, cycle: 2, improvement: 8, kept: true });

    expect(journal.getTotalImprovement()).toBe(13);
  });

  it("returns undefined for best entry when empty", () => {
    const journal = new ExperimentJournal("exp-1");
    expect(journal.getBestEntry()).toBeUndefined();
  });
});

// ── AutoresearchEngine Tests ───────────────────────────────

describe("AutoresearchEngine", () => {
  function createTestSetup() {
    const files = new Map<string, string>();
    files.set("target.ts", "const x = 1;");

    const fileReader: FileReader = async (path) => {
      return files.get(path) ?? "";
    };

    const fileWriter: FileWriter = async (path, content) => {
      files.set(path, content);
    };

    const shadowGit = {
      initialize: vi.fn().mockResolvedValue(true),
      createCheckpoint: vi.fn().mockResolvedValue("checkpoint-hash"),
      restore: vi.fn().mockResolvedValue(true),
      listCheckpoints: vi.fn().mockResolvedValue([]),
    };

    return { files, fileReader, fileWriter, shadowGit };
  }

  it("starts with pending status", () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();
    const generator: ModificationGenerator = async () => null;

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    expect(engine.getStatus()).toBe("pending");
  });

  it("runs a single successful cycle", async () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();

    let callCount = 0;
    const generator: ModificationGenerator = async () => {
      callCount++;
      if (callCount > 1) return null;
      return {
        newContent: "const x = 2; // optimized",
        description: "Incremented x",
        reasoning: "Higher value is better",
      };
    };

    let metricCallCount = 0;
    const config: ExperimentConfig = {
      targetFile: "target.ts",
      metric: {
        name: "value-of-x",
        evaluate: async () => {
          metricCallCount++;
          const result: MetricResult = { value: metricCallCount * 10 };
          return result;
        },
        direction: "maximize",
      },
      maxCycles: 5,
      timeBudgetMs: 30_000,
      constrainedFiles: ["target.ts"],
    };

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    const summary = await engine.startExperiment(config);

    expect(summary.totalCycles).toBeGreaterThanOrEqual(1);
    expect(summary.keptCycles).toBe(1);
    expect(summary.initialMetric.value).toBe(10);
    expect(summary.status).toBe("completed");
  });

  it("discards modifications that worsen the metric", async () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();

    let callCount = 0;
    const generator: ModificationGenerator = async () => {
      callCount++;
      if (callCount > 1) return null;
      return {
        newContent: "const x = 0; // worse",
        description: "Set x to 0",
        reasoning: "Testing",
      };
    };

    let metricCall = 0;
    const config: ExperimentConfig = {
      targetFile: "target.ts",
      metric: {
        name: "value",
        evaluate: async () => {
          metricCall++;
          // First call (baseline) returns 100, second returns 50 (worse)
          return { value: metricCall === 1 ? 100 : 50 };
        },
        direction: "maximize",
      },
      maxCycles: 5,
      timeBudgetMs: 30_000,
      constrainedFiles: ["target.ts"],
    };

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    const summary = await engine.startExperiment(config);

    expect(summary.discardedCycles).toBe(1);
    expect(summary.keptCycles).toBe(0);
    expect(shadowGit.restore).toHaveBeenCalled();
  });

  it("respects maxCycles limit", async () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();

    let metricVal = 0;
    const generator: ModificationGenerator = async () => ({
      newContent: `const x = ${++metricVal};`,
      description: `Set x to ${metricVal}`,
      reasoning: "Always improve",
    });

    const config: ExperimentConfig = {
      targetFile: "target.ts",
      metric: {
        name: "counter",
        evaluate: async () => ({ value: metricVal }),
        direction: "maximize",
      },
      maxCycles: 3,
      timeBudgetMs: 30_000,
      constrainedFiles: ["target.ts"],
    };

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    const summary = await engine.startExperiment(config);

    expect(summary.totalCycles).toBe(3);
    expect(summary.status).toBe("completed");
  });

  it("aborts when requested", async () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();

    let callCount = 0;
    const generator: ModificationGenerator = async () => {
      callCount++;
      // Small delay to allow abort signal to be processed
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        newContent: `v${callCount}`,
        description: `version ${callCount}`,
        reasoning: "testing abort",
      };
    };

    let metricVal = 0;
    const config: ExperimentConfig = {
      targetFile: "target.ts",
      metric: {
        name: "counter",
        evaluate: async () => ({ value: ++metricVal }),
        direction: "maximize",
      },
      maxCycles: 100,
      timeBudgetMs: 30_000,
      constrainedFiles: ["target.ts"],
    };

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    // Abort after a brief delay — generator's 5ms sleep ensures cycles don't finish instantly
    setTimeout(() => engine.abort(), 20);

    const summary = await engine.startExperiment(config);

    expect(summary.status).toBe("aborted");
    expect(summary.totalCycles).toBeLessThan(100);
  });

  it("validates config: rejects empty targetFile", async () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();
    const generator: ModificationGenerator = async () => null;

    const config: ExperimentConfig = {
      targetFile: "",
      metric: { name: "test", evaluate: async () => ({ value: 0 }), direction: "maximize" },
      maxCycles: 1,
      timeBudgetMs: 5000,
      constrainedFiles: [],
    };

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    await expect(engine.startExperiment(config)).rejects.toThrow("targetFile is required");
  });

  it("validates config: rejects timeBudget under 1000ms", async () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();
    const generator: ModificationGenerator = async () => null;

    const config: ExperimentConfig = {
      targetFile: "test.ts",
      metric: { name: "test", evaluate: async () => ({ value: 0 }), direction: "maximize" },
      maxCycles: 1,
      timeBudgetMs: 100,
      constrainedFiles: [],
    };

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    await expect(engine.startExperiment(config)).rejects.toThrow("timeBudgetMs must be at least 1000ms");
  });

  it("validates config: targetFile must be in constrainedFiles", async () => {
    const { fileReader, fileWriter, shadowGit } = createTestSetup();
    const generator: ModificationGenerator = async () => null;

    const config: ExperimentConfig = {
      targetFile: "test.ts",
      metric: { name: "test", evaluate: async () => ({ value: 0 }), direction: "maximize" },
      maxCycles: 1,
      timeBudgetMs: 5000,
      constrainedFiles: ["other.ts"],
    };

    const engine = new AutoresearchEngine(
      "/test",
      generator,
      fileReader,
      fileWriter,
      shadowGit as never,
    );

    await expect(engine.startExperiment(config)).rejects.toThrow("targetFile must be included in constrainedFiles");
  });
});
