import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimitManager } from "../../src/providers/rate-limiter.js";

describe("RateLimitManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks provider as rate limited", () => {
    const mgr = new RateLimitManager(["anthropic", "openai", "ollama"]);
    mgr.markRateLimited("anthropic", 60_000);

    expect(mgr.isRateLimited("anthropic")).toBe(true);
    expect(mgr.isRateLimited("openai")).toBe(false);
  });

  it("auto-resumes after wait period", () => {
    const mgr = new RateLimitManager(["anthropic", "openai"]);
    mgr.markRateLimited("anthropic", 1000);

    expect(mgr.isRateLimited("anthropic")).toBe(true);

    vi.advanceTimersByTime(1100);
    expect(mgr.isRateLimited("anthropic")).toBe(false);
  });

  it("finds fallback through full provider chain", () => {
    const mgr = new RateLimitManager(["anthropic", "openai", "ollama"]);
    mgr.markRateLimited("anthropic", 60_000);

    const fallback = mgr.findFallback("anthropic");
    // Should find the next non-limited provider
    expect(fallback).toBeDefined();
    expect(fallback).not.toBe("anthropic");
  });

  it("skips rate-limited providers in the chain", () => {
    const mgr = new RateLimitManager(["anthropic", "openai", "copilot", "ollama"]);
    mgr.markRateLimited("anthropic", 60_000);
    mgr.markRateLimited("openai", 60_000);

    const fallback = mgr.findFallback("anthropic");
    // Should skip anthropic and openai, land on copilot or ollama
    expect(fallback).toBeDefined();
    expect(["copilot", "ollama"]).toContain(fallback);
  });

  it("emits all-exhausted when every provider is rate-limited", () => {
    const mgr = new RateLimitManager(["anthropic", "openai"]);
    const events: unknown[] = [];
    mgr.onEvent((e) => events.push(e));

    mgr.markRateLimited("anthropic", 60_000);
    mgr.markRateLimited("openai", 60_000);

    mgr.findFallback("anthropic");

    const exhaustedEvent = events.find((e: any) => e.type === "all-exhausted");
    expect(exhaustedEvent).toBeDefined();
  });

  it("emits rate-limited event", () => {
    const mgr = new RateLimitManager(["anthropic"]);
    const events: unknown[] = [];
    mgr.onEvent((e) => events.push(e));

    mgr.markRateLimited("anthropic", 5000);

    expect(events).toHaveLength(1);
    expect((events[0] as any).type).toBe("rate-limited");
    expect((events[0] as any).provider).toBe("anthropic");
  });

  it("emits fallback event with target provider", () => {
    const mgr = new RateLimitManager(["anthropic", "openai"]);
    const events: unknown[] = [];
    mgr.onEvent((e) => events.push(e));

    mgr.markRateLimited("anthropic", 60_000);
    mgr.findFallback("anthropic");

    const fallbackEvent = events.find((e: any) => e.type === "fallback");
    expect(fallbackEvent).toBeDefined();
    expect((fallbackEvent as any).fallbackProvider).toBeDefined();
  });

  it("returns reset time for rate-limited provider", () => {
    const mgr = new RateLimitManager(["anthropic"]);
    mgr.markRateLimited("anthropic", 60_000);

    const resetTime = mgr.getResetTime("anthropic");
    expect(resetTime).toBeInstanceOf(Date);
    expect(resetTime!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null reset time for non-limited provider", () => {
    const mgr = new RateLimitManager(["anthropic"]);
    expect(mgr.getResetTime("anthropic")).toBeNull();
  });

  it("tracks rate-limited count", () => {
    const mgr = new RateLimitManager(["anthropic", "openai", "ollama"]);
    expect(mgr.getRateLimitedCount()).toBe(0);

    mgr.markRateLimited("anthropic", 60_000);
    expect(mgr.getRateLimitedCount()).toBe(1);

    mgr.markRateLimited("openai", 60_000);
    expect(mgr.getRateLimitedCount()).toBe(2);
  });

  it("detects when all providers are exhausted", () => {
    const mgr = new RateLimitManager(["anthropic", "openai"]);
    expect(mgr.isAllExhausted()).toBe(false);

    mgr.markRateLimited("anthropic", 60_000);
    expect(mgr.isAllExhausted()).toBe(false);

    mgr.markRateLimited("openai", 60_000);
    expect(mgr.isAllExhausted()).toBe(true);
  });

  it("free providers are the ultimate fallback", () => {
    // Simulate: all paid providers rate-limited, free still available
    const mgr = new RateLimitManager(["anthropic", "openai", "copilot", "ollama", "free"]);
    mgr.markRateLimited("anthropic", 60_000);
    mgr.markRateLimited("openai", 60_000);
    mgr.markRateLimited("copilot", 60_000);

    const fallback = mgr.findFallback("anthropic");
    // Should fall to ollama or free (the free tier)
    expect(["ollama", "free"]).toContain(fallback);
  });
});
