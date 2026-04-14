/**
 * Semantic Memory Search — TF-IDF with cosine similarity.
 *
 * ZERO DEPENDENCIES: Pure TypeScript implementation of TF-IDF vectorization
 * and cosine similarity. No numpy, no ML libraries, no API calls.
 *
 * WHY: FTS5 keyword search misses conceptual matches. "authentication" won't
 * match a memory about "login flow" or "OAuth tokens". Semantic search finds
 * related concepts by comparing the statistical signature of documents.
 *
 * HOW:
 * 1. Tokenize documents into terms (with stemming approximation)
 * 2. Build TF-IDF vectors (term frequency × inverse document frequency)
 * 3. Compare query vector against document vectors via cosine similarity
 * 4. Return top-K results ranked by similarity score
 *
 * HYBRID: Best results combine FTS5 (exact match) + semantic (conceptual match).
 * The `hybridSearch` function merges both result sets with configurable weighting.
 */

// ── Tokenization ─────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "because", "but", "and",
  "or", "if", "while", "that", "this", "these", "those", "it", "its",
]);

/**
 * Tokenize text into normalized terms with simple stemming.
 */
export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .map(simpleStem);
}

/**
 * Very simple suffix-stripping stemmer.
 * Not as good as Porter, but zero dependencies and handles common cases.
 */
function simpleStem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith("ing")) return word.slice(0, -3) || word;
  if (word.endsWith("tion")) return word.slice(0, -4) || word;
  if (word.endsWith("ment")) return word.slice(0, -4) || word;
  if (word.endsWith("ness")) return word.slice(0, -4) || word;
  if (word.endsWith("able")) return word.slice(0, -4) || word;
  if (word.endsWith("ible")) return word.slice(0, -4) || word;
  if (word.endsWith("ful")) return word.slice(0, -3) || word;
  if (word.endsWith("less")) return word.slice(0, -4) || word;
  if (word.endsWith("ous")) return word.slice(0, -3) || word;
  if (word.endsWith("ive")) return word.slice(0, -3) || word;
  if (word.endsWith("ly")) return word.slice(0, -2) || word;
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("er") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 4) return word.slice(0, -1);
  return word;
}

// ── TF-IDF Engine ────────────────────────────────────────

export interface TFIDFDocument {
  readonly id: string;
  readonly text: string;
  readonly terms: readonly string[];
  readonly termFreq: ReadonlyMap<string, number>;
}

export interface SemanticSearchResult {
  readonly id: string;
  readonly score: number;
  readonly text: string;
}

export class TFIDFIndex {
  private documents: TFIDFDocument[] = [];
  private idf: Map<string, number> = new Map();
  private dirty = true;

  /**
   * Add a document to the index.
   */
  addDocument(id: string, text: string): void {
    const terms = tokenize(text);
    const termFreq = new Map<string, number>();
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    }

    // Normalize TF by document length
    const maxFreq = Math.max(...termFreq.values(), 1);
    const normalizedTF = new Map<string, number>();
    for (const [term, freq] of termFreq) {
      normalizedTF.set(term, freq / maxFreq);
    }

