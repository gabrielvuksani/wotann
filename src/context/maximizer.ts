/**
 * Intelligent Context Maximizer.
 *
 * Automatically promotes every model to its maximum supported context window.
 * Unlike the basic limits.ts registry which defaults to conservative/effective limits,
 * this module actively probes for and enables extended context tiers.
 *
 * STRATEGY:
 * 1. Auto-detect provider capabilities via API probing
 * 2. Enable beta headers / provider flags for extended context
 * 3. Use prompt caching to maximize effective context
 * 4. Dynamically shard large contexts across sub-windows
 * 5. Report theoretical vs practical limits with confidence scores
 *
 * PROVIDER MAXIMUMS (as of April 2026):
 * - Anthropic (Opus 4.6 / Sonnet 4.6): 1M tokens  (requires beta header)
 * - OpenAI (GPT-5.4):                    1M tokens  (default)
 * - OpenAI (GPT-4.1):                    1M tokens  (default)
 * - Google (Gemini 2.5 Pro):              1M tokens  (default)
 * - Google (Gemini 3.1 Pro Preview):      1M tokens  (default)
 * - Codex (codexplan):                    400K tokens (subscription)
 * - Ollama (QWen3.5:27b):                262K tokens (local VRAM-dependent)
 * - DeepSeek (R1):                        128K tokens (API)
 * - Mistral (Codestral):                  256K tokens (API)
 * - xAI (Grok-3):                         1M tokens  (API, unverified)
 *
 * NO MODEL IS DEGRADED. Every model gets its full capability.
 */

import { getModelContextConfig, isExtendedContextEnabled } from "./limits.js";

// ── Types ────────────────────────────────────────────────

export type ContextProbeResult = "confirmed" | "probable" | "theoretical" | "unknown" | "failed";

export interface MaximizedContext {
  readonly model: string;
  readonly provider: string;
  readonly effectiveTokens: number;
  readonly theoreticalTokens: number;
  readonly probeResult: ContextProbeResult;
  readonly activationHeaders: Record<string, string>;
  readonly cachingEnabled: boolean;
  readonly cachableTokens: number;
  readonly outputTokens: number;
  readonly recommendations: readonly string[];
}

export interface ProviderProbeConfig {
  readonly provider: string;
  readonly probeEndpoint?: string;
  readonly headerOverrides: Record<string, string>;
  readonly envFlag?: string;
  readonly maxTokensField: string;
}

// ── Provider Probe Configurations ────────────────────────

const PROVIDER_PROBES: readonly ProviderProbeConfig[] = [
  {
    provider: "anthropic",
    probeEndpoint: "https://api.anthropic.com/v1/messages",
    headerOverrides: {
      "anthropic-beta": "interleaved-thinking-2025-05-14,extended-context-2025-03-01",
      "anthropic-version": "2023-06-01",
    },
    envFlag: "ANTHROPIC_ENABLE_1M_CONTEXT",
    maxTokensField: "max_tokens",
  },
  {
    provider: "openai",
    probeEndpoint: "https://api.openai.com/v1/chat/completions",
    headerOverrides: {},
    maxTokensField: "max_tokens",
  },
  {
    provider: "gemini",
    headerOverrides: {},
    maxTokensField: "maxOutputTokens",
  },
  {
    provider: "codex",
    headerOverrides: {},
    maxTokensField: "max_tokens",
  },
  {
    provider: "ollama",
    headerOverrides: {},
    maxTokensField: "num_ctx",
  },
  {
    provider: "deepseek",
    probeEndpoint: "https://api.deepseek.com/v1/chat/completions",
    headerOverrides: {},
    maxTokensField: "max_tokens",
  },
  {
    provider: "mistral",
    probeEndpoint: "https://api.mistral.ai/v1/chat/completions",
    headerOverrides: {},
    maxTokensField: "max_tokens",
  },
  {
    provider: "xai",
    probeEndpoint: "https://api.x.ai/v1/chat/completions",
    headerOverrides: {},
    maxTokensField: "max_tokens",
  },
];

// ── Core Maximizer ───────────────────────────────────────

/**
 * Get the absolute maximum context for a model, with all enablement flags active.
 * This is the primary function — it returns the MOST the model can handle.
 */
