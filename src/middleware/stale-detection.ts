/**
 * Stale-Read Detection Middleware.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Editing files based on stale context accounts for ~10% of incorrect
 *  fixes. The agent reads a file, makes 5 other edits, then edits the
 *  original file based on an outdated mental model."
 *
 * This middleware tracks when files were last read and warns when an
 * edit targets a file that was read too long ago. "Too long ago" is
 * measured in turns, not wall-clock time, because the agent's mental
 * model degrades with intervening actions, not elapsed time.
 *
 * THRESHOLDS:
 * - Warning: file read > 5 turns ago (default, configurable)
 * - Stale: file read > 10 turns ago
 * - Never-read: file was never read in this session
 *
 * The never-read case is handled by the existing ReadBeforeEdit hook
 * in built-in.ts. This middleware focuses on the STALENESS problem:
 * the file WAS read, but the reading is outdated.
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// -- Types -------------------------------------------------------------

export interface FileReadRecord {
  readonly filePath: string;
  readonly readAtTurn: number;
  readonly readCount: number;
}

export interface StaleDetectionState {
  readonly trackedFiles: readonly FileReadRecord[];
  readonly currentTurn: number;
  readonly warnings: number;
  readonly staleEditsAttempted: number;
}

export interface StaleDetectionConfig {
  /** Turns after which a read is considered stale (warning). */
  readonly warnAfterTurns: number;
  /** Turns after which a read is definitely stale (strong warning). */
  readonly staleAfterTurns: number;
  /** Maximum number of files to track (LRU eviction). */
  readonly maxTrackedFiles: number;
}

const DEFAULT_CONFIG: StaleDetectionConfig = {
  warnAfterTurns: 5,
  staleAfterTurns: 10,
  maxTrackedFiles: 100,
};

// -- Middleware Class ---------------------------------------------------

/**
 * StaleDetectionMiddleware tracks file read timestamps (in turns)
 * and warns when edits target files with potentially outdated context.
 */
export class StaleDetectionMiddleware {
  private readonly config: StaleDetectionConfig;
  private fileReads: Map<string, { readAtTurn: number; readCount: number }> = new Map();
  private currentTurn = 0;
  private warnings = 0;
  private staleEditsAttempted = 0;

  constructor(config?: Partial<StaleDetectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a file being read.
   */
  recordRead(filePath: string): void {
    const existing = this.fileReads.get(filePath);
    this.fileReads.set(filePath, {
      readAtTurn: this.currentTurn,
      readCount: (existing?.readCount ?? 0) + 1,
    });

    // LRU eviction if over limit
    if (this.fileReads.size > this.config.maxTrackedFiles) {
      this.evictOldest();
    }
  }

  /**
   * Record a file being written/edited.
   * Also updates the "last read" since writing implies the agent
   * has the current state in context.
   */
  recordWrite(filePath: string): void {
    // Writing a file implicitly means the agent has current state
    const existing = this.fileReads.get(filePath);
    this.fileReads.set(filePath, {
      readAtTurn: this.currentTurn,
      readCount: (existing?.readCount ?? 0) + 1,
    });
  }

  /**
   * Check if a file edit targets a stale read.
   * Returns a warning message if stale, or null if fresh.
   */
  checkStaleness(filePath: string): string | null {
    const record = this.fileReads.get(filePath);

    // File was never read -- handled by ReadBeforeEdit hook
    if (!record) return null;

    const turnsSinceRead = this.currentTurn - record.readAtTurn;

    if (turnsSinceRead >= this.config.staleAfterTurns) {
      this.staleEditsAttempted++;
      this.warnings++;
      return [
        `[STALE READ WARNING] ${filePath} was last read ${turnsSinceRead} turns ago.`,
        `The file may have changed since then (${turnsSinceRead} tool calls have happened since your last read).`,
        `STRONGLY RECOMMENDED: Re-read the file before editing to ensure your changes are based on current content.`,
      ].join("\n");
    }

    if (turnsSinceRead >= this.config.warnAfterTurns) {
      this.warnings++;
      return [
        `[STALE READ] ${filePath} was read ${turnsSinceRead} turns ago.`,
        `Consider re-reading it before editing to ensure your context is current.`,
      ].join("\n");
    }

    return null;
  }

  /**
   * Advance the turn counter.
   */
  advanceTurn(): void {
    this.currentTurn++;
  }

  /**
   * Get the staleness status of a file.
   * Returns turns since last read, or -1 if never read.
   */
  getTurnsSinceRead(filePath: string): number {
    const record = this.fileReads.get(filePath);
    if (!record) return -1;
    return this.currentTurn - record.readAtTurn;
  }

  /**
   * Get the current state for diagnostics.
   */
  getState(): StaleDetectionState {
    const trackedFiles: FileReadRecord[] = [];
    for (const [filePath, record] of this.fileReads) {
      trackedFiles.push({
        filePath,
        readAtTurn: record.readAtTurn,
        readCount: record.readCount,
      });
    }

    return {
      trackedFiles,
      currentTurn: this.currentTurn,
      warnings: this.warnings,
      staleEditsAttempted: this.staleEditsAttempted,
    };
  }

  /**
   * Get files that are currently stale (read more than warnAfterTurns ago).
   */
  getStaleFiles(): readonly string[] {
    const stale: string[] = [];
    for (const [filePath, record] of this.fileReads) {
      if (this.currentTurn - record.readAtTurn >= this.config.warnAfterTurns) {
        stale.push(filePath);
      }
    }
    return stale;
  }

  /**
   * Reset for a new task.
   */
  reset(): void {
    this.fileReads.clear();
    this.currentTurn = 0;
    this.warnings = 0;
    this.staleEditsAttempted = 0;
  }

  // -- Private ---------------------------------------------------------

  /**
   * Evict the oldest (least recently read) file from tracking.
   */
  private evictOldest(): void {
    let oldestPath: string | null = null;
    let oldestTurn = Infinity;

    for (const [filePath, record] of this.fileReads) {
      if (record.readAtTurn < oldestTurn) {
        oldestTurn = record.readAtTurn;
        oldestPath = filePath;
      }
    }

    if (oldestPath) {
      this.fileReads.delete(oldestPath);
    }
  }
}

// -- Pipeline Middleware Adapter ----------------------------------------

/**
 * Create a Middleware adapter for the stale-read detector.
 * Runs at order 23 (after auto-install).
 *
 * Before hook: advances turn counter.
 * After hook: tracks file reads/writes and warns on stale edits.
 */
export function createStaleDetectionMiddleware(
  instance: StaleDetectionMiddleware,
): Middleware {
  return {
    name: "StaleDetection",
    order: 23,
    before(ctx: MiddlewareContext): MiddlewareContext {
      instance.advanceTurn();
      return ctx;
    },
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      // Track file reads
      if (result.toolName === "Read" && result.filePath) {
        instance.recordRead(result.filePath);
      }

      // Track file writes and check for staleness
      if (
        (result.toolName === "Write" || result.toolName === "Edit") &&
        result.filePath
      ) {
        const staleWarning = instance.checkStaleness(result.filePath);

        // Record the write (updates read timestamp)
        instance.recordWrite(result.filePath);

        if (staleWarning) {
          return {
            ...result,
            followUp: result.followUp
              ? `${result.followUp}\n\n${staleWarning}`
              : staleWarning,
          };
        }
      }

      return result;
    },
  };
}
