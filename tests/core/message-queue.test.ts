/**
 * Tests for the per-session mid-stream MessageQueue.
 *
 * Mirrors the semantics from langchain-ai/open-swe
 * agent/middleware/check_message_queue.py:1-100 — FIFO drain, clear on
 * read, per-instance isolation. The queue is in-memory so tests stay
 * synchronous and fast; no graph-store stubbing required.
 */

import { describe, it, expect, vi } from "vitest";
import {
  MessageQueue,
  makeMessageQueue,
  DEFAULT_MAX_QUEUE_SIZE,
  type PendingMessage,
} from "../../src/core/message-queue.js";

describe("MessageQueue", () => {
  it("enqueue then drain returns messages in FIFO order", () => {
    const q = makeMessageQueue();
    q.enqueue("first");
    q.enqueue("second");
    q.enqueue("third");

    const drained = q.drain();
    expect(drained.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("drain clears the queue", () => {
    const q = makeMessageQueue();
    q.enqueue("alpha");
    q.enqueue("beta");
    expect(q.size()).toBe(2);

    q.drain();
    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it("multiple enqueue/drain cycles work independently", () => {
    const q = makeMessageQueue();

    q.enqueue("a1");
    q.enqueue("a2");
    expect(q.drain().map((m) => m.content)).toEqual(["a1", "a2"]);

    q.enqueue("b1");
    expect(q.drain().map((m) => m.content)).toEqual(["b1"]);

    expect(q.size()).toBe(0);
  });

  it("peek returns a snapshot without clearing", () => {
    const q = makeMessageQueue();
    q.enqueue("one");
    q.enqueue("two");

    const peeked = q.peek();
    expect(peeked.map((m) => m.content)).toEqual(["one", "two"]);
    expect(q.size()).toBe(2);

    // mutating the snapshot must not affect the queue (copy semantics)
    (peeked as PendingMessage[]).pop();
    expect(q.size()).toBe(2);
  });

  it("two queue instances are isolated (per-instance state, not module-global)", () => {
    const a = makeMessageQueue();
    const b = makeMessageQueue();

    a.enqueue("a-msg");
    expect(a.size()).toBe(1);
    expect(b.size()).toBe(0);

    b.enqueue("b-msg");
    expect(a.drain().map((m) => m.content)).toEqual(["a-msg"]);
    expect(b.drain().map((m) => m.content)).toEqual(["b-msg"]);
  });

  it("ignores empty / whitespace-only / non-string content", () => {
    const q = makeMessageQueue();
    q.enqueue("");
    q.enqueue("   ");
    q.enqueue("\n\t  ");
    // simulate an upstream caller that passes non-strings
    q.enqueue(undefined as unknown as string);
    q.enqueue(null as unknown as string);
    q.enqueue(42 as unknown as string);

    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it("trims surrounding whitespace on enqueue", () => {
    const q = makeMessageQueue();
    q.enqueue("  padded  ");

    const drained = q.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.content).toBe("padded");
  });

  it("attaches a monotonic-ish timestamp to each message", () => {
    const q = makeMessageQueue();
    const before = Date.now();
    q.enqueue("ts-test");
    const after = Date.now();

    const drained = q.drain();
    expect(drained).toHaveLength(1);
    const ts = drained[0]!.timestamp;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("drops oldest when capacity is exceeded (ring-buffer semantics)", () => {
    const q = new MessageQueue(2);
    q.enqueue("first");
    q.enqueue("second");
    q.enqueue("third"); // pushes "first" out

    const drained = q.drain();
    expect(drained.map((m) => m.content)).toEqual(["second", "third"]);
  });

  it("default max queue size is reasonable and enforced", () => {
    expect(DEFAULT_MAX_QUEUE_SIZE).toBeGreaterThan(0);
    expect(DEFAULT_MAX_QUEUE_SIZE).toBeLessThanOrEqual(1024);

    const q = new MessageQueue(DEFAULT_MAX_QUEUE_SIZE);
    for (let i = 0; i < DEFAULT_MAX_QUEUE_SIZE + 5; i += 1) {
      q.enqueue(`msg-${i}`);
    }
    expect(q.size()).toBe(DEFAULT_MAX_QUEUE_SIZE);
    const drained = q.drain();
    // first 5 should have been dropped, last DEFAULT_MAX_QUEUE_SIZE retained
    expect(drained[0]!.content).toBe("msg-5");
    expect(drained[drained.length - 1]!.content).toBe(`msg-${DEFAULT_MAX_QUEUE_SIZE + 4}`);
  });

  it("rejects non-positive or non-finite max sizes", () => {
    expect(() => new MessageQueue(0)).toThrow(RangeError);
    expect(() => new MessageQueue(-1)).toThrow(RangeError);
    expect(() => new MessageQueue(Number.NaN)).toThrow(RangeError);
    expect(() => new MessageQueue(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("clear discards without returning, drain returns and discards", () => {
    const q = makeMessageQueue();
    q.enqueue("kept");
    q.enqueue("kept2");

    q.clear();
    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it("preserves enqueue order across rapid same-millisecond pushes", () => {
    // Force Date.now() to return a constant so we exercise the
    // insertion-order path directly (guard against any future "sort by
    // timestamp" regressions that would break FIFO).
    const stub = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      const q = makeMessageQueue();
      q.enqueue("x");
      q.enqueue("y");
      q.enqueue("z");

      const drained = q.drain();
      expect(drained.map((m) => m.content)).toEqual(["x", "y", "z"]);
      expect(drained.every((m) => m.timestamp === 1_000_000)).toBe(true);
    } finally {
      stub.mockRestore();
    }
  });
});
