import { describe, it, expect, beforeEach } from "vitest";
import {
  RLEnvironment,
  TrajectoryCollector,
  BatchRunner,
  type Step,
  type Episode,
  type RewardInput,
} from "../../src/training/rl-environment.js";

describe("RLEnvironment", () => {
  let env: RLEnvironment;

  beforeEach(() => {
    env = new RLEnvironment();
  });

  // ── Episode Creation ──────────────────────────────────

  describe("createEpisode", () => {
    it("creates an episode with correct initial state", () => {
      const episode = env.createEpisode("Fix TypeScript errors");

      expect(episode.id).toBeDefined();
      expect(episode.task).toBe("Fix TypeScript errors");
      expect(episode.steps).toHaveLength(0);
      expect(episode.totalReward).toBe(0);
      expect(episode.success).toBe(false);
      expect(episode.startedAt).toBeGreaterThan(0);
      expect(episode.completedAt).toBeNull();
    });

    it("sets the created episode as active", () => {
      const episode = env.createEpisode("task");
      const active = env.getActiveEpisode();

      expect(active).not.toBeNull();
      expect(active!.id).toBe(episode.id);
    });

    it("creates episodes with unique IDs", () => {
      const ep1 = env.createEpisode("task-1");
      env.forceComplete();
      const ep2 = env.createEpisode("task-2");

      expect(ep1.id).not.toBe(ep2.id);
    });
  });

  // ── Step Recording ────────────���───────────────────────

  describe("recordStep", () => {
    it("records a step in the active episode", () => {
      env.createEpisode("task");
      const step = env.recordStep("error: type mismatch", "fix type", 0.5, false);

      expect(step.observation).toBe("error: type mismatch");
      expect(step.action).toBe("fix type");
      expect(step.reward).toBe(0.5);
      expect(step.done).toBe(false);
    });

    it("finalizes episode when done=true", () => {
      env.createEpisode("task");
      env.recordStep("obs1", "act1", 0.5, false);
      env.recordStep("obs2", "act2", 1.0, true);

      expect(env.getActiveEpisode()).toBeNull();

      const completed = env.getCompletedEpisodes();
      expect(completed).toHaveLength(1);
      expect(completed[0]!.steps).toHaveLength(2);
      expect(completed[0]!.completedAt).not.toBeNull();
    });

    it("accumulates total reward", () => {
      env.createEpisode("task");
      env.recordStep("obs1", "act1", 0.5, false);
      env.recordStep("obs2", "act2", 1.0, true);

      const completed = env.getCompletedEpisodes();
      expect(completed[0]!.totalReward).toBeCloseTo(1.5);
    });
  });

  // ── Reward Computation ────────────���───────────────────

  describe("computeReward", () => {
    it("gives full reward for passing tests and typecheck", () => {
      const result = env.computeReward({
        testsPass: true,
        typecheckClean: true,
        tokensUsed: 100,
        stepsUsed: 3,
        maxSteps: 10,
        errorsEncountered: 0,
      });

      expect(result.testsPass).toBe(1.0);
      expect(result.typecheckClean).toBe(0.5);
      expect(result.efficiencyBonus).toBeGreaterThan(0);
      expect(result.penaltyDeductions).toBe(0);
      expect(result.total).toBeGreaterThan(1.5);
    });

    it("gives zero for failing tests", () => {
      const result = env.computeReward({
        testsPass: false,
        typecheckClean: false,
        tokensUsed: 1000,
        stepsUsed: 10,
        maxSteps: 10,
        errorsEncountered: 5,
      });

      expect(result.testsPass).toBe(0);
      expect(result.typecheckClean).toBe(0);
      expect(result.penaltyDeductions).toBeLessThan(0);
      expect(result.total).toBeLessThan(0);
    });

    it("rewards efficiency (fewer steps)", () => {
      const efficient = env.computeReward({
        testsPass: true,
        typecheckClean: true,
        tokensUsed: 50,
        stepsUsed: 2,
        maxSteps: 10,
        errorsEncountered: 0,
      });

      const slow = env.computeReward({
        testsPass: true,
        typecheckClean: true,
        tokensUsed: 500,
        stepsUsed: 9,
        maxSteps: 10,
        errorsEncountered: 0,
      });

      expect(efficient.efficiencyBonus).toBeGreaterThan(slow.efficiencyBonus);
    });

    it("penalizes errors encountered", () => {
      const clean = env.computeReward({
        testsPass: true,
        typecheckClean: true,
        tokensUsed: 100,
        stepsUsed: 5,
        maxSteps: 10,
        errorsEncountered: 0,
      });

      const errored = env.computeReward({
        testsPass: true,
        typecheckClean: true,
        tokensUsed: 100,
        stepsUsed: 5,
        maxSteps: 10,
        errorsEncountered: 3,
      });

      expect(clean.total).toBeGreaterThan(errored.total);
    });
  });

  // ── Force Complete ────────────────────────────────────

  describe("forceComplete", () => {
    it("completes the active episode", () => {
      env.createEpisode("task");
      env.recordStep("obs", "act", 0.5, false);
      env.forceComplete(false);

      expect(env.getActiveEpisode()).toBeNull();
      expect(env.getCompletedEpisodes()).toHaveLength(1);
    });

    it("does nothing when no active episode", () => {
      env.forceComplete(); // Should not throw
      expect(env.getCompletedEpisodes()).toHaveLength(0);
    });
  });

  // ── Episode Queries ───────���───────────────────────────

  describe("episode queries", () => {
    it("getEpisode returns episode by ID", () => {
      const created = env.createEpisode("task");
      const found = env.getEpisode(created.id);
      expect(found).not.toBeNull();
      expect(found!.task).toBe("task");
    });

    it("getEpisode returns null for unknown ID", () => {
      expect(env.getEpisode("nonexistent")).toBeNull();
    });

    it("getEpisodeCount tracks total episodes", () => {
      expect(env.getEpisodeCount()).toBe(0);
      env.createEpisode("task-1");
      expect(env.getEpisodeCount()).toBe(1);
      env.forceComplete();
      env.createEpisode("task-2");
      expect(env.getEpisodeCount()).toBe(2);
    });
  });
});

