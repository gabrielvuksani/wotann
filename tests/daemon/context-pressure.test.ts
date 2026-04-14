import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContextPressureMonitor,
  type ContextPressureEvent,
} from "../../src/daemon/context-pressure.js";

describe("ContextPressureMonitor", () => {
  let monitor: ContextPressureMonitor;

  beforeEach(() => {
    monitor = new ContextPressureMonitor();
  });

  // ── Constructor ────────────────────────────────────────────

  describe("constructor", () => {
    it("uses default thresholds (65% warning, 85% critical)", () => {
      // Below 65% should return null
      const below = monitor.check(6400, 10000);
      expect(below).toBeNull();

      // At 65% should trigger warning
      const atWarning = monitor.check(6500, 10000);
      expect(atWarning).not.toBeNull();
      expect(atWarning!.level).toBe("warning");

      // At 85% should trigger critical
      const atCritical = monitor.check(8500, 10000);
      expect(atCritical).not.toBeNull();
      expect(atCritical!.level).toBe("critical");
    });

    it("accepts custom thresholds", () => {
      const custom = new ContextPressureMonitor(50, 75);

      const belowWarning = custom.check(4900, 10000);
      expect(belowWarning).toBeNull();

      const atWarning = custom.check(5000, 10000);
      expect(atWarning).not.toBeNull();
      expect(atWarning!.level).toBe("warning");

      const atCritical = custom.check(7500, 10000);
      expect(atCritical).not.toBeNull();
      expect(atCritical!.level).toBe("critical");
    });

    it("throws when warning >= critical threshold", () => {
      expect(() => new ContextPressureMonitor(80, 80)).toThrow(
        "Warning threshold (80) must be less than critical threshold (80)",
      );
      expect(() => new ContextPressureMonitor(90, 80)).toThrow(
        "Warning threshold (90) must be less than critical threshold (80)",
      );
    });

    it("throws for out-of-range thresholds", () => {
      expect(() => new ContextPressureMonitor(-5, 85)).toThrow(
        "Thresholds must be between 0 and 100",
      );
      expect(() => new ContextPressureMonitor(65, 110)).toThrow(
        "Thresholds must be between 0 and 100",
      );
    });
  });

  // ── check() ────────────────────────────────────────────────

  describe("check", () => {
    it("returns null when utilization is below warning threshold", () => {
      const result = monitor.check(3000, 10000);
      expect(result).toBeNull();
    });

    it("returns a warning event at warning threshold", () => {
      const result = monitor.check(7000, 10000);
      expect(result).not.toBeNull();
      expect(result!.level).toBe("warning");
      expect(result!.utilizationPercent).toBe(70);
      expect(result!.tokensUsed).toBe(7000);
      expect(result!.tokensRemaining).toBe(3000);
      expect(result!.recommendation).toContain("70%");
      expect(result!.recommendation).toContain("compacting soon");
    });

    it("returns a critical event at critical threshold", () => {
      const result = monitor.check(9000, 10000);
      expect(result).not.toBeNull();
      expect(result!.level).toBe("critical");
      expect(result!.utilizationPercent).toBe(90);
      expect(result!.recommendation).toContain("compact immediately");
    });

    it("includes a valid timestamp", () => {
      const before = Date.now();
      const result = monitor.check(9000, 10000);
      const after = Date.now();

      expect(result).not.toBeNull();
      expect(result!.timestamp).toBeGreaterThanOrEqual(before);
      expect(result!.timestamp).toBeLessThanOrEqual(after);
    });

    it("throws for maxTokens <= 0", () => {
      expect(() => monitor.check(100, 0)).toThrow("maxTokens must be a positive number");
      expect(() => monitor.check(100, -1)).toThrow("maxTokens must be a positive number");
    });

    it("throws for negative tokensUsed", () => {
      expect(() => monitor.check(-1, 10000)).toThrow("tokensUsed must not be negative");
    });

    it("handles utilization above 100% (tokens exceed max)", () => {
      const result = monitor.check(12000, 10000);
      expect(result).not.toBeNull();
      expect(result!.level).toBe("critical");
      expect(result!.utilizationPercent).toBe(120);
      expect(result!.tokensRemaining).toBe(-2000);
    });

    it("rounds utilization to integer", () => {
      // 6666 / 10000 = 66.66... → rounds to 67
      const result = monitor.check(6666, 10000);
      expect(result).not.toBeNull();
      expect(result!.utilizationPercent).toBe(67);
    });
  });

  // ── getHistory() ───────────────────────────────────────────

  describe("getHistory", () => {
    it("returns empty array when no checks have triggered", () => {
      monitor.check(1000, 10000); // below threshold, no event stored
      expect(monitor.getHistory()).toEqual([]);
    });

    it("returns events in reverse chronological order", () => {
      monitor.check(7000, 10000); // warning
      monitor.check(9000, 10000); // critical

      const history = monitor.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.level).toBe("critical");
      expect(history[1]!.level).toBe("warning");
    });

    it("respects limit parameter", () => {
      monitor.check(7000, 10000);
      monitor.check(8000, 10000);
      monitor.check(9000, 10000);

      const limited = monitor.getHistory(2);
      expect(limited).toHaveLength(2);
      expect(limited[0]!.level).toBe("critical");
      expect(limited[1]!.level).toBe("warning");
    });

    it("returns a readonly array (immutable)", () => {
      monitor.check(7000, 10000);
      const history = monitor.getHistory();

      // TypeScript enforces readonly, but verify it returns a new array
      expect(history).not.toBe(monitor.getHistory());
    });
  });

  // ── reset() ────────────────────────────────────────────────

  describe("reset", () => {
    it("clears all history", () => {
      monitor.check(7000, 10000);
      monitor.check(9000, 10000);
      expect(monitor.getHistory()).toHaveLength(2);

      monitor.reset();
      expect(monitor.getHistory()).toHaveLength(0);
    });

    it("allows new events after reset", () => {
      monitor.check(7000, 10000);
      monitor.reset();

      const event = monitor.check(9000, 10000);
      expect(event).not.toBeNull();
      expect(monitor.getHistory()).toHaveLength(1);
    });
  });

  // ── History cap ────────────────────────────────────────────

  describe("history cap", () => {
    it("trims oldest events when exceeding max history (200)", () => {
      // Generate 210 events (all above warning threshold)
      for (let i = 0; i < 210; i++) {
        monitor.check(7000, 10000);
      }

      const history = monitor.getHistory();
      expect(history.length).toBeLessThanOrEqual(200);
    });
  });
});