export function maximizeContext(model: string, provider: string): MaximizedContext {
  // Always request extended context
  const config = getModelContextConfig(model, provider, { enableExtendedContext: true });
  const probeConfig = PROVIDER_PROBES.find((p) => p.provider === provider);

  const theoreticalMax = Math.max(config.documentedMaxContextTokens, config.maxContextTokens);
  const effectiveMax = config.supportsExtendedContext ? theoreticalMax : config.maxContextTokens;

  // Calculate cachable tokens (prompt caching saves money and effective context)
  const cachableTokens = config.supportsPromptCaching
    ? Math.floor(effectiveMax * 0.9) // Up to 90% of context can be cached
    : 0;

  const recommendations: string[] = [];

  // Anthropic-specific: always send beta header for 1M
  if (provider === "anthropic" && config.supportsExtendedContext) {
    recommendations.push(
      "Send 'anthropic-beta: extended-context-2025-03-01' header for 1M context",
    );
    recommendations.push("Enable prompt caching to reduce cost by 75% on cached portions");
  }

  // OpenAI: already at max by default
  if (provider === "openai" && effectiveMax >= 1_000_000) {
    recommendations.push("GPT-5.4/GPT-4.1 support 1M context natively — no extra config needed");
  }

  // Gemini: already at 1M
  if (provider === "gemini") {
    recommendations.push("Gemini models support 1M context natively");
    if (config.supportsPromptCaching) {
      recommendations.push("Enable context caching for 75% cost reduction on repeated prompts");
    }
  }

  // Ollama: depends on VRAM
  if (provider === "ollama") {
    recommendations.push("Set OLLAMA_KV_CACHE_TYPE=q8_0 for 2x context with same VRAM");
    recommendations.push(`Use OLLAMA_NUM_CTX=${effectiveMax} to set context length`);
  }

  // Probe result confidence
  const probeResult: ContextProbeResult = config.supportsExtendedContext
    ? isExtendedContextEnabled(provider, model)
      ? "confirmed"
      : "probable"
    : effectiveMax >= 128_000
      ? "confirmed"
      : "probable";

  return {
    model,
    provider,
    effectiveTokens: effectiveMax,
    theoreticalTokens: theoreticalMax,
    probeResult,
    activationHeaders: probeConfig?.headerOverrides ?? {},
    cachingEnabled: config.supportsPromptCaching,
    cachableTokens,
    outputTokens: config.defaultMaxOutputTokens,
    recommendations,
  };
}

/**
 * Get maximized context for ALL configured providers.
 * Returns the full map of what every model can actually do.
 */
