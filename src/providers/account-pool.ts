/**
 * Account Pool — multi-account rotation per provider.
 *
 * Supports multiple API keys/tokens per provider with:
 * - Priority-based selection (prefer OAuth > API key > free)
 * - Rate-limit-aware rotation (skip keys that are rate-limited)
 * - Session pinning (stick to one key per session for cache warmth)
 * - Billing failure backoff (5hr → doubling → 24hr cap)
 * - Health scoring per account (track success rate, latency)
 *
 * Configuration:
 * - Env vars: ANTHROPIC_API_KEY, ANTHROPIC_API_KEY_2, ANTHROPIC_API_KEY_3, etc.
 * - Config file: .wotann/config.yaml providers.anthropic.keys: [...]
 * - CLI: wotann providers add anthropic sk-ant-...
 *
 * Pattern from OpenClaw: OAuth profiles ranked before API keys.
 * Round-robin with session pinning for cache warmth.
 */

import type { ProviderName } from "../core/types.js";

export interface AccountCredential {
  readonly id: string;
  readonly provider: ProviderName;
  readonly token: string;
  readonly type: "oauth" | "api-key" | "setup-token";
  readonly priority: number;
  readonly label?: string;
}

export interface AccountHealth {
  requestCount: number;
  errorCount: number;
  rateLimitedUntil: number;
  billingFailureUntil: number;
  lastUsed: number;
  avgLatencyMs: number;
  pinned: boolean;
}

export class AccountPool {
  private readonly accounts: Map<string, AccountCredential> = new Map();
  private readonly health: Map<string, AccountHealth> = new Map();
  private sessionPin: Map<ProviderName, string> = new Map();

  /**
   * Add an account to the pool.
   */
  addAccount(cred: AccountCredential): void {
    this.accounts.set(cred.id, cred);
    if (!this.health.has(cred.id)) {
      this.health.set(cred.id, {
        requestCount: 0,
        errorCount: 0,
        rateLimitedUntil: 0,
        billingFailureUntil: 0,
        lastUsed: 0,
        avgLatencyMs: 0,
        pinned: false,
      });
    }
  }

  /**
   * Remove an account from the pool.
   */
  removeAccount(id: string): void {
    this.accounts.delete(id);
    this.health.delete(id);
    // Remove session pin if this was the pinned account
    for (const [provider, pinnedId] of this.sessionPin) {
      if (pinnedId === id) this.sessionPin.delete(provider);
    }
  }

  /**
   * Get the best available account for a provider.
   * Priority: session pin → OAuth → API key → lowest error rate.
   */
  getBestAccount(provider: ProviderName): AccountCredential | null {
    const now = Date.now();

    // Check session pin first
    const pinned = this.sessionPin.get(provider);
    if (pinned) {
      const account = this.accounts.get(pinned);
      const h = this.health.get(pinned);
      if (account && h && !this.isBlocked(h, now)) {
        return account;
      }
      // Pin is stale — clear it
      this.sessionPin.delete(provider);
    }

    // Get all accounts for this provider
    const candidates = [...this.accounts.values()]
      .filter((a) => a.provider === provider)
      .filter((a) => {
        const h = this.health.get(a.id);
        return !h || !this.isBlocked(h, now);
      })
      .sort((a, b) => {
        // Priority: type (OAuth first), then priority number, then error rate
        const typeOrder = { oauth: 0, "setup-token": 1, "api-key": 2 };
        const typeA = typeOrder[a.type] ?? 2;
        const typeB = typeOrder[b.type] ?? 2;
        if (typeA !== typeB) return typeA - typeB;

        if (a.priority !== b.priority) return a.priority - b.priority;

        const healthA = this.health.get(a.id);
        const healthB = this.health.get(b.id);
        const errorRateA =
          healthA && healthA.requestCount > 0 ? healthA.errorCount / healthA.requestCount : 0;
        const errorRateB =
          healthB && healthB.requestCount > 0 ? healthB.errorCount / healthB.requestCount : 0;
        return errorRateA - errorRateB;
      });

    const best = candidates[0] ?? null;

    // Pin the selected account for session cache warmth
    if (best) {
      this.sessionPin.set(provider, best.id);
    }

    return best;
  }

  /**
   * Get all accounts for a provider (for status display).
   */
  getAccounts(provider: ProviderName): readonly AccountCredential[] {
    return [...this.accounts.values()].filter((a) => a.provider === provider);
  }

  /**
   * Get all providers that have at least one account.
   */
  getProviders(): readonly ProviderName[] {
    const providers = new Set<ProviderName>();
    for (const account of this.accounts.values()) {
      providers.add(account.provider);
    }
    return [...providers];
  }

