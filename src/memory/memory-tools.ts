/**
 * Memory Tools — agent-callable memory operations (Letta pattern).
 *
 * Wraps the MemoryStore's core operations into a tool-dispatch interface
 * that agents can invoke by name. Each tool has:
 * - A name matching the Letta convention: memory_search, memory_replace, memory_insert
 * - Input validation with clear error messages
 * - Contradiction detection before writes
 * - Freshness-aware search ranking
 * - Audit trail logging
 *
 * The tool registry is designed to be exposed via the agent bridge
 * so that any model/provider can call memory operations as tools.
 */

import type {
  MemoryEntry,
  MemoryLayer,
  MemoryBlockType,
  MemorySearchResult,
  ContradictionResult,
} from "./store.js";
import { ContradictionDetector, type ContradictionReport } from "./contradiction-detector.js";
import { FreshnessDecayEngine, type FreshnessScore } from "./freshness-decay.js";

// ── Types ────────────────────────────────────────────────

export interface ToolCallResult {
  readonly success: boolean;
  readonly toolName: string;
  readonly data: unknown;
  readonly error?: string;
  readonly timestamp: string;
}

export interface MemorySearchInput {
  readonly query: string;
  readonly layers?: readonly MemoryLayer[];
  readonly limit?: number;
  readonly minFreshness?: number;
  /** MemPalace-style domain partition filter. Reduces noise by +12-34%. */
  readonly domain?: string;
  /** MemPalace-style topic partition filter. Combined with domain gives +34%. */
  readonly topic?: string;
}

export interface MemorySearchOutput {
  readonly results: readonly ScoredMemory[];
  readonly totalMatches: number;
  readonly query: string;
}

export interface ScoredMemory {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly layer: MemoryLayer;
  readonly freshnessScore: number;
  readonly confidence: number;
  readonly verified: boolean;
  readonly matchScore: number;
  /** LoCoMo adversarial detection: "confident" if topically relevant, "uncertain" if spurious match. */
  readonly retrievalConfidence: "confident" | "uncertain";
}

export interface MemoryReplaceInput {
  readonly block: MemoryBlockType;
  readonly key: string;
  readonly value: string;
  readonly reason?: string;
}

export interface MemoryReplaceOutput {
  readonly replaced: boolean;
  readonly entryId: string;
  readonly contradictions: readonly ContradictionReport[];
}

export interface MemoryInsertInput {
  readonly block: MemoryBlockType;
  readonly key: string;
  readonly value: string;
  readonly layer?: MemoryLayer;
  readonly tags?: string;
  readonly domain?: string;
  readonly topic?: string;
}

export interface MemoryInsertOutput {
  readonly inserted: boolean;
  readonly entryId: string;
  readonly contradictions: readonly ContradictionReport[];
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, ParameterDefinition>>;
  readonly required: readonly string[];
}

export interface ParameterDefinition {
  readonly type: "string" | "number" | "boolean" | "array";
  readonly description: string;
  readonly enum?: readonly string[];
  readonly default?: unknown;
}

// ── Store Interface ──────────────────────────────────────

/**
 * Minimal interface for the MemoryStore methods used by MemoryToolkit.
 * Keeps this module decoupled from the concrete MemoryStore class.
 */
export interface MemoryToolStoreAdapter {
  search(query: string, limit: number): readonly MemorySearchResult[];
  getById(id: string): MemoryEntry | null;
  insert(entry: Omit<MemoryEntry, "createdAt" | "updatedAt">): void;
  replace(id: string, key: string, value: string): void;
  archive(id: string): void;
  getByLayer(layer: MemoryLayer): readonly MemoryEntry[];
  logProvenance(
    entryId: string,
    action: string,
    oldValue: string | null,
    newValue: string | null,
    actor?: string,
    reason?: string,
  ): void;
}

// ── Tool Definitions ─────────────────────────────────────

