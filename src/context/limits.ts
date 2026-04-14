/**
 * Context window limits registry.
 *
 * This module distinguishes between:
 * - documented max context: the upper bound advertised by the provider/model
 * - effective max context: what WOTANN can actually rely on in the current session
 *
 * That distinction matters because some providers expose long-context tiers only
 * behind beta headers, account flags, or provider-managed routing.
 */

export type ContextActivationMode =
  | "default"
  | "beta-header"
  | "subscription-route"
  | "provider-managed"
  | "local-config";

export interface ModelContextConfig {
  readonly model: string;
  readonly provider: string;
  /** Effective limit WOTANN can rely on right now. */
  readonly maxContextTokens: number;
  /** Upper bound documented by the vendor, when different. */
  readonly documentedMaxContextTokens: number;
  readonly defaultMaxOutputTokens: number;
  /** Whether the model has a higher tier than the default effective limit. */
  readonly supportsExtendedContext: boolean;
  readonly supportsPromptCaching: boolean;
  readonly inputCostPer1K: number;
  readonly cachedInputCostPer1K: number;
  readonly activationMode: ContextActivationMode;
  readonly notes?: string;
}

export interface ContextResolutionOptions {
  readonly enableExtendedContext?: boolean;
}

export interface OpusAvailability {
  readonly available: boolean;
  readonly provider: string | null;
  readonly maxTokens: number;
  readonly activationMode: ContextActivationMode | null;
  readonly requiresExplicitEnablement: boolean;
}

/**
 * Known model context windows as of April 3, 2026.
 *
 * Effective limits reflect what WOTANN uses by default.
 * Documented limits reflect the upper bound published by providers.
 */
