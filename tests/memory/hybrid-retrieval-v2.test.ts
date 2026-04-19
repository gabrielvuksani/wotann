import { describe, it, expect, vi } from "vitest";
import {
  hybridSearchV2,
  createBm25Retriever,
  createDenseRetriever,
  createCrossEncoderStub,
  createCrossEncoderReranker,
  type SearchableEntry,
} from "../../src/memory/hybrid-retrieval-v2.js";
import type { Retriever, Reranker, SearchHit } from "../../src/memory/hybrid-retrieval.js";

// ── Fixtures ───────────────────────────────────────────

const entries: readonly SearchableEntry[] = [
  {
    id: "a",
    content: "cats are animals that purr and hunt mice",
    embedding: [1, 0, 0],
  },
  {
    id: "b",
    content: "dogs are animals that bark and chase tails",
    embedding: [0.9, 0.1, 0],
  },
  {
    id: "c",
    content: "trees are tall plants that grow slowly",
    embedding: [0, 1, 0],
  },
  {
    id: "d",
    content: "elephants are very large animals with trunks",
    embedding: [0.8, 0, 0.2],
  },
  {
    id: "e",
    content: "sharks are dangerous aquatic predators",
    embedding: [0.5, 0.5, 0],
  },
];

// Simple embed stub: matches the first 3 ids by content heuristic
const fakeEmbed = async (text: string): Promise<readonly number[]> => {
  const t = text.toLowerCase();
  if (t.includes("cat")) return [1, 0, 0];
  if (t.includes("dog")) return [0.9, 0.1, 0];
  if (t.includes("tree") || t.includes("plant")) return [0, 1, 0];
  if (t.includes("elephant")) return [0.8, 0, 0.2];
  if (t.includes("shark")) return [0.5, 0.5, 0];
  if (t.includes("animal")) return [0.85, 0.05, 0.1];
  return [0.1, 0.1, 0.8];
};

// ── BM25 retriever ─────────────────────────────────────

