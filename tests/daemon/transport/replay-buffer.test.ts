/**
 * Tests for src/daemon/transport/replay-buffer.ts (T12.18).
 *
 * Asserts the documented integration matrix from V9 §T12.18 line 3147:
 *   - append + since(0) → all events returned, monotonic seqs
 *   - replay after capacity overflow → oldest evicted, stale-seq surfaced
 *   - replay exact boundary → only frames with seq > lastSeq
 *   - replay future seq → empty, ok:true
 *   - concurrent appends (sync) → unique monotonic seqs
 *   - reconnect flow → since(50) returns 51..N
 *
 * Plus correctness tests for ctor validation, snapshot immutability,
 * payload retention toggle, deterministic clock injection, and the
 * QB-#6 honest-stub posture on stale-seq.
 */

import { describe, it, expect, vi } from "vitest";
import {
  ReplayBuffer,
  DEFAULT_CAPACITY,
  type WsEvent,
} from "../../../src/daemon/transport/replay-buffer.js";

// ── Helpers ────────────────────────────────────────────

function makeBuffer<T>(capacity?: number) {
  return new ReplayBuffer<T>(capacity !== undefined ? { capacity } : {});
}

function appendN<T>(buf: ReplayBuffer<T>, payloads: readonly T[]): WsEvent<T>[] {
  return payloads.map((p) => buf.append(p));
}

// ── Constructor / config ──────────────────────────────

describe("ReplayBuffer constructor", () => {
  it("uses DEFAULT_CAPACITY when not specified", () => {
    const buf = new ReplayBuffer();
    expect(buf.cap).toBe(DEFAULT_CAPACITY);
    expect(DEFAULT_CAPACITY).toBe(64);
  });

  it("rejects capacity < 1 with RangeError (QB #6 honest stub)", () => {
    expect(() => new ReplayBuffer({ capacity: 0 })).toThrow(RangeError);
    expect(() => new ReplayBuffer({ capacity: -5 })).toThrow(RangeError);
  });

  it("rejects non-finite capacity", () => {
    expect(() => new ReplayBuffer({ capacity: Infinity })).toThrow(RangeError);
    expect(() => new ReplayBuffer({ capacity: NaN })).toThrow(RangeError);
  });

  it("floors fractional capacity", () => {
    const buf = new ReplayBuffer({ capacity: 3.7 });
    expect(buf.cap).toBe(3);
  });
});

// ── append + since ────────────────────────────────────

