/**
 * Similarity-Based Doom Loop Detection Middleware.
 *
 * FROM TERMINALBENCH RESEARCH (ForgeCode):
 * "The #1 cause of wasted turns: the agent repeating the same failing
 *  approach with minor variations. MD5-based loop detection misses these
 *  because the args differ slightly each time."
 *
 * This middleware uses Jaccard trigram similarity (not just exact hash)
 * to detect when the agent is stuck in a loop of near-identical actions.
 * It detects three patterns:
 *
 * 1. CONSECUTIVE: Exact same tool call repeated [A, A, A]
 * 2. SEQUENCE: Repeating sequence [A, B, C, A, B, C]
 * 3. SIMILARITY: Near-identical calls (85%+ Jaccard coefficient)
 *
 * THRESHOLDS:
 * - Warn at 3 repetitions (inject a system reminder)
 * - Block at 5 repetitions (force the agent to try a different approach)
 *
 * This middleware wraps the DoomLoopDetector from hooks/doom-loop-detector.ts
 * and integrates it into the middleware pipeline with proper before/after hooks.
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// -- Trigram Similarity Engine -----------------------------------------

/**
 * Extract character trigrams from a string.
 * Returns a Set of all 3-character substrings.
 */
function extractTrigrams(text: string): ReadonlySet<string> {
  const trigrams = new Set<string>();
  const normalized = text.toLowerCase();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Compute Jaccard similarity coefficient between two strings
 * using their trigram sets.
 * Returns 0.0 (completely different) to 1.0 (identical).
 */
export function jaccardTrigramSimilarity(a: string, b: string): number {
  const trigramsA = extractTrigrams(a);
  const trigramsB = extractTrigrams(b);

  if (trigramsA.size === 0 && trigramsB.size === 0) return 1.0;
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) {
      intersectionSize++;
    }
  }

  const unionSize = trigramsA.size + trigramsB.size - intersectionSize;
  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

// -- Types -------------------------------------------------------------

export type DoomLoopType = "consecutive" | "sequence" | "similarity";

export interface DoomLoopDetection {
  readonly detected: boolean;
  readonly type: DoomLoopType | null;
  readonly count: number;
  readonly sequenceLength?: number;
  readonly similarity?: number;
}

export interface ToolCallRecord {
  readonly toolName: string;
  readonly argsFingerprint: string;
  readonly fullArgs: string;
  readonly turn: number;
}

export interface DoomLoopState {
  readonly historyLength: number;
  readonly lastDetection: DoomLoopDetection | null;
  readonly totalWarnings: number;
  readonly totalBlocks: number;
}

export interface DoomLoopConfig {
  /** Number of repetitions before warning. */
  readonly warnThreshold: number;
  /** Number of repetitions before blocking. */
  readonly blockThreshold: number;
  /** Minimum Jaccard similarity to count as "near-identical". */
  readonly similarityThreshold: number;
  /** Maximum sequence length to check for repeating patterns. */
  readonly maxSequenceLength: number;
  /** Maximum history entries to keep. */
  readonly maxHistory: number;
}

const DEFAULT_CONFIG: DoomLoopConfig = {
  warnThreshold: 3,
  blockThreshold: 5,
  similarityThreshold: 0.85,
  maxSequenceLength: 5,
  maxHistory: 50,
};

// -- Doom Loop Detector ------------------------------------------------

/**
 * DoomLoopMiddleware maintains a history of tool calls and detects
 * repetitive patterns using exact matching and trigram similarity.
 */
export class DoomLoopMiddleware {
  private readonly config: DoomLoopConfig;
  private history: ToolCallRecord[] = [];
  private currentTurn = 0;
  private lastDetection: DoomLoopDetection | null = null;
  private totalWarnings = 0;
  private totalBlocks = 0;

  constructor(config?: Partial<DoomLoopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a tool call and check for doom loops.
   * Returns a detection result indicating if a loop was found.
   */
  record(toolName: string, args: Record<string, unknown>): DoomLoopDetection {
    this.currentTurn++;
    const fullArgs = JSON.stringify({ tool: toolName, args });
    const argsFingerprint = simpleHash(fullArgs);

    this.history = [
      ...this.history,
      { toolName, argsFingerprint, fullArgs, turn: this.currentTurn },
    ];

    // Trim history to prevent unbounded growth
    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory);
    }

