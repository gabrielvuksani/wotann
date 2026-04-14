/**
 * DoomLoop detector from ForgeCode benchmark engineering.
 * Detects both consecutive identical calls [A,A,A] and repeating sequences [A,B,C,A,B,C].
 * Also detects near-identical calls via Jaccard trigram similarity (85%+ threshold),
 * catching cases where the agent makes tiny variations of the same failing approach.
 * Injects system reminder but does NOT force stop — lets the model self-correct.
 */

import { createHash } from "node:crypto";

export interface ToolSignature {
  readonly toolName: string;
  readonly argsHash: string;
  readonly argsText: string;
}

export type ToolFrequencyStatus = "ok" | "warn" | "block";

export interface DoomLoopResult {
  readonly detected: boolean;
  readonly type: "consecutive" | "sequence" | "similarity" | "frequency" | null;
  readonly count: number;
  readonly sequenceLength?: number;
  readonly similarity?: number;
}

/** Default threshold for Jaccard trigram similarity (85%). */
const SIMILARITY_THRESHOLD = 0.85;

// ── Trigram Jaccard Similarity ──────────────────────────────

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
 * Compute Jaccard similarity coefficient between two trigram sets.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function jaccardTrigramSimilarity(a: string, b: string): number {
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

// ── Detector ───────────────────────────────────────────────

export class DoomLoopDetector {
  private readonly threshold: number;
  private readonly similarityThreshold: number;
  private readonly history: ToolSignature[] = [];

  // Per-tool-type frequency tracking (from deer-flow pattern)
  // Detects: "reading same file 10 times", "running bash 8 times in 3 turns"
  private toolTypeFrequency = new Map<string, { readonly count: number; readonly firstSeen: number }>();
  private readonly TOOL_FREQ_WARN = 5;
  private readonly TOOL_FREQ_BLOCK = 8;
  private readonly TOOL_FREQ_WINDOW_MS = 180_000; // 3 minutes

  // Read-file bucketing by path (not exact line range)
  private readFileByPath = new Map<string, number>();

  constructor(threshold: number = 3, similarityThreshold: number = SIMILARITY_THRESHOLD) {
    this.threshold = threshold;
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Record a tool call and check for doom loops.
   * Checks in order: exact consecutive, repeating sequence, similarity-based.
   */
  record(toolName: string, args: Record<string, unknown>): DoomLoopResult {
    const argsText = JSON.stringify({ tool: toolName, args });
    const argsHash = createHash("md5")
      .update(JSON.stringify(args))
      .digest("hex")
      .slice(0, 8);

    this.history.push({ toolName, argsHash, argsText });

    // Pattern 1: Consecutive identical [A,A,A] (exact MD5 match)
    const consecutive = this.detectConsecutive();
    if (consecutive) {
      return { detected: true, type: "consecutive", count: consecutive };
    }

    // Pattern 2: Repeating sequence [A,B,C,A,B,C,A,B,C]
    for (let seqLen = 2; seqLen <= 5; seqLen++) {
      const seqCount = this.detectRepeatingSequence(seqLen);
      if (seqCount >= this.threshold) {
        return { detected: true, type: "sequence", count: seqCount, sequenceLength: seqLen };
      }
    }

    // Pattern 3: Similarity-based — catches near-identical calls
    const similarityResult = this.detectSimilarity();
    if (similarityResult) {
      return similarityResult;
    }

    return { detected: false, type: null, count: 0 };
  }

  private detectConsecutive(): number | null {
    if (this.history.length < this.threshold) return null;

    const last = this.history[this.history.length - 1]!;
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i]!;
      if (entry.toolName === last.toolName && entry.argsHash === last.argsHash) {
        count++;
      } else {
        break;
      }
    }

    return count >= this.threshold ? count : null;
  }

  private detectRepeatingSequence(seqLen: number): number {
    if (this.history.length < seqLen * this.threshold) return 0;

    const seq = this.history.slice(-seqLen);
    let matches = 0;

    for (let i = this.history.length - seqLen; i >= 0; i -= seqLen) {
      const candidate = this.history.slice(i, i + seqLen);
      if (this.sequencesEqual(seq, candidate)) {
        matches++;
      } else {
        break;
      }
    }

    return matches + 1; // Include the current sequence
  }

  /**
   * Detect similarity-based doom loops using Jaccard trigram coefficient.
   * If the last `threshold` calls to the same tool have 85%+ similarity
   * pairwise with the most recent call, flag as a doom loop.
   */
  private detectSimilarity(): DoomLoopResult | null {
    if (this.history.length < this.threshold) return null;

    const last = this.history[this.history.length - 1]!;

    // Only compare consecutive calls to the same tool
    let similarCount = 0;
    let minSimilarity = 1.0;

    for (let i = this.history.length - 2; i >= 0; i--) {
      const entry = this.history[i]!;
      if (entry.toolName !== last.toolName) {
        break;
      }

      // Already caught by exact-match detection; skip to avoid double-counting
      if (entry.argsHash === last.argsHash) {
        similarCount++;
        continue;
      }

      const sim = jaccardTrigramSimilarity(last.argsText, entry.argsText);
      if (sim >= this.similarityThreshold) {
        similarCount++;
        if (sim < minSimilarity) {
          minSimilarity = sim;
        }
      } else {
        break;
      }
    }

    // +1 to include the current call itself
    const totalCount = similarCount + 1;

    if (totalCount >= this.threshold) {
      return {
        detected: true,
        type: "similarity",
        count: totalCount,
        similarity: Math.round(minSimilarity * 1000) / 1000,
      };
    }

    return null;
  }

  private sequencesEqual(a: readonly ToolSignature[], b: readonly ToolSignature[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((sig, i) => {
      const other = b[i];
      return other && sig.toolName === other.toolName && sig.argsHash === other.argsHash;
    });
  }

  /**
   * Get the system reminder to inject when a doom loop is detected.
   */
  getReminder(result: DoomLoopResult): string {
    if (result.type === "consecutive") {
      return `<system_reminder>Doom loop detected: The same tool call (${this.history[this.history.length - 1]?.toolName}) ` +
        `has been repeated ${result.count} times with identical arguments. ` +
        `Step back and try a fundamentally different approach.</system_reminder>`;
    }
    if (result.type === "sequence") {
      return `<system_reminder>Doom loop detected: A sequence of ${result.sequenceLength} tool calls ` +
        `is repeating (${result.count} repetitions). ` +
        `You appear stuck in a cycle. Reconsider your strategy entirely.</system_reminder>`;
    }
    if (result.type === "similarity") {
      const pct = result.similarity !== undefined ? `${Math.round(result.similarity * 100)}%` : "85%+";
      return `<system_reminder>Doom loop detected: The tool (${this.history[this.history.length - 1]?.toolName}) ` +
        `has been called ${result.count} times with near-identical arguments (${pct} similar). ` +
        `Minor variations of the same approach will not fix the problem. ` +
        `Step back and try a fundamentally different strategy.</system_reminder>`;
    }
    if (result.type === "frequency") {
      return `<system_reminder>Tool frequency alert: A tool has been called ${result.count} times ` +
        `within a short window. This suggests a repetitive approach that is not making progress. ` +
        `Stop and reconsider whether this tool call is productive.</system_reminder>`;
    }
    return "";
  }

  /**
   * Track per-tool-type call frequency within a sliding time window.
   * Returns "ok", "warn" (5+ calls), or "block" (8+ calls) within 3 minutes.
   */
  recordToolType(toolName: string): ToolFrequencyStatus {
    const now = Date.now();
    const entry = this.toolTypeFrequency.get(toolName);

    if (!entry || now - entry.firstSeen > this.TOOL_FREQ_WINDOW_MS) {
      this.toolTypeFrequency.set(toolName, { count: 1, firstSeen: now });
      return "ok";
    }

    const updated = { count: entry.count + 1, firstSeen: entry.firstSeen };
    this.toolTypeFrequency.set(toolName, updated);

    if (updated.count >= this.TOOL_FREQ_BLOCK) return "block";
    if (updated.count >= this.TOOL_FREQ_WARN) return "warn";
    return "ok";
  }

  /**
   * Track read_file calls bucketed by normalized file path.
   * Strips query/hash params so reading the same file with different
   * offsets is detected as repetitive.
   */
  recordReadFile(filePath: string): ToolFrequencyStatus {
    const normalized = filePath.replace(/\?.*$/, "").replace(/#.*$/, "");
    const count = (this.readFileByPath.get(normalized) ?? 0) + 1;
    this.readFileByPath.set(normalized, count);

    if (count >= 8) return "block";
    if (count >= 5) return "warn";
    return "ok";
  }

  reset(): void {
    this.history.length = 0;
    this.toolTypeFrequency.clear();
    this.readFileByPath.clear();
  }

  getHistoryLength(): number {
    return this.history.length;
  }
}
