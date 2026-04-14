import { describe, it, expect, beforeEach } from "vitest";
import {
  TemporalMemory,
  formatDuration,
  formatTimeAgo,
} from "../../src/memory/temporal-memory.js";

// -- Timestamp helpers -------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ts(isoDate: string): number {
  return new Date(isoDate).getTime();
}

// -- Tests -------------------------------------------------------------------

describe("Temporal QA primitives (LoCoMo-inspired)", () => {
  let memory: TemporalMemory;

  // Timeline:
  //   Day 1: "Started project" (decision)
  //   Day 2: "Chose React framework" (decision)
  //   Day 3: "Fixed auth bug" (debug)
  //   Day 4: "Deployed to staging" (ops)
  //   Day 5: "Found memory leak" (debug)
  //   Day 6: "Released v1.0" (release)

  const day1 = ts("2026-03-01T10:00:00Z");
  const day2 = ts("2026-03-02T10:00:00Z");
  const day3 = ts("2026-03-03T10:00:00Z");
  const day4 = ts("2026-03-04T10:00:00Z");
  const day5 = ts("2026-03-05T10:00:00Z");
  const day6 = ts("2026-03-06T10:00:00Z");

  beforeEach(() => {
    memory = new TemporalMemory();
    memory.recordAt("Started project", "decision", day1);
    memory.recordAt("Chose React framework", "decision", day2);
    memory.recordAt("Fixed auth bug", "debug", day3);
    memory.recordAt("Deployed to staging", "ops", day4);
    memory.recordAt("Found memory leak", "debug", day5);
    memory.recordAt("Released v1.0", "release", day6);
  });

  // ---------- queryBeforeEvent ------------------------------------------------

  describe("queryBeforeEvent", () => {
    it("returns entries before the matched event, most-recent-first", () => {
      const results = memory.queryBeforeEvent("Deployed to staging");
      expect(results).toHaveLength(3);
      expect(results[0]?.content).toBe("Fixed auth bug");
      expect(results[1]?.content).toBe("Chose React framework");
      expect(results[2]?.content).toBe("Started project");
    });

    it("filters by category", () => {
      const results = memory.queryBeforeEvent("Deployed to staging", "decision");
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.category === "decision")).toBe(true);
    });

    it("respects limit parameter", () => {
      const results = memory.queryBeforeEvent("Released v1.0", undefined, 2);
      expect(results).toHaveLength(2);
    });

    it("returns empty array when event not found", () => {
      const results = memory.queryBeforeEvent("nonexistent event");
      expect(results).toHaveLength(0);
    });

    it("returns empty array when nothing is before the first event", () => {
      const results = memory.queryBeforeEvent("Started project");
      expect(results).toHaveLength(0);
    });

    it("matches case-insensitively", () => {
      const results = memory.queryBeforeEvent("DEPLOYED TO STAGING");
      expect(results).toHaveLength(3);
    });
  });

  // ---------- queryAfterEvent -------------------------------------------------

  describe("queryAfterEvent", () => {
    it("returns entries after the matched event, earliest-first", () => {
      const results = memory.queryAfterEvent("Fixed auth bug");
      expect(results).toHaveLength(3);
      expect(results[0]?.content).toBe("Deployed to staging");
      expect(results[1]?.content).toBe("Found memory leak");
      expect(results[2]?.content).toBe("Released v1.0");
    });

    it("filters by category", () => {
      const results = memory.queryAfterEvent("Started project", "debug");
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.category === "debug")).toBe(true);
    });

    it("respects limit parameter", () => {
      const results = memory.queryAfterEvent("Started project", undefined, 2);
      expect(results).toHaveLength(2);
    });

    it("returns empty array when event not found", () => {
      const results = memory.queryAfterEvent("nonexistent event");
      expect(results).toHaveLength(0);
    });

    it("returns empty array when nothing is after the last event", () => {
      const results = memory.queryAfterEvent("Released v1.0");
      expect(results).toHaveLength(0);
    });
  });

  // ---------- timeSinceEvent --------------------------------------------------

  describe("timeSinceEvent", () => {
    it("returns null when event not found", () => {
      const result = memory.timeSinceEvent("nonexistent");
      expect(result).toBeNull();
    });

    it("returns a positive millisecond value for past events", () => {
      const result = memory.timeSinceEvent("Started project");
      expect(result).not.toBeNull();
      expect(result!.found).toBe(true);
      expect(result!.milliseconds).toBeGreaterThan(0);
    });

    it("returns a human-readable string", () => {
      const result = memory.timeSinceEvent("Started project");
      expect(result!.human).toMatch(/ago$/);
    });
  });

  // ---------- eventOrdering ---------------------------------------------------

  describe("eventOrdering", () => {
    it("returns events in chronological order with 1-based positions", () => {
      const results = memory.eventOrdering([
        "Released v1.0",
        "Started project",
        "Fixed auth bug",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]?.content).toBe("Started project");
      expect(results[0]?.position).toBe(1);
      expect(results[1]?.content).toBe("Fixed auth bug");
      expect(results[1]?.position).toBe(2);
      expect(results[2]?.content).toBe("Released v1.0");
      expect(results[2]?.position).toBe(3);
    });

    it("skips events that are not found", () => {
      const results = memory.eventOrdering([
        "Released v1.0",
        "This does not exist",
        "Started project",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]?.position).toBe(1);
      expect(results[1]?.position).toBe(2);
    });

    it("returns empty array when no events match", () => {
      const results = memory.eventOrdering(["nope", "also nope"]);
      expect(results).toHaveLength(0);
    });

    it("handles single event", () => {
      const results = memory.eventOrdering(["Deployed to staging"]);
      expect(results).toHaveLength(1);
      expect(results[0]?.position).toBe(1);
    });
  });

  // ---------- queryBetweenEvents ----------------------------------------------

  describe("queryBetweenEvents", () => {
    it("returns entries strictly between two events, chronologically", () => {
      const results = memory.queryBetweenEvents(
        "Chose React framework",
        "Found memory leak",
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.content).toBe("Fixed auth bug");
      expect(results[1]?.content).toBe("Deployed to staging");
    });

    it("works regardless of argument order (uses min/max)", () => {
      const results = memory.queryBetweenEvents(
        "Found memory leak",
        "Chose React framework",
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.content).toBe("Fixed auth bug");
    });

    it("filters by category", () => {
      const results = memory.queryBetweenEvents(
        "Started project",
        "Released v1.0",
        "debug",
      );

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.category === "debug")).toBe(true);
    });

    it("returns empty when start event not found", () => {
      const results = memory.queryBetweenEvents("nope", "Released v1.0");
      expect(results).toHaveLength(0);
    });

    it("returns empty when end event not found", () => {
      const results = memory.queryBetweenEvents("Started project", "nope");
      expect(results).toHaveLength(0);
    });

    it("returns empty when events are adjacent (nothing between)", () => {
      const results = memory.queryBetweenEvents(
        "Started project",
        "Chose React framework",
      );
      expect(results).toHaveLength(0);
    });
  });

  // ---------- getDuration -----------------------------------------------------

  describe("getDuration", () => {
    it("returns null when start event not found", () => {
      expect(memory.getDuration("nope", "Released v1.0")).toBeNull();
    });

    it("returns null when end event not found", () => {
      expect(memory.getDuration("Started project", "nope")).toBeNull();
    });

    it("calculates correct duration between events", () => {
      const result = memory.getDuration("Started project", "Released v1.0");
      expect(result).not.toBeNull();
      expect(result!.found).toBe(true);
      expect(result!.milliseconds).toBe(day6 - day1);
    });

    it("returns absolute duration regardless of argument order", () => {
      const forward = memory.getDuration("Started project", "Released v1.0");
      const backward = memory.getDuration("Released v1.0", "Started project");
      expect(forward!.milliseconds).toBe(backward!.milliseconds);
    });

    it("returns human-readable duration string", () => {
      const result = memory.getDuration("Started project", "Released v1.0");
      expect(result!.human).toBe("5 days");
    });
  });

  // ---------- getEventFrequency -----------------------------------------------

  describe("getEventFrequency", () => {
    it("counts events in the given category within the window", () => {
      // Use a fresh memory with known-recent timestamps
      const recent = new TemporalMemory();
      const now = Date.now();
      recent.recordAt("Bug A", "debug", now - 1 * DAY);
      recent.recordAt("Bug B", "debug", now - 2 * DAY);
      recent.recordAt("Bug C", "debug", now - 2 * DAY + HOUR);
      recent.recordAt("Decision X", "decision", now - 1 * DAY);

      const result = recent.getEventFrequency("debug", 7);
      expect(result.totalEvents).toBe(3);
      expect(result.activeDays).toBe(2);
      expect(result.eventsPerDay).toBeCloseTo(3 / 7, 2);
    });

    it("returns zero when no events match", () => {
      const result = memory.getEventFrequency("nonexistent", 7);
      expect(result.totalEvents).toBe(0);
      expect(result.activeDays).toBe(0);
      expect(result.eventsPerDay).toBe(0);
    });

    it("handles zero-day window", () => {
      const result = memory.getEventFrequency("debug", 0);
      expect(result.eventsPerDay).toBe(0);
    });
  });
});

