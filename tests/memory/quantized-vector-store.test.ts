import { describe, it, expect, beforeEach } from "vitest";
import { QuantizedVectorStore } from "../../src/memory/quantized-vector-store.js";

// Session-4 regression guards for S3-4 phase 2 — @xenova/transformers
// wiring. The real ONNX path requires ~50MB of model weights from
// HuggingFace, so these unit tests focus on:
// - the forceTFIDFFallback contract (always-deterministic)
// - API parity with TFIDFIndex (addDocument / removeDocument / clear /
//   size / vocabularySize / similarity)
// - backend diagnostics
// The model-loading path is runtime-verified separately (loading a
// 50MB HuggingFace model inside `npm test` would be flaky + slow).

describe("QuantizedVectorStore — TF-IDF fallback contract", () => {
  let store: QuantizedVectorStore;

  beforeEach(() => {
    store = new QuantizedVectorStore({ forceTFIDFFallback: true });
  });

  it("search() returns TF-IDF hits when forceTFIDFFallback", async () => {
    store.addDocument("a", "the quick brown fox jumps over the lazy dog");
    store.addDocument("b", "lorem ipsum dolor sit amet consectetur adipiscing");
    store.addDocument("c", "the fox and the hound are old friends");
    const results = await store.search("fox friends", 5);
    // Both a and c contain "fox"; c also has "friends" — should rank
    // somewhere in the result list.
    const ids = results.map((r) => r.id);
    expect(ids).toContain("c");
  });

  it("getBackend reports tfidf-fallback when forced", () => {
    expect(store.getBackend()).toBe("tfidf-fallback");
  });

  it("size() reflects TF-IDF fallback document count", () => {
    expect(store.size()).toBe(0);
    store.addDocument("a", "first");
    store.addDocument("b", "second");
    expect(store.size()).toBe(2);
  });
});

describe("QuantizedVectorStore — API parity with TFIDFIndex", () => {
  let store: QuantizedVectorStore;

  beforeEach(() => {
    store = new QuantizedVectorStore({ forceTFIDFFallback: true });
  });

  it("removeDocument removes from TF-IDF fallback", async () => {
    store.addDocument("a", "alpha beta gamma");
    store.addDocument("b", "alpha beta delta");
    store.removeDocument("a");
    expect(store.size()).toBe(1);
    const hits = await store.search("alpha", 10);
    expect(hits.every((h) => h.id !== "a")).toBe(true);
  });

  it("clear wipes all state", async () => {
    store.addDocument("a", "alpha");
    store.addDocument("b", "beta");
    store.clear();
    expect(store.size()).toBe(0);
    const hits = await store.search("alpha", 10);
    expect(hits).toHaveLength(0);
  });

  it("vocabularySize grows with new unique terms", () => {
    const initial = store.vocabularySize();
    store.addDocument("a", "authentication login oauth tokens");
    expect(store.vocabularySize()).toBeGreaterThan(initial);
  });

  it("similarity returns null in TF-IDF fallback mode (no vector-level comparison)", () => {
    // Pure TF-IDF mode doesn't maintain raw doc content per id so we
    // can't compute a vector-space similarity. Returning null is the
    // honest signal — callers can fall back to asking `search()` for
    // one doc's content and looking for the other in the result set.
    store.addDocument("a", "the quick brown fox");
    store.addDocument("b", "brown fox jumps over");
    const sim = store.similarity("a", "b");
    expect(sim).toBeNull();
  });

  it("similarity returns null for unknown ids", () => {
    expect(store.similarity("unknown_a", "unknown_b")).toBeNull();
  });
});

describe("QuantizedVectorStore — drop-in semantics for legacy consumers", () => {
  it("search() is async (caller must await)", async () => {
    const store = new QuantizedVectorStore({ forceTFIDFFallback: true });
    store.addDocument("a", "test document");
    const result = store.search("test", 5);
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(Array.isArray(resolved)).toBe(true);
  });

  it("addDocument is fire-and-forget (synchronous API, embedding queue behind)", () => {
    const store = new QuantizedVectorStore({ forceTFIDFFallback: true });
    // No await — the embedding queue runs on a microtask queue in the
    // non-fallback path; in fallback mode this is a TF-IDF-only write
    // that never touches the queue.
    expect(() => {
      store.addDocument("a", "hello");
      store.addDocument("b", "world");
    }).not.toThrow();
    expect(store.size()).toBe(2);
  });
});