const MODEL_CONTEXT_MAP: readonly ModelContextConfig[] = [
  // Anthropic: Both Opus 4.6 and Sonnet 4.6 — 1M context GA since March 13, 2026.
  // No beta header needed. Standard pricing, no surcharge. The old context-1m-2025-08-07
  // header is being retired April 30, 2026.
  {
    model: "claude-opus-4-6",
    provider: "anthropic",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 128_000,
    supportsExtendedContext: false, // GA — no special activation needed
    supportsPromptCaching: true,
    inputCostPer1K: 0.005,
    cachedInputCostPer1K: 0.00125,
    activationMode: "default",
    notes: "1M context GA since March 13, 2026. No surcharge. Prompt caching: 75% savings.",
  },
  {
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 64_000,
    supportsExtendedContext: false, // GA — no special activation needed
    supportsPromptCaching: true,
    inputCostPer1K: 0.003,
    cachedInputCostPer1K: 0.00075,
    activationMode: "default",
    notes: "1M context GA since March 13, 2026. Best value for long-context tasks.",
  },
  {
    model: "claude-haiku-4-5",
    provider: "anthropic",
    maxContextTokens: 200_000,
    documentedMaxContextTokens: 200_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: true,
    inputCostPer1K: 0.0008,
    cachedInputCostPer1K: 0.0002,
    activationMode: "default",
  },

  // OpenAI
  {
    model: "gpt-5.4",
    provider: "openai",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 128_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0.0025,
    cachedInputCostPer1K: 0.0025,
    activationMode: "default",
    notes: "GPT-5.4 supports 1M context and 128K output per OpenAI docs (Apr 2026). Pricing: $2.50/M in, $15/M out.",
  },
  {
    model: "gpt-5.3-codex",
    provider: "openai",
    maxContextTokens: 400_000,
    documentedMaxContextTokens: 400_000,
    defaultMaxOutputTokens: 16_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0.005,
    cachedInputCostPer1K: 0.005,
    activationMode: "default",
  },
  {
    model: "gpt-4.1",
    provider: "openai",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 32_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0.002,
    cachedInputCostPer1K: 0.002,
    activationMode: "default",
  },

  // Codex / ChatGPT backend
  {
    model: "codexplan",
    provider: "codex",
    maxContextTokens: 400_000,
    documentedMaxContextTokens: 400_000,
    defaultMaxOutputTokens: 32_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "subscription-route",
    notes: "Subscription route mapped to the current public Codex/GPT-5-class 400K context tier.",
  },
  {
    model: "codexspark",
    provider: "codex",
    maxContextTokens: 400_000,
    documentedMaxContextTokens: 400_000,
    defaultMaxOutputTokens: 16_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "subscription-route",
  },
  {
    model: "codexmini",
    provider: "codex",
    maxContextTokens: 400_000,
    documentedMaxContextTokens: 400_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "subscription-route",
  },

  // Copilot
  {
    model: "gpt-4.1",
    provider: "copilot",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 4_096,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },
  {
    model: "claude-sonnet-4",
    provider: "copilot",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 4_096,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },
  {
    model: "gpt-5",
    provider: "copilot",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 16_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },

  // Gemini
  {
    model: "gemini-2.5-flash",
    provider: "gemini",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: true,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "default",
  },
  {
    model: "gemini-2.5-pro",
    provider: "gemini",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: true,
    inputCostPer1K: 0.00125,
    cachedInputCostPer1K: 0.000315,
    activationMode: "default",
  },
  {
    model: "gemini-2.0-flash",
    provider: "gemini",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "default",
    notes: "Deprecated by Google in favor of Gemini 2.5 Flash. Retained for backward compatibility.",
  },
  {
    model: "gemini-3.1-pro-preview",
    provider: "gemini",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 65_536,
    supportsExtendedContext: false,
    supportsPromptCaching: true,
    inputCostPer1K: 0.00125,
    cachedInputCostPer1K: 0.000315,
    activationMode: "default",
    notes: "Google's latest Gemini 3.1 Pro Preview. 1M+ context, native tool calling, computer use support.",
  },

  // Ollama / local
  {
    model: "qwen3-coder-next",
    provider: "ollama",
    maxContextTokens: 131_072,
    documentedMaxContextTokens: 131_072,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
  },
  {
    model: "qwen3.5:27b",
    provider: "ollama",
    maxContextTokens: 262_144,
    documentedMaxContextTokens: 262_144,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
  },
  {
    model: "devstral:24b",
    provider: "ollama",
    maxContextTokens: 131_072,
    documentedMaxContextTokens: 131_072,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
  },
  {
    model: "gemma4:27b",
    provider: "ollama",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
  },
  {
    model: "gemma4:12b",
    provider: "ollama",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
  },
  {
    model: "nemotron-cascade-2",
    provider: "ollama",
    maxContextTokens: 131_072,
    documentedMaxContextTokens: 131_072,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
  },
  {
    model: "minimax-m2.7",
    provider: "ollama",
    maxContextTokens: 200_000,
    documentedMaxContextTokens: 200_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
  },

  // Free/open router style providers
  {
    model: "meta-llama/Llama-3.3-70B-Instruct",
    provider: "huggingface",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },
  {
    model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    provider: "huggingface",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },
  {
    model: "deepseek-ai/DeepSeek-R1",
    provider: "huggingface",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },
  {
    model: "cerebras-llama-3.3-70b",
    provider: "free",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },
  {
    model: "groq-llama-3.3-70b",
    provider: "free",
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 8_192,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "provider-managed",
  },

  // DeepSeek V4 (March 2026) — cheapest 1M option
  {
    model: "deepseek-v4",
    provider: "openai", // via OpenAI-compatible API
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 32_000,
    supportsExtendedContext: false,
    supportsPromptCaching: true,
    inputCostPer1K: 0.0003,
    cachedInputCostPer1K: 0.00003,
    activationMode: "default",
    notes: "DeepSeek V4 (March 2026). 1M context, cheapest per-token. Cached input 90% discount.",
  },
  // Llama 4 Maverick (local via Ollama)
  {
    model: "llama4-maverick",
    provider: "ollama",
    maxContextTokens: 1_000_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 32_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "local-config",
    notes: "Llama 4 Maverick 400B MoE (17B active). Requires massive VRAM for full 1M.",
  },
  // Mistral Large 3
  {
    model: "mistral-large-3",
    provider: "openai", // via OpenAI-compatible API
    maxContextTokens: 256_000,
    documentedMaxContextTokens: 256_000,
    defaultMaxOutputTokens: 32_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0,
    cachedInputCostPer1K: 0,
    activationMode: "default",
    notes: "Mistral Large 3 (41B active, 675B MoE). 256K context.",
  },
  // Grok 3
  {
    model: "grok-3",
    provider: "openai", // via OpenAI-compatible API
    maxContextTokens: 131_000,
    documentedMaxContextTokens: 1_000_000,
    defaultMaxOutputTokens: 32_000,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0.003,
    cachedInputCostPer1K: 0.003,
    activationMode: "default",
    notes: "Grok 3 from xAI. Documented 1M but practical ceiling ~131K. $3/M input.",
  },
];

