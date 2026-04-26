/**
 * Binary Feedback Collector — thumbs up/down for DPO/KTO training.
 *
 * FROM CURSOR RESEARCH:
 * Reward design: +0.75 accepted, -0.25 rejected, 0 no signal.
 * Simple binary feedback is enough for meaningful improvement.
 *
 * FROM RESEARCH:
 * KTO (Kahneman-Tversky Optimization) works with simple binary feedback
 * (thumbs up/down) without needing paired preferences. This matches
 * how users naturally give feedback in a coding tool.
 *
 * Pipeline:
 * 1. Collect thumbs up/down on responses
 * 2. Store as JSONL preference data
 * 3. When 500+ pairs accumulated → ready for DPO/KTO training
 * 4. Training via mlx-tune on Apple Silicon
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWotannHome, resolveWotannHomeSubdir } from "../utils/wotann-home.js";

// ── Types ────────────────────────────────────────────────

export type FeedbackType = "positive" | "negative" | "neutral";

export interface FeedbackEntry {
  readonly id: string;
  readonly prompt: string;
  readonly response: string;
  readonly feedback: FeedbackType;
  readonly reward: number; // +0.75 positive, -0.25 negative, 0 neutral
  readonly provider: string;
  readonly model: string;
  readonly timestamp: number;
  readonly sessionId: string;
  readonly taskDomain?: string; // From domain-skill-router
}

export interface FeedbackStats {
  readonly total: number;
  readonly positive: number;
  readonly negative: number;
  readonly neutral: number;
  readonly acceptRate: number; // positive / (positive + negative)
  readonly readyForTraining: boolean; // 500+ non-neutral entries
}

// ── Feedback Collector ───────────────────────────────────

export class FeedbackCollector {
  private readonly dataPath: string;
  private stats: FeedbackStats;

  constructor() {
    const wotannDir = resolveWotannHome();
    const feedbackDir = join(wotannDir, "feedback");
    if (!existsSync(feedbackDir)) {
      mkdirSync(feedbackDir, { recursive: true });
    }
    this.dataPath = join(feedbackDir, "preferences.jsonl");
    this.stats = this.computeStats();
  }

  /**
   * Record feedback for a response.
   * Called when user gives thumbs up/down or accepts/rejects a suggestion.
   */
  recordFeedback(
    prompt: string,
    response: string,
    feedback: FeedbackType,
    provider: string,
    model: string,
    sessionId: string,
    taskDomain?: string,
  ): void {
    const reward = feedback === "positive" ? 0.75 : feedback === "negative" ? -0.25 : 0;

    const entry: FeedbackEntry = {
      id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      prompt,
      response,
      feedback,
      reward,
      provider,
      model,
      timestamp: Date.now(),
      sessionId,
      taskDomain,
    };

    // Append to JSONL file (never overwrites, always appends)
    appendFileSync(this.dataPath, JSON.stringify(entry) + "\n");

    // Update cached stats
    this.stats = this.computeStats();
  }

  /**
   * Record implicit feedback from user actions.
   * - User kept the response → positive
   * - User regenerated → negative
   * - User edited the response → neutral (mixed signal)
   */
  recordImplicitFeedback(
    prompt: string,
    response: string,
    action: "kept" | "regenerated" | "edited",
    provider: string,
    model: string,
    sessionId: string,
  ): void {
    const feedback: FeedbackType =
      action === "kept" ? "positive" : action === "regenerated" ? "negative" : "neutral";

    this.recordFeedback(prompt, response, feedback, provider, model, sessionId);
  }

  /**
   * Export feedback data as KTO-format JSONL for mlx-tune.
   * KTO format: {"prompt": "...", "completion": "...", "label": true/false}
   */
  exportForKTO(): string {
    const dir = resolveWotannHomeSubdir("training-data");
    const outputPath = join(dir, `kto-${Date.now()}.jsonl`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const entries = this.getAllEntries();
    const lines = entries
      .filter((e) => e.feedback !== "neutral") // KTO needs binary labels
      .map((e) =>
        JSON.stringify({
          prompt: e.prompt,
          completion: e.response,
          label: e.feedback === "positive",
        }),
      );

    writeFileSync(outputPath, lines.join("\n") + "\n");
    return outputPath;
  }

  /**
   * Export as DPO-format (requires paired preferences).
   * Groups by prompt and pairs positive/negative responses.
   */
  exportForDPO(): string {
    const dir = resolveWotannHomeSubdir("training-data");
    const outputPath = join(dir, `dpo-${Date.now()}.jsonl`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const entries = this.getAllEntries();

    // Group by prompt (fuzzy: first 100 chars)
    const groups = new Map<string, { positive: string[]; negative: string[] }>();
    for (const entry of entries) {
      const key = entry.prompt.slice(0, 100);
      const group = groups.get(key) ?? { positive: [], negative: [] };
      if (entry.feedback === "positive") {
        group.positive.push(entry.response);
      } else if (entry.feedback === "negative") {
        group.negative.push(entry.response);
      }
      groups.set(key, group);
    }

    // Create pairs
    const lines: string[] = [];
    for (const [prompt, group] of groups) {
      for (const chosen of group.positive) {
        for (const rejected of group.negative) {
          lines.push(
            JSON.stringify({
              prompt,
              chosen,
              rejected,
            }),
          );
        }
      }
    }

    writeFileSync(outputPath, lines.join("\n") + "\n");
    return outputPath;
  }

  /**
   * Get current stats.
   */
  getStats(): FeedbackStats {
    return this.stats;
  }

  /**
   * Read all feedback entries.
   */
  private getAllEntries(): readonly FeedbackEntry[] {
    if (!existsSync(this.dataPath)) return [];

    try {
      const content = readFileSync(this.dataPath, "utf-8");
      return content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as FeedbackEntry);
    } catch {
      return [];
    }
  }

  /**
   * Compute stats from stored data.
   */
  private computeStats(): FeedbackStats {
    const entries = this.getAllEntries();
    const positive = entries.filter((e) => e.feedback === "positive").length;
    const negative = entries.filter((e) => e.feedback === "negative").length;
    const neutral = entries.filter((e) => e.feedback === "neutral").length;
    const total = entries.length;
    const rated = positive + negative;

    return {
      total,
      positive,
      negative,
      neutral,
      acceptRate: rated > 0 ? positive / rated : 0,
      readyForTraining: rated >= 500,
    };
  }
}
