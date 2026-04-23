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
  /** Tokens read from prompt cache (counted toward input at a cheaper rate). */
  readonly cacheReadTokens?: number;
  /** Tokens written to prompt cache (usually 1.25x input rate). */
  readonly cacheWriteTokens?: number;
}

interface SerializedCostEntry {
  readonly timestamp: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

/**
 * Split usage breakdown sourced from a provider's final stream chunk.
 * Wave 4G: passes the usage through without conflation so the tracker
 * can record honest cache-hit and cache-write metrics separately from
 * the regular input/output token counters.
 */
export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
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

// Approximate costs per 1K tokens (USD). S2-32: expanded from 6 to 20+
// entries covering all 17 providers with April 2026 verified rates. The
// previous table silently fell through to $0 for anything not listed
// (xAI, DeepSeek, Mistral, Codex, Copilot, etc.) making every cost
// prediction zero for those providers.
const COST_TABLE: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-6": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-6": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5": { input: 0.0008, output: 0.004 },

  // OpenAI
  "gpt-5.4": { input: 0.0025, output: 0.01 },
  "gpt-5": { input: 0.00125, output: 0.01 },
  "gpt-5-mini": { input: 0.00025, output: 0.002 },
  "gpt-5.3-codex": { input: 0.003, output: 0.012 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },

  // Google Gemini
  "gemini-3.1-pro": { input: 0.002, output: 0.012 },
  "gemini-3.1-flash": { input: 0.00025, output: 0.0015 },
  "gemini-3.1-flash-lite": { input: 0.00015, output: 0.0006 },
  "gemini-2.5-pro": { input: 0.002, output: 0.012 },
  "gemini-2.5-flash": { input: 0.00015, output: 0.0006 },
  "gemini-2.0-flash": { input: 0.00015, output: 0.0006 },

  // DeepSeek
  "deepseek-v4": { input: 0.0003, output: 0.0005 },
  "deepseek-r1": { input: 0.00055, output: 0.00219 },
  "deepseek-chat": { input: 0.00027, output: 0.0011 },

  // xAI Grok
  "grok-4": { input: 0.003, output: 0.015 },
  "grok-4.1-fast": { input: 0.0002, output: 0.0005 },
  "grok-3": { input: 0.003, output: 0.015 },

  // Mistral
  "mistral-large-3": { input: 0.0005, output: 0.0015 },
  "mistral-nemo": { input: 0.00002, output: 0.00004 },
  codestral: { input: 0.0003, output: 0.0009 },

  // Groq (open-model hosting — extremely cheap). Paid-tier rates;
  // session-5 adds Groq free-tier $0/$0 pricing below, gated on
  // WOTANN_GROQ_FREE=1 so callers on the free plan aren't charged
  // fictional costs for models that are actually free at their usage
  // level (Groq offers a generous free tier with daily rate limits).
  "llama-3.3-70b-versatile": { input: 0.00059, output: 0.00079 },
  "llama-3.1-8b-instant": { input: 0.00005, output: 0.00008 },
  "llama-4-scout-17b-16e": { input: 0.0001, output: 0.0003 },

  // Codex (subscription billing handled upstream, keep 0 so we don't
  // double-count against a user who's already paying for ChatGPT)
  codexplan: { input: 0, output: 0 },
  codexspark: { input: 0, output: 0 },
  codexmini: { input: 0, output: 0 },

  // Local / free
  "llama-3.3-70b": { input: 0, output: 0 },
  "free-tier": { input: 0, output: 0 },
  gemma4: { input: 0, output: 0 },
  "gemma4:e4b": { input: 0, output: 0 },
  "gemma4:26b": { input: 0, output: 0 },

  // Perplexity (web-search LLM)
  sonar: { input: 0.001, output: 0.001 },
  "sonar-pro": { input: 0.003, output: 0.015 },

  // Together / Fireworks / HuggingFace (hosted open models — approximate)
  "meta-llama/Llama-3.3-70B-Instruct": { input: 0.0006, output: 0.0006 },
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": { input: 0.0006, output: 0.0006 },
  "accounts/fireworks/models/llama-v3p3-70b-instruct": { input: 0.0005, output: 0.0005 },
  "meta-llama/Meta-Llama-3.1-70B-Instruct": { input: 0.0008, output: 0.0008 },
  "meta-llama/Meta-Llama-3.1-8B-Instruct": { input: 0.0001, output: 0.0001 },

