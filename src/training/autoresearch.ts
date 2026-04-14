/**
 * Autoresearch Engine: autonomous code optimization loop.
 * Inspired by karpathy/autoresearch — modify, test, evaluate, keep/discard.
 *
 * Safety constraints:
 * - Single-file editing per cycle (blast-radius control)
 * - Shadow-git for safe rollback (user's .git never touched)
 * - Fixed time-budget per experiment (default 5 min)
 * - Full journal of all modifications with reasoning
 */

import { ShadowGit } from "../utils/shadow-git.js";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────

export interface ExperimentConfig {
  readonly targetFile: string;
  readonly metric: MetricDefinition;
  readonly maxCycles: number;
  readonly timeBudgetMs: number;
  readonly constrainedFiles: readonly string[];
}

export interface MetricDefinition {
  readonly name: string;
  readonly evaluate: (targetFile: string) => Promise<MetricResult>;
  readonly direction: "minimize" | "maximize";
}

export interface MetricResult {
  readonly value: number;
  readonly details?: string;
}

export interface ExperimentResult {
  readonly cycle: number;
  readonly modification: ModificationRecord;
  readonly metric: MetricResult;
  readonly improvement: number;
  readonly kept: boolean;
  readonly diffs: string;
}

export interface ModificationRecord {
  readonly id: string;
  readonly targetFile: string;
  readonly description: string;
  readonly timestamp: string;
  readonly reasoning: string;
}

export interface JournalEntry {
  readonly experimentId: string;
  readonly cycle: number;
  readonly modification: ModificationRecord;
  readonly metricBefore: MetricResult;
  readonly metricAfter: MetricResult;
  readonly improvement: number;
  readonly kept: boolean;
  readonly diffs: string;
  readonly timestamp: string;
}

export interface ExperimentSummary {
  readonly experimentId: string;
  readonly config: ExperimentConfig;
  readonly totalCycles: number;
  readonly keptCycles: number;
  readonly discardedCycles: number;
  readonly bestMetric: MetricResult;
  readonly initialMetric: MetricResult;
  readonly totalImprovement: number;
  readonly durationMs: number;
  readonly status: ExperimentStatus;
}

export type ExperimentStatus = "pending" | "running" | "completed" | "aborted" | "timeout";

export type ModificationGenerator = (
  targetFile: string,
  currentContent: string,
  history: readonly JournalEntry[],
) => Promise<ModificationProposal | null>;

export interface ModificationProposal {
  readonly newContent: string;
  readonly description: string;
  readonly reasoning: string;
}

// ── Experiment Journal ─────────────────────────────────────

export class ExperimentJournal {
  private readonly entries: JournalEntry[] = [];
  private readonly experimentId: string;

  constructor(experimentId: string) {
    this.experimentId = experimentId;
  }

  record(entry: Omit<JournalEntry, "experimentId" | "timestamp">): JournalEntry {
    const fullEntry: JournalEntry = {
      ...entry,
      experimentId: this.experimentId,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(fullEntry);
    return fullEntry;
  }

  getEntries(): readonly JournalEntry[] {
    return [...this.entries];
  }

  getKeptEntries(): readonly JournalEntry[] {
    return this.entries.filter((e) => e.kept);
  }

  getDiscardedEntries(): readonly JournalEntry[] {
    return this.entries.filter((e) => !e.kept);
  }

  getBestEntry(): JournalEntry | undefined {
    if (this.entries.length === 0) return undefined;

    return this.entries.reduce((best, entry) => {
      if (entry.improvement > best.improvement) return entry;
      return best;
    });
  }

  getTotalImprovement(): number {
    return this.entries
      .filter((e) => e.kept)
      .reduce((total, e) => total + e.improvement, 0);
  }

  getSize(): number {
    return this.entries.length;
  }
}

// ── Autoresearch Engine ────────────────────────────────────

export class AutoresearchEngine {
  private readonly shadowGit: ShadowGit;
  private readonly modificationGenerator: ModificationGenerator;
  private readonly fileReader: FileReader;
  private readonly fileWriter: FileWriter;
  private status: ExperimentStatus = "pending";
  private abortRequested = false;

  constructor(
    workDir: string,
    modificationGenerator: ModificationGenerator,
    fileReader: FileReader,
    fileWriter: FileWriter,
    shadowGit?: ShadowGit,
  ) {
    this.shadowGit = shadowGit ?? new ShadowGit(workDir);
    this.modificationGenerator = modificationGenerator;
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
  }

  getStatus(): ExperimentStatus {
    return this.status;
  }

  abort(): void {
    this.abortRequested = true;
  }

  async startExperiment(config: ExperimentConfig): Promise<ExperimentSummary> {
    const experimentId = randomUUID();
    const journal = new ExperimentJournal(experimentId);
    const startTime = Date.now();

    this.status = "running";
    this.abortRequested = false;

    // Validate configuration
    validateConfig(config);

    // Initialize shadow git for safe rollback
    await this.shadowGit.initialize();
    const baseCheckpoint = await this.shadowGit.createCheckpoint(`experiment-${experimentId}-base`);

    // Get baseline metric
    const initialMetric = await config.metric.evaluate(config.targetFile);
    let currentBestMetric = initialMetric;

    let completedCycles = 0;

    try {
      for (let cycle = 0; cycle < config.maxCycles; cycle++) {
        // Check time budget
        if (Date.now() - startTime >= config.timeBudgetMs) {
          this.status = "timeout";
          break;
        }

        // Check abort request
        if (this.abortRequested) {
          this.status = "aborted";
          break;
        }

        const result = await this.runCycle(
          config,
          cycle,
          currentBestMetric,
          journal,
        );

        if (result === null) {
          // Generator exhausted — no more modifications to try
          break;
        }

        if (result.kept) {
          currentBestMetric = result.metric;
        }

        completedCycles++;
      }

      if (this.status === "running") {
        this.status = "completed";
      }
    } catch {
      this.status = "aborted";
      // Restore to base checkpoint on error
      await this.shadowGit.restore(baseCheckpoint);
    }

    return buildSummary(
      experimentId,
      config,
      journal,
      initialMetric,
      currentBestMetric,
      completedCycles,
      Date.now() - startTime,
      this.status,
    );
  }

