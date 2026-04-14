/**
 * Trajectory Scorer: detect when the agent is meandering without progress.
 * After 3 low-efficiency turns, force replanning.
 *
 * Based on TerminalBench research:
 * - ForgeCode: per-turn efficiency analysis and forced replanning
 * - LangChain: LoopDetection middleware catches circular patterns
 * - arxiv 2603.05344 (OpenDev): trajectory-level scoring for adaptive routing
 *
 * Scoring criteria per turn:
 * 1. Did files actually change? (tangible progress)
 * 2. Does the response content address the stated goal? (relevance)
 * 3. Is the turn similar to previous turns? (loop detection)
 * 4. Is the turn moving toward completion? (momentum)
 */

// ── Types ────────────────────────────────────────────────────

export interface TurnScore {
  readonly turnNumber: number;
  readonly efficiency: number; // 0-1
  readonly progressMade: boolean;
  readonly reason: string;
}

export interface TrajectoryAnalysis {
  readonly scores: readonly TurnScore[];
  readonly averageEfficiency: number;
  readonly lowEfficiencyStreak: number;
  readonly shouldReplan: boolean;
  readonly recommendation: string;
}

// ── Scorer ───────────────────────────────────────────────────

const LOW_EFFICIENCY_THRESHOLD = 0.3;
const REPLAN_STREAK_THRESHOLD = 3;
const SIMILARITY_THRESHOLD = 0.6;

export class TrajectoryScorer {
  private readonly turnScores: TurnScore[] = [];
  private readonly turnContents: string[] = [];

  /**
   * Score a single turn based on content, goal alignment, and file changes.
   * Returns a new TurnScore (does not mutate; appends to internal history).
   */
  scoreTurn(
    turnContent: string,
    originalGoal: string,
    filesChanged: readonly string[],
  ): TurnScore {
    const turnNumber = this.turnScores.length + 1;

    // Factor 1: File changes indicate tangible progress
    const fileChangeScore = filesChanged.length > 0 ? 0.4 : 0.0;

    // Factor 2: Goal relevance — does the turn content relate to the goal?
    const relevanceScore = computeGoalRelevance(turnContent, originalGoal) * 0.3;

    // Factor 3: Novelty — is this turn different from previous turns?
    const noveltyScore = computeNovelty(turnContent, this.turnContents) * 0.2;

    // Factor 4: Content substance — does the turn have meaningful content?
    const substanceScore = computeSubstance(turnContent) * 0.1;

    const efficiency = Math.min(1, fileChangeScore + relevanceScore + noveltyScore + substanceScore);
    const progressMade = filesChanged.length > 0 || relevanceScore > 0.15;
    const reason = buildScoreReason(fileChangeScore, relevanceScore, noveltyScore, substanceScore, filesChanged);

    const score: TurnScore = {
      turnNumber,
      efficiency: roundTo(efficiency, 3),
      progressMade,
      reason,
    };

    // Append to internal history (the array grows; each TurnScore is immutable)
    this.turnScores.push(score);
    this.turnContents.push(turnContent);

    return score;
  }

  /**
   * Analyze the full trajectory so far.
   * Returns an immutable analysis with recommendations.
   */
  analyze(): TrajectoryAnalysis {
    if (this.turnScores.length === 0) {
      return {
        scores: [],
        averageEfficiency: 0,
        lowEfficiencyStreak: 0,
        shouldReplan: false,
        recommendation: "No turns scored yet.",
      };
    }

    const averageEfficiency = computeAverage(this.turnScores.map((s) => s.efficiency));
    const streak = computeLowEfficiencyStreak(this.turnScores);
    const shouldReplan = streak >= REPLAN_STREAK_THRESHOLD;

    const recommendation = buildRecommendation(
      averageEfficiency,
      streak,
      shouldReplan,
      this.turnScores.length,
    );

    return {
      scores: [...this.turnScores],
      averageEfficiency: roundTo(averageEfficiency, 3),
      lowEfficiencyStreak: streak,
      shouldReplan,
      recommendation,
    };
  }

  /**
   * Check if a forced replan is needed (3+ consecutive low-efficiency turns).
   */
  shouldForceReplan(): boolean {
    return computeLowEfficiencyStreak(this.turnScores) >= REPLAN_STREAK_THRESHOLD;
  }

  /**
   * Reset the scorer for a new task. Returns a fresh scorer state.
   */
  reset(): void {
    this.turnScores.length = 0;
    this.turnContents.length = 0;
  }

