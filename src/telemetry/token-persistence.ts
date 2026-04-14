/**
 * Token Count Persistence Across Sessions.
 *
 * Tracks cumulative token usage across sessions, persisted to disk at
 * ~/.wotann/token-stats.json. Uses immutable JSON read/write patterns.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ── Types ──────────────────────────────────────────────────────

export interface TokenStats {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalThinkingTokens: number;
  readonly sessionCount: number;
  readonly lastUpdated: number;
  readonly byProvider: Readonly<Record<string, { input: number; output: number }>>;
  readonly byModel: Readonly<Record<string, { input: number; output: number }>>;
}

interface SerializedTokenStats {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalThinkingTokens: number;
  readonly sessionCount: number;
  readonly lastUpdated: number;
  readonly byProvider: Record<string, { input: number; output: number }>;
  readonly byModel: Record<string, { input: number; output: number }>;
}

// ── Implementation ─────────────────────────────────────────────

const EMPTY_STATS: TokenStats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalThinkingTokens: 0,
  sessionCount: 0,
  lastUpdated: 0,
  byProvider: {},
  byModel: {},
};

export class TokenPersistence {
  private readonly storagePath: string;
  private stats: TokenStats;
  private sessionInput: number;
  private sessionOutput: number;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.stats = loadStats(storagePath);
    this.sessionInput = 0;
    this.sessionOutput = 0;

    // Increment session count on construction (new session)
    this.stats = {
      ...this.stats,
      sessionCount: this.stats.sessionCount + 1,
      lastUpdated: Date.now(),
    };
    this.flush();
  }

  /**
   * Record token usage for a single request.
   * Immutably updates internal state and persists to disk.
   */
  recordUsage(
    provider: string,
    model: string,
    input: number,
    output: number,
    thinking?: number,
  ): void {
    this.sessionInput += input;
    this.sessionOutput += output;

    const prevProvider = this.stats.byProvider[provider] ?? { input: 0, output: 0 };
    const prevModel = this.stats.byModel[model] ?? { input: 0, output: 0 };

    this.stats = {
      ...this.stats,
      totalInputTokens: this.stats.totalInputTokens + input,
      totalOutputTokens: this.stats.totalOutputTokens + output,
      totalThinkingTokens: this.stats.totalThinkingTokens + (thinking ?? 0),
      lastUpdated: Date.now(),
      byProvider: {
        ...this.stats.byProvider,
        [provider]: {
          input: prevProvider.input + input,
          output: prevProvider.output + output,
        },
      },
      byModel: {
        ...this.stats.byModel,
        [model]: {
          input: prevModel.input + input,
          output: prevModel.output + output,
        },
      },
    };

    this.flush();
  }

  /** Get cumulative stats across all sessions. */
  getStats(): TokenStats {
    return this.stats;
  }

  /** Get token counts for the current session only. */
  getSessionStats(): { input: number; output: number } {
    return { input: this.sessionInput, output: this.sessionOutput };
  }

  /** Write current stats to disk. */
  private flush(): void {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(this.stats, null, 2));
  }
}

// ── Helpers ────────────────────────────────────────────────────

function loadStats(path: string): TokenStats {
  if (!existsSync(path)) return EMPTY_STATS;

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as SerializedTokenStats;

    return {
      totalInputTokens: parsed.totalInputTokens ?? 0,
      totalOutputTokens: parsed.totalOutputTokens ?? 0,
      totalThinkingTokens: parsed.totalThinkingTokens ?? 0,
      sessionCount: parsed.sessionCount ?? 0,
      lastUpdated: parsed.lastUpdated ?? 0,
      byProvider: parsed.byProvider ?? {},
      byModel: parsed.byModel ?? {},
    };
  } catch {
    return EMPTY_STATS;
  }
}
