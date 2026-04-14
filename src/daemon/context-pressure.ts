/**
 * Context Pressure Monitor — pushes utilization warnings to active CLI sessions.
 * The daemon tracks context usage; this module decides when thresholds are
 * exceeded and produces structured events for IPC delivery.
 */

// ── Types ────────────────────────────────────────────────────

export interface ContextPressureEvent {
  readonly level: "info" | "warning" | "critical";
  readonly utilizationPercent: number;
  readonly tokensUsed: number;
  readonly tokensRemaining: number;
  readonly recommendation: string;
  readonly timestamp: number;
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_WARNING_THRESHOLD = 65;
const DEFAULT_CRITICAL_THRESHOLD = 85;
const MAX_HISTORY = 200;

// ── Recommendations ──────────────────────────────────────────

function recommendationForLevel(
  level: "info" | "warning" | "critical",
  utilizationPercent: number,
): string {
  switch (level) {
    case "critical":
      return `Context at ${utilizationPercent}% — compact immediately to avoid degraded responses`;
    case "warning":
      return `Context at ${utilizationPercent}% — consider compacting soon to preserve quality`;
    case "info":
      return `Context utilization is ${utilizationPercent}%`;
  }
}

// ── Monitor ──────────────────────────────────────────────────

export class ContextPressureMonitor {
  private readonly warningThreshold: number;
  private readonly criticalThreshold: number;
  private readonly history: ContextPressureEvent[];

  constructor(warningThreshold?: number, criticalThreshold?: number) {
    this.warningThreshold = warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
    this.criticalThreshold = criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD;
    this.history = [];

    if (this.warningThreshold >= this.criticalThreshold) {
      throw new Error(
        `Warning threshold (${this.warningThreshold}) must be less than critical threshold (${this.criticalThreshold})`,
      );
    }
    if (this.warningThreshold < 0 || this.criticalThreshold > 100) {
      throw new Error("Thresholds must be between 0 and 100");
    }
  }

  /**
   * Check current context utilization. Returns an event if a threshold is
   * exceeded, or null when utilization is below the warning threshold.
   */
  check(tokensUsed: number, maxTokens: number): ContextPressureEvent | null {
    if (maxTokens <= 0) {
      throw new Error("maxTokens must be a positive number");
    }
    if (tokensUsed < 0) {
      throw new Error("tokensUsed must not be negative");
    }

    const utilizationPercent = Math.round((tokensUsed / maxTokens) * 100);
    const level = this.classifyLevel(utilizationPercent);

    if (level === null) {
      return null;
    }

    const event: ContextPressureEvent = {
      level,
      utilizationPercent,
      tokensUsed,
      tokensRemaining: maxTokens - tokensUsed,
      recommendation: recommendationForLevel(level, utilizationPercent),
      timestamp: Date.now(),
    };

    this.pushEvent(event);
    return event;
  }

  /** Get the last N pressure events (most recent first). */
  getHistory(limit?: number): readonly ContextPressureEvent[] {
    const cap = limit ?? this.history.length;
    // Return a reversed copy so most recent comes first
    return [...this.history].reverse().slice(0, cap);
  }

  /** Clear all history (e.g. after compaction resets context). */
  reset(): void {
    this.history.length = 0;
  }

  // ── Private helpers ──────────────────────────────────────

  private classifyLevel(
    utilization: number,
  ): "warning" | "critical" | null {
    if (utilization >= this.criticalThreshold) {
      return "critical";
    }
    if (utilization >= this.warningThreshold) {
      return "warning";
    }
    return null;
  }

  private pushEvent(event: ContextPressureEvent): void {
    this.history.push(event);
    // Trim oldest entries beyond the cap
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
  }
}