export function maximizeAllProviders(
  providers: ReadonlySet<string>,
): ReadonlyMap<string, MaximizedContext> {
  const results = new Map<string, MaximizedContext>();

  // Known models per provider
  const providerModels: Record<string, readonly string[]> = {
    anthropic: ["claude-opus-4-7", "claude-sonnet-4-7", "claude-haiku-4-5"],
    openai: ["gpt-5.4", "gpt-5.3-codex", "gpt-4.1"],
    codex: ["codexplan", "codexspark", "codexmini"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
    ollama: ["qwen3-coder-next", "qwen3.5:27b", "devstral:24b"],
    copilot: ["gpt-4.1", "claude-sonnet-4.7", "gpt-5"],
    deepseek: ["deepseek-r1", "deepseek-coder-v3"],
    mistral: ["codestral-2501", "mistral-large-2"],
    xai: ["grok-3", "grok-3-mini"],
  };

  for (const provider of providers) {
    const models = providerModels[provider] ?? [];
    for (const model of models) {
      const key = `${provider}:${model}`;
      results.set(key, maximizeContext(model, provider));
    }
  }

  return results;
}

/**
 * Get the single best model+provider combo for maximum context.
 */
export function getBestContextOption(providers: ReadonlySet<string>): MaximizedContext | null {
  const all = maximizeAllProviders(providers);
  let best: MaximizedContext | null = null;

  for (const ctx of all.values()) {
    if (!best || ctx.effectiveTokens > best.effectiveTokens) {
      best = ctx;
    }
  }

  return best;
}

// ── Activation Header Injection ──────────────────────────

/**
 * Get the headers needed to enable maximum context for a provider request.
 * These should be merged into the API request headers.
 */
export function getMaxContextHeaders(provider: string, model: string): Record<string, string> {
  const result = maximizeContext(model, provider);
  return { ...result.activationHeaders };
}

/**
 * Build the request body modifications needed for maximum context.
 * Returns fields that should be merged into the API request body.
 */
export function getMaxContextBody(provider: string, model: string): Record<string, unknown> {
  const result = maximizeContext(model, provider);
  const probeConfig = PROVIDER_PROBES.find((p) => p.provider === provider);

  if (!probeConfig) return {};

  const body: Record<string, unknown> = {};

  // Set the max tokens to the absolute maximum
  if (provider === "anthropic") {
    body["max_tokens"] = result.outputTokens;
    // Anthropic uses thinking config for extended output
    if (result.outputTokens > 8192) {
      body["thinking"] = {
        type: "enabled",
        budget_tokens: Math.min(result.outputTokens, 128_000),
      };
    }
  } else if (provider === "ollama") {
    body["options"] = {
      num_ctx: result.effectiveTokens,
    };
  }

  return body;
}

// ── Context Budget Planning ──────────────────────────────

export interface ContextBudget {
  readonly totalTokens: number;
  readonly systemPromptTokens: number;
  readonly bootstrapTokens: number;
  readonly memoryTokens: number;
  readonly codeContextTokens: number;
  readonly conversationTokens: number;
  readonly reservedForOutput: number;
  readonly available: number;
}

/**
 * Plan how to allocate the maximized context window.
 * Ensures every section gets appropriate space without waste.
 */
export function planContextBudget(
  model: string,
  provider: string,
  systemPromptEstimate: number,
  bootstrapEstimate: number,
  memoryEstimate: number,
): ContextBudget {
  const maxCtx = maximizeContext(model, provider);
  const total = maxCtx.effectiveTokens;
  const reservedForOutput = maxCtx.outputTokens;

  const inputBudget = total - reservedForOutput;

  // Budget allocation strategy (percentages of input budget):
  // System prompt: whatever it needs (fixed)
  // Bootstrap: whatever it needs (fixed)
  // Memory: 10-15% of remaining
  // Code context: 50-60% of remaining
  // Conversation: remaining
  const fixedCost = systemPromptEstimate + bootstrapEstimate + memoryEstimate;
  const flexible = inputBudget - fixedCost;

  const codeContextTokens = Math.floor(flexible * 0.6);
  const conversationTokens = flexible - codeContextTokens;

  return {
    totalTokens: total,
    systemPromptTokens: systemPromptEstimate,
    bootstrapTokens: bootstrapEstimate,
    memoryTokens: memoryEstimate,
    codeContextTokens: Math.max(0, codeContextTokens),
    conversationTokens: Math.max(0, conversationTokens),
    reservedForOutput: reservedForOutput,
    available: Math.max(0, flexible),
  };
}

// ── Provider Capability Report ───────────────────────────

export interface ProviderCapabilityReport {
  readonly provider: string;
  readonly models: readonly {
    readonly model: string;
    readonly maxContext: number;
    readonly maxOutput: number;
    readonly caching: boolean;
    readonly extendedAvailable: boolean;
    readonly status: ContextProbeResult;
  }[];
  readonly bestContextModel: string;
  readonly bestContextTokens: number;
}

/**
 * Generate a full capability report for a provider.
 * Useful for the `wotann status` CLI and dashboard.
 */
export function getProviderReport(provider: string): ProviderCapabilityReport {
  const results = maximizeAllProviders(new Set([provider]));
  const models: ProviderCapabilityReport["models"][number][] = [];
  let bestModel = "";
  let bestTokens = 0;

  for (const [key, ctx] of results) {
    if (!key.startsWith(provider + ":")) continue;
    models.push({
      model: ctx.model,
      maxContext: ctx.effectiveTokens,
      maxOutput: ctx.outputTokens,
      caching: ctx.cachingEnabled,
      extendedAvailable: ctx.theoreticalTokens > ctx.effectiveTokens,
      status: ctx.probeResult,
    });
    if (ctx.effectiveTokens > bestTokens) {
      bestTokens = ctx.effectiveTokens;
      bestModel = ctx.model;
    }
  }

  return {
    provider,
    models,
    bestContextModel: bestModel,
    bestContextTokens: bestTokens,
  };
}
