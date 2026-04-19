import { describe, it, expect } from "vitest";
import {
  parsePath,
  formatPath,
  isUnder,
  filterByQuery,
  listHalls,
  listWings,
  listRooms,
  countTree,
  renderTree,
  toStoreFields,
  fromStoreFields,
  type MemPalaceEntry,
} from "../../src/memory/mem-palace.js";

describe("parsePath / formatPath", () => {
  it("parses one-level hall", () => {
    const path = parsePath("coding");
    expect(path).toEqual({ hall: "coding" });
  });

  it("parses two-level hall/wing", () => {
    const path = parsePath("coding/wotann");
    expect(path).toEqual({ hall: "coding", wing: "wotann" });
  });

  it("parses three-level hall/wing/room", () => {
    const path = parsePath("coding/wotann/benchmarks");
    expect(path).toEqual({ hall: "coding", wing: "wotann", room: "benchmarks" });
  });

  it("ignores empty segments", () => {
    expect(parsePath("coding//wotann")).toEqual({ hall: "coding", wing: "wotann" });
  });

  it("throws on empty path", () => {
    expect(() => parsePath("")).toThrow(/empty path/);
  });

  it("formatPath round-trips", () => {
    const original = "coding/wotann/benchmarks";
    expect(formatPath(parsePath(original))).toBe(original);
  });
});

describe("isUnder", () => {
  it("hall matches all entries in same hall", () => {
    expect(isUnder({ hall: "coding", wing: "wotann" }, { hall: "coding" })).toBe(true);
  });

  it("wing matches entries in same wing", () => {
    expect(
      isUnder(
        { hall: "coding", wing: "wotann", room: "bench" },
        { hall: "coding", wing: "wotann" },
      ),
    ).toBe(true);
  });

  it("room requires exact match", () => {
    expect(
      isUnder(
        { hall: "coding", wing: "wotann", room: "bench" },
        { hall: "coding", wing: "wotann", room: "bench" },
      ),
    ).toBe(true);
    expect(
      isUnder(
        { hall: "coding", wing: "wotann", room: "other" },
        { hall: "coding", wing: "wotann", room: "bench" },
      ),
    ).toBe(false);
  });

  it("different hall never matches", () => {
    expect(isUnder({ hall: "personal" }, { hall: "coding" })).toBe(false);
  });

  it("different wing never matches", () => {
    expect(
      isUnder(
        { hall: "coding", wing: "wotann" },
        { hall: "coding", wing: "nexus" },
      ),
    ).toBe(false);
  });
});

describe("filterByQuery", () => {
  const entries: MemPalaceEntry<{ x: number }>[] = [
    { path: { hall: "coding", wing: "wotann", room: "bench" }, data: { x: 1 } },
    { path: { hall: "coding", wing: "wotann", room: "memory" }, data: { x: 2 } },
    { path: { hall: "coding", wing: "nexus" }, data: { x: 3 } },
    { path: { hall: "personal" }, data: { x: 4 } },
  ];

  it("empty query returns all", () => {
    expect(filterByQuery(entries, {})).toHaveLength(4);
  });

  it("hall filter", () => {
    expect(filterByQuery(entries, { hall: "coding" })).toHaveLength(3);
  });

  it("hall + wing filter", () => {
    expect(filterByQuery(entries, { hall: "coding", wing: "wotann" })).toHaveLength(2);
  });

  it("full path filter", () => {
    expect(
      filterByQuery(entries, { hall: "coding", wing: "wotann", room: "bench" }),
    ).toHaveLength(1);
  });

  it("non-matching filter returns []", () => {
    expect(filterByQuery(entries, { hall: "medical" })).toHaveLength(0);
  });
});

describe("listHalls / listWings / listRooms", () => {
  const entries: MemPalaceEntry<null>[] = [
    { path: { hall: "coding", wing: "wotann", room: "bench" }, data: null },
    { path: { hall: "coding", wing: "wotann", room: "memory" }, data: null },
    { path: { hall: "coding", wing: "nexus" }, data: null },
    { path: { hall: "personal" }, data: null },
  ];

  it("listHalls returns sorted unique halls", () => {
    expect(listHalls(entries)).toEqual(["coding", "personal"]);
  });

  it("listWings for a hall", () => {
    expect(listWings(entries, "coding")).toEqual(["nexus", "wotann"]);
  });

  it("listRooms for a wing", () => {
    expect(listRooms(entries, "coding", "wotann")).toEqual(["bench", "memory"]);
  });

  it("listWings returns [] for hall with no wings", () => {
    expect(listWings(entries, "personal")).toEqual([]);
  });
});

describe("countTree", () => {
  const entries: MemPalaceEntry<null>[] = [
    { path: { hall: "coding", wing: "wotann", room: "bench" }, data: null },
    { path: { hall: "coding", wing: "wotann", room: "bench" }, data: null },
    { path: { hall: "coding", wing: "wotann", room: "memory" }, data: null },
    { path: { hall: "coding", wing: "nexus" }, data: null },
    { path: { hall: "personal" }, data: null },
  ];

  it("counts halls correctly", () => {
    const tree = countTree(entries);
    const coding = tree.find((h) => h.name === "coding");
    expect(coding?.count).toBe(4);
  });

  it("counts wings and rooms correctly", () => {
    const tree = countTree(entries);
    const coding = tree.find((h) => h.name === "coding");
    const wotann = coding?.wings?.find((w) => w.name === "wotann");
    expect(wotann?.count).toBe(3);
    const bench = wotann?.wings?.find((r) => r.name === "bench");
    expect(bench?.count).toBe(2);
  });

  it("entries without rooms still count at wing level", () => {
    const tree = countTree(entries);
    const coding = tree.find((h) => h.name === "coding");
    const nexus = coding?.wings?.find((w) => w.name === "nexus");
    expect(nexus?.count).toBe(1);
  });
});

describe("renderTree", () => {
  it("produces indented text", () => {
    const entries: MemPalaceEntry<null>[] = [
      { path: { hall: "coding", wing: "wotann", room: "bench" }, data: null },
    ];
    const rendered = renderTree(countTree(entries));
    expect(rendered).toContain("coding (1)");
    expect(rendered).toContain("  wotann (1)");
    expect(rendered).toContain("    bench (1)");
  });
});

describe("toStoreFields / fromStoreFields", () => {
  it("hall only", () => {
    const fields = toStoreFields({ hall: "coding" });
    expect(fields).toEqual({ domain: "coding" });
    expect(fromStoreFields(fields)).toEqual({ hall: "coding" });
  });

  it("hall + wing", () => {
    const fields = toStoreFields({ hall: "coding", wing: "wotann" });
    expect(fields).toEqual({ domain: "coding", topic: "wotann" });
    expect(fromStoreFields(fields)).toEqual({ hall: "coding", wing: "wotann" });
  });

  it("hall + wing + room", () => {
    const fields = toStoreFields({ hall: "coding", wing: "wotann", room: "bench" });
    expect(fields).toEqual({ domain: "coding", topic: "wotann/bench" });
    expect(fromStoreFields(fields)).toEqual({
      hall: "coding",
      wing: "wotann",
      room: "bench",
    });
  });
});
