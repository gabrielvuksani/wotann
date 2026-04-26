/**
 * Integration test: end-to-end provider fallback chain.
 * Verifies the complete flow: AgentBridge → RateLimiter → FallbackChain → Provider.
 *
 * INVARIANT: The model is NEVER degraded. Only the provider changes.
 * Free tier is always the ultimate fallback.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { RateLimitManager } from "../../src/providers/rate-limiter.js";
import { buildFallbackChain, resolveNextProvider } from "../../src/providers/fallback-chain.js";
import type { ProviderName } from "../../src/core/types.js";

describe("Integration: End-to-End Provider Fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cascades through all providers: anthropic → openai → copilot → ollama → free", () => {
    const allProviders = new Set<ProviderName>([
      "anthropic", "openai", "copilot", "ollama", "free",
    ]);
    const mgr = new RateLimitManager(["anthropic", "openai", "copilot", "ollama", "free"]);

    // Rate-limit providers one by one and verify the chain holds
    const fallbacks: ProviderName[] = [];

    // Step 1: Anthropic hits limit → falls to openai
    mgr.markRateLimited("anthropic", 60_000);
    const chain1 = buildFallbackChain("anthropic", allProviders, (p) => mgr.isRateLimited(p));
    const next1 = resolveNextProvider(chain1);
    expect(next1).toBe("openai");
    fallbacks.push(next1!);

    // Step 2: OpenAI also hits limit → falls to copilot
    mgr.markRateLimited("openai", 60_000);
    const chain2 = buildFallbackChain("anthropic", allProviders, (p) => mgr.isRateLimited(p));
    const next2 = resolveNextProvider(chain2);
    expect(next2).toBe("copilot");
    fallbacks.push(next2!);

    // Step 3: Copilot also hits limit → falls to ollama (free tier)
    mgr.markRateLimited("copilot", 60_000);
    const chain3 = buildFallbackChain("anthropic", allProviders, (p) => mgr.isRateLimited(p));
    const next3 = resolveNextProvider(chain3);
    expect(next3).toBe("ollama");
    fallbacks.push(next3!);

    // Step 4: Even ollama rate-limited → falls to free community APIs
    mgr.markRateLimited("ollama", 60_000);
    const chain4 = buildFallbackChain("anthropic", allProviders, (p) => mgr.isRateLimited(p));
    const next4 = resolveNextProvider(chain4);
    expect(next4).toBe("free");
    fallbacks.push(next4!);

    // Verify the complete cascade order
    expect(fallbacks).toEqual(["openai", "copilot", "ollama", "free"]);
  });

  it("free-tier user: ollama → free community → (always has something)", () => {
    // User ran `wotann init --free` — only has ollama and free endpoints
    const freeOnly = new Set<ProviderName>(["ollama", "free"]);
    const mgr = new RateLimitManager(["ollama", "free"]);

    // Ollama is primary for free-tier users
    const chain = buildFallbackChain("ollama", freeOnly, (p) => mgr.isRateLimited(p));
    expect(chain[0]!.provider).toBe("ollama");

    // When ollama is busy, falls to free community
    mgr.markRateLimited("ollama", 60_000);
    const chain2 = buildFallbackChain("ollama", freeOnly, (p) => mgr.isRateLimited(p));
    const next = resolveNextProvider(chain2);
    expect(next).toBe("free");
  });

  it("fallback chain routes past a rate-limited provider without scrubbing it from the chain", () => {
    // Previously this test asserted `const userRequestedModel === "claude-opus-4-7"`
    // — a tautology against a locally-declared value. The real invariants are:
    //   1. When `anthropic` is rate-limited, the next-available provider is `openai`.
    //   2. `anthropic` is STILL in the chain but marked `rateLimited: true` — rate
    //      limits are transient, so we don't permanently scrub the provider.
    //   3. Every provider from the set appears exactly once in the chain.
    const allProviders = new Set<ProviderName>(["anthropic", "openai", "ollama"]);
    const mgr = new RateLimitManager(["anthropic", "openai", "ollama"]);

    mgr.markRateLimited("anthropic", 60_000);
    const chain = buildFallbackChain("anthropic", allProviders, (p) => mgr.isRateLimited(p));
    const fallbackProvider = resolveNextProvider(chain);

    expect(fallbackProvider).toBe("openai");
    const providerNames = chain.map((e) => e.provider);
    expect(providerNames).toContain("anthropic");
    const anthropicEntry = chain.find((e) => e.provider === "anthropic");
    expect(anthropicEntry?.rateLimited).toBe(true);
    expect(new Set(providerNames).size).toBe(chain.length);
    expect(new Set(providerNames)).toEqual(allProviders);
  });

  it("RateLimitManager.isAllExhausted correctly tracks total exhaustion", () => {
    vi.useFakeTimers();
    const mgr = new RateLimitManager(["anthropic", "openai", "ollama"]);

    expect(mgr.isAllExhausted()).toBe(false);

    mgr.markRateLimited("anthropic", 60_000);
    mgr.markRateLimited("openai", 60_000);
    expect(mgr.isAllExhausted()).toBe(false);

    mgr.markRateLimited("ollama", 60_000);
    expect(mgr.isAllExhausted()).toBe(true);

    // After one resumes, no longer fully exhausted
    vi.advanceTimersByTime(61_000);
    expect(mgr.isAllExhausted()).toBe(false);
  });

  it("events track the complete cascade for UI display", () => {
    const mgr = new RateLimitManager(["anthropic", "openai", "copilot", "ollama"]);
    const events: Array<{ type: string; provider?: string; fallbackProvider?: string }> = [];
    mgr.onEvent((e) => events.push({ type: e.type, provider: e.provider, fallbackProvider: e.fallbackProvider }));

    // Cascade through multiple rate limits
    mgr.markRateLimited("anthropic", 60_000);
    mgr.findFallback("anthropic");

    mgr.markRateLimited("openai", 60_000);
    mgr.findFallback("openai");

    // Should have: rate-limited(anthropic), fallback, rate-limited(openai), fallback
    const rateLimitEvents = events.filter((e) => e.type === "rate-limited");
    const fallbackEvents = events.filter((e) => e.type === "fallback");

    expect(rateLimitEvents).toHaveLength(2);
    expect(fallbackEvents).toHaveLength(2);
    expect(fallbackEvents[0]!.fallbackProvider).toBeDefined();
  });
});