describe("append + since(lastSeq)", () => {
  it("append + since(0) returns every event with monotonic seqs (matrix row 1)", () => {
    const buf = makeBuffer<string>(64);
    appendN(buf, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const result = buf.since(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.newestSeq).toBe(10);
    expect(result.oldestSeq).toBe(1);
  });

  it("returns empty array (ok:true) when caller already has every frame (matrix row 4 future seq)", () => {
    const buf = makeBuffer<number>();
    appendN(buf, [1, 2, 3]);
    const result = buf.since(500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toEqual([]);
    expect(result.newestSeq).toBe(3);
  });

  it("replay-exact-boundary — since(N-1) returns 1 frame: seq N (matrix row 3)", () => {
    const buf = makeBuffer<number>();
    appendN(buf, Array.from({ length: 100 }, (_, i) => i));
    const result = buf.since(99);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.length).toBe(1);
    expect(result.frames[0]?.seq).toBe(100);
  });

  it("treats negative lastSeq as 0 (replay everything)", () => {
    const buf = makeBuffer<string>();
    appendN(buf, ["x", "y"]);
    const result = buf.since(-100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.length).toBe(2);
  });

  it("treats non-finite lastSeq as 0 (defensive)", () => {
    const buf = makeBuffer<string>();
    appendN(buf, ["x", "y"]);
    const result = buf.since(Number.NaN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.length).toBe(2);
  });

  it("empty buffer + any lastSeq returns ok:true with empty frames", () => {
    const buf = makeBuffer<string>();
    const result = buf.since(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toEqual([]);
    expect(result.oldestSeq).toBe(0);
    expect(result.newestSeq).toBe(0);
  });
});

// ── Capacity overflow & eviction ──────────────────────

describe("capacity overflow + eviction", () => {
  it("evicts oldest frames when capacity exceeded; nextSeq keeps growing (matrix row 2)", () => {
    const buf = makeBuffer<number>(2000);
    for (let i = 0; i < 3000; i++) buf.append(i);
    expect(buf.size).toBe(2000);
    expect(buf.newestSeq).toBe(3000);
    expect(buf.oldestSeq).toBe(1001); // first 1000 evicted
  });

  it("returns stale-seq error when client lastSeq is older than evicted frames (matrix row 2 cont.)", () => {
    const buf = makeBuffer<number>(2000);
    for (let i = 0; i < 3000; i++) buf.append(i);
    const result = buf.since(500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("stale-seq");
    expect(result.requestedSeq).toBe(500);
    expect(result.oldestSeq).toBe(1001);
    expect(result.newestSeq).toBe(3000);
  });

  it("stale-seq is honest-stub, no fallback (QB #6)", () => {
    const buf = makeBuffer<string>(3);
    appendN(buf, ["a", "b", "c", "d", "e", "f"]); // last 3 retained: d(4),e(5),f(6)
    const result = buf.since(0);
    // 0 is well behind oldest (4). 0 < 4 - 1 = 3 → stale.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("stale-seq");
  });

  it("capacity-1 boundary — lastSeq == oldest-1 still ok", () => {
    const buf = makeBuffer<string>(3);
    appendN(buf, ["a", "b", "c", "d", "e"]); // retains seq 3,4,5; oldest=3
    const result = buf.since(2); // 2 == oldest-1, replays 3,4,5
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.map((e) => e.seq)).toEqual([3, 4, 5]);
  });
});

// ── Reconnect flow (matrix row 6) ─────────────────────

describe("reconnect flow", () => {
  it("client at seq 50 reconnects, server replays 51+ in order (matrix row 6)", () => {
    const buf = makeBuffer<number>(200);
    for (let i = 0; i < 100; i++) buf.append(i);
    const result = buf.since(50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.length).toBe(50);
    expect(result.frames[0]?.seq).toBe(51);
    expect(result.frames[result.frames.length - 1]?.seq).toBe(100);
  });
});

// ── Concurrency (synchronous) ─────────────────────────

describe("concurrent appends (synchronous) — unique monotonic seqs (matrix row 5)", () => {
  it("10 sync appends produce unique monotonic seqs starting at 1", () => {
    const buf = makeBuffer<number>();
    const events = appendN(
      buf,
      Array.from({ length: 10 }, (_, i) => i),
    );
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(seqs).size).toBe(10);
  });

  it("seqs survive eviction (never re-used)", () => {
    const buf = makeBuffer<number>(3);
    appendN(buf, [10, 20, 30, 40, 50]);
    expect(buf.newestSeq).toBe(5);
    expect(buf.oldestSeq).toBe(3);
    const result = buf.since(2);
    if (!result.ok) throw new Error("expected ok");
    expect(result.frames.map((e) => e.seq)).toEqual([3, 4, 5]);
  });
});

// ── Payload + serialisation ───────────────────────────

describe("payload retention + serialisation", () => {
  it("retains payload by default", () => {
    const buf = new ReplayBuffer<{ kind: string }>();
    const ev = buf.append({ kind: "tool-output" });
    expect(ev.payload).toEqual({ kind: "tool-output" });
  });

  it("drops payload when retainPayload=false", () => {
    const buf = new ReplayBuffer<{ kind: string }>({ retainPayload: false });
    const ev = buf.append({ kind: "tool-output" });
    expect(ev.payload).toBeUndefined();
    expect(ev.json).toContain("tool-output");
  });

  it("uses injected serializer instead of JSON.stringify", () => {
    const fakeSerialize = vi.fn().mockReturnValue("CUSTOM");
    const buf = new ReplayBuffer<unknown>({ serialize: fakeSerialize });
    const ev = buf.append({ x: 1 });
    expect(fakeSerialize).toHaveBeenCalledWith({ x: 1 });
    expect(ev.json).toBe("CUSTOM");
  });

  it("uses injected clock for deterministic timestamps", () => {
    const buf = new ReplayBuffer<string>({ now: () => 12345 });
    const ev = buf.append("hi");
    expect(ev.timestamp).toBe(12345);
  });
});

// ── Snapshot immutability ─────────────────────────────

describe("snapshot()", () => {
  it("returns frozen copy that doesn't track future appends", () => {
    const buf = new ReplayBuffer<string>();
    buf.append("a");
    const snap = buf.snapshot();
    expect(snap.length).toBe(1);
    buf.append("b");
    expect(snap.length).toBe(1); // snapshot is independent
    expect(buf.snapshot().length).toBe(2);
    expect(Object.isFrozen(snap)).toBe(true);
  });
});

// ── clear() ───────────────────────────────────────────

describe("clear()", () => {
  it("removes retained frames but does not reset seqs", () => {
    const buf = new ReplayBuffer<string>();
    buf.append("a");
    buf.append("b");
    expect(buf.size).toBe(2);
    expect(buf.newestSeq).toBe(2);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.newestSeq).toBe(2); // seqs are NOT reset
    const ev = buf.append("c");
    expect(ev.seq).toBe(3);
  });
});

// ── Per-session isolation (QB #7) ─────────────────────

describe("per-session isolation (QB #7)", () => {
  it("two ReplayBuffer instances are completely independent", () => {
    const a = new ReplayBuffer<string>({ capacity: 4 });
    const b = new ReplayBuffer<string>({ capacity: 4 });
    a.append("a1");
    a.append("a2");
    b.append("b1");
    expect(a.newestSeq).toBe(2);
    expect(b.newestSeq).toBe(1);
    const ra = a.since(0);
    const rb = b.since(0);
    if (!ra.ok || !rb.ok) throw new Error("expected ok");
    expect(ra.frames.length).toBe(2);
    expect(rb.frames.length).toBe(1);
  });
});
