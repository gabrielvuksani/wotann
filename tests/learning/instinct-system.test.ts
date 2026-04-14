import { describe, it, expect } from "vitest";
import { InstinctSystem } from "../../src/learning/instinct-system.js";

describe("InstinctSystem", () => {
  describe("observe", () => {
    it("creates a new instinct for a novel event", () => {
      const system = new InstinctSystem();
      const result = system.observe("typescript error", "editing code");

      expect(result.createdInstincts).toBe(1);
      expect(result.matchedInstincts).toBe(0);
      expect(system.getInstinctCount()).toBe(1);
    });

    it("matches existing instinct for similar event", () => {
      const system = new InstinctSystem();
      system.observe("typescript error in provider", "editing code");
      const result = system.observe("typescript error in provider", "debugging");

      expect(result.matchedInstincts).toBe(1);
      expect(result.updatedInstincts).toBe(1);
      expect(result.createdInstincts).toBe(0);
    });

    it("increments occurrence count on match", () => {
      const system = new InstinctSystem();
      system.observe("typescript compilation failed", "build");
      system.observe("typescript compilation failed", "build again");

      const instincts = system.getAllInstincts();
      expect(instincts[0]?.occurrences).toBe(2);
    });

    it("creates separate instincts for different events", () => {
      const system = new InstinctSystem();
      system.observe("typescript error", "editing");
      system.observe("python import error", "debugging");

      expect(system.getInstinctCount()).toBe(2);
    });
  });

  describe("suggest", () => {
    it("returns empty for unrelated context", () => {
      const system = new InstinctSystem();
      system.observe("typescript error", "use strict mode");

      const suggestions = system.suggest("cooking recipes for dinner");
      expect(suggestions).toHaveLength(0);
    });

    it("returns matching instincts for related context", () => {
      const system = new InstinctSystem();
      system.observe("typescript strict mode", "enable noImplicitAny");

      const suggestions = system.suggest("typescript strict compilation");
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      expect(suggestions[0]?.relevance).toBeGreaterThan(0);
    });

    it("filters out instincts below confidence threshold", () => {
      const system = new InstinctSystem(0.8);
      // Default confidence is 0.5, which is below threshold of 0.8
      system.observe("low confidence event", "some action");

      const suggestions = system.suggest("low confidence event");
      expect(suggestions).toHaveLength(0);
    });

    it("sorts suggestions by relevance descending", () => {
      const system = new InstinctSystem(0.1);
      system.observe("typescript error handling", "add try-catch");
      system.observe("typescript type guard", "use narrowing");

      // Boost one instinct's confidence
      const instincts = system.getAllInstincts();
      const errorInstinct = instincts.find((i) => i.pattern.includes("error"));
      if (errorInstinct) {
        system.reinforce(errorInstinct.id, true);
        system.reinforce(errorInstinct.id, true);
      }

      const suggestions = system.suggest("typescript error");
      if (suggestions.length > 1) {
        expect(suggestions[0]!.relevance).toBeGreaterThanOrEqual(suggestions[1]!.relevance);
      }
    });
  });

  describe("reinforce", () => {
    it("boosts confidence on positive reinforcement", () => {
      const system = new InstinctSystem();
      system.observe("use immutable patterns", "always return new objects");

      const instincts = system.getAllInstincts();
      const id = instincts[0]!.id;
      const before = instincts[0]!.confidence;

      system.reinforce(id, true);
      const after = system.getInstinct(id);

      expect(after?.confidence).toBeGreaterThan(before);
      expect(after?.positiveReinforcements).toBe(1);
    });

    it("reduces confidence on negative reinforcement", () => {
      const system = new InstinctSystem();
      system.observe("mutate state directly", "bad practice");

      const instincts = system.getAllInstincts();
      const id = instincts[0]!.id;
      const before = instincts[0]!.confidence;

      system.reinforce(id, false);
      const after = system.getInstinct(id);

      expect(after?.confidence).toBeLessThan(before);
      expect(after?.negativeReinforcements).toBe(1);
    });

    it("returns null for unknown instinct ID", () => {
      const system = new InstinctSystem();
      const result = system.reinforce("nonexistent", true);
      expect(result).toBeNull();
    });

    it("clamps confidence to [0.01, 1.0]", () => {
      const system = new InstinctSystem();
      system.observe("test event", "test action");

      const id = system.getAllInstincts()[0]!.id;

      // Boost many times
      for (let i = 0; i < 50; i++) {
        system.reinforce(id, true);
      }
      expect(system.getInstinct(id)?.confidence).toBeLessThanOrEqual(1.0);

      // Penalize many times
      for (let i = 0; i < 100; i++) {
        system.reinforce(id, false);
      }
      expect(system.getInstinct(id)?.confidence).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe("applyDecay", () => {
    it("reduces confidence for old instincts", () => {
      const system = new InstinctSystem();
      system.observe("old pattern", "old action");

      const id = system.getAllInstincts()[0]!.id;
      const before = system.getInstinct(id)!.confidence;

      // Simulate 60 days passing
      const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      system.applyDecay(futureDate);

      const after = system.getInstinct(id);
      expect(after?.confidence).toBeLessThan(before);
    });

    it("does not decay recently seen instincts", () => {
      const system = new InstinctSystem();
      system.observe("recent pattern", "recent action");

      const id = system.getAllInstincts()[0]!.id;
      const before = system.getInstinct(id)!.confidence;

      // Same moment — no time has passed
      system.applyDecay(new Date());

      const after = system.getInstinct(id);
      expect(after?.confidence).toBe(before);
    });

    it("returns count of decayed instincts", () => {
      const system = new InstinctSystem();
      system.observe("pattern one", "action one");
      system.observe("pattern two", "action two");

      const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const count = system.applyDecay(futureDate);

      expect(count).toBe(2);
    });
  });

  describe("getSkillCandidates", () => {
    it("returns empty when no high-confidence instincts exist", () => {
      const system = new InstinctSystem();
      system.observe("low confidence", "some action");

      const candidates = system.getSkillCandidates();
      expect(candidates).toHaveLength(0);
    });

    it("returns instincts above 0.9 confidence", () => {
      const system = new InstinctSystem();
      system.observe("highly reliable pattern", "proven action");

      const id = system.getAllInstincts()[0]!.id;

      // Boost to above 0.9
      for (let i = 0; i < 20; i++) {
        system.reinforce(id, true);
      }

      const candidates = system.getSkillCandidates();
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("prune", () => {
    it("removes instincts below confidence floor", () => {
      const system = new InstinctSystem();
      system.observe("good pattern", "keep this");
      system.observe("bad pattern", "remove this");

      const instincts = system.getAllInstincts();
      const badId = instincts[1]!.id;

      // Hammer with negative reinforcement
      for (let i = 0; i < 20; i++) {
        system.reinforce(badId, false);
      }

      const pruned = system.prune(0.1);
      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(system.getInstinctCount()).toBeLessThan(2);
    });

    it("returns 0 when nothing to prune", () => {
      const system = new InstinctSystem();
      system.observe("healthy pattern", "good action");

      const pruned = system.prune(0.01);
      expect(pruned).toBe(0);
    });
  });

  describe("getAllInstincts", () => {
    it("returns a snapshot (immutable)", () => {
      const system = new InstinctSystem();
      system.observe("pattern one", "action one");

      const first = system.getAllInstincts();
      system.observe("pattern two", "action two");
      const second = system.getAllInstincts();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(2);
    });
  });
});
