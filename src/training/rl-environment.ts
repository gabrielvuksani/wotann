/**
 * RL Training Environment -- reinforcement learning for agent improvement.
 *
 * Uses autonomous execution mode AS the RL environment: the agent takes
 * actions, receives observations, and gets rewards based on outcomes
 * (tests pass, typecheck clean, efficiency metrics).
 *
 * From Hermes Atropos: trajectory collection with 65KB compression.
 *
 * Components:
 * - RLEnvironment: episode management and reward computation
 * - TrajectoryCollector: state-action-reward sequence collection
 * - BatchRunner: parallel episode execution for data collection
 */

import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────────────

export interface Step {
  readonly observation: string;
  readonly action: string;
  readonly reward: number;
  readonly done: boolean;
  readonly info: Record<string, unknown>;
}

export interface Episode {
  readonly id: string;
  readonly task: string;
  readonly steps: readonly Step[];
  readonly totalReward: number;
  readonly success: boolean;
  readonly startedAt: number;
  readonly completedAt: number | null;
}

export interface RewardComponents {
  readonly testsPass: number;
  readonly typecheckClean: number;
  readonly efficiencyBonus: number;
  readonly penaltyDeductions: number;
  readonly total: number;
}

export interface RewardInput {
  readonly testsPass: boolean;
  readonly typecheckClean: boolean;
  readonly tokensUsed: number;
  readonly stepsUsed: number;
  readonly maxSteps: number;
  readonly errorsEncountered: number;
}

export interface Trajectory {
  readonly episodeId: string;
  readonly steps: readonly Step[];
  readonly metadata: TrajectoryMetadata;
}

export interface TrajectoryMetadata {
  readonly task: string;
  readonly totalReward: number;
  readonly success: boolean;
  readonly stepCount: number;
  readonly durationMs: number;
  readonly compressedSizeBytes: number;
}

export interface CompressedTrajectory {
  readonly episodeId: string;
  readonly summary: string;
  readonly keySteps: readonly Step[];
  readonly metadata: TrajectoryMetadata;
}

export interface BatchResult {
  readonly episodes: readonly Episode[];
  readonly averageReward: number;
  readonly successRate: number;
  readonly totalSteps: number;
  readonly totalDurationMs: number;
}

// ── Reward Constants ─────────────────────────────────────

const REWARD_TESTS_PASS = 1.0;
const REWARD_TYPECHECK_CLEAN = 0.5;
const REWARD_EFFICIENCY_MAX = 0.3;
const PENALTY_PER_ERROR = -0.1;
const PENALTY_STEP_WASTE = -0.05;

// ── RLEnvironment Class ──────────────────────────────────

export class RLEnvironment {
  private episodes: Map<string, Episode> = new Map();
  private activeEpisodeId: string | null = null;
  private currentSteps: Step[] = [];

  /**
   * Create a new RL episode for a task.
   */
  createEpisode(task: string): Episode {
    const episode: Episode = {
      id: randomUUID(),
      task,
      steps: [],
      totalReward: 0,
      success: false,
      startedAt: Date.now(),
      completedAt: null,
    };

    this.episodes.set(episode.id, episode);
    this.activeEpisodeId = episode.id;
    this.currentSteps = [];
    return episode;
  }

  /**
   * Record a step in the active episode.
   */
  recordStep(observation: string, action: string, reward: number, done: boolean, info: Record<string, unknown> = {}): Step {
    const step: Step = { observation, action, reward, done, info };
    this.currentSteps = [...this.currentSteps, step];

    if (done && this.activeEpisodeId) {
      this.finalizeEpisode(reward >= 0);
    }

    return step;
  }

  /**
   * Compute reward based on execution results.
   */
  computeReward(result: RewardInput): RewardComponents {
    let testsPass = 0;
    let typecheckClean = 0;
    let efficiencyBonus = 0;
    let penaltyDeductions = 0;

    // Core rewards
    if (result.testsPass) testsPass = REWARD_TESTS_PASS;
    if (result.typecheckClean) typecheckClean = REWARD_TYPECHECK_CLEAN;

    // Efficiency: fewer steps and tokens = bonus
    if (result.maxSteps > 0) {
      const stepRatio = 1 - (result.stepsUsed / result.maxSteps);
      efficiencyBonus = Math.max(0, stepRatio * REWARD_EFFICIENCY_MAX);
    }

    // Penalties (use Math.min to ensure non-positive, avoid -0)
    penaltyDeductions = result.errorsEncountered > 0
      ? result.errorsEncountered * PENALTY_PER_ERROR
      : 0;
    if (result.stepsUsed > result.maxSteps * 0.8) {
      penaltyDeductions += PENALTY_STEP_WASTE;
    }

    const total = testsPass + typecheckClean + efficiencyBonus + penaltyDeductions;

    return { testsPass, typecheckClean, efficiencyBonus, penaltyDeductions, total };
  }

  /**
   * Get the active episode, or null if none.
   */
  getActiveEpisode(): Episode | null {
    if (!this.activeEpisodeId) return null;
    return this.episodes.get(this.activeEpisodeId) ?? null;
  }

  /**
   * Get an episode by ID.
   */
  getEpisode(id: string): Episode | null {
    return this.episodes.get(id) ?? null;
  }