function normalizeModelName(model: string): string {
  return model.replace(/\s*\[1m\]\s*$/i, "").trim();
}

function requestsExtendedContext(model?: string): boolean {
  return model ? /\[1m\]\s*$/i.test(model) : false;
}

export function isExtendedContextEnabled(provider?: string, model?: string): boolean {
  if (process.env["WOTANN_ENABLE_EXTENDED_CONTEXT"] === "1") return true;
  if (provider === "anthropic" && process.env["ANTHROPIC_ENABLE_1M_CONTEXT"] === "1") return true;
  return requestsExtendedContext(model);
}

/**
 * Look up context limits for a specific model and provider.
 * Returns an effective runtime profile, optionally promoting to the documented
 * long-context tier when the session explicitly enables it.
 */
export function getModelContextConfig(
  model: string,
  provider: string,
  options: ContextResolutionOptions = {},
): ModelContextConfig {
  const normalizedModel = normalizeModelName(model);
  const wantsExtended = options.enableExtendedContext ?? isExtendedContextEnabled(provider, model);

  const exact = MODEL_CONTEXT_MAP.find(
    (entry) => entry.model === normalizedModel && entry.provider === provider,
  );
  const modelMatch = MODEL_CONTEXT_MAP.find((entry) => entry.model === normalizedModel);

  const defaults: Record<string, ModelContextConfig> = {
    anthropic: {
      model: normalizedModel,
      provider,
      maxContextTokens: 200_000,
      documentedMaxContextTokens: 200_000,
      defaultMaxOutputTokens: 8_192,
      supportsExtendedContext: false,
      supportsPromptCaching: true,
      inputCostPer1K: 0.003,
      cachedInputCostPer1K: 0.00075,
      activationMode: "default",
    },
    openai: {
      model: normalizedModel,
      provider,
      maxContextTokens: 128_000,
      documentedMaxContextTokens: 128_000,
      defaultMaxOutputTokens: 4_096,
      supportsExtendedContext: false,
      supportsPromptCaching: false,
      inputCostPer1K: 0.005,
      cachedInputCostPer1K: 0.005,
      activationMode: "default",
    },
    codex: {
      model: normalizedModel,
      provider,
      maxContextTokens: 400_000,
      documentedMaxContextTokens: 400_000,
      defaultMaxOutputTokens: 16_000,
      supportsExtendedContext: false,
      supportsPromptCaching: false,
      inputCostPer1K: 0,
      cachedInputCostPer1K: 0,
      activationMode: "subscription-route",
    },
    copilot: {
      model: normalizedModel,
      provider,
      maxContextTokens: 128_000,
      documentedMaxContextTokens: 128_000,
      defaultMaxOutputTokens: 4_096,
      supportsExtendedContext: false,
      supportsPromptCaching: false,
      inputCostPer1K: 0,
      cachedInputCostPer1K: 0,
      activationMode: "provider-managed",
    },
    ollama: {
      model: normalizedModel,
      provider,
      maxContextTokens: 131_072,
      documentedMaxContextTokens: 131_072,
      defaultMaxOutputTokens: 4_096,
      supportsExtendedContext: false,
      supportsPromptCaching: false,
      inputCostPer1K: 0,
      cachedInputCostPer1K: 0,
      activationMode: "local-config",
    },
    gemini: {
      model: normalizedModel,
      provider,
      maxContextTokens: 1_000_000,
      documentedMaxContextTokens: 1_000_000,
      defaultMaxOutputTokens: 8_192,
      supportsExtendedContext: false,
      supportsPromptCaching: true,
      inputCostPer1K: 0,
      cachedInputCostPer1K: 0,
      activationMode: "default",
    },
    huggingface: {
      model: normalizedModel,
      provider,
      maxContextTokens: 128_000,
      documentedMaxContextTokens: 128_000,
      defaultMaxOutputTokens: 8_192,
      supportsExtendedContext: false,
      supportsPromptCaching: false,
      inputCostPer1K: 0,
      cachedInputCostPer1K: 0,
      activationMode: "provider-managed",
    },
    free: {
      model: normalizedModel,
      provider,
      maxContextTokens: 128_000,
      documentedMaxContextTokens: 128_000,
      defaultMaxOutputTokens: 8_192,
      supportsExtendedContext: false,
      supportsPromptCaching: false,
      inputCostPer1K: 0,
      cachedInputCostPer1K: 0,
      activationMode: "provider-managed",
    },
  };

  const base = exact ?? (modelMatch ? { ...modelMatch, provider } : defaults[provider]) ?? {
    model: normalizedModel,
    provider,
    maxContextTokens: 128_000,
    documentedMaxContextTokens: 128_000,
    defaultMaxOutputTokens: 4_096,
    supportsExtendedContext: false,
    supportsPromptCaching: false,
    inputCostPer1K: 0.01,
    cachedInputCostPer1K: 0.01,
    activationMode: "default" as const,
  };

  if (base.supportsExtendedContext && wantsExtended) {
    return {
      ...base,
      maxContextTokens: Math.max(base.maxContextTokens, base.documentedMaxContextTokens),
    };
  }

  return base;
}

