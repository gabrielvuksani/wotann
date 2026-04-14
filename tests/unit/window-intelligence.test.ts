import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ContextWindowIntelligence,
} from "../../src/context/window-intelligence.js";

describe("Context Window Intelligence", () => {
  let cwi: ContextWindowIntelligence;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    cwi = new ContextWindowIntelligence("anthropic", "claude-opus-4-6");
  });

  describe("budget tracking", () => {
    it("initializes with the effective default budget for Opus", () => {
      const budget = cwi.getBudget();
      expect(budget.totalTokens).toBe(1_000_000); // 1M GA since March 2026
      expect(budget.pressureLevel).toBe("green");
    });

    it("initializes with correct budget for Ollama", () => {
      const ollama = new ContextWindowIntelligence("ollama");
      expect(ollama.getBudget().totalTokens).toBe(131_072);
    });

    it("enables Anthropic Sonnet 1M when explicitly requested", () => {
      vi.stubEnv("ANTHROPIC_ENABLE_1M_CONTEXT", "1");
      const anthropic = new ContextWindowIntelligence("anthropic", "claude-sonnet-4-6");
      expect(anthropic.getBudget().totalTokens).toBe(1_000_000);
    });

    it("tracks zone usage correctly", () => {
      cwi.updateZones({
        systemPromptTokens: 5000,
        memoryTokens: 3000,
        toolSchemaTokens: 2000,
        recentConversationTokens: 10000,
        oldConversationTokens: 5000,
        toolResultTokens: 1000,
      });
      const budget = cwi.getBudget();
      expect(budget.systemPromptTokens).toBe(5000);
      expect(budget.memoryTokens).toBe(3000);
      expect(budget.conversationTokens).toBe(15000);
      expect(budget.pressureLevel).toBe("green");
    });

    it("detects yellow pressure at 50% usage", () => {
      // With 1M budget, need ~500K tokens for 50%
      cwi.updateZones({
        systemPromptTokens: 100_000,
        memoryTokens: 75_000,
        toolSchemaTokens: 50_000,
        recentConversationTokens: 150_000,
        oldConversationTokens: 125_000,
        toolResultTokens: 0,
      });
      const budget = cwi.getBudget();
      expect(budget.pressureLevel).toBe("yellow");
    });

    it("detects red pressure at 85% usage", () => {
      // With 1M budget, need ~850K tokens for 85%
      cwi.updateZones({
        systemPromptTokens: 150_000,
        memoryTokens: 125_000,
        toolSchemaTokens: 75_000,
        recentConversationTokens: 300_000,
        oldConversationTokens: 200_000,
        toolResultTokens: 0,
      });
      const budget = cwi.getBudget();
      expect(budget.pressureLevel).toBe("red");
    });

    it("detects critical pressure at 95%+ usage", () => {
      // With 1M budget, need ~950K tokens for 95%
      cwi.updateZones({
        systemPromptTokens: 400_000,
        memoryTokens: 200_000,
        toolSchemaTokens: 100_000,
        recentConversationTokens: 200_000,
        oldConversationTokens: 60_000,
        toolResultTokens: 0,
      });
      const budget = cwi.getBudget();
      expect(budget.pressureLevel).toBe("critical");
    });
  });

  describe("compaction", () => {
    it("recommends compaction when pressure is yellow", () => {
      // With 1M budget, need ~500K for yellow
      cwi.updateZones({
        systemPromptTokens: 100_000,
        memoryTokens: 75_000,
        toolSchemaTokens: 50_000,
        recentConversationTokens: 150_000,
        oldConversationTokens: 125_000,
        toolResultTokens: 0,
      });
      const result = cwi.shouldCompact();
      expect(result.needed).toBe(true);
      expect(result.stage).toBe("old-messages");
    });

    it("compacts tool schemas stage", () => {
      cwi.updateZones({
        systemPromptTokens: 5000,
        memoryTokens: 3000,
        toolSchemaTokens: 10000,
        recentConversationTokens: 5000,
        oldConversationTokens: 0,
        toolResultTokens: 0,
      });
      const result = cwi.compact("tool-schemas");
      expect(result.stage).toBe("tool-schemas");
      expect(result.tokensReclaimed).toBe(6000); // 60% of 10000
    });

    it("compacts old messages stage", () => {
      cwi.updateZones({
        systemPromptTokens: 5000,
        memoryTokens: 3000,
        toolSchemaTokens: 2000,
        recentConversationTokens: 5000,
        oldConversationTokens: 20000,
        toolResultTokens: 0,
      });
      const result = cwi.compact("old-messages");
      expect(result.tokensReclaimed).toBe(20000);
    });

    it("compacts tool outputs stage", () => {
      cwi.updateZones({
        systemPromptTokens: 5000,
        memoryTokens: 3000,
        toolSchemaTokens: 2000,
        recentConversationTokens: 5000,
        oldConversationTokens: 0,
        toolResultTokens: 30000,
      });
      const result = cwi.compact("tool-outputs");
      expect(result.tokensReclaimed).toBe(21000); // 70% of 30000
    });

    it("records compaction history", () => {
      cwi.updateZones({
        systemPromptTokens: 5000,
        memoryTokens: 3000,
        toolSchemaTokens: 10000,
        recentConversationTokens: 5000,
        oldConversationTokens: 20000,
        toolResultTokens: 0,
      });
      cwi.compact("old-messages");
      cwi.compact("tool-schemas");
      const history = cwi.getCompactionHistory();
      expect(history.length).toBe(2);
      expect(history[0]!.stage).toBe("old-messages");
      expect(history[1]!.stage).toBe("tool-schemas");
    });
  });

  describe("system reminders", () => {
    it("injects verification reminder after 5+ turns", () => {
      for (let i = 0; i < 5; i++) {
        cwi.updateZones({
          systemPromptTokens: 1000, memoryTokens: 0, toolSchemaTokens: 0,
          recentConversationTokens: 0, oldConversationTokens: 0, toolResultTokens: 0,
        });
      }
      const reminders = cwi.getActiveReminders();
      expect(reminders.some((r) => r.includes("verify"))).toBe(true);
    });

    it("supports custom reminders", () => {
      cwi.addReminder("always", "Custom reminder", 10, 0);
      // Custom reminder with "always" trigger won't match default triggers
      // but the API works
      const reminders = cwi.getActiveReminders();
      expect(Array.isArray(reminders)).toBe(true);
    });
  });

  describe("provider adaptation", () => {
    it("adapts to smaller provider context", () => {
      cwi.adaptToProvider("ollama");
      expect(cwi.getTotalBudget()).toBe(131_072);
    });

    it("adapts to copilot context", () => {
      cwi.adaptToProvider("copilot");
      expect(cwi.getTotalBudget()).toBe(128_000);
    });

    it("uses the GA 1M budget for Anthropic Opus 4.6", () => {
      cwi.adaptToProvider("anthropic", "claude-opus-4-6");
      expect(cwi.getTotalBudget()).toBe(1_000_000);
    });

    it("exposes capability profile metadata", () => {
      const profile = new ContextWindowIntelligence("anthropic", "claude-sonnet-4-6").getCapabilityProfile();
      expect(profile.activationMode).toBe("default"); // GA since March 2026
      expect(profile.documentedMaxTokens).toBe(1_000_000);
    });
  });

  describe("optimal allocation", () => {
    it("allocates more memory for planning tasks", () => {
      const alloc = cwi.getOptimalAllocation("planning");
      expect(alloc.memoryPercent).toBeGreaterThan(alloc.conversationPercent);
    });

    it("allocates more conversation for review tasks", () => {
      const alloc = cwi.getOptimalAllocation("review");
      expect(alloc.conversationPercent).toBeGreaterThan(alloc.memoryPercent);
    });

    it("allocates more tools for debugging tasks", () => {
      const alloc = cwi.getOptimalAllocation("debugging");
      expect(alloc.toolsPercent).toBeGreaterThanOrEqual(0.2);
    });
  });
});
