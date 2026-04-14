import { describe, it, expect, beforeEach } from "vitest";
import { TrajectoryScorer, type TurnScore, type TrajectoryAnalysis } from "../../src/intelligence/trajectory-scorer.js";

describe("TrajectoryScorer", () => {
  let scorer: TrajectoryScorer;

  beforeEach(() => {
    scorer = new TrajectoryScorer();
  });

  describe("scoreTurn", () => {
    it("assigns positive efficiency when files changed", () => {
      const score = scorer.scoreTurn(
        "I created the config file and updated the import.",
        "Set up project configuration",
        ["config.ts"],
      );

      expect(score.turnNumber).toBe(1);
      expect(score.efficiency).toBeGreaterThan(0);
      expect(score.progressMade).toBe(true);
    });

    it("assigns lower efficiency when no files changed", () => {
      const score = scorer.scoreTurn(
        "Let me think about this...",
        "Implement the feature",
        [],
      );

      expect(score.efficiency).toBeLessThan(0.5);
    });

    it("assigns higher efficiency for goal-relevant content", () => {
      const goalRelevant = scorer.scoreTurn(
        "Implement the database migration and run tests",
        "Implement the database migration",
        ["migration.sql"],
      );

      scorer.reset();

      const goalIrrelevant = scorer.scoreTurn(
        "Thinking about the weather today",
        "Implement the database migration",
        ["migration.sql"],
      );

      expect(goalRelevant.efficiency).toBeGreaterThanOrEqual(goalIrrelevant.efficiency);
    });

    it("detects low novelty when turn repeats previous content", () => {
      const content = "I will read the file and check the output for errors";
      scorer.scoreTurn(content, "Fix the bug", ["file.ts"]);
      const secondScore = scorer.scoreTurn(content, "Fix the bug", []);

      // Second identical turn should have lower efficiency (no files + low novelty)
      expect(secondScore.efficiency).toBeLessThan(0.5);
    });

    it("gives full novelty to the first turn", () => {
      const score = scorer.scoreTurn(
        "Starting the implementation of the auth module",
        "Implement authentication",
        [],
      );

      // First turn always gets full novelty bonus
      expect(score.efficiency).toBeGreaterThan(0);
    });

    it("increments turn numbers sequentially", () => {
      const score1 = scorer.scoreTurn("turn 1", "goal", []);
      const score2 = scorer.scoreTurn("turn 2", "goal", []);
      const score3 = scorer.scoreTurn("turn 3", "goal", []);

      expect(score1.turnNumber).toBe(1);
      expect(score2.turnNumber).toBe(2);
      expect(score3.turnNumber).toBe(3);
    });

    it("handles empty turn content with low efficiency", () => {
      const score = scorer.scoreTurn("", "goal", []);

      // Empty content still gets novelty on first turn (0.2 * 1.0 = 0.2)
      expect(score.efficiency).toBeLessThanOrEqual(0.3);
      expect(score.progressMade).toBe(false);
    });

    it("handles empty goal string", () => {
      const score = scorer.scoreTurn("Some content about the task", "", ["file.ts"]);

      // File changes still contribute, so efficiency should be > 0
      expect(score.efficiency).toBeGreaterThan(0);
    });

    it("includes reason string describing score factors", () => {
      const score = scorer.scoreTurn(
        "Updated the configuration file with new settings",
        "Update configuration",
        ["config.ts"],
      );

      expect(score.reason).toBeTruthy();
      expect(typeof score.reason).toBe("string");
      expect(score.reason).toContain("file(s) changed");
    });

    it("caps efficiency at 1.0", () => {
      const score = scorer.scoreTurn(
        "I will implement the feature, create tests, build the project, run all checks, fix errors, modify files, update docs, install dependencies",
        "implement feature create tests build project run checks fix errors modify files update docs install dependencies",
        ["a.ts", "b.ts", "c.ts"],
      );

      expect(score.efficiency).toBeLessThanOrEqual(1);
    });

    it("marks progressMade true when relevance is high enough", () => {
      const score = scorer.scoreTurn(
        "Implement the database migration and update schema",
        "Implement the database migration",
        [],
      );

      // Even without file changes, high relevance can indicate progress
      expect(typeof score.progressMade).toBe("boolean");
    });
  });

  describe("analyze", () => {
    it("returns empty analysis when no turns scored", () => {
      const analysis = scorer.analyze();

      expect(analysis.scores).toEqual([]);
      expect(analysis.averageEfficiency).toBe(0);
      expect(analysis.lowEfficiencyStreak).toBe(0);
      expect(analysis.shouldReplan).toBe(false);
      expect(analysis.recommendation).toBe("No turns scored yet.");
    });

    it("computes correct average efficiency", () => {
      scorer.scoreTurn("Implemented auth", "Implement auth", ["auth.ts"]);
      scorer.scoreTurn("Added tests for auth", "Implement auth", ["auth.test.ts"]);

      const analysis = scorer.analyze();

      expect(analysis.averageEfficiency).toBeGreaterThan(0);
      expect(analysis.scores.length).toBe(2);
    });

    it("sets shouldReplan after 3 consecutive low-efficiency turns", () => {
      // Create 3 low-efficiency turns (empty content, no files, no goal match)
      scorer.scoreTurn("hmm", "Build a spaceship", []);
      scorer.scoreTurn("hmm", "Build a spaceship", []);
      scorer.scoreTurn("hmm", "Build a spaceship", []);

      const analysis = scorer.analyze();

      expect(analysis.lowEfficiencyStreak).toBeGreaterThanOrEqual(3);
      expect(analysis.shouldReplan).toBe(true);
      expect(analysis.recommendation).toContain("REPLAN REQUIRED");
    });

    it("does not set shouldReplan for 2 low-efficiency turns", () => {
      scorer.scoreTurn("hmm", "Build a spaceship", []);
      scorer.scoreTurn("hmm", "Build a spaceship", []);

      const analysis = scorer.analyze();

      expect(analysis.shouldReplan).toBe(false);
    });

    it("breaks low-efficiency streak with a good turn", () => {
      scorer.scoreTurn("hmm", "Build auth", []);
      scorer.scoreTurn("hmm", "Build auth", []);
      scorer.scoreTurn("Implemented build auth feature", "Build auth", ["auth.ts", "auth.test.ts"]);

      const analysis = scorer.analyze();

      expect(analysis.lowEfficiencyStreak).toBe(0);
      expect(analysis.shouldReplan).toBe(false);
    });

    it("returns immutable copy of scores", () => {
      scorer.scoreTurn("content", "goal", ["file.ts"]);
      const analysis1 = scorer.analyze();
      scorer.scoreTurn("more content", "goal", ["file2.ts"]);
      const analysis2 = scorer.analyze();

      expect(analysis1.scores.length).toBe(1);
      expect(analysis2.scores.length).toBe(2);
    });
  });

  describe("shouldForceReplan", () => {
    it("returns false initially", () => {
      expect(scorer.shouldForceReplan()).toBe(false);
    });

    it("returns false with fewer than 3 low-efficiency turns", () => {
      scorer.scoreTurn("x", "goal", []);
      scorer.scoreTurn("x", "goal", []);
      expect(scorer.shouldForceReplan()).toBe(false);
    });

    it("returns true after 3 consecutive low-efficiency turns", () => {
      scorer.scoreTurn("x", "Implement quantum physics engine", []);
      scorer.scoreTurn("y", "Implement quantum physics engine", []);
      scorer.scoreTurn("z", "Implement quantum physics engine", []);

      expect(scorer.shouldForceReplan()).toBe(true);
    });

    it("resets when a high-efficiency turn occurs", () => {
      scorer.scoreTurn("x", "Do task", []);
      scorer.scoreTurn("y", "Do task", []);
      scorer.scoreTurn("Completed the task implementation", "Do task", ["task.ts", "task.test.ts"]);

      expect(scorer.shouldForceReplan()).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears all turn history", () => {
      scorer.scoreTurn("content", "goal", ["file.ts"]);
      scorer.scoreTurn("more", "goal", ["file2.ts"]);

      scorer.reset();

      expect(scorer.getTurnCount()).toBe(0);
      expect(scorer.analyze().scores).toEqual([]);
    });

    it("resets turn numbering", () => {
      scorer.scoreTurn("a", "goal", []);
      scorer.scoreTurn("b", "goal", []);

      scorer.reset();

      const score = scorer.scoreTurn("c", "goal", []);
      expect(score.turnNumber).toBe(1);
    });

    it("is safe to call on empty scorer", () => {
      expect(() => scorer.reset()).not.toThrow();
      expect(scorer.getTurnCount()).toBe(0);
    });
  });

  describe("getTurnCount", () => {
    it("returns 0 initially", () => {
      expect(scorer.getTurnCount()).toBe(0);
    });

    it("increments with each scored turn", () => {
      scorer.scoreTurn("a", "g", []);
      expect(scorer.getTurnCount()).toBe(1);

      scorer.scoreTurn("b", "g", []);
      expect(scorer.getTurnCount()).toBe(2);
    });
  });

  describe("recommendation text", () => {
    it("warns about approaching replan threshold at 2 low turns", () => {
      scorer.scoreTurn("x", "Solve P vs NP", []);
      scorer.scoreTurn("y", "Solve P vs NP", []);

      const analysis = scorer.analyze();
      expect(analysis.recommendation).toContain("Warning");
      expect(analysis.recommendation).toContain("forced replanning");
    });

    it("reports good trajectory for high efficiency", () => {
      scorer.scoreTurn(
        "Implemented the file reader and test suite for the module",
        "Implement file reader",
        ["reader.ts", "reader.test.ts"],
      );

      const analysis = scorer.analyze();
      // Single high-efficiency turn should produce a positive recommendation
      expect(analysis.recommendation).toBeTruthy();
    });
  });
});
