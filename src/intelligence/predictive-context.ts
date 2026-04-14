/**
 * Predictive Context Loader — predict what context will be needed and preload it.
 *
 * Analyzes user's past file access patterns and query patterns to predict
 * which files will be needed next. Preloads predicted files into context
 * within a token budget. Tracks prediction accuracy over time.
 */

// ── Types ─────────────────────────────────────────────────

export interface PredictedFile {
  readonly path: string;
  readonly confidence: number;
  readonly reason: string;
  readonly estimatedTokens: number;
}

export interface PreloadResult {
  readonly preloaded: readonly PredictedFile[];
  readonly skipped: readonly PredictedFile[];
  readonly totalTokensUsed: number;
  readonly budgetRemaining: number;
}

export interface PredictionAccuracy {
  readonly totalPredictions: number;
  readonly correctPredictions: number;
  readonly accuracyPercent: number;
  readonly recentAccuracyPercent: number;
}

interface FileAccessRecord {
  readonly path: string;
  readonly timestamp: number;
  readonly queryContext: string;
}

interface CoOccurrence {
  readonly fileA: string;
  readonly fileB: string;
  readonly count: number;
}

// ── Constants ─────────────────────────────────────────────

const TOKENS_PER_LINE_ESTIMATE = 4;
const LINES_PER_FILE_ESTIMATE = 200;
const DEFAULT_FILE_TOKENS = TOKENS_PER_LINE_ESTIMATE * LINES_PER_FILE_ESTIMATE;
const RECENT_WINDOW = 20;

// ── Engine ────────────────────────────────────────────────

export class PredictiveContextLoader {
  private readonly accessHistory: FileAccessRecord[] = [];
  private readonly predictionLog: Array<{
    predicted: readonly string[];
    actual: readonly string[];
    timestamp: number;
  }> = [];
  private readonly maxHistory: number;

  constructor(maxHistory: number = 500) {
    this.maxHistory = maxHistory;
  }

  /**
   * Analyze recent file access and query patterns to predict next files.
   */
  predictNextFiles(
    recentFiles: readonly string[],
    recentQueries: readonly string[],
  ): readonly PredictedFile[] {
    const predictions: PredictedFile[] = [];
    const seen = new Set<string>();

    // Strategy 1: Co-occurrence — files frequently accessed together
    const coOccurrences = this.computeCoOccurrences();
    for (const file of recentFiles) {
      const related = coOccurrences
        .filter((co) => co.fileA === file || co.fileB === file)
        .sort((a, b) => b.count - a.count);

      for (const co of related.slice(0, 3)) {
        const predicted = co.fileA === file ? co.fileB : co.fileA;
        if (!seen.has(predicted) && !recentFiles.includes(predicted)) {
          seen.add(predicted);
          predictions.push({
            path: predicted,
            confidence: Math.min(0.9, co.count * 0.15),
            reason: `Co-accessed with ${file} (${co.count} times)`,
            estimatedTokens: DEFAULT_FILE_TOKENS,
          });
        }
      }
    }

    // Strategy 2: Directory siblings — files in the same directory
    const recentDirs = [
      ...new Set(recentFiles.map((f) => f.split("/").slice(0, -1).join("/"))),
    ];
    for (const dir of recentDirs) {
      const siblingAccesses = this.accessHistory
        .filter(
          (r) =>
            r.path.startsWith(dir + "/") && !recentFiles.includes(r.path),
        )
        .reduce((acc, r) => {
          acc.set(r.path, (acc.get(r.path) ?? 0) + 1);
          return acc;
        }, new Map<string, number>());

      for (const [path, count] of siblingAccesses) {
        if (!seen.has(path)) {
          seen.add(path);
          predictions.push({
            path,
            confidence: Math.min(0.7, count * 0.1),
            reason: `Sibling file in ${dir} (accessed ${count} times)`,
            estimatedTokens: DEFAULT_FILE_TOKENS,
          });
        }
      }
    }

    // Strategy 3: Query-keyword matching — files whose names match recent queries
    for (const query of recentQueries) {
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);

      for (const record of this.accessHistory) {
        const pathLower = record.path.toLowerCase();
        const matchCount = keywords.filter((kw) =>
          pathLower.includes(kw),
        ).length;

        if (
          matchCount > 0 &&
          !seen.has(record.path) &&
          !recentFiles.includes(record.path)
        ) {
          seen.add(record.path);
          predictions.push({
            path: record.path,
            confidence: Math.min(0.6, matchCount * 0.2),
            reason: `Name matches query keywords (${matchCount} matches)`,
            estimatedTokens: DEFAULT_FILE_TOKENS,
          });
        }
      }
    }