// ── TrajectoryCollector ─────────────────────────────────

describe("TrajectoryCollector", () => {
  let collector: TrajectoryCollector;

  beforeEach(() => {
    collector = new TrajectoryCollector();
  });

  it("collects trajectory from completed episode", () => {
    const episode: Episode = {
      id: "ep-1",
      task: "Fix bug",
      steps: [
        { observation: "error", action: "fix", reward: 0.5, done: false, info: {} },
        { observation: "clean", action: "test", reward: 1.0, done: true, info: {} },
      ],
      totalReward: 1.5,
      success: true,
      startedAt: 1000,
      completedAt: 5000,
    };

    const trajectory = collector.collect(episode);

    expect(trajectory.episodeId).toBe("ep-1");
    expect(trajectory.steps).toHaveLength(2);
    expect(trajectory.metadata.task).toBe("Fix bug");
    expect(trajectory.metadata.success).toBe(true);
    expect(trajectory.metadata.durationMs).toBe(4000);
  });

  it("compresses trajectory keeping key steps", () => {
    const episode: Episode = {
      id: "ep-2",
      task: "Optimize code",
      steps: [
        { observation: "slow", action: "profile", reward: 0.1, done: false, info: {} },
        { observation: "found", action: "optimize", reward: 0.5, done: false, info: {} },
        { observation: "fast", action: "verify", reward: 1.0, done: true, info: {} },
      ],
      totalReward: 1.6,
      success: true,
      startedAt: 1000,
      completedAt: 8000,
    };

    const trajectory = collector.collect(episode);
    const compressed = collector.compressTrajectory(trajectory);

    expect(compressed.episodeId).toBe("ep-2");
    expect(compressed.summary).toContain("Optimize code");
    expect(compressed.keySteps.length).toBeLessThanOrEqual(trajectory.steps.length);
    expect(compressed.metadata.compressedSizeBytes).toBeGreaterThan(0);
  });

  it("tracks collection count", () => {
    expect(collector.getCount()).toBe(0);

    const episode: Episode = {
      id: "ep-1",
      task: "task",
      steps: [],
      totalReward: 0,
      success: false,
      startedAt: 0,
      completedAt: 1000,
    };

    collector.collect(episode);
    expect(collector.getCount()).toBe(1);
  });

  it("clear removes all trajectories", () => {
    const episode: Episode = {
      id: "ep-1",
      task: "task",
      steps: [],
      totalReward: 0,
      success: false,
      startedAt: 0,
      completedAt: 1000,
    };

    collector.collect(episode);
    collector.clear();
    expect(collector.getCount()).toBe(0);
    expect(collector.getTrajectories()).toHaveLength(0);
  });
});

// ── BatchRunner ────────────���────────────────────────────

describe("BatchRunner", () => {
  it("runs batch of tasks and collects results", async () => {
    const env = new RLEnvironment();
    const collector = new TrajectoryCollector();
    const runner = new BatchRunner(env, collector);

    const tasks = ["task-1", "task-2", "task-3"];

    const result = await runner.runBatch(tasks, async (task, rlEnv) => {
      rlEnv.recordStep("start", "begin", 0.5, false);
      rlEnv.recordStep("done", "finish", 1.0, true);
    });

    expect(result.episodes).toHaveLength(3);
    expect(result.successRate).toBeGreaterThan(0);
    expect(result.totalSteps).toBeGreaterThan(0);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles errors gracefully", async () => {
    const env = new RLEnvironment();
    const collector = new TrajectoryCollector();
    const runner = new BatchRunner(env, collector);

    const result = await runner.runBatch(["fail-task"], async () => {
      throw new Error("Execution failed");
    });

    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]!.success).toBe(false);
  });
});
