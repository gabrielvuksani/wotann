/**
 * Pluggable Memory Provider — extensible backend interface.
 *
 * Enables third-party memory backends (vector stores, custom DBs, cloud services)
 * to implement a standard interface that WOTANN can use interchangeably.
 *
 * From Hermes v0.7.0 pluggable memory provider pattern.
 *
 * Built-in providers:
 * - SQLiteProvider: Default, uses store.ts MemoryStore
 * - InMemoryProvider: Fast, ephemeral (for testing)
 *
 * Custom providers implement MemoryProvider interface and register via plugin system.
 */

import type { MemoryEntry, MemorySearchResult, MemoryLayer, MemoryBlockType } from "./store.js";

// ── Provider Interface ──────────────────────────────────────

export interface MemoryProvider {
  readonly name: string;
  readonly version: string;

  /** Initialize the provider (create tables, connect, etc.) */
  initialize(): Promise<void>;

  /** Shutdown gracefully */
  close(): Promise<void>;

  /** Insert a memory entry */
  insert(entry: Omit<MemoryEntry, "createdAt" | "updatedAt">): Promise<void>;

  /** Update an existing entry */
  update(id: string, updates: { key?: string; value?: string; verified?: boolean; confidence?: number }): Promise<void>;

  /** Get entry by ID */
  getById(id: string): Promise<MemoryEntry | null>;

  /** Get entries by layer */
  getByLayer(layer: MemoryLayer, limit?: number): Promise<readonly MemoryEntry[]>;

  /** Get entries by block type */
  getByBlock(blockType: MemoryBlockType, limit?: number): Promise<readonly MemoryEntry[]>;

  /** Full-text search */
  search(query: string, limit?: number): Promise<readonly MemorySearchResult[]>;

  /** Delete an entry */
  delete(id: string): Promise<void>;

  /** Archive an entry (soft delete) */
  archive(id: string): Promise<void>;

  /** Get total entry count */
  count(): Promise<number>;

  /** Check if provider is healthy */
  healthCheck(): Promise<boolean>;
}

// ── Provider Registry ───────────────────────────────────────

const providers: Map<string, MemoryProvider> = new Map();
let activeProvider: MemoryProvider | null = null;

export function registerMemoryProvider(provider: MemoryProvider): void {
  providers.set(provider.name, provider);
}

export function setActiveMemoryProvider(name: string): boolean {
  const provider = providers.get(name);
  if (!provider) return false;
  activeProvider = provider;
  return true;
}

export function getActiveMemoryProvider(): MemoryProvider | null {
  return activeProvider;
}

export function getRegisteredProviders(): readonly string[] {
  return [...providers.keys()];
}

// ── In-Memory Provider ──────────────────────────────────────

export class InMemoryProvider implements MemoryProvider {
  readonly name = "in-memory";
  readonly version = "1.0.0";
  private entries: Map<string, MemoryEntry & { archived: boolean }> = new Map();

  async initialize(): Promise<void> {
    // No-op for in-memory
  }

  async close(): Promise<void> {
    this.entries.clear();
  }

  async insert(entry: Omit<MemoryEntry, "createdAt" | "updatedAt">): Promise<void> {
    const now = new Date().toISOString();
    this.entries.set(entry.id, {
      ...entry,
      createdAt: now,
      updatedAt: now,
      archived: false,
    });
  }

