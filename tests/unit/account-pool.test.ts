import { describe, it, expect, vi, afterEach } from "vitest";
import { AccountPool } from "../../src/providers/account-pool.js";

describe("AccountPool", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("adds and retrieves accounts", () => {
    const pool = new AccountPool();
    pool.addAccount({
      id: "test-1", provider: "anthropic", token: "sk-test",
      type: "api-key", priority: 1,
    });
    expect(pool.size()).toBe(1);
    expect(pool.getAccounts("anthropic")).toHaveLength(1);
  });

  it("prefers OAuth over API key", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "api", provider: "anthropic", token: "sk-test", type: "api-key", priority: 1 });
    pool.addAccount({ id: "oauth", provider: "anthropic", token: "oauth-token", type: "oauth", priority: 1 });

    const best = pool.getBestAccount("anthropic");
    expect(best?.id).toBe("oauth");
  });

  it("skips rate-limited accounts", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "key-1", provider: "anthropic", token: "sk-1", type: "api-key", priority: 1 });
    pool.addAccount({ id: "key-2", provider: "anthropic", token: "sk-2", type: "api-key", priority: 2 });

    pool.recordRateLimit("key-1", 60_000);
    pool.clearPin("anthropic");

    const best = pool.getBestAccount("anthropic");
    expect(best?.id).toBe("key-2");
  });

  it("session pins to first successful account", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "key-1", provider: "openai", token: "sk-1", type: "api-key", priority: 1 });
    pool.addAccount({ id: "key-2", provider: "openai", token: "sk-2", type: "api-key", priority: 2 });

    const first = pool.getBestAccount("openai");
    const second = pool.getBestAccount("openai");
    expect(first?.id).toBe(second?.id); // Pinned
  });

  it("rotates on rate limit (clears pin)", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "key-1", provider: "openai", token: "sk-1", type: "api-key", priority: 1 });
    pool.addAccount({ id: "key-2", provider: "openai", token: "sk-2", type: "api-key", priority: 2 });

    pool.getBestAccount("openai"); // Pins to key-1
    pool.recordRateLimit("key-1"); // Unpins and blocks key-1

    const next = pool.getBestAccount("openai");
    expect(next?.id).toBe("key-2");
  });

  it("tracks health stats", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "key-1", provider: "anthropic", token: "sk", type: "api-key", priority: 1 });

    pool.recordSuccess("key-1", 150);
    pool.recordSuccess("key-1", 200);

    const health = pool.getHealth("key-1");
    expect(health?.requestCount).toBe(2);
    expect(health?.avgLatencyMs).toBeGreaterThan(0);
  });

  it("handles billing failure backoff", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "key-1", provider: "anthropic", token: "sk", type: "api-key", priority: 1 });
    pool.addAccount({ id: "key-2", provider: "anthropic", token: "sk-2", type: "api-key", priority: 2 });

    pool.recordBillingFailure("key-1");
    pool.clearPin("anthropic");

    const best = pool.getBestAccount("anthropic");
    expect(best?.id).toBe("key-2");
  });

  it("returns null for unknown provider", () => {
    const pool = new AccountPool();
    expect(pool.getBestAccount("anthropic")).toBeNull();
  });

  it("removes accounts", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "key-1", provider: "anthropic", token: "sk", type: "api-key", priority: 1 });
    expect(pool.size()).toBe(1);

    pool.removeAccount("key-1");
    expect(pool.size()).toBe(0);
  });

  it("discovers accounts from env vars", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("ANTHROPIC_API_KEY_2", "sk-test-2");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");

    const pool = new AccountPool();
    const count = pool.discoverFromEnv();

    expect(count).toBe(3);
    expect(pool.getAccounts("anthropic")).toHaveLength(2);
    expect(pool.getAccounts("openai")).toHaveLength(1);
  });

  it("lists all providers with accounts", () => {
    const pool = new AccountPool();
    pool.addAccount({ id: "a1", provider: "anthropic", token: "sk", type: "api-key", priority: 1 });
    pool.addAccount({ id: "o1", provider: "openai", token: "sk", type: "api-key", priority: 1 });

    const providers = pool.getProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });
});
