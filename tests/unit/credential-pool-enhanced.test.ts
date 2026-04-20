/**
 * Extended CredentialPool tests — covers peer-tool-auth-sidecar lifecycle.
 *
 * Ports Hermes's `mark_exhausted_and_rotate`, `acquire_lease`/`release_lease`,
 * typed `CredentialPoolExhausted` error, region affinity, and a guarantee
 * that no credential material ever leaks into thrown or logged messages.
 *
 * Follows Quality Bar #6 (honest failure), #7 (per-session state), and
 * rules/security.md (never log credential values).
 */
import { describe, it, expect } from "vitest";
import {
  CredentialPool,
  CredentialPoolExhausted,
} from "../../src/providers/credential-pool.js";
import { AccountPool } from "../../src/providers/account-pool.js";

describe("CredentialPool — exhaustion + leases + region affinity", () => {
  it("throws typed CredentialPoolExhausted when pool is empty", () => {
    const pool = new CredentialPool();
    expect(() => pool.requireCredential("anthropic")).toThrow(CredentialPoolExhausted);

    try {
      pool.requireCredential("anthropic");
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialPoolExhausted);
      const exhaustion = err as CredentialPoolExhausted;
      expect(exhaustion.provider).toBe("anthropic");
      expect(exhaustion.reasons).toBeDefined();
      expect(Array.isArray(exhaustion.reasons)).toBe(true);
    }
  });

  it("exhausts single-key pool after one 429, throws on next acquire", () => {
    const accountPool = new AccountPool();
    accountPool.addAccount({
      id: "solo-key",
      provider: "anthropic",
      token: "sk-ant-secret-xyz",
      type: "api-key",
      priority: 1,
    });
    const pool = new CredentialPool(accountPool, {
      rotationStrategy: "fill_first",
      restorePrimaryAfterTurns: 3,
      maxAuthFailures: 5,
      deterministicCallIds: true,
      compressionDeathSpiralDetection: true,
    });

    // First acquire works
    const first = pool.getCredential("anthropic");
    expect(first).not.toBeNull();

    // Rotate-on-429 exhausts the single key
    const rotated = pool.markExhaustedAndRotate({
      keyId: "solo-key",
      provider: "anthropic",
      statusCode: 429,
    });
    expect(rotated).toBeNull();

    // Now requireCredential throws typed exhaustion
    expect(() => pool.requireCredential("anthropic")).toThrow(CredentialPoolExhausted);
  });

  it("rotates A->B->C on three consecutive 429s", () => {
    const accountPool = new AccountPool();
    accountPool.addAccount({ id: "key-A", provider: "openai", token: "sk-A-secret", type: "api-key", priority: 1 });
    accountPool.addAccount({ id: "key-B", provider: "openai", token: "sk-B-secret", type: "api-key", priority: 2 });
    accountPool.addAccount({ id: "key-C", provider: "openai", token: "sk-C-secret", type: "api-key", priority: 3 });
    const pool = new CredentialPool(accountPool, {
      rotationStrategy: "fill_first",
      restorePrimaryAfterTurns: 3,
      maxAuthFailures: 5,
      deterministicCallIds: true,
      compressionDeathSpiralDetection: true,
    });

    const picks: string[] = [];

    const a = pool.getCredential("openai");
    if (a) picks.push(a.id);
    const afterA = pool.markExhaustedAndRotate({ keyId: a!.id, provider: "openai", statusCode: 429 });
    if (afterA) picks.push(afterA.id);

    const afterB = pool.markExhaustedAndRotate({ keyId: afterA!.id, provider: "openai", statusCode: 429 });
    if (afterB) picks.push(afterB.id);

    const afterC = pool.markExhaustedAndRotate({ keyId: afterB!.id, provider: "openai", statusCode: 429 });
    // All three exhausted; next rotation returns null
    expect(afterC).toBeNull();

    // Picks should have visited all three unique keys
    const uniquePicks = new Set(picks);
    expect(uniquePicks.size).toBe(3);
    expect(uniquePicks.has("key-A")).toBe(true);
    expect(uniquePicks.has("key-B")).toBe(true);
    expect(uniquePicks.has("key-C")).toBe(true);
  });

  it("acquires a lease with soft concurrency cap, releases on success", () => {
    const accountPool = new AccountPool();
    accountPool.addAccount({ id: "leased-1", provider: "anthropic", token: "sk-1", type: "api-key", priority: 1 });
    accountPool.addAccount({ id: "leased-2", provider: "anthropic", token: "sk-2", type: "api-key", priority: 2 });
    const pool = new CredentialPool(accountPool);

    // Default max concurrent per credential is 1
    const leaseA = pool.acquireLease("anthropic");
    expect(leaseA).not.toBeNull();
    const firstId = leaseA!.id;

    // Second lease should pick a DIFFERENT credential (the least-leased)
    const leaseB = pool.acquireLease("anthropic");
    expect(leaseB).not.toBeNull();
    expect(leaseB!.id).not.toBe(firstId);

    // Release both; counts return to zero
    pool.releaseLease(leaseA!.id);
    pool.releaseLease(leaseB!.id);

    // Now a new acquire can land on the first again
    const leaseC = pool.acquireLease("anthropic");
    expect(leaseC).not.toBeNull();
  });

  it("region affinity: prefers matching-region credential", () => {
    const accountPool = new AccountPool();
    accountPool.addAccount({
      id: "us-east",
      provider: "anthropic",
      token: "sk-us",
      type: "api-key",
      priority: 2,
      label: "region:us-east-1",
    });
    accountPool.addAccount({
      id: "eu-west",
      provider: "anthropic",
      token: "sk-eu",
      type: "api-key",
      priority: 1,
      label: "region:eu-west-1",
    });
    const pool = new CredentialPool(accountPool);

    const eu = pool.getCredentialForRegion("anthropic", "eu-west-1");
    expect(eu).not.toBeNull();
    expect(eu!.id).toBe("eu-west");

    const us = pool.getCredentialForRegion("anthropic", "us-east-1");
    expect(us).not.toBeNull();
    expect(us!.id).toBe("us-east");

    // Unknown region falls back to rotation strategy (no throw, a key returned)
    const fallback = pool.getCredentialForRegion("anthropic", "ap-south-2");
    expect(fallback).not.toBeNull();
  });

  it("never leaks the credential token in the error message", () => {
    const accountPool = new AccountPool();
    const secretToken = "sk-ant-VERY-SECRET-TOKEN-42";
    accountPool.addAccount({
      id: "leakable",
      provider: "anthropic",
      token: secretToken,
      type: "api-key",
      priority: 1,
    });
    const pool = new CredentialPool(accountPool);

    // Exhaust
    pool.markExhaustedAndRotate({ keyId: "leakable", provider: "anthropic", statusCode: 429 });

    let caught: Error | undefined;
    try {
      pool.requireCredential("anthropic");
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    // The secret token must NOT appear in the error message or stack.
    const whole = String(caught!.message) + "\n" + String(caught!.stack ?? "");
    expect(whole).not.toContain(secretToken);

    // Also: exhaustion reasons should not leak the token.
    const exhaustion = caught as CredentialPoolExhausted;
    const reasonJson = JSON.stringify(exhaustion.reasons);
    expect(reasonJson).not.toContain(secretToken);
  });

  it("markExhaustedAndRotate records the status code in exhaustion reasons", () => {
    const accountPool = new AccountPool();
    accountPool.addAccount({ id: "k1", provider: "openai", token: "t1", type: "api-key", priority: 1 });
    const pool = new CredentialPool(accountPool);

    pool.markExhaustedAndRotate({ keyId: "k1", provider: "openai", statusCode: 402 });

    try {
      pool.requireCredential("openai");
      expect.fail("expected CredentialPoolExhausted");
    } catch (err) {
      const exhaustion = err as CredentialPoolExhausted;
      expect(exhaustion.reasons.some((r) => r.keyId === "k1" && r.statusCode === 402)).toBe(true);
    }
  });

  it("acquire/release lease handles unknown id gracefully", () => {
    const pool = new CredentialPool();
    // Releasing an unknown id must not throw
    expect(() => pool.releaseLease("nonexistent")).not.toThrow();
  });
});
