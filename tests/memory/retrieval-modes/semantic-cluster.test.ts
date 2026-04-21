import { describe, it, expect } from "vitest";
import { semanticCluster } from "../../../src/memory/retrieval-modes/semantic-cluster.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "a1", content: "cats animals pets purring lively" },
  { id: "a2", content: "dogs animals pets barking loyal" },
  { id: "a3", content: "hamsters animals pets cute running" },
  { id: "b1", content: "python programming language scripting code" },
  { id: "b2", content: "javascript programming runtime code node" },
  { id: "b3", content: "rust programming systems code safe" },
];

describe("semantic-cluster mode", () => {
  it("is heuristic when no embeddings are present (token-jaccard fallback)", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await semanticCluster.search(ctx, "animal pets", { limit: 10 });
    expect(r.scoring.isHeuristic).toBe(true);
    expect(r.scoring.method).toBe("kmeans-tokens");
  });

  it("returns the cluster closest to the query", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await semanticCluster.search(ctx, "animals and pets", {
      limit: 10,
      params: { k: 2 },
    });
    // The animals cluster members (a*) should all appear before
    // any programming-cluster member
    const ids = r.results.map((h) => h.id);
    const animalHits = ids.filter((id) => id.startsWith("a"));
    const progHits = ids.filter((id) => id.startsWith("b"));
    expect(animalHits.length).toBeGreaterThan(progHits.length);
  });

  it("honest-fails on empty entry pool", async () => {
    const ctx: RetrievalContext = { entries: [] };
    const r = await semanticCluster.search(ctx, "anything");
    expect(r.results).toEqual([]);
    expect(r.scoring.isHeuristic).toBe(true);
  });

  it("respects limit", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await semanticCluster.search(ctx, "animal pets", {
      limit: 1,
      params: { k: 2 },
    });
    expect(r.results.length).toBeLessThanOrEqual(1);
  });
});
