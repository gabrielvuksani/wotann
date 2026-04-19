import { describe, it, expect } from "vitest";
import {
  parseDateHints,
  buildEntry,
  recordedIn,
  eventIn,
  recordedAndEventIn,
  eventDateRange,
  temporallyConflicting,
  type DualTimestampEntry,
} from "../../src/memory/dual-timestamp.js";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 3, 19); // 2026-04-19

describe("parseDateHints — relative expressions", () => {
  it("parses yesterday", () => {
    const hints = parseDateHints("I called yesterday", NOW);
    expect(hints[0]?.sourceText.toLowerCase()).toBe("yesterday");
    expect(hints[0]?.date).toBe(NOW - DAY_MS);
  });

  it("parses last week", () => {
    const hints = parseDateHints("Launched last week", NOW);
    expect(hints[0]?.date).toBe(NOW - 7 * DAY_MS);
  });

  it("parses N days ago", () => {
    const hints = parseDateHints("Merged 5 days ago", NOW);
    expect(hints[0]?.date).toBe(NOW - 5 * DAY_MS);
  });

  it("parses N weeks ago", () => {
    const hints = parseDateHints("Decided 3 weeks ago", NOW);
    expect(hints[0]?.date).toBe(NOW - 3 * 7 * DAY_MS);
  });

  it("parses today with high-confidence uncertainty", () => {
    const hints = parseDateHints("today's meeting", NOW);
    expect(hints[0]?.date).toBe(NOW);
    expect(hints[0]?.uncertaintyMs).toBeLessThanOrEqual(DAY_MS / 2);
  });
});

describe("parseDateHints — ISO dates", () => {
  it("parses YYYY-MM-DD", () => {
    const hints = parseDateHints("launched on 2025-06-15", NOW);
    const iso = hints.find((h) => h.sourceText.includes("2025"));
    expect(iso).toBeDefined();
    const d = new Date(iso!.date);
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(5); // June = 5
  });

  it("parses single-digit month/day", () => {
    const hints = parseDateHints("meeting 2024-3-5", NOW);
    const iso = hints.find((h) => h.sourceText.includes("2024"));
    expect(iso).toBeDefined();
  });
});

describe("parseDateHints — year only", () => {
  it("parses 'in 2023'", () => {
    const hints = parseDateHints("shipped in 2023", NOW);
    const year = hints.find((h) => h.sourceText.includes("2023"));
    expect(year).toBeDefined();
    expect(new Date(year!.date).getUTCFullYear()).toBe(2023);
  });

  it("year has wide uncertainty (~half year)", () => {
    const hints = parseDateHints("during 2022", NOW);
    const year = hints.find((h) => h.sourceText.includes("2022"));
    expect(year?.uncertaintyMs).toBeGreaterThan(100 * DAY_MS);
  });

  it("does not double-count when ISO already captures the year", () => {
    const hints = parseDateHints("2024-01-01 update", NOW);
    const count2024 = hints.filter((h) => new Date(h.date).getUTCFullYear() === 2024).length;
    expect(count2024).toBe(1);
  });
});

describe("parseDateHints — multiple hints", () => {
  it("returns hints sorted by position", () => {
    const hints = parseDateHints("yesterday we talked about 2020-01-01", NOW);
    expect(hints).toHaveLength(2);
    expect(hints[0]?.sourceText.toLowerCase()).toBe("yesterday");
  });

  it("returns empty for text with no dates", () => {
    expect(parseDateHints("just some random text", NOW)).toEqual([]);
  });
});

describe("buildEntry", () => {
  it("extracts eventDate from content", () => {
    const entry = buildEntry(
      { id: "e1", content: "We shipped last week" },
      NOW,
    );
    expect(entry.documentDate).toBe(NOW);
    expect(entry.eventDate).toBe(NOW - 7 * DAY_MS);
    expect(entry.eventDateSource).toContain("last week");
  });

  it("eventDateOverride skips extraction", () => {
    const entry = buildEntry(
      {
        id: "e1",
        content: "last week", // would otherwise be parsed
        eventDateOverride: NOW - 365 * DAY_MS,
      },
      NOW,
    );
    expect(entry.eventDate).toBe(NOW - 365 * DAY_MS);
    expect(entry.eventDateSource).toBe("user-supplied");
  });

  it("falls back to documentDate when no hints", () => {
    const entry = buildEntry({ id: "e1", content: "no date markers here" }, NOW);
    expect(entry.eventDate).toBe(NOW);
    expect(entry.eventDateSource).toBe("fallback-to-documentDate");
    expect(entry.eventDateUncertaintyMs).toBe(7 * DAY_MS);
  });

  it("respects explicit documentDate", () => {
    const specific = Date.UTC(2025, 0, 1);
    const entry = buildEntry(
      { id: "e1", content: "today I learned", documentDate: specific },
      NOW,
    );
    expect(entry.documentDate).toBe(specific);
    // eventDate parsed relative to documentDate (today = documentDate)
    expect(entry.eventDate).toBe(specific);
  });
});