  // Qwen — open-source coder/general models. HuggingFace adapter
  // defaults include these but the prior cost table omitted them, so
  // every prediction zeroed out for Qwen users.
  "qwen2.5-coder:7b": { input: 0, output: 0 }, // local Ollama
  "qwen3-coder": { input: 0.0002, output: 0.0008 }, // hosted approximate
  "qwen3-coder-next": { input: 0.0002, output: 0.0008 },
  "qwen3.5": { input: 0.0003, output: 0.001 },
  "Qwen3-Coder-480B": { input: 0.0008, output: 0.0024 },

  // Gemini short-form alias — some callers use the version-less name.
  "gemini-3-pro": { input: 0.002, output: 0.012 }, // alias of gemini-3.1-pro
  "gemini-3-flash": { input: 0.00025, output: 0.0015 }, // alias of gemini-3.1-flash
};

// Provider-to-model mapping for cost predictions. Expanded in S2-32.
const PROVIDER_MODELS: Record<string, readonly string[]> = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "anthropic-cli": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  openai: ["gpt-5.4", "gpt-5", "gpt-5-mini", "gpt-4.1"],
  codex: ["codexplan", "codexspark", "codexmini"],
  copilot: ["gpt-4.1", "gpt-5", "claude-sonnet-4-6"],
  gemini: ["gemini-3.1-pro", "gemini-3.1-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
  vertex: ["gemini-3.1-pro", "gemini-3.1-flash"],
  deepseek: ["deepseek-v4", "deepseek-r1"],
  xai: ["grok-4", "grok-4.1-fast"],
  mistral: ["mistral-large-3", "mistral-nemo", "codestral"],
  free: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  ollama: ["gemma4:e4b", "gemma4:26b", "gemma4", "llama-3.3-70b"],
  perplexity: ["sonar", "sonar-pro"],
  together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  fireworks: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
  huggingface: ["meta-llama/Meta-Llama-3.1-70B-Instruct"],
};

// Extended pricing kept for downstream code that reads from it by name.
// Aliased to COST_TABLE now that the main table has full coverage.
const EXTENDED_COST_TABLE = COST_TABLE;

/**
 * Groq free-tier model identifiers. Users who opt in via
 * `WOTANN_GROQ_FREE=1` get $0 cost predictions for these models
 * instead of the paid-tier rates in COST_TABLE. Groq's free plan has
 * daily rate limits but no monetary charges, so the paid-rate number
 * is misleading for free-tier users.
 */
const GROQ_FREE_TIER_MODELS = new Set<string>([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama-4-scout-17b-16e",
]);

