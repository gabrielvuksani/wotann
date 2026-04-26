/**
 * Provider Arbitrage Engine — real-time cost optimization across providers.
 *
 * Finds the cheapest provider that meets minimum capability requirements,
 * tracks cost-per-quality over time, and produces cost comparison reports.
 */

import type { ProviderName } from "../core/types.js";

// ── Types ─────────────────────────────────────────────────

export interface ArbitrageRoute {
  readonly provider: ProviderName;
  readonly model: string;
  readonly estimatedCostPer1kTokens: number;
  readonly qualityScore: number;
  readonly latencyMs: number;
  readonly reason: string;
}

export interface CostArbitrageReport {
  readonly totalSpent: number;
  readonly totalSaved: number;
  readonly routeCount: number;
  readonly providerBreakdown: readonly ProviderCostSummary[];
  readonly bestValueProvider: ProviderName | null;
  readonly generatedAt: string;
}

export interface ProviderCostSummary {
  readonly provider: ProviderName;
  readonly totalCost: number;
  readonly avgQuality: number;
  readonly requestCount: number;
  readonly avgCostPer1kTokens: number;
}

interface OutcomeRecord {
  readonly provider: ProviderName;
  readonly model: string;
  readonly cost: number;
  readonly quality: number;
  readonly timestamp: number;
}

interface ProviderCapability {
  readonly provider: ProviderName;
  readonly model: string;
  readonly costPer1kInput: number;
  readonly costPer1kOutput: number;
  readonly capabilityTier: "low" | "medium" | "high" | "extreme";
  readonly avgLatencyMs: number;
}

// ── Cost table ────────────────────────────────────────────

const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  {
    provider: "anthropic",
    model: "claude-opus-4-7",
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    capabilityTier: "extreme",
    avgLatencyMs: 3000,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-7",
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    capabilityTier: "high",
    avgLatencyMs: 1500,
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    costPer1kInput: 0.001,
    costPer1kOutput: 0.005,
    capabilityTier: "medium",
    avgLatencyMs: 500,
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    costPer1kInput: 0.01,
    costPer1kOutput: 0.03,
    capabilityTier: "extreme",
    avgLatencyMs: 2500,
  },
  {
    provider: "openai",
    model: "gpt-5.3-codex",
    costPer1kInput: 0.003,
    costPer1kOutput: 0.012,
    capabilityTier: "high",
    avgLatencyMs: 1200,
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    costPer1kInput: 0.002,
    costPer1kOutput: 0.008,
    capabilityTier: "medium",
    avgLatencyMs: 800,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    costPer1kInput: 0.007,
    costPer1kOutput: 0.021,
    capabilityTier: "high",
    avgLatencyMs: 2000,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    costPer1kInput: 0.0005,
    costPer1kOutput: 0.002,
    capabilityTier: "medium",
    avgLatencyMs: 400,
  },
  {
    provider: "ollama",
    model: "llama-3.3-70b",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    capabilityTier: "medium",
    avgLatencyMs: 5000,
  },
  {
    provider: "free",
    model: "free-tier",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    capabilityTier: "low",
    avgLatencyMs: 8000,
  },
];

const CAPABILITY_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  extreme: 3,
};

// ── Engine ────────────────────────────────────────────────

export class ProviderArbitrageEngine {
  private readonly outcomes: OutcomeRecord[] = [];

  /**
   * Find the cheapest provider/model route that meets minimum capability.
   */
  findCheapestRoute(task: string, minCapability: string): ArbitrageRoute {
    const minTier = CAPABILITY_ORDER[minCapability] ?? 0;

    const eligible = PROVIDER_CAPABILITIES.filter(
      (p) => (CAPABILITY_ORDER[p.capabilityTier] ?? 0) >= minTier,
    );

    if (eligible.length === 0) {
      return {
        provider: "anthropic",
        model: "claude-sonnet-4-7",
        estimatedCostPer1kTokens: 0.009,
        qualityScore: 0.85,
        latencyMs: 1500,
        reason: "No eligible providers found; defaulting to Sonnet",
      };
    }

    // Sort by combined cost (input + output averaged)
    const sorted = [...eligible].sort((a, b) => {
      const costA = a.costPer1kInput + a.costPer1kOutput;
      const costB = b.costPer1kInput + b.costPer1kOutput;
      return costA - costB;
    });

    const best = sorted[0]!;
    const avgCost = (best.costPer1kInput + best.costPer1kOutput) / 2;

    // Check historical quality for this provider
    const historicalQuality = this.getHistoricalQuality(best.provider, best.model);

    return {
      provider: best.provider,
      model: best.model,
      estimatedCostPer1kTokens: avgCost,
      qualityScore: historicalQuality,
      latencyMs: best.avgLatencyMs,
      reason: `Cheapest ${minCapability}+ tier: ${best.provider}/${best.model} at $${avgCost.toFixed(4)}/1k tokens`,
    };
  }

  /**
   * Record an outcome for cost-per-quality tracking.
   */
  recordOutcome(provider: ProviderName, model: string, cost: number, quality: number): void {
    this.outcomes.push({
      provider,
      model,
      cost,
      quality: Math.max(0, Math.min(1, quality)),
      timestamp: Date.now(),
    });
  }

  /**
   * Produce a cost arbitrage report.
   */
  getCostReport(): CostArbitrageReport {
    if (this.outcomes.length === 0) {
      return {
        totalSpent: 0,
        totalSaved: 0,
        routeCount: 0,
        providerBreakdown: [],
        bestValueProvider: null,
        generatedAt: new Date().toISOString(),
      };
    }

    const byProvider = new Map<ProviderName, OutcomeRecord[]>();
    for (const outcome of this.outcomes) {
      const existing = byProvider.get(outcome.provider) ?? [];
      byProvider.set(outcome.provider, [...existing, outcome]);
    }

    const breakdown: ProviderCostSummary[] = [];
    for (const [provider, records] of byProvider) {
      const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
      const avgQuality = records.reduce((sum, r) => sum + r.quality, 0) / records.length;
      breakdown.push({
        provider,
        totalCost,
        avgQuality,
        requestCount: records.length,
        avgCostPer1kTokens: totalCost / records.length,
      });
    }

    const totalSpent = breakdown.reduce((sum, b) => sum + b.totalCost, 0);

    // Best value = highest quality/cost ratio
    const bestValue =
      breakdown.length > 0
        ? ([...breakdown].sort((a, b) => {
            const ratioA = a.totalCost > 0 ? a.avgQuality / a.totalCost : a.avgQuality;
            const ratioB = b.totalCost > 0 ? b.avgQuality / b.totalCost : b.avgQuality;
            return ratioB - ratioA;
          })[0]?.provider ?? null)
        : null;

    // Estimate savings vs always using the most expensive option
    const maxCostPerRequest = Math.max(...this.outcomes.map((o) => o.cost), 0);
    const totalSaved = maxCostPerRequest * this.outcomes.length - totalSpent;

    return {
      totalSpent,
      totalSaved: Math.max(0, totalSaved),
      routeCount: this.outcomes.length,
      providerBreakdown: breakdown,
      bestValueProvider: bestValue,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get historical average quality for a provider/model combo.
   */
  private getHistoricalQuality(provider: ProviderName, model: string): number {
    const relevant = this.outcomes.filter((o) => o.provider === provider && o.model === model);

    if (relevant.length === 0) return 0.7; // Default assumption

    return relevant.reduce((sum, r) => sum + r.quality, 0) / relevant.length;
  }
}