  /**
   * Get the current number of scored turns.
   */
  getTurnCount(): number {
    return this.turnScores.length;
  }
}

// ── Scoring Helpers ──────────────────────────────────────────

function computeGoalRelevance(turnContent: string, goal: string): number {
  const goalTokens = tokenize(goal);
  const turnTokens = tokenize(turnContent);

  if (goalTokens.length === 0) return 0;

  const goalSet = new Set(goalTokens);
  let matches = 0;
  for (const token of turnTokens) {
    if (goalSet.has(token)) {
      matches++;
    }
  }

  // Ratio of goal tokens found in the turn content
  return Math.min(1, matches / goalTokens.length);
}

function computeNovelty(turnContent: string, previousContents: readonly string[]): number {
  if (previousContents.length === 0) return 1.0; // First turn is always novel

  const turnTokens = tokenize(turnContent);
  const turnSet = new Set(turnTokens);

  // Compare against each previous turn; find the most similar one
  let maxSimilarity = 0;
  for (const prev of previousContents) {
    const prevTokens = tokenize(prev);
    const prevSet = new Set(prevTokens);

    // Jaccard similarity
    let intersection = 0;
    for (const token of turnSet) {
      if (prevSet.has(token)) intersection++;
    }
    const union = new Set([...turnTokens, ...prevTokens]).size;
    const similarity = union > 0 ? intersection / union : 0;

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
    }
  }

  // High similarity = low novelty
  return maxSimilarity > SIMILARITY_THRESHOLD ? 1 - maxSimilarity : 1.0;
}

function computeSubstance(turnContent: string): number {
  const trimmed = turnContent.trim();
  if (trimmed.length === 0) return 0;

  // Short responses with little content are low-substance
  if (trimmed.length < 50) return 0.2;
  if (trimmed.length < 200) return 0.5;

  // Check for actionable content indicators
  const actionIndicators = [
    /\bfile\b/i, /\bcreate/i, /\bmodif/i, /\bfix/i, /\bimplement/i,
    /\btest/i, /\brun/i, /\bbuild/i, /\binstall/i, /\bupdate/i,
  ];
  let actionCount = 0;
  for (const pattern of actionIndicators) {
    if (pattern.test(trimmed)) actionCount++;
  }

  return Math.min(1, 0.5 + actionCount * 0.1);
}

function computeLowEfficiencyStreak(scores: readonly TurnScore[]): number {
  let streak = 0;
  // Count backward from the most recent turn
  for (let i = scores.length - 1; i >= 0; i--) {
    const score = scores[i];
    if (score && score.efficiency < LOW_EFFICIENCY_THRESHOLD) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function computeAverage(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum / values.length;
}

// ── Reason/Recommendation Builders ──────────────────────────

function buildScoreReason(
  fileChange: number,
  relevance: number,
  novelty: number,
  substance: number,
  filesChanged: readonly string[],
): string {
  const parts: string[] = [];

  if (fileChange > 0) {
    parts.push(`${filesChanged.length} file(s) changed`);
  } else {
    parts.push("no files changed");
  }

  if (relevance > 0.2) {
    parts.push("goal-relevant content");
  } else {
    parts.push("low goal relevance");
  }

  if (novelty < 0.5) {
    parts.push("similar to previous turns");
  }

  if (substance < 0.3) {
    parts.push("low-substance response");
  }

  return parts.join("; ");
}

function buildRecommendation(
  avgEfficiency: number,
  streak: number,
  shouldReplan: boolean,
  totalTurns: number,
): string {
  if (shouldReplan) {
    return (
      `REPLAN REQUIRED: ${streak} consecutive low-efficiency turns detected. ` +
      "The agent appears stuck. Force a fresh plan with explicit next steps."
    );
  }

  if (avgEfficiency < 0.3 && totalTurns > 2) {
    return (
      "Overall efficiency is low. Consider providing more specific instructions " +
      "or breaking the task into smaller subtasks."
    );
  }

  if (streak >= 2) {
    return (
      `Warning: ${streak} consecutive low-efficiency turns. ` +
      "One more will trigger forced replanning."
    );
  }

  if (avgEfficiency > 0.7) {
    return "Good trajectory efficiency. Continue with current approach.";
  }

  return "Moderate efficiency. Monitor for further degradation.";
}

// ── Utilities ────────────────────────────────────────────────

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
