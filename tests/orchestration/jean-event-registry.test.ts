import { describe, it, expect, beforeEach } from "vitest";
import {
  EventRegistry,
  EventRegistryError,
  type ProcessEvent,
} from "../../src/orchestration/jean-registries/event-registry.js";

describe("EventRegistry (Jean §2.4 port — bounded per-pid event stream)", () => {
  let registry: EventRegistry;

  beforeEach(() => {
    registry = new EventRegistry({ bufferSize: 5 });
  });

  const mkEvent = (
    pid: number,
    kind: ProcessEvent["kind"],
    data: string = "",
  ): ProcessEvent => ({
    pid,
    kind,
    timestamp: Date.now(),
    data,
  });

  describe("emit", () => {
    it("stores events per pid", () => {
      registry.emit(mkEvent(1, "started"));
      registry.emit(mkEvent(1, "stdout", "hello"));
      const events = registry.history(1);
      expect(events).toHaveLength(2);
      expect(events[0]?.kind).toBe("started");
      expect(events[1]?.data).toBe("hello");
    });

    it("isolates events between pids", () => {
      registry.emit(mkEvent(1, "started"));
      registry.emit(mkEvent(2, "started"));
      expect(registry.history(1)).toHaveLength(1);
      expect(registry.history(2)).toHaveLength(1);
    });

    it("rejects events with non-positive pid", () => {
      expect(() => registry.emit(mkEvent(0, "started"))).toThrow(
        EventRegistryError,
      );
    });
  });

  describe("FIFO eviction when buffer is full", () => {
    it("evicts oldest event once bufferSize is exceeded", () => {
      for (let i = 0; i < 7; i++) {
        registry.emit(mkEvent(1, "stdout", `line-${i}`));
      }
      const events = registry.history(1);
      // bufferSize=5 → only last 5 kept
      expect(events).toHaveLength(5);
      expect(events[0]?.data).toBe("line-2");
      expect(events[4]?.data).toBe("line-6");
    });

    it("maintains FIFO order after eviction", () => {
      for (let i = 0; i < 10; i++) {
        registry.emit(mkEvent(1, "stdout", `${i}`));
      }
      const events = registry.history(1);
      const datas = events.map((e) => e.data);
      // Strictly ascending order by insertion
      expect(datas).toEqual(["5", "6", "7", "8", "9"]);
    });
  });

  describe("subscribe", () => {
    it("delivers subsequent events to pid-specific listeners", () => {
      const received: ProcessEvent[] = [];
      const unsub = registry.subscribe(1, (e) => received.push(e));
      registry.emit(mkEvent(1, "started"));
      registry.emit(mkEvent(1, "stdout", "x"));
      registry.emit(mkEvent(2, "started")); // other pid — must not leak
      expect(received).toHaveLength(2);
      expect(received[0]?.kind).toBe("started");
      expect(received[1]?.data).toBe("x");
      unsub();
      registry.emit(mkEvent(1, "exited"));
      expect(received).toHaveLength(2); // post-unsub events ignored
    });

    it("broadcast listener receives all pids", () => {
      const received: ProcessEvent[] = [];
      registry.subscribeAll((e) => received.push(e));
      registry.emit(mkEvent(1, "started"));
      registry.emit(mkEvent(2, "stderr", "oops"));
      expect(received).toHaveLength(2);
      expect(received.map((e) => e.pid)).toEqual([1, 2]);
    });

    it("handles listener exceptions without dropping subsequent deliveries", () => {
      const good: ProcessEvent[] = [];
      registry.subscribe(1, () => {
        throw new Error("listener boom");
      });
      registry.subscribe(1, (e) => good.push(e));
      registry.emit(mkEvent(1, "started"));
      expect(good).toHaveLength(1);
    });
  });

  describe("clear / forget", () => {
    it("forget removes history + listeners for a pid", () => {
      registry.emit(mkEvent(1, "started"));
      registry.forget(1);
      expect(registry.history(1)).toEqual([]);
    });
  });

  describe("per-instance isolation (Quality Bar #7)", () => {
    it("two registries don't share state", () => {
      const a = new EventRegistry();
      const b = new EventRegistry();
      a.emit(mkEvent(1, "started"));
      expect(a.history(1)).toHaveLength(1);
      expect(b.history(1)).toHaveLength(0);
    });
  });
});