    // Check patterns in order of specificity
    const consecutive = this.detectConsecutive();
    if (consecutive) {
      this.lastDetection = consecutive;
      return consecutive;
    }

    const sequence = this.detectRepeatingSequence();
    if (sequence) {
      this.lastDetection = sequence;
      return sequence;
    }

    const similarity = this.detectSimilarity();
    if (similarity) {
      this.lastDetection = similarity;
      return similarity;
    }

    const noLoop: DoomLoopDetection = { detected: false, type: null, count: 0 };
    this.lastDetection = noLoop;
    return noLoop;
  }

  /**
   * Build a system reminder for the detected doom loop.
   * Returns null if the count is below warning threshold.
   */
  buildReminder(detection: DoomLoopDetection): string | null {
    if (!detection.detected) return null;

    if (detection.count >= this.config.blockThreshold) {
      this.totalBlocks++;
      return this.buildBlockMessage(detection);
    }

    if (detection.count >= this.config.warnThreshold) {
      this.totalWarnings++;
      return this.buildWarnMessage(detection);
    }

    return null;
  }

  /**
   * Get the current state for diagnostics.
   */
  getState(): DoomLoopState {
    return {
      historyLength: this.history.length,
      lastDetection: this.lastDetection,
      totalWarnings: this.totalWarnings,
      totalBlocks: this.totalBlocks,
    };
  }

  /**
   * Reset for a new task.
   */
  reset(): void {
    this.history = [];
    this.currentTurn = 0;
    this.lastDetection = null;
    this.totalWarnings = 0;
    this.totalBlocks = 0;
  }

  // -- Detection Algorithms --------------------------------------------

  /**
   * Pattern 1: Consecutive identical tool calls [A, A, A].
   * Uses exact fingerprint matching.
   */
  private detectConsecutive(): DoomLoopDetection | null {
    if (this.history.length < this.config.warnThreshold) return null;

    const last = this.history[this.history.length - 1]!;
    let count = 0;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i]!;
      if (
        entry.toolName === last.toolName &&
        entry.argsFingerprint === last.argsFingerprint
      ) {
        count++;
      } else {
        break;
      }
    }

    if (count >= this.config.warnThreshold) {
      return { detected: true, type: "consecutive", count };
    }

    return null;
  }

  /**
   * Pattern 2: Repeating sequence [A, B, C, A, B, C].
   * Checks for repeating subsequences of length 2 through maxSequenceLength.
   */
  private detectRepeatingSequence(): DoomLoopDetection | null {
    for (
      let seqLen = 2;
      seqLen <= this.config.maxSequenceLength;
      seqLen++
    ) {
      if (this.history.length < seqLen * this.config.warnThreshold) continue;

      const tail = this.history.slice(-seqLen);
      let repetitions = 0;

      for (
        let i = this.history.length - seqLen;
        i >= 0;
        i -= seqLen
      ) {
        const candidate = this.history.slice(i, i + seqLen);
        if (this.sequencesMatch(tail, candidate)) {
          repetitions++;
        } else {
          break;
        }
      }

      const totalCount = repetitions + 1; // Include the tail sequence
      if (totalCount >= this.config.warnThreshold) {
        return {
          detected: true,
          type: "sequence",
          count: totalCount,
          sequenceLength: seqLen,
        };
      }
    }

    return null;
  }

  /**
   * Pattern 3: Near-identical calls using Jaccard trigram similarity.
   * Catches cases where the agent makes tiny variations of the same
   * failing approach (e.g., changing one character in a regex pattern).
   */
  private detectSimilarity(): DoomLoopDetection | null {
    if (this.history.length < this.config.warnThreshold) return null;

    const last = this.history[this.history.length - 1]!;
    let similarCount = 0;
    let minSimilarity = 1.0;

    for (let i = this.history.length - 2; i >= 0; i--) {
      const entry = this.history[i]!;
      if (entry.toolName !== last.toolName) break;

      // Exact matches are already caught by consecutive detection
      if (entry.argsFingerprint === last.argsFingerprint) {
        similarCount++;
        continue;
      }

      const sim = jaccardTrigramSimilarity(last.fullArgs, entry.fullArgs);
      if (sim >= this.config.similarityThreshold) {
        similarCount++;
        if (sim < minSimilarity) {
          minSimilarity = sim;
        }
      } else {
        break;
      }
    }

    const totalCount = similarCount + 1; // Include the current call
    if (totalCount >= this.config.warnThreshold) {
      return {
        detected: true,
        type: "similarity",
        count: totalCount,
        similarity: Math.round(minSimilarity * 1000) / 1000,
      };
    }

    return null;
  }

  // -- Message Building ------------------------------------------------

  private buildWarnMessage(detection: DoomLoopDetection): string {
    const toolName = this.history[this.history.length - 1]?.toolName ?? "unknown";

    switch (detection.type) {
      case "consecutive":
        return [
          `<system_reminder>Doom loop WARNING: ${toolName} has been called ` +
          `${detection.count} times with identical arguments.`,
          "Consider reading the error output more carefully and trying a different approach.",
          "</system_reminder>",
        ].join("\n");

      case "sequence":
        return [
          `<system_reminder>Doom loop WARNING: A sequence of ${detection.sequenceLength} ` +
          `tool calls has repeated ${detection.count} times.`,
          "You appear to be cycling through the same actions. Step back and reconsider.",
          "</system_reminder>",
        ].join("\n");

      case "similarity": {
        const pct = detection.similarity !== undefined
          ? `${Math.round(detection.similarity * 100)}%`
          : "85%+";
        return [
          `<system_reminder>Doom loop WARNING: ${toolName} has been called ` +
          `${detection.count} times with near-identical arguments (${pct} similar).`,
          "Minor variations of the same approach will not fix the problem.",
          "Try a fundamentally different strategy.",
          "</system_reminder>",
        ].join("\n");
      }

      default:
        return "";
    }
  }

  private buildBlockMessage(detection: DoomLoopDetection): string {
    const toolName = this.history[this.history.length - 1]?.toolName ?? "unknown";

    return [
      `<system_reminder>DOOM LOOP BLOCKED: ${toolName} has been called ` +
      `${detection.count} times ${detection.type === "similarity" ? "with near-identical" : "with identical"} arguments.`,
      "",
      "STOP. Your current approach is not working. You MUST:",
      "1. Read the error messages carefully",
      "2. Re-read the relevant files to update your context",
      "3. Try a COMPLETELY DIFFERENT approach",
      "4. If stuck, explain what you've tried and ask for help",
      "",
      "Do NOT retry the same action again.",
      "</system_reminder>",
    ].join("\n");
  }

  // -- Helpers ---------------------------------------------------------

  private sequencesMatch(
    a: readonly ToolCallRecord[],
    b: readonly ToolCallRecord[],
  ): boolean {
    if (a.length !== b.length) return false;
    return a.every((entry, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        entry.toolName === other.toolName &&
        entry.argsFingerprint === other.argsFingerprint
      );
    });
  }
}

// -- Hash Utility ------------------------------------------------------

/**
 * Simple string hash for fingerprinting.
 * Uses a fast non-cryptographic hash for deduplication.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return (hash >>> 0).toString(36);
}

// -- Pipeline Middleware Adapter ----------------------------------------

/**
 * Create a Middleware adapter for the doom loop detector.
 * Runs at order 24 (after stale detection).
 * Operates in the `after` phase to inspect tool call results.
 */
export function createDoomLoopMiddleware(
  instance: DoomLoopMiddleware,
): Middleware {
  return {
    name: "DoomLoop",
    order: 24,
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      if (!result.toolName) return result;

      // Build args from available result properties
      const args: Record<string, unknown> = {};
      if (result.filePath) args["filePath"] = result.filePath;
      if (result.content) args["content"] = result.content.slice(0, 500);
      if (result.toolName) args["toolName"] = result.toolName;

      const detection = instance.record(result.toolName, args);
      const reminder = instance.buildReminder(detection);

      if (reminder) {
        return {
          ...result,
          followUp: result.followUp
            ? `${result.followUp}\n\n${reminder}`
            : reminder,
        };
      }

      return result;
    },
  };
}
