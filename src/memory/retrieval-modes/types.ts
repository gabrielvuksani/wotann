/**
 * Shared types for the P1-M6 retrieval-mode registry.
 *
 * Each mode is a single narrow retriever with the uniform signature
 *   (ctx, query, opts) => Promise<RetrievalModeResult>
 *
 * Modes are intentionally narrow — they cover ONE axis (graph hops,
 * time windows, typed entities, etc.). Breadth comes from the
 * registry, not from any single mode. Hybrid fusion across several
 * modes is the job of the existing P1-M4 TEMPR / hybrid-retrieval
 * orchestrators.
 *
 * Quality-bar #6 (honest-fail): every mode's result carries a
 * `scoring.isHeuristic` flag so callers can see when a mode is
 * falling back to a heuristic stand-in (e.g. semantic-cluster when
 * embeddings aren't available yet). The mode NEVER silently pretends
 * its output is something it isn't.
 */
import type { MemoryStore, MemorySearchResult } from "../store.js";
import type { SearchableEntry } from "../extended-search-types.js";
import type { CompressionSummary } from "../omega-layers.js";

/**
 * Context shared by every retrieval mode. `store` is always populated
 * when dispatching via store.searchWithMode; the other fields are
 * optional injection points so modes can run in pure unit tests
 * without a live SQLite.
 */
export interface RetrievalContext {
  readonly store?: MemoryStore;
  /** Injected entry pool. When absent, modes fall back to store FTS. */
  readonly entries?: readonly SearchableEntry[];
  /** Injected graph edges for graph-traversal / path-based modes. */
  readonly edges?: readonly RetrievalEdge[];
  /** Injected summary list for summary-first mode. */
  readonly summaries?: readonly CompressionSummary[];
  /** Deterministic "now" (ISO-8601). Defaults to new Date().toISOString(). */
  readonly now?: string;
}

/**
 * A graph edge between two ids. Matches the shape of
 * knowledge_edges but is generic enough to drive the graph modes
 * from an in-memory entry+edge pair in tests.
 */
export interface RetrievalEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly relation?: string;
  readonly weight?: number;
}

/**
 * A single hit returned by a mode. Matches the shape of
 * MemorySearchResult loosely: id + content + score + optional
 * provenance. `metadata` is free-form and mode-specific (hop count,
 * cluster id, etc.).
 */
export interface RetrievalHit {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ScoringInfo {
  /** Short label: "bfs-hop-decay", "levenshtein", "kmeans-tokens", etc. */
  readonly method: string;
  /** Mode is using a heuristic fallback rather than the ideal signal. */
  readonly isHeuristic?: boolean;
  /** Free-form note; usually why a heuristic was used. */
  readonly notes?: string;
  /** Per-signal weight breakdown when applicable. */
  readonly weights?: Readonly<Record<string, number>>;
}

export interface RetrievalModeResult {
  readonly mode: string;
  readonly results: readonly RetrievalHit[];
  readonly scoring: ScoringInfo;
}

/**
 * Options passed to every mode. Most modes only care about `limit`;
 * mode-specific options live in the nested bag keyed by mode name.
 */
export interface RetrievalModeOptions {
  readonly limit?: number;
  /** Per-mode opaque options bag. */
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface RetrievalMode {
  readonly name: string;
  readonly description: string;
  readonly search: (
    ctx: RetrievalContext,
    query: string,
    opts?: RetrievalModeOptions,
  ) => Promise<RetrievalModeResult>;
}

/**
 * Helper: drain store FTS down to a flat list of SearchableEntry. Used
 * by modes that need to post-filter or re-rank the FTS candidate set
 * (fuzzy-match, time-decay, authority-weight, typed-entity, etc.).
 */
export function ftsToSearchable(
  results: readonly MemorySearchResult[],
): readonly SearchableEntry[] {
  return results.map((r) => ({
    id: r.entry.id,
    content: r.entry.value,
    metadata: {
      key: r.entry.key,
      layer: r.entry.layer,
      blockType: r.entry.blockType,
      domain: r.entry.domain ?? null,
      topic: r.entry.topic ?? null,
      verified: r.entry.verified,
      confidence: r.entry.confidence ?? null,
      confidenceLevel: r.entry.confidenceLevel,
      sessionId: r.entry.sessionId ?? null,
    },
    timestamp: Date.parse(r.entry.updatedAt) || undefined,
  }));
}
