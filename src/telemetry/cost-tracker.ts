/**
 * Cost tracking: per-request, per-session, per-day.
 * Budget alerts and provider cost comparison.
 */

import type { ProviderName } from "../core/types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DailyCostStore } from "./daily-cost-store.js";

interface CostEntry {
  readonly timestamp: Date;
  readonly provider: ProviderName;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
}

interface SerializedCostEntry {
  readonly timestamp: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
}

interface SerializedCostState {
  readonly entries: readonly SerializedCostEntry[];
  readonly budgetUsd: number | null;
}

export interface CostPrediction {
  readonly provider: string;
  readonly model: string;
  readonly estimatedTokens: number;
  readonly estimatedCost: number;
  readonly recommendation: string;
}

// Approximate costs per 1K tokens (USD)
const COST_TABLE: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-6": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5": { input: 0.001, output: 0.005 },
  "gpt-5.4": { input: 0.010, output: 0.030 },
  "gpt-5.3-codex": { input: 0.003, output: 0.012 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
};

// Provider-to-model mapping for cost predictions
const PROVIDER_MODELS: Record<string, readonly string[]> = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  openai: ["gpt-5.4", "gpt-5.3-codex", "gpt-4.1"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  ollama: ["llama-3.3-70b"],
  free: ["free-tier"],
};

// Extended pricing aligned with CostOracle's PRICING_TABLE
const EXTENDED_COST_TABLE: Record<string, { input: number; output: number }> = {
  ...COST_TABLE,
  "gemini-2.5-pro": { input: 0.007, output: 0.021 },
  "gemini-2.5-flash": { input: 0.0005, output: 0.002 },
  "llama-3.3-70b": { input: 0, output: 0 },
  "free-tier": { input: 0, output: 0 },
};

export class CostTracker {
  private readonly entries: CostEntry[] = [];
  private readonly storagePath?: string;
  private readonly sessionStartIndex: number;
  private budgetUsd: number | null = null;
  private readonly dailyStore: DailyCostStore;

  constructor(storagePath?: string) {
    this.storagePath = storagePath;
    this.load();
    this.sessionStartIndex = this.entries.length;
    // DailyCostStore lives alongside the main cost file (e.g., .wotann/costs.json)
    const dailyPath = storagePath
      ? join(dirname(storagePath), "costs.json")
      : undefined;
    this.dailyStore = new DailyCostStore(dailyPath);
  }

  /**
   * Access the backing daily cost store for per-day aggregates.
   */
  getDailyStore(): DailyCostStore {
    return this.dailyStore;
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const rates = COST_TABLE[model];
    if (!rates) return 0;

    return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
  }

  record(provider: ProviderName, model: string, inputTokens: number, outputTokens: number): CostEntry {
    const cost = this.estimateCost(model, inputTokens, outputTokens);
    const entry: CostEntry = {
      timestamp: new Date(),
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
    };
    this.entries.push(entry);
    this.save();
    // Mirror into the per-day store so weekly/monthly aggregates stay accurate.
    if (cost > 0) {
      this.dailyStore.addCost(cost);
    }
    return entry;
  }

  setBudget(usd: number): void {
    this.budgetUsd = usd;
    this.save();
  }