describe("query helpers", () => {
  const entries: DualTimestampEntry[] = [
    {
      id: "a",
      content: "",
      documentDate: Date.UTC(2026, 0, 1),
      eventDate: Date.UTC(2025, 5, 15), // June 2025
    },
    {
      id: "b",
      content: "",
      documentDate: Date.UTC(2026, 2, 1),
      eventDate: Date.UTC(2025, 5, 20), // June 2025
    },
    {
      id: "c",
      content: "",
      documentDate: Date.UTC(2025, 11, 1), // December 2025
      eventDate: Date.UTC(2024, 0, 1), // January 2024
    },
  ];

  it("recordedIn filters by documentDate", () => {
    const result = recordedIn(entries, {
      from: Date.UTC(2026, 0, 1),
      to: Date.UTC(2026, 2, 31),
    });
    expect(result.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });

  it("eventIn filters by eventDate", () => {
    const result = eventIn(entries, {
      from: Date.UTC(2025, 5, 1),
      to: Date.UTC(2025, 5, 30),
    });
    expect(result.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });

  it("recordedAndEventIn combines both", () => {
    const result = recordedAndEventIn(
      entries,
      { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 31) }, // recorded Jan 2026
      { from: Date.UTC(2025, 5, 1), to: Date.UTC(2025, 5, 30) }, // about June 2025
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
  });
});

describe("eventDateRange", () => {
  it("expands by uncertainty", () => {
    const entry: DualTimestampEntry = {
      id: "x",
      content: "",
      documentDate: NOW,
      eventDate: NOW,
      eventDateUncertaintyMs: DAY_MS,
    };
    const range = eventDateRange(entry);
    expect(range.from).toBe(NOW - DAY_MS);
    expect(range.to).toBe(NOW + DAY_MS);
  });

  it("returns exact range when uncertainty is 0", () => {
    const entry: DualTimestampEntry = {
      id: "x",
      content: "",
      documentDate: NOW,
      eventDate: NOW,
    };
    const range = eventDateRange(entry);
    expect(range.from).toBe(NOW);
    expect(range.to).toBe(NOW);
  });
});

describe("temporallyConflicting", () => {
  it("true when event ranges overlap + docs close", () => {
    const a: DualTimestampEntry = {
      id: "a",
      content: "",
      documentDate: NOW,
      eventDate: NOW - 7 * DAY_MS,
      eventDateUncertaintyMs: DAY_MS,
    };
    const b: DualTimestampEntry = {
      id: "b",
      content: "",
      documentDate: NOW + DAY_MS,
      eventDate: NOW - 7 * DAY_MS + DAY_MS,
      eventDateUncertaintyMs: DAY_MS,
    };
    expect(temporallyConflicting(a, b)).toBe(true);
  });

  it("false when event ranges don't overlap", () => {
    const a: DualTimestampEntry = {
      id: "a",
      content: "",
      documentDate: NOW,
      eventDate: NOW - 365 * DAY_MS,
    };
    const b: DualTimestampEntry = {
      id: "b",
      content: "",
      documentDate: NOW,
      eventDate: NOW,
    };
    expect(temporallyConflicting(a, b)).toBe(false);
  });

  it("false when docs too far apart", () => {
    const a: DualTimestampEntry = {
      id: "a",
      content: "",
      documentDate: NOW,
      eventDate: NOW,
      eventDateUncertaintyMs: DAY_MS,
    };
    const b: DualTimestampEntry = {
      id: "b",
      content: "",
      documentDate: NOW + 100 * DAY_MS,
      eventDate: NOW,
      eventDateUncertaintyMs: DAY_MS,
    };
    expect(temporallyConflicting(a, b, 30 * DAY_MS)).toBe(false);
  });
});
