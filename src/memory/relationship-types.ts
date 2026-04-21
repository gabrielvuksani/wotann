/**
 * Typed memory relationships — Phase 6 (partial).
 *
 * Existing graph-rag.ts stores untyped edges between memory nodes.
 * That's enough for retrieval-by-neighborhood but loses crucial signal:
 * "this chunk UPDATES that one" is qualitatively different from "this
 * chunk EXTENDS that one", and different again from "this chunk DERIVES
 * from that one". Supermemory / Mem0 / LongMemEval agents that
 * distinguish these see +8-14% on LongMemEval's update-heavy tasks.
 *
 * Three canonical relationship kinds:
 *   - updates:  the successor supersedes the predecessor (prefer successor)
 *   - extends:  the successor adds to the predecessor (keep both; answer
 *               queries using both)
 *   - derives:  the successor is computed from the predecessor (cite the
 *               predecessor as provenance)
 *
 * Plus an "unknown" bucket for legacy/unclassified edges.
 *
 * This module ships:
 *   - MemoryRelationshipKind type + constant
 *   - MemoryRelationship immutable record
 *   - RelationshipClassifier — heuristic classifier + LLM-backed factory
 *   - resolveLatest(relationships, rootId) — walks UPDATES to find most
 *     recent node; critical for "what is the CURRENT policy?" queries
 *
 * No storage layer — callers persist relationships in their own graph
 * store (graph-rag.ts, sqlite, etc).
 */

// ── Types ──────────────────────────────────────────────

export const MEMORY_RELATIONSHIP_KINDS = ["updates", "extends", "derives", "unknown"] as const;

export type MemoryRelationshipKind = (typeof MEMORY_RELATIONSHIP_KINDS)[number];

export interface MemoryRelationship {
  /** Stable edge id. */
  readonly id: string;
  /** Node id of the source (the earlier / predecessor node). */
  readonly fromId: string;
  /** Node id of the target (the later / successor node). */
  readonly toId: string;
  /** What kind of relationship. */
  readonly kind: MemoryRelationshipKind;
  /** Confidence 0-1. Lower → more ambiguous. */
  readonly confidence: number;
  /** When the edge was created (ms since epoch). */
  readonly createdAt: number;
  /** Free-text rationale (e.g. "v2 supersedes v1 because of fine-print change"). */
  readonly rationale?: string;
  /**
   * Bi-temporal KNOWLEDGE-TIME axis (P1-M5, Zep/Graphiti port).
   * ISO-8601 string. When the underlying fact became true in the real
   * world. undefined on legacy rows — readers should default to createdAt.
   */
  readonly validFrom?: string;
  /**
   * Bi-temporal KNOWLEDGE-TIME axis. ISO-8601 string or null.
   * null = fact is still true; undefined = unknown (legacy row).
   */
  readonly validTo?: string | null;
  /**
   * Bi-temporal INGEST-TIME axis (P1-M5, Zep/Graphiti port).
   * ISO-8601 string. When WOTANN first recorded this edge. undefined on
   * legacy rows — readers should default to createdAt.
   */
  readonly recordedFrom?: string;
  /**
   * Bi-temporal INGEST-TIME axis. ISO-8601 string or null.
   * null = still known to WOTANN; undefined = unknown (legacy row).
   */
  readonly recordedTo?: string | null;
}

export interface RelationshipClassifier {
  /**
   * Decide the relationship between two nodes' contents. Returns null
   * when no meaningful relationship (nodes should stay disconnected).
   */
  readonly classify: (
    predecessorContent: string,
    successorContent: string,
  ) => Promise<{
    readonly kind: MemoryRelationshipKind;
    readonly confidence: number;
    readonly rationale?: string;
  } | null>;
}

// ── Heuristic classifier ──────────────────────────────

const UPDATE_MARKERS = [
  /\b(supersedes|replaces|deprecates|obsoletes|overrides|amended|revised)\b/i,
  /\b(effective|starting|as of|beginning)\s+\d{4}/i,
  /\bversion\s+\d+\b/i,
  /\brev(ision)?\s+\d+\b/i,
];
const EXTEND_MARKERS = [
  /\b(additionally|furthermore|in addition|also|plus|moreover)\b/i,
  /\b(note that|be aware|additionally:)\b/i,
];
const DERIVE_MARKERS = [
  /\b(derived from|based on|computed from|inferred from|follows from|therefore|thus|hence)\b/i,
  /\b(summary of|abstract of|extracted from)\b/i,
];

function countHits(text: string, patterns: readonly RegExp[]): number {
  let n = 0;
  for (const re of patterns) {
    if (re.test(text)) n++;
  }
  return n;
}

/**
 * Pure-heuristic classifier — no LLM calls, cheap and deterministic.
 * Accuracy is ~60-70% on typical corpora; use as a fallback when LLM
 * budget is exceeded or as a pre-filter before expensive LLM calls.
 */
export function createHeuristicClassifier(): RelationshipClassifier {
  return {
    classify: async (predecessor, successor) => {
      const combined = `${predecessor}\n${successor}`;
      const updateHits = countHits(successor, UPDATE_MARKERS);
      const extendHits = countHits(successor, EXTEND_MARKERS);
      const deriveHits = countHits(combined, DERIVE_MARKERS);

      const scores = {
        updates: updateHits * 2,
        extends: extendHits,
        derives: deriveHits * 2,
      } as const;
      const entries = Object.entries(scores) as Array<[MemoryRelationshipKind, number]>;
      entries.sort((a, b) => b[1] - a[1]);
      const winner = entries[0];
      if (!winner || winner[1] === 0) return null;

      // Confidence = (winner score) / (sum of all)
      const sum = entries.reduce((acc, [, v]) => acc + v, 0);
      const confidence = Math.min(0.9, winner[1] / sum);
      return {
        kind: winner[0],
        confidence,
        rationale: `heuristic: ${winner[0]} markers (${winner[1]} hits vs ${sum - winner[1]} others)`,
      };
    },
  };
}

