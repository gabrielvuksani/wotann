import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "../../../src/memory/retrieval-modes/fuzzy-match.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "e1", content: "gabriel vuksani", metadata: { key: "gabriel vuksani" } },
  { id: "e2", content: "alex jones", metadata: { key: "alex jones" } },
  {
    id: "e3",
    content: "wotann retrieval modes port",
    metadata: { key: "retrieval modes" },
  },
];

describe("fuzzy-match mode", () => {
  it("matches typoed queries above threshold", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await fuzzyMatch.search(ctx, "gabreil vuksnai", { limit: 5 });
    expect(r.results[0]?.id).toBe("e1");
    expect(r.results[0]?.score).toBeGreaterThan(0.5);
  });

  it("discards matches below threshold", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await fuzzyMatch.search(ctx, "total nonsense zzzzzzzzz", {
      limit: 5,
      params: { threshold: 0.8 },
    });
    expect(r.results.length).toBe(0);
  });

  it("ranks perfect match highest", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await fuzzyMatch.search(ctx, "retrieval modes", { limit: 5 });
    expect(r.results[0]?.id).toBe("e3");
    expect(r.results[0]?.score).toBeCloseTo(1.0, 2);
  });

  it("falls back to first line when key is missing", async () => {
    const noKey: SearchableEntry[] = [
      { id: "x", content: "gabriel vuksani\nother text here" },
    ];
    const ctx: RetrievalContext = { entries: noKey };
    const r = await fuzzyMatch.search(ctx, "gabriel vuksani");
    expect(r.results[0]?.id).toBe("x");
    expect(r.results[0]?.score).toBeGreaterThan(0.9);
  });
});
