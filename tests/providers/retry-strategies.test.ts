import { describe, it, expect, vi } from "vitest";
import {
  classifyError,
  exponentialBackoff,
  defaultRetryPolicy,
  withRetries,
} from "../../src/providers/retry-strategies.js";

describe("classifyError", () => {
  it("429 → rate-limit", () => {
    expect(classifyError({ status: 429 })).toBe("rate-limit");
  });

  it("502/503/504 → transient-server", () => {
    expect(classifyError({ status: 502 })).toBe("transient-server");
    expect(classifyError({ status: 503 })).toBe("transient-server");
    expect(classifyError({ status: 504 })).toBe("transient-server");
  });

  it("400 → bad-request", () => {
    expect(classifyError({ status: 400 })).toBe("bad-request");
  });

  it("401/403 → auth", () => {
    expect(classifyError({ status: 401 })).toBe("auth");
    expect(classifyError({ status: 403 })).toBe("auth");
  });

  it("ECONNRESET → network", () => {
    expect(classifyError({ code: "ECONNRESET" })).toBe("network");
  });

  it("message 'overloaded' → overloaded", () => {
    expect(classifyError({ message: "Model is overloaded" })).toBe("overloaded");
  });

  it("unknown errors → unknown", () => {
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError({})).toBe("unknown");
    expect(classifyError({ status: 418 })).toBe("unknown");
  });
});

describe("exponentialBackoff", () => {
  it("grows exponentially", () => {
    const rand = () => 0; // no jitter
    expect(exponentialBackoff(0, 100, 10_000, rand)).toBe(100);
    expect(exponentialBackoff(1, 100, 10_000, rand)).toBe(200);
    expect(exponentialBackoff(2, 100, 10_000, rand)).toBe(400);
    expect(exponentialBackoff(3, 100, 10_000, rand)).toBe(800);
  });

  it("caps at maxMs", () => {
    const rand = () => 0;
    expect(exponentialBackoff(20, 100, 5_000, rand)).toBeLessThanOrEqual(5_000 + 100);
  });

  it("adds jitter (0..baseMs)", () => {
    const rand = () => 0.5;
    const withJitter = exponentialBackoff(0, 100, 10_000, rand);
    expect(withJitter).toBeGreaterThanOrEqual(100);
    expect(withJitter).toBeLessThanOrEqual(200);
  });
});

describe("defaultRetryPolicy", () => {
  const policy = defaultRetryPolicy({ maxAttempts: 4, rand: () => 0 });

  it("does not retry bad-request", () => {
    const d = policy({
      attempt: 0,
      maxAttempts: 4,
      error: { status: 400 },
      elapsedMs: 0,
    });
    expect(d.shouldRetry).toBe(false);
  });

  it("does not retry auth", () => {
    const d = policy({
      attempt: 0,
      maxAttempts: 4,
      error: { status: 401 },
      elapsedMs: 0,
    });
    expect(d.shouldRetry).toBe(false);
  });

  it("retries 429 with Retry-After honored", () => {
    const d = policy({
      attempt: 0,
      maxAttempts: 4,
      error: { status: 429, retryAfter: 5 },
      elapsedMs: 0,
    });
    expect(d.shouldRetry).toBe(true);
    expect(d.delayMs).toBe(5000);
  });

  it("retries 429 without Retry-After via exp backoff", () => {
    const d = policy({
      attempt: 1,
      maxAttempts: 4,
      error: { status: 429 },
      elapsedMs: 0,
    });
    expect(d.shouldRetry).toBe(true);
    expect(d.delayMs).toBeGreaterThan(0);
  });

  it("retries 503 with shorter backoff than 429", () => {
    const d429 = policy({ attempt: 0, maxAttempts: 4, error: { status: 429 }, elapsedMs: 0 });
    const d503 = policy({ attempt: 0, maxAttempts: 4, error: { status: 503 }, elapsedMs: 0 });
    expect(d503.delayMs).toBeLessThan(d429.delayMs);
  });

  it("retries network errors with longer backoff", () => {
    const d = policy({
      attempt: 0,
      maxAttempts: 4,
      error: { code: "ECONNRESET" },
      elapsedMs: 0,
    });
    expect(d.shouldRetry).toBe(true);
    expect(d.delayMs).toBeGreaterThanOrEqual(2_000);
  });

  it("does not retry on max attempts", () => {
    const d = policy({
      attempt: 3,
      maxAttempts: 4,
      error: { status: 503 },
      elapsedMs: 0,
    });
    expect(d.shouldRetry).toBe(false);
    expect(d.reason).toContain("max attempts");
  });

  it("only 1 retry for unknown errors", () => {
    const dFirst = policy({
      attempt: 0,
      maxAttempts: 4,
      error: new Error("mystery"),
      elapsedMs: 0,
    });
    expect(dFirst.shouldRetry).toBe(true);

    const dSecond = policy({
      attempt: 1,
      maxAttempts: 4,
      error: new Error("mystery"),
      elapsedMs: 0,
    });
    expect(dSecond.shouldRetry).toBe(false);
  });
});

describe("withRetries", () => {
  it("returns first successful result", async () => {
    const fn = vi.fn(async () => "ok");
    const outcome = await withRetries(fn, { maxAttempts: 3 });
    expect(outcome.result).toBe("ok");
    expect(outcome.attemptsMade).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient errors", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) {
        const err = new Error("transient") as Error & { status?: number };
        err.status = 503;
        throw err;
      }
      return "ok";
    };
    const outcome = await withRetries(fn, {
      maxAttempts: 4,
      sleep: async () => {},
    });
    expect(outcome.result).toBe("ok");
    expect(outcome.attemptsMade).toBe(3);
  });

  it("re-throws non-retryable errors immediately", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error("nope") as Error & { status?: number };
      err.status = 400;
      throw err;
    };
    await expect(withRetries(fn, { sleep: async () => {} })).rejects.toThrow("nope");
    expect(calls).toBe(1);
  });

  it("re-throws after max attempts", async () => {
    const fn = async () => {
      const err = new Error("still failing") as Error & { status?: number };
      err.status = 503;
      throw err;
    };
    await expect(
      withRetries(fn, { maxAttempts: 3, sleep: async () => {} }),
    ).rejects.toThrow("still failing");
  });

  it("calls onRetry callback", async () => {
    const onRetry = vi.fn();
    const fn = async () => {
      const err = new Error("x") as Error & { status?: number };
      err.status = 503;
      throw err;
    };
    await expect(
      withRetries(fn, { maxAttempts: 3, sleep: async () => {}, onRetry }),
    ).rejects.toThrow();
    // onRetry called once per retry decision (including the final "don't retry")
    expect(onRetry).toHaveBeenCalled();
  });

  it("tracks totalDelayMs", async () => {
    let delays = 0;
    const fn = async () => {
      delays++;
      if (delays < 2) {
        const err = new Error("x") as Error & { status?: number };
        err.status = 503;
        throw err;
      }
      return "ok";
    };
    const outcome = await withRetries(fn, {
      maxAttempts: 3,
      sleep: async () => {},
    });
    expect(outcome.totalDelayMs).toBeGreaterThan(0);
  });
});
