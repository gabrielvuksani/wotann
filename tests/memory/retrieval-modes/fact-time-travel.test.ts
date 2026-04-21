import { describe, it, expect } from "vitest";
import { factTimeTravel } from "../../../src/memory/retrieval-modes/fact-time-travel.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  {
    id: "past",
    content: "CEO was alice 2018-2020",
    metadata: { validFrom: "2018-01-01T00:00:00Z", validTo: "2020-01-01T00:00:00Z" },
  },
  {
    id: "present",
    content: "CEO is bob 2020-now",
    metadata: { validFrom: "2020-01-01T00:00:00Z" },
  },
  {
    id: "unbounded-past",
    content: "founded in 1990",
    metadata: { validFrom: "1990-01-01T00:00:00Z" },
  },
];

describe("fact-time-travel mode", () => {
  it("returns facts valid at the given validAt", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await factTimeTravel.search(ctx, "CEO", {
      params: { validAt: "2019-06-01T00:00:00Z" },
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).toContain("past");
    expect(ids).not.toContain("present");
  });

  it("excludes facts whose validity ended before the query date", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await factTimeTravel.search(ctx, "CEO", {
      params: { validAt: "2022-06-01T00:00:00Z" },
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).not.toContain("past");
    expect(ids).toContain("present");
  });

  it("respects unbounded validity (validTo undefined)", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await factTimeTravel.search(ctx, "", {
      params: { validAt: "2099-01-01T00:00:00Z" },
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).toContain("present");
    expect(ids).toContain("unbounded-past");
  });

  it("honest-fails on invalid validAt", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await factTimeTravel.search(ctx, "CEO", {
      params: { validAt: "banana" },
    });
    expect(r.results).toEqual([]);
    expect(r.scoring.isHeuristic).toBe(true);
  });
});
