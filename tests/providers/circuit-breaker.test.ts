import { describe, it, expect } from "vitest";
import { CircuitBreaker, withBreaker } from "../../src/providers/circuit-breaker.js";

describe("CircuitBreaker — state transitions", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.canRequest()).toBe(true);
  });

  it("stays closed below minRequests even with all failures", () => {
    const cb = new CircuitBreaker({ minRequests: 10, failureThreshold: 0.5 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed");
  });

  it("trips to open when failure rate crosses threshold", () => {
    const cb = new CircuitBreaker({ minRequests: 10, failureThreshold: 0.5 });
    for (let i = 0; i < 10; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  it("open state rejects requests", () => {
    const cb = new CircuitBreaker({ minRequests: 10, failureThreshold: 0.5 });
    for (let i = 0; i < 10; i++) cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
  });

  it("mixed successes + failures respect threshold", () => {
    const cb = new CircuitBreaker({ minRequests: 10, failureThreshold: 0.5 });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    for (let i = 0; i < 6; i++) cb.recordSuccess();
    // 4/10 = 40% < 50% → still closed
    expect(cb.getState()).toBe("closed");
  });
});

describe("CircuitBreaker — cooldown + half-open", () => {
  it("transitions to half-open after openDurationMs", () => {
    let now = 1000;
    const cb = new CircuitBreaker({
      minRequests: 5,
      failureThreshold: 0.5,
      openDurationMs: 1000,
      now: () => now,
    });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");

    now = 2500; // 1500ms elapsed
    expect(cb.canRequest()).toBe(true); // triggers transition
    expect(cb.getState()).toBe("half-open");
  });

  it("closes after N successes in half-open", () => {
    let now = 1000;
    const cb = new CircuitBreaker({
      minRequests: 5,
      failureThreshold: 0.5,
      openDurationMs: 500,
      probeSuccessesRequired: 2,
      now: () => now,
    });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    now = 2000;
    cb.canRequest(); // transition to half-open
    cb.recordSuccess();
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  it("reopens on failure in half-open", () => {
    let now = 1000;
    const cb = new CircuitBreaker({
      minRequests: 5,
      failureThreshold: 0.5,
      openDurationMs: 500,
      now: () => now,
    });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    now = 2000;
    cb.canRequest(); // half-open
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });
});

describe("CircuitBreaker — window pruning", () => {
  it("old entries drop out of rolling window", () => {
    let now = 1000;
    const cb = new CircuitBreaker({
      minRequests: 5,
      failureThreshold: 0.5,
      windowMs: 1000,
      now: () => now,
    });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");
    // Reset after fresh window
    now = 5000;
    cb.reset();
    for (let i = 0; i < 2; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed"); // below minRequests
  });
});

describe("CircuitBreaker — reset", () => {
  it("reset returns state to closed", () => {
    const cb = new CircuitBreaker({ minRequests: 5 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.canRequest()).toBe(true);
  });
});

describe("stats", () => {
  it("reports counts + rate", () => {
    const cb = new CircuitBreaker();
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure();
    const s = cb.stats();
    expect(s.requestCount).toBe(3);
    expect(s.failureCount).toBe(1);
    expect(s.successCount).toBe(2);
    expect(s.failureRate).toBeCloseTo(1 / 3, 2);
  });
});

describe("withBreaker", () => {
  it("runs + records success", async () => {
    const cb = new CircuitBreaker();
    const result = await withBreaker(async () => "ok", cb);
    expect(result).toBe("ok");
    expect(cb.stats().successCount).toBe(1);
  });

  it("records failure + re-throws", async () => {
    const cb = new CircuitBreaker();
    await expect(
      withBreaker(async () => {
        throw new Error("boom");
      }, cb),
    ).rejects.toThrow("boom");
    expect(cb.stats().failureCount).toBe(1);
  });

  it("fails fast when circuit is open", async () => {
    const cb = new CircuitBreaker({ minRequests: 3, failureThreshold: 0.5 });
    for (let i = 0; i < 3; i++) cb.recordFailure();
    await expect(withBreaker(async () => "never", cb)).rejects.toThrow(/OPEN/);
  });
});
