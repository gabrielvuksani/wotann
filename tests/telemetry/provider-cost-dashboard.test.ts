import { describe, it, expect, beforeEach } from "vitest";
import { ProviderCostDashboard } from "../../src/telemetry/provider-cost-dashboard.js";

describe("ProviderCostDashboard", () => {
  let dashboard: ProviderCostDashboard;

  beforeEach(() => {
    dashboard = new ProviderCostDashboard();
  });

  describe("recordCost", () => {
    it("records a cost entry and increments count", () => {
      const record = dashboard.recordCost("anthropic", "claude-opus-4-6", 5000, 0.15, 0.95);
      expect(record.id).toMatch(/^cr_/);
      expect(record.provider).toBe("anthropic");
      expect(record.quality).toBe(0.95);
      expect(dashboard.getRecordCount()).toBe(1);
    });

    it("clamps quality score to [0, 1]", () => {
      const r1 = dashboard.recordCost("openai", "gpt-5.4", 1000, 0.05, 1.5);
      const r2 = dashboard.recordCost("openai", "gpt-5.4", 1000, 0.05, -0.3);
      expect(r1.quality).toBe(1);
      expect(r2.quality).toBe(0);
    });

    it("records multiple entries", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 5000, 0.15, 0.9);
      dashboard.recordCost("openai", "gpt-5.4", 3000, 0.08, 0.8);
      dashboard.recordCost("anthropic", "claude-sonnet-4-6", 2000, 0.02, 0.7);
      expect(dashboard.getRecordCount()).toBe(3);
    });
  });

  describe("getDailyBreakdown", () => {
    it("groups records by provider+model for today", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 5000, 0.15, 0.9);
      dashboard.recordCost("anthropic", "claude-opus-4-6", 3000, 0.10, 0.85);
      dashboard.recordCost("openai", "gpt-5.4", 2000, 0.05, 0.8);

      const today = new Date().toISOString().split("T")[0]!;
      const breakdown = dashboard.getDailyBreakdown(today);

      expect(breakdown.totalCost).toBeCloseTo(0.30);
      expect(breakdown.providers.length).toBe(2);
    });

    it("returns empty breakdown for dates with no records", () => {
      const breakdown = dashboard.getDailyBreakdown("2020-01-01");
      expect(breakdown.totalCost).toBe(0);
      expect(breakdown.providers).toHaveLength(0);
    });
  });

  describe("getWeeklyBreakdown", () => {
    it("includes records from the last 7 days", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 5000, 0.15, 0.9);

      const today = new Date().toISOString().split("T")[0]!;
      const breakdown = dashboard.getWeeklyBreakdown(today);
      expect(breakdown.totalCost).toBeGreaterThan(0);
    });
  });

  describe("getCheapestForTask", () => {
    it("finds the cheapest provider for a task type", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 5000, 0.15, 0.9, "code");
      dashboard.recordCost("openai", "gpt-5.4", 5000, 0.08, 0.85, "code");
      dashboard.recordCost("anthropic", "claude-sonnet-4-6", 5000, 0.03, 0.7, "code");

      const cheapest = dashboard.getCheapestForTask("code");
      expect(cheapest).not.toBeNull();
      expect(cheapest!.avgCost).toBeLessThanOrEqual(0.08);
    });

    it("returns null for unknown task types", () => {
      const cheapest = dashboard.getCheapestForTask("nonexistent");
      expect(cheapest).toBeNull();
    });

    it("includes sample size", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 5000, 0.15, 0.9, "review");
      dashboard.recordCost("anthropic", "claude-opus-4-6", 3000, 0.10, 0.85, "review");

      const cheapest = dashboard.getCheapestForTask("review");
      expect(cheapest!.sampleSize).toBe(2);
    });
  });

  describe("checkBudget", () => {
    it("returns null when under 75% budget", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 1000, 0.01, 0.9);
      expect(dashboard.checkBudget(1.0)).toBeNull();
    });

    it("returns warning at 75-89%", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 1000, 0.80, 0.9);
      const alert = dashboard.checkBudget(1.0);
      expect(alert).not.toBeNull();
      expect(alert!.level).toBe("warning");
    });

    it("returns critical at 90-99%", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 1000, 0.95, 0.9);
      const alert = dashboard.checkBudget(1.0);
      expect(alert!.level).toBe("critical");
    });

    it("returns exceeded at 100%+", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 1000, 1.50, 0.9);
      const alert = dashboard.checkBudget(1.0);
      expect(alert!.level).toBe("exceeded");
      expect(alert!.percentUsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe("renderDashboard", () => {
    it("renders a formatted text dashboard", () => {
      dashboard.recordCost("anthropic", "claude-opus-4-6", 5000, 0.15, 0.9);
      dashboard.recordCost("openai", "gpt-5.4", 3000, 0.08, 0.8);

      const output = dashboard.renderDashboard();
      expect(output).toContain("=== Provider Cost Dashboard ===");
      expect(output).toContain("Total Spent");
      expect(output).toContain("Total Tokens");
    });

    it("shows no-activity message when empty day", () => {
      const output = dashboard.renderDashboard();
      expect(output).toContain("No activity today");
    });
  });
});
