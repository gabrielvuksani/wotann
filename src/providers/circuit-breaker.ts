/**
 * Circuit breaker for provider health.
 *
 * Prevents thundering-herd retries when a provider is down. Three
 * states:
 *   - CLOSED:    requests flow normally, failures tracked in rolling window
 *   - OPEN:      requests fail fast (no I/O), auto-transitions to HALF_OPEN
 *                after cooldown
 *   - HALF_OPEN: limited probe requests allowed; success → CLOSED;
 *                failure → OPEN
 *
 * Tripping rule: if failure rate ≥ threshold AND request count ≥ minimum
 * within the rolling window, open the circuit.
 *
 * This pairs with retry-strategies.ts: retries happen BEFORE hitting
 * the breaker; the breaker decides whether to attempt at all.
 */

// ── Types ──────────────────────────────────────────────

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerConfig {
  /** Failure rate (0-1) at which to trip. Default 0.5. */
  readonly failureThreshold?: number;
  /** Min requests in window before tripping is possible. Default 10. */
  readonly minRequests?: number;
  /** Rolling window duration in ms. Default 60_000. */
  readonly windowMs?: number;
  /** Cooldown in OPEN state before half-open probe. Default 30_000. */
  readonly openDurationMs?: number;
  /** Success count in half-open needed to close. Default 2. */
  readonly probeSuccessesRequired?: number;
  /** Inject time source. Default Date.now. */
  readonly now?: () => number;
}

export interface BreakerStats {
  readonly state: BreakerState;
  readonly requestCount: number;
  readonly failureCount: number;
  readonly successCount: number;
  readonly failureRate: number;
  readonly openedAt: number | null;
}

// ── Implementation ────────────────────────────────────

interface WindowEntry {
  readonly at: number;
  readonly success: boolean;
}

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private openedAt: number | null = null;
  private history: WindowEntry[] = [];
  private halfOpenSuccessCount = 0;
  private readonly config: Required<Omit<BreakerConfig, "now">> & { now: () => number };

  constructor(config: BreakerConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 0.5,
      minRequests: config.minRequests ?? 10,
      windowMs: config.windowMs ?? 60_000,
      openDurationMs: config.openDurationMs ?? 30_000,
      probeSuccessesRequired: config.probeSuccessesRequired ?? 2,
      now: config.now ?? (() => Date.now()),
    };
  }

  /**
   * Should we allow a request through? Also auto-transitions from
   * open → half-open when cooldown expires.
   */
  canRequest(): boolean {
    this.pruneHistory();
    const now = this.config.now();

    if (this.state === "open") {
      if (this.openedAt !== null && now - this.openedAt >= this.config.openDurationMs) {
        // Transition to half-open
        this.state = "half-open";
        this.halfOpenSuccessCount = 0;
        return true;
      }
      return false;
    }

    // closed or half-open → allow
    return true;
  }

  /** Record a successful request. */
  recordSuccess(): void {
    this.history.push({ at: this.config.now(), success: true });
    this.pruneHistory();

    if (this.state === "half-open") {
      this.halfOpenSuccessCount++;
      if (this.halfOpenSuccessCount >= this.config.probeSuccessesRequired) {
        // Recovery confirmed — close the circuit
        this.state = "closed";
        this.openedAt = null;
        this.halfOpenSuccessCount = 0;
        // Reset history to avoid old failures re-tripping immediately
        this.history = [];
      }
    }
  }

  /** Record a failed request. */
  recordFailure(): void {
    const now = this.config.now();
    this.history.push({ at: now, success: false });
    this.pruneHistory();

    if (this.state === "half-open") {
      // Single failure in half-open → reopen
      this.state = "open";
      this.openedAt = now;
      this.halfOpenSuccessCount = 0;
      return;
    }

    if (this.state === "closed") {
      // Check if we should trip
      const count = this.history.length;
      const failures = this.history.filter((e) => !e.success).length;
      if (count >= this.config.minRequests && failures / count >= this.config.failureThreshold) {
        this.state = "open";
        this.openedAt = now;
      }
    }
  }

  /** Manually reset to closed state (e.g. after deploying a fix). */
  reset(): void {
    this.state = "closed";
    this.openedAt = null;
    this.halfOpenSuccessCount = 0;
    this.history = [];
  }

  /** Current breaker state. */
  getState(): BreakerState {
    this.pruneHistory();
    return this.state;
  }

  stats(): BreakerStats {
    this.pruneHistory();
    const count = this.history.length;
    const failures = this.history.filter((e) => !e.success).length;
    const successes = count - failures;
    return {
      state: this.state,
      requestCount: count,
      failureCount: failures,
      successCount: successes,
      failureRate: count > 0 ? failures / count : 0,
      openedAt: this.openedAt,
    };
  }

  private pruneHistory(): void {
    const cutoff = this.config.now() - this.config.windowMs;
    this.history = this.history.filter((e) => e.at >= cutoff);
  }
}

// ── Runner wrapper ────────────────────────────────────

export async function withBreaker<T>(fn: () => Promise<T>, breaker: CircuitBreaker): Promise<T> {
  if (!breaker.canRequest()) {
    throw new Error("CircuitBreaker: circuit is OPEN — failing fast");
  }
  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure();
    throw err;
  }
}
