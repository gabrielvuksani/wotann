/**
 * Rate Limit Auto-Resume (DX20) — oh-my-claudecode inspired.
 *
 * When a rate limit is hit:
 * 1. Save full execution state (prompt, tool calls, conversation)
 * 2. Try fallback provider if available
 * 3. If no fallback, wait for reset with exponential backoff
 * 4. Auto-resume from saved state
 *
 * Features:
 * - Provider fallback chain (e.g., openai -> anthropic -> groq)
 * - Execution state serialization/deserialization
 * - Exponential backoff with jitter for retry timing
 * - Resume history for diagnostics
 */

// ── Types ────────────────────────────────────────────────

export interface RateLimitState {
  readonly provider: string;
  readonly hitAt: number;
  readonly resetsAt: number;
  readonly retryAfterMs: number;
  readonly retryCount: number;
  readonly executionState: ExecutionSnapshot;
}

export interface ExecutionSnapshot {
  readonly sessionId: string;
  readonly lastPrompt: string;
  readonly pendingToolCalls: readonly string[];
  readonly conversationLength: number;
  readonly timestamp: number;
  readonly providerModel?: string;
  readonly contextTokens?: number;
}

export interface ResumeResult {
  readonly resumed: boolean;
  readonly waitedMs: number;
  readonly provider: string;
  readonly fallbackProvider?: string;
  readonly retryCount: number;
  readonly error?: string;
}

export interface RateLimitResumeConfig {
  readonly maxRetries: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly fallbackChain: readonly string[];
  readonly enableFallback: boolean;
}

// ── Constants ────────────────────────────────────────────

const DEFAULT_CONFIG: RateLimitResumeConfig = {
  maxRetries: 5,
  baseBackoffMs: 1_000,
  maxBackoffMs: 120_000,
  fallbackChain: [],
  enableFallback: true,
};

// ── Rate Limit Manager ───────────────────────────────────

export class RateLimitResumeManager {
  private readonly pendingResumes: Map<string, RateLimitState> = new Map();
  private readonly history: ResumeResult[] = [];
  private readonly config: RateLimitResumeConfig;

  constructor(config?: Partial<RateLimitResumeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a rate limit hit and schedule auto-resume.
   */
  onRateLimit(
    provider: string,
    retryAfterMs: number,
    snapshot: ExecutionSnapshot,
  ): RateLimitState {
    const existing = this.pendingResumes.get(provider);
    const retryCount = existing ? existing.retryCount + 1 : 0;

    const state: RateLimitState = {
      provider,
      hitAt: Date.now(),
      resetsAt: Date.now() + retryAfterMs,
      retryAfterMs,
      retryCount,
      executionState: snapshot,
    };

    this.pendingResumes.set(provider, state);
    return state;
  }

  /**
   * Attempt to resume: try fallback provider first, then wait and retry.
   * Returns the result including which provider was used.
   */
  async waitAndResume(provider: string): Promise<ResumeResult> {
    const state = this.pendingResumes.get(provider);
    if (!state) {
      return {
        resumed: false, waitedMs: 0, provider,
        retryCount: 0, error: "No pending rate limit for this provider",
      };
    }

    // Check retry limit
    if (state.retryCount >= this.config.maxRetries) {
      this.pendingResumes.delete(provider);
      const result: ResumeResult = {
        resumed: false, waitedMs: 0, provider,
        retryCount: state.retryCount,
        error: `Max retries (${this.config.maxRetries}) exceeded for ${provider}`,
      };
      this.history.push(result);
      return result;
    }

    // Try fallback provider if configured
    if (this.config.enableFallback && this.config.fallbackChain.length > 0) {
      const fallback = this.findAvailableFallback(provider);
      if (fallback) {
        this.pendingResumes.delete(provider);
        const result: ResumeResult = {
          resumed: true, waitedMs: 0, provider,
          fallbackProvider: fallback,
          retryCount: state.retryCount,
        };
        this.history.push(result);
        return result;
      }
    }

    // Wait with exponential backoff + jitter
    const backoffMs = computeBackoff(
      state.retryCount,
      this.config.baseBackoffMs,
      this.config.maxBackoffMs,
    );
    const waitMs = Math.max(backoffMs, state.resetsAt - Date.now());
    const actualWait = Math.max(0, waitMs);

    if (actualWait > 0) {
      await new Promise((resolve) => setTimeout(resolve, actualWait));
    }

    this.pendingResumes.delete(provider);

    const result: ResumeResult = {
      resumed: true,
      waitedMs: actualWait,
      provider,
      retryCount: state.retryCount,
    };

    this.history.push(result);
    return result;
  }

  /**
   * Check if a provider is currently rate-limited.
   */
  isRateLimited(provider: string): boolean {
    const state = this.pendingResumes.get(provider);
    if (!state) return false;
    return Date.now() < state.resetsAt;
  }

  /**
   * Get time until rate limit resets for a provider.
   */
  getTimeUntilReset(provider: string): number {
    const state = this.pendingResumes.get(provider);
    if (!state) return 0;
    return Math.max(0, state.resetsAt - Date.now());
  }

  /**
   * Get the saved execution state for resuming.
   */
  getSnapshot(provider: string): ExecutionSnapshot | null {
    return this.pendingResumes.get(provider)?.executionState ?? null;
  }

  /**
   * Serialize execution state to a JSON string for persistence.
   */
  serializeState(provider: string): string | null {
    const state = this.pendingResumes.get(provider);
    if (!state) return null;
    return JSON.stringify(state);
  }

  /**
   * Restore state from a serialized JSON string.
   */
  deserializeState(json: string): RateLimitState {
    const parsed = JSON.parse(json) as RateLimitState;
    this.pendingResumes.set(parsed.provider, parsed);
    return parsed;
  }

  /**
   * Get resume history.
   */
  getHistory(): readonly ResumeResult[] {
    return [...this.history];
  }

  /**
   * Get all currently rate-limited providers.
   */
  getRateLimitedProviders(): readonly string[] {
    const now = Date.now();
    return [...this.pendingResumes.entries()]
      .filter(([, state]) => now < state.resetsAt)
      .map(([provider]) => provider);
  }

  /**
   * Clear all pending rate limits.
   */
  clear(): void {
    this.pendingResumes.clear();
  }

  // ── Private ────────────────────────────────────────────

  /**
   * Find the first available fallback provider that is not rate-limited.
   */
  private findAvailableFallback(excludeProvider: string): string | undefined {
    return this.config.fallbackChain.find(
      (p) => p !== excludeProvider && !this.isRateLimited(p),
    );
  }
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Compute exponential backoff with jitter.
 * Formula: min(maxBackoff, baseBackoff * 2^retryCount) + random jitter
 */
function computeBackoff(
  retryCount: number,
  baseMs: number,
  maxMs: number,
): number {
  const exponential = baseMs * Math.pow(2, retryCount);
  const capped = Math.min(exponential, maxMs);
  // Add 0-25% jitter to prevent thundering herd
  const jitter = capped * Math.random() * 0.25;
  return Math.floor(capped + jitter);
}
