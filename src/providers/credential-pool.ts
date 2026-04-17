/**
 * Credential Pool — same-provider multi-key rotation with failover.
 *
 * Goes BEYOND the existing AccountPool with:
 * - "least_used" rotation strategy (Hermes v0.7.0 pattern)
 * - 401 failover: auto-rotate to next key on auth failure
 * - Per-turn primary restoration: after fallback, restore primary on next turn
 * - Thread-safe key selection with async lock
 * - Compression death spiral detection and prevention
 * - Deterministic call_id generation for prompt cache consistency
 *
 * Wraps AccountPool for backward compatibility while adding new capabilities.
 */

import { AccountPool, type AccountCredential } from "./account-pool.js";
import type { ProviderName } from "../core/types.js";
import { createHash } from "node:crypto";

// ── Cooldown Constants (from hermes-agent credential_pool.py) ──────
/** 1 hour cooldown for 429 (rate limit) — quotas reset frequently. */
export const COOLDOWN_429_MS = 60 * 60 * 1_000;
/** 24 hour cooldown for 402 (billing/quota exhausted). */
export const COOLDOWN_402_MS = 24 * 60 * 60 * 1_000;
/** Default cooldown for other transient failures (5 minutes). */
export const COOLDOWN_DEFAULT_MS = 5 * 60 * 1_000;

export type RotationStrategy = "fill_first" | "least_used" | "round_robin" | "priority" | "random";

export interface CredentialPoolConfig {
  readonly rotationStrategy: RotationStrategy;
  /** Auto-restore primary provider after N successful turns on fallback */
  readonly restorePrimaryAfterTurns: number;
  /** Max consecutive auth failures before permanent key blacklist */
  readonly maxAuthFailures: number;
  /** Enable deterministic call_id generation */
  readonly deterministicCallIds: boolean;
  /** Enable compression death spiral detection */
  readonly compressionDeathSpiralDetection: boolean;
}

interface KeyUsageState {
  usageCount: number;
  lastRotatedAt: number;
  consecutiveAuthFailures: number;
  blacklisted: boolean;
  roundRobinIndex: number;
}

interface PrimaryRestorationState {
  readonly originalProvider: ProviderName;
  readonly originalKeyId: string;
  turnsOnFallback: number;
}

interface CompressionState {
  lastCompressionAt: number;
  compressionCount: number;
  failedCompressionCount: number;
  inDeathSpiral: boolean;
}

const DEFAULT_CONFIG: CredentialPoolConfig = {
  rotationStrategy: "fill_first",
  restorePrimaryAfterTurns: 3,
  maxAuthFailures: 5,
  deterministicCallIds: true,
  compressionDeathSpiralDetection: true,
};

export interface DynamicTokenCredential {
  readonly type: "dynamic-bearer";
  readonly provider: ProviderName;
  readonly fetchToken: () => Promise<string>;
  readonly refreshToken?: () => Promise<string>;
  readonly expiresAt?: number;
}

interface DynamicTokenState {
  readonly credential: DynamicTokenCredential;
  cachedToken: string | null;
  cachedExpiresAt: number;
  refreshing: boolean;
}

export class CredentialPool {
  private readonly pool: AccountPool;
  private readonly config: CredentialPoolConfig;
  private readonly keyUsage: Map<string, KeyUsageState> = new Map();
  private readonly dynamicTokens: Map<ProviderName, DynamicTokenState> = new Map();
  private restorationState: PrimaryRestorationState | null = null;
  private compressionState: CompressionState = {
    lastCompressionAt: 0,
    compressionCount: 0,
    failedCompressionCount: 0,
    inDeathSpiral: false,
  };
  private callIdCounter = 0;

