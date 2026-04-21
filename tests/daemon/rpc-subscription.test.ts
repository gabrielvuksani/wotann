/**
 * Tests for RpcSubscriptionManager — shared subscription scaffolding
 * used by F1/F5/F6/F9/F12/F13/F15 polling subscriptions (P1-F8).
 *
 * Each test pins down ONE invariant so regressions surface quickly when
 * individual subscription call sites migrate to the shared helper.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RpcSubscriptionManager,
  ErrorUnknownSubscription,
} from "../../src/daemon/rpc-subscription.js";

interface TestEvent {
  readonly seq: number;
  readonly payload: string;
}

describe("RpcSubscriptionManager", () => {
  let mgr: RpcSubscriptionManager<TestEvent>;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new RpcSubscriptionManager<TestEvent>({
      idPrefix: "test",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("subscribe", () => {
    it("returns a subscriptionId with the configured prefix", () => {
      const { subscriptionId } = mgr.subscribe();
      expect(subscriptionId.startsWith("test-")).toBe(true);
    });

    it("returns empty snapshot when no events are seeded", () => {
      const { snapshot } = mgr.subscribe();
      expect(snapshot).toEqual([]);
    });

    it("returns the provided snapshot seed from subscribe()", () => {
      const seed: TestEvent[] = [
        { seq: 1, payload: "a" },
        { seq: 2, payload: "b" },
      ];
      const { snapshot } = mgr.subscribe({ seed });
      expect(snapshot).toEqual(seed);
    });

    it("produces unique ids across subscribers", () => {
      const a = mgr.subscribe().subscriptionId;
      const b = mgr.subscribe().subscriptionId;
      expect(a).not.toBe(b);
    });
  });

  describe("emit + poll", () => {
    it("fans emitted events to every open subscriber", () => {
      const a = mgr.subscribe();
      const b = mgr.subscribe();
      mgr.emit({ seq: 1, payload: "x" });
      mgr.emit({ seq: 2, payload: "y" });

      const pa = mgr.poll(a.subscriptionId);
      const pb = mgr.poll(b.subscriptionId);
      expect(pa.events).toEqual([
        { seq: 1, payload: "x" },
        { seq: 2, payload: "y" },
      ]);
      expect(pb.events).toEqual([
        { seq: 1, payload: "x" },
        { seq: 2, payload: "y" },
      ]);
      expect(pa.closed).toBe(false);
      expect(pb.closed).toBe(false);
      expect(pa.sentOverflow).toBe(false);
    });

    it("drains the buffer on poll so subsequent polls return nothing new", () => {
      const { subscriptionId } = mgr.subscribe();
      mgr.emit({ seq: 1, payload: "x" });
      const first = mgr.poll(subscriptionId);
      const second = mgr.poll(subscriptionId);

      expect(first.events).toHaveLength(1);
      expect(second.events).toEqual([]);
      expect(second.closed).toBe(false);
    });

    it("delivers events to each subscriber independently (isolation)", () => {
      const a = mgr.subscribe();
      mgr.emit({ seq: 1, payload: "x" });
      // b subscribes AFTER event 1, should not receive it
      const b = mgr.subscribe();
      mgr.emit({ seq: 2, payload: "y" });

      const pa = mgr.poll(a.subscriptionId);
      const pb = mgr.poll(b.subscriptionId);
      expect(pa.events.map((e) => e.seq)).toEqual([1, 2]);
      expect(pb.events.map((e) => e.seq)).toEqual([2]);
    });

    it("honors maxEvents to bound a single poll's return size", () => {
      const { subscriptionId } = mgr.subscribe();
      for (let i = 0; i < 10; i++) mgr.emit({ seq: i, payload: `e${i}` });
      const first = mgr.poll(subscriptionId, { maxEvents: 4 });
      expect(first.events).toHaveLength(4);
      expect(first.events[0]?.seq).toBe(0);
      const second = mgr.poll(subscriptionId);
      expect(second.events).toHaveLength(6);
    });
  });

  describe("overflow", () => {
    it("drops oldest events when buffer exceeds the bound and sets sentOverflow=true", () => {
      const small = new RpcSubscriptionManager<TestEvent>({
        idPrefix: "ov",
        maxBuffer: 4,
      });
      const { subscriptionId } = small.subscribe();
      for (let i = 0; i < 6; i++) small.emit({ seq: i, payload: `e${i}` });
      const result = small.poll(subscriptionId);
      // Oldest two (seq 0, 1) dropped; newest four (seq 2-5) preserved.
      expect(result.events.map((e) => e.seq)).toEqual([2, 3, 4, 5]);
      expect(result.sentOverflow).toBe(true);
    });

    it("clears sentOverflow after it is observed so later polls don't re-flag", () => {
      const small = new RpcSubscriptionManager<TestEvent>({
        idPrefix: "ov",
        maxBuffer: 2,
      });
      const { subscriptionId } = small.subscribe();
      for (let i = 0; i < 5; i++) small.emit({ seq: i, payload: `e${i}` });
      const first = small.poll(subscriptionId);
      expect(first.sentOverflow).toBe(true);
      small.emit({ seq: 99, payload: "next" });
      const second = small.poll(subscriptionId);
      expect(second.sentOverflow).toBe(false);
      expect(second.events.map((e) => e.seq)).toEqual([99]);
    });
  });

  describe("close", () => {
    it("close() + later poll returns { closed: true, events: [] }", () => {
      const { subscriptionId } = mgr.subscribe();
      mgr.emit({ seq: 1, payload: "a" });
      mgr.close(subscriptionId);
      const result = mgr.poll(subscriptionId);
      expect(result.closed).toBe(true);
      expect(result.events).toEqual([]);
    });

    it("closed subscription no longer receives new emits", () => {
      const a = mgr.subscribe();
      const b = mgr.subscribe();
      mgr.close(a.subscriptionId);
      mgr.emit({ seq: 1, payload: "x" });
      const pb = mgr.poll(b.subscriptionId);
      const pa = mgr.poll(a.subscriptionId);
      expect(pb.events).toHaveLength(1);
      expect(pa.events).toHaveLength(0);
      expect(pa.closed).toBe(true);
    });

    it("poll options.close=true closes the subscription in-band", () => {
      const { subscriptionId } = mgr.subscribe();
      mgr.emit({ seq: 1, payload: "a" });
      const result = mgr.poll(subscriptionId, { close: true });
      expect(result.closed).toBe(true);
      expect(result.events).toHaveLength(1);
      // Subsequent poll sees closed
      const next = mgr.poll(subscriptionId);
      expect(next.closed).toBe(true);
      expect(next.events).toEqual([]);
    });
  });

  describe("unknown subscription", () => {
    it("poll on unknown id throws ErrorUnknownSubscription (honest, not silent empty)", () => {
      expect(() => mgr.poll("does-not-exist")).toThrow(ErrorUnknownSubscription);
      expect(() => mgr.poll("does-not-exist")).toThrow(/does-not-exist/);
    });

    it("ErrorUnknownSubscription carries a discriminable .code", () => {
      try {
        mgr.poll("missing");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ErrorUnknownSubscription);
        expect((err as ErrorUnknownSubscription).code).toBe("SUBSCRIPTION_UNKNOWN");
        expect((err as ErrorUnknownSubscription).subscriptionId).toBe("missing");
      }
    });

    it("close() on unknown id is a no-op (idempotent close is safe)", () => {
      expect(() => mgr.close("never-existed")).not.toThrow();
    });
  });

  describe("stale-subscription sweep", () => {
    it("auto-closes subscriptions that haven't polled for staleAfterMs", () => {
      const stale = new RpcSubscriptionManager<TestEvent>({
        idPrefix: "st",
        staleAfterMs: 5 * 60 * 1000,
      });
      const { subscriptionId } = stale.subscribe();
      stale.emit({ seq: 1, payload: "pre" });

      vi.advanceTimersByTime(6 * 60 * 1000);
      stale.sweepStale();

      const result = stale.poll(subscriptionId);
      expect(result.closed).toBe(true);
      expect(result.events).toEqual([]);
    });

    it("poll resets the stale timer so active subscribers are not swept", () => {
      const stale = new RpcSubscriptionManager<TestEvent>({
        idPrefix: "st",
        staleAfterMs: 5 * 60 * 1000,
      });
      const { subscriptionId } = stale.subscribe();
      stale.emit({ seq: 1, payload: "a" });

      vi.advanceTimersByTime(3 * 60 * 1000);
      stale.poll(subscriptionId);
      vi.advanceTimersByTime(3 * 60 * 1000);
      stale.sweepStale();

      stale.emit({ seq: 2, payload: "b" });
      const result = stale.poll(subscriptionId);
      expect(result.closed).toBe(false);
      expect(result.events.map((e) => e.seq)).toEqual([2]);
    });
  });

  describe("instance isolation (QB #7 — per-instance state)", () => {
    it("two managers do not share subscriptions or buffers", () => {
      const first = new RpcSubscriptionManager<TestEvent>({ idPrefix: "a" });
      const second = new RpcSubscriptionManager<TestEvent>({ idPrefix: "b" });
      const a = first.subscribe();
      const b = second.subscribe();
      first.emit({ seq: 1, payload: "first-only" });
      const pa = first.poll(a.subscriptionId);
      const pb = second.poll(b.subscriptionId);
      expect(pa.events).toHaveLength(1);
      expect(pb.events).toHaveLength(0);
    });

    it("a manager reports its active subscription count (honest introspection)", () => {
      expect(mgr.activeCount()).toBe(0);
      const a = mgr.subscribe();
      mgr.subscribe();
      expect(mgr.activeCount()).toBe(2);
      mgr.close(a.subscriptionId);
      expect(mgr.activeCount()).toBe(1);
    });
  });

  describe("generic type parameter preservation", () => {
    it("compiles with a domain-specific event type without any casts", () => {
      interface ApprovalLikeEvent {
        readonly kind: "approve" | "deny" | "expire";
        readonly at: number;
      }
      const typed = new RpcSubscriptionManager<ApprovalLikeEvent>({
        idPrefix: "app",
      });
      const { subscriptionId } = typed.subscribe();
      typed.emit({ kind: "approve", at: 1 });
      const { events } = typed.poll(subscriptionId);
      // TypeScript sees events[0].kind as "approve" | "deny" | "expire"
      expect(events[0]?.kind).toBe("approve");
      expect(events[0]?.at).toBe(1);
    });
  });

  describe("concurrent emit during poll", () => {
    it("poll returns a stable snapshot even when emit interleaves", () => {
      const { subscriptionId } = mgr.subscribe();
      for (let i = 0; i < 5; i++) mgr.emit({ seq: i, payload: `a${i}` });

      const first = mgr.poll(subscriptionId);
      // An emit that happened-after the poll must land in the NEXT poll.
      mgr.emit({ seq: 99, payload: "after" });
      const second = mgr.poll(subscriptionId);

      expect(first.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
      expect(second.events.map((e) => e.seq)).toEqual([99]);
    });
  });
});
