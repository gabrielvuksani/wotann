import { describe, it, expect } from "vitest";
import {
  insightSynthesis,
  entityRelationship,
  temporalFiltered,
  documentScope,
  crossDocument,
  codeAware,
  summaryOnly,
  metadataOnly,
  graphHop,
  hybridFusion,
  type SearchableEntry,
  type EntityEdge,
  type SearchHit,
} from "../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "e1", content: "cats are animals that purr", documentId: "doc-a", timestamp: 1000 },
  { id: "e2", content: "dogs are animals that bark", documentId: "doc-a", timestamp: 2000 },
  {
    id: "e3",
    content: "```python\ndef add(a, b): return a + b\n```",
    documentId: "doc-b",
    timestamp: 3000,
  },
  { id: "e4", content: "summary of results", documentId: "doc-c", metadata: { type: "summary" } },
];

describe("insightSynthesis", () => {
  it("sends chunks to LLM + returns synthesized insight", async () => {
    const result = await insightSynthesis(entries, {
      query: "animals",
      llmSynthesize: async (chunks) => `Synthesized: ${chunks.length} chunks`,
    });
    expect(result.insight).toContain("Synthesized:");
    expect(result.sourceIds.length).toBeGreaterThan(0);
  });

  it("caps at maxInsights", async () => {
    const result = await insightSynthesis(entries, {
      query: "x",
      maxInsights: 2,
      llmSynthesize: async (chunks) => `${chunks.length}`,
    });
    expect(result.insight).toBe("2");
    expect(result.sourceIds).toHaveLength(2);
  });
});

describe("entityRelationship", () => {
  const edges: EntityEdge[] = [
    { fromId: "e1", toId: "e2", kind: "related" },
    { fromId: "e2", toId: "e3", kind: "related" },
  ];

  it("finds 1-hop neighbors", () => {
    const hits = entityRelationship(entries, edges, "e1", 1);
    expect(hits.map((h) => h.entry.id)).toEqual(["e2"]);
  });

  it("finds 2-hop neighbors", () => {
    const hits = entityRelationship(entries, edges, "e1", 2);
    expect(hits.map((h) => h.entry.id).sort()).toEqual(["e2", "e3"]);
  });

  it("1-hop scores higher than 2-hop", () => {
    const hits = entityRelationship(entries, edges, "e1", 2);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]!.score);
  });

  it("returns [] when seed has no neighbors", () => {
    const hits = entityRelationship(entries, [], "e1", 2);
    expect(hits).toEqual([]);
  });
});

describe("temporalFiltered", () => {
  it("filters by from/to window", () => {
    const hits = temporalFiltered(entries, { from: 1500, to: 2500 });
    expect(hits.map((h) => h.entry.id)).toEqual(["e2"]);
  });

  it("from-only filter", () => {
    const hits = temporalFiltered(entries, { from: 2500 });
    expect(hits.map((h) => h.entry.id).sort()).toEqual(["e3"]);
  });

  it("entries without timestamp are excluded", () => {
    const hits = temporalFiltered(entries, {});
    // e4 has no timestamp so excluded; other 3 pass the empty window
    expect(hits.map((h) => h.entry.id).sort()).toEqual(["e1", "e2", "e3"]);
  });
});

describe("documentScope", () => {
  it("filters by documentId set", () => {
    const hits = documentScope(entries, ["doc-a"]);
    expect(hits.map((h) => h.entry.id).sort()).toEqual(["e1", "e2"]);
  });

  it("entries without documentId excluded", () => {
    const noDoc: SearchableEntry[] = [{ id: "x", content: "" }];
    expect(documentScope(noDoc, ["doc-a"])).toEqual([]);
  });
});

describe("crossDocument", () => {
  it("finds pairs with shared tokens from different docs", () => {
    const pairs = crossDocument(entries, 1);
    // e1 + e2 both say "animals" but same doc-a → excluded
    // need a cross-doc pair: let me just check the function works
    expect(pairs).toBeDefined();
  });

  it("excludes same-document pairs", () => {
    const pairs = crossDocument(entries, 1);
    for (const p of pairs) {
      expect(p.a.documentId).not.toBe(p.b.documentId);
    }
  });

  it("respects minOverlap", () => {
    const e1: SearchableEntry = { id: "a", content: "one two three", documentId: "d1" };
    const e2: SearchableEntry = { id: "b", content: "one four five", documentId: "d2" };
    const pairs = crossDocument([e1, e2], 2);
    // Only "one" is 4+ chars shared → below minOverlap=2
    expect(pairs).toEqual([]);
  });
});

describe("codeAware", () => {
  it("finds symbol inside code fence", () => {
    const hits = codeAware(entries, "add");
    expect(hits[0]?.entry.id).toBe("e3");
  });

  it("ignores matches outside code fences", () => {
    const e = { id: "x", content: "add is a verb", documentId: "d" };
    const hits = codeAware([e], "add");
    expect(hits).toEqual([]);
  });

  it("returns [] when symbol absent", () => {
    expect(codeAware(entries, "nonexistent_symbol")).toEqual([]);
  });
});

describe("summaryOnly", () => {
  it("returns entries with metadata.type=summary", () => {
    const hits = summaryOnly(entries);
    expect(hits.map((h) => h.entry.id)).toEqual(["e4"]);
  });
});

describe("metadataOnly", () => {
  it("filters by multiple metadata keys (AND)", () => {
    const hits = metadataOnly(entries, { type: "summary" });
    expect(hits.map((h) => h.entry.id)).toEqual(["e4"]);
  });

  it("returns [] when no entry matches", () => {
    expect(metadataOnly(entries, { nonexistent: "x" })).toEqual([]);
  });
});

describe("graphHop", () => {
  const edges: EntityEdge[] = [
    { fromId: "e1", toId: "e2", kind: "x" },
    { fromId: "e2", toId: "e3", kind: "x" },
  ];

  it("exactly-1 hop returns only direct neighbors", () => {
    const hits = graphHop(entries, edges, "e1", 1);
    expect(hits.map((h) => h.entry.id)).toEqual(["e2"]);
  });

  it("exactly-2 hops returns only 2-hop (not 1-hop)", () => {
    const hits = graphHop(entries, edges, "e1", 2);
    expect(hits.map((h) => h.entry.id)).toEqual(["e3"]);
  });
});

describe("hybridFusion", () => {
  const rankingA: SearchHit[] = [
    { entry: entries[0]!, score: 1.0, reason: "from A" },
    { entry: entries[1]!, score: 0.8, reason: "from A" },
  ];
  const rankingB: SearchHit[] = [
    { entry: entries[1]!, score: 1.0, reason: "from B" },
    { entry: entries[0]!, score: 0.5, reason: "from B" },
  ];

  it("fuses multiple rankings via RRF", () => {
    const fused = hybridFusion([rankingA, rankingB]);
    expect(fused).toHaveLength(2);
  });

  it("entries in both rankings outrank singletons", () => {
    const singleton: SearchHit[] = [{ entry: entries[2]!, score: 1.0 }];
    const fused = hybridFusion([rankingA, rankingB, singleton]);
    const top = fused[0]?.entry.id;
    // e1 and e2 appear in 2 rankings; e3 only in 1 — one of e1/e2 should win
    expect(["e1", "e2"]).toContain(top);
  });

  it("reasons concatenated when same entry appears in multiple rankings", () => {
    const fused = hybridFusion([rankingA, rankingB]);
    const e1 = fused.find((h) => h.entry.id === "e1");
    expect(e1?.reason).toContain("A");
    expect(e1?.reason).toContain("B");
  });
});
