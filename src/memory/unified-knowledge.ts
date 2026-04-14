/**
 * Unified Knowledge Fabric — single query API across all memory/retrieval systems.
 * Merges: MemoryStore + ContextTree + Graph-RAG + Semantic Search + Vector Store.
 * Every query goes through: KG → semantic → vector → FTS5 with unified provenance.
 */

// ── Types ────────────────────────────────────────────────

export interface KnowledgeQuery {
  readonly query: string;
  readonly maxResults: number;
  readonly minConfidence: number;
  readonly sources: readonly KnowledgeSource[];
}

export type KnowledgeSource = "memory" | "context-tree" | "graph-rag" | "semantic" | "vector" | "fts5";

export interface KnowledgeResult {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly source: KnowledgeSource;
  readonly provenance: ResultProvenance;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ResultProvenance {
  readonly retrievedAt: number;
  readonly retrievalMethod: string;
  readonly trustScore: number;
  readonly freshness: number; // 0-1, where 1 is fresh
  readonly verificationStatus: "verified" | "unverified" | "stale";
}

export interface KnowledgeFabricStats {
  readonly totalEntries: number;
  readonly bySource: Readonly<Record<string, number>>;
  readonly averageTrustScore: number;
  readonly lastQueryMs: number;
}

// ── Unified Knowledge Fabric ─────────────────────────────

export class UnifiedKnowledgeFabric {
  private readonly retrievers: Map<KnowledgeSource, Retriever> = new Map();
  private lastQueryMs = 0;

  /**
   * Register a retrieval source.
   */
  registerRetriever(source: KnowledgeSource, retriever: Retriever): void {
    this.retrievers.set(source, retriever);
  }

  /**
   * Search across all registered sources with deduplication and ranking.
   */
  async search(query: KnowledgeQuery): Promise<readonly KnowledgeResult[]> {
    const startTime = Date.now();
    const allResults: KnowledgeResult[] = [];

    // Query all sources in parallel
    const sources = query.sources.length > 0
      ? query.sources
      : [...this.retrievers.keys()];

    const promises = sources.map(async (source) => {
      const retriever = this.retrievers.get(source);
      if (!retriever) return [];

      try {
        return await retriever.search(query.query, query.maxResults);
      } catch {
        return [];
      }
    });

    const results = await Promise.all(promises);
    for (const batch of results) {
      allResults.push(...batch);
    }

    // Deduplicate by content similarity
    const deduped = this.deduplicate(allResults);

    // Filter by minimum confidence
    const filtered = deduped.filter((r) => r.score >= query.minConfidence);

    // Sort by score (highest first)
    const sorted = filtered.sort((a, b) => b.score - a.score).slice(0, query.maxResults);

    this.lastQueryMs = Date.now() - startTime;
    return sorted;
  }

  /**
   * Get statistics about the knowledge fabric.
   */
  getStats(): KnowledgeFabricStats {
    const bySource: Record<string, number> = {};
    let totalEntries = 0;

    for (const [source, retriever] of this.retrievers) {
      const count = retriever.getEntryCount();
      bySource[source] = count;
      totalEntries += count;
    }

    return {
      totalEntries,
      bySource,
      averageTrustScore: 0.85, // Default until we track this
      lastQueryMs: this.lastQueryMs,
    };
  }

  /**
   * Simple content-based deduplication.
   */
  private deduplicate(results: readonly KnowledgeResult[]): KnowledgeResult[] {
    const seen = new Set<string>();
    const deduped: KnowledgeResult[] = [];

    for (const result of results) {
      // Use first 100 chars as dedup key
      const key = result.content.slice(0, 100).toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(result);
      }
    }

    return deduped;
  }
}

// ── Retriever Interface ──────────────────────────────────

export interface Retriever {
  search(query: string, limit: number): Promise<readonly KnowledgeResult[]>;
  getEntryCount(): number;
}
