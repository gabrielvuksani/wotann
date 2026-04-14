/**
 * Temporal Agent Memory -- time-aware memory that can answer questions
 * about what happened at specific points in time.
 *
 * Records time-stamped memories with categories. Supports querying by
 * exact time ranges or natural language time expressions ("last week",
 * "yesterday", "3 days ago"). Detects trends over time periods.
 */

// -- Types -------------------------------------------------------------------

export interface TemporalEntry {
  readonly id: string;
  readonly content: string;
  readonly category: string;
  readonly timestamp: number;
  readonly metadata: Record<string, unknown>;
}

export interface TemporalQueryResult {
  readonly found: boolean;
  readonly milliseconds: number;
  readonly human: string;
}

export interface EventOrderResult {
  readonly content: string;
  readonly timestamp: number;
  readonly position: number;
}

export interface EventFrequencyResult {
  readonly eventsPerDay: number;
  readonly totalEvents: number;
  readonly activeDays: number;
}

export interface TimelineSummary {
  readonly start: number;
  readonly end: number;
  readonly entryCount: number;
  readonly categories: readonly CategoryCount[];
  readonly firstEntry: TemporalEntry | null;
  readonly lastEntry: TemporalEntry | null;
}

export interface CategoryCount {
  readonly category: string;
  readonly count: number;
}

export interface Trend {
  readonly category: string;
  readonly direction: "increasing" | "decreasing" | "stable";
  readonly changeRate: number;
  readonly windowDays: number;
  readonly recentCount: number;
  readonly previousCount: number;
}

// -- Natural time parsing ----------------------------------------------------

interface ParsedTimeRange {
  readonly start: Date;
  readonly end: Date;
}

const TIME_PATTERNS: ReadonlyArray<readonly [RegExp, (now: Date, match: RegExpMatchArray) => ParsedTimeRange]> = [
  [
    /^today$/i,
    (now, _match) => ({
      start: startOfDay(now),
      end: now,
    }),
  ],
  [
    /^yesterday$/i,
    (now, _match) => {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    },
  ],
  [
    /^last\s+week$/i,
    (now, _match) => {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { start: weekAgo, end: now };
    },
  ],
  [
    /^last\s+month$/i,
    (now, _match) => {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return { start: monthAgo, end: now };
    },
  ],
  [
    /^(\d+)\s+days?\s+ago$/i,
    (now, match) => {
      const days = parseInt(match[1] ?? "1", 10);
      const past = new Date(now);
      past.setDate(past.getDate() - days);
      return { start: startOfDay(past), end: endOfDay(past) };
    },
  ],
  [
    /^(\d+)\s+hours?\s+ago$/i,
    (now, match) => {
      const hours = parseInt(match[1] ?? "1", 10);
      const past = new Date(now);
      past.setHours(past.getHours() - hours);
      return { start: past, end: now };
    },
  ],
  [
    /^last\s+(\d+)\s+days?$/i,
    (now, match) => {
      const days = parseInt(match[1] ?? "7", 10);
      const past = new Date(now);
      past.setDate(past.getDate() - days);
      return { start: past, end: now };
    },
  ],
  [
    /^this\s+week$/i,
    (now, _match) => {
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
      return { start: startOfDay(monday), end: now };
    },
  ],
];

// -- Implementation ----------------------------------------------------------

export class TemporalMemory {
  private readonly entries: TemporalEntry[] = [];
  private idCounter = 0;

