/**
 * Away Summary — detects idle >5min, builds summary on return.
 * Shows what happened while the user was away.
 */

import { TraceAnalyzer } from "./trace-analyzer.js";

// ── Types ────────────────────────────────────────────────

export interface AwaySummary {
  readonly awayDurationMs: number;
  readonly agentsCompleted: number;
  readonly agentsFailed: number;
  readonly filesChanged: readonly string[];
  readonly testsRun: boolean;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly costIncurred: number;
  readonly summary: string;
}

export interface IdleDetectorConfig {
  readonly idleThresholdMs: number; // Default 5 minutes
  readonly checkIntervalMs: number; // Default 30 seconds
}

// ── Idle Detector ────────────────────────────────────────

export class IdleDetector {
  private lastActivityAt: number = Date.now();
  private isIdle = false;
  private idleStartedAt: number | null = null;
  private readonly config: IdleDetectorConfig;

  constructor(config?: Partial<IdleDetectorConfig>) {
    this.config = {
      idleThresholdMs: 5 * 60_000, // 5 minutes
      checkIntervalMs: 30_000,
      ...config,
    };
  }

  /**
   * Record user activity (query, keystroke, etc).
   */
  recordActivity(): void {
    this.lastActivityAt = Date.now();
    if (this.isIdle) {
      this.isIdle = false;
    }
  }

  /**
   * Check if the user is idle.
   */
  checkIdle(): boolean {
    const elapsed = Date.now() - this.lastActivityAt;
    if (elapsed >= this.config.idleThresholdMs && !this.isIdle) {
      this.isIdle = true;
      this.idleStartedAt = this.lastActivityAt;
    }
    return this.isIdle;
  }

  /**
   * Get how long the user has been idle.
   */
  getIdleDurationMs(): number {
    if (!this.isIdle) return 0;
    return Date.now() - (this.idleStartedAt ?? this.lastActivityAt);
  }

  /**
   * Build a summary of what happened while the user was away.
   */
  buildAwaySummary(
    traceAnalyzer: TraceAnalyzer,
    costDelta: number,
  ): AwaySummary {
    const duration = this.getIdleDurationMs();
    const recentEntries = traceAnalyzer.getRecentEntries(20);

    const filesChanged = [
      ...new Set(
        recentEntries
          .filter((e) => e.toolName === "write_file" || e.toolName === "edit_file")
          .map((e) => {
            const match = e.content.match(/file[_\s]?path['":\s]+([^\s'"]+)/i);
            return match?.[1] ?? "unknown";
          }),
      ),
    ];

    const testEntries = recentEntries.filter(
      (e) => e.toolName === "bash" && e.content.includes("test"),
    );
    const testsRun = testEntries.length > 0;
    const testsPassed = testEntries.filter((e) => e.content.includes("passed")).length;
    const testsFailed = testEntries.filter((e) => e.content.includes("failed")).length;

    const parts: string[] = [];
    if (filesChanged.length > 0) {
      parts.push(`${filesChanged.length} files changed: ${filesChanged.slice(0, 3).join(", ")}`);
    }
    if (testsRun) {
      parts.push(`Tests: ${testsPassed} passed, ${testsFailed} failed`);
    }
    if (costDelta > 0) {
      parts.push(`Cost: $${costDelta.toFixed(4)}`);
    }

    const summary = parts.length > 0
      ? `While you were away (${Math.floor(duration / 60_000)}min): ${parts.join(". ")}`
      : `You were away for ${Math.floor(duration / 60_000)} minutes. Nothing happened.`;

    return {
      awayDurationMs: duration,
      agentsCompleted: 0,
      agentsFailed: 0,
      filesChanged,
      testsRun,
      testsPassed,
      testsFailed,
      costIncurred: costDelta,
      summary,
    };
  }

  /**
   * Reset idle state (called when user returns).
   */
  reset(): void {
    this.isIdle = false;
    this.idleStartedAt = null;
    this.lastActivityAt = Date.now();
  }
}
