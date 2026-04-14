/**
 * Shared types for the learning subsystem.
 *
 * Two distinct instinct shapes exist:
 * - DreamInstinct: used by autoDream pipeline (correction/confirmation/pattern based)
 * - Instinct: used by InstinctSystem (observation/reinforcement based)
 *
 * They share `id` and `confidence` but have different lifecycles and fields.
 */

/**
 * DreamInstinct -- produced by the autoDream consolidation pipeline.
 * Driven by corrections, confirmations, and recurring patterns.
 */
export interface DreamInstinct {
  readonly id: string;
  readonly behavior: string;
  readonly confidence: number;
  readonly source: "correction" | "confirmation" | "pattern";
  readonly createdAt: Date;
  readonly lastFired?: Date;
  readonly fireCount: number;
  readonly decayRate: number;
}

/**
 * Instinct -- produced by the InstinctSystem via observe/reinforce.
 * Driven by real-time event observation with exponential decay.
 */
export interface Instinct {
  readonly id: string;
  readonly pattern: string;
  readonly action: string;
  readonly confidence: number;
  readonly occurrences: number;
  readonly lastSeen: string;
  readonly createdAt: string;
  readonly positiveReinforcements: number;
  readonly negativeReinforcements: number;
}

/**
 * SkillCandidate -- a detected pattern being evaluated for promotion to a full skill.
 */
export interface SkillCandidate {
  readonly id: string;
  readonly name: string;
  readonly pattern: string;
  readonly toolSequence: readonly string[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly confidence: number;
  readonly version: number;
  readonly createdAt: number;
  readonly promotedAt?: number;
}

/**
 * LearningEntry -- a single extracted learning from cross-session analysis.
 */
export interface LearningEntry {
  readonly id: string;
  readonly type: "code_style" | "file_pattern" | "preference" | "error_fix" | "tool_usage";
  readonly content: string;
  readonly confidence: number;
  readonly source: string;
  readonly createdAt: number;
  readonly decayRate: number;
}

/**
 * Gotcha -- a learned "watch out for this" entry from the autoDream pipeline.
 */
export interface Gotcha {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly severity: "low" | "medium" | "high";
  readonly createdAt: number;
  readonly appliedCount: number;
}
