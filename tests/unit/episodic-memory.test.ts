import { describe, it, expect, beforeEach } from "vitest";
import { EpisodicMemory } from "../../src/memory/episodic-memory.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Episodic Memory", () => {
  let memory: EpisodicMemory;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-test-"));
    memory = new EpisodicMemory(tempDir);
  });

  describe("episode lifecycle", () => {
    it("starts a new episode", () => {
      const id = memory.startEpisode("Fix auth middleware", "anthropic", "claude-opus-4-6");
      expect(id).toMatch(/^ep_/);
      const current = memory.getCurrentEpisode();
      expect(current?.title).toBe("Fix auth middleware");
      expect(current?.outcome).toBe("in-progress");
    });

    it("records events to the current episode", () => {
      memory.startEpisode("Some task", "anthropic", "claude-opus-4-6");
      memory.recordEvent("plan", "Will modify auth.ts");
      memory.recordEvent("edit", "Changed auth.ts", { file: "src/auth.ts" });

      const current = memory.getCurrentEpisode();
      expect(current?.events.length).toBeGreaterThanOrEqual(2); // start + plan + edit
      expect(current?.filesModified).toContain("src/auth.ts");
    });

    it("records errors", () => {
      memory.startEpisode("Debug task", "openai", "gpt-5.4");
      memory.recordEvent("error", "Type error in auth.ts");

      const current = memory.getCurrentEpisode();
      expect(current?.errorsEncountered).toContain("Type error in auth.ts");
    });

    it("records strategies", () => {
      memory.startEpisode("Complex task", "anthropic", "claude-opus-4-6");
      memory.recordStrategy("decompose");
      memory.recordStrategy("research-first");

      const current = memory.getCurrentEpisode();
      expect(current?.strategies).toContain("decompose");
      expect(current?.strategies).toContain("research-first");
    });

    it("records lessons learned", () => {
      memory.startEpisode("Learning task", "anthropic", "claude-opus-4-6");
      memory.recordLesson("Always check both import and export when debugging module errors");

      const current = memory.getCurrentEpisode();
      expect(current?.lessonsLearned).toHaveLength(1);
    });

    it("completes an episode and persists it", () => {
      memory.startEpisode("Persisted task", "anthropic", "claude-opus-4-6");
      memory.recordEvent("edit", "Changed files");
      const completed = memory.completeEpisode("success");

      expect(completed?.outcome).toBe("success");
      expect(completed?.completedAt).toBeTruthy();
      expect(memory.getCurrentEpisode()).toBeNull();
    });

    it("accumulates cost and tokens", () => {
      memory.startEpisode("Cost tracking", "anthropic", "claude-opus-4-6");
      memory.recordEvent("edit", "Edit 1", { tokensUsed: 1000, cost: 0.01 });
      memory.recordEvent("edit", "Edit 2", { tokensUsed: 2000, cost: 0.02 });

      const current = memory.getCurrentEpisode();
      expect(current?.totalTokensUsed).toBe(3000);
      expect(current?.totalCost).toBeCloseTo(0.03);
    });
  });

  describe("search", () => {
    it("searches by text", () => {
      memory.startEpisode("Fix authentication bug in middleware", "anthropic", "claude-opus-4-6");
      memory.completeEpisode("success");

      memory.startEpisode("Add database migration", "openai", "gpt-5.4");
      memory.completeEpisode("success");

      const results = memory.search({ searchText: "authentication" });
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toContain("authentication");
    });

    it("searches by outcome", () => {
      memory.startEpisode("Success task", "anthropic", "claude-opus-4-6");
      memory.completeEpisode("success");

      memory.startEpisode("Failed task", "anthropic", "claude-opus-4-6");
      memory.completeEpisode("failure");

      const successes = memory.search({ outcome: "success" });
      expect(successes).toHaveLength(1);
    });

    it("searches by tags", () => {
      memory.startEpisode("Fix auth login bug", "anthropic", "claude-opus-4-6");
      memory.completeEpisode("success");

      memory.startEpisode("Deploy new release", "openai", "gpt-5.4");
      memory.completeEpisode("success");

      const authResults = memory.search({ tags: ["auth"] });
      expect(authResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("recall and lessons", () => {
    it("recalls a specific episode by ID", () => {
      const id = memory.startEpisode("Recallable task", "anthropic", "claude-opus-4-6");
      memory.recordLesson("Test first!");
      memory.completeEpisode("success");

      const recalled = memory.recall(id);
      expect(recalled?.title).toBe("Recallable task");
      expect(recalled?.lessonsLearned).toContain("Test first!");
    });

    it("returns null for unknown episode ID", () => {
      expect(memory.recall("nonexistent")).toBeNull();
    });

    it("gets lessons for similar tasks", () => {
      memory.startEpisode("Fix auth token validation", "anthropic", "claude-opus-4-6");
      memory.recordLesson("Always verify token expiration separately from signature");
      memory.completeEpisode("success");

      const lessons = memory.getLessonsForTask("Auth token issues");
      expect(lessons.length).toBeGreaterThanOrEqual(1);
    });

    it("gets cost/time estimates for similar tasks", () => {
      memory.startEpisode("Fix database migration script", "anthropic", "claude-opus-4-6");
      memory.recordEvent("edit", "Fix", { tokensUsed: 5000, cost: 0.05 });
      memory.completeEpisode("success");

      const estimate = memory.getEstimateForTask("Database migration fix");
      expect(estimate).not.toBeNull();
      expect(estimate?.sampleSize).toBe(1);
      expect(estimate?.avgCost).toBeCloseTo(0.05);
    });
  });
});
