/**
 * Phase H Task 6 — Wings/Rooms/Halls partition.
 *
 * Verifies parse/format roundtrips, store-field bridging, query
 * matching, and count aggregation.
 */

import { describe, expect, it } from "vitest";
import {
  HALLS,
  aggregateCounts,
  formatWrh,
  fromStoreFields,
  matchesQuery,
  observationTypeToHall,
  parseWrh,
  toStoreFields,
  toStoreQuery,
  type WingRoomHall,
} from "../../src/memory/wings-rooms-halls.js";

describe("parseWrh", () => {
  it("parses wing-only", () => {
    expect(parseWrh("project:wotann")).toEqual({ wing: "project:wotann" });
  });

  it("parses wing/room", () => {
    expect(parseWrh("project:wotann/migration")).toEqual({
      wing: "project:wotann",
      room: "migration",
    });
  });

  it("parses wing/room#hall", () => {
    expect(parseWrh("project:wotann/migration#facts")).toEqual({
      wing: "project:wotann",
      room: "migration",
      hall: "facts",
    });
  });

  it("parses wing#hall (no room)", () => {
    expect(parseWrh("project:wotann#events")).toEqual({
      wing: "project:wotann",
      hall: "events",
    });
  });

  it("throws on unknown hall", () => {
    expect(() => parseWrh("w#nope")).toThrow(/unknown hall/);
  });

  it("throws on empty input", () => {
    expect(() => parseWrh("")).toThrow(/empty/);
  });
});

describe("formatWrh", () => {
  it("round-trips wing/room#hall", () => {
    const path: WingRoomHall = { wing: "w", room: "r", hall: "facts" };
    expect(formatWrh(path)).toBe("w/r#facts");
    expect(parseWrh(formatWrh(path))).toEqual(path);
  });

  it("round-trips wing-only", () => {
    const path: WingRoomHall = { wing: "w" };
    expect(formatWrh(path)).toBe("w");
    expect(parseWrh(formatWrh(path))).toEqual(path);
  });
});

describe("toStoreFields / fromStoreFields", () => {
  it("bridges wing+room+hall to domain/topic", () => {
    const fields = toStoreFields({ wing: "project:wotann", room: "migration", hall: "facts" });
    expect(fields).toEqual({ domain: "project:wotann", topic: "migration|facts" });
  });

  it("bridges wing+room", () => {
    const fields = toStoreFields({ wing: "w", room: "r" });
    expect(fields).toEqual({ domain: "w", topic: "r" });
  });

  it("bridges wing only", () => {
    const fields = toStoreFields({ wing: "w" });
    expect(fields).toEqual({ domain: "w", topic: "" });
  });

  it("bridges wing + hall (no room) via pipe-prefix convention", () => {
    const fields = toStoreFields({ wing: "w", hall: "advice" });
    expect(fields).toEqual({ domain: "w", topic: "|advice" });
    // Round-trips
    const back = fromStoreFields(fields);
    expect(back).toEqual({ wing: "w", hall: "advice" });
  });

  it("fromStoreFields parses topic with | separator", () => {
    expect(fromStoreFields({ domain: "w", topic: "r|facts" })).toEqual({
      wing: "w",
      room: "r",
      hall: "facts",
    });
  });

  it("fromStoreFields preserves legacy rows (no separator = room only)", () => {
    expect(fromStoreFields({ domain: "w", topic: "legacy-topic" })).toEqual({
      wing: "w",
      room: "legacy-topic",
    });
  });

  it("fromStoreFields ignores unknown hall in topic suffix", () => {
    expect(fromStoreFields({ domain: "w", topic: "room|bogus-hall" })).toEqual({
      wing: "w",
      room: "room",
    });
  });
});

describe("matchesQuery", () => {
  const path: WingRoomHall = { wing: "w", room: "r", hall: "facts" };

  it("{} matches anything", () => {
    expect(matchesQuery(path, {})).toBe(true);
  });

  it("matches on wing", () => {
    expect(matchesQuery(path, { wing: "w" })).toBe(true);
    expect(matchesQuery(path, { wing: "other" })).toBe(false);
  });

  it("matches on room", () => {
    expect(matchesQuery(path, { room: "r" })).toBe(true);
    expect(matchesQuery(path, { room: "other" })).toBe(false);
  });

  it("matches on hall", () => {
    expect(matchesQuery(path, { hall: "facts" })).toBe(true);
    expect(matchesQuery(path, { hall: "events" })).toBe(false);
  });
});

describe("toStoreQuery", () => {
  it("emits domain filter only when hall without room", () => {
    expect(toStoreQuery({ wing: "w", hall: "events" })).toEqual({ domain: "w" });
  });

  it("emits domain+topic when wing+room+hall", () => {
    expect(toStoreQuery({ wing: "w", room: "r", hall: "facts" })).toEqual({
      domain: "w",
      topic: "r|facts",
    });
  });

  it("emits domain+topic when wing+room only", () => {
    expect(toStoreQuery({ wing: "w", room: "r" })).toEqual({ domain: "w", topic: "r" });
  });
});

describe("aggregateCounts", () => {
  it("aggregates by wing / room / hall", () => {
    const paths: WingRoomHall[] = [
      { wing: "A", room: "r1", hall: "facts" },
      { wing: "A", room: "r1", hall: "facts" },
      { wing: "A", room: "r2", hall: "events" },
      { wing: "B", room: "r3", hall: "advice" },
    ];
    const counts = aggregateCounts(paths);
    expect(counts).toHaveLength(2);
    const a = counts[0]!;
    expect(a.wing).toBe("A");
    expect(a.total).toBe(3);
    expect(a.rooms).toHaveLength(2);
    const r1 = a.rooms.find((r) => r.room === "r1")!;
    expect(r1.halls.facts).toBe(2);
    expect(r1.total).toBe(2);
  });

  it("(root) bucket for room-less entries", () => {
    const paths: WingRoomHall[] = [{ wing: "A" }, { wing: "A", hall: "advice" }];
    const counts = aggregateCounts(paths);
    expect(counts[0]!.rooms).toHaveLength(1);
    expect(counts[0]!.rooms[0]!.room).toBe("(root)");
  });
});

describe("observationTypeToHall", () => {
  it("maps observation types to halls", () => {
    expect(observationTypeToHall("decision")).toBe("facts");
    expect(observationTypeToHall("preference")).toBe("preferences");
    expect(observationTypeToHall("milestone")).toBe("events");
    expect(observationTypeToHall("problem")).toBe("events");
    expect(observationTypeToHall("discovery")).toBe("discoveries");
  });
});

describe("HALLS constant", () => {
  it("contains exactly the 5 canonical typed corridors", () => {
    expect(HALLS).toEqual(["facts", "events", "discoveries", "preferences", "advice"]);
  });
});