  /**
   * Record a time-stamped memory entry.
   */
  record(content: string, category: string, metadata?: Record<string, unknown>): TemporalEntry {
    const entry: TemporalEntry = {
      id: `tm_${++this.idCounter}`,
      content,
      category,
      timestamp: Date.now(),
      metadata: metadata ?? {},
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Record with an explicit timestamp (for testing or backfilling).
   */
  recordAt(content: string, category: string, timestamp: number, metadata?: Record<string, unknown>): TemporalEntry {
    const entry: TemporalEntry = {
      id: `tm_${++this.idCounter}`,
      content,
      category,
      timestamp,
      metadata: metadata ?? {},
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Query entries within a specific time range.
   */
  queryTimeRange(start: Date, end: Date, category?: string): readonly TemporalEntry[] {
    const startMs = start.getTime();
    const endMs = end.getTime();

    return this.entries
      .filter((e) => {
        if (e.timestamp < startMs || e.timestamp > endMs) return false;
        if (category && e.category !== category) return false;
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Query using a natural language time expression.
   */
  queryNaturalTime(timeExpression: string, category?: string): readonly TemporalEntry[] {
    const range = parseNaturalTime(timeExpression);
    if (!range) return [];
    return this.queryTimeRange(range.start, range.end, category);
  }

  /**
   * Get a summary of entries within a time range.
   */
  getTimelineSummary(start: Date, end: Date): TimelineSummary {
    const entries = this.queryTimeRange(start, end);

    const categoryMap = new Map<string, number>();
    for (const entry of entries) {
      categoryMap.set(entry.category, (categoryMap.get(entry.category) ?? 0) + 1);
    }

    const categories: CategoryCount[] = [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    return {
      start: start.getTime(),
      end: end.getTime(),
      entryCount: entries.length,
      categories,
      firstEntry: entries[0] ?? null,
      lastEntry: entries.length > 0 ? entries[entries.length - 1] ?? null : null,
    };
  }

  /**
   * Detect trends in a category over a sliding window.
   */
  detectTrends(category: string, windowDays: number): readonly Trend[] {
    const now = new Date();
    const recentEnd = now;
    const recentStart = new Date(now);
    recentStart.setDate(recentStart.getDate() - windowDays);

    const previousEnd = new Date(recentStart);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - windowDays);

    const recentEntries = this.queryTimeRange(recentStart, recentEnd, category);
    const previousEntries = this.queryTimeRange(previousStart, previousEnd, category);

    const recentCount = recentEntries.length;
    const previousCount = previousEntries.length;

    let direction: Trend["direction"];
    let changeRate: number;

    if (previousCount === 0) {
      direction = recentCount > 0 ? "increasing" : "stable";
      changeRate = recentCount > 0 ? 1 : 0;
    } else {
      changeRate = (recentCount - previousCount) / previousCount;
      if (changeRate > 0.1) direction = "increasing";
      else if (changeRate < -0.1) direction = "decreasing";
      else direction = "stable";
    }

    return [
      {
        category,
        direction,
        changeRate,
        windowDays,
        recentCount,
        previousCount,
      },
    ];
  }

  /**
   * Get total entry count.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Get all unique categories.
   */
  getCategories(): readonly string[] {
    return [...new Set(this.entries.map((e) => e.category))];
  }

  // -- Temporal QA primitives (LoCoMo-inspired) --------------------------------

  /** Find entries BEFORE a specific event (by content substring). Most-recent-first. */
  queryBeforeEvent(eventContent: string, category?: string, limit?: number): readonly TemporalEntry[] {
    const event = this.findEvent(eventContent);
    if (!event) return [];
    const filtered = this.entries
      .filter((e) => e.timestamp < event.timestamp && (!category || e.category === category))
      .sort((a, b) => b.timestamp - a.timestamp);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  /** Find entries AFTER a specific event. Earliest-first. */
  queryAfterEvent(eventContent: string, category?: string, limit?: number): readonly TemporalEntry[] {
    const event = this.findEvent(eventContent);
    if (!event) return [];
    const filtered = this.entries
      .filter((e) => e.timestamp > event.timestamp && (!category || e.category === category))
      .sort((a, b) => a.timestamp - b.timestamp);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  /** Time elapsed since an event. Returns null if not found. */
  timeSinceEvent(eventContent: string): TemporalQueryResult | null {
    const event = this.findEvent(eventContent);
    if (!event) return null;
    const ms = Date.now() - event.timestamp;
    return { found: true, milliseconds: ms, human: formatTimeAgo(ms) };
  }

  /** Return matched events in chronological order with 1-based positions. Skips not-found. */
  eventOrdering(eventContents: readonly string[]): readonly EventOrderResult[] {
    const found: { content: string; timestamp: number }[] = [];
    for (const desc of eventContents) {
      const event = this.findEvent(desc);
      if (event) found.push({ content: event.content, timestamp: event.timestamp });
    }
    return [...found]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((item, idx) => ({ content: item.content, timestamp: item.timestamp, position: idx + 1 }));
  }

  /** Find entries strictly between two events. Sorted chronologically. */
  queryBetweenEvents(startEvent: string, endEvent: string, category?: string): readonly TemporalEntry[] {
    const start = this.findEvent(startEvent);
    const end = this.findEvent(endEvent);
    if (!start || !end) return [];
    const lower = Math.min(start.timestamp, end.timestamp);
    const upper = Math.max(start.timestamp, end.timestamp);
    return this.entries
      .filter((e) => e.timestamp > lower && e.timestamp < upper && (!category || e.category === category))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Duration between two events. Returns null if either not found. */
  getDuration(startEvent: string, endEvent: string): TemporalQueryResult | null {
    const start = this.findEvent(startEvent);
    const end = this.findEvent(endEvent);
    if (!start || !end) return null;
    const ms = Math.abs(end.timestamp - start.timestamp);
    return { found: true, milliseconds: ms, human: formatDuration(ms) };
  }

  /** Frequency of events in a category over a time window. */
  getEventFrequency(category: string, windowDays: number): EventFrequencyResult {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const matching = this.entries.filter((e) => e.category === category && e.timestamp >= cutoff);
    const uniqueDays = new Set(
      matching.map((e) => {
        const d = new Date(e.timestamp);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }),
    );
    return {
      eventsPerDay: windowDays > 0 ? matching.length / windowDays : 0,
      totalEvents: matching.length,
      activeDays: uniqueDays.size,
    };
  }

  /** Find most recent entry matching content substring (case-insensitive). */
  private findEvent(contentSubstring: string): TemporalEntry | null {
    const lower = contentSubstring.toLowerCase();
    const matches = this.entries
      .filter((e) => e.content.toLowerCase().includes(lower))
      .sort((a, b) => b.timestamp - a.timestamp);
    return matches[0] ?? null;
  }
}

// -- Temporal QA helpers -----------------------------------------------------

/**
 * Convert milliseconds to a human-readable duration string.
 * Examples: "2 hours 15 minutes", "3 days 4 hours", "45 seconds"
 */
export function formatDuration(ms: number): string {
  const absMs = Math.abs(ms);

  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours % 24 > 0) parts.push(`${hours % 24} hour${hours % 24 === 1 ? "" : "s"}`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60} minute${minutes % 60 === 1 ? "" : "s"}`);
  if (parts.length === 0 && seconds > 0) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  if (parts.length === 0) parts.push("0 seconds");

  return parts.join(" ");
}

/**
 * Convert milliseconds to an "X ago" format.
 * Examples: "2 days ago", "3 hours ago", "just now"
 */
export function formatTimeAgo(ms: number): string {
  const absMs = Math.abs(ms);

  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return "just now";
}

// -- Helpers -----------------------------------------------------------------

function parseNaturalTime(expr: string): ParsedTimeRange | null {
  const trimmed = expr.trim();
  const now = new Date();

  for (const [pattern, resolver] of TIME_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return resolver(now, match);
    }
  }

  return null;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