/**
 * Get the maximum effective context across all available providers.
 */
export function getMaxAvailableContext(
  providers: ReadonlySet<string>,
  options: ContextResolutionOptions = {},
): number {
  let maxContext = 0;

  for (const config of MODEL_CONTEXT_MAP) {
    if (providers.has(config.provider)) {
      maxContext = Math.max(
        maxContext,
        getModelContextConfig(config.model, config.provider, options).maxContextTokens,
      );
    }
  }

  return maxContext || 128_000;
}

/**
 * Get the maximum documented context across all available providers.
 */
export function getMaxDocumentedContext(
  providers: ReadonlySet<string>,
): number {
  let maxContext = 0;

  for (const config of MODEL_CONTEXT_MAP) {
    if (providers.has(config.provider)) {
      maxContext = Math.max(maxContext, config.documentedMaxContextTokens);
    }
  }

  return maxContext || 128_000;
}

/**
 * Ollama KV cache optimization.
 */
export function getOllamaKVCacheConfig(modelContextLength: number): {
  readonly OLLAMA_KV_CACHE_TYPE: string;
  readonly numCtx: number;
  readonly description: string;
} {
  return {
    OLLAMA_KV_CACHE_TYPE: "q8_0",
    numCtx: modelContextLength,
    description: `KV cache quantized to q8_0 (2x context for same VRAM). Context: ${(modelContextLength / 1000).toFixed(0)}K tokens.`,
  };
}

/**
 * Legacy-named helper that reports whether Anthropic 1M long-context routing is
 * actually active in the current WOTANN session.
 */
export function isOpus1MAvailable(
  providers: ReadonlySet<string>,
  options: ContextResolutionOptions = {},
): OpusAvailability {
  const configs = MODEL_CONTEXT_MAP
    .filter((entry) =>
      entry.provider === "anthropic"
      && entry.documentedMaxContextTokens >= 1_000_000
      && providers.has(entry.provider),
    )
    .map((entry) => getModelContextConfig(entry.model, entry.provider, options));

  const best = configs.reduce<ModelContextConfig | null>(
    (currentBest, current) =>
      !currentBest || current.maxContextTokens > currentBest.maxContextTokens ? current : currentBest,
    null,
  );

  const documentedBest = MODEL_CONTEXT_MAP
    .filter((entry) =>
      entry.provider === "anthropic"
      && entry.documentedMaxContextTokens >= 1_000_000
      && providers.has(entry.provider),
    )
    .reduce<ModelContextConfig | null>(
      (currentBest, current) =>
        !currentBest || current.documentedMaxContextTokens > currentBest.documentedMaxContextTokens ? current : currentBest,
      null,
    );

  return {
    available: best !== null && best.maxContextTokens >= 1_000_000,
    provider: best?.provider ?? null,
    maxTokens: best?.maxContextTokens ?? 0,
    activationMode: best?.activationMode ?? null,
    requiresExplicitEnablement:
      best !== null &&
      best.maxContextTokens < 1_000_000 &&
      (documentedBest?.documentedMaxContextTokens ?? 0) >= 1_000_000,
  };
}