    this.documents.push({ id, text, terms, termFreq: normalizedTF });
    this.dirty = true;
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id: string): void {
    this.documents = this.documents.filter((d) => d.id !== id);
    this.dirty = true;
  }

  /**
   * Rebuild the IDF (inverse document frequency) table.
   * Called automatically before search if the index is dirty.
   */
  private rebuildIDF(): void {
    if (!this.dirty) return;

    const docCount = this.documents.length;
    if (docCount === 0) {
      this.idf.clear();
      this.dirty = false;
      return;
    }

    // Count how many documents contain each term
    const termDocCount = new Map<string, number>();
    for (const doc of this.documents) {
      const uniqueTerms = new Set(doc.terms);
      for (const term of uniqueTerms) {
        termDocCount.set(term, (termDocCount.get(term) ?? 0) + 1);
      }
    }

    // IDF = log(N / df) where N = total docs, df = docs containing term
    this.idf.clear();
    for (const [term, df] of termDocCount) {
      this.idf.set(term, Math.log(docCount / df));
    }

    this.dirty = false;
  }

  /**
   * Compute TF-IDF vector for a set of terms.
   */
  private computeVector(termFreq: ReadonlyMap<string, number>): Map<string, number> {
    const vector = new Map<string, number>();
    for (const [term, tf] of termFreq) {
      const idf = this.idf.get(term) ?? 0;
      if (idf > 0) {
        vector.set(term, tf * idf);
      }
    }
    return vector;
  }

  /**
   * Search for documents similar to the query.
   * Returns results ranked by cosine similarity.
   */
  search(query: string, topK: number = 10): readonly SemanticSearchResult[] {
    this.rebuildIDF();

    if (this.documents.length === 0) return [];

    // Build query vector
    const queryTerms = tokenize(query);
    const queryTF = new Map<string, number>();
    for (const term of queryTerms) {
      queryTF.set(term, (queryTF.get(term) ?? 0) + 1);
    }
    const maxQF = Math.max(...queryTF.values(), 1);
    for (const [term, freq] of queryTF) {
      queryTF.set(term, freq / maxQF);
    }
    const queryVector = this.computeVector(queryTF);

    if (queryVector.size === 0) return [];

    // Score each document
    const scores: { id: string; score: number; text: string }[] = [];

    for (const doc of this.documents) {
      const docVector = this.computeVector(doc.termFreq);
      const similarity = cosineSimilarity(queryVector, docVector);
      if (similarity > 0.01) {
        scores.push({ id: doc.id, score: similarity, text: doc.text });
      }
    }

    // Sort by score descending, take top K
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  /**
   * Get the number of documents in the index.
   */
  size(): number {
    return this.documents.length;
  }

  /**
   * Get the vocabulary size (unique terms across all documents).
   */
  vocabularySize(): number {
    this.rebuildIDF();
    return this.idf.size;
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.documents = [];
    this.idf.clear();
    this.dirty = false;
  }
}

// ── Cosine Similarity ────────────────────────────────────

function cosineSimilarity(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, valA] of a) {
    normA += valA * valA;
    const valB = b.get(term);
    if (valB !== undefined) {
      dotProduct += valA * valB;
    }
  }

  for (const valB of b.values()) {
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ── Hybrid Search ────────────────────────────────────────

export interface HybridResult {
  readonly id: string;
  readonly score: number;
  readonly text: string;
  readonly matchType: "keyword" | "semantic" | "both";
}

/**
 * Merge keyword (FTS5) and semantic (TF-IDF) search results.
 * Uses reciprocal rank fusion for balanced ranking.
 *
 * @param keywordResults - Results from FTS5 search (already ranked)
 * @param semanticResults - Results from TF-IDF cosine similarity
 * @param keywordWeight - Weight for keyword results (0-1, default 0.5)
 */
export function mergeHybridResults(
  keywordResults: readonly { id: string; score: number; text: string }[],
  semanticResults: readonly SemanticSearchResult[],
  keywordWeight: number = 0.5,
): readonly HybridResult[] {
  const semanticWeight = 1 - keywordWeight;
  const scores = new Map<string, { score: number; text: string; types: Set<string> }>();

  // Reciprocal rank fusion from keyword results
  for (let i = 0; i < keywordResults.length; i++) {
    const r = keywordResults[i]!;
    const rrf = keywordWeight * (1 / (i + 1));
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += rrf;
      existing.types.add("keyword");
    } else {
      scores.set(r.id, { score: rrf, text: r.text, types: new Set(["keyword"]) });
    }
  }

  // Reciprocal rank fusion from semantic results
  for (let i = 0; i < semanticResults.length; i++) {
    const r = semanticResults[i]!;
    const rrf = semanticWeight * (1 / (i + 1));
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += rrf;
      existing.types.add("semantic");
    } else {
      scores.set(r.id, { score: rrf, text: r.text, types: new Set(["semantic"]) });
    }
  }

  // Convert to sorted array
  return [...scores.entries()]
    .map(([id, data]) => ({
      id,
      score: data.score,
      text: data.text,
      matchType: data.types.size === 2 ? "both" as const
        : data.types.has("keyword") ? "keyword" as const
        : "semantic" as const,
    }))
    .sort((a, b) => b.score - a.score);
}