  isOverBudget(): boolean {
    if (this.budgetUsd === null) return false;
    return this.getTotalCost() >= this.budgetUsd;
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  getSessionCost(): number {
    return this.entries
      .slice(this.sessionStartIndex)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  getTodayCost(): number {
    // Prefer the durable daily store when available (survives process restarts
    // because every record() call mirrors into it), falling back to in-memory.
    const fromStore = this.dailyStore.getToday();
    if (fromStore > 0) return fromStore;

    const today = new Date().toDateString();
    return this.entries
      .filter((e) => e.timestamp.toDateString() === today)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  /**
   * Cost accumulated across the last 7 days (including today).
   * Sourced from the per-day store so it reflects real history, not a multiplier.
   */
  getWeeklyCost(): number {
    return this.dailyStore.getWeekly();
  }

  /**
   * Cost accumulated across the last 30 days (including today).
   */
  getMonthlyCost(): number {
    return this.dailyStore.getMonthly();
  }

  getCostByProvider(): ReadonlyMap<ProviderName, number> {
    const result = new Map<ProviderName, number>();
    for (const entry of this.entries) {
      result.set(entry.provider, (result.get(entry.provider) ?? 0) + entry.cost);
    }
    return result;
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  getBudget(): number | null {
    return this.budgetUsd;
  }

  /**
   * Predict cost of a prompt across multiple providers before execution.
   *
   * Estimates token count from prompt character length (chars / 4 rough
   * approximation). For each requested provider, calculates estimated cost
   * using known per-token pricing and returns results sorted by cost
   * (cheapest first).
   *
   * No default budget limit -- the user sets limits in Settings if desired.
   */
  predictCost(prompt: string, providers: string[]): CostPrediction[] {
    // Rough token estimate: ~4 characters per token on average
    const estimatedTokens = Math.max(1, Math.ceil(prompt.length / 4));

    // Assume output tokens roughly equal input for a balanced prediction.
    // In practice output varies, but 1:1 is a reasonable default estimate.
    const estimatedOutputTokens = estimatedTokens;

    const predictions: CostPrediction[] = [];

    for (const provider of providers) {
      const models = PROVIDER_MODELS[provider];
      if (!models) {
        // Unknown provider -- include a zero-cost entry so the caller
        // knows it was considered but has no pricing data.
        predictions.push({
          provider,
          model: "unknown",
          estimatedTokens,
          estimatedCost: 0,
          recommendation: `No pricing data available for provider "${provider}"`,
        });
        continue;
      }

      for (const model of models) {
        const rates = EXTENDED_COST_TABLE[model];
        const inputCost = rates
          ? (estimatedTokens / 1000) * rates.input
          : 0;
        const outputCost = rates
          ? (estimatedOutputTokens / 1000) * rates.output
          : 0;
        const totalCost = inputCost + outputCost;

        predictions.push({
          provider,
          model,
          estimatedTokens,
          estimatedCost: totalCost,
          recommendation: "",
        });
      }
    }

    // Sort by estimated cost ascending (cheapest first)
    predictions.sort((a, b) => a.estimatedCost - b.estimatedCost);

    // Assign recommendations based on sorted position
    return predictions.map((prediction, index) => {
      let recommendation: string;
      if (prediction.estimatedCost === 0) {
        recommendation = prediction.model === "unknown"
          ? `No pricing data available for provider "${prediction.provider}"`
          : "Free tier -- no cost";
      } else if (index === 0) {
        recommendation = "Cheapest option";
      } else {
        const cheapest = predictions[0];
        if (cheapest && cheapest.estimatedCost > 0) {
          const multiplier = prediction.estimatedCost / cheapest.estimatedCost;
          recommendation = `${multiplier.toFixed(1)}x more expensive than ${cheapest.model}`;
        } else {
          recommendation = "Paid option";
        }
      }

      return { ...prediction, recommendation };
    });
  }

  private load(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;

    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const parsed = JSON.parse(raw) as SerializedCostState;
      this.entries.splice(
        0,
        this.entries.length,
        ...(parsed.entries ?? []).map((entry) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        })),
      );
      this.budgetUsd = parsed.budgetUsd ?? null;
    } catch {
      // Corrupt cost files should not break the runtime.
    }
  }

  private save(): void {
    if (!this.storagePath) return;

    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      const serialized: SerializedCostState = {
        entries: this.entries.map((entry) => ({
          ...entry,
          timestamp: entry.timestamp.toISOString(),
        })),
        budgetUsd: this.budgetUsd,
      };
      writeFileSync(this.storagePath, JSON.stringify(serialized, null, 2));
    } catch {
      // Best-effort persistence only.
    }
  }
}
