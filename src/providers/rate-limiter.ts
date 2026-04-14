/**
 * Rate limit manager with full provider-chain fallback.
 *
 * DESIGN: When a provider is rate-limited, walk through ALL authenticated
 * providers in priority order. Free tier (Ollama + community) is the
 * ultimate final fallback. Never degrade the model — only change the provider.
 */

import type { ProviderName } from "../core/types.js";
import type { RateLimitState } from "./types.js";
import { buildFallbackChain, resolveNextProvider } from "./fallback-chain.js";

type RateLimitListener = (event: RateLimitEvent) => void;

export interface RateLimitEvent {
  readonly type: "rate-limited" | "fallback" | "resumed" | "all-exhausted";
  readonly provider: ProviderName;
  readonly waitMs?: number;
  readonly resetAt?: Date;
  readonly fallbackProvider?: ProviderName;
  readonly triedProviders?: readonly ProviderName[];
}

export class RateLimitManager {
  private readonly limits: Map<ProviderName, RateLimitState> = new Map();
  private readonly listeners: Set<RateLimitListener> = new Set();
  private readonly providerPriority: readonly ProviderName[];

  constructor(providerPriority: readonly ProviderName[]) {
    this.providerPriority = providerPriority;
  }

  onEvent(listener: RateLimitListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: RateLimitEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  markRateLimited(provider: ProviderName, retryAfterMs: number): void {
    const resetAt = new Date(Date.now() + retryAfterMs);
    this.limits.set(provider, {
      limited: true,
      resetAt,
      provider,
      retryAfterMs,
    });

    this.emit({ type: "rate-limited", provider, waitMs: retryAfterMs, resetAt });

    // Auto-resume after the wait period
    setTimeout(() => {
      const state = this.limits.get(provider);
      if (state?.limited) {
        this.limits.set(provider, { ...state, limited: false });
        this.emit({ type: "resumed", provider });
      }
    }, retryAfterMs);
  }

  isRateLimited(provider: ProviderName): boolean {
    const state = this.limits.get(provider);
    if (!state?.limited) return false;

    // Check if limit has expired
    if (state.resetAt.getTime() <= Date.now()) {
      this.limits.set(provider, { ...state, limited: false });
      return false;
    }

    return true;
  }

  getResetTime(provider: ProviderName): Date | null {
    const state = this.limits.get(provider);
    return state?.limited ? state.resetAt : null;
  }

  /**
   * Find the next available provider using the full fallback chain.
   *
   * Chain order: current provider's priority position → remaining paid → free.
   * Free providers (ollama, free) are ALWAYS last in the chain.
   */
  findFallback(
    currentProvider: ProviderName,
    availableProviders?: ReadonlySet<ProviderName>,
  ): ProviderName | null {
    const available = availableProviders ?? new Set(this.providerPriority);
    const chain = buildFallbackChain(
      currentProvider,
      available,
      (p) => this.isRateLimited(p),
    );

    // Skip the first entry (that's the current provider which is rate-limited)
    const remaining = chain.filter((e) => e.provider !== currentProvider);
    const next = resolveNextProvider(remaining);

    if (next) {
      this.emit({
        type: "fallback",
        provider: currentProvider,
        fallbackProvider: next,
      });
      return next;
    }

    // All providers exhausted — emit event so UI can show the situation
    this.emit({
      type: "all-exhausted",
      provider: currentProvider,
      triedProviders: chain.map((e) => e.provider),
    });

    return null;
  }

  /**
   * Resolve a provider, falling through the chain if rate-limited.
   * Returns the first available provider. If ALL paid providers are exhausted,
   * returns a free provider. Only waits as a last resort when even free is down.
   */
  async waitOrFallback(provider: ProviderName): Promise<ProviderName> {
    if (!this.isRateLimited(provider)) return provider;

    // Walk the full fallback chain
    const fallback = this.findFallback(provider);
    if (fallback) return fallback;

    // Absolute last resort: wait for the soonest-to-expire limit
    const soonestReset = this.getSoonestReset();
    if (soonestReset) {
      const waitMs = soonestReset.resetAt.getTime() - Date.now();
      if (waitMs > 0 && waitMs < 120_000) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return soonestReset.provider;
      }
    }

    return provider;
  }

  /**
   * Get the provider whose rate limit expires soonest.
   */
  private getSoonestReset(): { provider: ProviderName; resetAt: Date } | null {
    let soonest: { provider: ProviderName; resetAt: Date } | null = null;

    for (const [provider, state] of this.limits) {
      if (state.limited) {
        if (!soonest || state.resetAt.getTime() < soonest.resetAt.getTime()) {
          soonest = { provider, resetAt: state.resetAt };
        }
      }
    }

    return soonest;
  }

  /**
   * Get the count of currently rate-limited providers.
   */
  getRateLimitedCount(): number {
    let count = 0;
    for (const provider of this.providerPriority) {
      if (this.isRateLimited(provider)) count++;
    }
    return count;
  }

  /**
   * Check if ALL providers are rate-limited.
   */
  isAllExhausted(): boolean {
    return this.getRateLimitedCount() === this.providerPriority.length;
  }
}
