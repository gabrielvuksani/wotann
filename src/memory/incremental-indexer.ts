/**
 * Incremental indexer — Phase 6C.
 *
 * Current memory indexing re-reads and re-chunks every file on every
 * start. For a 500-file project: ~10-30 seconds of redundant work
 * every session. The fix: SHA the file, compare to a persisted
 * per-file SHA, skip if unchanged. First-time indexing stays the
 * same; subsequent runs only re-index what actually changed.
 *
 * This module ships:
 *   - IncrementalIndexer — tracks file SHAs against a JSON cache
 *   - computeFileSha(path)       — sha256 of file contents
 *   - shouldReindex(path, sha)   — returns true if changed OR unseen
 *   - markIndexed(path, sha, chunks) — records a successful index run
 *   - getStaleFiles(paths)       — batch: returns only files that changed
 *   - prune(paths)               — removes entries for files that no
 *                                  longer exist
 *
 * Cache format: JSON dict at ~/.wotann/index-cache.json (or override
 * path). Safe to delete — next run will re-index everything.
 *
 * Pure I/O module. No LLM calls. No coupling to specific chunkers.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// ── Types ──────────────────────────────────────────────

export interface FileIndexEntry {
  /** Path relative to the project root (or absolute — caller choice). */
  readonly path: string;
  /** sha256 hex digest of file content at last index. */
  readonly sha: string;
  /** Unix ms when indexed. */
  readonly indexedAt: number;
  /** How many chunks/embeddings produced. For telemetry + eviction. */
  readonly chunksCount: number;
  /** Optional caller-provided metadata. */
  readonly metadata?: Record<string, unknown>;
}

export interface IndexerOptions {
  /** Path to the JSON cache file. Default ~/.wotann/index-cache.json. */
  readonly cachePath?: string;
  /** Treat path comparisons as case-insensitive (for Windows/macOS FS). */
  readonly caseInsensitive?: boolean;
  /** Inject fs readers for testing. Default node:fs/promises. */
  readonly io?: {
    readonly readFile: (path: string) => Promise<string>;
    readonly writeFile: (path: string, content: string) => Promise<void>;
    readonly stat: (path: string) => Promise<{ size: number }>;
  };
}

// ── SHA helpers ──────────────────────────────────────

