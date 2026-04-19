import { describe, it, expect, vi } from "vitest";
import {
  hybridSearch,
  createLexicalRetriever,
  createVectorRetriever,
  createLlmReranker,
  type Retriever,
  type SearchableEntry,
} from "../../src/memory/hybrid-retrieval.js";

const entries: SearchableEntry[] = [
  { id: "a", content: "cats are animals", embedding: [1, 0, 0] },
  { id: "b", content: "dogs are animals", embedding: [0.9, 0.1, 0] },
  { id: "c", content: "trees are plants", embedding: [0, 1, 0] },
  { id: "d", content: "elephants are large animals", embedding: [0.8, 0, 0.2] },
];

describe("hybridSearch", () => {
  it("returns [] when no retrievers configured", async () => {
    const result = await hybridSearch("animals", entries, { retrievers: [] });
    expect(result.hits).toEqual([]);
  });

  it("runs all retrievers and fuses via RRF", async () => {
    const r1: Retriever = {
      name: "r1",
      search: async () => [
        { entry: entries[0]!, score: 1 },
        { entry: entries[1]!, score: 0.8 },
      ],
    };
    const r2: Retriever = {
      name: "r2",
      search: async () => [
        { entry: entries[1]!, score: 1 },
        { entry: entries[0]!, score: 0.5 },
      ],
    };
    const result = await hybridSearch("q", entries, { retrievers: [r1, r2] });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.perRetriever.size).toBe(2);
  });

  it("applies reranker when provided", async () => {
    const r: Retriever = {
      name: "r",
      search: async () => [
        { entry: entries[0]!, score: 1 },
        { entry: entries[1]!, score: 0.5 },
      ],
    };
    const reranker = {
      name: "rr",
      rerank: vi.fn(async (_q: string, hits: readonly unknown[]) => hits),
    };
    const result = await hybridSearch("q", entries, {
      retrievers: [r],
      reranker,
    });
    expect(reranker.rerank).toHaveBeenCalledOnce();
    expect(result.rerankerApplied).toBe(true);
  });

  it("falls back to fused order when reranker throws", async () => {
    const r: Retriever = {
      name: "r",
      search: async () => [{ entry: entries[0]!, score: 1 }],
    };
    const reranker = {
      name: "rr",
      rerank: async () => {
        throw new Error("rerank failed");
      },
    };
    const result = await hybridSearch("q", entries, {
      retrievers: [r],
      reranker,
    });
    expect(result.rerankerApplied).toBe(false);
  });

  it("handles retriever errors gracefully", async () => {
    const working: Retriever = {
      name: "ok",
      search: async () => [{ entry: entries[0]!, score: 1 }],
    };
    const broken: Retriever = {
      name: "broken",
      search: async () => {
        throw new Error("retriever down");
      },
    };
    const result = await hybridSearch("q", entries, {
      retrievers: [working, broken],
    });
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("respects topK limit", async () => {
    const r: Retriever = {
      name: "r",
      search: async () => entries.map((e, i) => ({ entry: e, score: entries.length - i })),
    };
    const result = await hybridSearch("q", entries, {
      retrievers: [r],
      topK: 2,
    });
    expect(result.hits).toHaveLength(2);
  });

  it("parallel=false runs retrievers sequentially", async () => {
    const order: string[] = [];
    const r1: Retriever = {
      name: "r1",
      search: async () => {
        order.push("r1-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("r1-end");
        return [];
      },
    };
    const r2: Retriever = {
      name: "r2",
      search: async () => {
        order.push("r2-start");
        return [];
      },
    };
    await hybridSearch("q", entries, { retrievers: [r1, r2], parallel: false });
    expect(order).toEqual(["r1-start", "r1-end", "r2-start"]);
  });
});

describe("createLexicalRetriever", () => {
  it("matches by token overlap", async () => {
    const retriever = createLexicalRetriever();
    const hits = await retriever.search("animals", entries);
    // a, b, d all contain "animals"; c doesn't
    expect(hits.map((h) => h.entry.id).sort()).toEqual(["a", "b", "d"]);
  });

  it("returns [] for empty query", async () => {
    const retriever = createLexicalRetriever();
    expect(await retriever.search("", entries)).toEqual([]);
  });
});

describe("createVectorRetriever", () => {
  it("uses pre-computed embeddings when available", async () => {
    const embedSpy = vi.fn(async () => [1, 0, 0]);
    const retriever = createVectorRetriever({ embed: embedSpy });
    await retriever.search("cats", entries);
    // Only the QUERY embedding needs a call since entries have pre-computed ones
    expect(embedSpy).toHaveBeenCalledTimes(1);
  });

  it("ranks by cosine similarity", async () => {
    const retriever = createVectorRetriever({ embed: async () => [1, 0, 0] });
    const hits = await retriever.search("q", entries);
    // Query vector [1,0,0] most similar to entry a [1,0,0]
    expect(hits[0]?.entry.id).toBe("a");
  });
});

describe("createLlmReranker", () => {
  it("reorders hits by LLM response", async () => {
    const reranker = createLlmReranker({
      llmQuery: async () => "[2, 0, 1]",
    });
    const hits = [
      { entry: entries[0]!, score: 1 },
      { entry: entries[1]!, score: 0.8 },
      { entry: entries[2]!, score: 0.5 },
    ];
    const reordered = await reranker.rerank("q", hits);
    expect(reordered[0]?.entry.id).toBe("c"); // index 2 first
    expect(reordered[1]?.entry.id).toBe("a");
  });

  it("falls back on malformed response", async () => {
    const reranker = createLlmReranker({ llmQuery: async () => "garbage" });
    const hits = [
      { entry: entries[0]!, score: 1 },
      { entry: entries[1]!, score: 0.5 },
    ];
    const reordered = await reranker.rerank("q", hits);
    expect(reordered).toEqual(hits);
  });

  it("skips rerank on 0 or 1 hits", async () => {
    const query = vi.fn(async () => "[]");
    const reranker = createLlmReranker({ llmQuery: query });
    await reranker.rerank("q", [{ entry: entries[0]!, score: 1 }]);
    expect(query).not.toHaveBeenCalled();
  });

  it("appends unseen indices in original order", async () => {
    const reranker = createLlmReranker({ llmQuery: async () => "[0]" });
    const hits = [
      { entry: entries[0]!, score: 1 },
      { entry: entries[1]!, score: 0.5 },
      { entry: entries[2]!, score: 0.3 },
    ];
    const reordered = await reranker.rerank("q", hits);
    expect(reordered).toHaveLength(3);
    expect(reordered[0]?.entry.id).toBe("a"); // index 0
    // Remaining appended
    expect(reordered.map((h) => h.entry.id).sort()).toEqual(["a", "b", "c"]);
  });
});
