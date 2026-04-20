import { describe, it, expect, beforeEach } from "vitest";
import { QuantizedVectorStore } from "../../src/memory/quantized-vector-store.js";

// Session-4 regression guards for S3-4 phase 2.
//
// Tier-0 CVE sweep removed @xenova/transformers — the ONNX embedding
// path shipped 9 CVEs through the protobufjs chain. QuantizedVectorStore
// is now TF-IDF-only under the same public API. This file's test
// surface focuses on:
// - the forceTFIDFFallback contract (always-deterministic, now the only
//   backend)
// - API parity with TFIDFIndex (addDocument / removeDocument / clear /
//   size / vocabularySize / similarity)
// - backend diagnostics (getBackend always "tfidf-fallback" post-sweep)
// The MiniLM embedding capability that previously lived behind an env
// flag is now PERMANENTLY SKIPPED (marked [LOST]) — re-enable when
// P1-M2 delivers a native sqlite-vec + ONNX path without the CVE chain.

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

// ─── LOST CAPABILITY (Tier-0 CVE sweep trade-off) ───────────────
//
// The three tests below previously exercised the real MiniLM ONNX
// path provided by @xenova/transformers. That package shipped 9 CVEs
// (4 CRITICAL) via its transitive protobufjs dependency, with no
// non-breaking upgrade available. The Tier-0 security sweep dropped
// @xenova/transformers in favour of a CVE-free future P1-M2 native
// sqlite-vec + ONNX path.
//
// Rather than silently weaken the assertions (Quality Bar #9: never
// modify tests just to make them pass), the three MiniLM tests are
// marked PERMANENTLY SKIPPED with a [LOST] prefix. Previously they
// were env-gated behind WOTANN_RUN_ONNX_TESTS=1 and internally
// skipped via `if (!available) return`, so CI never saw them fail;
// making the skip explicit surfaces the regression honestly in
// `npm test` output without breaking any assertion contract.

describe("QuantizedVectorStore — MiniLM semantic search (LOST in CVE sweep)", () => {
  it.skip("[LOST] backend switches from tfidf-fallback to onnx-minilm", async () => {
    // @xenova/transformers removed in Tier-0 CVE sweep. Re-enable
    // when P1-M2 ships native sqlite-vec + ONNX without protobufjs.
  });

  it.skip("[LOST] produces vectors whose self-similarity is near 1", async () => {
    // @xenova/transformers removed in Tier-0 CVE sweep. Re-enable
    // when P1-M2 ships native sqlite-vec + ONNX without protobufjs.
  });

  it.skip("[LOST] semantic similarity on related content exceeds unrelated content", async () => {
    // @xenova/transformers removed in Tier-0 CVE sweep. Re-enable
    // when P1-M2 ships native sqlite-vec + ONNX without protobufjs.
  });
});
