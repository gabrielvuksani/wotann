import { describe, it, expect, beforeEach } from "vitest";
import { TemporalMemory } from "../../src/memory/temporal-memory.js";

describe("TemporalMemory", () => {
  let memory: TemporalMemory;

  beforeEach(() => {
    memory = new TemporalMemory();
  });

  describe("record", () => {
    it("records a memory entry with auto-generated ID", () => {
      const entry = memory.record("Decided to use JWT for auth", "decision");
      expect(entry.id).toMatch(/^tm_/);
      expect(entry.content).toBe("Decided to use JWT for auth");
      expect(entry.category).toBe("decision");
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it("increments entry count", () => {
      memory.record("Entry 1", "general");
      memory.record("Entry 2", "general");
      expect(memory.getEntryCount()).toBe(2);
    });

    it("stores metadata", () => {
      const entry = memory.record("Debug session", "debug", { file: "auth.ts" });
      expect(entry.metadata).toEqual({ file: "auth.ts" });
    });
  });

  describe("recordAt", () => {
    it("records with explicit timestamp", () => {
      const ts = new Date("2026-03-01T12:00:00Z").getTime();
      const entry = memory.recordAt("Past event", "decision", ts);
      expect(entry.timestamp).toBe(ts);
    });
  });

  describe("queryTimeRange", () => {
    it("returns entries within the time range", () => {
      const day1 = new Date("2026-03-01T12:00:00Z").getTime();
      const day2 = new Date("2026-03-02T12:00:00Z").getTime();
      const day3 = new Date("2026-03-03T12:00:00Z").getTime();

      memory.recordAt("Event 1", "decision", day1);
      memory.recordAt("Event 2", "decision", day2);
      memory.recordAt("Event 3", "decision", day3);

      const results = memory.queryTimeRange(
        new Date("2026-03-01T00:00:00Z"),
        new Date("2026-03-02T23:59:59Z"),
      );
      expect(results).toHaveLength(2);
    });

    it("filters by category", () => {
      const ts = new Date("2026-03-01T12:00:00Z").getTime();
      memory.recordAt("Bug fix", "debug", ts);
      memory.recordAt("Architecture choice", "decision", ts);

      const results = memory.queryTimeRange(
        new Date("2026-03-01T00:00:00Z"),
        new Date("2026-03-01T23:59:59Z"),
        "debug",
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("debug");
    });

    it("returns entries sorted by timestamp", () => {
      memory.recordAt("Later", "general", 3000);
      memory.recordAt("Earlier", "general", 1000);
      memory.recordAt("Middle", "general", 2000);

      const results = memory.queryTimeRange(new Date(0), new Date(5000));
      expect(results[0]?.content).toBe("Earlier");
      expect(results[2]?.content).toBe("Later");
    });
  });

  describe("queryNaturalTime", () => {
    it("handles 'today'", () => {
      memory.record("Today's entry", "general");
      const results = memory.queryNaturalTime("today");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("handles 'last week'", () => {
      memory.record("Recent entry", "general");
      const results = memory.queryNaturalTime("last week");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("handles 'N days ago'", () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      memory.recordAt("2 days ago entry", "general", twoDaysAgo);

      const results = memory.queryNaturalTime("2 days ago");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("handles 'last N days'", () => {
      memory.record("Recent", "general");
      const results = memory.queryNaturalTime("last 3 days");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty for unparseable expressions", () => {
      const results = memory.queryNaturalTime("when the moon is full");
      expect(results).toHaveLength(0);
    });

    it("filters by category in natural time queries", () => {
      memory.record("A debug event", "debug");
      memory.record("A decision", "decision");

      const results = memory.queryNaturalTime("today", "debug");
      expect(results.every((r) => r.category === "debug")).toBe(true);
    });
  });

  describe("getTimelineSummary", () => {
    it("summarizes entries in a time range", () => {
      const ts = Date.now();
      memory.recordAt("Event A", "decision", ts);
      memory.recordAt("Event B", "debug", ts);
      memory.recordAt("Event C", "decision", ts);

      const summary = memory.getTimelineSummary(
        new Date(ts - 1000),
        new Date(ts + 1000),
      );

      expect(summary.entryCount).toBe(3);
      expect(summary.categories).toHaveLength(2);
      expect(summary.firstEntry).not.toBeNull();
      expect(summary.lastEntry).not.toBeNull();
    });

    it("returns empty summary for empty range", () => {
      const summary = memory.getTimelineSummary(
        new Date("2020-01-01"),
        new Date("2020-01-02"),
      );
      expect(summary.entryCount).toBe(0);
      expect(summary.firstEntry).toBeNull();
    });
  });

  describe("detectTrends", () => {
    it("detects increasing trend", () => {
      // Add more recent entries than old ones
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

      // Previous window: 1 entry
      memory.recordAt("Old", "bugs", fourteenDaysAgo + 1000);

      // Recent window: 5 entries
      for (let i = 0; i < 5; i++) {
        memory.recordAt(`Recent ${i}`, "bugs", sevenDaysAgo + (i + 1) * 1000);
      }

      const trends = memory.detectTrends("bugs", 7);
      expect(trends).toHaveLength(1);
      expect(trends[0]?.direction).toBe("increasing");
      expect(trends[0]?.recentCount).toBeGreaterThan(trends[0]!.previousCount);
    });

    it("detects stable trend", () => {
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

      memory.recordAt("Old", "misc", fourteenDaysAgo + 1000);
      memory.recordAt("Recent", "misc", sevenDaysAgo + 1000);

      const trends = memory.detectTrends("misc", 7);
      expect(trends[0]?.direction).toBe("stable");
    });
  });

  describe("getCategories", () => {
    it("returns unique categories", () => {
      memory.record("A", "decision");
      memory.record("B", "debug");
      memory.record("C", "decision");

      const categories = memory.getCategories();
      expect(categories).toContain("decision");
      expect(categories).toContain("debug");
      expect(categories).toHaveLength(2);
    });
  });
});
