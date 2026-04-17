/**
 * Consensus-driven model routing -- council results train the router.
 * Over time, routing shifts toward models that win more often for
 * this user's specific codebase and task types.
 *
 * Reads council leaderboard outcomes and adjusts routing weights so
 * the model router learns from deliberation history.
 */

import type { CouncilResult } from "./council.js";

// ── Types ──────────────────────────────────────────────

export interface ConsensusWeight {
  readonly provider: string;
  readonly model: string;
  readonly winRate: number;
  readonly totalParticipations: number;
  readonly avgRank: number;
  readonly lastUpdated: string;
}

export interface TaskTypeWeight {
  readonly taskType: string;
  readonly weights: readonly ConsensusWeight[];
}

interface MutableWeightEntry {
  provider: string;
  model: string;
  wins: number;
  totalParticipations: number;
  totalRank: number;
  lastUpdated: string;
}

interface TaskTypeEntries {
  entries: Map<string, MutableWeightEntry>;
}

// ── Constants ──────────────────────────────────────────

const MIN_PARTICIPATIONS_FOR_RECOMMENDATION = 2;
const DEFAULT_TASK_TYPE = "general";

// ── Consensus Router ───────────────────────────────────

export class ConsensusRouter {
  private readonly taskWeights: Map<string, TaskTypeEntries> = new Map();

  /**
   * Update weights from a council deliberation result.
   * Extracts winner/ranking data and accumulates per task type.
   */
  updateFromCouncil(result: CouncilResult, taskType?: string): void {
    const type = taskType ?? inferTaskType(result.query);
    const bucket = this.getOrCreateBucket(type);

    for (const member of result.members) {
      const key = `${member.provider}:${member.model}`;
      const existing = bucket.entries.get(key) ?? createEmptyEntry(member.provider, member.model);

      const ranking = result.aggregateRanking.find((r) => r.memberId === member.id);
      const isWinner = ranking === result.aggregateRanking[0];
      const rank = ranking?.averageRank ?? result.members.length;

      const updated: MutableWeightEntry = {
        provider: existing.provider,
        model: existing.model,
        wins: existing.wins + (isWinner ? 1 : 0),
        totalParticipations: existing.totalParticipations + 1,
        totalRank: existing.totalRank + rank,
        lastUpdated: result.timestamp,
      };

      bucket.entries.set(key, updated);
    }
  }

  /**
   * Get the recommended provider for a given task type.
   * Returns the model with the highest win rate that has enough data.
   * Returns null if no model has enough participation history.
   */
  getRecommendedProvider(taskType: string): ConsensusWeight | null {
    const bucket = this.taskWeights.get(taskType);
    if (!bucket) return null;

    const candidates = [...bucket.entries.values()]
      .filter((e) => e.totalParticipations >= MIN_PARTICIPATIONS_FOR_RECOMMENDATION)
      .map((e) => toConsensusWeight(e))
      .sort((a, b) => {
        // Primary: higher win rate
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        // Secondary: lower average rank
        return a.avgRank - b.avgRank;
      });

    return candidates[0] ?? null;
  }

  /**
   * Get recommendations across all tracked task types.
   */
  getAllRecommendations(): readonly TaskTypeWeight[] {
    const results: TaskTypeWeight[] = [];

    for (const [taskType, bucket] of this.taskWeights) {
      const weights = [...bucket.entries.values()]
        .map((e) => toConsensusWeight(e))
        .sort((a, b) => b.winRate - a.winRate);

      results.push({ taskType, weights });
    }

    return results;
  }

  /**
   * Export all weights for persistence (e.g., save to disk between sessions).
   */
  exportWeights(): readonly ConsensusWeight[] {
    const all: ConsensusWeight[] = [];

    for (const bucket of this.taskWeights.values()) {
      for (const entry of bucket.entries.values()) {
        all.push(toConsensusWeight(entry));
      }
    }

    return all;
  }

  /**
   * Export weights grouped by task type for structured persistence.
   */
  exportByTaskType(): readonly TaskTypeWeight[] {
    return this.getAllRecommendations();
  }

