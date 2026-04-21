import { describe, it, expect } from "vitest";
import { graphTraversal } from "../../../src/memory/retrieval-modes/graph-traversal.js";
import type {
  RetrievalContext,
  RetrievalEdge,
} from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "a", content: "alpha post about auth" },
  { id: "b", content: "beta follow-up: token refresh" },
  { id: "c", content: "gamma note: unrelated subject" },
  { id: "d", content: "delta edge-of-graph item" },
];

const edges: RetrievalEdge[] = [
  { fromId: "a", toId: "b" },
  { fromId: "b", toId: "c" },
  { fromId: "c", toId: "d" },
];

describe("graph-traversal mode", () => {
  it("returns seeds (hop 0) when query matches content", async () => {
    const ctx: RetrievalContext = { entries, edges };
    const r = await graphTraversal.search(ctx, "alpha", { limit: 5, params: { maxHops: 1 } });
    expect(r.mode).toBe("graph-traversal");
    const ids = r.results.map((h) => h.id);
    expect(ids).toContain("a");
    // 1-hop neighbor follows through edge a→b
    expect(ids).toContain("b");
  });

  it("scores nearer hops higher than farther hops", async () => {
    const ctx: RetrievalContext = { entries, edges };
    const r = await graphTraversal.search(ctx, "alpha", { limit: 10, params: { maxHops: 3 } });
    const byId = new Map(r.results.map((h) => [h.id, h.score]));
    const aScore = byId.get("a") ?? 0;
    const bScore = byId.get("b") ?? 0;
    const cScore = byId.get("c") ?? 0;
    expect(aScore).toBeGreaterThan(bScore);
    expect(bScore).toBeGreaterThan(cScore);
  });

  it("honest-fails when no edges are wired (isHeuristic=true)", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await graphTraversal.search(ctx, "alpha", { limit: 5 });
    expect(r.scoring.isHeuristic).toBe(true);
    expect(r.scoring.notes).toMatch(/edges/);
    expect(r.results.map((h) => h.id)).toEqual(["a"]);
  });

  it("returns [] when no seeds match", async () => {
    const ctx: RetrievalContext = { entries, edges };
    const r = await graphTraversal.search(ctx, "no-such-query", { limit: 5 });
    expect(r.results).toEqual([]);
    expect(r.scoring.notes).toMatch(/no seed/);
  });
});
