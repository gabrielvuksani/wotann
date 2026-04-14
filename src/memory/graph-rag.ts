/**
 * Graph-based RAG with knowledge graph construction and dual-level retrieval.
 * Inspired by LightRAG (32K stars) — builds an in-memory knowledge graph
 * from text, then retrieves via graph traversal + keyword search.
 *
 * ENTITY TYPES: function, class, file, concept, person, module, variable
 * RELATIONSHIP TYPES: imports, calls, extends, depends-on, related-to, contains, created-by
 *
 * Two retrieval modes:
 * 1. Graph traversal — follow edges from query entities
 * 2. Keyword search — TF-IDF style matching on entity/relationship text
 * Combined via dualLevelRetrieval() for best results.
 */

import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────

export type EntityType =
  | "function"
  | "class"
  | "file"
  | "concept"
  | "person"
  | "module"
  | "variable";

export type RelationshipType =
  | "imports"
  | "calls"
  | "extends"
  | "depends-on"
  | "related-to"
  | "contains"
  | "created-by";

export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly metadata: Readonly<Record<string, string>>;
  readonly documentId: string;
  readonly createdAt: string;
}

export interface Relationship {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: RelationshipType;
  readonly weight: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly documentId: string;
  /**
   * Unix milliseconds when this relationship became valid (MemPalace bi-temporal).
   * Legacy ISO-string values are still accepted on load for backward compatibility.
   */
  readonly validFrom?: number;
  /**
   * Unix milliseconds when this relationship became invalid. Undefined = still active.
   * Legacy ISO-string values are still accepted on load for backward compatibility.
   */
  readonly validTo?: number;
}

/**
 * Options for addRelationship (temporal validity).
 */
