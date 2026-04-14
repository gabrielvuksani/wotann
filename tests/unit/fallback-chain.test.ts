import { describe, it, expect } from "vitest";
import {
  buildFallbackChain,
  resolveNextProvider,
  describeFallbackChain,
} from "../../src/providers/fallback-chain.js";
import type { ProviderName } from "../../src/core/types.js";

describe("Provider Fallback Chain", () => {
  const allProviders = new Set<ProviderName>([
    "anthropic", "openai", "codex", "copilot", "ollama", "free",
  ]);
  const noRateLimits = () => false;

  describe("buildFallbackChain", () => {
    it("puts preferred provider first", () => {
      const chain = buildFallbackChain("openai", allProviders, noRateLimits);
      expect(chain[0]!.provider).toBe("openai");
    });

    it("puts free providers (ollama, free) last", () => {
      const chain = buildFallbackChain("anthropic", allProviders, noRateLimits);
      const lastTwo = chain.slice(-2).map((e) => e.provider);
      expect(lastTwo).toContain("ollama");
      expect(lastTwo).toContain("free");
    });

    it("paid providers come before free providers", () => {
      const chain = buildFallbackChain("anthropic", allProviders, noRateLimits);
      const paidIdx = chain.findIndex((e) => e.provider === "openai");
      const freeIdx = chain.findIndex((e) => e.provider === "ollama");
      expect(paidIdx).toBeLessThan(freeIdx);
    });

    it("marks rate-limited providers correctly", () => {
      const isLimited = (p: ProviderName) => p === "anthropic";
      const chain = buildFallbackChain("anthropic", allProviders, isLimited);

      const anthropic = chain.find((e) => e.provider === "anthropic");
      expect(anthropic!.rateLimited).toBe(true);

      const openai = chain.find((e) => e.provider === "openai");
      expect(openai!.rateLimited).toBe(false);
    });

    it("marks free providers with isFree flag", () => {
      const chain = buildFallbackChain("anthropic", allProviders, noRateLimits);

      const ollama = chain.find((e) => e.provider === "ollama");
      expect(ollama!.isFree).toBe(true);

      const anthropic = chain.find((e) => e.provider === "anthropic");
      expect(anthropic!.isFree).toBe(false);
    });

    it("only includes available providers", () => {
      const limited = new Set<ProviderName>(["anthropic", "ollama"]);
      const chain = buildFallbackChain("anthropic", limited, noRateLimits);

      expect(chain).toHaveLength(2);
      expect(chain.map((e) => e.provider)).toEqual(["anthropic", "ollama"]);
    });

    it("handles ollama as preferred (free-tier user)", () => {
      const chain = buildFallbackChain("ollama", allProviders, noRateLimits);
      expect(chain[0]!.provider).toBe("ollama");
      // Paid providers should still be in the chain as fallback
      expect(chain.some((e) => e.provider === "anthropic")).toBe(true);
    });
  });

  describe("resolveNextProvider", () => {
    it("returns first non-rate-limited provider", () => {
      const chain = buildFallbackChain(
        "anthropic",
        allProviders,
        (p) => p === "anthropic",
      );

      const next = resolveNextProvider(chain);
      // Should skip anthropic (rate-limited) and return the next paid provider
      expect(next).not.toBe("anthropic");
      expect(next).toBeDefined();
    });

    it("falls to free provider when all paid are rate-limited", () => {
      const allPaidLimited = (p: ProviderName) =>
        !["ollama", "free"].includes(p);

      const chain = buildFallbackChain("anthropic", allProviders, allPaidLimited);
      const next = resolveNextProvider(chain);

      expect(next).toBe("ollama"); // First free provider
    });

    it("returns free provider even when rate-limited (last resort)", () => {
      // ALL providers rate-limited — should still return a free one
      const allLimited = () => true;
      const chain = buildFallbackChain("anthropic", allProviders, allLimited);
      const next = resolveNextProvider(chain);

      // Should return ollama or free as last resort
      expect(["ollama", "free"]).toContain(next);
    });

    it("returns null only when no providers at all", () => {
      const emptySet = new Set<ProviderName>();
      const chain = buildFallbackChain("anthropic", emptySet, noRateLimits);
      const next = resolveNextProvider(chain);
      expect(next).toBeNull();
    });
  });

  describe("describeFallbackChain", () => {
    it("produces human-readable chain description", () => {
      const chain = buildFallbackChain("anthropic", allProviders, noRateLimits);
      const desc = describeFallbackChain(chain);

      expect(desc).toContain("anthropic");
      expect(desc).toContain("available");
      expect(desc).toContain("(free)");
      expect(desc).toContain("→");
    });

    it("shows rate-limited status", () => {
      const chain = buildFallbackChain(
        "anthropic",
        allProviders,
        (p) => p === "anthropic",
      );
      const desc = describeFallbackChain(chain);
      expect(desc).toContain("rate-limited");
    });
  });

  describe("full cascade scenario", () => {
    it("anthropic limited → openai → codex → copilot → ollama → free", () => {
      const limitedSet = new Set<ProviderName>(["anthropic"]);
      const chain = buildFallbackChain(
        "anthropic",
        allProviders,
        (p) => limitedSet.has(p),
      );

      // First should be anthropic (rate-limited)
      expect(chain[0]!.provider).toBe("anthropic");
      expect(chain[0]!.rateLimited).toBe(true);

      // Resolve should skip it and go to next paid
      const next = resolveNextProvider(chain);
      expect(next).not.toBe("anthropic");
      // Should be a paid provider, not free
      expect(["openai", "codex", "copilot"]).toContain(next);
    });

    it("all paid limited → falls to ollama (never degrades model)", () => {
      const allPaid = new Set<ProviderName>([
        "anthropic", "openai", "codex", "copilot",
      ]);
      const allPaidLimited = (p: ProviderName) => allPaid.has(p);

      const chain = buildFallbackChain("anthropic", allProviders, allPaidLimited);
      const next = resolveNextProvider(chain);

      expect(next).toBe("ollama");
    });
  });
});
