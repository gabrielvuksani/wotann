/**
 * Vector Store with Hybrid Memory Search.
 *
 * ZERO DEPENDENCIES: Pure TypeScript vector store using TF-IDF weighted
 * bag-of-words embeddings, cosine similarity, and Reciprocal Rank Fusion.
 *
 * WHY: The existing TFIDFIndex (semantic-search.ts) re-computes vectors on
 * every search. The VectorStore pre-computes and persists embeddings, making
 * search O(n) dot products instead of O(n*m) term lookups. HybridMemorySearch
 * unifies FTS5 keyword, vector similarity, temporal recency, and access
 * frequency into a single ranked result set.
 *
 * ARCHITECTURE:
 *   VectorStore — in-memory embedding index with optional SQLite persistence
 *   HybridMemorySearch — RRF fusion wrapper over FTS5 + VectorStore
 */

import { tokenize } from "./semantic-search.js";

// ── Types ───────────────────────────────────────────────

export interface VectorDocument {
  readonly id: string;
  readonly content: string;
  readonly embedding: Float64Array;
  readonly termFreqs: ReadonlyMap<string, number>;
  readonly addedAt: number; // epoch ms
  readonly accessCount: number;
}

export interface VectorSearchResult {
  readonly id: string;
  readonly score: number;
}

export interface HybridSearchResult {
  readonly id: string;
  readonly score: number;
  readonly method: string;
}

export interface FTS5QueryFn {
  (query: string): readonly VectorSearchResult[];
}

export interface TemporalSignalFn {
  (ids: readonly string[]): ReadonlyMap<string, number>;
}

export interface FrequencySignalFn {
  (ids: readonly string[]): ReadonlyMap<string, number>;
}

// ── IDF Table ───────────────────────────────────────────

/**
 * Shared IDF state used by VectorStore to weight term vectors.
 * Separated from the store so it can be rebuilt without copying documents.
 */
class IDFTable {
  private table: Map<string, number> = new Map();
  private docCount = 0;

  rebuild(documents: ReadonlyMap<string, VectorDocument>): void {
    const termDocCount = new Map<string, number>();
    this.docCount = documents.size;

    for (const doc of documents.values()) {
      const seen = new Set<string>();
      for (const term of doc.termFreqs.keys()) {
        if (!seen.has(term)) {
          termDocCount.set(term, (termDocCount.get(term) ?? 0) + 1);
          seen.add(term);
        }
      }
    }

    this.table = new Map<string, number>();
    for (const [term, df] of termDocCount) {
      // Smooth IDF: log((N + 1) / (df + 1)) + 1 to avoid zero weights
      this.table.set(term, Math.log((this.docCount + 1) / (df + 1)) + 1);
    }
  }

  get(term: string): number {
    return this.table.get(term) ?? 0;
  }

  size(): number {
    return this.table.size;
  }
}

// ── Vector Math ─────────────────────────────────────────

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function l2Normalize(vec: Float64Array): Float64Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i] ?? 0;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;

  const result = new Float64Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    result[i] = (vec[i] ?? 0) / norm;
  }
  return result;
}

// ── VectorStore ─────────────────────────────────────────

const DEFAULT_DIMENSIONS = 512;
const MIN_SIMILARITY_THRESHOLD = 0.001;

export class VectorStore {
  private readonly documents: Map<string, VectorDocument> = new Map();
  private readonly idf: IDFTable = new IDFTable();
  private readonly dimensions: number;
  private dirty = false;

