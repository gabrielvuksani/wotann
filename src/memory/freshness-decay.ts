/**
 * Freshness Decay Engine — 30-day half-life relevance scoring.
 *
 * Applies exponential decay to memory relevance scores:
 * - Unverified entries: 30-day half-life
 * - Verified entries: 90-day half-life (3x slower decay)
 * - Frequently accessed entries: decay slowed by access frequency
 * - Reinforced entries: decay reset on explicit reinforcement
 *
 * Integrates with the MemoryStore's freshness_score column.
 * Runs as a periodic maintenance pass (via autoDream or heartbeat).
 */

import type { MemoryEntry } from "./store.js";

// ── Types ────────────────────────────────────────────────

export interface FreshnessConfig {
  /** Half-life for unverified entries in days (default: 30) */
  readonly halfLifeUnverifiedDays: number;
  /** Half-life for verified entries in days (default: 90) */
  readonly halfLifeVerifiedDays: number;
  /** Maximum boost from access frequency (default: 0.2) */
  readonly maxAccessBoost: number;
  /** Number of accesses needed for full boost (default: 10) */
  readonly accessBoostSaturation: number;
  /** Floor score: entries never decay below this (default: 0.05) */
  readonly floorScore: number;
}

export interface FreshnessScore {
  readonly entryId: string;
  readonly rawDecay: number;
  readonly accessBoost: number;
  readonly verificationMultiplier: number;
  readonly finalScore: number;
  readonly ageDays: number;
}

export interface DecayBatchResult {
  readonly processed: number;
  readonly updated: number;
  readonly belowThreshold: number;
  readonly averageFreshness: number;
  readonly oldestEntryDays: number;
}

// ── Store Interface ──────────────────────────────────────

/**
 * Minimal interface for the MemoryStore methods used by FreshnessDecayEngine.
 * Decouples from the concrete MemoryStore class.
 */
export interface FreshnessStoreAdapter {
  getByLayer(layer: string): readonly MemoryEntry[];
  getById(id: string): MemoryEntry | null;
}

// ── Constants ────────────────────────────────────────────

const DEFAULT_CONFIG: FreshnessConfig = {
  halfLifeUnverifiedDays: 30,
  halfLifeVerifiedDays: 90,
  maxAccessBoost: 0.2,
  accessBoostSaturation: 10,
  floorScore: 0.05,
};

// ── Freshness Decay Engine ───────────────────────────────

export class FreshnessDecayEngine {
  private readonly config: FreshnessConfig;

  constructor(config?: Partial<FreshnessConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute the freshness score for a single memory entry.
   *
   * Score = max(floor, rawDecay + accessBoost) * verificationMultiplier
   *
   * rawDecay = exp(-lambda * ageDays), where lambda = ln(2) / halfLife
   * accessBoost = maxBoost * min(1, accessCount / saturation)
   * verificationMultiplier = verified ? 1.0 : 0.85
   */
  computeScore(entry: MemoryEntry, accessCount?: number): FreshnessScore {
    const ageDays = this.computeAgeDays(entry);
    const halfLife = entry.verified
      ? this.config.halfLifeVerifiedDays
      : this.config.halfLifeUnverifiedDays;

    // Exponential decay
    const lambda = Math.LN2 / halfLife;
    const rawDecay = Math.exp(-lambda * ageDays);

    // Access frequency boost
    const accessFraction = Math.min(1, (accessCount ?? 0) / this.config.accessBoostSaturation);
    const accessBoost = this.config.maxAccessBoost * accessFraction;

    // Verification multiplier
    const verificationMultiplier = entry.verified ? 1.0 : 0.85;

    // Combine and clamp
    const combined = (rawDecay + accessBoost) * verificationMultiplier;
    const finalScore = Math.max(this.config.floorScore, Math.min(1, combined));

    return {
      entryId: entry.id,
      rawDecay,
      accessBoost,
      verificationMultiplier,
      finalScore,
      ageDays,
    };
  }

  /**
   * Compute freshness scores for a batch of entries.
   * Returns individual scores plus aggregate statistics.
   */
  computeBatch(
    entries: readonly MemoryEntry[],
    accessCounts?: ReadonlyMap<string, number>,
  ): {
    readonly scores: readonly FreshnessScore[];
    readonly result: DecayBatchResult;
  } {
    const scores: FreshnessScore[] = [];
    let belowThreshold = 0;
    let totalFreshness = 0;
    let oldestDays = 0;

    for (const entry of entries) {
      const accessCount = accessCounts?.get(entry.id) ?? 0;
      const score = this.computeScore(entry, accessCount);
      scores.push(score);

      totalFreshness += score.finalScore;
      if (score.finalScore < 0.3) belowThreshold++;
      if (score.ageDays > oldestDays) oldestDays = score.ageDays;
    }

    return {
      scores,
      result: {
        processed: entries.length,
        updated: scores.filter((s) => s.finalScore < 0.99).length,
        belowThreshold,
        averageFreshness: entries.length > 0 ? totalFreshness / entries.length : 0,
        oldestEntryDays: oldestDays,
      },
    };
  }

  /**
   * Determine if an entry should be archived (tombstoned) based on its freshness.
   * An entry is archival-candidate when:
   * - Freshness score below 0.1
   * - Not verified
   * - Older than 90 days
   */
  shouldArchive(entry: MemoryEntry): boolean {
    const score = this.computeScore(entry);
    const ageDays = this.computeAgeDays(entry);
    return score.finalScore < 0.1 && !entry.verified && ageDays > 90;
  }

  /**
   * Reset the decay clock for an entry (e.g., when it is explicitly reinforced).
   * Returns a new MemoryEntry with updatedAt set to now.
   */
  reinforceEntry(entry: MemoryEntry): MemoryEntry {
    return {
      ...entry,
      updatedAt: new Date().toISOString(),
      freshnessScore: 1.0,
    };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): FreshnessConfig {
    return { ...this.config };
  }

  // ── Private Helpers ────────────────────────────────────

  private computeAgeDays(entry: MemoryEntry): number {
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
}
