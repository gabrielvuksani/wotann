/**
 * Memvid Backend — portable single-file memory storage.
 *
 * Inspired by the memvid project: encode memory entries into a single
 * portable file (JSON-based) for easy backup, sharing, and migration.
 * Interface-compatible with the MemoryStore search/save patterns.
 *
 * FORMAT:
 * A .memvid file is a JSON file containing:
 *   - header: version, created, entry count
 *   - entries: array of MemvidEntry objects
 *   - index: inverted index for fast full-text search
 *
 * USE CASES:
 *   - Export WOTANN memory to a portable file
 *   - Import memory from another WOTANN instance
 *   - Backup memory before destructive operations
 *   - Share knowledge between agents/sessions
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────────────

export interface MemvidEntry {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confidence: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MemvidHeader {
  readonly version: number;
  readonly created: string;
  readonly lastModified: string;
  readonly entryCount: number;
  readonly description: string;
}

export interface MemvidFile {
  readonly header: MemvidHeader;
  readonly entries: readonly MemvidEntry[];
  readonly index: Readonly<Record<string, readonly string[]>>;
}

export interface MemvidSearchResult {
  readonly entry: MemvidEntry;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export interface MemvidExportOptions {
  readonly description?: string;
  readonly filterCategory?: string;
  readonly filterTags?: readonly string[];
  readonly minConfidence?: number;
}

export interface MemvidImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly duplicates: number;
  readonly errors: readonly string[];
}

// ── Constants ────────────────────────────────────────────

const MEMVID_VERSION = 1;
const MIN_TOKEN_LENGTH = 2;
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to",
  "for", "of", "with", "by", "is", "it", "this", "that", "was",
]);

// ── Memvid Backend ──────────────────────────────────────

export class MemvidBackend {
  private entries: Map<string, MemvidEntry> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;

    if (existsSync(filePath)) {
      this.loadFromDisk();
    }
  }

  /**
   * Save a new entry to the memvid store.
   */
  save(params: {
    key: string;
    value: string;
    category?: string;
    tags?: readonly string[];
    confidence?: number;
    metadata?: Record<string, unknown>;
  }): MemvidEntry {
    const now = new Date().toISOString();
    const existing = this.findByKey(params.key);

    const entry: MemvidEntry = {
      id: existing?.id ?? randomUUID(),
      key: params.key,
      value: params.value,
      category: params.category ?? "general",
      tags: params.tags ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      confidence: params.confidence ?? 1.0,
      metadata: params.metadata ?? {},
    };

    this.entries.set(entry.id, entry);
    this.indexEntry(entry);
    this.writeToDisk();

    return entry;
  }

  /**
   * Search entries by query string using the inverted index.
   */
  search(query: string, limit: number = 10): readonly MemvidSearchResult[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const scores = new Map<string, { score: number; matched: string[] }>();

    for (const token of tokens) {
      const entryIds = this.invertedIndex.get(token);
      if (!entryIds) continue;

      for (const entryId of entryIds) {
        const existing = scores.get(entryId) ?? { score: 0, matched: [] };
        existing.score += 1;
        existing.matched.push(token);
        scores.set(entryId, existing);
      }
    }

    const results: MemvidSearchResult[] = [];

    for (const [entryId, scoreData] of scores) {
      const entry = this.entries.get(entryId);
      if (!entry) continue;

      // Normalize score by token count
      const normalizedScore = scoreData.score / tokens.length;

      results.push({
        entry,
        score: normalizedScore,
        matchedTerms: scoreData.matched,
      });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get an entry by ID.
   */
  get(id: string): MemvidEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Find an entry by its key.
   */
  findByKey(key: string): MemvidEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.key === key) return entry;
    }
    return undefined;
  }

  /**
   * Delete an entry by ID.
   */
  delete(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.entries.delete(id);
    this.removeFromIndex(entry);
    this.writeToDisk();
    return true;
  }

  /**
   * List all entries, optionally filtered.
   */
  list(filter?: {
    category?: string;
    tags?: readonly string[];
    minConfidence?: number;
  }): readonly MemvidEntry[] {
    let results = [...this.entries.values()];

    if (filter?.category) {
      results = results.filter((e) => e.category === filter.category);
    }

    if (filter?.tags && filter.tags.length > 0) {
      const filterTags = new Set(filter.tags);
      results = results.filter((e) =>
        e.tags.some((t) => filterTags.has(t)),
      );
    }

    if (filter?.minConfidence !== undefined) {
      results = results.filter((e) => e.confidence >= filter.minConfidence!);
    }

    return results.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /**
   * Export the memvid store to a portable file object.
   */
  export(options?: MemvidExportOptions): MemvidFile {
    let entries = [...this.entries.values()];

    if (options?.filterCategory) {
      entries = entries.filter((e) => e.category === options.filterCategory);
    }
    if (options?.filterTags && options.filterTags.length > 0) {
      const tags = new Set(options.filterTags);
      entries = entries.filter((e) => e.tags.some((t) => tags.has(t)));
    }
    if (options?.minConfidence !== undefined) {
      entries = entries.filter((e) => e.confidence >= options.minConfidence!);
    }

    // Build serializable index
    const index: Record<string, string[]> = {};
    for (const [token, ids] of this.invertedIndex) {
      const filteredIds = [...ids].filter((id) =>
        entries.some((e) => e.id === id),
      );
      if (filteredIds.length > 0) {
        index[token] = filteredIds;
      }
    }

    const now = new Date().toISOString();
    return {
      header: {
        version: MEMVID_VERSION,
        created: now,
        lastModified: now,
        entryCount: entries.length,
        description: options?.description ?? "WOTANN memvid export",
      },
      entries,
      index,
    };
  }

  /**
   * Import entries from a memvid file object.
   * Skips duplicates (by key) and entries with lower confidence.
   */
  import(file: MemvidFile): MemvidImportResult {
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: string[] = [];

    for (const entry of file.entries) {
      try {
        const existing = this.findByKey(entry.key);

        if (existing) {
          if (entry.confidence > existing.confidence) {
            // Higher confidence — replace
            this.entries.set(existing.id, { ...entry, id: existing.id });
            this.indexEntry({ ...entry, id: existing.id });
            imported++;
          } else {
            duplicates++;
          }
        } else {
          this.entries.set(entry.id, entry);
          this.indexEntry(entry);
          imported++;
        }
      } catch (error) {
        errors.push(
          `Failed to import "${entry.key}": ${error instanceof Error ? error.message : "unknown error"}`,
        );
        skipped++;
      }
    }

    if (imported > 0) {
      this.writeToDisk();
    }

    return { imported, skipped, duplicates, errors };
  }

  /**
   * Get total entry count.
   */
  count(): number {
    return this.entries.size;
  }

  /**
   * Get the file path for this store.
   */
  getFilePath(): string {
    return this.filePath;
  }

  // ── Private ────────────────────────────────────────────

  private indexEntry(entry: MemvidEntry): void {
    const text = `${entry.key} ${entry.value} ${entry.tags.join(" ")}`;
    const tokens = tokenize(text);

    for (const token of tokens) {
      const existing = this.invertedIndex.get(token) ?? new Set();
      existing.add(entry.id);
      this.invertedIndex.set(token, existing);
    }
  }

  private removeFromIndex(entry: MemvidEntry): void {
    for (const [token, ids] of this.invertedIndex) {
      ids.delete(entry.id);
      if (ids.size === 0) {
        this.invertedIndex.delete(token);
      }
    }
  }

  private writeToDisk(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const file = this.export();
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }

  private loadFromDisk(): void {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const file = JSON.parse(raw) as MemvidFile;

      if (file.header.version !== MEMVID_VERSION) {
        // Future: handle migration between versions
        return;
      }

      for (const entry of file.entries) {
        this.entries.set(entry.id, entry);
        this.indexEntry(entry);
      }
    } catch {
      // Corrupted file — start fresh
      this.entries.clear();
      this.invertedIndex.clear();
    }
  }
}

// ── Tokenization ────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > MIN_TOKEN_LENGTH && !STOP_WORDS.has(t));
}