describe("createBm25Retriever", () => {
  it("ranks documents by BM25 score", async () => {
    const r = createBm25Retriever();
    const hits = await r.search("animals", entries);
    // a, b, d all contain "animals"; c and e don't
    const ids = hits.map((h) => h.entry.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("d");
    expect(ids).not.toContain("c");
    expect(ids).not.toContain("e");
  });

  it("returns [] on empty query", async () => {
    const r = createBm25Retriever();
    expect(await r.search("", entries)).toEqual([]);
  });

  it("returns [] on empty corpus", async () => {
    const r = createBm25Retriever();
    expect(await r.search("animals", [])).toEqual([]);
  });

  it("respects k1 and b parameters", async () => {
    // Use a corpus where doc lengths vary AND a multi-term query so
    // the BM25 tf-saturation (k1) and length-norm (b) shift scores.
    const corpus: SearchableEntry[] = [
      { id: "short", content: "cats" },
      { id: "long", content: "cats cats cats cats cats cats cats cats cats cats" },
      { id: "noise", content: "nothing matches here only filler words" },
    ];
    const r1 = createBm25Retriever({ k1: 0.5, b: 0.9 });
    const r2 = createBm25Retriever({ k1: 2.5, b: 0.1 });
    const h1 = await r1.search("cats", corpus);
    const h2 = await r2.search("cats", corpus);
    expect(h1.length).toBeGreaterThan(0);
    expect(h2.length).toBeGreaterThan(0);
    // With small k1 + large b, "short" should be competitive (length norm penalizes "long").
    // With large k1 + small b, "long" benefits from high TF without heavy length norm.
    const longScore1 = h1.find((h) => h.entry.id === "long")?.score ?? 0;
    const longScore2 = h2.find((h) => h.entry.id === "long")?.score ?? 0;
    expect(longScore1).not.toBe(longScore2);
  });

  it("term frequency contributes to score", async () => {
    const r = createBm25Retriever();
    const corpus: SearchableEntry[] = [
      { id: "once", content: "animals live here" },
      { id: "twice", content: "animals and more animals" },
    ];
    const hits = await r.search("animals", corpus);
    // "twice" has 2 occurrences, should outrank "once"
    expect(hits[0]?.entry.id).toBe("twice");
  });

  it("supports a custom tokenizer", async () => {
    const r = createBm25Retriever({
      tokenize: (text) => text.split(/\s+/).filter((t) => t.length > 0),
    });
    const hits = await r.search("ANIMALS", entries);
    // Without lowercase tokenizer, ALL-CAPS query shouldn't match lowercase corpus
    expect(hits).toEqual([]);
  });
});

// ── Dense retriever ────────────────────────────────────

describe("createDenseRetriever", () => {
  it("ranks by cosine similarity", async () => {
    const r = createDenseRetriever({ embed: fakeEmbed });
    const hits = await r.search("cats", entries);
    expect(hits[0]?.entry.id).toBe("a"); // cat vector [1,0,0]
  });

  it("reuses pre-computed embeddings", async () => {
    const embedSpy = vi.fn(fakeEmbed);
    const r = createDenseRetriever({ embed: embedSpy });
    await r.search("cats", entries);
    // Only 1 call for the QUERY (all entries have pre-computed embeddings)
    expect(embedSpy).toHaveBeenCalledTimes(1);
  });

  it("embeds missing entries on demand", async () => {
    const embedSpy = vi.fn(fakeEmbed);
    const r = createDenseRetriever({ embed: embedSpy });
    const noEmbed: SearchableEntry[] = [
      { id: "x", content: "cats are cute" },
      { id: "y", content: "dogs are loyal" },
    ];
    await r.search("cats", noEmbed);
    // 1 for query + 2 for entries (no batch supplied)
    expect(embedSpy).toHaveBeenCalledTimes(3);
  });

  it("uses batch embed when provided", async () => {
    const embedSpy = vi.fn(fakeEmbed);
    const batchSpy = vi.fn(async (texts: readonly string[]) => {
      return Promise.all(texts.map((t) => fakeEmbed(t)));
    });
    const r = createDenseRetriever({ embed: embedSpy, embedBatch: batchSpy });
    const noEmbed: SearchableEntry[] = [
      { id: "x", content: "cats are cute" },
      { id: "y", content: "dogs are loyal" },
    ];
    await r.search("cats", noEmbed);
    // 1 for query via embed, batch used for entries
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it("filters hits below minSim", async () => {
    const r = createDenseRetriever({ embed: fakeEmbed, minSim: 0.95 });
    const hits = await r.search("cats", entries);
    // Only extremely close matches survive
    expect(hits.every((h) => h.score >= 0.95)).toBe(true);
  });

  it("returns [] on empty query embedding", async () => {
    const r = createDenseRetriever({ embed: async () => [] });
    expect(await r.search("anything", entries)).toEqual([]);
  });
});

// ── hybridSearchV2 orchestrator ───────────────────────

describe("hybridSearchV2", () => {
  const bm25 = createBm25Retriever();
  const dense = createDenseRetriever({ embed: fakeEmbed });

  it("combines BM25 and dense via RRF", async () => {
    const result = await hybridSearchV2("cats", entries, { bm25, dense });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.bm25Hits.length).toBeGreaterThan(0);
    expect(result.denseHits.length).toBeGreaterThan(0);
  });

  it("returns top-k by default (10)", async () => {
    const manyEntries: SearchableEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: `e${i}`,
      content: `entry ${i} animals cats`,
      embedding: [1, 0, 0],
    }));
    const result = await hybridSearchV2("animals", manyEntries, { bm25, dense });
    expect(result.hits.length).toBeLessThanOrEqual(10);
  });

  it("respects custom k (via config)", async () => {
    const result = await hybridSearchV2("animals", entries, { bm25, dense, k: 2 });
    expect(result.hits.length).toBeLessThanOrEqual(2);
  });

  it("respects custom k (via query object)", async () => {
    const result = await hybridSearchV2({ query: "animals", k: 1 }, entries, { bm25, dense });
    expect(result.hits.length).toBe(1);
  });

  it("applies reranker when provided", async () => {
    const reranker: Reranker = {
      name: "test-rr",
      rerank: vi.fn(async (_q: string, h: readonly SearchHit[]) => h),
    };
    const result = await hybridSearchV2("animals", entries, {
      bm25,
      dense,
      reranker,
    });
    expect(result.rerankerApplied).toBe(true);
    expect(reranker.rerank).toHaveBeenCalledOnce();
  });

  it("falls back to fused order on reranker failure", async () => {
    const reranker: Reranker = {
      name: "broken",
      rerank: async () => {
        throw new Error("model timeout");
      },
    };
    const result = await hybridSearchV2("animals", entries, {
      bm25,
      dense,
      reranker,
    });
    expect(result.rerankerApplied).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("drops hits below rerankThreshold", async () => {
    const reranker: Reranker = {
      name: "scored",
      rerank: async (_q, h) =>
        h.map((hit, i) => ({ ...hit, score: i === 0 ? 0.9 : 0.1 })),
    };
    const result = await hybridSearchV2(
      { query: "animals", rerankThreshold: 0.5 },
      entries,
      { bm25, dense, reranker },
    );
    expect(result.rerankerApplied).toBe(true);
    expect(result.hits.length).toBe(1);
    expect(result.droppedByThreshold).toBeGreaterThan(0);
  });

  it("rerankThreshold=0 keeps all reranked hits", async () => {
    const reranker: Reranker = {
      name: "scored",
      rerank: async (_q, h) => h.map((hit) => ({ ...hit, score: 0.5 })),
    };
    const result = await hybridSearchV2("animals", entries, {
      bm25,
      dense,
      reranker,
      rerankThreshold: 0,
    });
    expect(result.droppedByThreshold).toBe(0);
  });

  it("handles retriever failure gracefully", async () => {
    const broken: Retriever = {
      name: "broken",
      search: async () => {
        throw new Error("boom");
      },
    };
    const result = await hybridSearchV2("animals", entries, {
      bm25: broken,
      dense,
    });
    // dense still produced hits
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("supports extra retrievers beyond bm25 + dense", async () => {
    const extra: Retriever = {
      name: "recency",
      search: async () => [{ entry: entries[0]!, score: 100 }],
    };
    const result = await hybridSearchV2("animals", entries, {
      bm25,
      dense,
      extra: [extra],
    });
    expect(result.extraHits.has("recency")).toBe(true);
  });

  it("parallel=false runs retrievers sequentially", async () => {
    const order: string[] = [];
    const slowBm25: Retriever = {
      name: "bm25",
      search: async () => {
        order.push("bm25-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("bm25-end");
        return [];
      },
    };
    const slowDense: Retriever = {
      name: "dense",
      search: async () => {
        order.push("dense-start");
        return [];
      },
    };
    await hybridSearchV2("q", entries, {
      bm25: slowBm25,
      dense: slowDense,
      parallel: false,
    });
    expect(order).toEqual(["bm25-start", "bm25-end", "dense-start"]);
  });

  it("reports duration and rerankerApplied flag", async () => {
    const result = await hybridSearchV2("animals", entries, { bm25, dense });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.rerankerApplied).toBe(false);
  });

  it("fusedBeforeRerank captures the pre-rerank state", async () => {
    const reranker: Reranker = {
      name: "reverse",
      rerank: async (_q, h) => [...h].reverse(),
    };
    const result = await hybridSearchV2("animals", entries, {
      bm25,
      dense,
      reranker,
    });
    expect(result.fusedBeforeRerank.length).toBeGreaterThan(0);
    // After rerank, order is different
    if (result.hits.length >= 2 && result.fusedBeforeRerank.length >= 2) {
      const fused0 = result.fusedBeforeRerank[0]?.entry.id;
      const final0 = result.hits[0]?.entry.id;
      // Reversed → first becomes last
      const fusedLast =
        result.fusedBeforeRerank[result.fusedBeforeRerank.length - 1]?.entry.id;
      expect(final0).toBe(fusedLast);
      expect(final0).not.toBe(fused0);
    }
  });
});

// ── Cross-encoder stub + wrapper ───────────────────────

describe("createCrossEncoderStub", () => {
  it("returns a score per doc (non-empty)", async () => {
    const stub = createCrossEncoderStub();
    const out = await stub({ query: "q", docs: ["a", "b", "c"] });
    expect(out.scores).toHaveLength(3);
    expect(out.scores.every((s) => s >= 0 && s <= 1)).toBe(true);
  });

  it("returns empty scores for empty docs", async () => {
    const stub = createCrossEncoderStub();
    const out = await stub({ query: "q", docs: [] });
    expect(out.scores).toEqual([]);
  });

  it("scores decay with position (documented stub behavior)", async () => {
    const stub = createCrossEncoderStub();
    const out = await stub({ query: "q", docs: ["a", "b", "c", "d"] });
    // Linear decay 1.0 → 0.1
    expect(out.scores[0]).toBeGreaterThan(out.scores[3] ?? 0);
  });
});

describe("createCrossEncoderReranker", () => {
  it("wraps a CrossEncoderFn as a Reranker", async () => {
    const reranker = createCrossEncoderReranker(createCrossEncoderStub());
    const hits: SearchHit[] = [
      { entry: entries[0]!, score: 1 },
      { entry: entries[1]!, score: 0.5 },
    ];
    const out = await reranker.rerank("q", hits);
    expect(out).toHaveLength(2);
  });

  it("sorts by cross-encoder score", async () => {
    // Custom encoder: assigns high score to the SECOND doc
    const customEnc = async (_: { query: string; docs: readonly string[] }) => ({
      scores: [0.1, 0.9],
    });
    const reranker = createCrossEncoderReranker(customEnc);
    const hits: SearchHit[] = [
      { entry: entries[0]!, score: 1 },
      { entry: entries[1]!, score: 0.5 },
    ];
    const out = await reranker.rerank("q", hits);
    // Second doc now first
    expect(out[0]?.entry.id).toBe("b");
    expect(out[0]?.score).toBe(0.9);
  });

  it("preserves order on length mismatch", async () => {
    const badEnc = async () => ({ scores: [0.5] }); // wrong length
    const reranker = createCrossEncoderReranker(badEnc);
    const hits: SearchHit[] = [
      { entry: entries[0]!, score: 1 },
      { entry: entries[1]!, score: 0.5 },
    ];
    const out = await reranker.rerank("q", hits);
    expect(out).toEqual(hits);
  });

  it("returns empty for empty hits", async () => {
    const reranker = createCrossEncoderReranker(createCrossEncoderStub());
    const out = await reranker.rerank("q", []);
    expect(out).toEqual([]);
  });
});

// ── End-to-end: BM25 + dense + cross-encoder stub ──────

describe("end-to-end hybridSearchV2 with cross-encoder", () => {
  it("runs BM25 + dense + stub reranker without deps", async () => {
    const reranker = createCrossEncoderReranker(createCrossEncoderStub());
    const result = await hybridSearchV2("cats and dogs", entries, {
      bm25: createBm25Retriever(),
      dense: createDenseRetriever({ embed: fakeEmbed }),
      reranker,
      k: 3,
    });
    expect(result.rerankerApplied).toBe(true);
    expect(result.hits.length).toBeLessThanOrEqual(3);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("rerankThreshold filters stub outputs honestly", async () => {
    const reranker = createCrossEncoderReranker(createCrossEncoderStub());
    const result = await hybridSearchV2("animals", entries, {
      bm25: createBm25Retriever(),
      dense: createDenseRetriever({ embed: fakeEmbed }),
      reranker,
      rerankThreshold: 0.5, // stub decays from 1.0 → 0.1, so some drop
    });
    expect(result.rerankerApplied).toBe(true);
    // All remaining hits must be above threshold
    expect(result.hits.every((h) => h.score >= 0.5)).toBe(true);
  });
});