  constructor(dimensions: number = DEFAULT_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  /**
   * Add a document to the vector store.
   * Computes TF-IDF weighted embedding and stores it in memory.
   */
  addDocument(id: string, content: string): void {
    const terms = tokenize(content);
    if (terms.length === 0) {
      // Store with zero vector so count/remove still work
      this.documents.set(id, {
        id,
        content,
        embedding: new Float64Array(this.dimensions),
        termFreqs: new Map<string, number>(),
        addedAt: Date.now(),
        accessCount: 0,
      });
      this.dirty = true;
      return;
    }

    // Compute raw term frequencies
    const termFreqs = new Map<string, number>();
    for (const term of terms) {
      termFreqs.set(term, (termFreqs.get(term) ?? 0) + 1);
    }

    // Normalize TF by max frequency (augmented term frequency)
    const maxFreq = Math.max(...termFreqs.values(), 1);
    const normalizedTF = new Map<string, number>();
    for (const [term, freq] of termFreqs) {
      normalizedTF.set(term, 0.5 + 0.5 * (freq / maxFreq));
    }

    this.documents.set(id, {
      id,
      content,
      embedding: new Float64Array(this.dimensions), // placeholder, rebuilt on search
      termFreqs: normalizedTF,
      addedAt: Date.now(),
      accessCount: 0,
    });
    this.dirty = true;
  }

  /**
   * Search for documents similar to the query.
   * Returns top-k results ranked by cosine similarity.
   */
  search(query: string, topK: number = 10): readonly VectorSearchResult[] {
    if (this.documents.size === 0) return [];

    this.rebuildIfDirty();

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const queryVec = this.buildQueryVector(queryTerms);
    const queryNorm = l2Normalize(queryVec);

    const scored: VectorSearchResult[] = [];
    for (const doc of this.documents.values()) {
      const similarity = cosineSimilarity(queryNorm, doc.embedding);
      if (similarity > MIN_SIMILARITY_THRESHOLD) {
        scored.push({ id: doc.id, score: similarity });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Remove a document from the store.
   */
  removeDocument(id: string): boolean {
    const existed = this.documents.delete(id);
    if (existed) {
      this.dirty = true;
    }
    return existed;
  }

  /**
   * Number of documents in the store.
   */
  count(): number {
    return this.documents.size;
  }

  /**
   * Clear all documents.
   */
  clear(): void {
    this.documents.clear();
    this.dirty = false;
  }

  /**
   * Get a document by ID (for testing and HybridMemorySearch).
   */
  getDocument(id: string): VectorDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Get all document IDs.
   */
  getDocumentIds(): readonly string[] {
    return [...this.documents.keys()];
  }

  /**
   * Export documents for persistence.
   * Returns a serializable snapshot of all documents.
   */
  exportDocuments(): readonly {
    id: string;
    content: string;
    addedAt: number;
    accessCount: number;
  }[] {
    return [...this.documents.values()].map((doc) => ({
      id: doc.id,
      content: doc.content,
      addedAt: doc.addedAt,
      accessCount: doc.accessCount,
    }));
  }

  /**
   * Import documents from a persistence snapshot.
   * Rebuilds all embeddings from content.
   */
  importDocuments(
    docs: readonly { id: string; content: string; addedAt?: number; accessCount?: number }[],
  ): void {
    for (const doc of docs) {
      const terms = tokenize(doc.content);
      const termFreqs = new Map<string, number>();
      for (const term of terms) {
        termFreqs.set(term, (termFreqs.get(term) ?? 0) + 1);
      }

      const maxFreq = Math.max(...termFreqs.values(), 1);
      const normalizedTF = new Map<string, number>();
      for (const [term, freq] of termFreqs) {
        normalizedTF.set(term, 0.5 + 0.5 * (freq / maxFreq));
      }

      this.documents.set(doc.id, {
        id: doc.id,
        content: doc.content,
        embedding: new Float64Array(this.dimensions),
        termFreqs: normalizedTF,
        addedAt: doc.addedAt ?? Date.now(),
        accessCount: doc.accessCount ?? 0,
      });
    }
    this.dirty = true;
  }

  // ── Private ───────────────────────────────────────────

  private rebuildIfDirty(): void {
    if (!this.dirty) return;

    this.idf.rebuild(this.documents);

    // Rebuild all document embeddings with fresh IDF weights
    for (const [id, doc] of this.documents) {
      const embedding = this.buildEmbedding(doc.termFreqs);
      const normalized = l2Normalize(embedding);
      // Create updated document (immutable pattern)
      this.documents.set(id, {
        ...doc,
        embedding: normalized,
      });
    }

    this.dirty = false;
  }

  private buildEmbedding(termFreqs: ReadonlyMap<string, number>): Float64Array {
    const vec = new Float64Array(this.dimensions);

    for (const [term, tf] of termFreqs) {
      const idfWeight = this.idf.get(term);
      if (idfWeight <= 0) continue;

      const tfidf = tf * idfWeight;
      // Hash term to a dimension index (deterministic mapping)
      const idx = this.hashToDimension(term);
      vec[idx] = (vec[idx] ?? 0) + tfidf;
    }

    return vec;
  }

  private buildQueryVector(terms: readonly string[]): Float64Array {
    // Build term frequency for the query
    const termFreqs = new Map<string, number>();
    for (const term of terms) {
      termFreqs.set(term, (termFreqs.get(term) ?? 0) + 1);
    }

    const maxFreq = Math.max(...termFreqs.values(), 1);
    const normalizedTF = new Map<string, number>();
    for (const [term, freq] of termFreqs) {
      normalizedTF.set(term, 0.5 + 0.5 * (freq / maxFreq));
    }

    return this.buildEmbedding(normalizedTF);
  }

  /**
   * Hash a term string to a dimension index.
   * Uses DJB2 hash for good distribution across the vector space.
   */
  private hashToDimension(term: string): number {
    let hash = 5381;
    for (let i = 0; i < term.length; i++) {
      hash = ((hash << 5) + hash + term.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % this.dimensions;
  }
}

// ── HybridMemorySearch ──────────────────────────────────

/**
 * RRF configuration weights for each signal source.
 * Must sum to 1.0 for normalized scoring.
 */
export interface RRFWeights {
  readonly fts5: number;
  readonly vector: number;
  readonly temporal: number;
  readonly frequency: number;
}

const DEFAULT_RRF_WEIGHTS: RRFWeights = {
  fts5: 0.4,
  vector: 0.3,
  temporal: 0.2,
  frequency: 0.1,
};

const RRF_K = 60; // Standard RRF constant from Cormack et al.

export class HybridMemorySearch {
  private readonly vectorStore: VectorStore;
  private readonly fts5Query: FTS5QueryFn;
  private readonly temporalSignal: TemporalSignalFn | null;
  private readonly frequencySignal: FrequencySignalFn | null;
  private readonly weights: RRFWeights;

  constructor(
    vectorStore: VectorStore,
    fts5Query: FTS5QueryFn,
    options?: {
      readonly temporalSignal?: TemporalSignalFn;
      readonly frequencySignal?: FrequencySignalFn;
      readonly weights?: Partial<RRFWeights>;
    },
  ) {
    this.vectorStore = vectorStore;
    this.fts5Query = fts5Query;
    this.temporalSignal = options?.temporalSignal ?? null;
    this.frequencySignal = options?.frequencySignal ?? null;
    this.weights = { ...DEFAULT_RRF_WEIGHTS, ...options?.weights };
  }

  /**
   * Hybrid search combining up to 4 signals via Reciprocal Rank Fusion.
   *
   * Signals:
   * 1. FTS5 BM25 keyword search
   * 2. Vector cosine similarity
   * 3. Temporal recency (optional)
   * 4. Access frequency (optional)
   */
  search(query: string, topK: number = 10): readonly HybridSearchResult[] {
    const expandedK = topK * 3; // Fetch extra candidates for fusion

    // Signal 1: FTS5 BM25 keyword search
    const fts5Results = this.fts5Query(query);
    const fts5Ranks = buildRankMap(fts5Results.slice(0, expandedK));

    // Signal 2: Vector cosine similarity
    const vectorResults = this.vectorStore.search(query, expandedK);
    const vectorRanks = buildRankMap(vectorResults);

    // Collect all candidate IDs
    const allIds = new Set<string>([
      ...fts5Ranks.keys(),
      ...vectorRanks.keys(),
    ]);

    // Signal 3: Temporal recency (optional)
    let temporalRanks = new Map<string, number>();
    if (this.temporalSignal !== null) {
      const idList = [...allIds];
      const rawScores = this.temporalSignal(idList);
      // Convert scores to ranks (higher score = rank 1)
      const sorted = [...rawScores.entries()].sort((a, b) => b[1] - a[1]);
      temporalRanks = new Map(sorted.map(([id], i) => [id, i + 1]));
      // Add any IDs that appeared only in temporal results
      for (const id of temporalRanks.keys()) {
        allIds.add(id);
      }
    }

    // Signal 4: Access frequency (optional)
    let frequencyRanks = new Map<string, number>();
    if (this.frequencySignal !== null) {
      const idList = [...allIds];
      const rawScores = this.frequencySignal(idList);
      const sorted = [...rawScores.entries()].sort((a, b) => b[1] - a[1]);
      frequencyRanks = new Map(sorted.map(([id], i) => [id, i + 1]));
      for (const id of frequencyRanks.keys()) {
        allIds.add(id);
      }
    }

    // Compute RRF scores
    const scored: HybridSearchResult[] = [];

    for (const id of allIds) {
      const ftsRank = fts5Ranks.get(id);
      const vecRank = vectorRanks.get(id);
      const tempRank = temporalRanks.get(id);
      const freqRank = frequencyRanks.get(id);

      const score =
        (ftsRank !== undefined ? this.weights.fts5 / (RRF_K + ftsRank) : 0) +
        (vecRank !== undefined ? this.weights.vector / (RRF_K + vecRank) : 0) +
        (tempRank !== undefined ? this.weights.temporal / (RRF_K + tempRank) : 0) +
        (freqRank !== undefined ? this.weights.frequency / (RRF_K + freqRank) : 0);

      // Determine which method contributed most
      const method = determineMethod(ftsRank, vecRank);

      scored.push({ id, score, method });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Build a rank map from an ordered result list.
 * Rank 1 = first/best result.
 */
function buildRankMap(
  results: readonly { readonly id: string }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r !== undefined) {
      map.set(r.id, i + 1);
    }
  }
  return map;
}

/**
 * Determine the primary match method for labeling.
 */
function determineMethod(
  ftsRank: number | undefined,
  vecRank: number | undefined,
): string {
  const hasFts = ftsRank !== undefined;
  const hasVec = vecRank !== undefined;

  if (hasFts && hasVec) return "hybrid";
  if (hasFts) return "keyword";
  if (hasVec) return "vector";
  return "signal";
}
