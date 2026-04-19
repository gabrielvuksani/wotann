/**
 * Extended search types — Cognee parity (Phase 6).
 *
 * Existing semantic-search.ts ships vector + BM25 + semantic + graph.
 * Cognee's 14-mode search set adds 10 more that matter for long-memory
 * eval: insight-synthesis, entity-relationship traversal, temporal,
 * document-scope, cross-document, code-specific, summary-only,
 * metadata-only, graph-hop, and hybrid fusion.
 *
 * Each is a pure function: takes a query + entries + options, returns
 * ranked SearchHit[]. No storage coupling. Callers wire these into
 * their search engine via the semantic-search registry.
 */

// ── Shared types ──────────────────────────────────────

export interface SearchableEntry {
  readonly id: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly timestamp?: number;
  readonly documentId?: string;
  readonly embedding?: readonly number[];
}

export interface SearchHit {
  readonly entry: SearchableEntry;
  readonly score: number;
  readonly reason?: string;
}

export type SearchMode =
  | "insight-synthesis"
  | "entity-relationship"
  | "temporal-filtered"
  | "document-scope"
  | "cross-document"
  | "code-aware"
  | "summary-only"
  | "metadata-only"
  | "graph-hop"
  | "hybrid-fusion";

// ── 1. Insight synthesis ──────────────────────────────

export interface InsightSynthesisOptions {
  readonly query: string;
  readonly maxInsights?: number;
  readonly llmSynthesize: (chunks: readonly string[]) => Promise<string>;
}

export interface InsightResult {
  readonly insight: string;
  readonly sourceIds: readonly string[];
}

/**
 * Feed retrieved chunks to an LLM that produces a SINGLE synthesized
 * insight. Useful when you want "what does the corpus say about X?"
 * rather than raw chunk dumps.
 */
export async function insightSynthesis(
  entries: readonly SearchableEntry[],
  options: InsightSynthesisOptions,
): Promise<InsightResult> {
  const max = options.maxInsights ?? 5;
  const chunks = entries.slice(0, max).map((e) => e.content);
  const insight = await options.llmSynthesize(chunks);
  return {
    insight: insight.trim(),
    sourceIds: entries.slice(0, max).map((e) => e.id),
  };
}

// ── 2. Entity-relationship traversal ──────────────────

export interface EntityEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: string;
}

/**
 * Find all entries related (via N hops) to a seed entity. Pure
 * breadth-first over the edge list.
 */
