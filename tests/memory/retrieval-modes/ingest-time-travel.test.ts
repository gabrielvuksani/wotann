import { describe, it, expect } from "vitest";
import { ingestTimeTravel } from "../../../src/memory/retrieval-modes/ingest-time-travel.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  {
    id: "old",
    content: "fact ingested Mon 2026-04-01 about auth",
    metadata: { recordedAt: "2026-04-01T00:00:00Z" },
  },
  {
    id: "mid",
    content: "fact ingested Tue 2026-04-10 about auth",
    metadata: { recordedAt: "2026-04-10T00:00:00Z" },
  },
  {
    id: "new",
    content: "fact ingested Wed 2026-04-19 about auth",
    metadata: { recordedAt: "2026-04-19T00:00:00Z" },
  },
];

describe("ingest-time-travel mode", () => {
  it("returns only entries ingested by the knownAt date", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await ingestTimeTravel.search(ctx, "auth", {
      params: { knownAt: "2026-04-10T23:59:59Z" },
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).toContain("old");
    expect(ids).toContain("mid");
    expect(ids).not.toContain("new");
  });

  it("includes all entries when knownAt is far in the future", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await ingestTimeTravel.search(ctx, "auth", {
      params: { knownAt: "2099-01-01T00:00:00Z" },
    });
    expect(r.results.length).toBe(3);
  });

  it("honest-fails with no knownAt", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await ingestTimeTravel.search(ctx, "auth");
    expect(r.results).toEqual([]);
    expect(r.scoring.isHeuristic).toBe(true);
    expect(r.scoring.notes).toMatch(/knownAt/);
  });

  it("honest-fails on invalid knownAt", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await ingestTimeTravel.search(ctx, "auth", {
      params: { knownAt: "not-a-date" },
    });
    expect(r.results).toEqual([]);
    expect(r.scoring.isHeuristic).toBe(true);
  });
});