const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "memory_search",
    description:
      "Search persistent memory for relevant entries. Returns results ranked by relevance and freshness. " +
      "Use domain/topic filters to reduce noise by up to 34% (MemPalace technique). " +
      "Use this to find past decisions, corrections, patterns, or any stored knowledge.",
    parameters: {
      query: { type: "string", description: "Search query text" },
      layers: {
        type: "array",
        description: "Optional: filter by memory layers",
        enum: [
          "auto_capture",
          "core_blocks",
          "working",
          "knowledge_graph",
          "archival",
          "recall",
          "team",
          "proactive",
        ],
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default: 10)",
        default: 10,
      },
      minFreshness: {
        type: "number",
        description: "Minimum freshness score 0-1 (default: 0.1)",
        default: 0.1,
      },
      domain: {
        type: "string",
        description:
          "Optional: domain partition (e.g., 'memory', 'auth', 'deploy'). Reduces search noise by ~12%.",
      },
      topic: {
        type: "string",
        description:
          "Optional: topic partition (e.g., 'architecture', 'bug-fix'). With domain, reduces noise by ~34%.",
      },
    },
    required: ["query"],
  },
  {
    name: "memory_replace",
    description:
      "Replace an existing memory entry's value. If no entry exists for the given block+key, " +
      "creates a new one. Checks for contradictions before writing.",
    parameters: {
      block: {
        type: "string",
        description: "Memory block type",
        enum: [
          "user",
          "feedback",
          "project",
          "reference",
          "cases",
          "patterns",
          "decisions",
          "issues",
        ],
      },
      key: { type: "string", description: "The key/topic for this memory" },
      value: { type: "string", description: "The new value to store" },
      reason: { type: "string", description: "Optional: reason for the replacement" },
    },
    required: ["block", "key", "value"],
  },
  {
    name: "memory_search_in_domain",
    description:
      "Search memory within an explicit domain (and optional topic) partition. " +
      "Use this when you know the scope (e.g. 'auth', 'memory', 'deploy') — the " +
      "partition filter runs before FTS5 and gives +12-34% retrieval precision " +
      "over the generic memory_search.",
    parameters: {
      query: { type: "string", description: "Search query text" },
      domain: {
        type: "string",
        description: "Domain partition — required. Examples: 'memory', 'auth', 'deploy'.",
      },
      topic: {
        type: "string",
        description: "Optional topic partition within the domain.",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default: 10)",
        default: 10,
      },
      minFreshness: {
        type: "number",
        description: "Minimum freshness score 0-1 (default: 0.1)",
        default: 0.1,
      },
    },
    required: ["query", "domain"],
  },
  {
    name: "memory_insert",
    description:
      "Insert a new memory entry. Always creates a new entry (never overwrites). " +
      "Checks for contradictions with existing memories. Assign domain/topic for better retrieval.",
    parameters: {
      block: {
        type: "string",
        description: "Memory block type",
        enum: [
          "user",
          "feedback",
          "project",
          "reference",
          "cases",
          "patterns",
          "decisions",
          "issues",
        ],
      },
      key: { type: "string", description: "The key/topic for this memory" },
      value: { type: "string", description: "The value to store" },
      layer: {
        type: "string",
        description: "Memory layer (default: core_blocks)",
        enum: ["auto_capture", "core_blocks", "working", "archival"],
        default: "core_blocks",
      },
      tags: { type: "string", description: "Optional: comma-separated tags" },
      domain: {
        type: "string",
        description: "Optional: domain partition (e.g., 'memory', 'auth', 'deploy')",
      },
      topic: {
        type: "string",
        description: "Optional: topic partition (e.g., 'architecture', 'bug-fix')",
      },
    },
    required: ["block", "key", "value"],
  },
  {
    name: "memory_search_in_domain",
    description:
      "Search memory within an explicit domain (and optional topic) partition. " +
      "Use when the scope is known (e.g. 'auth', 'deploy') — partition filtering " +
      "runs before FTS5 for +12-34% precision over the generic memory_search.",
    parameters: {
      query: { type: "string", description: "Search query text" },
      domain: {
        type: "string",
        description: "Domain partition — required. Examples: 'memory', 'auth', 'deploy'.",
      },
      topic: {
        type: "string",
        description: "Optional topic partition within the domain.",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default: 10)",
        default: 10,
      },
      minFreshness: {
        type: "number",
        description: "Minimum freshness score 0-1 (default: 0.1)",
        default: 0.1,
      },
    },
    required: ["query", "domain"],
  },
];

// ── Memory Toolkit ───────────────────────────────────────

export class MemoryToolkit {
  private readonly store: MemoryToolStoreAdapter;
  private readonly contradictionDetector: ContradictionDetector;
  private readonly freshnessEngine: FreshnessDecayEngine;
  private readonly callLog: ToolCallResult[] = [];

  constructor(store: MemoryToolStoreAdapter) {
    this.store = store;
    this.contradictionDetector = new ContradictionDetector(store, "flag-for-review");
    this.freshnessEngine = new FreshnessDecayEngine();
  }

