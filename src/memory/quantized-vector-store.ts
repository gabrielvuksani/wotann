/**
 * Quantized Vector Store (S3-4 — TurboQuant integration).
 *
 * Replaces the TF-IDF semantic search internals with embedding-based
 * dense vectors when `@xenova/transformers` is available; otherwise
 * transparently falls back to the existing TFIDFIndex so users without
 * the optional ML dependency still get conceptual search.
 *
 * The tradeoff vs the existing `semantic-search.ts`:
 *
 *   TF-IDF (current default):
 *     - Zero deps, instant startup, ~5KB code
 *     - Good for literal-conceptual matches (synonyms, stems)
 *     - Weak on paraphrase ("authentication" vs "login flow")
 *
 *   MiniLM via @xenova/transformers (this module):
 *     - Adds ~50MB optionalDependency; tokeniser + ONNX runtime bundled
 *     - First query downloads model weights from HuggingFace CDN (cached)
 *     - Real semantic recall — handles paraphrase and cross-lingual
 *
 * The class exposes the SAME public API as TFIDFIndex (addDocument /
 * removeDocument / search / similarity / size / vocabularySize / clear)
 * so it's a drop-in replacement. The default runtime path keeps TF-IDF
 * for zero-cost startup; callers opt into embeddings by constructing
 * `QuantizedVectorStore` directly OR by setting
 * `WOTANN_ENABLE_ONNX_EMBEDDINGS=1` (honoured by the runtime when it
 * chooses which backing index to instantiate).
 *
 * Session-4 (2026-04-17) replaced the hand-rolled onnxruntime-web +
 * WordPiece-tokenizer stub with a single `pipeline('feature-extraction',
 * 'Xenova/all-MiniLM-L6-v2')` call — the transformers package handles
 * tokenisation, inference, and mean-pooling in one shot. The prior
 * scaffold threw on encode(); this version returns a real 384-d vector.
 */

import { TFIDFIndex } from "./semantic-search.js";
import { computeContentSha } from "./incremental-indexer.js";

export interface VectorSearchResult {
  readonly id: string;
  readonly score: number;
  readonly text: string;
}

/**
 * Configuration for the quantized vector store. All optional —
 * sensible defaults that work with all-MiniLM-L6-v2 from HuggingFace
 * via the @xenova/transformers pipeline.
 */
export interface QuantizedVectorStoreConfig {
  /** Dimensionality of the embedding model (default: 384 for MiniLM-L6). */
  readonly dimensions?: number;
  /** Number of bits to quantize embeddings to (1, 2, 4, 8). Default 8. */
  readonly quantizationBits?: number;
  /** Model id passed to the transformers pipeline. */
  readonly modelId?: string;
  /** Skip the ONNX path entirely and use TF-IDF — useful for tests. */
  readonly forceTFIDFFallback?: boolean;
  /**
   * Weight for the embedding contribution when merging with the TF-IDF
   * result set in search(). Defaults to 0.7 — favours semantic matches
   * once the model is loaded, while keeping TF-IDF's literal-match
   * signal as a tie-breaker for queries with exact keyword overlap.
   */
  readonly embeddingWeight?: number;
}

const DEFAULT_CONFIG: Required<QuantizedVectorStoreConfig> = {
  dimensions: 384,
  quantizationBits: 8,
  modelId: "Xenova/all-MiniLM-L6-v2",
  forceTFIDFFallback: false,
  embeddingWeight: 0.7,
};

/**
 * Minimal structural type for the transformers `FeatureExtractionPipeline`.
 * Spelling out the call signature keeps the module typecheck-clean
 * without depending on @xenova/transformers types at compile time.
 */
type FeatureExtractor = (
  input: string,
  options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: readonly number[] }>;

type TransformersModule = {
  readonly pipeline: (
    task: "feature-extraction",
    modelId: string,
    options?: Record<string, unknown>,
  ) => Promise<FeatureExtractor>;
};

/**
 * Try to load @xenova/transformers. Returns the module if installed,
 * null otherwise. Caches both success and failure.
 */
let cachedTransformers: TransformersModule | null | undefined;
async function loadTransformers(): Promise<TransformersModule | null> {
  if (cachedTransformers !== undefined) return cachedTransformers;
  try {
    // Dynamic import keeps @xenova/transformers an optionalDependency
    // so users without the ~50MB package still get the TF-IDF path.
    const mod = (await import("@xenova/transformers" as string)) as unknown as TransformersModule;
    cachedTransformers = mod;
    return mod;
  } catch {
    cachedTransformers = null;
    return null;
  }
}

/**
 * Quantize a Float32Array of embeddings into N-bit integers. Reduces
 * storage 4-32x with minimal recall loss for cosine similarity. The
 * quantization is symmetric around zero so we can use a single scale
 * factor per vector.
 */
