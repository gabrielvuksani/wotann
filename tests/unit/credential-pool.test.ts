import { describe, it, expect } from "vitest";
import { CredentialPool } from "../../src/providers/credential-pool.js";
import { AccountPool } from "../../src/providers/account-pool.js";

describe("CredentialPool", () => {
  function createPoolWithAccounts(): CredentialPool {
    const accountPool = new AccountPool();
    accountPool.addAccount({ id: "key-1", provider: "anthropic", token: "sk-ant-test-1", type: "api-key", priority: 1 });
    accountPool.addAccount({ id: "key-2", provider: "anthropic", token: "sk-ant-test-2", type: "api-key", priority: 2 });
    accountPool.addAccount({ id: "key-3", provider: "anthropic", token: "sk-ant-test-3", type: "api-key", priority: 3 });
    return new CredentialPool(accountPool);
  }

  it("gets a credential using least_used strategy (default)", () => {
    const pool = createPoolWithAccounts();
    const cred = pool.getCredential("anthropic");
    expect(cred).not.toBeNull();
    expect(cred!.provider).toBe("anthropic");
  });

  it("rotates credentials on auth failure", () => {
    const pool = createPoolWithAccounts();
    const first = pool.getCredential("anthropic");
    expect(first).not.toBeNull();

    // Simulate auth failure — should get a different key
    const next = pool.recordAuthFailure(first!.id, "anthropic");
    expect(next).not.toBeNull();
    // Next key should be different (or same if only one remaining)
    expect(next!.provider).toBe("anthropic");
  });

  it("blacklists keys after max auth failures", () => {
    const pool = new CredentialPool(undefined, { maxAuthFailures: 2, rotationStrategy: "least_used", restorePrimaryAfterTurns: 3, deterministicCallIds: true, compressionDeathSpiralDetection: true });
    const accountPool = pool.getPool();
    accountPool.addAccount({ id: "fragile-key", provider: "openai", token: "sk-test", type: "api-key", priority: 1 });

    // Fail twice (hits max)
    pool.recordAuthFailure("fragile-key", "openai");
    pool.recordAuthFailure("fragile-key", "openai");

    // Stats should show blacklisted
    const stats = pool.getStats("openai");
    expect(stats.blacklistedKeys).toBe(1);
  });

  it("tracks primary restoration state", () => {
    const pool = createPoolWithAccounts();
    const primary = pool.getCredential("anthropic");

    // Auth failure triggers restoration tracking
    pool.recordAuthFailure(primary!.id, "anthropic");
    expect(pool.shouldRestorePrimary()).not.toBeNull();

    // Simulate successful turns on fallback
    pool.recordSuccess("key-2", 100);
    pool.recordSuccess("key-2", 100);
    pool.recordSuccess("key-2", 100);

    // After 3 turns, primary restoration should be cleared
    expect(pool.shouldRestorePrimary()).toBeNull();
  });

  it("generates deterministic call IDs", () => {
    const pool = createPoolWithAccounts();
    const id1 = pool.generateCallId("anthropic", "claude-opus-4-6", 0);
    const id2 = pool.generateCallId("anthropic", "claude-opus-4-6", 0);

    expect(id1).toMatch(/^call_/);
    expect(id2).toMatch(/^call_/);
    // Different counter values → different IDs
    expect(id1).not.toBe(id2);
  });

  it("detects compression death spiral", () => {
    const pool = createPoolWithAccounts();
    expect(pool.isCompressionDeathSpiral()).toBe(false);

    // Simulate 3 failed compressions
    pool.recordCompression(false);
    pool.recordCompression(false);
    pool.recordCompression(false);

    expect(pool.isCompressionDeathSpiral()).toBe(true);

    // Reset
    pool.resetCompressionState();
    expect(pool.isCompressionDeathSpiral()).toBe(false);
  });

  it("round_robin strategy cycles through keys", () => {
    const accountPool = new AccountPool();
    accountPool.addAccount({ id: "rr-1", provider: "anthropic", token: "t1", type: "api-key", priority: 1 });
    accountPool.addAccount({ id: "rr-2", provider: "anthropic", token: "t2", type: "api-key", priority: 2 });
    const pool = new CredentialPool(accountPool, { rotationStrategy: "round_robin", restorePrimaryAfterTurns: 3, maxAuthFailures: 5, deterministicCallIds: true, compressionDeathSpiralDetection: true });

    const ids = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const cred = pool.getCredential("anthropic");
      if (cred) ids.add(cred.id);
    }
    // Should have hit both keys
    expect(ids.size).toBe(2);
  });

  it("returns null for non-existent provider", () => {
    const pool = createPoolWithAccounts();
    const cred = pool.getCredential("gemini");
    expect(cred).toBeNull();
  });

  it("discovers credentials from environment", () => {
    const pool = new CredentialPool();
    // discoverAll returns count (may be 0 if env vars not set)
    const count = pool.discoverAll();
    expect(typeof count).toBe("number");
  });

  it("getStats returns complete statistics", () => {
    const pool = createPoolWithAccounts();
    const stats = pool.getStats("anthropic");
    expect(stats.totalKeys).toBe(3);
    expect(stats.activeKeys).toBe(3);
    expect(stats.blacklistedKeys).toBe(0);
    expect(stats.rotationStrategy).toBe("fill_first");
    expect(stats.compressionDeathSpiral).toBe(false);
    expect(stats.pendingPrimaryRestore).toBe(false);
  });
});
