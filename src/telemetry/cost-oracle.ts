/**
 * Cost Oracle — predict costs before execution.
 *
 * Estimates task costs based on token predictions and provider pricing.
 * Compares costs across all available providers.
 */

import type { ProviderName } from "../core/types.js";
import { PROVIDER_DEFAULTS, getProviderDefaults } from "../providers/model-defaults.js";

// ── Types ─────────────────────────────────────────────────

export interface CostEstimate {
  readonly provider: ProviderName;
  readonly model: string;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedCostUsd: number;
  readonly confidencePercent: number;
  readonly breakdown: CostBreakdown;
}

export interface CostBreakdown {
  readonly inputCost: number;
  readonly outputCost: number;
  readonly thinkingCost: number;
  readonly totalCost: number;
}

export interface ProviderCostComparison {
  readonly provider: ProviderName;
  readonly model: string;
  readonly estimatedCostUsd: number;
  readonly relativeCost: number;
  readonly isCheapest: boolean;
}

// ── Pricing ───────────────────────────────────────────────

interface ModelPricing {
  readonly provider: ProviderName;
  readonly model: string;
  readonly inputPer1k: number;
  readonly outputPer1k: number;
  readonly thinkingPer1k: number;
}

const PRICING_TABLE: readonly ModelPricing[] = [
  {
    provider: "anthropic",
    model: "claude-opus-4-7",
    inputPer1k: 0.015,
    outputPer1k: 0.075,
    thinkingPer1k: 0.015,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-7",
    inputPer1k: 0.003,
    outputPer1k: 0.015,
    thinkingPer1k: 0.003,
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    inputPer1k: 0.001,
    outputPer1k: 0.005,
    thinkingPer1k: 0.001,
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    inputPer1k: 0.01,
    outputPer1k: 0.03,
    thinkingPer1k: 0.01,
  },
  {
    provider: "openai",
    model: "gpt-5.3-codex",
    inputPer1k: 0.003,
    outputPer1k: 0.012,
    thinkingPer1k: 0.003,
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    inputPer1k: 0.002,
    outputPer1k: 0.008,
    thinkingPer1k: 0.002,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    inputPer1k: 0.007,
    outputPer1k: 0.021,
    thinkingPer1k: 0.007,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    inputPer1k: 0.0005,
    outputPer1k: 0.002,
    thinkingPer1k: 0.0005,
  },
  { provider: "ollama", model: "llama-3.3-70b", inputPer1k: 0, outputPer1k: 0, thinkingPer1k: 0 },
  // Free-tier escape hatch via OpenRouter's :free model variants —
  // replaces the prior "free" umbrella that aliased to Groq/Cerebras.
  {
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    inputPer1k: 0,
    outputPer1k: 0,
    thinkingPer1k: 0,
  },
];

// ── Task complexity heuristics ────────────────────────────

interface TaskProfile {
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedThinkingTokens: number;
  readonly confidence: number;
}

function profileTask(task: string): TaskProfile {
  const lower = task.toLowerCase();
  const wordCount = task.split(/\s+/).length;

  // Simple tasks: typos, renames, single-line fixes
  if (/\b(typo|rename|format|single[\s-]line|quick[\s-]fix)\b/.test(lower) || wordCount < 10) {
    return {
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 500,
      estimatedThinkingTokens: 1000,
      confidence: 80,
    };
  }

  // Medium tasks: bug fixes, small features
  if (/\b(fix|bug|update|add[\s-]field|modify)\b/.test(lower) || wordCount < 30) {
    return {
      estimatedInputTokens: 8000,
      estimatedOutputTokens: 3000,
      estimatedThinkingTokens: 4000,
      confidence: 60,
    };
  }

  // Large tasks: features, refactors
  if (/\b(feature|implement|refactor|integrate)\b/.test(lower) || wordCount < 80) {
    return {
      estimatedInputTokens: 30000,
      estimatedOutputTokens: 15000,
      estimatedThinkingTokens: 16000,
      confidence: 40,
    };
  }

  // Extreme tasks: architecture, migrations
  return {
    estimatedInputTokens: 80000,
    estimatedOutputTokens: 40000,
    estimatedThinkingTokens: 32000,
    confidence: 25,
  };
}

// ── Oracle ────────────────────────────────────────────────