function quantize(vec: Float32Array, bits: number): { data: Int8Array; scale: number } {
  let max = 0;
  for (const v of vec) {
    const abs = v < 0 ? -v : v;
    if (abs > max) max = abs;
  }
  const range = (1 << (bits - 1)) - 1;
  const scale = max > 0 ? range / max : 1;
  const data = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const value = vec[i] ?? 0;
    data[i] = Math.round(value * scale);
  }
  return { data, scale };
}

function dequantizeCosine(
  a: { data: Int8Array; scale: number },
  b: { data: Int8Array; scale: number },
): number {
  // Cosine similarity directly on quantized vectors (the dot product
  // works because both sides have the same quantization scheme; we just
  // skip the dequantization step).
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.data.length; i++) {
    const av = a.data[i] ?? 0;
    const bv = b.data[i] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  const denom = Math.sqrt(aMag * bMag);
  return denom > 0 ? dot / denom : 0;
}

/**
 * QuantizedVectorStore. Public API matches TFIDFIndex — addDocument,
 * removeDocument, search, similarity, size, vocabularySize, clear —
 * so it's a drop-in replacement. The internal representation is dense
 * quantized embeddings (Int8Array per vector) when @xenova/transformers
 * is available, falling through to TF-IDF when it isn't.
 */
export class QuantizedVectorStore {
  private readonly config: Required<QuantizedVectorStoreConfig>;
  private readonly fallback = new TFIDFIndex();
  private extractor: FeatureExtractor | null = null;
  private readyPromise: Promise<boolean> | null = null;
  private readonly vectors: Map<string, { quant: ReturnType<typeof quantize>; content: string }> =
    new Map();
  private readonly encodeQueue: Array<{ id: string; content: string }> = [];
  private encoding = false;
  /**
   * Phase 13 Wave-3C — per-id SHA of last indexed content for change
   * detection. addDocument skips the embed queue when the content is
   * unchanged (pure redundancy elimination, no behavioural change).
   */
  private readonly contentShas: Map<string, string> = new Map();

