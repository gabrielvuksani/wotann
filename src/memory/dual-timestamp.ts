/**
 * Dual-layer timestamps — Phase 6A.
 *
 * Existing TemporalEntry (src/memory/temporal-memory.ts) has only ONE
 * timestamp. For queries like "what did we say LAST WEEK about last
 * YEAR's launch?" that's insufficient — we need to distinguish:
 *   - documentDate: when the memory was RECORDED (the writing date)
 *   - eventDate:    when the event the memory refers to HAPPENED
 *
 * Supermemory, Mem0, and LongMemEval agents that keep both see
 * +6-10% on temporal-reasoning-heavy benchmarks. Without the split,
 * a recent note about an ancient event can't be distinguished from a
 * recent note about a recent event.
 *
 * This module ships:
 *   - DualTimestampEntry — memory with both dates + optional
 *     eventDate uncertainty window
 *   - parseDateHints — extract eventDate from free-text ("last week",
 *     "in 2023", "yesterday") using a small deterministic parser
 *   - query helpers: recordedIn, eventIn, recordedAndEventIn
 *
 * Pure module. No storage coupling. Callers persist via their own
 * graph store or the existing TemporalMemory.
 */

// ── Types ──────────────────────────────────────────────

export interface DualTimestampEntry {
  readonly id: string;
  readonly content: string;
  /** Unix ms — when this entry was created/written (always known). */
  readonly documentDate: number;
  /** Unix ms — when the referenced event actually happened. */
  readonly eventDate: number;
  /**
   * Uncertainty in eventDate as ±ms. 0 = exact, 86_400_000 = ±1 day,
   * etc. Use when parsing imprecise natural-language dates.
   */
  readonly eventDateUncertaintyMs?: number;
  /** Free-text source of the eventDate — "extracted from context", "user-supplied", etc. */
  readonly eventDateSource?: string;
}

export interface DateHint {
  readonly date: number;
  readonly uncertaintyMs: number;
  readonly sourceText: string;
}

// ── Parser ────────────────────────────────────────────

const DAY_MS = 86_400_000;

const RELATIVE_PATTERNS: ReadonlyArray<{
  readonly re: RegExp;
  readonly delta: (now: number, match: RegExpMatchArray) => { date: number; uncertainty: number };
}> = [
  {
    re: /\byesterday\b/i,
    delta: (now) => ({ date: now - DAY_MS, uncertainty: DAY_MS / 2 }),
  },
  {
    re: /\btoday\b/i,
    delta: (now) => ({ date: now, uncertainty: DAY_MS / 2 }),
  },
  {
    re: /\btomorrow\b/i,
    delta: (now) => ({ date: now + DAY_MS, uncertainty: DAY_MS / 2 }),
  },
  {
    re: /\blast\s+week\b/i,
    delta: (now) => ({ date: now - 7 * DAY_MS, uncertainty: 3 * DAY_MS }),
  },
  {
    re: /\bnext\s+week\b/i,
    delta: (now) => ({ date: now + 7 * DAY_MS, uncertainty: 3 * DAY_MS }),
  },
  {
    re: /\blast\s+month\b/i,
    delta: (now) => ({ date: now - 30 * DAY_MS, uncertainty: 15 * DAY_MS }),
  },
  {
    re: /\blast\s+year\b/i,
    delta: (now) => ({ date: now - 365 * DAY_MS, uncertainty: 180 * DAY_MS }),
  },
  {
    re: /\b(\d+)\s+days?\s+ago\b/i,
    delta: (now, match) => ({
      date: now - Number(match[1]) * DAY_MS,
      uncertainty: DAY_MS,
    }),
  },
  {
    re: /\b(\d+)\s+weeks?\s+ago\b/i,
    delta: (now, match) => ({
      date: now - Number(match[1]) * 7 * DAY_MS,
      uncertainty: 2 * DAY_MS,
    }),
  },
  {
    re: /\b(\d+)\s+months?\s+ago\b/i,
    delta: (now, match) => ({
      date: now - Number(match[1]) * 30 * DAY_MS,
      uncertainty: 15 * DAY_MS,
    }),
  },
  {
    re: /\b(\d+)\s+years?\s+ago\b/i,
    delta: (now, match) => ({
      date: now - Number(match[1]) * 365 * DAY_MS,
      uncertainty: 180 * DAY_MS,
    }),
  },
];