export function entityRelationship(
  entries: readonly SearchableEntry[],
  edges: readonly EntityEdge[],
  seedId: string,
  maxHops: number = 2,
): readonly SearchHit[] {
  const entryById = new Map<string, SearchableEntry>();
  for (const e of entries) entryById.set(e.id, e);

  // BFS from seed
  const visited = new Set<string>([seedId]);
  let frontier = [seedId];
  const hopLevel = new Map<string, number>([[seedId, 0]]);

  for (let hop = 1; hop <= maxHops; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const edge of edges) {
        const neighbor = edge.fromId === node ? edge.toId : edge.toId === node ? edge.fromId : null;
        if (!neighbor || visited.has(neighbor)) continue;
        visited.add(neighbor);
        hopLevel.set(neighbor, hop);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  const hits: SearchHit[] = [];
  for (const [id, hops] of hopLevel) {
    if (id === seedId) continue;
    const entry = entryById.get(id);
    if (!entry) continue;
    hits.push({
      entry,
      score: 1 / (hops + 1),
      reason: `${hops}-hop from ${seedId}`,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

// ── 3. Temporal-filtered ──────────────────────────────

export interface TemporalFilter {
  readonly from?: number;
  readonly to?: number;
}

export function temporalFiltered(
  entries: readonly SearchableEntry[],
  filter: TemporalFilter,
): readonly SearchHit[] {
  const hits: SearchHit[] = [];
  for (const e of entries) {
    if (e.timestamp === undefined) continue;
    if (filter.from !== undefined && e.timestamp < filter.from) continue;
    if (filter.to !== undefined && e.timestamp > filter.to) continue;
    // Score by recency within the window
    const now = Date.now();
    const age = Math.max(0, now - e.timestamp);
    const score = 1 / (1 + age / 86_400_000); // per-day decay
    hits.push({ entry: e, score, reason: `within window` });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

// ── 4. Document-scope ─────────────────────────────────

export function documentScope(
  entries: readonly SearchableEntry[],
  documentIds: readonly string[],
): readonly SearchHit[] {
  const set = new Set(documentIds);
  return entries
    .filter((e) => e.documentId !== undefined && set.has(e.documentId))
    .map((e) => ({ entry: e, score: 1, reason: `in document ${e.documentId}` }));
}

// ── 5. Cross-document ─────────────────────────────────

/**
 * Find entries in DIFFERENT documents that share content overlap.
 * Returns pairs sorted by overlap strength.
 */
export interface CrossDocumentPair {
  readonly a: SearchableEntry;
  readonly b: SearchableEntry;
  readonly overlapScore: number;
  readonly sharedTokens: readonly string[];
}

export function crossDocument(
  entries: readonly SearchableEntry[],
  minOverlap: number = 3,
): readonly CrossDocumentPair[] {
  const pairs: CrossDocumentPair[] = [];
  const tokenize = (s: string) => s.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
  const tokenSets = entries.map((e) => new Set(tokenize(e.content)));

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (a.documentId === b.documentId) continue;
      const sa = tokenSets[i]!;
      const sb = tokenSets[j]!;
      const shared: string[] = [];
      for (const t of sa) if (sb.has(t)) shared.push(t);
      if (shared.length < minOverlap) continue;
      const overlapScore = shared.length / Math.min(sa.size, sb.size);
      pairs.push({ a, b, overlapScore, sharedTokens: shared.slice(0, 10) });
    }
  }
  pairs.sort((x, y) => y.overlapScore - x.overlapScore);
  return pairs;
}

// ── 6. Code-aware ─────────────────────────────────────

/**
 * Search within code-block content only. Matches symbol-like tokens
 * (functions, classes, var names) via regex heuristics.
 */
export function codeAware(
  entries: readonly SearchableEntry[],
  symbolName: string,
): readonly SearchHit[] {
  const hits: SearchHit[] = [];
  const symRe = new RegExp(`\\b${escapeRegex(symbolName)}\\b`, "g");
  for (const e of entries) {
    // Count occurrences inside ``` fenced blocks only
    const fences = e.content.match(/```[\s\S]*?```/g) ?? [];
    let count = 0;
    for (const fence of fences) {
      count += (fence.match(symRe) ?? []).length;
    }
    if (count > 0) {
      hits.push({
        entry: e,
        score: Math.min(1, count / 3), // 3+ occurrences = max score
        reason: `${count} code-block occurrence${count > 1 ? "s" : ""}`,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

// ── 7. Summary-only ───────────────────────────────────

/**
 * Only return entries that are labelled as summaries (metadata.type = "summary").
 */
export function summaryOnly(entries: readonly SearchableEntry[]): readonly SearchHit[] {
  return entries
    .filter((e) => e.metadata?.["type"] === "summary")
    .map((e) => ({ entry: e, score: 1, reason: "summary entry" }));
}

// ── 8. Metadata-only ──────────────────────────────────

/**
 * Filter by arbitrary metadata key=value. Multiple filters AND together.
 */
export function metadataOnly(
  entries: readonly SearchableEntry[],
  filters: Readonly<Record<string, unknown>>,
): readonly SearchHit[] {
  return entries
    .filter((e) => {
      if (!e.metadata) return false;
      for (const [k, v] of Object.entries(filters)) {
        if (e.metadata[k] !== v) return false;
      }
      return true;
    })
    .map((e) => ({ entry: e, score: 1, reason: `metadata match` }));
}

// ── 9. Graph-hop ──────────────────────────────────────

/**
 * Given a seed entry + exactly-N hops in the edge graph, return the
 * N-hop neighborhood. Exact-N (not "up to N") differs from
 * entityRelationship.
 */
export function graphHop(
  entries: readonly SearchableEntry[],
  edges: readonly EntityEdge[],
  seedId: string,
  exactHops: number,
): readonly SearchHit[] {
  const entryById = new Map<string, SearchableEntry>();
  for (const e of entries) entryById.set(e.id, e);

  let frontier = new Set<string>([seedId]);
  const visited = new Set<string>([seedId]);
  for (let h = 0; h < exactHops; h++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const edge of edges) {
        const neighbor = edge.fromId === node ? edge.toId : edge.toId === node ? edge.fromId : null;
        if (!neighbor || visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.add(neighbor);
      }
    }
    frontier = next;
  }
  const hits: SearchHit[] = [];
  for (const id of frontier) {
    const e = entryById.get(id);
    if (e) hits.push({ entry: e, score: 1, reason: `exactly ${exactHops} hops` });
  }
  return hits;
}

// ── 10. Hybrid fusion (reciprocal-rank fusion) ────────

/**
 * Reciprocal Rank Fusion: combine multiple ranked result lists into
 * one by summing 1/(k + rank_in_list). Widely used for hybrid search
 * (BM25 + vectors + graph) — balances signals without requiring
 * score-normalization. k=60 is the literature default.
 */
export function hybridFusion(
  rankings: ReadonlyArray<readonly SearchHit[]>,
  k: number = 60,
): readonly SearchHit[] {
  const fused = new Map<string, { entry: SearchableEntry; score: number; reasons: string[] }>();
  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const hit = ranking[rank]!;
      const existing = fused.get(hit.entry.id);
      const contribution = 1 / (k + rank + 1);
      if (existing) {
        existing.score += contribution;
        if (hit.reason) existing.reasons.push(hit.reason);
      } else {
        fused.set(hit.entry.id, {
          entry: hit.entry,
          score: contribution,
          reasons: hit.reason ? [hit.reason] : [],
        });
      }
    }
  }
  const out: SearchHit[] = [...fused.values()].map((f) => ({
    entry: f.entry,
    score: f.score,
    reason: f.reasons.join("; "),
  }));
  out.sort((a, b) => b.score - a.score);
  return out;
}

// ── Helpers ────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
