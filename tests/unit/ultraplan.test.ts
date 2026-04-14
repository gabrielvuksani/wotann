import { describe, it, expect } from "vitest";
import {
  buildPlanningPrompt,
  parsePlanResponse,
  shouldUseULTRAPLAN,
  getDefaultConfig,
} from "../../src/orchestration/ultraplan.js";

describe("ULTRAPLAN", () => {
  describe("buildPlanningPrompt", () => {
    it("includes the task description", () => {
      const prompt = buildPlanningPrompt("Build an auth system");
      expect(prompt).toContain("Build an auth system");
      expect(prompt).toContain("architect");
    });

    it("includes context when provided", () => {
      const prompt = buildPlanningPrompt("Build auth", "Using TypeScript with Express");
      expect(prompt).toContain("Using TypeScript with Express");
    });
  });

  describe("parsePlanResponse", () => {
    it("extracts summary from response", () => {
      const response = "## Summary\nThis is a plan to build auth.\n\n## Risks\n- Token expiry\n";
      const plan = parsePlanResponse(response);
      expect(plan.summary).toContain("plan to build auth");
    });

    it("extracts risks from response", () => {
      const response = "## Summary\nSummary here.\n\n## Risks\n- Token expiry\n- SQL injection\n";
      const plan = parsePlanResponse(response);
      expect(plan.risks.length).toBe(2);
      expect(plan.risks[0]).toContain("Token expiry");
    });

    it("extracts acceptance criteria", () => {
      const response = "## Summary\nTest.\n\n## Acceptance Criteria\n- All tests pass\n- No type errors\n";
      const plan = parsePlanResponse(response);
      expect(plan.acceptanceCriteria.length).toBe(2);
    });

    it("returns sensible defaults for empty response", () => {
      const plan = parsePlanResponse("");
      expect(plan.title).toBe("Implementation Plan");
      expect(plan.phases).toHaveLength(0);
    });
  });

  describe("shouldUseULTRAPLAN", () => {
    it("triggers for architecture tasks", () => {
      expect(shouldUseULTRAPLAN("Architect a new microservices system across multiple files")).toBe(true);
    });

    it("triggers for complex refactors", () => {
      expect(shouldUseULTRAPLAN("Refactor the entire authentication system across the whole codebase")).toBe(true);
    });

    it("does not trigger for simple tasks", () => {
      expect(shouldUseULTRAPLAN("Fix the typo on line 42")).toBe(false);
    });

    it("does not trigger for medium tasks", () => {
      expect(shouldUseULTRAPLAN("Add a new endpoint to the API")).toBe(false);
    });
  });

  describe("getDefaultConfig", () => {
    it("returns valid configuration", () => {
      const config = getDefaultConfig();
      expect(config.planModel).toBe("claude-opus-4-6");
      expect(config.maxThinkingTokens).toBe(128_000);
      expect(config.maxPlanTimeMs).toBe(30 * 60 * 1000);
    });
  });
});