  async update(id: string, updates: { key?: string; value?: string; verified?: boolean; confidence?: number }): Promise<void> {
    const existing = this.entries.get(id);
    if (!existing) return;
    this.entries.set(id, {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry || entry.archived) return null;
    return entry;
  }

  async getByLayer(layer: MemoryLayer, limit: number = 100): Promise<readonly MemoryEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.layer === layer && !e.archived)
      .slice(0, limit);
  }

  async getByBlock(blockType: MemoryBlockType, limit: number = 100): Promise<readonly MemoryEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.blockType === blockType && !e.archived)
      .slice(0, limit);
  }

  async search(query: string, limit: number = 20): Promise<readonly MemorySearchResult[]> {
    const lower = query.toLowerCase();
    return [...this.entries.values()]
      .filter((e) => !e.archived && (e.key.toLowerCase().includes(lower) || e.value.toLowerCase().includes(lower)))
      .slice(0, limit)
      .map((entry) => ({
        entry,
        score: 1.0,
        snippet: entry.value.slice(0, 200),
        matchType: "fts" as const,
      }));
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async archive(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) {
      this.entries.set(id, { ...entry, archived: true });
    }
  }

  async count(): Promise<number> {
    return [...this.entries.values()].filter((e) => !e.archived).length;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// ── Multi-Turn Memory ───────────────────────────────────────

/**
 * Multi-turn memory that persists across conversation turns and compaction.
 * From DeepAgents multi-turn memory pattern.
 *
 * Unlike working memory (session-scoped), multi-turn memory survives
 * context window compaction by serializing to the memory provider.
 */

export interface MultiTurnEntry {
  readonly id: string;
  readonly turnIndex: number;
  readonly key: string;
  readonly value: string;
  readonly importance: number;
  readonly createdAt: string;
  readonly survivesCompaction: boolean;
}

export class MultiTurnMemory {
  private entries: Map<string, MultiTurnEntry> = new Map();
  private currentTurn = 0;
  private readonly maxEntries: number;
  private entryCounter = 0;

  constructor(maxEntries: number = 50) {
    this.maxEntries = maxEntries;
  }

  /** Record a fact for the current turn */
  record(key: string, value: string, importance: number = 0.5): MultiTurnEntry {
    const id = `mt_${this.currentTurn}_${this.entryCounter++}`;
    const entry: MultiTurnEntry = {
      id,
      turnIndex: this.currentTurn,
      key,
      value,
      importance,
      createdAt: new Date().toISOString(),
      survivesCompaction: importance >= 0.7,
    };
    this.entries.set(id, entry);

    // Evict low-importance entries if over limit
    if (this.entries.size > this.maxEntries) {
      this.evictLowestImportance();
    }

    return entry;
  }

  /** Advance to next turn */
  nextTurn(): void {
    this.currentTurn++;
  }

  /** Get entries that should survive compaction */
  getCompactionSafe(): readonly MultiTurnEntry[] {
    return [...this.entries.values()].filter((e) => e.survivesCompaction);
  }

  /** Get all entries sorted by importance */
  getAll(): readonly MultiTurnEntry[] {
    return [...this.entries.values()].sort((a, b) => b.importance - a.importance);
  }

  /** Get entries for a specific turn */
  getByTurn(turn: number): readonly MultiTurnEntry[] {
    return [...this.entries.values()].filter((e) => e.turnIndex === turn);
  }

  /** Serialize for persistence across compaction */
  serialize(): string {
    return JSON.stringify(this.getCompactionSafe());
  }

  /** Restore from serialized state */
  restore(serialized: string): void {
    try {
      const entries = JSON.parse(serialized) as MultiTurnEntry[];
      for (const entry of entries) {
        this.entries.set(entry.id, entry);
      }
    } catch {
      // Ignore invalid serialized data
    }
  }

  /** Get current turn index */
  getCurrentTurn(): number {
    return this.currentTurn;
  }

  private evictLowestImportance(): void {
    let lowest: MultiTurnEntry | null = null;
    for (const entry of this.entries.values()) {
      if (!entry.survivesCompaction && (!lowest || entry.importance < lowest.importance)) {
        lowest = entry;
      }
    }
    if (lowest) {
      this.entries.delete(lowest.id);
    }
  }
}

// ── Memory Freshness & Contradiction ────────────────────────

/**
 * Calculate memory freshness score with temporal decay.
 * confidence = base_confidence × decay(age) × verification_boost
 */
export function calculateFreshness(
  baseConfidence: number,
  createdAt: string,
  verified: boolean,
  verifiedAt?: string,
): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const ageHours = (now - created) / (1000 * 60 * 60);

  // Exponential decay: half-life of 168 hours (1 week)
  const decay = Math.exp(-0.693 * ageHours / 168);

  // Verification boost: verified memories decay 3x slower effectively
  const verificationBoost = verified ? 1.5 : 1.0;

  // Recent verification refresh
  let verificationFreshness = 1.0;
  if (verified && verifiedAt) {
    const verifiedAge = (now - new Date(verifiedAt).getTime()) / (1000 * 60 * 60);
    verificationFreshness = Math.exp(-0.693 * verifiedAge / 336); // 2-week half-life
  }

  return Math.min(1.0, baseConfidence * decay * verificationBoost * verificationFreshness);
}

/**
 * Detect contradictions between a new memory and existing entries.
 */
export function detectContradiction(
  newKey: string,
  newValue: string,
  existingEntries: readonly MemoryEntry[],
): readonly { existingId: string; existingKey: string; existingValue: string; conflictType: "direct" | "indirect" }[] {
  const contradictions: { existingId: string; existingKey: string; existingValue: string; conflictType: "direct" | "indirect" }[] = [];

  for (const existing of existingEntries) {
    // Direct conflict: same key, different value
    if (existing.key === newKey && existing.value !== newValue) {
      contradictions.push({
        existingId: existing.id,
        existingKey: existing.key,
        existingValue: existing.value,
        conflictType: "direct",
      });
      continue;
    }

    // Indirect conflict: overlapping content with opposing signals
    const newLower = newValue.toLowerCase();
    const existingLower = existing.value.toLowerCase();
    if (
      existing.key.toLowerCase().includes(newKey.toLowerCase()) &&
      hasOpposingSignals(newLower, existingLower)
    ) {
      contradictions.push({
        existingId: existing.id,
        existingKey: existing.key,
        existingValue: existing.value,
        conflictType: "indirect",
      });
    }
  }

  return contradictions;
}

function hasOpposingSignals(a: string, b: string): boolean {
  const opposites = [
    ["always", "never"],
    ["enable", "disable"],
    ["true", "false"],
    ["yes", "no"],
    ["required", "optional"],
    ["must", "must not"],
    ["do", "do not"],
  ];

  for (const [pos, neg] of opposites) {
    if ((a.includes(pos!) && b.includes(neg!)) || (a.includes(neg!) && b.includes(pos!))) {
      return true;
    }
  }
  return false;
}
