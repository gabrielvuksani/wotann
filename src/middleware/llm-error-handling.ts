/**
 * LLMErrorHandlingMiddleware — canonical provider-error envelope with
 * retry policy and circuit breaker.
 *
 * Ported from deer-flow (bytedance/deer-flow) Lane 2:
 *   packages/harness/deerflow/agents/middlewares/llm_error_handling_middleware.py
 *
 * WOTANN's provider-router retries at the transport layer but never
 * surfaces persistent provider failures as ToolMessages the agent can
 * observe. Without that, a 500 loop kills the graph; with it, the agent
 * sees the error on its next turn and can adapt.
 *
 * Canonical error categories (5):
 *   - rate_limit      — 429, `Retry-After` / backoff
 *   - context_exceeded — 413 / "context length"/"too many tokens"
 *   - invalid_request  — 400 auth / quota / schema errors (NOT retriable)
 *   - content_filter   — provider-side content policy rejection
 *   - server_error     — 5xx / transient network / timeouts
 *
 * Retry semantics:
 *   - rate_limit + server_error: retry up to `maxRetries` with exponential
 *     backoff (base 1000ms, cap 8000ms). Respects `Retry-After` when
 *     the error exposes it.
 *   - invalid_request + context_exceeded + content_filter: NOT retried —
 *     repeating the request will not succeed.
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// -- Canonical categories -------------------------------------------------

export type LLMErrorCategory =
  | "rate_limit"
  | "context_exceeded"
  | "invalid_request"
  | "content_filter"
  | "server_error"
  | "unknown";

export interface LLMErrorEnvelope {
  readonly category: LLMErrorCategory;
  readonly retriable: boolean;
  readonly message: string;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly provider?: string;
}

// -- Classification -------------------------------------------------------

const RATE_LIMIT_STATUS: ReadonlySet<number> = new Set([429]);
const SERVER_STATUS: ReadonlySet<number> = new Set([408, 409, 425, 500, 502, 503, 504]);

const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /rate.?limit/i,
  /too many requests/i,
  /quota exceeded.*retry/i,
  /overloaded/i,
];

const CONTEXT_PATTERNS: readonly RegExp[] = [
  /context (?:length|window).*exceed/i,
  /maximum context/i,
  /too many tokens/i,
  /token limit/i,
];

const INVALID_PATTERNS: readonly RegExp[] = [
  /invalid.?api.?key/i,
  /authentication/i,
  /unauthorized/i,
  /forbidden/i,
  /permission denied/i,
  /insufficient_quota/i,
  /billing/i,
  /payment/i,
];

const CONTENT_PATTERNS: readonly RegExp[] = [
  /content.?filter/i,
  /content policy/i,
  /safety system/i,
  /moderation/i,
];

const SERVER_PATTERNS: readonly RegExp[] = [
  /server busy/i,
  /temporarily unavailable/i,
  /try again later/i,
  /please retry/i,
  /high demand/i,
  /timeout/i,
];

interface ErrorLikeShape {
  readonly name?: string;
  readonly message?: string;
  readonly status?: number;
  readonly statusCode?: number;
  readonly code?: string | number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly response?: {
    readonly status?: number;
    readonly headers?: Readonly<Record<string, string>>;
  };
}

function asShape(err: unknown): ErrorLikeShape {
  if (err !== null && typeof err === "object") return err as ErrorLikeShape;
  return {};
}

function extractStatus(shape: ErrorLikeShape): number | undefined {
  if (typeof shape.status === "number") return shape.status;
  if (typeof shape.statusCode === "number") return shape.statusCode;
  if (shape.response && typeof shape.response.status === "number") return shape.response.status;
  return undefined;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  const shape = asShape(err);
  if (typeof shape.message === "string") return shape.message;
  return String(err);
}

function extractRetryAfterMs(shape: ErrorLikeShape): number | undefined {
  const headers = shape.headers ?? shape.response?.headers;
  if (!headers) return undefined;
  const raw =
    headers["retry-after-ms"] ??
    headers["Retry-After-Ms"] ??
    headers["retry-after"] ??
    headers["Retry-After"];
  if (!raw) return undefined;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    const multiplier =
      (headers["retry-after-ms"] ?? headers["Retry-After-Ms"]) !== undefined ? 1 : 1000;
    return Math.max(0, asNumber * multiplier);
  }
  const parsed = Date.parse(String(raw));
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, parsed - Date.now());
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/**
 * Classify an arbitrary provider error into one of the 5 canonical
 * categories. Always returns — never throws.
 */
export function classifyLLMError(err: unknown, provider?: string): LLMErrorEnvelope {
  const shape = asShape(err);
  const message = extractMessage(err);
  const status = extractStatus(shape);
  const retryAfterMs = extractRetryAfterMs(shape);

  // Rate limit — status OR message
  if (
    (status !== undefined && RATE_LIMIT_STATUS.has(status)) ||
    matchesAny(message, RATE_LIMIT_PATTERNS)
  ) {
    return {
      category: "rate_limit",
      retriable: true,
      message,
      httpStatus: status,
      retryAfterMs,
      provider,
    };
  }

  // Context window exceeded — NOT retriable (retry won't succeed)
  if (status === 413 || matchesAny(message, CONTEXT_PATTERNS)) {
    return {
      category: "context_exceeded",
      retriable: false,
      message,
      httpStatus: status,
      provider,
    };
  }

  // Invalid request — auth / billing / schema. NOT retriable.
  if (
    (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) ||
    matchesAny(message, INVALID_PATTERNS)
  ) {
    return {
      category: "invalid_request",
      retriable: false,
      message,
      httpStatus: status,
      provider,
    };
  }

  // Content filter — NOT retriable.
  if (matchesAny(message, CONTENT_PATTERNS)) {
    return {
      category: "content_filter",
      retriable: false,
      message,
      httpStatus: status,
      provider,
    };
  }

  // Server / transient — retriable.
  if (
    (status !== undefined && SERVER_STATUS.has(status)) ||
    matchesAny(message, SERVER_PATTERNS) ||
    (typeof shape.name === "string" &&
      ["APITimeoutError", "APIConnectionError", "InternalServerError"].includes(shape.name))
  ) {
    return {
      category: "server_error",
      retriable: true,
      message,
      httpStatus: status,
      retryAfterMs,
      provider,
    };
  }

  return {
    category: "unknown",
    retriable: false,
    message,
    httpStatus: status,
    provider,
  };
}