    // Sort by confidence descending
    return [...predictions].sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Select files to preload within a token budget.
   */
  preloadContext(
    predictions: readonly PredictedFile[],
    budget: number,
  ): PreloadResult {
    const preloaded: PredictedFile[] = [];
    const skipped: PredictedFile[] = [];
    let tokensUsed = 0;

    for (const prediction of predictions) {
      if (tokensUsed + prediction.estimatedTokens <= budget) {
        preloaded.push(prediction);
        tokensUsed += prediction.estimatedTokens;
      } else {
        skipped.push(prediction);
      }
    }

    return {
      preloaded,
      skipped,
      totalTokensUsed: tokensUsed,
      budgetRemaining: budget - tokensUsed,
    };
  }

  /**
   * Record which files were actually used. Updates the access history
   * and logs prediction accuracy.
   */
  recordActual(
    filesUsed: readonly string[],
    queryContext: string = "",
  ): void {
    const now = Date.now();

    // Record access history
    for (const path of filesUsed) {
      this.accessHistory.push({ path, timestamp: now, queryContext });
    }

    // Trim history
    if (this.accessHistory.length > this.maxHistory) {
      this.accessHistory.splice(0, this.accessHistory.length - this.maxHistory);
    }

    // Log for accuracy tracking (if we had predictions pending)
    if (this.predictionLog.length > 0) {
      const lastPrediction = this.predictionLog[this.predictionLog.length - 1];
      if (lastPrediction && now - lastPrediction.timestamp < 60_000) {
        // Update the last prediction with actual results
        this.predictionLog[this.predictionLog.length - 1] = {
          ...lastPrediction,
          actual: filesUsed,
        };
      }
    }
  }

  /**
   * Log a set of predictions for accuracy tracking.
   */
  logPredictions(predicted: readonly string[]): void {
    this.predictionLog.push({
      predicted,
      actual: [],
      timestamp: Date.now(),
    });
  }

  /**
   * Compute prediction accuracy statistics.
   */
  getAccuracy(): PredictionAccuracy {
    const completedPredictions = this.predictionLog.filter(
      (p) => p.actual.length > 0,
    );

    if (completedPredictions.length === 0) {
      return {
        totalPredictions: 0,
        correctPredictions: 0,
        accuracyPercent: 0,
        recentAccuracyPercent: 0,
      };
    }

    let totalCorrect = 0;
    let recentCorrect = 0;

    const recentEntries = completedPredictions.slice(-RECENT_WINDOW);

    for (const entry of completedPredictions) {
      const actualSet = new Set(entry.actual);
      const correct = entry.predicted.filter((p) => actualSet.has(p)).length;
      if (correct > 0) totalCorrect++;
    }

    for (const entry of recentEntries) {
      const actualSet = new Set(entry.actual);
      const correct = entry.predicted.filter((p) => actualSet.has(p)).length;
      if (correct > 0) recentCorrect++;
    }

    return {
      totalPredictions: completedPredictions.length,
      correctPredictions: totalCorrect,
      accuracyPercent:
        completedPredictions.length > 0
          ? (totalCorrect / completedPredictions.length) * 100
          : 0,
      recentAccuracyPercent:
        recentEntries.length > 0
          ? (recentCorrect / recentEntries.length) * 100
          : 0,
    };
  }

  /** Get access history length */
  getHistoryLength(): number {
    return this.accessHistory.length;
  }

  // ── Private ───────────────────────────────────────────

  private computeCoOccurrences(): readonly CoOccurrence[] {
    const windowMs = 60_000; // 1-minute window
    const coMap = new Map<string, number>();

    for (let i = 0; i < this.accessHistory.length; i++) {
      const a = this.accessHistory[i]!;
      for (let j = i + 1; j < this.accessHistory.length; j++) {
        const b = this.accessHistory[j]!;
        if (Math.abs(a.timestamp - b.timestamp) > windowMs) break;
        if (a.path === b.path) continue;

        const key =
          a.path < b.path ? `${a.path}|${b.path}` : `${b.path}|${a.path}`;
        coMap.set(key, (coMap.get(key) ?? 0) + 1);
      }
    }

    const results: CoOccurrence[] = [];
    for (const [key, count] of coMap) {
      const [fileA, fileB] = key.split("|") as [string, string];
      results.push({ fileA, fileB, count });
    }

    return results.sort((a, b) => b.count - a.count);
  }
}
