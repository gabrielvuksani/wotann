/**
 * Contradiction Detector — flags conflicts between new and existing memories.
 *
 * Builds on MemoryStore.detectContradictions() with richer analysis:
 * - Temporal contradictions: same key updated with different values over time
 * - Semantic contradictions: opposing assertions detected via negation patterns
 * - Value divergence: numeric/boolean values that conflict
 *
 * Resolution strategies:
 * - Most-recent-wins (default): newer entry takes precedence
 * - Highest-confidence: entry with higher confidence wins
 * - Flag-for-review: both kept, flagged as conflicting
 *
 * All contradictions are logged for audit trail.
 */

import type {
  MemoryEntry,
  MemorySearchResult,
  ContradictionResult,
} from "./store.js";

// ── Types ────────────────────────────────────────────────

export type ResolutionStrategy =
  | "most-recent-wins"
  | "highest-confidence"
  | "flag-for-review";

export interface ContradictionReport {
  readonly newKey: string;
  readonly newValue: string;
  readonly conflicts: readonly EnrichedContradiction[];
  readonly resolved: boolean;
  readonly strategy: ResolutionStrategy;
  readonly timestamp: string;
}

export interface EnrichedContradiction {
  readonly existingEntry: MemoryEntry;
  readonly newValue: string;
  readonly conflictType: ContradictionResult["conflictType"];
  readonly confidence: number;
  readonly ageDays: number;
  readonly existingFreshness: number;
  readonly resolution: "keep-existing" | "prefer-new" | "flagged";
}

export interface ContradictionStats {
  readonly totalChecked: number;
  readonly contradictionsFound: number;
  readonly resolvedAutomatically: number;
  readonly flaggedForReview: number;
}

// ── Negation Detection ───────────────────────────────────

const NEGATION_WORDS = new Set([
  "not", "never", "no", "none", "neither", "nor",
  "don't", "doesn't", "didn't", "won't", "wouldn't",
  "can't", "cannot", "shouldn't", "isn't", "aren't",
  "wasn't", "weren't", "hasn't", "haven't", "hadn't",
  "disabled", "removed", "deprecated", "eliminated",
  "false", "off", "stopped", "abandoned", "rejected",
]);

const BOOLEAN_PAIRS: ReadonlyMap<string, string> = new Map([
  ["true", "false"],
  ["false", "true"],
  ["enabled", "disabled"],
  ["disabled", "enabled"],
  ["yes", "no"],
  ["no", "yes"],
  ["on", "off"],
  ["off", "on"],
  ["active", "inactive"],
  ["inactive", "active"],
]);

// ── Helpers ──────────────────────────────────────────────

function extractSignificantWords(text: string): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function computeWordOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const word of a) {
    if (b.has(word)) overlap++;
  }
  return overlap / Math.max(a.size, b.size);
}

function containsNegation(text: string): boolean {
  const lower = text.toLowerCase();
  for (const neg of NEGATION_WORDS) {
    if (lower.includes(neg)) return true;
  }
  return false;
}

function detectBooleanFlip(existing: string, incoming: string): boolean {
  const existingLower = existing.toLowerCase().trim();
  const incomingLower = incoming.toLowerCase().trim();

  for (const [a, b] of BOOLEAN_PAIRS) {
    if (existingLower.includes(a) && incomingLower.includes(b)) return true;
  }
  return false;
}

function computeAgeDays(entry: MemoryEntry): number {
  try {
    const updatedTime = new Date(entry.updatedAt).getTime();
    if (!isNaN(updatedTime)) {
      return Math.max(0, (Date.now() - updatedTime) / (1000 * 60 * 60 * 24));
    }
  } catch {
    // Default to 0
  }
  return 0;
}

function computeFreshness(entry: MemoryEntry): number {
  const HALF_LIFE_DAYS = 30;
  const ageDays = computeAgeDays(entry);
  const lambda = Math.LN2 / HALF_LIFE_DAYS;
  return Math.max(0, Math.min(1, Math.exp(-lambda * ageDays)));
}

// ── Store Interface ──────────────────────────────────────

/**
 * Minimal interface for the MemoryStore methods we depend on.
 * Avoids importing the full MemoryStore class (which lives in the base store
 * that we do not own).
 */
export interface ContradictionStoreAdapter {
  search(query: string, limit: number): readonly MemorySearchResult[];
  getById(id: string): MemoryEntry | null;
}

// ── Contradiction Detector ───────────────────────────────

export class ContradictionDetector {
  private readonly store: ContradictionStoreAdapter;
  private readonly strategy: ResolutionStrategy;
  private readonly reports: ContradictionReport[] = [];
  private stats: ContradictionStats = {
    totalChecked: 0,
    contradictionsFound: 0,
    resolvedAutomatically: 0,
    flaggedForReview: 0,
  };

