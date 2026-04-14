/**
 * Away Summary — detect idle > 5 min, show summary on return.
 *
 * Tracks user activity timestamps. When the user returns after being
 * idle beyond the threshold, generates a summary of events that
 * occurred during the absence (background tasks, watcher runs,
 * incoming messages, etc.).
 *
 * Design:
 * - Immutable event objects
 * - Configurable idle threshold (default 5 minutes)
 * - Summary grouped by event type with time-since formatting
 * - Thread-safe activity recording (single-threaded Node but
 *   multiple async callbacks may call recordActivity)
 */

// ── Types ────────────────────────────────────────────────

export interface AwayEvent {
  readonly type: string;
  readonly description: string;
  readonly timestamp: number;
}

export interface AwaySummaryReport {
  readonly idleDurationMs: number;
  readonly eventCount: number;
  readonly summary: string;
  readonly events: readonly AwayEvent[];
}

// ── Constants ────────────────────────────────────────────

const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 minutes
const MAX_EVENTS_IN_SUMMARY = 50;

// ── Time Formatting ──────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${(ms / 3_600_000).toFixed(1)}h ago`;
}

/**
 * Format a timestamp as a short time string (HH:MM:SS).
 */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

// ── Away Summary ─────────────────────────────────────────

export class AwaySummary {
  private lastActivityTime: number;
  private readonly idleThresholdMs: number;
  private eventBuffer: AwayEvent[] = [];

  constructor(idleThresholdMs?: number) {
    this.idleThresholdMs = idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    this.lastActivityTime = Date.now();
  }

  /**
   * Record user activity (keystroke, command, interaction).
   * Resets the idle timer.
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Check if the user is currently idle (no activity within threshold).
   */
  isIdle(): boolean {
    return (Date.now() - this.lastActivityTime) >= this.idleThresholdMs;
  }

  /**
   * Get how long the user has been idle, in milliseconds.
   */
  getIdleDurationMs(): number {
    return Math.max(0, Date.now() - this.lastActivityTime);
  }

  /**
   * Record an event that happened during the user's absence.
   * Call this from background tasks, watchers, incoming messages, etc.
   */
  recordEvent(event: AwayEvent): void {
    // Cap buffer to prevent unbounded growth
    if (this.eventBuffer.length >= MAX_EVENTS_IN_SUMMARY * 2) {
      // Keep only the most recent events
      this.eventBuffer = this.eventBuffer.slice(-MAX_EVENTS_IN_SUMMARY);
    }
    this.eventBuffer = [...this.eventBuffer, event];
  }

  /**
   * Generate a summary of events that occurred while the user was away.
   * Only includes events that happened after the last activity.
   * Clears the event buffer after generating the summary.
   */
  generateSummary(events?: readonly AwayEvent[]): AwaySummaryReport {
    const now = Date.now();
    const idleDurationMs = now - this.lastActivityTime;

    // Use provided events or the internal buffer
    const sourceEvents = events ?? this.eventBuffer;

    // Filter to events that occurred during the idle period
    const relevantEvents = sourceEvents
      .filter((e) => e.timestamp > this.lastActivityTime)
      .slice(-MAX_EVENTS_IN_SUMMARY);

    const summary = this.buildSummaryText(relevantEvents, idleDurationMs, now);

    // Clear the buffer after generating
    if (!events) {
      this.eventBuffer = [];
    }

    return {
      idleDurationMs,
      eventCount: relevantEvents.length,
      summary,
      events: relevantEvents,
    };
  }

  /**
   * Check if a summary should be shown (user was idle and events occurred).
   */
  shouldShowSummary(): boolean {
    if (!this.isIdle()) return false;

    const hasRelevantEvents = this.eventBuffer.some(
      (e) => e.timestamp > this.lastActivityTime,
    );
    return hasRelevantEvents;
  }

  // ── Private ────────────────────────────────────────────

  private buildSummaryText(
    events: readonly AwayEvent[],
    idleDurationMs: number,
    now: number,
  ): string {
    if (events.length === 0) {
      return `Welcome back. You were away for ${formatDuration(idleDurationMs).replace(" ago", "")}. Nothing happened while you were away.`;
    }

    const lines: string[] = [];

    // Header
    const durationStr = formatDuration(idleDurationMs).replace(" ago", "");
    lines.push(`Welcome back. You were away for ${durationStr}. Here is what happened:`);
    lines.push("");

    // Group events by type
    const groups = new Map<string, AwayEvent[]>();
    for (const event of events) {
      const existing = groups.get(event.type) ?? [];
      groups.set(event.type, [...existing, event]);
    }

    // Render each group
    for (const [type, groupEvents] of groups) {
      lines.push(`[${type}] (${groupEvents.length})`);

      for (const event of groupEvents) {
        const timeStr = formatTime(event.timestamp);
        const agoStr = formatDuration(now - event.timestamp);
        lines.push(`  ${timeStr} (${agoStr}): ${event.description}`);
      }

      lines.push("");
    }

    return lines.join("\n").trimEnd();
  }
}
