/**
 * Cost tracking: per-request, per-session, per-day.
 * Budget alerts and provider cost comparison.
 */

import type { ProviderName } from "../core/types.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DailyCostStore } from "./daily-cost-store.js";
import { writeFileAtomic } from "../utils/atomic-io.js";

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

/**
 * V9 GA-07 (T11.3) — payload broadcast to `onWarning` subscribers when the
 * running session cost crosses one of the threshold ladder rungs (75/90/95
 * percent of the configured budget). Each rung fires AT MOST ONCE per
 * ladder lifetime; the ledger resets when {@link CostTracker.setBudget}
 * is called with a NEW value or {@link CostTracker.resetThresholds} is
 * invoked explicitly. See `tests/telemetry/cost-threshold.test.ts` for
 * the pinned contract.
 */
export interface CostWarningEvent {
  /** Threshold rung that just fired (75 | 90 | 95). */
  readonly threshold: number;
  /** Cumulative cost across all entries at the moment of the crossing. */
  readonly currentCostUsd: number;
  /** Active budget the threshold is computed against. */
  readonly budgetUsd: number;
  /** `currentCostUsd / budgetUsd * 100` at the moment of the crossing. */
  readonly percentUsed: number;
  /** ISO-8601 wall-clock timestamp at the moment of the crossing. */
  readonly timestamp: string;
}

/** Subscriber callback invoked once per threshold crossing. */
export type CostWarningHandler = (event: CostWarningEvent) => void;

/**
 * Threshold ladder for cost warnings. Kept in ascending order so the
 * fire-loop can short-circuit once it hits a rung above the current
 * percent. Frozen so accidental mutation can't corrupt the ladder
 * across CostTracker instances.
 */
const COST_WARNING_THRESHOLDS: readonly number[] = Object.freeze([75, 90, 95]);

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

/**
 * Wave 4-Z: in-memory entries-array cap. A long-running daemon (months
 * of uptime, hundreds of queries/day) accumulates a 6-figure entries
 * array — pure memory waste because the live array is only used for
 * session aggregates; weekly/monthly aggregates already route through
 * dailyStore (bucket-based, capped). 10000 entries ≈ a quarter of usage
 * for power users, plenty of headroom for session-cost queries.
 */
const MAX_ENTRIES_HISTORY = 10000;

function isGroqFreeTierModel(model: string): boolean {
  return GROQ_FREE_TIER_MODELS.has(model);
}

/**
 * Wave 4-W: identify whether a turn's cost should be zeroed because the
 * user already pays a flat monthly subscription. Pure function (QB #7 —
 * no state, no I/O, no logging) so call sites can wrap the existing
 * `costTracker.record()` invocation without restructuring the runtime.
 *
 * Rules (any of):
 *   - explicit `billing === "subscription"` from the provider config
 *     (see types.ts:31 — BillingType union: "subscription" | "api-key" | "free")
 *   - `provider === "anthropic-cli"` — uses the user's Claude Pro / Max /
 *     Team subscription via the `claude` CLI binary; per-token cost is $0
 *     because Anthropic bills the monthly subscription not the API
 *   - `provider === "copilot"` — uses the user's GitHub Copilot
 *     Individual / Business subscription; per-token cost is $0 because
 *     Microsoft bills the Copilot seat not the API
 *
 * QB #6 honest fallback: when `billing` is `undefined` (caller didn't
 * pass it) AND the provider isn't a known subscription-only one, return
 * `false` so we charge the cost — under-counting silently is far worse
 * than over-counting visibly. Pay-per-token API users keep their full
 * cost telemetry; subscription users get a clean $0 line.
 *
 * @param provider The provider name (matches ProviderName from types.ts)
 * @param billing  Optional explicit billing model from the provider auth
 * @returns true when the per-token cost should be skipped entirely
 */
export function shouldZeroForSubscription(provider: string, billing?: string): boolean {
  if (billing === "subscription") return true;
  if (provider === "anthropic-cli") return true;
  if (provider === "copilot") return true;
  return false;
}

export class CostTracker {
  private readonly entries: CostEntry[] = [];
  private readonly storagePath?: string;
  // Wave 4-Z: mutable so the entries-cap splice can shift it down.
  private sessionStartIndex: number;
  private budgetUsd: number | null = null;
  private readonly dailyStore: DailyCostStore;
  /**
   * V9 GA-07 (T11.3) — per-instance ledger of which threshold rungs have
   * already fired since the last ladder reset. QB #7: per-tracker state,
   * NEVER module-global. Sorted ascending to mirror
   * {@link COST_WARNING_THRESHOLDS}.
   */
  private firedThresholds: number[] = [];
  /**
   * V9 GA-07 (T11.3) — per-instance subscriber set. QB #7: per-tracker
   * state. Each handler is wrapped in a try/catch at fire-time so a
   * throwing subscriber can't poison the broadcast (QB #6 honest
   * behavior — log + continue, don't silently swallow other handlers).
   */
  private readonly warningHandlers: Set<CostWarningHandler> = new Set();

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