  constructor(
    store: ContradictionStoreAdapter,
    strategy: ResolutionStrategy = "flag-for-review",
  ) {
    this.store = store;
    this.strategy = strategy;
  }

  /**
   * Check a new memory against existing entries for contradictions.
   * Returns an enriched report with resolution decisions.
   */
  check(key: string, value: string): ContradictionReport {
    const conflicts = this.findConflicts(key, value);

    const enriched: EnrichedContradiction[] = conflicts.map((conflict) => {
      const ageDays = computeAgeDays(conflict.existingEntry);
      const freshness = computeFreshness(conflict.existingEntry);
      const resolution = this.resolveConflict(conflict, freshness);

      return {
        existingEntry: conflict.existingEntry,
        newValue: value,
        conflictType: conflict.conflictType,
        confidence: conflict.confidence,
        ageDays,
        existingFreshness: freshness,
        resolution,
      };
    });

    const allResolved = enriched.every((c) => c.resolution !== "flagged");

    const report: ContradictionReport = {
      newKey: key,
      newValue: value,
      conflicts: enriched,
      resolved: allResolved,
      strategy: this.strategy,
      timestamp: new Date().toISOString(),
    };

    this.reports.push(report);
    this.updateStats(enriched);

    return report;
  }

  /**
   * Batch-check multiple new entries.
   * Returns reports for all entries that have conflicts.
   */
  batchCheck(
    entries: readonly { key: string; value: string }[],
  ): readonly ContradictionReport[] {
    return entries
      .map((entry) => this.check(entry.key, entry.value))
      .filter((report) => report.conflicts.length > 0);
  }

  /**
   * Get all contradiction reports generated so far.
   */
  getReports(): readonly ContradictionReport[] {
    return [...this.reports];
  }

  /**
   * Get contradiction statistics.
   */
  getStats(): ContradictionStats {
    return { ...this.stats };
  }

  // ── Private Methods ────────────────────────────────────

  private findConflicts(key: string, value: string): readonly ContradictionResult[] {
    const results: ContradictionResult[] = [];

    let searchResults: readonly MemorySearchResult[];
    try {
      searchResults = this.store.search(key, 15);
    } catch {
      return results;
    }

    const newWords = extractSignificantWords(value);

    for (const result of searchResults) {
      const existing = result.entry;

      // Skip identical values
      if (existing.value === value) continue;

      const existingWords = extractSignificantWords(existing.value);
      const overlap = computeWordOverlap(newWords, existingWords);

      // Only consider entries with meaningful topic overlap
      if (overlap < 0.3) continue;

      // Check for direct boolean/value flips
      if (detectBooleanFlip(existing.value, value)) {
        results.push({
          existingEntry: existing,
          newValue: value,
          conflictType: "direct",
          confidence: 0.85,
        });
        continue;
      }

      // Check for negation-based contradictions
      const existingNegated = containsNegation(existing.value);
      const newNegated = containsNegation(value);
      if (existingNegated !== newNegated && overlap > 0.5) {
        results.push({
          existingEntry: existing,
          newValue: value,
          conflictType: "indirect",
          confidence: 0.65,
        });
        continue;
      }

      // Check for temporal contradiction: same key, different value, both recent
      if (existing.key === key && existing.value !== value) {
        const ageDays = computeAgeDays(existing);
        if (ageDays < 7) {
          results.push({
            existingEntry: existing,
            newValue: value,
            conflictType: "temporal",
            confidence: 0.7,
          });
        }
      }
    }

    this.stats = {
      ...this.stats,
      totalChecked: this.stats.totalChecked + 1,
      contradictionsFound: this.stats.contradictionsFound + results.length,
    };

    return results;
  }

  private resolveConflict(
    conflict: ContradictionResult,
    existingFreshness: number,
  ): EnrichedContradiction["resolution"] {
    switch (this.strategy) {
      case "most-recent-wins":
        // New memory always wins
        return "prefer-new";

      case "highest-confidence": {
        const existingConfidence = (conflict.existingEntry.confidence ?? 0.5) * existingFreshness;
        // New entries start with confidence 0.8 and freshness 1.0
        const newConfidence = 0.8;
        return newConfidence > existingConfidence ? "prefer-new" : "keep-existing";
      }

      case "flag-for-review":
      default:
        return "flagged";
    }
  }

  private updateStats(enriched: readonly EnrichedContradiction[]): void {
    const autoResolved = enriched.filter((c) => c.resolution !== "flagged").length;
    const flagged = enriched.filter((c) => c.resolution === "flagged").length;

    this.stats = {
      ...this.stats,
      resolvedAutomatically: this.stats.resolvedAutomatically + autoResolved,
      flaggedForReview: this.stats.flaggedForReview + flagged,
    };
  }
}