export async function computeFileSha(path: string): Promise<string> {
  const content = await readFile(resolve(path));
  const hasher = createHash("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export function computeContentSha(content: string | Buffer): string {
  const hasher = createHash("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

// ── Indexer ──────────────────────────────────────────

export class IncrementalIndexer {
  private cache: Map<string, FileIndexEntry> = new Map();
  private loaded = false;
  private readonly cachePath: string;
  private readonly caseInsensitive: boolean;

  constructor(options: IndexerOptions = {}) {
    const home = process.env["HOME"] ?? process.cwd();
    this.cachePath = resolve(options.cachePath ?? `${home}/.wotann/index-cache.json`);
    this.caseInsensitive = options.caseInsensitive ?? false;
  }

  /** Load cache from disk. Safe to call multiple times (idempotent). */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.cachePath, "utf-8");
      const parsed = JSON.parse(raw) as { entries?: FileIndexEntry[] };
      if (parsed.entries) {
        for (const entry of parsed.entries) {
          this.cache.set(this.keyOf(entry.path), entry);
        }
      }
    } catch {
      // Missing or corrupt — start fresh
    }
    this.loaded = true;
  }

  /** Persist cache to disk atomically (write + rename). */
  async save(): Promise<void> {
    const entries = [...this.cache.values()];
    const payload = JSON.stringify({ entries, version: 1, savedAt: Date.now() }, null, 2);
    await mkdir(dirname(this.cachePath), { recursive: true });
    const tmp = `${this.cachePath}.tmp-${Date.now()}`;
    await writeFile(tmp, payload, "utf-8");
    const { rename } = await import("node:fs/promises");
    await rename(tmp, this.cachePath);
  }

  /** Clear all cache entries (in memory). Call save() to persist. */
  clear(): void {
    this.cache.clear();
  }

  /** Return current entry for a path, or undefined if not indexed. */
  getEntry(path: string): FileIndexEntry | undefined {
    return this.cache.get(this.keyOf(path));
  }

  /** All indexed paths (sorted). */
  listPaths(): readonly string[] {
    return [...this.cache.keys()].sort();
  }

  /** Number of files currently tracked. */
  size(): number {
    return this.cache.size;
  }

  /**
   * Should this file be re-indexed? True when:
   *   - never indexed, OR
   *   - current sha differs from cached sha
   */
  shouldReindex(path: string, currentSha: string): boolean {
    const entry = this.getEntry(path);
    if (!entry) return true;
    return entry.sha !== currentSha;
  }

  /** Shortcut: compute current sha from disk and compare. */
  async shouldReindexFromDisk(path: string): Promise<boolean> {
    const currentSha = await computeFileSha(path);
    return this.shouldReindex(path, currentSha);
  }

  /**
   * Batch helper: given a list of paths, return only those that need
   * re-indexing. SHA is computed from disk for each.
   */
  async getStaleFiles(paths: readonly string[]): Promise<readonly string[]> {
    const stale: string[] = [];
    for (const path of paths) {
      try {
        if (await this.shouldReindexFromDisk(path)) stale.push(path);
      } catch {
        // Skip unreadable files
      }
    }
    return stale;
  }

  /**
   * Record that a file has been indexed. Caller passes the SHA used +
   * chunk count for telemetry.
   */
  markIndexed(
    path: string,
    sha: string,
    chunksCount: number,
    metadata?: Record<string, unknown>,
  ): void {
    const entry: FileIndexEntry = {
      path,
      sha,
      indexedAt: Date.now(),
      chunksCount,
      ...(metadata !== undefined ? { metadata } : {}),
    };
    this.cache.set(this.keyOf(path), entry);
  }

  /** Remove an entry (e.g. file was deleted). */
  forget(path: string): boolean {
    return this.cache.delete(this.keyOf(path));
  }

  /**
   * Prune entries for files that no longer exist. Returns count
   * removed. Safe to run periodically — doesn't affect valid entries.
   */
  async prune(existingPaths: readonly string[]): Promise<number> {
    const existing = new Set(existingPaths.map((p) => this.keyOf(p)));
    let removed = 0;
    for (const key of [...this.cache.keys()]) {
      if (!existing.has(key)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Stats: how much work would re-indexing from scratch have to redo
   * vs. incremental? Returns ms saved estimate if avgIndexMsPerFile is
   * supplied.
   */
  stats(avgIndexMsPerFile: number = 100): {
    readonly tracked: number;
    readonly totalChunks: number;
    readonly estimatedSavedMs: number;
  } {
    let totalChunks = 0;
    for (const entry of this.cache.values()) totalChunks += entry.chunksCount;
    return {
      tracked: this.cache.size,
      totalChunks,
      estimatedSavedMs: this.cache.size * avgIndexMsPerFile,
    };
  }

  private keyOf(path: string): string {
    const abs = resolve(path);
    return this.caseInsensitive ? abs.toLowerCase() : abs;
  }
}

// ── Free-function convenience ─────────────────────────

/**
 * Open an indexer, load its cache, run a callback, and save. Handy
 * for one-shot batch jobs where the caller doesn't want to manage
 * load/save explicitly.
 */
export async function withIndexer<T>(
  options: IndexerOptions,
  fn: (indexer: IncrementalIndexer) => Promise<T>,
): Promise<T> {
  const indexer = new IncrementalIndexer(options);
  await indexer.load();
  try {
    return await fn(indexer);
  } finally {
    await indexer.save().catch(() => undefined);
  }
}

export async function statFile(path: string): Promise<{ size: number; mtimeMs: number }> {
  const info = await stat(path);
  return { size: info.size, mtimeMs: info.mtimeMs };
}
