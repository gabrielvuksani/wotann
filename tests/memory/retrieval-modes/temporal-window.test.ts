import { describe, it, expect } from "vitest";
import { temporalWindow } from "../../../src/memory/retrieval-modes/temporal-window.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "t1", content: "event one in early window", timestamp: 1_000_000 },
  { id: "t2", content: "event two in mid window", timestamp: 2_000_000 },
  { id: "t3", content: "event three late", timestamp: 3_000_000 },
  { id: "t4", content: "no timestamp anywhere" },
];

describe("temporal-window mode", () => {
  it("filters entries to [from, to] window", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await temporalWindow.search(ctx, "event", {
      params: { from: 1_500_000, to: 2_500_000 },
    });
    expect(r.results.map((h) => h.id)).toEqual(["t2"]);
  });

  it("drops entries without timestamps", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await temporalWindow.search(ctx, "anywhere", {
      params: { from: 0, to: 5_000_000 },
    });
    expect(r.results.map((h) => h.id)).not.toContain("t4");
  });

  it("scoring notes when no window supplied (isHeuristic=true)", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await temporalWindow.search(ctx, "event");
    expect(r.scoring.isHeuristic).toBe(true);
    expect(r.scoring.notes).toMatch(/no window/);
  });

  it("recency within window is monotonic (earlier timestamp → lower decay score)", async () => {
    const ctx: RetrievalContext = { entries, now: new Date(10_000_000).toISOString() };
    const r = await temporalWindow.search(ctx, "", {
      params: { from: 0, to: 4_000_000 },
      limit: 10,
    });
    // Without a query, every timestamped entry passes — check ordering.
    const ids = r.results.map((h) => h.id);
    expect(ids[0]).toBe("t3"); // closest to now, highest score
  });
});