function isGroqFreeTierModel(model: string): boolean {
  return GROQ_FREE_TIER_MODELS.has(model);
}

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
    const dailyPath = storagePath ? join(dirname(storagePath), "costs.json") : undefined;
    this.dailyStore = new DailyCostStore(dailyPath);
  }

  /**
   * Access the backing daily cost store for per-day aggregates.
   */
  getDailyStore(): DailyCostStore {
    return this.dailyStore;
  }

  /**
   * Project the entries into the legacy `TokenStats` shape the removed
   * `TokenPersistence` class used to expose. Session-5 consolidated the
   * two surfaces onto CostTracker as the single authoritative source
   * (previously: one write-path for cost + a parallel write-only
   * `token-stats.json`). This projection is computed on demand from the
   * entries array so callers still have the cumulative per-provider /
   * per-model totals they had before, without the dual-writer + drift
   * risk the audit (GAP_AUDIT_2026-04-15 Tier 2) flagged.
   */
  getTokenStats(): {
    readonly totalInputTokens: number;
    readonly totalOutputTokens: number;
    readonly lastUpdated: number;
    readonly entryCount: number;
    readonly byProvider: Readonly<Record<string, { input: number; output: number }>>;
    readonly byModel: Readonly<Record<string, { input: number; output: number }>>;
  } {
    let totalInput = 0;
    let totalOutput = 0;
    let lastUpdated = 0;
    const byProvider: Record<string, { input: number; output: number }> = {};
    const byModel: Record<string, { input: number; output: number }> = {};
    for (const entry of this.entries) {
      totalInput += entry.inputTokens;
      totalOutput += entry.outputTokens;
      const ts = entry.timestamp.getTime();
      if (ts > lastUpdated) lastUpdated = ts;
      const prevProv = byProvider[entry.provider] ?? { input: 0, output: 0 };
      byProvider[entry.provider] = {
        input: prevProv.input + entry.inputTokens,
        output: prevProv.output + entry.outputTokens,
      };
      const prevModel = byModel[entry.model] ?? { input: 0, output: 0 };
      byModel[entry.model] = {
        input: prevModel.input + entry.inputTokens,
        output: prevModel.output + entry.outputTokens,
      };
    }
    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      lastUpdated,
      entryCount: this.entries.length,
      byProvider,
      byModel,
    };
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Session-5: Groq free-tier honors WOTANN_GROQ_FREE=1 across the
    // three Groq-hosted llama models. Groq's free plan has generous
    // daily rate limits (14,400 requests/day for llama-3.3-70b, etc.)
    // and users on it shouldn't see the paid-tier cost estimate since
    // they won't actually be billed. This is opt-in via env var so the
    // default remains safe (over-estimate rather than under-estimate).
    if (isGroqFreeTierModel(model) && process.env["WOTANN_GROQ_FREE"] === "1") {
      return 0;
    }
    const rates = COST_TABLE[model];
    if (!rates) return 0;

    return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
  }

  record(
    provider: ProviderName,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheTokens?: { cacheReadTokens?: number; cacheWriteTokens?: number },
  ): CostEntry {
    // Wave 4G quality bar: record every turn honestly. Zero-token records
    // are preserved as valid data points — an empty provider response
    // should not be a silent success, so downstream tools see the 0 and
    // can diagnose.
    const cost = this.estimateCost(model, inputTokens, outputTokens);
    const entry: CostEntry = {
      timestamp: new Date(),
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
      ...(cacheTokens?.cacheReadTokens && cacheTokens.cacheReadTokens > 0
        ? { cacheReadTokens: cacheTokens.cacheReadTokens }
        : {}),
      ...(cacheTokens?.cacheWriteTokens && cacheTokens.cacheWriteTokens > 0
        ? { cacheWriteTokens: cacheTokens.cacheWriteTokens }
        : {}),
    };
    this.entries.push(entry);
    this.save();
    // Mirror into the per-day store so weekly/monthly aggregates stay accurate.
    if (cost > 0) {
      this.dailyStore.addCost(cost);
    }
    return entry;
  }

  /**
   * Wave 4G: preferred entrypoint for the runtime. Accepts a structured
   * `TurnUsage` object straight from the provider's final stream chunk
   * so cache tokens are recorded as a first-class field. Existing
   * `record()` callers continue to work; they just miss the cache
   * telemetry fields.
   */
  recordTurn(provider: ProviderName, model: string, usage: TurnUsage): CostEntry {
    return this.record(provider, model, usage.inputTokens, usage.outputTokens, {
      ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    });
  }

  /**
   * Compute cache-hit ratio across all recorded entries.
   * Returns 0 when no cache activity has been recorded. The numerator is
   * cacheReadTokens, the denominator is cacheReadTokens + inputTokens
   * (cached + fresh input), so 0.6 means "60% of input tokens came from
   * the cache this period."
   */
  getCacheHitRatio(): number {
    let cached = 0;
    let fresh = 0;
    for (const entry of this.entries) {
      cached += entry.cacheReadTokens ?? 0;
      fresh += entry.inputTokens;
    }
    const total = cached + fresh;
    return total === 0 ? 0 : cached / total;
  }

  /**
   * Return all cost entries (read-only snapshot).
   * Wave 4G: used by the `wotann cost` CLI so it can aggregate per-provider
   * without leaking mutation power back into callers.
   */
  getEntries(): readonly CostEntry[] {
    return [...this.entries];
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
    return this.entries.slice(this.sessionStartIndex).reduce((sum, e) => sum + e.cost, 0);
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
        const inputCost = rates ? (estimatedTokens / 1000) * rates.input : 0;
        const outputCost = rates ? (estimatedOutputTokens / 1000) * rates.output : 0;
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
        recommendation =
          prediction.model === "unknown"
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