const ISO_DATE_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const YEAR_ONLY_RE = /\b(?:in|during|of)?\s*(19\d{2}|20\d{2}|21\d{2})\b/i;

/**
 * Parse natural-language date hints from text. Returns all matches in
 * source order (the first is typically the most relevant). Pass a
 * reference `now` timestamp for relative expressions.
 */
export function parseDateHints(text: string, now: number = Date.now()): readonly DateHint[] {
  const hints: DateHint[] = [];

  // Relative patterns
  for (const pattern of RELATIVE_PATTERNS) {
    const match = text.match(pattern.re);
    if (match) {
      const { date, uncertainty } = pattern.delta(now, match);
      hints.push({
        date,
        uncertaintyMs: uncertainty,
        sourceText: match[0],
      });
    }
  }

  // ISO dates (YYYY-MM-DD)
  const isoMatch = text.match(ISO_DATE_RE);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1; // 0-indexed
    const day = Number(isoMatch[3]);
    const parsed = Date.UTC(year, month, day);
    hints.push({
      date: parsed,
      uncertaintyMs: DAY_MS / 2,
      sourceText: isoMatch[0],
    });
  }

  // Year-only ("in 2023", "during 2025")
  const yearMatch = text.match(YEAR_ONLY_RE);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    // Guard: don't double-count if ISO already captured this year
    if (!hints.some((h) => new Date(h.date).getUTCFullYear() === year)) {
      hints.push({
        date: Date.UTC(year, 6, 1), // mid-year
        uncertaintyMs: 180 * DAY_MS,
        sourceText: yearMatch[0],
      });
    }
  }

  // Sort by position in text (earliest first)
  hints.sort((a, b) => text.indexOf(a.sourceText) - text.indexOf(b.sourceText));
  return hints;
}

/**
 * Build a DualTimestampEntry from content, extracting eventDate via
 * parseDateHints. If no hints found, eventDate falls back to
 * documentDate with high uncertainty (flagged via source field).
 */
export function buildEntry(
  input: {
    readonly id: string;
    readonly content: string;
    readonly documentDate?: number;
    readonly eventDateOverride?: number;
    readonly eventDateUncertaintyMs?: number;
  },
  now: number = Date.now(),
): DualTimestampEntry {
  const documentDate = input.documentDate ?? now;
  if (input.eventDateOverride !== undefined) {
    return {
      id: input.id,
      content: input.content,
      documentDate,
      eventDate: input.eventDateOverride,
      ...(input.eventDateUncertaintyMs !== undefined
        ? { eventDateUncertaintyMs: input.eventDateUncertaintyMs }
        : {}),
      eventDateSource: "user-supplied",
    };
  }
  const hints = parseDateHints(input.content, documentDate);
  if (hints.length === 0) {
    return {
      id: input.id,
      content: input.content,
      documentDate,
      eventDate: documentDate,
      eventDateUncertaintyMs: 7 * DAY_MS,
      eventDateSource: "fallback-to-documentDate",
    };
  }
  const first = hints[0]!;
  return {
    id: input.id,
    content: input.content,
    documentDate,
    eventDate: first.date,
    eventDateUncertaintyMs: first.uncertaintyMs,
    eventDateSource: `extracted: "${first.sourceText}"`,
  };
}

// ── Query helpers ─────────────────────────────────────

export interface DateRange {
  readonly from: number;
  readonly to: number;
}

