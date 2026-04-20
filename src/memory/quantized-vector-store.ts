/**
 * Quantized Vector Store (S3-4 — TurboQuant integration).
 *
 * Previously offered an opt-in MiniLM embedding path via the optional
 * `@xenova/transformers` dependency. That package sat on top of
 * `onnxruntime-web` and `onnx-proto`, which inherited the protobufjs
 * arbitrary-code-execution CVE (GHSA-xq3m-2v4x-88gg). Dropped in the
 * Tier-0 CVE sweep; this module is now a TF-IDF-only wrapper that
 * preserves the historical public API so every call site keeps
 * compiling.
 *
 *   Before: TF-IDF default + opt-in ONNX MiniLM via @xenova/transformers
 *   After:  TF-IDF only — callers that need semantic recall should use
 *           a native (non-protobufjs) embedding path instead.
 *
 * Honest-stub contract: the methods that used to switch backends still
 * exist so downstream callers don't break, but they now always report
 * the TF-IDF backend. `ready()` returns `false` (never true) so anyone
 * gating on "embeddings live" correctly sees they aren't.
 *
 * The tradeoff vs the prior implementation:
 *
 *   TF-IDF (still present, now the only backend):
 *     - Zero deps, instant startup, ~5KB code
 *     - Good for literal-conceptual matches (synonyms, stems)
 *     - Weak on paraphrase ("authentication" vs "login flow")
 *
 *   MiniLM via @xenova/transformers (REMOVED):
 *     - Shipped 9 CVEs via transitive protobufjs
 *     - Cold-load took ~10s for 50MB of weights
 *     - Not worth keeping pinned to 2.0.1 — drop it wholesale
 *
 * Future work: P1-M2 in MASTER_PLAN_V8 calls for OMEGA 3-layer SQLite +
 * sqlite-vec + native ONNX (without the transformers shim) to close the
 * paraphrase gap safely.
 */

import { TFIDFIndex } from "./semantic-search.js";
import { computeContentSha } from "./incremental-indexer.js";

export interface VectorSearchResult {
  readonly id: string;
  readonly score: number;
  readonly text: string;
}

/**
 * Configuration for the quantized vector store. Fields are kept for
 * backwards compatibility; the embedding-side knobs (dimensions,
 * quantizationBits, modelId, embeddingWeight) are now inert because the
 * ONNX path is removed. Left in place so callers don't break.
 */
export interface QuantizedVectorStoreConfig {
  /** Dimensionality of the embedding model (retained for API compat, unused). */
  readonly dimensions?: number;
  /** Quantization bits (retained for API compat, unused). */
  readonly quantizationBits?: number;
  /** Model id (retained for API compat, unused). */
  readonly modelId?: string;
  /**
   * Skip the ONNX path entirely and use TF-IDF. Now always behaves as
   * true (ONNX path removed) — kept in the API so tests that set it
   * still compile and the intent is preserved.
   */
  readonly forceTFIDFFallback?: boolean;
  /** Merge weight for embeddings vs TF-IDF (retained for API compat, unused). */
  readonly embeddingWeight?: number;
}

const DEFAULT_CONFIG: Required<QuantizedVectorStoreConfig> = {
  dimensions: 384,
  quantizationBits: 8,
  modelId: "disabled-post-cve-sweep",
  forceTFIDFFallback: true,
  embeddingWeight: 0,
};

/**
 * QuantizedVectorStore — TF-IDF index wrapped in the legacy shape so
 * callers that previously constructed this class keep compiling. All
 * embedding-specific fields on the constructor config are inert; the
 * `ready()` method always resolves to `false`; `getBackend()` always
 * returns `"tfidf-fallback"` once a query has fired.
 */
export class QuantizedVectorStore {
  private readonly config: Required<QuantizedVectorStoreConfig>;
  private readonly fallback = new TFIDFIndex();
  /**
   * Phase 13 Wave-3C — per-id SHA of last indexed content for change
   * detection. addDocument skips the re-ingest when content is
   * unchanged (pure redundancy elimination).
   */
  private readonly contentShas: Map<string, string> = new Map();
  /** Once ready() has been called we report "tfidf-fallback" instead of "uninitialized". */
  private readyCalled = false;

  constructor(config: QuantizedVectorStoreConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, forceTFIDFFallback: true };
  }

  /**
   * Initialize the embedding pipeline. The ONNX path was removed in the
   * CVE sweep, so this ALWAYS resolves to `false`. Callers that gated
   * on ready() correctly see that embeddings aren't live.
   */
  async ready(): Promise<boolean> {
    this.readyCalled = true;
    return false;
  }

  /**
   * Add a document to the TF-IDF index. The prior ONNX encode queue is
   * gone — this is now a synchronous write under the hood.
   */
  addDocument(id: string, content: string): void {
    // Phase 13 Wave-3C: incremental-indexer SHA skip. When the same id is
    // re-added with unchanged content, skip the re-ingest.
    let sha: string | null = null;
    try {
      sha = computeContentSha(content);
    } catch {
      sha = null;
    }
    if (sha !== null && this.contentShas.get(id) === sha) return;
    this.fallback.addDocument(id, content);
    if (sha !== null) this.contentShas.set(id, sha);
  }

  /** Remove a document. API parity with TFIDFIndex.removeDocument. */
  removeDocument(id: string): void {
    this.fallback.removeDocument(id);
    this.contentShas.delete(id);
  }

  /** Clear the TF-IDF index. API parity with TFIDFIndex.clear. */
  clear(): void {
    this.fallback.clear();
    this.contentShas.clear();
  }

  /** Vocabulary size. API parity with TFIDFIndex.vocabularySize. */
  vocabularySize(): number {
    return this.fallback.vocabularySize();
  }

  /**
   * Search the TF-IDF index. Previously merged TF-IDF + embedding
   * results via reciprocal-rank fusion; now TF-IDF alone. Kept async
   * for API parity with prior callers that awaited the result.
   */
  async search(query: string, limit: number = 10): Promise<readonly VectorSearchResult[]> {
    // Read-only reference — satisfies noUnusedLocals for inert config fields
    // that we keep around for backwards compat.
    void this.config;
    return this.fallback.search(query, limit);
  }

  /**
   * Cosine similarity between two stored documents. The prior
   * implementation computed this on quantized embedding vectors; with
   * the ONNX path removed we can't synthesise a vector-space similarity
   * so we return null — the HONEST signal that this store no longer
   * offers pairwise similarity. Callers should use `search()` with one
   * document as the query and look for the other in the results.
   */
  similarity(_idA: string, _idB: string): number | null {
    return null;
  }

  /** Total documents in the store. */
  size(): number {
    return this.fallback.size();
  }

  /**
   * Return diagnostics about which backend is active. Kept as a
   * discriminated union for backwards compat; always one of:
   *   - "tfidf-fallback"  after ready() has been called
   *   - "uninitialized"   before any method that implies setup
   * The "onnx-minilm" variant is retired and never returned now.
   */
  getBackend(): "onnx-minilm" | "tfidf-fallback" | "uninitialized" {
    if (this.readyCalled) return "tfidf-fallback";
    if (this.config.forceTFIDFFallback) return "tfidf-fallback";
    return "uninitialized";
  }
}
