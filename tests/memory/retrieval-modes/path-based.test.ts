import { describe, it, expect } from "vitest";
import { pathBased } from "../../../src/memory/retrieval-modes/path-based.js";
import type {
  RetrievalContext,
  RetrievalEdge,
} from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "a", content: "node A" },
  { id: "b", content: "node B" },
  { id: "c", content: "node C" },
  { id: "d", content: "node D" },
];
const edges: RetrievalEdge[] = [
  { fromId: "a", toId: "b" },
  { fromId: "b", toId: "c" },
  { fromId: "c", toId: "d" },
];

describe("path-based mode", () => {
  it("returns nodes along shortest path a → d in order", async () => {
    const ctx: RetrievalContext = { entries, edges };
    const r = await pathBased.search(ctx, "", { params: { fromId: "a", toId: "d" }, limit: 10 });
    expect(r.results.map((h) => h.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("decays score by path position", async () => {
    const ctx: RetrievalContext = { entries, edges };
    const r = await pathBased.search(ctx, "", { params: { fromId: "a", toId: "d" } });
    expect(r.results[0]?.score).toBeGreaterThan(r.results[3]?.score ?? 0);
  });

  it("honest-fails when fromId/toId missing", async () => {
    const ctx: RetrievalContext = { entries, edges };
    const r = await pathBased.search(ctx, "");
    expect(r.results).toEqual([]);
    expect(r.scoring.isHeuristic).toBe(true);
    expect(r.scoring.notes).toMatch(/fromId/);
  });

  it("returns empty with no-path note when endpoints disconnected", async () => {
    const halfEdges: RetrievalEdge[] = [{ fromId: "a", toId: "b" }];
    const ctx: RetrievalContext = { entries, edges: halfEdges };
    const r = await pathBased.search(ctx, "", { params: { fromId: "a", toId: "d" } });
    expect(r.results).toEqual([]);
    expect(r.scoring.notes).toMatch(/no path/);
  });
});
