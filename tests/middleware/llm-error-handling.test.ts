import { describe, it, expect, beforeEach } from "vitest";
import {
  LLMErrorHandlingMiddleware,
  classifyLLMError,
  createLLMErrorHandlingMiddleware,
} from "../../src/middleware/llm-error-handling.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";

function makeCtx(): MiddlewareContext {
  return {
    sessionId: "session-1",
    userMessage: "test",
    recentHistory: [],
    workingDir: "/tmp/test",
  };
}

describe("classifyLLMError", () => {
  it("classifies 429 responses as retriable rate_limit", () => {
    const envelope = classifyLLMError({ status: 429, message: "Too many requests" });
    expect(envelope.category).toBe("rate_limit");
    expect(envelope.retriable).toBe(true);
  });

  it("classifies context-window overflow as non-retriable", () => {
    const envelope = classifyLLMError({ message: "maximum context length exceeded" });
    expect(envelope.category).toBe("context_exceeded");
    expect(envelope.retriable).toBe(false);
  });

  it("classifies 401 auth failures as non-retriable invalid_request", () => {
    const envelope = classifyLLMError({ status: 401, message: "unauthorized" });
    expect(envelope.category).toBe("invalid_request");
    expect(envelope.retriable).toBe(false);
  });

  it("classifies content-filter rejections as non-retriable content_filter", () => {
    const envelope = classifyLLMError({ message: "request violated content policy" });
    expect(envelope.category).toBe("content_filter");
    expect(envelope.retriable).toBe(false);
  });

  it("classifies 5xx responses as retriable server_error", () => {
    const envelope = classifyLLMError({ status: 503, message: "service unavailable" });
    expect(envelope.category).toBe("server_error");
    expect(envelope.retriable).toBe(true);
  });

  it("extracts Retry-After-Ms header when present", () => {
    const envelope = classifyLLMError({
      status: 429,
      headers: { "retry-after-ms": "2500" },
    });
    expect(envelope.retryAfterMs).toBe(2500);
  });

  it("extracts Retry-After header in seconds", () => {
    const envelope = classifyLLMError({
      status: 429,
      headers: { "retry-after": "3" },
    });
    expect(envelope.retryAfterMs).toBe(3000);
  });
});

describe("LLMErrorHandlingMiddleware", () => {
  let instance: LLMErrorHandlingMiddleware;

  beforeEach(() => {
    instance = new LLMErrorHandlingMiddleware({ maxRetries: 3, baseDelayMs: 100, capDelayMs: 1000 });
  });

  it("does not retry non-retriable categories", () => {
    const envelope = instance.classify({ status: 401, message: "unauthorized" });
    const delay = instance.shouldRetry(envelope, 0);
    expect(delay).toBeNull();
    expect(instance.getStats().totalGivenUp).toBe(1);
  });

  it("retries retriable categories up to maxRetries", () => {
    const envelope = instance.classify({ status: 503, message: "server error" });
    const first = instance.shouldRetry(envelope, 0);
    const second = instance.shouldRetry(envelope, 1);
    const third = instance.shouldRetry(envelope, 2);
    const fourth = instance.shouldRetry(envelope, 3);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    expect(fourth).toBeNull();
    expect(instance.getStats().totalRetries).toBe(3);
    expect(instance.getStats().totalGivenUp).toBe(1);
  });

  it("honors Retry-After when computing delay", () => {
    const envelope = instance.classify({
      status: 429,
      headers: { "retry-after-ms": "500" },
    });
    expect(instance.computeRetryDelayMs(1, envelope)).toBe(500);
  });

  it("caps exponential backoff at capDelayMs", () => {
    const envelope = instance.classify({ status: 503 });
    const delay = instance.computeRetryDelayMs(10, envelope);
    expect(delay).toBeLessThanOrEqual(1000);
  });

  it("builds human-readable messages per category", () => {
    expect(instance.buildUserMessage({ category: "rate_limit", retriable: true, message: "" })).toContain("rate-limited");
    expect(instance.buildUserMessage({ category: "context_exceeded", retriable: false, message: "" })).toContain("context");
    expect(instance.buildUserMessage({ category: "content_filter", retriable: false, message: "" })).toContain("content filter");
  });

  it("pipeline adapter rewrites failed result content and preserves followUp", () => {
    const middleware = createLLMErrorHandlingMiddleware(instance);
    const ctx = makeCtx();
    const result = middleware.after!(ctx, {
      content: "HTTP 429 Too many requests",
      success: false,
    });
    const awaited = result instanceof Promise ? null : result;
    expect(awaited).not.toBeNull();
    expect(awaited!.content).toContain("rate-limited");
    expect(awaited!.followUp).toContain("[LLMErrorHandling]");
    expect(middleware.name).toBe("LLMErrorHandling");
    expect(middleware.order).toBe(5.7);
  });
});
