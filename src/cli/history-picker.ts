/**
 * History Picker — Ctrl+R fuzzy search over past conversations.
 *
 * Stores conversation history entries (prompt, provider, model, cost, timestamp)
 * in a JSON file on disk. Provides fuzzy search for the TUI's Ctrl+R binding
 * and ordered retrieval by recency.
 *
 * Design:
 * - Immutable HistoryEntry objects (readonly fields)
 * - Load/save cycle keeps file as source of truth
 * - Fuzzy matching uses normalized trigram overlap
 * - Bounded in-memory list (capped at MAX_ENTRIES to prevent unbounded growth)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────────────

export interface HistoryEntry {
  readonly id: string;
  readonly prompt: string;
  readonly timestamp: number;
  readonly provider: string;
  readonly model: string;
  readonly cost: number;
}

export interface HistorySearchResult {
  readonly entry: HistoryEntry;
  readonly score: number;
}

// ── Constants ────────────────────────────────────────────

const MAX_ENTRIES = 10_000;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_RECENT_LIMIT = 50;

// ── Fuzzy Search ─────────────────────────────────────────

/**
 * Build a set of trigrams from a string for fuzzy matching.
 */
function buildTrigrams(text: string): ReadonlySet<string> {
  const lower = text.toLowerCase();
  const trigrams = new Set<string>();
  for (let i = 0; i <= lower.length - 3; i++) {
    trigrams.add(lower.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Compute a fuzzy similarity score between query and text (0-1).
 * Uses trigram overlap ratio. Falls back to substring check for short queries.
 */
function fuzzyScore(query: string, text: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  // Exact substring match gets a high score
  if (lowerText.includes(lowerQuery)) {
    return 0.9 + 0.1 * (lowerQuery.length / lowerText.length);
  }

  // For very short queries (< 3 chars), use simple includes on words
  if (lowerQuery.length < 3) {
    const words = lowerText.split(/\s+/);
    const matchCount = words.filter((w) => w.startsWith(lowerQuery)).length;
    return matchCount > 0 ? 0.5 + 0.1 * Math.min(matchCount, 5) : 0;
  }

  // Trigram overlap for longer queries
  const queryTrigrams = buildTrigrams(lowerQuery);
  const textTrigrams = buildTrigrams(lowerText);

  if (queryTrigrams.size === 0) return 0;

  let matches = 0;
  for (const trigram of queryTrigrams) {
    if (textTrigrams.has(trigram)) matches++;
  }

  return matches / queryTrigrams.size;
}

// ── History Picker ───────────────────────────────────────

export class HistoryPicker {
  private entries: readonly HistoryEntry[];
  private readonly historyPath: string;

  constructor(historyPath: string) {
    this.historyPath = resolve(historyPath);
    this.entries = [];
  }

  /**
   * Fuzzy search history entries by query string.
   * Returns results sorted by relevance score (descending).
   */
  search(query: string, limit: number = DEFAULT_SEARCH_LIMIT): readonly HistoryEntry[] {
    if (query.trim().length === 0) {
      return this.recent(limit);
    }

    const scored: HistorySearchResult[] = [];
    for (const entry of this.entries) {
      const score = fuzzyScore(query, entry.prompt);
      if (score > 0.1) {
        scored.push({ entry, score });
      }
    }

    // Sort by score descending, then by timestamp descending for ties
    scored.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      return b.entry.timestamp - a.entry.timestamp;
    });

    return scored.slice(0, limit).map((r) => r.entry);
  }

  /**
   * Add a new history entry. Generates a UUID for the id field.
   * Caps the list at MAX_ENTRIES by dropping the oldest entries.
   */
  add(entry: Omit<HistoryEntry, "id">): void {
    const newEntry: HistoryEntry = {
      id: randomUUID(),
      ...entry,
    };

    // Prepend new entry (most recent first), cap at max
    const updated = [newEntry, ...this.entries];
    this.entries = updated.length > MAX_ENTRIES
      ? updated.slice(0, MAX_ENTRIES)
      : updated;
  }

  /**
   * Load history entries from disk.
   * If the file does not exist or is malformed, starts with an empty list.
   */
  load(): void {
    try {
      if (!existsSync(this.historyPath)) {
        this.entries = [];
        return;
      }

      const raw = readFileSync(this.historyPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        this.entries = [];
        return;
      }

      // Validate and filter entries
      this.entries = parsed
        .filter(isValidHistoryEntry)
        .slice(0, MAX_ENTRIES);
    } catch {
      // Corrupted file — start fresh
      this.entries = [];
    }
  }

  /**
   * Persist current entries to disk as JSON.
   * Creates parent directories if they do not exist.
   */
  save(): void {
    const dir = dirname(this.historyPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.historyPath, JSON.stringify(this.entries, null, 2), "utf-8");
  }

  /**
   * Get the most recent entries, ordered by timestamp descending.
   */
  recent(limit: number = DEFAULT_RECENT_LIMIT): readonly HistoryEntry[] {
    // Entries are already stored most-recent-first from add()
    return this.entries.slice(0, limit);
  }

  /**
   * Get total number of entries in history.
   */
  getCount(): number {
    return this.entries.length;
  }
}

// ── Validation ───────────────────────────────────────────

function isValidHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["prompt"] === "string" &&
    typeof obj["timestamp"] === "number" &&
    typeof obj["provider"] === "string" &&
    typeof obj["model"] === "string" &&
    typeof obj["cost"] === "number"
  );
}
