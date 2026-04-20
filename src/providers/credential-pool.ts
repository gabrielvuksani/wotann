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

// ── Typed Exhaustion Error (Quality Bar #6: honest failure) ────────
/**
 * One rotation attempt's outcome. The `keyId` is an opaque id (NOT a
 * credential value); `statusCode` / `reason` describe why rotation
 * moved past that key. Callers rely on this for typed retry decisions.
 *
 * CRITICAL: The `keyId` must be an opaque handle, never a token, never
 * a secret. See rules/security.md — we never log credential values.
 */
export interface ExhaustionReason {
  readonly keyId: string;
  readonly reason: "rate_limit" | "billing" | "auth" | "blacklisted" | "unknown";
  readonly statusCode?: number;
  readonly at: number;
}

/**
 * Thrown by `requireCredential()` when no usable credential remains.
 * Callers should classify this as a permanent failure for the current
 * request (escalate to fallback chain or surface to user), not a retry.
 *
 * Follows Hermes `_exhausted_ttl()` semantics: exhaustion expires after
 * cooldown (429 = 1h, 402 = 24h), but the throw itself is fail-fast.
 */
export class CredentialPoolExhausted extends Error {
  readonly provider: ProviderName;
  readonly reasons: readonly ExhaustionReason[];
  readonly triedCount: number;

  constructor(provider: ProviderName, reasons: readonly ExhaustionReason[]) {
    // Build a safe summary: only counts, codes, and handles — never tokens.
    const codes = reasons.map((r) => r.statusCode ?? "n/a").join(",");
    const summary =
      reasons.length === 0
        ? `no credentials configured for provider=${provider}`
        : `${reasons.length} credential(s) exhausted for provider=${provider} (status codes: ${codes})`;
    super(summary);
    this.name = "CredentialPoolExhausted";
    this.provider = provider;
    this.reasons = reasons;
    this.triedCount = reasons.length;
  }
}