  /**
   * Record a successful request for an account.
   */
  recordSuccess(accountId: string, latencyMs: number): void {
    const h = this.health.get(accountId);
    if (!h) return;

    const newCount = h.requestCount + 1;
    this.health.set(accountId, {
      ...h,
      requestCount: newCount,
      lastUsed: Date.now(),
      avgLatencyMs: 0.3 * latencyMs + 0.7 * h.avgLatencyMs,
    });
  }

  /**
   * Record a rate limit for an account.
   */
  recordRateLimit(accountId: string, retryAfterMs: number = 60_000): void {
    const h = this.health.get(accountId);
    if (!h) return;

    this.health.set(accountId, {
      ...h,
      requestCount: h.requestCount + 1,
      errorCount: h.errorCount + 1,
      rateLimitedUntil: Date.now() + retryAfterMs,
      lastUsed: Date.now(),
    });

    // Clear session pin so we rotate to next account
    const account = this.accounts.get(accountId);
    if (account) this.sessionPin.delete(account.provider);
  }

  /**
   * Record a billing failure (overuse, insufficient funds).
   * Uses exponential backoff: 5hr → 10hr → 20hr → 24hr cap.
   */
  recordBillingFailure(accountId: string): void {
    const h = this.health.get(accountId);
    if (!h) return;

    const currentBackoff =
      h.billingFailureUntil > Date.now() ? h.billingFailureUntil - Date.now() : 5 * 60 * 60 * 1000; // Start at 5 hours

    const nextBackoff = Math.min(currentBackoff * 2, 24 * 60 * 60 * 1000);

    this.health.set(accountId, {
      ...h,
      errorCount: h.errorCount + 1,
      billingFailureUntil: Date.now() + nextBackoff,
      lastUsed: Date.now(),
    });

    const account = this.accounts.get(accountId);
    if (account) this.sessionPin.delete(account.provider);
  }

  /**
   * Get health info for an account.
   */
  getHealth(accountId: string): AccountHealth | undefined {
    return this.health.get(accountId);
  }

  /**
   * Get the total number of accounts in the pool.
   */
  size(): number {
    return this.accounts.size;
  }

  /**
   * Clear the session pin for a provider (force rotation on next request).
   */
  clearPin(provider: ProviderName): void {
    this.sessionPin.delete(provider);
  }

  /**
   * Discover accounts from environment variables.
   * Pattern: PROVIDER_API_KEY, PROVIDER_API_KEY_2, PROVIDER_API_KEY_3, etc.
   */
  discoverFromEnv(): number {
    let count = 0;
    // Session-10 audit fix: previously only 3 providers (anthropic / openai /
    // gemini) supported multi-key pool rotation. Callers setting MISTRAL_API_KEY
    // or GROQ_API_KEY got a single authenticated account with no rotation.
    // Now every API-key-authed provider in ProviderName participates — AWS /
    // Vertex / Azure use compound env vars checked via `discoverFromCompoundEnv`.
    const providers: readonly { name: ProviderName; envPrefix: string }[] = [
      { name: "anthropic", envPrefix: "ANTHROPIC_API_KEY" },
      { name: "openai", envPrefix: "OPENAI_API_KEY" },
      { name: "gemini", envPrefix: "GEMINI_API_KEY" },
      { name: "huggingface", envPrefix: "HF_TOKEN" },
      { name: "mistral", envPrefix: "MISTRAL_API_KEY" },
      { name: "deepseek", envPrefix: "DEEPSEEK_API_KEY" },
      { name: "perplexity", envPrefix: "PERPLEXITY_API_KEY" },
      { name: "xai", envPrefix: "XAI_API_KEY" },
      { name: "together", envPrefix: "TOGETHER_API_KEY" },
      { name: "fireworks", envPrefix: "FIREWORKS_API_KEY" },
      { name: "sambanova", envPrefix: "SAMBANOVA_API_KEY" },
      { name: "groq", envPrefix: "GROQ_API_KEY" },
    ];

    for (const { name, envPrefix } of providers) {
      // Primary key
      const primary = process.env[envPrefix];
      if (primary) {
        this.addAccount({
          id: `${name}-env-1`,
          provider: name,
          token: primary,
          type: "api-key",
          priority: 1,
          label: `${envPrefix} (primary)`,
        });
        count++;
      }

      // Secondary keys: _2, _3, etc.
      for (let i = 2; i <= 10; i++) {
        const key = process.env[`${envPrefix}_${i}`];
        if (key) {
          this.addAccount({
            id: `${name}-env-${i}`,
            provider: name,
            token: key,
            type: "api-key",
            priority: i,
            label: `${envPrefix}_${i}`,
          });
          count++;
        }
      }
    }

    return count;
  }

  private isBlocked(h: AccountHealth, now: number): boolean {
    return h.rateLimitedUntil > now || h.billingFailureUntil > now;
  }
}