export class CostOracle {
  /**
   * Estimate cost of a task for a specific provider/model.
   */
  estimateTaskCost(task: string, provider: ProviderName, model: string): CostEstimate {
    const profile = profileTask(task);
    const pricing = PRICING_TABLE.find((p) => p.provider === provider && p.model === model);

    if (!pricing) {
      return {
        provider,
        model,
        estimatedInputTokens: profile.estimatedInputTokens,
        estimatedOutputTokens: profile.estimatedOutputTokens,
        estimatedCostUsd: 0,
        confidencePercent: 0,
        breakdown: {
          inputCost: 0,
          outputCost: 0,
          thinkingCost: 0,
          totalCost: 0,
        },
      };
    }

    const inputCost = (profile.estimatedInputTokens / 1000) * pricing.inputPer1k;
    const outputCost = (profile.estimatedOutputTokens / 1000) * pricing.outputPer1k;
    const thinkingCost = (profile.estimatedThinkingTokens / 1000) * pricing.thinkingPer1k;
    const totalCost = inputCost + outputCost + thinkingCost;

    return {
      provider,
      model,
      estimatedInputTokens: profile.estimatedInputTokens,
      estimatedOutputTokens: profile.estimatedOutputTokens,
      estimatedCostUsd: totalCost,
      confidencePercent: profile.confidence,
      breakdown: {
        inputCost,
        outputCost,
        thinkingCost,
        totalCost,
      },
    };
  }

  /**
   * Estimate cost of an autonomous run (multiple turns).
   *
   * V9 DEHARDCODE: defaults to the active provider's `defaultModel`
   * (cheap-but-capable tier per PROVIDER_DEFAULTS) instead of forcing
   * Anthropic Sonnet on every caller. Pass `provider`/`model` to pin
   * the estimate to a specific pair; omitting them lets the resolver
   * pick using the provider hint or the canonical first-provider order.
   */
  estimateAutonomousCost(
    task: string,
    maxCycles: number,
    options?: { provider?: ProviderName; model?: string },
  ): CostEstimate {
    // Autonomous runs use the active provider's default (worker-tier)
    // model. When no hint is supplied we walk the canonical order in
    // PROVIDER_DEFAULTS — the first entry is the system's preferred
    // provider, NOT a hardcoded vendor pick.
    const resolvedProvider: ProviderName =
      options?.provider ?? ((Object.keys(PROVIDER_DEFAULTS)[0] ?? "ollama") as ProviderName);
    const defaults = getProviderDefaults(resolvedProvider);
    const resolvedModel = options?.model ?? defaults.defaultModel;

    const singleEstimate = this.estimateTaskCost(task, resolvedProvider, resolvedModel);

    // Each cycle roughly doubles context (previous turns become input)
    // Use a growth factor of 1.3x per cycle (input accumulates)
    let totalInput = 0;
    let totalOutput = 0;
    let totalThinking = 0;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      const scale = Math.pow(1.3, cycle);
      totalInput += singleEstimate.estimatedInputTokens * scale;
      totalOutput += singleEstimate.estimatedOutputTokens;
      totalThinking +=
        singleEstimate.breakdown.thinkingCost > 0 ? singleEstimate.estimatedOutputTokens * 0.5 : 0;
    }

    const pricing = PRICING_TABLE.find(
      (p) => p.provider === resolvedProvider && p.model === resolvedModel,
    );

    const inputCost = pricing ? (totalInput / 1000) * pricing.inputPer1k : 0;
    const outputCost = pricing ? (totalOutput / 1000) * pricing.outputPer1k : 0;
    const thinkingCost = pricing ? (totalThinking / 1000) * pricing.thinkingPer1k : 0;

    return {
      provider: resolvedProvider,
      model: resolvedModel,
      estimatedInputTokens: Math.round(totalInput),
      estimatedOutputTokens: Math.round(totalOutput),
      estimatedCostUsd: inputCost + outputCost + thinkingCost,
      confidencePercent: Math.max(10, singleEstimate.confidencePercent - maxCycles * 5),
      breakdown: {
        inputCost,
        outputCost,
        thinkingCost,
        totalCost: inputCost + outputCost + thinkingCost,
      },
    };
  }

  /**
   * Compare costs across all known providers.
   */
  compareCosts(task: string): readonly ProviderCostComparison[] {
    const estimates = PRICING_TABLE.map((p) => this.estimateTaskCost(task, p.provider, p.model));

    const minCost = Math.min(...estimates.map((e) => e.estimatedCostUsd));

    return estimates.map((e) => ({
      provider: e.provider,
      model: e.model,
      estimatedCostUsd: e.estimatedCostUsd,
      relativeCost: minCost > 0 ? e.estimatedCostUsd / minCost : e.estimatedCostUsd === 0 ? 0 : 1,
      isCheapest: e.estimatedCostUsd === minCost,
    }));
  }
}
