import { describe, it, expect } from "vitest";
import {
  PWREngine,
  detectTransitionKeywords,
  getTransitionDirection,
  getPermissionForPhase,
  autoDetectNextPhase,
} from "../../src/orchestration/pwr-cycle.js";

describe("PWR Cycle", () => {
  describe("detectTransitionKeywords", () => {
    it("detects plan signals", () => {
      expect(detectTransitionKeywords("Let me rethink the approach").suggestedPhase).toBe("plan");
      expect(detectTransitionKeywords("Can we redesign this?").suggestedPhase).toBe("plan");
    });

    it("detects implement signals", () => {
      expect(detectTransitionKeywords("Just do it").suggestedPhase).toBe("implement");
      expect(detectTransitionKeywords("Go ahead and build it").suggestedPhase).toBe("implement");
    });

    it("detects review signals", () => {
      expect(detectTransitionKeywords("Review this code").suggestedPhase).toBe("review");
    });

    it("detects ship signals", () => {
      expect(detectTransitionKeywords("Commit and push").suggestedPhase).toBe("ship");
      expect(detectTransitionKeywords("Create a pull request").suggestedPhase).toBe("ship");
    });

    it("detects discuss signals (requirements change)", () => {
      expect(detectTransitionKeywords("Actually, I changed my mind").suggestedPhase).toBe("discuss");
    });

    it("returns null for ambiguous messages", () => {
      expect(detectTransitionKeywords("Hello").suggestedPhase).toBeNull();
    });
  });

  describe("getTransitionDirection", () => {
    it("forward: plan → implement", () => {
      expect(getTransitionDirection("plan", "implement")).toBe("forward");
    });

    it("backward: implement → plan", () => {
      expect(getTransitionDirection("implement", "plan")).toBe("backward");
    });

    it("lateral: same phase", () => {
      expect(getTransitionDirection("plan", "plan")).toBe("lateral");
    });
  });

  describe("getPermissionForPhase", () => {
    it("plan mode is read-only", () => {
      expect(getPermissionForPhase("plan")).toBe("plan");
    });

    it("implement mode allows edits", () => {
      expect(getPermissionForPhase("implement")).toBe("acceptEdits");
    });
  });

  describe("autoDetectNextPhase", () => {
    it("suggests discuss when no plan", () => {
      expect(autoDetectNextPhase({
        hasPlan: false,
        hasUnimplementedTasks: false,
        hasUnreviewedChanges: false,
        allTestsPassing: true,
        hasUncommittedChanges: false,
      })).toBe("discuss");
    });

    it("suggests implement when tasks remain", () => {
      expect(autoDetectNextPhase({
        hasPlan: true,
        hasUnimplementedTasks: true,
        hasUnreviewedChanges: false,
        allTestsPassing: true,
        hasUncommittedChanges: false,
      })).toBe("implement");
    });

    it("suggests fix when tests failing", () => {
      expect(autoDetectNextPhase({
        hasPlan: true,
        hasUnimplementedTasks: false,
        hasUnreviewedChanges: false,
        allTestsPassing: false,
        hasUncommittedChanges: true,
      })).toBe("fix");
    });

    it("suggests ship when ready", () => {
      expect(autoDetectNextPhase({
        hasPlan: true,
        hasUnimplementedTasks: false,
        hasUnreviewedChanges: false,
        allTestsPassing: true,
        hasUncommittedChanges: true,
      })).toBe("ship");
    });
  });

  describe("PWREngine", () => {
    it("starts in discuss phase", () => {
      const engine = new PWREngine();
      expect(engine.getCurrentPhase()).toBe("discuss");
    });

    it("transitions based on user message", () => {
      const engine = new PWREngine();
      const result = engine.processMessage("Go ahead and build it");

      expect(result.transitioned).toBe(true);
      expect(result.newPhase).toBe("implement");
      expect(result.direction).toBe("forward");
    });

    it("supports backward transitions", () => {
      const engine = new PWREngine("implement");
      const result = engine.processMessage("Let me rethink the approach");

      expect(result.transitioned).toBe(true);
      expect(result.newPhase).toBe("plan");
      expect(result.direction).toBe("backward");
    });

    it("records phase history", () => {
      const engine = new PWREngine();
      engine.processMessage("Build it");
      engine.processMessage("Review this");

      expect(engine.getPhaseHistory()).toEqual(["discuss", "implement"]);
    });

    it("stays in current phase for ambiguous messages", () => {
      const engine = new PWREngine("implement");
      const result = engine.processMessage("Hello there");

      expect(result.transitioned).toBe(false);
      expect(result.newPhase).toBe("implement");
    });
  });
});