  constructor(config: QuantizedVectorStoreConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the transformers pipeline. Idempotent — subsequent calls
   * return the cached promise. Returns true on success (use embeddings),
   * false on any failure (fall back to TF-IDF).
   */
  async ready(): Promise<boolean> {
    if (this.config.forceTFIDFFallback) return false;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const transformers = await loadTransformers();
      if (!transformers) return false;
      try {
        this.extractor = await transformers.pipeline("feature-extraction", this.config.modelId);
        return true;
      } catch {
        this.extractor = null;
        return false;
      }
    })();
    return this.readyPromise;
  }

  /**
   * Add a document to the index. Always writes to the TF-IDF fallback
   * so literal/keyword matches still work; also queues an embedding
   * encode when ONNX is available (or will be once ready() resolves).
   */
  addDocument(id: string, content: string): void {
    // Phase 13 Wave-3C: incremental-indexer SHA skip. When the same id is
    // re-added with unchanged content, skip the TF-IDF re-ingest AND the
    // ONNX encode queue. Writes stay idempotent; first-add always runs.
    let sha: string | null = null;
    try {
      sha = computeContentSha(content);
    } catch {
      sha = null;
    }
    if (sha !== null && this.contentShas.get(id) === sha) return;
    this.fallback.addDocument(id, content);
    if (sha !== null) this.contentShas.set(id, sha);
    if (this.config.forceTFIDFFallback) return;
    this.encodeQueue.push({ id, content });
    void this.drainQueue();
  }

  /**
   * Remove a document from both the TF-IDF fallback and the vector
   * cache. API parity with TFIDFIndex.removeDocument.
   */
  removeDocument(id: string): void {
    this.fallback.removeDocument(id);
    this.vectors.delete(id);
    this.contentShas.delete(id);
    // Also drop any queued-but-not-yet-encoded entry for this id.
    for (let i = this.encodeQueue.length - 1; i >= 0; i--) {
      if (this.encodeQueue[i]?.id === id) this.encodeQueue.splice(i, 1);
    }
  }

  /**
   * Clear both backends. API parity with TFIDFIndex.clear.
   */
  clear(): void {
    this.fallback.clear();
    this.vectors.clear();
    this.encodeQueue.length = 0;
    this.contentShas.clear();
  }

  /**
   * Vocabulary size reported by the TF-IDF fallback (always present).
   * API parity with TFIDFIndex.vocabularySize.
   */
  vocabularySize(): number {
    return this.fallback.vocabularySize();
  }

  private async drainQueue(): Promise<void> {
    if (this.encoding) return;
    this.encoding = true;
    try {
      const ok = await this.ready();
      if (!ok) return; // TF-IDF fallback is already populated
      while (this.encodeQueue.length > 0) {
        const next = this.encodeQueue.shift();
        if (!next) continue;
        try {
          const vec = await this.encode(next.content);
          this.vectors.set(next.id, {
            quant: quantize(vec, this.config.quantizationBits),
            content: next.content,
          });
        } catch {
          // One failed encode shouldn't block the queue; the TF-IDF
          // fallback has the doc either way.
        }
      }
    } finally {
      this.encoding = false;
    }
  }

  /**
   * Encode a string to a dense embedding via the transformers pipeline.
   * Session-4 replaced the prior "not yet implemented" throw with a
   * real pipeline call — tokenisation, inference, and mean-pooling
   * happen inside the transformers package.
   */
  private async encode(content: string): Promise<Float32Array> {
    if (!this.extractor) throw new Error("Extractor not ready");
    const output = await this.extractor(content, { pooling: "mean", normalize: true });
    // The pipeline returns a Tensor-like object with `.data` as Float32Array.
    // We copy into a fresh Float32Array so the caller owns the buffer.
    return new Float32Array(output.data);
  }

  /**
   * Search for documents similar to the query. Merges embedding-backed
   * cosine-similarity scores with TF-IDF results using reciprocal-rank
   * fusion — the result set contains both "semantic matches" (embedding
   * path) and "literal matches" (TF-IDF path), ranked by combined score.
   * When embeddings aren't loaded yet or the optional dep is absent,
   * falls through to the TF-IDF path so callers always get something.
   */
  async search(query: string, limit: number = 10): Promise<readonly VectorSearchResult[]> {
    const tfidfResults = this.fallback.search(query, limit * 2);
    // If embeddings aren't active, TF-IDF is the only signal we have.
    if (this.config.forceTFIDFFallback) return tfidfResults.slice(0, limit);
    if (this.vectors.size === 0) {
      // Either the pipeline hasn't finished loading or no docs have been
      // encoded yet; TF-IDF covers the interim.
      return tfidfResults.slice(0, limit);
    }
    const ok = await this.ready();
    if (!ok || !this.extractor) return tfidfResults.slice(0, limit);
    let queryVec: Float32Array;
    try {
      queryVec = await this.encode(query);
    } catch {
      return tfidfResults.slice(0, limit);
    }
    const queryQuant = quantize(queryVec, this.config.quantizationBits);
    const vectorResults: VectorSearchResult[] = [];
    for (const [id, entry] of this.vectors.entries()) {
      const score = dequantizeCosine(queryQuant, entry.quant);
      if (score > 0) {
        vectorResults.push({ id, score, text: entry.content });
      }
    }
    vectorResults.sort((a, b) => b.score - a.score);
    return mergeByReciprocalRank(
      tfidfResults,
      vectorResults,
      1 - this.config.embeddingWeight,
      limit,
    );
  }

  /**
   * Cosine similarity between two stored documents. Returns null when
   * either id is unknown. TF-IDF fallback for documents without a
   * computed embedding (or when ONNX backend is inactive).
   */
  similarity(idA: string, idB: string): number | null {
    const a = this.vectors.get(idA);
    const b = this.vectors.get(idB);
    if (a && b) return dequantizeCosine(a.quant, b.quant);
    // TFIDFIndex doesn't expose a public similarity API, so we
    // approximate via reciprocal-rank: search using one as query and
    // see where the other ranks. Crude but a useful fallback signal.
    const ranked = this.fallback.search(a?.content ?? b?.content ?? "", 50);
    const idx = ranked.findIndex((r) => r.id === (a ? idB : idA));
    return idx >= 0 ? 1 / (idx + 1) : null;
  }

  /** Total documents in the store. */
  size(): number {
    return this.fallback.size();
  }

  /** Return diagnostics about which backend is active. */
  getBackend(): "onnx-minilm" | "tfidf-fallback" | "uninitialized" {
    if (this.config.forceTFIDFFallback) return "tfidf-fallback";
    if (!this.readyPromise) return "uninitialized";
    if (this.extractor && this.vectors.size > 0) return "onnx-minilm";
    return "tfidf-fallback";
  }
}

function mergeByReciprocalRank(
  tfidf: readonly VectorSearchResult[],
  vector: readonly VectorSearchResult[],
  keywordWeight: number,
  limit: number,
): readonly VectorSearchResult[] {
  const vectorWeight = 1 - keywordWeight;
  const scores = new Map<string, { score: number; text: string }>();
  for (let i = 0; i < tfidf.length; i++) {
    const r = tfidf[i]!;
    const rrf = keywordWeight * (1 / (i + 1));
    scores.set(r.id, { score: rrf, text: r.text });
  }
  for (let i = 0; i < vector.length; i++) {
    const r = vector[i]!;
    const rrf = vectorWeight * (1 / (i + 1));
    const existing = scores.get(r.id);
    if (existing) {
      scores.set(r.id, { score: existing.score + rrf, text: existing.text });
    } else {
      scores.set(r.id, { score: rrf, text: r.text });
    }
  }
  return [...scores.entries()]
    .map(([id, data]) => ({ id, score: data.score, text: data.text }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