  /**
   * Import weights on startup (restore from disk).
   * Merges with any existing in-memory weights.
   */
  importWeights(weights: readonly ConsensusWeight[], taskType?: string): void {
    const type = taskType ?? DEFAULT_TASK_TYPE;
    const bucket = this.getOrCreateBucket(type);

    for (const w of weights) {
      const key = `${w.provider}:${w.model}`;
      const existing = bucket.entries.get(key);

      if (existing) {
        // Merge: add participations and recalculate
        const merged: MutableWeightEntry = {
          provider: w.provider,
          model: w.model,
          wins: existing.wins + Math.round(w.winRate * w.totalParticipations),
          totalParticipations: existing.totalParticipations + w.totalParticipations,
          totalRank: existing.totalRank + w.avgRank * w.totalParticipations,
          lastUpdated: w.lastUpdated > existing.lastUpdated ? w.lastUpdated : existing.lastUpdated,
        };
        bucket.entries.set(key, merged);
      } else {
        bucket.entries.set(key, {
          provider: w.provider,
          model: w.model,
          wins: Math.round(w.winRate * w.totalParticipations),
          totalParticipations: w.totalParticipations,
          totalRank: w.avgRank * w.totalParticipations,
          lastUpdated: w.lastUpdated,
        });
      }
    }
  }

  /**
   * Compute a routing score for a provider/model pair.
   * Higher score = better recommendation.
   * Returns 0 if no data exists.
   */
  getRoutingScore(provider: string, model: string, taskType?: string): number {
    const type = taskType ?? DEFAULT_TASK_TYPE;
    const bucket = this.taskWeights.get(type);
    if (!bucket) return 0;

    const entry = bucket.entries.get(`${provider}:${model}`);
    if (!entry || entry.totalParticipations === 0) return 0;

    const winRate = entry.wins / entry.totalParticipations;
    const avgRank = entry.totalRank / entry.totalParticipations;
    const confidence = Math.min(1, entry.totalParticipations / 10);

    // Score: win rate weighted by confidence, penalized by average rank
    return winRate * confidence * (1 / Math.max(1, avgRank));
  }

  /**
   * Clear all accumulated weights (e.g., for testing or reset).
   */
  clear(): void {
    this.taskWeights.clear();
  }

  // ── Private Helpers ──────────────────────────────────

  private getOrCreateBucket(taskType: string): TaskTypeEntries {
    const existing = this.taskWeights.get(taskType);
    if (existing) return existing;

    const bucket: TaskTypeEntries = { entries: new Map() };
    this.taskWeights.set(taskType, bucket);
    return bucket;
  }
}

// ── Pure Functions ─────────────────────────────────────

function createEmptyEntry(provider: string, model: string): MutableWeightEntry {
  return {
    provider,
    model,
    wins: 0,
    totalParticipations: 0,
    totalRank: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function toConsensusWeight(entry: MutableWeightEntry): ConsensusWeight {
  return {
    provider: entry.provider,
    model: entry.model,
    winRate: entry.totalParticipations > 0 ? entry.wins / entry.totalParticipations : 0,
    totalParticipations: entry.totalParticipations,
    avgRank: entry.totalParticipations > 0 ? entry.totalRank / entry.totalParticipations : 0,
    lastUpdated: entry.lastUpdated,
  };
}

/**
 * Infer task type from the council query text.
 * Falls back to "general" if no pattern matches.
 */
function inferTaskType(query: string): string {
  const lower = query.toLowerCase();

  if (/\b(plan|architect|design|strategy|refactor|migrate)\b/.test(lower)) return "plan";
  if (/\b(review|audit|check|evaluate|assess)\b/.test(lower)) return "review";
  if (/\b(code|implement|write|function|fix|bug)\b/.test(lower)) return "code";
  if (/\b(format|convert|parse|extract|transform)\b/.test(lower)) return "utility";
  if (/\b(test|spec|assert|coverage)\b/.test(lower)) return "test";

  return DEFAULT_TASK_TYPE;
}
