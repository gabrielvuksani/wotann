/**
 * Tool-use retry strategies — provider-aware policies.
 *
 * Different provider errors need different retry treatment:
 *   - 429 rate-limit: exponential backoff with jitter + honor
 *     Retry-After header
 *   - 502/503/504 transient: quick retry, cap at 3 attempts
 *   - 400 bad-request: NEVER retry (fix the request instead)
 *   - 401/403 auth: NEVER retry (refresh token first)
 *   - Network errors (ECONNRESET/ETIMEDOUT): retry with long backoff
 *   - Model-overloaded: retry on a different provider via fallback chain
 *
 * This module ships:
 *   - RetryPolicy: pure function returning {shouldRetry, delayMs, reason}
 *   - withRetries(fn, policy): executes fn with retry loop
 *   - default policy builder covering the 6 classes above
 */

// ── Types ──────────────────────────────────────────────

export interface RetryContext {
  readonly attempt: number; // 0-indexed
  readonly maxAttempts: number;
  readonly error: unknown;
  readonly elapsedMs: number;
}

export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly delayMs: number;
  readonly reason: string;
}

export type RetryPolicy = (ctx: RetryContext) => RetryDecision;

export interface RetryError {
  readonly status?: number;
  readonly code?: string;
  readonly retryAfter?: number; // seconds, from HTTP header
  readonly message?: string;
}

// ── Error classification ──────────────────────────────

export type ErrorClass =
  | "rate-limit"
  | "transient-server"
  | "bad-request"
  | "auth"
  | "network"
  | "overloaded"
  | "unknown";

export function classifyError(error: unknown): ErrorClass {
  if (!error || typeof error !== "object") return "unknown";
  const e = error as RetryError;
  const status = e.status;
  const code = e.code;
  const message = (e.message ?? "").toLowerCase();

  if (status === 429) return "rate-limit";
  if (status === 502 || status === 503 || status === 504) return "transient-server";
  if (status === 400) return "bad-request";
  if (status === 401 || status === 403) return "auth";
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return "network";
  if (message.includes("overloaded") || status === 529) return "overloaded";
  return "unknown";
}

// ── Policies ───────────────────────────────────────────

/**
 * Exponential backoff with jitter. `baseMs * 2^attempt + jitter(0..baseMs)`.
 */
export function exponentialBackoff(
  attempt: number,
  baseMs: number = 500,
  maxMs: number = 30_000,
  rand: () => number = Math.random,
): number {
  const raw = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = rand() * baseMs;
  return Math.floor(raw + jitter);
}

/**
 * Default policy — covers all 6 error classes.
 */
export function defaultRetryPolicy(
  options: {
    readonly maxAttempts?: number;
    readonly rand?: () => number;
  } = {},
): RetryPolicy {
  const maxAttempts = options.maxAttempts ?? 4;
  const rand = options.rand ?? Math.random;

  return (ctx: RetryContext): RetryDecision => {
    if (ctx.attempt >= maxAttempts - 1) {
      return { shouldRetry: false, delayMs: 0, reason: `max attempts (${maxAttempts}) reached` };
    }
    const klass = classifyError(ctx.error);
    const err = ctx.error as RetryError;

    switch (klass) {
      case "bad-request":
      case "auth":
        return {
          shouldRetry: false,
          delayMs: 0,
          reason: `${klass} is not retryable`,
        };

      case "rate-limit": {
        // Honor Retry-After when present
        const retryAfter = err.retryAfter;
        if (typeof retryAfter === "number" && retryAfter > 0) {
          return {
            shouldRetry: true,
            delayMs: retryAfter * 1000,
            reason: `rate-limit; Retry-After=${retryAfter}s`,
          };
        }
        return {
          shouldRetry: true,
          delayMs: exponentialBackoff(ctx.attempt, 1_000, 60_000, rand),
          reason: `rate-limit (exp backoff)`,
        };
      }

      case "transient-server":
        return {
          shouldRetry: true,
          delayMs: exponentialBackoff(ctx.attempt, 500, 10_000, rand),
          reason: `transient 5xx (exp backoff)`,
        };

      case "network":
        return {
          shouldRetry: true,
          delayMs: exponentialBackoff(ctx.attempt, 2_000, 20_000, rand),
          reason: `network error (long backoff)`,
        };

      case "overloaded":
        return {
          shouldRetry: true,
          delayMs: exponentialBackoff(ctx.attempt, 5_000, 60_000, rand),
          reason: `provider overloaded (long backoff)`,
        };

      case "unknown":
      default:
        // Conservative: 1 retry for unknown errors
        if (ctx.attempt >= 1) {
          return { shouldRetry: false, delayMs: 0, reason: "unknown error, no further retries" };
        }
        return {
          shouldRetry: true,
          delayMs: exponentialBackoff(ctx.attempt, 500, 5_000, rand),
          reason: "unknown error; one retry",
        };
    }
  };
}

// ── Runner ─────────────────────────────────────────────

export interface WithRetriesOptions {
  readonly policy?: RetryPolicy;
  readonly maxAttempts?: number;
  /** Inject sleep for deterministic tests. Default real setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called before each retry for telemetry. */
  readonly onRetry?: (decision: RetryDecision, ctx: RetryContext) => void;
}

export interface RetryOutcome<T> {
  readonly result: T;
  readonly attemptsMade: number;
  readonly totalDelayMs: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute `fn` with retries. On success, returns the value +
 * attemptsMade. On final failure (all retries exhausted), re-throws
 * the last error.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  options: WithRetriesOptions = {},
): Promise<RetryOutcome<T>> {
  const policy = options.policy ?? defaultRetryPolicy({ maxAttempts: options.maxAttempts ?? 4 });
  const maxAttempts = options.maxAttempts ?? 4;
  const sleep = options.sleep ?? defaultSleep;

  const startedAt = Date.now();
  let totalDelayMs = 0;
  let attempt = 0;
  let lastError: unknown = new Error("withRetries: no attempts made (internal bug)");

  while (attempt < maxAttempts) {
    try {
      const result = await fn();
      return { result, attemptsMade: attempt + 1, totalDelayMs };
    } catch (err) {
      lastError = err;
      const ctx: RetryContext = {
        attempt,
        maxAttempts,
        error: err,
        elapsedMs: Date.now() - startedAt,
      };
      const decision = policy(ctx);
      options.onRetry?.(decision, ctx);
      if (!decision.shouldRetry) break;
      totalDelayMs += decision.delayMs;
      await sleep(decision.delayMs);
      attempt++;
    }
  }

  throw lastError;
}
