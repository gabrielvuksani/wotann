/**
 * Provider Brain — unified provider intelligence.
 * Merges: Cost Oracle + Provider Arbitrage + Model Router + Fallback Chain + Rate Limiter.
 * Single decision point for: which provider, which model, at what cost, with what fallback.
 */

import type { ProviderName } from "../core/types.js";

// ── Types ────────────────────────────────────────────────

export interface RoutingDecision {
  readonly provider: ProviderName;
  readonly model: string;
  readonly estimatedCost: number;
  readonly estimatedLatencyMs: number;
  readonly reason: string;
  readonly alternatives: readonly AlternativeRoute[];
  readonly fallbackChain: readonly ProviderName[];
}

export interface AlternativeRoute {
  readonly provider: ProviderName;
  readonly model: string;
  readonly estimatedCost: number;
  readonly estimatedLatencyMs: number;
  readonly tradeoff: string; // "50% cheaper but 2x slower"
}

export interface TaskClassification {
  readonly type: "reasoning" | "code-gen" | "research" | "classification" | "creative" | "general";
  readonly complexity: "simple" | "moderate" | "complex";
  readonly estimatedTokens: number;
}

export interface ProviderHealth {
  readonly provider: ProviderName;
  readonly available: boolean;
  readonly rateLimited: boolean;
  readonly rateLimitResetsAt?: number;
  readonly recentLatencyMs: number;
  readonly recentErrorRate: number;
  readonly dailyCost: number;
}

export interface BudgetConstraints {
  readonly dailyBudget: number;
  readonly dailySpent: number;
  readonly perQueryMax: number;
  readonly preferCheaper: boolean;
}

// ── Provider Brain ───────────────────────────────────────

export class ProviderBrain {
  private readonly healthMap: Map<ProviderName, ProviderHealth> = new Map();
  private budget: BudgetConstraints = {
    dailyBudget: 10,
    dailySpent: 0,
    perQueryMax: 1,
    preferCheaper: false,
  };

  /**
   * Make a routing decision for a given task.
   */
  route(
    prompt: string,
    availableProviders: readonly ProviderName[],
    constraints?: Partial<BudgetConstraints>,
  ): RoutingDecision {
    if (constraints) {
      this.budget = { ...this.budget, ...constraints };
    }

    const task = this.classifyTask(prompt);
    const candidates = this.rankProviders(task, availableProviders);

    if (candidates.length === 0) {
      // No available providers. Returning a fake "anthropic" decision
      // here would silently pin every cold-start request to Anthropic
      // even when the user has none configured (the v9 META-AUDIT
      // flagged this as a hidden vendor pin). Surface the real state
      // so the caller can prompt the user to authenticate or enable a
      // provider rather than firing a phantom request.
      throw new Error(
        "ProviderBrain.route: no available providers — caller must prompt the user to configure one",
      );
    }

    const best = candidates[0]!;
    const alternatives = candidates.slice(1, 4).map((c) => ({
      provider: c.provider,
      model: c.model,
      estimatedCost: c.cost,
      estimatedLatencyMs: c.latency,
      tradeoff: this.describeTradeoff(best, c),
    }));

    return {
      provider: best.provider,
      model: best.model,
      estimatedCost: best.cost,
      estimatedLatencyMs: best.latency,
      reason: best.reason,
      alternatives,
      fallbackChain: candidates.slice(1).map((c) => c.provider),
    };
  }

  /**
   * Update provider health after a request.
   */
  updateHealth(provider: ProviderName, latencyMs: number, success: boolean, cost: number): void {
    const existing = this.healthMap.get(provider) ?? {
      provider,
      available: true,
      rateLimited: false,
      recentLatencyMs: 1000,
      recentErrorRate: 0,
      dailyCost: 0,
    };

    // Exponential moving average for latency
    const alpha = 0.3;
    const newLatency = alpha * latencyMs + (1 - alpha) * existing.recentLatencyMs;
    const newErrorRate = alpha * (success ? 0 : 1) + (1 - alpha) * existing.recentErrorRate;

    this.healthMap.set(provider, {
      ...existing,
      recentLatencyMs: newLatency,
      recentErrorRate: newErrorRate,
      dailyCost: existing.dailyCost + cost,
    });

    this.budget = { ...this.budget, dailySpent: this.budget.dailySpent + cost };
  }

  /**
   * Mark a provider as rate-limited.
   */
  markRateLimited(provider: ProviderName, resetsAt: number): void {
    const existing = this.healthMap.get(provider);
    if (existing) {
      this.healthMap.set(provider, { ...existing, rateLimited: true, rateLimitResetsAt: resetsAt });
    }
  }

  /**
   * Set budget constraints.
   */
  setBudget(budget: Partial<BudgetConstraints>): void {
    this.budget = { ...this.budget, ...budget };
  }