  /**
   * Get all tool definitions for registration with the agent bridge.
   * These follow the OpenAI function-calling schema convention.
   */
  getToolDefinitions(): readonly ToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  /**
   * Dispatch a tool call by name.
   * This is the main entry point for agent-callable memory operations.
   */
  dispatch(toolName: string, args: Record<string, unknown>): ToolCallResult {
    const timestamp = new Date().toISOString();

    try {
      switch (toolName) {
        case "memory_search":
          return this.logCall(toolName, this.executeSearch(args), timestamp);
        case "memory_search_in_domain":
          return this.logCall(toolName, this.executeSearchInDomain(args), timestamp);
        case "memory_replace":
          return this.logCall(toolName, this.executeReplace(args), timestamp);
        case "memory_insert":
          return this.logCall(toolName, this.executeInsert(args), timestamp);
        default:
          return this.logCall(toolName, undefined, timestamp, `Unknown tool: ${toolName}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.logCall(toolName, undefined, timestamp, message);
    }
  }

  /**
   * Get the call log for audit purposes.
   */
  getCallLog(): readonly ToolCallResult[] {
    return [...this.callLog];
  }

  /**
   * Get the contradiction detector for direct access.
   */
  getContradictionDetector(): ContradictionDetector {
    return this.contradictionDetector;
  }

  /**
   * Get the freshness engine for direct access.
   */
  getFreshnessEngine(): FreshnessDecayEngine {
    return this.freshnessEngine;
  }

  // ── Tool Implementations ───────────────────────────────

  /**
   * Public helper for domain-scoped memory search. Threads the domain/topic
   * partition through to the store's `searchPartitioned` method (when
   * available) for +12-34% retrieval precision. Also invoked by the
   * `memory.searchInDomain` RPC in the daemon.
   */
  searchInDomain(
    query: string,
    domain: string,
    opts: { readonly topic?: string; readonly limit?: number; readonly minFreshness?: number } = {},
  ): MemorySearchOutput {
    if (!domain) {
      throw new Error("searchInDomain requires a non-empty 'domain' argument");
    }
    return this.executeSearchInDomain({
      query,
      domain,
      topic: opts.topic,
      limit: opts.limit,
      minFreshness: opts.minFreshness,
    });
  }

  private executeSearchInDomain(args: Record<string, unknown>): MemorySearchOutput {
    const domain = String(args["domain"] ?? "");
    if (domain.length === 0) {
      throw new Error("memory_search_in_domain requires a non-empty 'domain' parameter");
    }
    // Delegate to executeSearch with domain forced — this keeps the scoring
    // and adversarial-confidence gating consistent across both entry points.
    return this.executeSearch({ ...args, domain });
  }

  private executeSearch(args: Record<string, unknown>): MemorySearchOutput {
    const query = String(args["query"] ?? "");
    if (query.length === 0) {
      throw new Error("memory_search requires a non-empty 'query' parameter");
    }

    const limit = typeof args["limit"] === "number" ? args["limit"] : 10;
    const minFreshness = typeof args["minFreshness"] === "number" ? args["minFreshness"] : 0.1;
    const layers = Array.isArray(args["layers"]) ? (args["layers"] as MemoryLayer[]) : undefined;
    const domain = typeof args["domain"] === "string" ? args["domain"] : undefined;
    const topic = typeof args["topic"] === "string" ? args["topic"] : undefined;

    let rawResults: readonly MemorySearchResult[];
    try {
      // Use domain/topic partitioned search if available on the adapter
      const storeWithPartition = this.store as MemoryToolStoreAdapter & {
        searchPartitioned?: (
          query: string,
          opts: { domain?: string; topic?: string; limit?: number },
        ) => readonly MemorySearchResult[];
      };
      if (storeWithPartition.searchPartitioned && (domain || topic)) {
        rawResults = storeWithPartition.searchPartitioned(query, {
          domain,
          topic,
          limit: limit * 2,
        });
      } else {
        rawResults = this.store.search(query, limit * 2); // Fetch extra for freshness filtering
      }
    } catch {
      rawResults = [];
    }

    // Filter by layers if specified
    const layerFiltered = layers
      ? rawResults.filter((r) => layers.includes(r.entry.layer))
      : rawResults;

    // Score and filter by freshness, with adversarial confidence gating (LoCoMo R7).
    // LoCoMo showed that long-context models hallucinate on spurious matches.
    // We detect "uncertain" results by checking if the query terms overlap with the entry key/value.
    const queryTermsLower = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored: ScoredMemory[] = layerFiltered
      .map((r) => {
        const freshness = this.freshnessEngine.computeScore(r.entry);
        const matchScore = Math.abs(r.score);

        // Adversarial detection: check term overlap between query and result
        const entryTextLower = `${r.entry.key} ${r.entry.value}`.toLowerCase();
        const overlappingTerms = queryTermsLower.filter((t) => entryTextLower.includes(t));
        const overlapRatio =
          queryTermsLower.length > 0 ? overlappingTerms.length / queryTermsLower.length : 0;

        // A result is "uncertain" if it has low term overlap despite being returned by FTS5.
        // This catches spurious BM25 matches from common substrings (LoCoMo finding).
        // Overlap ratio is the primary signal — if query terms appear in the entry, it's relevant.
        const retrievalConfidence: "confident" | "uncertain" =
          overlapRatio >= 0.3 ? "confident" : "uncertain";

        return {
          id: r.entry.id,
          key: r.entry.key,
          value: r.entry.value,
          layer: r.entry.layer,
          freshnessScore: freshness.finalScore,
          confidence: r.entry.confidence ?? 0.5,
          verified: r.entry.verified,
          matchScore,
          retrievalConfidence,
        };
      })
      .filter((s) => s.freshnessScore >= minFreshness)
      .sort((a, b) => {
        // Rank confident results above uncertain ones, then by combined score
        if (a.retrievalConfidence !== b.retrievalConfidence) {
          return a.retrievalConfidence === "confident" ? -1 : 1;
        }
        const aRank = a.matchScore * 0.6 + a.freshnessScore * 0.4;
        const bRank = b.matchScore * 0.6 + b.freshnessScore * 0.4;
        return bRank - aRank;
      })
      .slice(0, limit);

    return {
      results: scored,
      totalMatches: layerFiltered.length,
      query,
    };
  }

  private executeReplace(args: Record<string, unknown>): MemoryReplaceOutput {
    const block = String(args["block"] ?? "") as MemoryBlockType;
    const key = String(args["key"] ?? "");
    const value = String(args["value"] ?? "");
    const reason = args["reason"] ? String(args["reason"]) : undefined;

    if (!block || !key || !value) {
      throw new Error("memory_replace requires 'block', 'key', and 'value' parameters");
    }

    // Check for contradictions
    const report = this.contradictionDetector.check(key, value);
    const contradictions = report.conflicts.length > 0 ? [report] : [];

    // Find existing entry with this block+key
    let existingId: string | undefined;
    let oldValue: string | null = null;

    try {
      const searchResults = this.store.search(key, 20);
      const match = searchResults.find((r) => r.entry.blockType === block && r.entry.key === key);
      if (match) {
        existingId = match.entry.id;
        oldValue = match.entry.value;
      }
    } catch {
      // Search may fail on empty database
    }

    if (existingId) {
      this.store.replace(existingId, key, value);
      this.store.logProvenance(existingId, "memory_replace", oldValue, value, "agent", reason);

      return { replaced: true, entryId: existingId, contradictions };
    }

    // No existing entry — create new
    const newId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.store.insert({
      id: newId,
      layer: "core_blocks",
      blockType: block,
      key,
      value,
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
    });
    this.store.logProvenance(newId, "memory_replace_new", null, value, "agent", reason);

    return { replaced: false, entryId: newId, contradictions };
  }

  private executeInsert(args: Record<string, unknown>): MemoryInsertOutput {
    const block = String(args["block"] ?? "") as MemoryBlockType;
    const key = String(args["key"] ?? "");
    const value = String(args["value"] ?? "");
    const layer = (args["layer"] as MemoryLayer) ?? "core_blocks";
    const tags = args["tags"] ? String(args["tags"]) : undefined;
    const domain = typeof args["domain"] === "string" ? args["domain"] : undefined;
    const topic = typeof args["topic"] === "string" ? args["topic"] : undefined;

    if (!block || !key || !value) {
      throw new Error("memory_insert requires 'block', 'key', and 'value' parameters");
    }

    // Check for contradictions
    const report = this.contradictionDetector.check(key, value);
    const contradictions = report.conflicts.length > 0 ? [report] : [];

    const entryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.store.insert({
      id: entryId,
      layer,
      blockType: block,
      key,
      value,
      verified: false,
      tags,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
      domain: domain ?? "",
      topic: topic ?? "",
    });
    this.store.logProvenance(entryId, "memory_insert", null, value, "agent");

    return { inserted: true, entryId, contradictions };
  }

  // ── Private Helpers ────────────────────────────────────

  private logCall(
    toolName: string,
    data: unknown,
    timestamp: string,
    error?: string,
  ): ToolCallResult {
    const result: ToolCallResult = {
      success: error === undefined,
      toolName,
      data: data ?? null,
      error,
      timestamp,
    };
    this.callLog.push(result);
    return result;
  }
}