// -- Middleware instance --------------------------------------------------

export interface LLMErrorOptions {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly capDelayMs?: number;
}

export interface LLMErrorStats {
  readonly totalClassified: number;
  readonly totalRetries: number;
  readonly totalGivenUp: number;
  readonly perCategory: Readonly<Record<LLMErrorCategory, number>>;
}

const EMPTY_CATEGORY_MAP: Record<LLMErrorCategory, number> = {
  rate_limit: 0,
  context_exceeded: 0,
  invalid_request: 0,
  content_filter: 0,
  server_error: 0,
  unknown: 0,
};

/**
 * LLMErrorHandlingMiddleware normalizes provider failures and decides
 * whether to retry. Per-session state (stats, retry counters) lives on
 * the instance — no module globals.
 */
export class LLMErrorHandlingMiddleware {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly capDelayMs: number;

  private totalClassified = 0;
  private totalRetries = 0;
  private totalGivenUp = 0;
  private perCategory: Record<LLMErrorCategory, number> = { ...EMPTY_CATEGORY_MAP };

  constructor(options: LLMErrorOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.capDelayMs = options.capDelayMs ?? 8000;
  }

  /**
   * Compute the delay before retry attempt `attempt` (1-indexed). Honors
   * `retryAfterMs` on the envelope when present, else exponential backoff
   * capped at `capDelayMs`.
   */
  computeRetryDelayMs(attempt: number, envelope: LLMErrorEnvelope): number {
    if (envelope.retryAfterMs !== undefined && envelope.retryAfterMs >= 0) {
      return Math.min(envelope.retryAfterMs, this.capDelayMs);
    }
    const exp = this.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(exp, this.capDelayMs);
  }

  /**
   * Classify an error and return the envelope, tracking stats.
   */
  classify(err: unknown, provider?: string): LLMErrorEnvelope {
    const envelope = classifyLLMError(err, provider);
    this.totalClassified++;
    this.perCategory = {
      ...this.perCategory,
      [envelope.category]: this.perCategory[envelope.category] + 1,
    };
    return envelope;
  }

  /**
   * Decide whether a retry should be attempted for the given error and
   * attempt count. Returns the delay to wait (ms) if retriable, or null
   * if the caller should give up.
   */
  shouldRetry(envelope: LLMErrorEnvelope, attempt: number): number | null {
    if (!envelope.retriable) {
      this.totalGivenUp++;
      return null;
    }
    if (attempt >= this.maxRetries) {
      this.totalGivenUp++;
      return null;
    }
    this.totalRetries++;
    return this.computeRetryDelayMs(attempt + 1, envelope);
  }

  /**
   * Produce a user-facing message for the agent's next turn, describing
   * the error in a way the agent can reason about.
   */
  buildUserMessage(envelope: LLMErrorEnvelope): string {
    switch (envelope.category) {
      case "rate_limit":
        return "The configured LLM provider is rate-limited. Retry after a short wait.";
      case "context_exceeded":
        return "The request exceeded the model's context window. Summarize or truncate history and retry.";
      case "invalid_request":
        return `The LLM request was rejected (invalid_request): ${envelope.message}. This error will not be fixed by retry; check credentials / quota / request shape.`;
      case "content_filter":
        return "The provider's content filter rejected the request. Rephrase and avoid policy-violating content.";
      case "server_error":
        return "The provider is temporarily unavailable after multiple retries. Wait a moment and continue.";
      default:
        return `LLM request failed: ${envelope.message}`;
    }
  }

  getStats(): LLMErrorStats {
    return {
      totalClassified: this.totalClassified,
      totalRetries: this.totalRetries,
      totalGivenUp: this.totalGivenUp,
      perCategory: { ...this.perCategory },
    };
  }

  reset(): void {
    this.totalClassified = 0;
    this.totalRetries = 0;
    this.totalGivenUp = 0;
    this.perCategory = { ...EMPTY_CATEGORY_MAP };
  }
}

// -- Pipeline adapter -----------------------------------------------------

/**
 * Create a Middleware adapter. Operates in the `after` phase: if the
 * AgentResult carries an error flag (`success === false`) and the content
 * looks like a raw provider error string, classify it and rewrite the
 * follow-up with a canonical message the agent can reason about.
 */
export function createLLMErrorHandlingMiddleware(instance: LLMErrorHandlingMiddleware): Middleware {
  return {
    name: "LLMErrorHandling",
    order: 5.7,
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      if (result.success) return result;
      if (!result.content) return result;

      // Treat the content as an error string; classify it.
      const envelope = instance.classify(result.content);

      const normalizedContent = instance.buildUserMessage(envelope);
      const traceNote = `[LLMErrorHandling] category=${envelope.category} retriable=${envelope.retriable}${
        envelope.httpStatus !== undefined ? ` status=${envelope.httpStatus}` : ""
      }`;

      return {
        ...result,
        content: normalizedContent,
        followUp: result.followUp ? `${result.followUp}\n${traceNote}` : traceNote,
      };
    },
  };
}