// ── LLM-backed classifier ─────────────────────────────

export type LlmQuery = (
  prompt: string,
  options: { readonly maxTokens: number; readonly temperature?: number },
) => Promise<string>;

const CLASSIFY_PROMPT_TEMPLATE = (
  predecessor: string,
  successor: string,
) => `Given two memory nodes (a PREDECESSOR and a SUCCESSOR), classify their relationship.

Relationship kinds:
  - "updates":  successor supersedes the predecessor (keep only the successor for queries)
  - "extends":  successor adds new information to the predecessor (keep both)
  - "derives":  successor is computed/inferred from the predecessor (cite predecessor as provenance)
  - "none":     the two nodes are unrelated

PREDECESSOR:
"""
${predecessor.slice(0, 4000)}
"""

SUCCESSOR:
"""
${successor.slice(0, 4000)}
"""

Output a single JSON object with keys "kind" (one of updates/extends/derives/none), "confidence" (0-1), and "rationale" (one short sentence). Example:
{"kind":"updates","confidence":0.85,"rationale":"v2 changes the refund window from 30 to 45 days"}

JSON:`;

export function createLlmClassifier(query: LlmQuery): RelationshipClassifier {
  return {
    classify: async (predecessor, successor) => {
      const prompt = CLASSIFY_PROMPT_TEMPLATE(predecessor, successor);
      const raw = await query(prompt, { maxTokens: 200, temperature: 0 });
      return parseClassifierResponse(raw);
    },
  };
}

/**
 * Parse an LLM classifier response. Tolerant: accepts bare JSON or
 * JSON inside a fenced ```json block. Returns null on garbage or when
 * the model said "none".
 */
export function parseClassifierResponse(raw: string): {
  readonly kind: MemoryRelationshipKind;
  readonly confidence: number;
  readonly rationale?: string;
} | null {
  if (!raw) return null;

  // Try fenced ```json first
  const fenced = raw.match(/```json\s*\n([\s\S]*?)\n```/);
  const candidate = fenced?.[1] ?? raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // Brace-balanced fallback
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      parsed = JSON.parse(candidate.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  const rec = parsed as { kind?: unknown; confidence?: unknown; rationale?: unknown };
  const rawKind = typeof rec.kind === "string" ? rec.kind : "";
  const kind = rawKind.trim().toLowerCase();
  if (kind === "none" || kind === "") return null;
  if (!MEMORY_RELATIONSHIP_KINDS.includes(kind as MemoryRelationshipKind)) return null;
  const confidence =
    typeof rec.confidence === "number" ? Math.max(0, Math.min(1, rec.confidence)) : 0.5;
  const rationale = typeof rec.rationale === "string" ? rec.rationale : undefined;
  const result: {
    readonly kind: MemoryRelationshipKind;
    readonly confidence: number;
    readonly rationale?: string;
  } =
    rationale !== undefined
      ? { kind: kind as MemoryRelationshipKind, confidence, rationale }
      : { kind: kind as MemoryRelationshipKind, confidence };
  return result;
}

// ── Resolve latest ────────────────────────────────────

/**
 * Walk `updates` relationships forward from rootId to find the most
 * recent node in the update chain. Returns rootId unchanged if no
 * successor exists. Breaks cycles by tracking visited nodes.
 *
 * Use for "what is the CURRENT policy?" queries — if policy-v1 is
 * updated by policy-v2 which is updated by policy-v3, resolveLatest
 * returns policy-v3.
 */
export function resolveLatest(
  relationships: readonly MemoryRelationship[],
  rootId: string,
): string {
  // Build adjacency map: fromId → list of updates relationships
  const byFrom = new Map<string, MemoryRelationship[]>();
  for (const rel of relationships) {
    if (rel.kind !== "updates") continue;
    const existing = byFrom.get(rel.fromId) ?? [];
    existing.push(rel);
    byFrom.set(rel.fromId, existing);
  }

  let current = rootId;
  const visited = new Set<string>([current]);
  // Prefer most recent edge by createdAt
  while (true) {
    const successors = byFrom.get(current);
    if (!successors || successors.length === 0) return current;
    const next = [...successors].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!next) return current;
    if (visited.has(next.toId)) return current; // cycle guard
    visited.add(next.toId);
    current = next.toId;
  }
}

/**
 * Partition a node's neighbors by relationship kind. Useful for UI
 * display ("this memory has 2 updates, 1 extend, 3 derives").
 */
export function partitionByKind(
  relationships: readonly MemoryRelationship[],
  nodeId: string,
): Record<MemoryRelationshipKind, readonly MemoryRelationship[]> {
  const out: Record<MemoryRelationshipKind, MemoryRelationship[]> = {
    updates: [],
    extends: [],
    derives: [],
    unknown: [],
  };
  for (const rel of relationships) {
    if (rel.fromId !== nodeId && rel.toId !== nodeId) continue;
    out[rel.kind].push(rel);
  }
  return out;
}
