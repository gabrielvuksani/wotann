import { describe, it, expect } from "vitest";
import { AgentFleetDashboard } from "../../src/ui/agent-fleet-dashboard.js";

describe("AgentFleetDashboard", () => {
  describe("registerAgent", () => {
    it("registers an agent with initial state", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("agent-1", "coder", "Implement feature X");

      const status = dashboard.getAgentStatus("agent-1");
      expect(status).toBeDefined();
      expect(status?.role).toBe("coder");
      expect(status?.task).toBe("Implement feature X");
      expect(status?.state).toBe("idle");
      expect(status?.tokensUsed).toBe(0);
    });

    it("increments agent count", () => {
      const dashboard = new AgentFleetDashboard();
      expect(dashboard.getAgentCount()).toBe(0);

      dashboard.registerAgent("a-1", "coder", "Task 1");
      dashboard.registerAgent("a-2", "reviewer", "Task 2");
      expect(dashboard.getAgentCount()).toBe(2);
    });
  });

  describe("updateAgent", () => {
    it("updates agent fields immutably", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("agent-1", "coder", "Task");

      dashboard.updateAgent("agent-1", {
        state: "active",
        tokensUsed: 5000,
        progress: 50,
      });

      const updated = dashboard.getAgentStatus("agent-1");
      expect(updated?.state).toBe("active");
      expect(updated?.tokensUsed).toBe(5000);
      expect(updated?.progress).toBe(50);
      // Original fields preserved
      expect(updated?.role).toBe("coder");
    });

    it("silently ignores updates to non-existent agents", () => {
      const dashboard = new AgentFleetDashboard();
      // Should not throw
      dashboard.updateAgent("nonexistent", { state: "active" });
      expect(dashboard.getAgentCount()).toBe(0);
    });
  });

  describe("removeAgent", () => {
    it("removes an agent from the fleet", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("agent-1", "coder", "Task");
      dashboard.removeAgent("agent-1");

      expect(dashboard.getAgentCount()).toBe(0);
      expect(dashboard.getAgentStatus("agent-1")).toBeUndefined();
    });
  });

  describe("getFleetStatus", () => {
    it("returns empty fleet status with no agents", () => {
      const dashboard = new AgentFleetDashboard();
      const status = dashboard.getFleetStatus();

      expect(status.agents.length).toBe(0);
      expect(status.totalActive).toBe(0);
      expect(status.totalTokens).toBe(0);
      expect(status.totalCost).toBe(0);
    });

    it("aggregates active agent count", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("a-1", "coder", "Task 1");
      dashboard.registerAgent("a-2", "reviewer", "Task 2");
      dashboard.registerAgent("a-3", "tester", "Task 3");

      dashboard.updateAgent("a-1", { state: "active" });
      dashboard.updateAgent("a-2", { state: "active" });
      dashboard.updateAgent("a-3", { state: "completed" });

      const status = dashboard.getFleetStatus();
      expect(status.totalActive).toBe(2);
      expect(status.completedTasks).toBe(1);
    });

    it("aggregates total tokens and cost", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("a-1", "coder", "Task 1");
      dashboard.registerAgent("a-2", "reviewer", "Task 2");

      dashboard.updateAgent("a-1", { tokensUsed: 10000, cost: 0.05 });
      dashboard.updateAgent("a-2", { tokensUsed: 5000, cost: 0.02 });

      const status = dashboard.getFleetStatus();
      expect(status.totalTokens).toBe(15000);
      expect(status.totalCost).toBeCloseTo(0.07, 2);
    });

    it("counts failed tasks", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("a-1", "coder", "Task 1");
      dashboard.registerAgent("a-2", "coder", "Task 2");

      dashboard.updateAgent("a-1", { state: "failed" });
      dashboard.updateAgent("a-2", { state: "completed" });

      const status = dashboard.getFleetStatus();
      expect(status.failedTasks).toBe(1);
      expect(status.completedTasks).toBe(1);
    });
  });

  describe("renderDashboard", () => {
    it("renders header and summary", () => {
      const dashboard = new AgentFleetDashboard();
      const output = dashboard.renderDashboard();

      expect(output).toContain("Agent Fleet Dashboard");
      expect(output).toContain("Active:");
      expect(output).toContain("Completed:");
    });

    it("renders no-agents message when fleet is empty", () => {
      const dashboard = new AgentFleetDashboard();
      const output = dashboard.renderDashboard();

      expect(output).toContain("No agents registered");
    });

    it("renders agent rows when agents exist", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("agent-1", "coder", "Build the auth module");
      dashboard.updateAgent("agent-1", {
        state: "active",
        tokensUsed: 15000,
        progress: 60,
      });

      const output = dashboard.renderDashboard();
      expect(output).toContain("agent-1");
      expect(output).toContain("coder");
      expect(output).toContain("active");
    });

    it("formats large token counts with K/M suffixes", () => {
      const dashboard = new AgentFleetDashboard();
      dashboard.registerAgent("a-1", "coder", "Task");
      dashboard.updateAgent("a-1", { tokensUsed: 1500000 });

      const output = dashboard.renderDashboard();
      expect(output).toContain("1.5M");
    });

    it("includes timestamp", () => {
      const dashboard = new AgentFleetDashboard();
      const output = dashboard.renderDashboard();
      expect(output).toContain("Last updated:");
    });
  });
});
