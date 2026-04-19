/**
 * Tool Output Truncation Middleware.
 *
 * Prevents a single large tool output (e.g., `cat` on a 10K-line file,
 * or `ls -R` on a huge directory) from consuming the entire context window.
 *
 * Strategy: keep the first `preserveHead` lines and last `preserveTail` lines,
 * insert a `[... truncated N lines ...]` marker in the middle.
 *
 * Runs in the `after` phase at order 6.5 (after ToolError, before Summarization).
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";
import { formatIsolatedPreview, OutputIsolationStore } from "../sandbox/output-isolator.js";

// -- Types ----------------------------------------------------------------

export interface TruncationConfig {
  /** Maximum characters in a single tool output. Default: 8000 (~2000 tokens). */
  readonly maxToolOutputChars: number;
  /** Maximum lines in a single tool output. Default: 200. */
  readonly maxToolOutputLines: number;
  /** Message inserted at the truncation boundary. */
  readonly truncationMessage: string;
  /** Number of lines to keep from the start. Default: 50. */
  readonly preserveHead: number;
  /** Number of lines to keep from the end. Default: 30. */
  readonly preserveTail: number;
}

const DEFAULT_CONFIG: TruncationConfig = {
  maxToolOutputChars: 8000,
  maxToolOutputLines: 200,
  truncationMessage: "[... truncated {count} lines ...]",
  preserveHead: 50,
  preserveTail: 30,
};

// -- Statistics -----------------------------------------------------------

export interface TruncationStats {
  readonly totalTruncations: number;
  readonly totalLinesDropped: number;
  readonly totalCharsDropped: number;
}

// -- Middleware Class ------------------------------------------------------

/**
 * OutputTruncationMiddleware checks tool results and truncates oversized
 * outputs to prevent context window exhaustion.
 */
/**
 * Phase 13 Wave 3B: large-output isolation threshold. Outputs above
 * this size bypass plain truncation and go through the output-isolator
 * so the raw content is retained behind a handle while only a
 * compressed head+tail preview enters the model's context.
 */
const ISOLATION_SIZE_BYTES = 50 * 1024;

export class OutputTruncationMiddleware {
  private readonly config: TruncationConfig;
  private totalTruncations = 0;
  private totalLinesDropped = 0;
  private totalCharsDropped = 0;

  // Phase 13 Wave 3B: per-session isolation store. Handles survive for
  // the lifetime of the middleware instance. Callers can read the store
  // via getIsolationStore() to fetch full content by handle.
  private readonly isolationStore = new OutputIsolationStore();
  private totalIsolations = 0;

  constructor(config?: Partial<TruncationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Truncate content if it exceeds configured limits.
   * Returns the original content if within limits, or a truncated version
   * with head/tail preserved and a marker in the middle.
   *
   * Phase 13 Wave 3B: when content exceeds ISOLATION_SIZE_BYTES we skip
   * plain truncation and use the output-isolator so the full content is
   * preserved behind a handle instead of permanently discarded.
   */
  truncate(content: string): {
    readonly content: string;
    readonly truncated: boolean;
    readonly linesDropped: number;
  } {
    // Phase 13 Wave 3B: for >50KB outputs, isolate instead of truncate.
    // Honest: if isolation throws we fall through to normal truncation.
    if (content.length >= ISOLATION_SIZE_BYTES) {
      try {
        const iso = this.isolationStore.isolateAndStore(content);
        if (iso.compressionRatio < 1) {
          this.totalIsolations++;
          this.totalTruncations++;
          const elided = iso.elidedLines;
          this.totalLinesDropped += elided;
          this.totalCharsDropped += content.length - iso.previewSize;
          return {
            content: formatIsolatedPreview(iso),
            truncated: true,
            linesDropped: elided,
          };
        }
      } catch (err) {
        // Honest warn: never silently swallow an isolation failure.
        console.warn(
          `[OutputTruncation] isolation failed: ${(err as Error).message}; falling back to truncate`,
        );
      }
    }

    const lines = content.split("\n");
    const exceedsChars = content.length > this.config.maxToolOutputChars;
    const exceedsLines = lines.length > this.config.maxToolOutputLines;

    if (!exceedsChars && !exceedsLines) {
      return { content, truncated: false, linesDropped: 0 };
    }

    const headCount = Math.min(this.config.preserveHead, lines.length);
    const tailCount = Math.min(this.config.preserveTail, Math.max(0, lines.length - headCount));
    const droppedCount = lines.length - headCount - tailCount;

    if (droppedCount <= 0) {
      // Content is over char limit but not enough lines to split meaningfully
      return { content, truncated: false, linesDropped: 0 };
    }

    const head = lines.slice(0, headCount);
    const tail = lines.slice(lines.length - tailCount);
    const marker = this.config.truncationMessage.replace("{count}", String(droppedCount));

    const truncated = [...head, "", marker, "", ...tail].join("\n");

    this.totalTruncations++;
    this.totalLinesDropped += droppedCount;
    this.totalCharsDropped += content.length - truncated.length;

    return { content: truncated, truncated: true, linesDropped: droppedCount };
  }

  /** Phase 13 Wave 3B: expose the isolation store for handle-based retrieval. */
  getIsolationStore(): OutputIsolationStore {
    return this.isolationStore;
  }

  /** Phase 13 Wave 3B: count of isolations performed this session. */
  getIsolationCount(): number {
    return this.totalIsolations;
  }

  /**
   * Get truncation statistics for diagnostics.
   */
  getStats(): TruncationStats {
    return {
      totalTruncations: this.totalTruncations,
      totalLinesDropped: this.totalLinesDropped,
      totalCharsDropped: this.totalCharsDropped,
    };
  }

  /**
   * Reset statistics for a new session.
   */
  reset(): void {
    this.totalTruncations = 0;
    this.totalLinesDropped = 0;
    this.totalCharsDropped = 0;
  }
}

// -- Pipeline Middleware Adapter -------------------------------------------

/**
 * Create a Middleware adapter for the output truncation engine.
 * Runs at order 6.5 (between ToolError at 6 and Summarization at 7).
 * Operates in the `after` phase to inspect and truncate tool results.
 */
export function createOutputTruncationMiddleware(instance: OutputTruncationMiddleware): Middleware {
  return {
    name: "OutputTruncation",
    order: 6.5,
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      if (!result.content) return result;

      const { content, truncated, linesDropped } = instance.truncate(result.content);

      if (!truncated) return result;

      const traceNote = `[OutputTruncation] Truncated ${linesDropped} lines from ${result.toolName ?? "unknown"} output`;

      return {
        ...result,
        content,
        followUp: result.followUp ? `${result.followUp}\n\n${traceNote}` : traceNote,
      };
    },
  };
}