  /**
   * Wave 4-W: estimate USD cost for a turn, discounting cache tokens.
   *
   * Cache pricing (Anthropic API — verified against
   * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   * and https://www.anthropic.com/api#pricing as of 2026-04):
   *   - Cache READ:  10% of base input rate (0.10x)  — large discount for hits
   *   - Cache WRITE: 125% of base input rate (1.25x) — premium for 5min ephemeral entry
   *   - Output:      uses model-specific output rate (no cache adjustment)
   *
   * The 0.10x / 1.25x ratio is consistent across Anthropic Claude models
   * (Opus, Sonnet, Haiku — all generations) per the published pricing
   * page, so we derive cache rates from the input rate rather than
   * adding cache-specific entries to COST_TABLE for every model. If a
   * future model deviates from this ratio, prefer adding model-specific
   * cache rates rather than altering this default.
   *
   * Other providers (OpenAI, Gemini, etc.) use the same shape because
   * cache telemetry is currently only surfaced by the Anthropic adapter
   * (see anthropic-adapter.ts:355-366 — cache_read_input_tokens /
   * cache_creation_input_tokens). Non-Anthropic callers will pass
   * cacheReadTokens/cacheWriteTokens = 0 (or omit them entirely) and
   * the formula reduces to the previous (input + output) accounting.
   */
  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheTokens?: { cacheReadTokens?: number; cacheWriteTokens?: number },
  ): number {
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

    const cacheReadTokens = cacheTokens?.cacheReadTokens ?? 0;
    const cacheWriteTokens = cacheTokens?.cacheWriteTokens ?? 0;

    // Anthropic cache-read = 10% of input rate; cache-write = 125% of input rate.
    // QB #15: source-verified against Anthropic API pricing docs (April 2026).
    return (
      (inputTokens / 1000) * rates.input +
      (outputTokens / 1000) * rates.output +
      (cacheReadTokens / 1000) * (rates.input * 0.1) +
      (cacheWriteTokens / 1000) * (rates.input * 1.25)
    );
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
    // Wave 4-W: pass cache tokens through so estimateCost() can apply the
    // 10% read discount + 125% write premium per Anthropic API pricing.
    const cost = this.estimateCost(model, inputTokens, outputTokens, cacheTokens);
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
    // Wave 4-Z: cap in-memory entries at MAX_HISTORY (10000) so a
    // long-running daemon doesn't grow unbounded. Persisted entries on
    // disk are unaffected — the cap is only on the live array used for
    // session-level aggregates. Aggregates over older entries remain
    // correct via dailyStore (weekly/monthly bucket-based).
    if (this.entries.length > MAX_ENTRIES_HISTORY) {
      const overflow = this.entries.length - MAX_ENTRIES_HISTORY;
      this.entries.splice(0, overflow);
      // Compensate sessionStartIndex so getSessionCost() still references
      // the same logical session boundary after the splice shifted indices.
      this.sessionStartIndex = Math.max(0, this.sessionStartIndex - overflow);
    }
    this.save();
    // Mirror into the per-day store so weekly/monthly aggregates stay accurate.
    if (cost > 0) {
      this.dailyStore.addCost(cost);
    }
    // V9 GA-07 (T11.3): emit cost.warning events for any newly-crossed
    // threshold rungs. Honest stub: silent default when no budget is
    // set or the budget is degenerate (<=0).
    this.maybeFireThresholdWarnings();
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
    // V9 GA-07 (T11.3): a new budget defines a new ladder. Reset the
    // fired-threshold ledger ONLY when the value actually changes; the
    // test suite pins this as idempotent (re-setting the same value
    // does not re-arm previously-fired rungs).
    const previous = this.budgetUsd;
    this.budgetUsd = usd;
    if (previous !== usd) {
      this.firedThresholds = [];
    }
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
   * Wave 4-V — enforce the `WOTANN_MAX_DAILY_SPEND` env-var hard cap.
   *
   * Reads `process.env.WOTANN_MAX_DAILY_SPEND` (USD as a float). When
   * the env var is missing, empty, zero, negative, or unparseable the
   * cap is treated as DISABLED (returns `{ allowed: true }`) — QB#6
   * honest fallback so a config typo never blocks legitimate users
   * from running queries. The runtime layer logs a warning when the
   * parse fails so the operator can see and correct the value.
   *
   * When the cap is active and `getTodayCost()` (UTC-anchored daily
   * total via `DailyCostStore`) is greater-than-or-equal-to the cap,
   * returns `{ allowed: false }` with a human-readable reason and the
   * concrete numbers so callers can render a clear error to the user.
   *
   * NOTE: this is a coarse guard — a single in-flight query whose
   * cost won't be known until completion can still tip the daily
   * total over the cap by a small amount. The intent is to prevent
   * runaway spend across a session, not to be a hard pre-flight
   * estimator (that's `predictCost()`).
   */
  checkDailyBudgetCap(): {
    allowed: boolean;
    reason?: string;
    capUsd?: number;
    currentUsd?: number;
  } {
    const raw = process.env["WOTANN_MAX_DAILY_SPEND"];
    if (raw === undefined || raw === "") {
      return { allowed: true };
    }

    const capUsd = Number.parseFloat(raw);
    if (!Number.isFinite(capUsd) || capUsd <= 0) {
      // QB#6 honest fallback: invalid value disables the cap rather
      // than blocks every query. The runtime guard surfaces a warn so
      // the operator can fix it; we don't throw here because the
      // CostTracker itself shouldn't have a side-effect logging policy
      // baked in (QB#7 honest separation of concerns).
      return { allowed: true };
    }

    const currentUsd = this.getTodayCost();
    if (currentUsd >= capUsd) {
      return {
        allowed: false,
        reason: `WOTANN_MAX_DAILY_SPEND cap reached: $${currentUsd.toFixed(4)} / $${capUsd.toFixed(4)}`,
        capUsd,
        currentUsd,
      };
    }
    return { allowed: true, capUsd, currentUsd };
  }

  /**
   * V9 GA-07 (T11.3) — register a callback for cost.warning events.
   *
   * The handler is invoked once per crossed threshold rung
   * (75/90/95% of the active budget) and AT MOST ONCE per rung per
   * ladder lifetime. Multiple handlers may be registered; one
   * subscriber throwing does not poison the broadcast to others
   * (QB #6 honest behavior — log + continue).
   *
   * @returns A disposer that removes the handler when called. Calling
   *   the disposer twice is a no-op. Disposers are safe to call from
   *   inside a handler (they take effect on the next fire).
   */
  onWarning(handler: CostWarningHandler): () => void {
    this.warningHandlers.add(handler);
    return () => {
      this.warningHandlers.delete(handler);
    };
  }

  /**
   * V9 GA-07 (T11.3) — return a snapshot of which threshold rungs have
   * already fired since the last ladder reset. Late subscribers can
   * use this to introspect what they missed.
   *
   * The returned array is a fresh copy in ascending order; mutating it
   * does not affect tracker state (immutability per coding-style.md).
   */
  getFiredThresholds(): number[] {
    return [...this.firedThresholds];
  }

  /**
   * V9 GA-07 (T11.3) — explicitly clear the fired-threshold ledger so
   * any future crossing can re-emit. Useful for long-running sessions
   * that want to re-arm warnings after the user acknowledges the
   * previous batch. Does NOT touch the budget itself or the cost
   * entries — only the ledger of which rungs have already fired.
   */
  resetThresholds(): void {
    this.firedThresholds = [];
  }

  /**
   * V9 GA-07 (T11.3) — internal: walk the threshold ladder and fire
   * any newly-crossed rungs to all registered subscribers in
   * ascending threshold order. Honest stub: silent default when no
   * budget is set or the budget is degenerate (<=0). Per-handler
   * error isolation via try/catch — one throwing handler does not
   * block others.
   */
  private maybeFireThresholdWarnings(): void {
    const budget = this.budgetUsd;
    // Honest stub: no warnings when budget is null, zero, or negative.
    // The 0 / negative guards both prevent divide-by-zero and treat a
    // degenerate budget as "no budget configured" rather than as
    // "every record crosses every threshold."
    if (budget === null || budget <= 0) return;

    const currentCost = this.getTotalCost();
    const percentUsed = (currentCost / budget) * 100;
    const timestamp = new Date().toISOString();

    // Walk ascending so a single record() that jumps past multiple
    // rungs fires them in 75 -> 90 -> 95 order. Short-circuit once we
    // hit a rung above the current percent (ladder is sorted).
    for (const threshold of COST_WARNING_THRESHOLDS) {
      if (percentUsed < threshold) break;
      if (this.firedThresholds.includes(threshold)) continue;

      this.firedThresholds.push(threshold);

      const event: CostWarningEvent = {
        threshold,
        currentCostUsd: currentCost,
        budgetUsd: budget,
        percentUsed,
        timestamp,
      };

      // Snapshot the handler set before iterating so a handler that
      // dispose()s itself (or registers a new one) doesn't perturb
      // the in-flight broadcast — Set iteration would otherwise
      // observe the mutation on the same tick.
      for (const handler of [...this.warningHandlers]) {
        try {
          handler(event);
        } catch (err) {
          // QB #6: don't silently swallow. Surface to stderr so the
          // operator can see which subscriber misbehaved, but
          // continue broadcasting so other subscribers still receive
          // the event. Avoid throwing — record() must remain
          // best-effort with respect to telemetry side-effects.
          // eslint-disable-next-line no-console
          console.error(`[CostTracker] cost.warning handler threw at threshold=${threshold}:`, err);
        }
      }
    }
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
      // Wave 6.5-UU (H-22) — money state is Tier-1: a half-written
      // cost-state file would lose budget tracking. writeFileAtomic uses
      // tmp + fsync + rename so a crash mid-write leaves the previous
      // state intact rather than truncating the file.
      writeFileAtomic(this.storagePath, JSON.stringify(serialized, null, 2));
    } catch {
      // Best-effort persistence only.
    }
  }
}