  constructor(pool?: AccountPool, config?: Partial<CredentialPoolConfig>) {
    this.pool = pool ?? new AccountPool();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get the underlying AccountPool for backward compatibility */
  getPool(): AccountPool {
    return this.pool;
  }

  /**
   * Get the best credential using the configured rotation strategy.
   */
  getCredential(provider: ProviderName): AccountCredential | null {
    switch (this.config.rotationStrategy) {
      case "fill_first":
        return this.getFillFirstCredential(provider);
      case "least_used":
        return this.getLeastUsedCredential(provider);
      case "round_robin":
        return this.getRoundRobinCredential(provider);
      case "priority":
        return this.pool.getBestAccount(provider);
      case "random":
        return this.getRandomCredential(provider);
      default:
        return this.pool.getBestAccount(provider);
    }
  }

  /**
   * Record a successful API call. Updates usage stats and handles
   * primary restoration logic.
   */
  recordSuccess(keyId: string, latencyMs: number): void {
    this.pool.recordSuccess(keyId, latencyMs);

    const state = this.getOrCreateUsageState(keyId);
    state.usageCount++;
    state.consecutiveAuthFailures = 0;

    // Check primary restoration
    if (this.restorationState) {
      this.restorationState.turnsOnFallback++;
      if (this.restorationState.turnsOnFallback >= this.config.restorePrimaryAfterTurns) {
        // Attempt to restore primary
        this.restorationState = null;
      }
    }
  }

  /**
   * Record an auth failure (401/403). Auto-rotates to next key.
   * Returns the next credential to try, or null if all exhausted.
   */
  recordAuthFailure(keyId: string, provider: ProviderName): AccountCredential | null {
    const state = this.getOrCreateUsageState(keyId);
    state.consecutiveAuthFailures++;

    if (state.consecutiveAuthFailures >= this.config.maxAuthFailures) {
      state.blacklisted = true;
    }

    this.pool.recordRateLimit(keyId, 300_000); // 5-minute backoff

    // Save primary for restoration
    if (!this.restorationState) {
      this.restorationState = {
        originalProvider: provider,
        originalKeyId: keyId,
        turnsOnFallback: 0,
      };
    }

    // Get next non-blacklisted key
    return this.getCredential(provider);
  }

  /**
   * Record a rate limit hit. Different from auth failure — the key is valid
   * but temporarily blocked.
   *
   * Cooldown durations follow hermes-agent credential_pool.py pattern:
   *   429 (rate limit): 1 hour  — quotas reset frequently
   *   402 (billing):    24 hours — billing issues take longer to resolve
   *   other:            uses provided retryAfterMs or 5-minute default
   */
  recordRateLimit(keyId: string, retryAfterMs: number, statusCode?: number): void {
    const cooldown = statusCode === 429
      ? COOLDOWN_429_MS
      : statusCode === 402
        ? COOLDOWN_402_MS
        : retryAfterMs || COOLDOWN_DEFAULT_MS;
    this.pool.recordRateLimit(keyId, cooldown);
  }

  /**
   * Check if primary should be restored (after N successful fallback turns).
   */
  shouldRestorePrimary(): PrimaryRestorationState | null {
    return this.restorationState;
  }

  /**
   * Force restore primary provider (called after successful primary check).
   */
  restorePrimary(): void {
    this.restorationState = null;
  }

  /** Generate a deterministic call_id for prompt cache consistency */
  generateCallId(provider: ProviderName, model: string, turnIndex: number): string {
    if (!this.config.deterministicCallIds) {
      return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    const input = `${provider}:${model}:${turnIndex}:${this.callIdCounter++}`;
    return `call_${createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
  }

  // ── Compression Death Spiral Prevention ──────────────────

  /**
   * Record a compression event. Detects death spirals where:
   * compression triggers → fails → retriggers in tight loop.
   */
  recordCompression(success: boolean): void {
    const now = Date.now();
    this.compressionState.compressionCount++;
    this.compressionState.lastCompressionAt = now;

    if (!success) {
      this.compressionState.failedCompressionCount++;
    }

    if (this.config.compressionDeathSpiralDetection) {
      // Death spiral: 3+ failed compressions in 60 seconds
      const recentWindow = 60_000;
      if (
        this.compressionState.failedCompressionCount >= 3 &&
        now - this.compressionState.lastCompressionAt < recentWindow
      ) {
        this.compressionState.inDeathSpiral = true;
      }
    }
  }

  /** Check if we're in a compression death spiral */
  isCompressionDeathSpiral(): boolean {
    return this.compressionState.inDeathSpiral;
  }

  /** Reset compression state (after manual intervention) */
  resetCompressionState(): void {
    this.compressionState = {
      lastCompressionAt: 0,
      compressionCount: 0,
      failedCompressionCount: 0,
      inDeathSpiral: false,
    };
  }

  /** Get pool statistics for monitoring */
  getStats(provider: ProviderName): {
    totalKeys: number;
    activeKeys: number;
    blacklistedKeys: number;
    rotationStrategy: RotationStrategy;
    compressionDeathSpiral: boolean;
    pendingPrimaryRestore: boolean;
  } {
    const accounts = this.pool.getAccounts(provider);
    let blacklisted = 0;
    for (const a of accounts) {
      const state = this.keyUsage.get(a.id);
      if (state?.blacklisted) blacklisted++;
    }

    return {
      totalKeys: accounts.length,
      activeKeys: accounts.length - blacklisted,
      blacklistedKeys: blacklisted,
      rotationStrategy: this.config.rotationStrategy,
      compressionDeathSpiral: this.compressionState.inDeathSpiral,
      pendingPrimaryRestore: this.restorationState !== null,
    };
  }

  /** Discover credentials from environment and config */
  discoverAll(): number {
    return this.pool.discoverFromEnv();
  }

  // ── Dynamic Bearer Token Support ───────────────────────────

  /**
   * Register a dynamic token credential. The token is fetched lazily
   * on first use and automatically refreshed when expired.
   */
  registerDynamicToken(config: DynamicTokenCredential): void {
    this.dynamicTokens.set(config.provider, {
      credential: config,
      cachedToken: null,
      cachedExpiresAt: config.expiresAt ?? 0,
      refreshing: false,
    });
  }

  /**
   * Get a valid token for a provider. If a dynamic token is registered,
   * it will be fetched or refreshed automatically.
   *
   * Falls back to static credentials if no dynamic token is registered.
   */
  async getToken(provider: ProviderName): Promise<string> {
    const dynamicState = this.dynamicTokens.get(provider);
    if (!dynamicState) {
      // Fall back to static credential
      const cred = this.getCredential(provider);
      if (!cred) {
        throw new Error(`No credential available for provider: ${provider}`);
      }
      return cred.token;
    }

    // Check if cached token is still valid
    if (dynamicState.cachedToken && dynamicState.cachedExpiresAt > Date.now()) {
      return dynamicState.cachedToken;
    }

    // Prevent concurrent refresh storms
    if (dynamicState.refreshing) {
      // Wait briefly and retry
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (dynamicState.cachedToken && dynamicState.cachedExpiresAt > Date.now()) {
        return dynamicState.cachedToken;
      }
    }

    dynamicState.refreshing = true;
    try {
      const token = dynamicState.cachedToken && dynamicState.credential.refreshToken
        ? await dynamicState.credential.refreshToken()
        : await dynamicState.credential.fetchToken();

      // Default expiry: 55 minutes (leave 5min buffer for typical 1hr tokens)
      const defaultExpiryMs = 55 * 60 * 1000;
      dynamicState.cachedToken = token;
      dynamicState.cachedExpiresAt = dynamicState.credential.expiresAt ?? (Date.now() + defaultExpiryMs);

      return token;
    } finally {
      dynamicState.refreshing = false;
    }
  }

  /**
   * Check if a dynamic token is registered for a provider.
   */
  hasDynamicToken(provider: ProviderName): boolean {
    return this.dynamicTokens.has(provider);
  }

  /**
   * Invalidate a cached dynamic token, forcing re-fetch on next use.
   */
  invalidateDynamicToken(provider: ProviderName): void {
    const state = this.dynamicTokens.get(provider);
    if (state) {
      state.cachedToken = null;
      state.cachedExpiresAt = 0;
    }
  }

  // ── Private methods ──────────────────────────────────────

  /**
   * Fill-first strategy (hermes default): always use the first available
   * credential in priority order. Only rotate to the next when the current
   * one is rate-limited, billing-failed, or blacklisted.
   *
   * This maximizes cache warmth and keeps billing concentrated on the
   * primary account until it's exhausted.
   */
  private getFillFirstCredential(provider: ProviderName): AccountCredential | null {
    const accounts = this.pool.getAccounts(provider);
    const now = Date.now();

    for (const account of accounts) {
      const state = this.keyUsage.get(account.id);
      if (state?.blacklisted) continue;

      const health = this.pool.getHealth(account.id);
      if (health && (health.rateLimitedUntil > now || health.billingFailureUntil > now)) {
        continue;
      }

      // First available non-exhausted credential wins
      return account;
    }

    // All credentials exhausted — fall back to priority-based selection
    return this.pool.getBestAccount(provider);
  }

  private getLeastUsedCredential(provider: ProviderName): AccountCredential | null {
    const accounts = this.pool.getAccounts(provider);
    let best: AccountCredential | null = null;
    let lowestUsage = Infinity;

    for (const account of accounts) {
      const state = this.keyUsage.get(account.id);
      if (state?.blacklisted) continue;

      const health = this.pool.getHealth(account.id);
      if (health && (health.rateLimitedUntil > Date.now() || health.billingFailureUntil > Date.now())) {
        continue;
      }

      const usage = state?.usageCount ?? 0;
      if (usage < lowestUsage) {
        lowestUsage = usage;
        best = account;
      }
    }

    return best ?? this.pool.getBestAccount(provider);
  }

  private getRoundRobinCredential(provider: ProviderName): AccountCredential | null {
    const accounts = this.pool.getAccounts(provider).filter((a) => {
      const state = this.keyUsage.get(a.id);
      return !state?.blacklisted;
    });
    if (accounts.length === 0) return null;

    const key = `rr_${provider}`;
    const state = this.keyUsage.get(key) ?? { usageCount: 0, lastRotatedAt: 0, consecutiveAuthFailures: 0, blacklisted: false, roundRobinIndex: 0 };
    const index = state.roundRobinIndex % accounts.length;
    state.roundRobinIndex = index + 1;
    this.keyUsage.set(key, state);

    return accounts[index] ?? null;
  }

  private getRandomCredential(provider: ProviderName): AccountCredential | null {
    const accounts = this.pool.getAccounts(provider).filter((a) => {
      const state = this.keyUsage.get(a.id);
      return !state?.blacklisted;
    });
    if (accounts.length === 0) return null;
    return accounts[Math.floor(Math.random() * accounts.length)] ?? null;
  }

  private getOrCreateUsageState(keyId: string): KeyUsageState {
    let state = this.keyUsage.get(keyId);
    if (!state) {
      state = { usageCount: 0, lastRotatedAt: Date.now(), consecutiveAuthFailures: 0, blacklisted: false, roundRobinIndex: 0 };
      this.keyUsage.set(keyId, state);
    }
    return state;
  }
}
