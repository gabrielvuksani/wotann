/**
 * Tests for V9 T11.1 wire — virtual-cursor-consumer.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { createVirtualCursorConsumer } from "../../src/orchestration/virtual-cursor-consumer.js";

function makePool() {
  let tickCalls = 0;
  return {
    spawn: vi.fn(),
    despawn: vi.fn(),
    enqueueMove: vi.fn(),
    tick: vi.fn(() => {
      tickCalls += 1;
      return [{ sessionId: "s1", x: tickCalls, y: tickCalls, color: "#fff" }];
    }),
    snapshot: vi.fn(() => []),
  };
}

describe("createVirtualCursorConsumer", () => {
  it("rejects missing options", () => {
    expect(() =>
      // @ts-expect-error — invalid input
      createVirtualCursorConsumer(null),
    ).toThrow(/options object/);
  });

  it("rejects pool without .tick()", () => {
    expect(() =>
      createVirtualCursorConsumer({
        // @ts-expect-error — invalid pool
        pool: {},
        dispatcher: () => {},
      }),
    ).toThrow(/options\.pool/);
  });

  it("rejects non-function dispatcher", () => {
    expect(() =>
      createVirtualCursorConsumer({
        // @ts-expect-error — invalid dispatcher
        pool: makePool(),
        dispatcher: 42,
      }),
    ).toThrow(/dispatcher/);
  });

  it("advance() ticks the pool and dispatches frames", async () => {
    const pool = makePool();
    const dispatcher = vi.fn();
    const consumer = createVirtualCursorConsumer({ pool, dispatcher });

    const frames = await consumer.advance();
    expect(pool.tick).toHaveBeenCalledOnce();
    expect(dispatcher).toHaveBeenCalledOnce();
    expect(frames.length).toBe(1);
  });

  it("dispatches ALL frames even on idle ticks", async () => {
    const pool = makePool();
    pool.tick = vi.fn(() => []);
    const dispatcher = vi.fn();
    const consumer = createVirtualCursorConsumer({ pool, dispatcher });

    const frames = await consumer.advance();
    expect(dispatcher).toHaveBeenCalledWith([]);
    expect(frames.length).toBe(0);
  });

  it("counts frames + ticks in diagnostics", async () => {
    const pool = makePool();
    const consumer = createVirtualCursorConsumer({ pool, dispatcher: () => {} });

    await consumer.advance();
    await consumer.advance();

    const diag = consumer.getDiagnostics();
    expect(diag.tickCount).toBe(2);
    expect(diag.framesDispatched).toBe(2);
    expect(diag.lastDispatchError).toBeNull();
    expect(diag.lastDispatchAt).toBeTruthy();
  });

  it("captures dispatcher errors in diagnostics without throwing", async () => {
    const pool = makePool();
    const dispatcher = vi.fn(() => {
      throw new Error("downstream failure");
    });
    const consumer = createVirtualCursorConsumer({ pool, dispatcher });

    await expect(consumer.advance()).resolves.toBeDefined();
    expect(consumer.getDiagnostics().lastDispatchError).toContain("downstream failure");
  });

  it("captures pool.tick() errors gracefully", async () => {
    const pool = makePool();
    pool.tick = vi.fn(() => {
      throw new Error("pool fault");
    });
    const consumer = createVirtualCursorConsumer({ pool, dispatcher: () => {} });

    const frames = await consumer.advance();
    expect(frames.length).toBe(0);
    expect(consumer.getDiagnostics().lastDispatchError).toContain("pool.tick");
  });

  it("supports async dispatcher", async () => {
    const pool = makePool();
    let resolved = false;
    const dispatcher = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      resolved = true;
    });
    const consumer = createVirtualCursorConsumer({ pool, dispatcher });

    await consumer.advance();
    expect(resolved).toBe(true);
    expect(consumer.getDiagnostics().framesDispatched).toBe(1);
  });

  it("snapshot() delegates to the pool without ticking", () => {
    const pool = makePool();
    const consumer = createVirtualCursorConsumer({ pool, dispatcher: () => {} });

    consumer.snapshot();
    expect(pool.snapshot).toHaveBeenCalledOnce();
    expect(pool.tick).not.toHaveBeenCalled();
  });

  it("resetDiagnostics() clears counters but not pool state", async () => {
    const pool = makePool();
    const consumer = createVirtualCursorConsumer({ pool, dispatcher: () => {} });

    await consumer.advance();
    consumer.resetDiagnostics();
    expect(consumer.getDiagnostics().tickCount).toBe(0);
    expect(consumer.getDiagnostics().framesDispatched).toBe(0);
    // Pool tick was still called once on the original advance — pool state is independent.
    expect(pool.tick).toHaveBeenCalledOnce();
  });
});
