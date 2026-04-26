import { describe, it, expect, vi } from "vitest";
import { startOAuthRotator, type RotatableCredential } from "../../src/auth/oauth-rotator.js";

// Helper: yield enough microtasks for the immediate sweep to complete.
async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("oauth-rotator (H-K4)", () => {
  it("refreshes credentials whose expiresAt is within the window", async () => {
    const now = Date.now();
    const credentials: RotatableCredential[] = [
      { id: "a", provider: "anthropic", refreshToken: "rt-a", expiresAt: now + 60_000 }, // 1 min — expiring
      { id: "b", provider: "openai", refreshToken: "rt-b", expiresAt: now + 60 * 60_000 }, // 1 hr — fresh
    ];
    const refresh = vi.fn(async () => {});
    const handle = startOAuthRotator({
      sweepIntervalMs: 99_999_999, // effectively never re-fires
      windowMs: 5 * 60_000,
      listCredentials: () => credentials,
      refresh,
    });

    await flushMicrotasks();
    handle.stop();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(credentials[0]);
  });

  it("skips credentials with malformed expiresAt", async () => {
    const credentials: RotatableCredential[] = [
      { id: "x", provider: "anthropic", refreshToken: "rt", expiresAt: NaN as unknown as number },
    ];
    const refresh = vi.fn(async () => {});
    const handle = startOAuthRotator({
      sweepIntervalMs: 99_999_999,
      listCredentials: () => credentials,
      refresh,
    });

    await flushMicrotasks();
    handle.stop();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("survives refresh callback throws (logs + continues)", async () => {
    const now = Date.now();
    const credentials: RotatableCredential[] = [
      { id: "a", provider: "anthropic", refreshToken: "rt-a", expiresAt: now + 1000 },
      { id: "b", provider: "openai", refreshToken: "rt-b", expiresAt: now + 2000 },
    ];
    const refresh = vi.fn(async (c: RotatableCredential) => {
      if (c.id === "a") throw new Error("simulated refresh failure");
    });
    const log = vi.fn();
    const handle = startOAuthRotator({
      sweepIntervalMs: 99_999_999,
      listCredentials: () => credentials,
      refresh,
      log,
    });

    await flushMicrotasks();
    handle.stop();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("simulated refresh failure"));
  });

  it("survives listCredentials throws (logs + skips sweep)", async () => {
    const refresh = vi.fn(async () => {});
    const log = vi.fn();
    const handle = startOAuthRotator({
      sweepIntervalMs: 99_999_999,
      listCredentials: () => {
        throw new Error("listCredentials boom");
      },
      refresh,
      log,
    });

    await flushMicrotasks();
    handle.stop();

    expect(refresh).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("listCredentials boom"));
  });

  it("stop() makes subsequent sweepNow no-op", async () => {
    const credentials: RotatableCredential[] = [
      {
        id: "a",
        provider: "anthropic",
        refreshToken: "rt-a",
        expiresAt: Date.now() + 1000,
      },
    ];
    const refresh = vi.fn(async () => {});
    const handle = startOAuthRotator({
      sweepIntervalMs: 99_999_999,
      listCredentials: () => credentials,
      refresh,
    });
    await flushMicrotasks();
    handle.stop();
    const callsBeforeStop = refresh.mock.calls.length;
    await handle.sweepNow();
    expect(refresh.mock.calls.length).toBe(callsBeforeStop);
  });
});