  private async runCycle(
    config: ExperimentConfig,
    cycle: number,
    currentBestMetric: MetricResult,
    journal: ExperimentJournal,
  ): Promise<ExperimentResult | null> {
    // Read current file content
    const currentContent = await this.fileReader(config.targetFile);

    // Create checkpoint before modification
    const checkpoint = await this.shadowGit.createCheckpoint(
      `cycle-${cycle}-before`,
    );

    // Generate modification proposal
    const proposal = await this.modificationGenerator(
      config.targetFile,
      currentContent,
      journal.getEntries(),
    );

    if (proposal === null) {
      return null;
    }

    const modification: ModificationRecord = {
      id: randomUUID(),
      targetFile: config.targetFile,
      description: proposal.description,
      timestamp: new Date().toISOString(),
      reasoning: proposal.reasoning,
    };

    // Apply modification
    await this.fileWriter(config.targetFile, proposal.newContent);

    // Evaluate metric after modification
    let metricAfter: MetricResult;
    try {
      metricAfter = await config.metric.evaluate(config.targetFile);
    } catch {
      // If evaluation fails, discard and restore
      await this.shadowGit.restore(checkpoint);
      await this.fileWriter(config.targetFile, currentContent);

      const failResult = buildCycleResult(
        cycle,
        modification,
        { value: Number.NaN },
        0,
        false,
        "Metric evaluation failed",
      );

      journal.record({
        cycle,
        modification,
        metricBefore: currentBestMetric,
        metricAfter: { value: Number.NaN },
        improvement: 0,
        kept: false,
        diffs: "Metric evaluation failed — modification discarded",
      });

      return failResult;
    }

    // Calculate improvement
    const improvement = calculateImprovement(
      currentBestMetric,
      metricAfter,
      config.metric.direction,
    );

    const kept = improvement > 0;

    if (!kept) {
      // Revert to checkpoint
      await this.shadowGit.restore(checkpoint);
      await this.fileWriter(config.targetFile, currentContent);
    } else {
      // Create checkpoint for successful modification
      await this.shadowGit.createCheckpoint(
        `cycle-${cycle}-kept-${modification.id.slice(0, 8)}`,
      );
    }

    const diffs = computeDiff(currentContent, proposal.newContent);

    journal.record({
      cycle,
      modification,
      metricBefore: currentBestMetric,
      metricAfter,
      improvement,
      kept,
      diffs,
    });

    return buildCycleResult(cycle, modification, metricAfter, improvement, kept, diffs);
  }
}

// ── Type Aliases for IO ────────────────────────────────────

export type FileReader = (path: string) => Promise<string>;
export type FileWriter = (path: string, content: string) => Promise<void>;

// ── Helpers ────────────────────────────────────────────────

function validateConfig(config: ExperimentConfig): void {
  if (!config.targetFile) {
    throw new Error("targetFile is required");
  }
  if (config.maxCycles < 1) {
    throw new Error("maxCycles must be at least 1");
  }
  if (config.timeBudgetMs < 1000) {
    throw new Error("timeBudgetMs must be at least 1000ms");
  }
  if (config.constrainedFiles.length > 0 && !config.constrainedFiles.includes(config.targetFile)) {
    throw new Error("targetFile must be included in constrainedFiles");
  }
}

function calculateImprovement(
  before: MetricResult,
  after: MetricResult,
  direction: "minimize" | "maximize",
): number {
  if (Number.isNaN(after.value)) return -1;

  if (direction === "maximize") {
    return after.value - before.value;
  }
  return before.value - after.value;
}

function computeDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  const diffs: string[] = [];
  const maxLines = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLines; i++) {
    const bLine = beforeLines[i];
    const aLine = afterLines[i];

    if (bLine !== aLine) {
      if (bLine !== undefined) diffs.push(`- ${bLine}`);
      if (aLine !== undefined) diffs.push(`+ ${aLine}`);
    }
  }

  return diffs.join("\n");
}

function buildCycleResult(
  cycle: number,
  modification: ModificationRecord,
  metric: MetricResult,
  improvement: number,
  kept: boolean,
  diffs: string,
): ExperimentResult {
  return { cycle, modification, metric, improvement, kept, diffs };
}

function buildSummary(
  experimentId: string,
  config: ExperimentConfig,
  journal: ExperimentJournal,
  initialMetric: MetricResult,
  bestMetric: MetricResult,
  totalCycles: number,
  durationMs: number,
  status: ExperimentStatus,
): ExperimentSummary {
  return {
    experimentId,
    config,
    totalCycles,
    keptCycles: journal.getKeptEntries().length,
    discardedCycles: journal.getDiscardedEntries().length,
    bestMetric,
    initialMetric,
    totalImprovement: journal.getTotalImprovement(),
    durationMs,
    status,
  };
}