  /**
   * Get budget status.
   */
  getBudgetStatus(): { remaining: number; percentUsed: number; overBudget: boolean } {
    const remaining = this.budget.dailyBudget - this.budget.dailySpent;
    return {
      remaining,
      percentUsed: (this.budget.dailySpent / this.budget.dailyBudget) * 100,
      overBudget: remaining <= 0,
    };
  }

  /**
   * Get all provider health statuses.
   */
  getHealthReport(): readonly ProviderHealth[] {
    return [...this.healthMap.values()];
  }

  // ── Private ────────────────────────────────────────────

  private classifyTask(prompt: string): TaskClassification {
    const lower = prompt.toLowerCase();
    let type: TaskClassification["type"] = "general";
    let complexity: TaskClassification["complexity"] = "moderate";

    if (lower.includes("research") || lower.includes("find") || lower.includes("search"))
      type = "research";
    else if (
      lower.includes("write") ||
      lower.includes("implement") ||
      lower.includes("create") ||
      lower.includes("build")
    )
      type = "code-gen";
    else if (
      lower.includes("fix") ||
      lower.includes("debug") ||
      lower.includes("why") ||
      lower.includes("explain")
    )
      type = "reasoning";
    else if (lower.includes("classify") || lower.includes("categorize") || lower.includes("which"))
      type = "classification";
    else if (lower.includes("story") || lower.includes("creative") || lower.includes("imagine"))
      type = "creative";

    if (prompt.length < 50) complexity = "simple";
    else if (prompt.length > 500) complexity = "complex";

    return { type, complexity, estimatedTokens: Math.ceil(prompt.length / 4) * 3 };
  }

  private rankProviders(
    task: TaskClassification,
    available: readonly ProviderName[],
  ): { provider: ProviderName; model: string; cost: number; latency: number; reason: string }[] {
    // Task-type → provider preferences (BEST for each type, not cheapest)
    const preferences: Record<string, readonly ProviderName[]> = {
      reasoning: ["anthropic", "openai", "gemini"],
      "code-gen": ["anthropic", "openai", "gemini"],
      research: ["gemini", "openai", "anthropic"],
      classification: ["gemini", "openai", "anthropic"],
      creative: ["anthropic", "openai", "gemini"],
      general: ["anthropic", "openai", "gemini"],
    };

    const ordered = preferences[task.type] ?? preferences["general"]!;
    const results: {
      provider: ProviderName;
      model: string;
      cost: number;
      latency: number;
      reason: string;
    }[] = [];

    for (const provider of ordered) {
      if (!available.includes(provider)) continue;

      const health = this.healthMap.get(provider);
      if (health?.rateLimited) continue;
      if (health && health.recentErrorRate > 0.5) continue;

      const latency = health?.recentLatencyMs ?? 2000;
      const costPerToken = this.estimateCost(provider, task.estimatedTokens);

      results.push({
        provider,
        model: "auto",
        cost: costPerToken,
        latency,
        reason: `Best ${task.type} provider${health ? ` (${Math.round(latency)}ms avg)` : ""}`,
      });
    }

    // Add any remaining available providers
    for (const provider of available) {
      if (!results.some((r) => r.provider === provider)) {
        results.push({
          provider,
          model: "auto",
          cost: this.estimateCost(provider, task.estimatedTokens),
          latency: this.healthMap.get(provider)?.recentLatencyMs ?? 3000,
          reason: "Available fallback",
        });
      }
    }

    // Sort: budget-aware ranking
    if (this.budget.preferCheaper) {
      results.sort((a, b) => a.cost - b.cost);
    }

    return results;
  }

  private estimateCost(provider: ProviderName, tokens: number): number {
    const costPerMillion: Record<string, number> = {
      anthropic: 15,
      openai: 10,
      gemini: 7,
      ollama: 0,
      free: 0,
      azure: 12,
      bedrock: 15,
      vertex: 7,
      codex: 0,
      copilot: 0,
      huggingface: 1,
    };
    return ((costPerMillion[provider] ?? 10) * tokens) / 1_000_000;
  }

  private describeTradeoff(
    best: { cost: number; latency: number },
    alt: { provider: ProviderName; cost: number; latency: number },
  ): string {
    const costDiff = ((alt.cost - best.cost) / Math.max(best.cost, 0.0001)) * 100;
    const latencyDiff = ((alt.latency - best.latency) / Math.max(best.latency, 1)) * 100;

    if (costDiff < -20) return `${Math.abs(Math.round(costDiff))}% cheaper`;
    if (latencyDiff < -20) return `${Math.abs(Math.round(latencyDiff))}% faster`;
    return `${alt.provider} alternative`;
  }
}
