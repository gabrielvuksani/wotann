import { describe, it, expect } from "vitest";
import { ModelRouter } from "../../src/providers/model-router.js";
import { getTierModel } from "../_helpers/model-tier.js";

describe("ModelRouter", () => {
  const makeRouter = (providers: string[] = ["anthropic", "openai", "ollama"]) =>
    new ModelRouter({
      availableProviders: new Set(providers) as ReadonlySet<any>,
      ollamaModels: providers.includes("ollama") ? ["qwen3-coder-next", "nemotron-cascade-2", "llama3.3"] : [],
    });

  describe("route", () => {
    it("routes utility tasks to Ollama when available", () => {
      const router = makeRouter();
      const decision = router.route({
        category: "utility",
        requiresComputerUse: false,
        requiresVision: false,
        estimatedTokens: 100,
        priority: "balanced",
      });

      expect(decision.provider).toBe("ollama");
      expect(decision.tier).toBe(1);
      expect(decision.cost).toBe(0);
    });

    it("routes computer use to Anthropic", () => {
      const router = makeRouter();
      const decision = router.route({
        category: "code",
        requiresComputerUse: true,
        requiresVision: false,
        estimatedTokens: 1000,
        priority: "balanced",
      });

      expect(decision.provider).toBe("anthropic");
      expect(decision.model).toBe("claude-sonnet-4-7");
    });

    it("routes planning to deep frontier", () => {
      const router = makeRouter();
      const decision = router.route({
        category: "plan",
        requiresComputerUse: false,
        requiresVision: false,
        estimatedTokens: 5000,
        priority: "quality",
      });

      expect(decision.tier).toBe(3);
      expect(decision.model).toContain("opus");
    });

    it("routes code tasks to fast frontier", () => {
      const router = makeRouter();
      const decision = router.route({
        category: "code",
        requiresComputerUse: false,
        requiresVision: false,
        estimatedTokens: 500,
        priority: "latency",
      });

      expect(decision.tier).toBeLessThanOrEqual(2);
    });

    it("falls back when preferred provider not available", () => {
      const router = makeRouter(["ollama"]);
      const decision = router.route({
        category: "plan",
        requiresComputerUse: false,
        requiresVision: false,
        estimatedTokens: 5000,
        priority: "quality",
      });

      // Should still return something
      expect(decision.provider).toBeDefined();
    });
  });

  describe("health scoring", () => {
    it("records successful requests", () => {
      const router = makeRouter();
      router.recordResult("anthropic", true, 500);

      const score = router.getHealthScore("anthropic");
      expect(score).toBeDefined();
      expect(score!.healthy).toBe(true);
      expect(score!.requestCount).toBe(1);
      expect(score!.errorRate).toBe(0);
    });

    it("tracks error rate", () => {
      const router = makeRouter();
      router.recordResult("anthropic", false, 1000);
      router.recordResult("anthropic", false, 1000);
      router.recordResult("anthropic", true, 500);

      const score = router.getHealthScore("anthropic");
      expect(score!.errorRate).toBeCloseTo(2 / 3, 1);
    });

    it("marks provider unhealthy at high error rate", () => {
      const router = makeRouter();
      // 3 consecutive failures
      router.recordResult("anthropic", false, 1000);
      router.recordResult("anthropic", false, 1000);
      router.recordResult("anthropic", false, 1000);

      const score = router.getHealthScore("anthropic");
      expect(score!.healthy).toBe(false);
    });

    it("uses exponential moving average for latency", () => {
      const router = makeRouter();
      router.recordResult("anthropic", true, 1000);
      router.recordResult("anthropic", true, 500);

      const score = router.getHealthScore("anthropic");
      // EMA: 0.3 * 500 + 0.7 * 1000 = 850
      expect(score!.avgLatencyMs).toBeCloseTo(850, 0);
    });
  });

  describe("recommendForGoal", () => {
    it("recommends based on latency goal", () => {
      const router = makeRouter();
      router.recordResult("anthropic", true, 1000);
      router.recordResult("ollama", true, 200);

      const rec = router.recommendForGoal("latency");
      expect(rec).not.toBeNull();
      expect(rec!.provider).toBe("ollama");
    });

    it("returns null when no healthy providers", () => {
      const router = makeRouter([]);
      const rec = router.recommendForGoal("balanced");
      expect(rec).toBeNull();
    });
  });

  describe("repo-aware routing", () => {
    it("prefers a model with better local repo history when candidates are close", () => {
      // Wave DH-3: Pre-load the OpenAI candidate that the router actually
      // emits for code/latency. The router pulls
      // `OPENAI_DEFAULTS.workerModel` from PROVIDER_DEFAULTS, so the repo
      // record key MUST match that exact id — V14.1 stripped the stale
      // `gpt-5.3-codex` worker default and bumped to `gpt-5`. Reading
      // PROVIDER_DEFAULTS via getTierModel keeps the test in lock-step
      // with the single source of truth (no second hardcode site).
      const openaiWorker = getTierModel("fast", { env: { ...process.env, WOTANN_TEST_PROVIDER: "openai" } }).model;

      const router = makeRouter(["anthropic", "openai"]);
      router.hydrateRepoPerformance([
        {
          provider: "openai",
          model: openaiWorker,
          successes: 8,
          failures: 0,
          avgLatencyMs: 350,
          avgCostUsd: 0.02,
          totalTokens: 12_000,
          lastUsedAt: new Date().toISOString(),
        },
      ]);

      const decision = router.route({
        category: "code",
        requiresComputerUse: false,
        requiresVision: false,
        estimatedTokens: 1200,
        priority: "latency",
      });

      expect(decision.provider).toBe("openai");
      expect(decision.model).toBe(openaiWorker);
    });
  });

  describe("classifyIntent", () => {
    it("classifies utility tasks (format, convert, count)", () => {
      const router = makeRouter();
      expect(router.classifyIntent("format this JSON").category).toBe("utility");
      expect(router.classifyIntent("convert to base64").category).toBe("utility");
      expect(router.classifyIntent("count the lines").category).toBe("utility");
    });

    it("classifies planning tasks", () => {
      const router = makeRouter();
      expect(router.classifyIntent("plan the authentication system").category).toBe("plan");
      expect(router.classifyIntent("architect a microservices solution").category).toBe("plan");
      expect(router.classifyIntent("design the database schema").category).toBe("plan");
    });

    it("classifies review tasks", () => {
      const router = makeRouter();
      expect(router.classifyIntent("review this pull request").category).toBe("review");
      expect(router.classifyIntent("audit the security of this code").category).toBe("review");
    });

    it("classifies computer use tasks", () => {
      const router = makeRouter();
      const result = router.classifyIntent("take a screenshot of the page");
      expect(result.requiresComputerUse).toBe(true);
      expect(result.requiresVision).toBe(true);
    });

    it("defaults to code for general prompts", () => {
      const router = makeRouter();
      expect(router.classifyIntent("fix the login bug").category).toBe("code");
      expect(router.classifyIntent("add error handling to the API").category).toBe("code");
    });

    it("estimates token count from prompt length", () => {
      const router = makeRouter();
      const result = router.classifyIntent("a".repeat(400));
      expect(result.estimatedTokens).toBe(100); // 400 chars / 4
    });
  });

  describe("cost enforcement", () => {
    it("starts with infinite budget", () => {
      const router = makeRouter();
      expect(router.isBudgetExceeded()).toBe(false);
    });

    it("enforces budget when exceeded", () => {
      const router = makeRouter();
      router.setCostBudget(1.00);
      router.recordCost(1.50);
      expect(router.isBudgetExceeded()).toBe(true);
    });

    it("routes to free providers when budget exceeded", () => {
      const router = makeRouter(["anthropic", "ollama"]);
      router.setCostBudget(0.01);
      router.recordCost(0.02);

      const decision = router.route({
        category: "code",
        requiresComputerUse: false,
        requiresVision: false,
        estimatedTokens: 1000,
        priority: "balanced",
      });

      expect(decision.provider).toBe("ollama");
    });

    it("reports cost status correctly", () => {
      const router = makeRouter();
      router.setCostBudget(5.00);
      router.recordCost(2.50);

      const status = router.getCostStatus();
      expect(status.spent).toBe(2.50);
      expect(status.budget).toBe(5.00);
      expect(status.remaining).toBe(2.50);
      expect(status.exceeded).toBe(false);
    });
  });

  describe("budget downgrade wiring", () => {
    const opus = { id: "claude-opus-4-7", tier: "frontier" as const, avgCostPer1kTokens: 0.015 };
    const sonnet = { id: "claude-sonnet-4-7", tier: "fast" as const, avgCostPer1kTokens: 0.003 };
    const haiku = { id: "claude-haiku-4-5", tier: "small" as const, avgCostPer1kTokens: 0.0008 };
    const free = { id: "llama-free", tier: "free" as const, avgCostPer1kTokens: 0 };

    it("no downgrade below 50% budget", () => {
      const router = makeRouter();
      router.setCostBudget(10);
      router.recordCost(2);
      router.registerDowngradeAlternatives([opus, sonnet, haiku, free]);

      const decision = router.downgradeIfNeeded({ preferred: opus });
      expect(decision.downgradeSteps).toBe(0);
      expect(decision.model.id).toBe("claude-opus-4-7");
    });

    it("downgrades one tier at 50-75% spend", () => {
      const router = makeRouter();
      router.setCostBudget(10);
      router.recordCost(5);
      router.registerDowngradeAlternatives([opus, sonnet, haiku, free]);

      const decision = router.downgradeIfNeeded({ preferred: opus });
      expect(decision.model.id).toBe("claude-sonnet-4-7");
      expect(decision.downgradeSteps).toBe(1);
    });

    it("downgrades two tiers at 75-90% spend", () => {
      const router = makeRouter();
      router.setCostBudget(10);
      router.recordCost(7.5);
      router.registerDowngradeAlternatives([opus, sonnet, haiku, free]);

      const decision = router.downgradeIfNeeded({ preferred: opus });
      expect(decision.model.id).toBe("claude-haiku-4-5");
      expect(decision.downgradeSteps).toBe(2);
    });

    it("locks to free at 90%+ spend", () => {
      const router = makeRouter();
      router.setCostBudget(10);
      router.recordCost(9.5);
      router.registerDowngradeAlternatives([opus, sonnet, haiku, free]);

      const decision = router.downgradeIfNeeded({ preferred: opus });
      expect(decision.model.id).toBe("llama-free");
    });

    it("applyBudgetDowngrade mutates RoutingDecision when needed", () => {
      const router = makeRouter();
      router.setCostBudget(10);
      router.recordCost(5);
      router.registerDowngradeAlternatives([opus, sonnet, haiku, free]);

      const original = {
        tier: 3 as const,
        provider: "anthropic" as const,
        model: "claude-opus-4-7",
        cost: 0.015,
      };
      const adjusted = router.applyBudgetDowngrade(original);
      expect(adjusted.model).toBe("claude-sonnet-4-7");
      expect(adjusted.cost).toBe(0.003);
    });

    it("applyBudgetDowngrade passes decision through when not registered", () => {
      const router = makeRouter();
      router.setCostBudget(10);
      router.recordCost(8);
      const original = {
        tier: 3 as const,
        provider: "anthropic" as const,
        model: "some-unregistered-model",
        cost: 0.01,
      };
      const adjusted = router.applyBudgetDowngrade(original);
      expect(adjusted).toEqual(original);
    });

    it("registerDowngradeAlternative stores a single model", () => {
      const router = makeRouter();
      router.registerDowngradeAlternative(opus);
      const alts = router.getDowngradeAlternatives();
      expect(alts).toHaveLength(1);
      expect(alts[0]?.id).toBe("claude-opus-4-7");
    });
  });
});