// -- Standalone helper function tests ----------------------------------------

describe("formatDuration", () => {
  it("formats days", () => {
    expect(formatDuration(5 * DAY)).toBe("5 days");
  });

  it("formats days and hours", () => {
    expect(formatDuration(3 * DAY + 4 * HOUR)).toBe("3 days 4 hours");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(2 * HOUR + 15 * 60 * 1000)).toBe(
      "2 hours 15 minutes",
    );
  });

  it("formats single units without plural s", () => {
    expect(formatDuration(1 * DAY)).toBe("1 day");
    expect(formatDuration(1 * HOUR)).toBe("1 hour");
    expect(formatDuration(60 * 1000)).toBe("1 minute");
    expect(formatDuration(1000)).toBe("1 second");
  });

  it("formats zero milliseconds", () => {
    expect(formatDuration(0)).toBe("0 seconds");
  });

  it("formats seconds when under a minute", () => {
    expect(formatDuration(45 * 1000)).toBe("45 seconds");
  });

  it("handles negative values (uses absolute)", () => {
    expect(formatDuration(-2 * HOUR)).toBe("2 hours");
  });
});

describe("formatTimeAgo", () => {
  it("returns 'just now' for sub-minute durations", () => {
    expect(formatTimeAgo(30 * 1000)).toBe("just now");
    expect(formatTimeAgo(0)).toBe("just now");
  });

  it("formats minutes ago", () => {
    expect(formatTimeAgo(5 * 60 * 1000)).toBe("5 minutes ago");
  });

  it("formats hours ago", () => {
    expect(formatTimeAgo(3 * HOUR)).toBe("3 hours ago");
  });

  it("formats days ago", () => {
    expect(formatTimeAgo(2 * DAY)).toBe("2 days ago");
  });

  it("uses singular form for 1 unit", () => {
    expect(formatTimeAgo(1 * DAY)).toBe("1 day ago");
    expect(formatTimeAgo(1 * HOUR)).toBe("1 hour ago");
    expect(formatTimeAgo(1 * 60 * 1000)).toBe("1 minute ago");
  });
});