  /**
   * Get all completed episodes.
   */
  getCompletedEpisodes(): readonly Episode[] {
    return [...this.episodes.values()].filter((e) => e.completedAt !== null);
  }

  /**
   * Get the total number of episodes.
   */
  getEpisodeCount(): number {
    return this.episodes.size;
  }

  /**
   * Finalize the active episode.
   */
  private finalizeEpisode(success: boolean): void {
    if (!this.activeEpisodeId) return;
    const episode = this.episodes.get(this.activeEpisodeId);
    if (!episode) return;

    const totalReward = this.currentSteps.reduce((sum, s) => sum + s.reward, 0);
    const updated: Episode = {
      ...episode,
      steps: [...this.currentSteps],
      totalReward,
      success,
      completedAt: Date.now(),
    };

    this.episodes.set(this.activeEpisodeId, updated);
    this.activeEpisodeId = null;
    this.currentSteps = [];
  }

  /**
   * Force-complete the active episode (e.g., on timeout).
   */
  forceComplete(success: boolean = false): void {
    this.finalizeEpisode(success);
  }
}

// ── TrajectoryCollector Class ────────────────────────────

export class TrajectoryCollector {
  private trajectories: Trajectory[] = [];

  /**
   * Collect a trajectory from a completed episode.
   */
  collect(episode: Episode): Trajectory {
    const durationMs = episode.completedAt
      ? episode.completedAt - episode.startedAt
      : Date.now() - episode.startedAt;

    const trajectory: Trajectory = {
      episodeId: episode.id,
      steps: [...episode.steps],
      metadata: {
        task: episode.task,
        totalReward: episode.totalReward,
        success: episode.success,
        stepCount: episode.steps.length,
        durationMs,
        compressedSizeBytes: 0,
      },
    };

    this.trajectories = [...this.trajectories, trajectory];
    return trajectory;
  }

  /**
   * Compress a trajectory for efficient storage.
   * Keeps only key decision points and summarizes the rest.
   * Inspired by Hermes 65KB compression.
   */
  compressTrajectory(trajectory: Trajectory): CompressedTrajectory {
    const { steps } = trajectory;

    // Keep steps with high reward magnitude (important decisions)
    const keySteps = steps.filter((s) =>
      Math.abs(s.reward) > 0.3 || s.done,
    );

    // If too few key steps, keep first and last
    const effectiveKeySteps = keySteps.length >= 2
      ? keySteps
      : steps.length >= 2
        ? [steps[0]!, steps[steps.length - 1]!]
        : [...steps];

    // Build summary
    const totalReward = steps.reduce((sum, s) => sum + s.reward, 0);
    const summary = [
      `Task: ${trajectory.metadata.task}`,
      `Steps: ${steps.length}`,
      `Reward: ${totalReward.toFixed(2)}`,
      `Success: ${trajectory.metadata.success}`,
      `Key decisions: ${effectiveKeySteps.length}`,
    ].join(" | ");

    const compressed = JSON.stringify({ summary, keySteps: effectiveKeySteps });

    return {
      episodeId: trajectory.episodeId,
      summary,
      keySteps: effectiveKeySteps,
      metadata: {
        ...trajectory.metadata,
        compressedSizeBytes: new TextEncoder().encode(compressed).length,
      },
    };
  }

  /**
   * Get all collected trajectories.
   */
  getTrajectories(): readonly Trajectory[] {
    return [...this.trajectories];
  }

  /**
   * Get the number of trajectories collected.
   */
  getCount(): number {
    return this.trajectories.length;
  }

  /**
   * Clear all collected trajectories.
   */
  clear(): void {
    this.trajectories = [];
  }
}

// ── BatchRunner Class ────────────────────────────────────

export class BatchRunner {
  private readonly env: RLEnvironment;
  private readonly collector: TrajectoryCollector;

  constructor(env: RLEnvironment, collector: TrajectoryCollector) {
    this.env = env;
    this.collector = collector;
  }

  /**
   * Run multiple episodes sequentially for data collection.
   * The executeFn handles the actual agent interaction.
   */
  async runBatch(
    tasks: readonly string[],
    executeFn: (task: string, env: RLEnvironment) => Promise<void>,
  ): Promise<BatchResult> {
    const startTime = Date.now();
    const episodes: Episode[] = [];

    for (const task of tasks) {
      this.env.createEpisode(task);
      try {
        await executeFn(task, this.env);
      } catch {
        this.env.forceComplete(false);
      }

      const completed = this.env.getActiveEpisode();
      if (completed) {
        this.env.forceComplete(false);
      }

      // Get the latest completed episode
      const allCompleted = this.env.getCompletedEpisodes();
      const latest = allCompleted[allCompleted.length - 1];
      if (latest) {
        episodes.push(latest);
        this.collector.collect(latest);
      }
    }

    const totalSteps = episodes.reduce((sum, e) => sum + e.steps.length, 0);
    const totalReward = episodes.reduce((sum, e) => sum + e.totalReward, 0);
    const successCount = episodes.filter((e) => e.success).length;

    return {
      episodes,
      averageReward: episodes.length > 0 ? totalReward / episodes.length : 0,
      successRate: episodes.length > 0 ? successCount / episodes.length : 0,
      totalSteps,
      totalDurationMs: Date.now() - startTime,
    };
  }
}