export interface AddRelationshipOptions {
  readonly weight?: number;
  readonly validFrom?: number;
  readonly validTo?: number;
  /** When true (default), a pre-existing relationship with the same (source, target, type)
   *  but differing metadata gets auto-closed (validTo set to now). */
  readonly closeContradicting?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface Document {
  readonly id: string;
  readonly text: string;
  readonly entities: readonly string[];
  readonly addedAt: string;
}

export interface GraphQueryResult {
  readonly entities: readonly Entity[];
  readonly relationships: readonly Relationship[];
  readonly documents: readonly Document[];
  readonly score: number;
}

export interface DualRetrievalResult {
  readonly graphResults: GraphQueryResult;
  readonly keywordResults: readonly KeywordMatch[];
  readonly combinedScore: number;
}

export interface KeywordMatch {
  readonly entityId: string;
  readonly entityName: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

// ── Regex-Based Entity Extraction ─────────────────────

interface ExtractedEntity {
  readonly name: string;
  readonly type: EntityType;
}

interface ExtractedRelationship {
  readonly source: string;
  readonly target: string;
  readonly type: RelationshipType;
}

const ENTITY_PATTERNS: readonly { pattern: RegExp; type: EntityType }[] = [
  // Function declarations: function foo(), const foo = () =>
  { pattern: /\bfunction\s+([A-Za-z_]\w*)/g, type: "function" },
  { pattern: /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/g, type: "function" },
  // Class declarations
  { pattern: /\bclass\s+([A-Z]\w*)/g, type: "class" },
  // Interface/type declarations (treated as class for graph purposes)
  { pattern: /\binterface\s+([A-Z]\w*)/g, type: "class" },
  { pattern: /\btype\s+([A-Z]\w*)\s*=/g, type: "class" },
  // File references
  { pattern: /["']\.\/([^"']+\.\w+)["']/g, type: "file" },
  { pattern: /["']\.\.\/([^"']+\.\w+)["']/g, type: "file" },
  // Module imports
  { pattern: /\bfrom\s+["']([^"']+)["']/g, type: "module" },
  { pattern: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, type: "module" },
  // Variable declarations (simple)
  { pattern: /\b(?:const|let|var)\s+([a-z_]\w*)\s*(?::\s*\w+)?\s*=/g, type: "variable" },
  // Capitalized words as potential concepts (e.g., "RAG", "TF-IDF")
  { pattern: /\b([A-Z][A-Z_]{2,})\b/g, type: "concept" },
  // Person-like patterns (e.g., "@author John")
  { pattern: /@(?:author|created-by|maintainer)\s+([A-Za-z]+(?:\s[A-Za-z]+)?)/g, type: "person" },
];

const RELATIONSHIP_PATTERNS: readonly { pattern: RegExp; type: RelationshipType }[] = [
  { pattern: /\bimport\b.*\bfrom\s+["']([^"']+)["']/g, type: "imports" },
  { pattern: /\bextends\s+([A-Z]\w*)/g, type: "extends" },
  { pattern: /\bimplements\s+([A-Z]\w*)/g, type: "extends" },
  { pattern: /([A-Za-z_]\w*)\s*\(/g, type: "calls" },
];

/**
 * Extract entities from text using regex patterns.
 * Returns deduplicated list of entities found.
 */
export function extractEntities(text: string): {
  readonly entities: readonly ExtractedEntity[];
  readonly relationships: readonly ExtractedRelationship[];
} {
  const entityMap = new Map<string, ExtractedEntity>();
  const relationships: ExtractedRelationship[] = [];

  // Extract entities
  for (const { pattern, type } of ENTITY_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1]?.trim();
      if (name && name.length > 1 && !isCommonKeyword(name)) {
        const key = `${type}:${name}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, { name, type });
        }
      }
    }
  }

  // Extract relationships
  for (const { pattern, type } of RELATIONSHIP_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const target = match[1]?.trim();
      if (target && target.length > 1) {
        relationships.push({ source: "__current__", target, type });
      }
    }
  }

  return {
    entities: [...entityMap.values()],
    relationships,
  };
}

function isCommonKeyword(word: string): boolean {
  const keywords = new Set([
    "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "return", "new", "this", "super", "null", "undefined",
    "true", "false", "void", "typeof", "instanceof", "in", "of",
    "async", "await", "try", "catch", "finally", "throw", "delete",
    "export", "default", "from", "as", "get", "set", "static",
    "public", "private", "protected", "abstract", "readonly",
    "string", "number", "boolean", "any", "never", "unknown",
    "const", "let", "var", "function", "class", "interface", "type",
    "enum", "import", "require", "module", "extends", "implements",
  ]);
  return keywords.has(word.toLowerCase());
}

// ── Knowledge Graph ───────────────────────────────────

export class KnowledgeGraph {
  private readonly entities: Map<string, Entity> = new Map();
  private readonly relationships: Map<string, Relationship> = new Map();
  private readonly documents: Map<string, Document> = new Map();
  private readonly entityByName: Map<string, readonly string[]> = new Map();
  private readonly adjacency: Map<string, readonly string[]> = new Map();

  /**
   * Add a document to the graph, extracting entities and relationships.
   */
  addDocument(id: string, text: string): Document {
    const { entities: extracted, relationships: extractedRels } = extractEntities(text);
    const entityIds: string[] = [];

    // Add entities
    for (const ext of extracted) {
      const entity = this.addEntity(ext.name, ext.type, id);
      entityIds.push(entity.id);
    }

    // Add relationships between extracted entities
    for (const rel of extractedRels) {
      const sourceEntities = this.findEntitiesByName(rel.source === "__current__" ? id : rel.source);
      const targetEntities = this.findEntitiesByName(rel.target);

      for (const source of sourceEntities) {
        for (const target of targetEntities) {
          if (source.id !== target.id) {
            this.addRelationship(source.id, target.id, rel.type, id);
          }
        }
      }
    }

    // Build implicit relationships between co-occurring entities
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const a = entityIds[i]!;
        const b = entityIds[j]!;
        if (!this.hasRelationship(a, b)) {
          this.addRelationship(a, b, "related-to", id, 0.5);
        }
      }
    }

    const doc: Document = {
      id,
      text,
      entities: entityIds,
      addedAt: new Date().toISOString(),
    };
    this.documents.set(id, doc);
    return doc;
  }

  /**
   * Query the graph starting from entities matching the query string.
   * Traverses up to maxDepth edges from seed entities.
   */
  queryGraph(query: string, maxDepth: number = 2): GraphQueryResult {
    const seeds = this.findSeedEntities(query);
    if (seeds.length === 0) {
      return { entities: [], relationships: [], documents: [], score: 0 };
    }

    const visited = new Set<string>();
    const foundRelationships = new Set<string>();
    const foundDocIds = new Set<string>();
    let frontier = seeds.map((e) => e.id);

    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      for (const entityId of frontier) {
        if (visited.has(entityId)) continue;
        visited.add(entityId);

        const entity = this.entities.get(entityId);
        if (entity) {
          foundDocIds.add(entity.documentId);
        }

        // Traverse adjacency
        const neighbors = this.adjacency.get(entityId) ?? [];
        for (const relId of neighbors) {
          foundRelationships.add(relId);
          const rel = this.relationships.get(relId);
          if (rel) {
            const otherId = rel.sourceId === entityId ? rel.targetId : rel.sourceId;
            if (!visited.has(otherId)) {
              nextFrontier.push(otherId);
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    const resultEntities = [...visited]
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => e !== undefined);

    const resultRelationships = [...foundRelationships]
      .map((id) => this.relationships.get(id))
      .filter((r): r is Relationship => r !== undefined);

    const resultDocuments = [...foundDocIds]
      .map((id) => this.documents.get(id))
      .filter((d): d is Document => d !== undefined);

    const score = seeds.length > 0 ? seeds.length / Math.max(1, visited.size) : 0;

    return {
      entities: resultEntities,
      relationships: resultRelationships,
      documents: resultDocuments,
      score,
    };
  }

  /**
   * Keyword-based search across entity names.
   * Returns scored matches for terms in the query.
   */
  keywordSearch(query: string, maxResults: number = 20): readonly KeywordMatch[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const scores = new Map<string, { score: number; matched: string[] }>();

    for (const entity of this.entities.values()) {
      const nameLower = entity.name.toLowerCase();
      const matchedTerms: string[] = [];
      let score = 0;

      for (const term of terms) {
        if (nameLower === term) {
          score += 2.0;
          matchedTerms.push(term);
        } else if (nameLower.includes(term)) {
          score += 1.0;
          matchedTerms.push(term);
        } else if (term.includes(nameLower)) {
          score += 0.5;
          matchedTerms.push(term);
        }
      }

      if (score > 0) {
        scores.set(entity.id, { score, matched: matchedTerms });
      }
    }

    return [...scores.entries()]
      .map(([entityId, { score, matched }]) => ({
        entityId,
        entityName: this.entities.get(entityId)?.name ?? "",
        score,
        matchedTerms: matched,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * Dual-level retrieval: combine graph traversal with keyword search.
   * The graph provides structural context; keywords provide lexical matching.
   */
  dualLevelRetrieval(query: string, maxDepth: number = 2): DualRetrievalResult {
    const graphResults = this.queryGraph(query, maxDepth);
    const keywordResults = this.keywordSearch(query);

    const graphScore = graphResults.score;
    const keywordScore = keywordResults.length > 0
      ? keywordResults.reduce((sum, r) => sum + r.score, 0) / keywordResults.length
      : 0;

    const combinedScore = graphScore * 0.6 + keywordScore * 0.4;

    return { graphResults, keywordResults, combinedScore };
  }

  // ── Temporal Methods (MemPalace R2) ─────────────────

  /**
   * Invalidate a relationship by setting its validTo timestamp.
   * The relationship remains in the graph for historical queries but
   * is excluded from active queries.
   */
  invalidateRelationship(relationshipId: string, endedAt?: number): boolean {
    const existing = this.relationships.get(relationshipId);
    if (!existing) return false;

    const updated: Relationship = {
      ...existing,
      validTo: endedAt ?? Date.now(),
    };
    this.relationships.set(relationshipId, updated);
    return true;
  }

  /**
   * Get all relationships that were active at a specific point in time.
   * A relationship is active if validFrom <= date AND (validTo is null OR validTo > date).
   * Accepts either a Date object or unix milliseconds for backward compatibility.
   */
  getActiveRelationshipsAt(date: Date | number): readonly Relationship[] {
    const targetMs = typeof date === "number" ? date : date.getTime();
    return [...this.relationships.values()].filter((rel) => {
      const fromMs = toMs(rel.validFrom) ?? 0;
      if (fromMs > targetMs) return false;
      const toMsVal = toMs(rel.validTo);
      if (toMsVal !== undefined && toMsVal <= targetMs) return false;
      return true;
    });
  }

  /**
   * Get currently active relationships only (validTo is undefined).
   */
  getActiveRelationships(): readonly Relationship[] {
    return [...this.relationships.values()].filter((rel) => rel.validTo === undefined || rel.validTo === null);
  }

  /**
   * Query the graph using only relationships active at a specific date.
   * This is the temporal version of queryGraph().
   * Accepts either a Date object or unix milliseconds (MemPalace R2 API).
   */
  queryGraphAt(query: string, date: Date | number, maxDepth: number = 2): GraphQueryResult {
    const activeRelIds = new Set(
      this.getActiveRelationshipsAt(date).map((r) => r.id),
    );

    const seeds = this.findSeedEntities(query);
    if (seeds.length === 0) {
      return { entities: [], relationships: [], documents: [], score: 0 };
    }

    const visited = new Set<string>();
    const foundRelationships = new Set<string>();
    const foundDocIds = new Set<string>();
    let frontier = seeds.map((e) => e.id);

    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      for (const entityId of frontier) {
        if (visited.has(entityId)) continue;
        visited.add(entityId);

        const entity = this.entities.get(entityId);
        if (entity) foundDocIds.add(entity.documentId);

        const neighbors = this.adjacency.get(entityId) ?? [];
        for (const relId of neighbors) {
          // Only follow temporally active relationships
          if (!activeRelIds.has(relId)) continue;
          foundRelationships.add(relId);
          const rel = this.relationships.get(relId);
          if (rel) {
            const otherId = rel.sourceId === entityId ? rel.targetId : rel.sourceId;
            if (!visited.has(otherId)) nextFrontier.push(otherId);
          }
        }
      }
      frontier = nextFrontier;
    }

    const resultEntities = [...visited]
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => e !== undefined);
    const resultRelationships = [...foundRelationships]
      .map((id) => this.relationships.get(id))
      .filter((r): r is Relationship => r !== undefined);
    const resultDocuments = [...foundDocIds]
      .map((id) => this.documents.get(id))
      .filter((d): d is Document => d !== undefined);

    const score = seeds.length > 0 ? seeds.length / Math.max(1, visited.size) : 0;
    return { entities: resultEntities, relationships: resultRelationships, documents: resultDocuments, score };
  }

  // ── Accessors ───────────────────────────────────────

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getEntityCount(): number {
    return this.entities.size;
  }

  getRelationshipCount(): number {
    return this.relationships.size;
  }

  getDocumentCount(): number {
    return this.documents.size;
  }

  getAllEntities(): readonly Entity[] {
    return [...this.entities.values()];
  }

  getAllRelationships(): readonly Relationship[] {
    return [...this.relationships.values()];
  }

  getDocument(id: string): Document | undefined {
    return this.documents.get(id);
  }

  // ── Serialization ───────────────────────────────────

  toJSON(): string {
    return JSON.stringify({
      entities: [...this.entities.values()],
      relationships: [...this.relationships.values()],
      documents: [...this.documents.values()],
    });
  }

  static fromJSON(json: string): KnowledgeGraph {
    const data = JSON.parse(json) as {
      entities: Entity[];
      relationships: Relationship[];
      documents: Document[];
    };
    const graph = new KnowledgeGraph();

    for (const entity of data.entities) {
      graph.entities.set(entity.id, entity);
      const existing = graph.entityByName.get(entity.name.toLowerCase()) ?? [];
      graph.entityByName.set(entity.name.toLowerCase(), [...existing, entity.id]);
    }

    for (const rel of data.relationships) {
      // Ensure validFrom is set. Support legacy ISO-string values by parsing
      // them back to unix ms. Nothing/undefined defaults to now.
      const nowMs = Date.now();
      const migratedValidFrom =
        typeof rel.validFrom === "number"
          ? rel.validFrom
          : typeof rel.validFrom === "string"
          ? Date.parse(rel.validFrom as unknown as string) || nowMs
          : nowMs;
      const migratedValidTo =
        typeof rel.validTo === "number"
          ? rel.validTo
          : typeof rel.validTo === "string"
          ? Date.parse(rel.validTo as unknown as string)
          : undefined;

      const temporalRel: Relationship = {
        ...rel,
        validFrom: migratedValidFrom,
        ...(migratedValidTo !== undefined && !Number.isNaN(migratedValidTo)
          ? { validTo: migratedValidTo }
          : {}),
      };
      graph.relationships.set(temporalRel.id, temporalRel);
      const srcAdj = graph.adjacency.get(temporalRel.sourceId) ?? [];
      graph.adjacency.set(temporalRel.sourceId, [...srcAdj, temporalRel.id]);
      const tgtAdj = graph.adjacency.get(temporalRel.targetId) ?? [];
      graph.adjacency.set(temporalRel.targetId, [...tgtAdj, temporalRel.id]);
    }

    for (const doc of data.documents) {
      graph.documents.set(doc.id, doc);
    }

    return graph;
  }

  // ── Private Helpers ─────────────────────────────────

  private addEntity(name: string, type: EntityType, documentId: string, metadata: Record<string, string> = {}): Entity {
    // Check for existing entity with same name and type
    const existingIds = this.entityByName.get(name.toLowerCase()) ?? [];
    for (const id of existingIds) {
      const existing = this.entities.get(id);
      if (existing && existing.type === type) {
        return existing;
      }
    }

    const entity: Entity = {
      id: randomUUID().slice(0, 12),
      name,
      type,
      metadata,
      documentId,
      createdAt: new Date().toISOString(),
    };

    this.entities.set(entity.id, entity);
    this.entityByName.set(name.toLowerCase(), [...existingIds, entity.id]);
    return entity;
  }

  /**
   * Add a relationship between two entities.
   * When an existing active relationship with the same (source, target, type)
   * exists with different metadata and closeContradicting is true (default),
   * the old one is auto-closed (validTo = now) before the new one opens.
   *
   * Callable with positional args (legacy) or options object (MemPalace R2 API).
   */
  addRelationship(
    sourceId: string,
    targetId: string,
    type: RelationshipType,
    documentId: string,
    weightOrOptions: number | AddRelationshipOptions = 1.0,
  ): Relationship {
    const isOptionsForm = typeof weightOrOptions === "object";
    const options: AddRelationshipOptions = isOptionsForm
      ? weightOrOptions
      : { weight: weightOrOptions };

    const nowMs = Date.now();
    const validFrom = options.validFrom ?? nowMs;
    const weight = options.weight ?? 1.0;
    const metadata: Readonly<Record<string, string>> = options.metadata ?? {};
    const closeContradicting = options.closeContradicting !== false;

    // Auto-close existing active relationships with same (source, target, type)
    // but different metadata. This implements MemPalace R2 contradiction handling.
    if (closeContradicting) {
      for (const [id, existing] of this.relationships) {
        if (existing.sourceId !== sourceId) continue;
        if (existing.targetId !== targetId) continue;
        if (existing.type !== type) continue;
        // Only touch currently-active relationships
        if (existing.validTo !== undefined && existing.validTo !== null) continue;
        // Compare metadata — if same, skip (no contradiction, same fact)
        if (metadataEquals(existing.metadata, metadata)) continue;
        // Close the old relationship
        this.relationships.set(id, { ...existing, validTo: nowMs });
      }
    }

    const rel: Relationship = {
      id: randomUUID().slice(0, 12),
      sourceId,
      targetId,
      type,
      weight,
      metadata,
      documentId,
      validFrom,
      ...(options.validTo !== undefined ? { validTo: options.validTo } : {}),
    };

    this.relationships.set(rel.id, rel);

    const srcAdj = this.adjacency.get(sourceId) ?? [];
    this.adjacency.set(sourceId, [...srcAdj, rel.id]);

    const tgtAdj = this.adjacency.get(targetId) ?? [];
    this.adjacency.set(targetId, [...tgtAdj, rel.id]);

    return rel;
  }

  private findEntitiesByName(name: string): readonly Entity[] {
    const ids = this.entityByName.get(name.toLowerCase()) ?? [];
    return ids
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => e !== undefined);
  }

  private findSeedEntities(query: string): readonly Entity[] {
    const terms = tokenize(query);
    const seeds: Entity[] = [];

    for (const term of terms) {
      const ids = this.entityByName.get(term) ?? [];
      for (const id of ids) {
        const entity = this.entities.get(id);
        if (entity) {
          seeds.push(entity);
        }
      }
    }

    // Fallback: partial match
    if (seeds.length === 0) {
      for (const term of terms) {
        for (const [nameLower, ids] of this.entityByName) {
          if (nameLower.includes(term) || term.includes(nameLower)) {
            for (const id of ids) {
              const entity = this.entities.get(id);
              if (entity && !seeds.some((s) => s.id === entity.id)) {
                seeds.push(entity);
              }
            }
          }
        }
      }
    }

    return seeds;
  }

  private hasRelationship(sourceId: string, targetId: string): boolean {
    const adj = this.adjacency.get(sourceId) ?? [];
    for (const relId of adj) {
      const rel = this.relationships.get(relId);
      if (rel && (rel.targetId === targetId || rel.sourceId === targetId)) {
        return true;
      }
    }
    return false;
  }
}

// ── Tokenizer ─────────────────────────────────────────

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[\s,;:!?()[\]{}"'`]+/)
    .filter((t) => t.length > 1 && !isCommonKeyword(t));
}

// ── Temporal Helpers ──────────────────────────────────

/**
 * Convert a temporal value (unix ms or ISO string) to unix ms.
 * Returns undefined if the value is undefined/null/invalid.
 */
function toMs(value: number | string | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Check if two metadata records are equal (same keys and values).
 */
function metadataEquals(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