export interface MarkExhaustedOptions {
  readonly keyId: string;
  readonly provider: ProviderName;
  readonly statusCode?: number;
  readonly reason?: ExhaustionReason["reason"];
}

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
  // Active lease counts per credential id. Soft cap = 1 by default (Hermes
  // DEFAULT_MAX_CONCURRENT_PER_CREDENTIAL at line 362 of credential_pool.py).
  private readonly activeLeases: Map<string, number> = new Map();
  // Exhaustion history per provider — redacted to { keyId, statusCode, reason, at }.
  // Token values NEVER appear here. Bounded per provider to prevent memory growth.
  private readonly exhaustionHistory: Map<ProviderName, ExhaustionReason[]> = new Map();
  // Soft per-credential concurrency cap (Hermes default is 1).
  private readonly maxConcurrentPerCredential: number = 1;
  // Max exhaustion entries retained per provider for the typed error.
  private readonly maxExhaustionHistory: number = 32;
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
   * Like `getCredential()` but throws typed `CredentialPoolExhausted` instead
   * of returning null. Prefer this in call sites where a missing credential
   * is a terminal error (Quality Bar #6: honest failure, no silent fallback).
   */
  requireCredential(provider: ProviderName): AccountCredential {
    const cred = this.getCredential(provider);
    if (cred) return cred;
    const reasons = this.exhaustionHistory.get(provider) ?? [];
    throw new CredentialPoolExhausted(provider, [...reasons]);
  }

  /**
   * Atomically mark a credential exhausted and rotate to the next usable key.
   * Records the reason in bounded exhaustion history (NEVER the token) so a
   * subsequent `requireCredential()` can surface precise failure semantics.
   *
   * Status code mapping (follows Hermes `_exhausted_ttl` in credential_pool.py):
   *   429 -> 1h  cooldown (rate_limit)
   *   402 -> 24h cooldown (billing)
   *   401/403 -> 5m cooldown via existing auth-failure path (auth)
   *   other -> caller-supplied retryAfter or 5m default
   *
   * Returns the next credential or `null` when all are exhausted.
   */
  markExhaustedAndRotate(options: MarkExhaustedOptions): AccountCredential | null {
    const { keyId, provider, statusCode } = options;
    const reason = options.reason ?? this.classifyStatus(statusCode);

    // Record in AccountPool health with the right cooldown.
    if (statusCode === 402 || reason === "billing") {
      this.pool.recordBillingFailure(keyId);
    } else if (statusCode === 429 || reason === "rate_limit") {
      this.pool.recordRateLimit(keyId, COOLDOWN_429_MS);
    } else if (statusCode === 401 || statusCode === 403 || reason === "auth") {
      // Auth failures also blacklist after repeated occurrences (existing path).
      this.recordAuthFailure(keyId, provider);
    } else {
      this.pool.recordRateLimit(keyId, COOLDOWN_DEFAULT_MS);
    }

    // Append redacted history entry (tokens NEVER included here).
    this.recordExhaustion(provider, {
      keyId,
      reason,
      statusCode,
      at: Date.now(),
    });

    // Select next credential from pool (may be null when exhausted).
    return this.getCredential(provider);
  }

  /**
   * Acquire a soft lease on a credential. If no `credentialId` is given, picks
   * the least-leased available credential (preferring below-cap) and returns
   * it; lease count is incremented under the caller's logical ownership.
   *
   * Ported from Hermes `acquire_lease()` at credential_pool.py:890. The cap is
   * advisory — callers MUST pair each `acquireLease` with `releaseLease`, and
   * "all-at-cap" falls back to least-leased instead of blocking.
   */
  acquireLease(provider: ProviderName, credentialId?: string): AccountCredential | null {
    if (credentialId) {
      const existing = this.pool.getAccounts(provider).find((a) => a.id === credentialId);
      if (!existing) return null;
      this.activeLeases.set(credentialId, (this.activeLeases.get(credentialId) ?? 0) + 1);
      return existing;
    }

    const accounts = this.pool.getAccounts(provider).filter((a) => {
      const state = this.keyUsage.get(a.id);
      if (state?.blacklisted) return false;
      const h = this.pool.getHealth(a.id);
      if (h && (h.rateLimitedUntil > Date.now() || h.billingFailureUntil > Date.now())) {
        return false;
      }
      return true;
    });
    if (accounts.length === 0) return null;

    // Prefer below-cap; fall back to least-leased of all.
    const belowCap = accounts.filter(
      (a) => (this.activeLeases.get(a.id) ?? 0) < this.maxConcurrentPerCredential,
    );
    const candidates = belowCap.length > 0 ? belowCap : accounts;
    const chosen = candidates.reduce((best, a) => {
      const bestCount = this.activeLeases.get(best.id) ?? 0;
      const aCount = this.activeLeases.get(a.id) ?? 0;
      if (aCount < bestCount) return a;
      if (aCount === bestCount && a.priority < best.priority) return a;
      return best;
    });
    this.activeLeases.set(chosen.id, (this.activeLeases.get(chosen.id) ?? 0) + 1);
    return chosen;
  }

  /**
   * Release a previously acquired lease. Safe to call for unknown ids —
   * the method is a no-op in that case (matching Hermes's defensive pattern).
   */
  releaseLease(credentialId: string): void {
    const count = this.activeLeases.get(credentialId) ?? 0;
    if (count <= 1) {
      this.activeLeases.delete(credentialId);
    } else {
      this.activeLeases.set(credentialId, count - 1);
    }
  }

  /**
   * Inspect current lease count for a credential. Exposed for observability
   * and tests; callers should not rely on this for logic (use acquireLease
   * + releaseLease for correctness).
   */
  getLeaseCount(credentialId: string): number {
    return this.activeLeases.get(credentialId) ?? 0;
  }

  /**
   * Region-affinity selection: returns the first credential whose label
   * encodes `region:<name>` matching the requested region. Falls back to
   * the default rotation strategy when no regional match exists.
   *
   * Regional affinity is load-balancing via `label: "region:us-east-1"`
   * — callers stamp it at add-time. This mirrors the pattern used in
   * Hermes for Vertex/Bedrock regional pools.
   */
  getCredentialForRegion(provider: ProviderName, region: string): AccountCredential | null {
    const needle = `region:${region}`;
    const accounts = this.pool.getAccounts(provider);
    const now = Date.now();
    for (const account of accounts) {
      if (account.label !== needle) continue;
      const state = this.keyUsage.get(account.id);
      if (state?.blacklisted) continue;
      const health = this.pool.getHealth(account.id);
      if (health && (health.rateLimitedUntil > now || health.billingFailureUntil > now)) {
        continue;
      }
      return account;
    }
    // No regional match — fall back to rotation strategy.
    return this.getCredential(provider);
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
    const cooldown =
      statusCode === 429
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
      const token =
        dynamicState.cachedToken && dynamicState.credential.refreshToken
          ? await dynamicState.credential.refreshToken()
          : await dynamicState.credential.fetchToken();

      // Default expiry: 55 minutes (leave 5min buffer for typical 1hr tokens)
      const defaultExpiryMs = 55 * 60 * 1000;
      dynamicState.cachedToken = token;
      dynamicState.cachedExpiresAt =
        dynamicState.credential.expiresAt ?? Date.now() + defaultExpiryMs;

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
      if (
        health &&
        (health.rateLimitedUntil > Date.now() || health.billingFailureUntil > Date.now())
      ) {
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
    const state = this.keyUsage.get(key) ?? {
      usageCount: 0,
      lastRotatedAt: 0,
      consecutiveAuthFailures: 0,
      blacklisted: false,
      roundRobinIndex: 0,
    };
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
      state = {
        usageCount: 0,
        lastRotatedAt: Date.now(),
        consecutiveAuthFailures: 0,
        blacklisted: false,
        roundRobinIndex: 0,
      };
      this.keyUsage.set(keyId, state);
    }
    return state;
  }

  /**
   * Map HTTP status codes to exhaustion reasons. Follows the same taxonomy
   * hermes uses in `_exhausted_ttl()` / `mark_exhausted_and_rotate()`.
   */
  private classifyStatus(statusCode?: number): ExhaustionReason["reason"] {
    if (statusCode === 429) return "rate_limit";
    if (statusCode === 402) return "billing";
    if (statusCode === 401 || statusCode === 403) return "auth";
    return "unknown";
  }

  /**
   * Append a redacted exhaustion entry to per-provider history, trimming
   * oldest entries beyond `maxExhaustionHistory` to cap memory.
   *
   * The `keyId` is the opaque account id; NO token value ever reaches here.
   */
  private recordExhaustion(provider: ProviderName, reason: ExhaustionReason): void {
    const existing = this.exhaustionHistory.get(provider) ?? [];
    // Replace any prior entry for the same keyId so the most recent wins.
    const filtered = existing.filter((e) => e.keyId !== reason.keyId);
    filtered.push(reason);
    // Trim from the front if we exceed history cap.
    const trimmed =
      filtered.length > this.maxExhaustionHistory
        ? filtered.slice(filtered.length - this.maxExhaustionHistory)
        : filtered;
    this.exhaustionHistory.set(provider, trimmed);
  }
}