/** Filter entries written within [from, to]. */
export function recordedIn(
  entries: readonly DualTimestampEntry[],
  range: DateRange,
): readonly DualTimestampEntry[] {
  return entries.filter((e) => e.documentDate >= range.from && e.documentDate <= range.to);
}

/** Filter entries whose referenced event is within [from, to]. */
export function eventIn(
  entries: readonly DualTimestampEntry[],
  range: DateRange,
): readonly DualTimestampEntry[] {
  return entries.filter((e) => e.eventDate >= range.from && e.eventDate <= range.to);
}

/**
 * Filter entries that satisfy BOTH: recorded in `documentRange` AND
 * refer to an event in `eventRange`. Answers queries like
 * "what did we say last week about last year's launch?".
 */
export function recordedAndEventIn(
  entries: readonly DualTimestampEntry[],
  documentRange: DateRange,
  eventRange: DateRange,
): readonly DualTimestampEntry[] {
  return entries.filter(
    (e) =>
      e.documentDate >= documentRange.from &&
      e.documentDate <= documentRange.to &&
      e.eventDate >= eventRange.from &&
      e.eventDate <= eventRange.to,
  );
}

/**
 * Expand an entry's eventDate +/- uncertainty into a range. Useful for
 * fuzzy-match queries.
 */
export function eventDateRange(entry: DualTimestampEntry): DateRange {
  const uncertainty = entry.eventDateUncertaintyMs ?? 0;
  return {
    from: entry.eventDate - uncertainty,
    to: entry.eventDate + uncertainty,
  };
}

// ── Ingest helpers (Phase H wiring) ───────────────────

/**
 * Ingest-time dual-timestamp payload. Extracted from raw content at the
 * moment a memory is written — never re-derived at read time (which
 * would drift with clock changes).
 */
export interface DualTimestampIngestPayload {
  readonly documentDate: number;
  readonly eventDate: number;
  readonly eventDateUncertaintyMs: number;
  readonly eventDateSource: string;
}

/**
 * Derive dual-timestamp fields from raw content at ingest.
 *
 * Contract:
 *   - documentDate = now (or caller-supplied recordedAt)
 *   - eventDate    = first parsed hint, or falls back to documentDate
 *   - eventDateSource is NEVER empty — "fallback-to-documentDate" is an
 *     honest admission rather than a silent fabricated exact-match.
 *
 * Used by MemoryStore.insert / insertWithProvenance / captureEvent to
 * populate the `document_date` / `event_date` columns on every write.
 */
export function deriveIngestTimestamps(
  content: string,
  recordedAt: number = Date.now(),
): DualTimestampIngestPayload {
  const hints = parseDateHints(content, recordedAt);
  if (hints.length === 0) {
    return {
      documentDate: recordedAt,
      eventDate: recordedAt,
      eventDateUncertaintyMs: 7 * DAY_MS,
      eventDateSource: "fallback-to-documentDate",
    };
  }
  const first = hints[0]!;
  return {
    documentDate: recordedAt,
    eventDate: first.date,
    eventDateUncertaintyMs: first.uncertaintyMs,
    eventDateSource: `extracted: "${first.sourceText}"`,
  };
}

/**
 * Two entries are "temporally conflicting" when they refer to the same
 * event range but have contradictory content. Detection is structural
 * only — content conflict is the caller's responsibility (see
 * contradiction-detector.ts). Returns true when their event-ranges
 * overlap AND their document-dates are similarly close (recent enough
 * that a real contradiction is possible).
 */
export function temporallyConflicting(
  a: DualTimestampEntry,
  b: DualTimestampEntry,
  documentProximityMs: number = 30 * DAY_MS,
): boolean {
  const ra = eventDateRange(a);
  const rb = eventDateRange(b);
  const overlap = ra.from <= rb.to && rb.from <= ra.to;
  if (!overlap) return false;
  const docDelta = Math.abs(a.documentDate - b.documentDate);
  return docDelta <= documentProximityMs;
}
