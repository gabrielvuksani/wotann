import { describe, it, expect } from "vitest";
import { ReasoningSandwich } from "../../src/middleware/reasoning-sandwich.js";

describe("ReasoningSandwich Middleware", () => {
  it("detects planning phase on first turn", () => {
    const rs = new ReasoningSandwich();
    const adj = rs.getAdjustment("Build a new authentication system", true);

    expect(adj.phase).toBe("planning");
    expect(adj.budgetMultiplier).toBeGreaterThan(0.7);
    expect(adj.reasoningEffort).toBe("high");
  });

  it("detects execution phase for implementation prompts", () => {
    const rs = new ReasoningSandwich();
    // First turn is always planning
    rs.getAdjustment("Plan the feature", true);
    // Second turn with implementation keywords
    const adj = rs.getAdjustment("Write the login function", false);

    expect(adj.phase).toBe("execution");
    expect(adj.budgetMultiplier).toBeLessThan(0.5);
    expect(adj.reasoningEffort).toBe("low");
  });

  it("detects verification phase after code writes", () => {
    const rs = new ReasoningSandwich();
    rs.getAdjustment("Plan the feature", true);
    rs.recordCodeWrite(); // Simulate a Write tool call
    const adj = rs.getAdjustment("Now check if the tests pass", false);

    expect(adj.phase).toBe("verification");
    expect(adj.budgetMultiplier).toBeGreaterThan(0.7);
  });

  it("scales thinking tokens proportionally", () => {
    const rs = new ReasoningSandwich();
    const planning = rs.getAdjustment("Design the system", true, 10000);
    expect(planning.thinkingTokens).toBeGreaterThan(7000);

    rs.getAdjustment("", true); // reset to new task
    const rs2 = new ReasoningSandwich();
    rs2.getAdjustment("First turn", true);
    const execution = rs2.getAdjustment("Write the code", false, 10000);
    expect(execution.thinkingTokens).toBeLessThan(5000);
  });

  it("provides prompt injection for non-thinking models", () => {
    const rs = new ReasoningSandwich();
    const adj = rs.getAdjustment("Plan the architecture", true);
    expect(adj.promptInjection).toContain("Think carefully");
  });

  it("resets state for new tasks", () => {
    const rs = new ReasoningSandwich();
    rs.getAdjustment("Old task", true);
    rs.getAdjustment("Write code", false);

    rs.reset();

    const adj = rs.getAdjustment("New task entirely", true);
    expect(adj.phase).toBe("planning");
  });

  it("tracks current phase", () => {
    const rs = new ReasoningSandwich();
    expect(rs.getCurrentPhase()).toBe("unknown");

    rs.getAdjustment("Start planning", true);
    expect(rs.getCurrentPhase()).toBe("planning");
  });

  it("maps to o-series reasoning effort levels", () => {
    const rs = new ReasoningSandwich();

    const planning = rs.getAdjustment("Plan", true);
    expect(planning.reasoningEffort).toBe("high");

    const execution = rs.getAdjustment("Write the function", false);
    expect(execution.reasoningEffort).toBe("low");
  });
});
