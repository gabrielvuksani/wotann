/**
 * V9 T14.1 — Channels push-inversion registry tests.
 *
 * Covers:
 *   - register + push delivers to sink exactly once
 *   - push to unregistered session returns {ok: false, reason: "not-registered"}
 *   - deregister stops delivery (sink no longer invoked)
 *   - rate limit triggers after N/min; recovers after window
 *   - dedupe by correlationId within 30s; allowed again after window
 *   - two independent registries don't share state (QB #7)
 *   - concurrent pushes to same session serialize in registration order
 *   - sink throws → push returns {ok: false, error, reason: "sink-error"};
 *     other sessions are unaffected
 *   - empty content rejected
 *   - has() / list() reflect active registrations
 *   - re-register replaces the previous sink; old deregister is a no-op
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createPushInversionRegistry,
  type PushInversionRegistry,
  type PushMessage,
} from "../../src/channels/push-inversion.js";

function makeMessage(overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    source: "mcp",
    kind: "notification",
    content: "hello from mcp",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("createPushInversionRegistry — V9 T14.1", () => {
  let registry: PushInversionRegistry;

  beforeEach(() => {
    registry = createPushInversionRegistry();
  });

  // ── Registration lifecycle ─────────────────────────────────

  it("register + push delivers to the sink exactly once", async () => {
    const received: PushMessage[] = [];
    registry.register("session-1", {
      sink: async (m) => {
        received.push(m);
      },
    });

    const msg = makeMessage({ content: "one" });
    const result = await registry.push("session-1", msg);

    expect(result.ok).toBe(true);
    expect(result.deliveredCount).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]?.content).toBe("one");
  });

  it("push to unregistered session returns {ok: false, reason: 'not-registered'}", async () => {
    const result = await registry.push("does-not-exist", makeMessage());

    expect(result.ok).toBe(false);
    expect(result.deliveredCount).toBe(0);
    expect(result.reason).toBe("not-registered");
    expect(result.error).toBeTruthy();
  });

  it("deregister stops delivery", async () => {
    const received: PushMessage[] = [];
    const dispose = registry.register("session-2", {
      sink: async (m) => {
        received.push(m);
      },
    });

    await registry.push("session-2", makeMessage({ content: "first" }));
    expect(received).toHaveLength(1);

    dispose();

    const result = await registry.push("session-2", makeMessage({ content: "second" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-registered");
    expect(received).toHaveLength(1); // unchanged
  });

  it("has() and list() reflect active registrations", () => {
    expect(registry.has("a")).toBe(false);
    expect(registry.list()).toEqual([]);

    const disposeA = registry.register("a", { sink: async () => {} });
    registry.register("b", { sink: async () => {} });

    expect(registry.has("a")).toBe(true);
    expect(registry.has("b")).toBe(true);
    expect(registry.has("c")).toBe(false);
    expect([...registry.list()].sort()).toEqual(["a", "b"]);

    disposeA();
    expect(registry.has("a")).toBe(false);
    expect([...registry.list()]).toEqual(["b"]);
  });

  it("re-register replaces the sink; stale dispose is a no-op", async () => {
    const firstReceived: PushMessage[] = [];
    const secondReceived: PushMessage[] = [];

    const disposeFirst = registry.register("session-3", {
      sink: async (m) => {
        firstReceived.push(m);
      },
    });
    // Replace with a fresh sink (no explicit deregister first).
    registry.register("session-3", {
      sink: async (m) => {
        secondReceived.push(m);
      },
    });

    await registry.push("session-3", makeMessage({ content: "x" }));

    expect(firstReceived).toEqual([]);
    expect(secondReceived).toHaveLength(1);

    // Stale dispose from the first registration must NOT remove the
    // current (second) registration.
    disposeFirst();
    expect(registry.has("session-3")).toBe(true);

    await registry.push("session-3", makeMessage({ content: "y" }));
    expect(secondReceived).toHaveLength(2);
  });

  // ── Validation ─────────────────────────────────────────────

  it("register rejects empty sessionId", () => {
    expect(() => registry.register("", { sink: async () => {} })).toThrow(/sessionId/);
    expect(() => registry.register("   ", { sink: async () => {} })).toThrow(/sessionId/);
  });

  it("push with empty content returns {ok: false, reason: 'empty-content'}", async () => {
    registry.register("session-4", { sink: async () => {} });

    const result = await registry.push("session-4", makeMessage({ content: "" }));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty-content");
  });

  // ── Rate limiting ──────────────────────────────────────────

  it("rate limit triggers after N pushes per minute, recovers after window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));

    const received: PushMessage[] = [];
    registry.register("rate-test", {
      sink: async (m) => {
        received.push(m);
      },
      maxPerMinute: 3,
    });

    // 3 fit; 4th is rate-limited.
    const r1 = await registry.push("rate-test", makeMessage({ content: "1" }));
    const r2 = await registry.push("rate-test", makeMessage({ content: "2" }));
    const r3 = await registry.push("rate-test", makeMessage({ content: "3" }));
    const r4 = await registry.push("rate-test", makeMessage({ content: "4" }));

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(r4.ok).toBe(false);
    expect(r4.reason).toBe("rate-limited");
    expect(received).toHaveLength(3);

    // Advance past the 60s window — budget should refill.
    vi.setSystemTime(new Date("2026-04-23T00:01:00.500Z"));
    const r5 = await registry.push("rate-test", makeMessage({ content: "5" }));
    expect(r5.ok).toBe(true);
    expect(received).toHaveLength(4);

    vi.useRealTimers();
  });

  it("rate limit default is 30/min when not specified", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));

    let delivered = 0;
    registry.register("default-rate", {
      sink: async () => {
        delivered += 1;
      },
    });

    // Fire 31 rapid pushes; 30 should land, 31st should be rate-limited.
    const results = [];
    for (let i = 0; i < 31; i += 1) {
      results.push(await registry.push("default-rate", makeMessage({ content: `m${i}` })));
    }

    expect(results.filter((r) => r.ok).length).toBe(30);
    expect(results.filter((r) => r.reason === "rate-limited").length).toBe(1);
    expect(delivered).toBe(30);

    vi.useRealTimers();
  });

  // ── Dedupe ─────────────────────────────────────────────────

  it("dedupe by correlationId collapses duplicates inside 30s; allowed again after", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));

    const received: PushMessage[] = [];
    registry.register("dedupe-test", {
      sink: async (m) => {
        received.push(m);
      },
      dedupe: true,
    });

    const r1 = await registry.push(
      "dedupe-test",
      makeMessage({ correlationId: "abc", content: "first" }),
    );
    const r2 = await registry.push(
      "dedupe-test",
      makeMessage({ correlationId: "abc", content: "second" }),
    );

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("dedupe");
    expect(received).toHaveLength(1);
    expect(received[0]?.content).toBe("first");

    // Different correlationId passes through.
    const r3 = await registry.push(
      "dedupe-test",
      makeMessage({ correlationId: "xyz", content: "other" }),
    );
    expect(r3.ok).toBe(true);
    expect(received).toHaveLength(2);

    // Outside the 30s window the original correlationId is allowed again.
    vi.setSystemTime(new Date("2026-04-23T00:00:31.000Z"));
    const r4 = await registry.push(
      "dedupe-test",
      makeMessage({ correlationId: "abc", content: "fresh" }),
    );
    expect(r4.ok).toBe(true);
    expect(received).toHaveLength(3);

    vi.useRealTimers();
  });

  it("dedupe is off by default (identical correlationIds pass through)", async () => {
    const received: PushMessage[] = [];
    registry.register("no-dedupe", {
      sink: async (m) => {
        received.push(m);
      },
    });

    await registry.push("no-dedupe", makeMessage({ correlationId: "same" }));
    await registry.push("no-dedupe", makeMessage({ correlationId: "same" }));

    expect(received).toHaveLength(2);
  });

  // ── Isolation (QB #7) ──────────────────────────────────────

  it("two independent registries don't share state", async () => {
    const registryA = createPushInversionRegistry();
    const registryB = createPushInversionRegistry();

    const aReceived: PushMessage[] = [];
    const bReceived: PushMessage[] = [];

    registryA.register("shared-id", {
      sink: async (m) => {
        aReceived.push(m);
      },
    });
    registryB.register("shared-id", {
      sink: async (m) => {
        bReceived.push(m);
      },
    });

    await registryA.push("shared-id", makeMessage({ content: "to-A" }));
    await registryB.push("shared-id", makeMessage({ content: "to-B" }));

    expect(aReceived).toHaveLength(1);
    expect(aReceived[0]?.content).toBe("to-A");
    expect(bReceived).toHaveLength(1);
    expect(bReceived[0]?.content).toBe("to-B");

    // list() is independent.
    expect(registryA.list()).toEqual(["shared-id"]);
    expect(registryB.list()).toEqual(["shared-id"]);

    // Dispose B only; A still registered.
    const result = await registryA.push("shared-id", makeMessage({ content: "again-A" }));
    expect(result.ok).toBe(true);
  });

  // ── Concurrency ────────────────────────────────────────────

  it("concurrent pushes to the same session serialize in registration order", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const blockers: Array<Promise<void>> = [];

    for (let i = 0; i < 3; i += 1) {
      blockers.push(
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
      );
    }

    registry.register("serialize", {
      sink: async (m) => {
        order.push(`enter:${m.content}`);
        const idx = Number(m.content);
        await blockers[idx];
        order.push(`exit:${m.content}`);
      },
    });

    // Fire all three without awaiting — they must queue behind each other.
    const p0 = registry.push("serialize", makeMessage({ content: "0" }));
    const p1 = registry.push("serialize", makeMessage({ content: "1" }));
    const p2 = registry.push("serialize", makeMessage({ content: "2" }));

    // Let microtasks run so the first sink actually enters.
    await Promise.resolve();
    await Promise.resolve();

    // Only the FIRST sink should have entered; the others wait.
    expect(order).toEqual(["enter:0"]);

    // Release in order.
    releases[0]?.();
    await p0;
    expect(order).toEqual(["enter:0", "exit:0", "enter:1"]);

    releases[1]?.();
    await p1;
    expect(order).toEqual([
      "enter:0",
      "exit:0",
      "enter:1",
      "exit:1",
      "enter:2",
    ]);

    releases[2]?.();
    const r2 = await p2;
    expect(order).toEqual([
      "enter:0",
      "exit:0",
      "enter:1",
      "exit:1",
      "enter:2",
      "exit:2",
    ]);
    expect(r2.ok).toBe(true);
  });

  // ── Error isolation (QB #6) ────────────────────────────────

  it("sink throws → push returns {ok: false, reason: 'sink-error'}; never propagates", async () => {
    registry.register("throws", {
      sink: async () => {
        throw new Error("boom");
      },
    });

    const result = await registry.push("throws", makeMessage({ content: "explode" }));

    expect(result.ok).toBe(false);
    expect(result.deliveredCount).toBe(0);
    expect(result.reason).toBe("sink-error");
    expect(result.error).toBe("boom");
  });

  it("sink throwing does not break the session — later pushes still run", async () => {
    let successes = 0;
    let attempts = 0;

    registry.register("resilient", {
      sink: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("first-fails");
        successes += 1;
      },
    });

    const r1 = await registry.push("resilient", makeMessage({ content: "a" }));
    const r2 = await registry.push("resilient", makeMessage({ content: "b" }));
    const r3 = await registry.push("resilient", makeMessage({ content: "c" }));

    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe("sink-error");
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(successes).toBe(2);
    expect(attempts).toBe(3);
  });

  it("failing sink still counts against the rate-limit budget (no free bypass)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));

    registry.register("fail-counts", {
      sink: async () => {
        throw new Error("always-fails");
      },
      maxPerMinute: 2,
    });

    const r1 = await registry.push("fail-counts", makeMessage({ content: "1" }));
    const r2 = await registry.push("fail-counts", makeMessage({ content: "2" }));
    const r3 = await registry.push("fail-counts", makeMessage({ content: "3" }));

    expect(r1.reason).toBe("sink-error");
    expect(r2.reason).toBe("sink-error");
    // Budget exhausted by the two failed attempts — must NOT be free.
    expect(r3.reason).toBe("rate-limited");

    vi.useRealTimers();
  });
});
