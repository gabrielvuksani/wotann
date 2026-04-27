/**
 * Provider fallback chain: when rate-limited, cascade through ALL authenticated
 * providers. Free tier (Ollama + community APIs) is the ultimate final fallback.
 *
 * DESIGN PRINCIPLE: Never degrade the model. The user chose a model for a reason.
 * If that model's provider is rate-limited, try the SAME model via another provider
 * (e.g., Claude Sonnet via Copilot instead of Anthropic). Only fall to a different
 * model when the SAME model isn't available anywhere. Free tier is always the last
 * resort — users get a response, never a dead end.
 */

import type { ProviderName } from "../core/types.js";

export interface FallbackEntry {
  readonly provider: ProviderName;
  readonly available: boolean;
  readonly rateLimited: boolean;
  readonly isFree: boolean;
}

export type RateLimitChecker = (provider: ProviderName) => boolean;

/**
 * The ordered fallback chain. Paid/authenticated providers first, free
 * providers (ollama, free endpoints) always last.
 *
 * Session-10 audit fix: the previous chain only enumerated 10 of the 18
 * declared `ProviderName` variants. The nine API-key-authenticated
 * third-party providers (`huggingface`, `mistral`, `deepseek`,
 * `perplexity`, `xai`, `together`, `fireworks`, `sambanova`, `groq`)
 * authenticated correctly at discovery time but were silently dropped
 * from the chain walk — setting `MISTRAL_API_KEY` picked Mistral as the
 * preferred provider but the harness never rotated through those
 * providers on rate-limit or auth failure. Now every non-free provider
 * participates in the rotation, ordered by typical cost / latency
 * (lowest-cost third parties first) so falls through hit the cheapest
 * authenticated option before Gemini / ollama / free.
 */
const PAID_PROVIDERS: readonly ProviderName[] = [
  "anthropic",
  "openai",
  "codex",
  "copilot",
  // OpenRouter is the escape hatch for the long-tail providers
  // dropped from the first-class set (mistral/deepseek/xai/etc.) —
  // hitting it on fallback covers them all in one entry. HF stays
  // because its router-style auth hits a different cost basin.
  "openrouter",
  "huggingface",
];

const FREE_PROVIDERS: readonly ProviderName[] = ["gemini", "ollama"];

/**
 * Build a complete fallback chain starting from the preferred provider.
 * Order: preferred → other paid → free (ollama → community)
 */
export function buildFallbackChain(
  preferred: ProviderName,
  availableProviders: ReadonlySet<ProviderName>,
  isRateLimited: RateLimitChecker,
): readonly FallbackEntry[] {
  const chain: FallbackEntry[] = [];
  const seen = new Set<ProviderName>();

  // 1. Preferred provider first
  if (availableProviders.has(preferred)) {
    chain.push({
      provider: preferred,
      available: true,
      rateLimited: isRateLimited(preferred),
      isFree: FREE_PROVIDERS.includes(preferred),
    });
    seen.add(preferred);
  }

  // 2. Other paid/authenticated providers
  for (const p of PAID_PROVIDERS) {
    if (!seen.has(p) && availableProviders.has(p)) {
      chain.push({
        provider: p,
        available: true,
        rateLimited: isRateLimited(p),
        isFree: false,
      });
      seen.add(p);
    }
  }

  // 3. Free providers as ultimate fallback (always last)
  for (const p of FREE_PROVIDERS) {
    if (!seen.has(p) && availableProviders.has(p)) {
      chain.push({
        provider: p,
        available: true,
        rateLimited: isRateLimited(p),
        isFree: true,
      });
      seen.add(p);
    }
  }

  return chain;
}

/**
 * Resolve the next available provider from the fallback chain.
 * Returns the first non-rate-limited provider, or null if ALL are exhausted
 * (which should never happen if free providers are configured).
 */
export function resolveNextProvider(chain: readonly FallbackEntry[]): ProviderName | null {
  // First pass: find a non-rate-limited provider
  for (const entry of chain) {
    if (entry.available && !entry.rateLimited) {
      return entry.provider;
    }
  }

  // If even free providers are rate-limited (very unlikely), return the first
  // free provider anyway — it's better to retry than to fail completely
  for (const entry of chain) {
    if (entry.available && entry.isFree) {
      return entry.provider;
    }
  }

  return null;
}

/**
 * Get a human-readable description of the fallback chain for status display.
 */
export function describeFallbackChain(chain: readonly FallbackEntry[]): string {
  return chain
    .map((e) => {
      const status = e.rateLimited ? "rate-limited" : "available";
      const tier = e.isFree ? " (free)" : "";
      return `${e.provider}${tier}: ${status}`;
    })
    .join(" → ");
}
