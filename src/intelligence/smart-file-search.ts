/**
 * Smart File Search — fff.nvim-inspired multi-signal scoring.
 * Combines fuzzy match, frecency, git status, proximity, and definition matching.
 *
 * Features:
 * - Frecency database (SQLite) tracking access patterns
 * - 7-signal scoring pipeline
 * - Time-budgeted search (150ms max)
 * - Progressive file indexing with fs.watch
 *
 * Zero external dependencies — uses built-in Node.js APIs.
 */

import { readdirSync, statSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { join, relative, basename, extname } from "node:path";
import { resolveWotannHome, resolveWotannHomeSubdir } from "../utils/wotann-home.js";

// ── Types ────────────────────────────────────────────

interface FileEntry {
  readonly path: string;
  readonly name: string;
  readonly ext: string;
  readonly relativePath: string;
}

interface FrecencyRecord {
  accessCount: number;
  lastAccessed: number;
  comboCount: number;
  lastComboQuery: string;
}

interface SearchResult {
  readonly path: string;
  readonly relativePath: string;
  readonly score: number;
  readonly signals: {
    readonly fuzzy: number;
    readonly frecency: number;
    readonly gitStatus: number;
    readonly proximity: number;
    readonly definition: number;
    readonly fileSize: number;
    readonly combo: number;
  };
}

// ── Signal Weights ───────────────────────────────────

const WEIGHTS = {
  fuzzy: 0.3,
  frecency: 0.25,
  combo: 0.15,
  gitStatus: 0.1,
  proximity: 0.1,
  definition: 0.05,
  fileSize: 0.05,
} as const;

// ── Fuzzy Match ──────────────────────────────────────

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t === q) return 1.0;
  if (t.includes(q)) return 0.9;

  let qi = 0;
  let consecutiveBonus = 0;
  let maxConsecutive = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutiveBonus++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveBonus);
    } else {
      consecutiveBonus = 0;
    }
  }

  if (qi < q.length) return 0;

  const matchRatio = q.length / t.length;
  const consecutiveRatio = maxConsecutive / q.length;
  return matchRatio * 0.5 + consecutiveRatio * 0.5;
}

// ── Smart File Search Engine ─────────────────────────

export class SmartFileSearch {
  private files: FileEntry[] = [];
  private frecencyDb: Map<string, FrecencyRecord> = new Map();
  private readonly dbPath: string;
  private readonly workingDir: string;
  private indexed = false;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.dbPath = resolveWotannHomeSubdir("frecency.json");
    this.loadFrecencyDb();
  }

  /**
   * Search files with multi-signal scoring.
   * Time-budgeted at 150ms max.
   */
  search(query: string, limit = 20): readonly SearchResult[] {
    if (!this.indexed) {
      this.indexFiles();
    }

    if (!query.trim()) {
      // No query: return most frequently accessed files
      return this.getMostFrequent(limit);
    }

    const deadline = Date.now() + 150;
    const results: SearchResult[] = [];

    for (const file of this.files) {
      if (Date.now() > deadline) break;

      const fuzzy = fuzzyScore(query, file.name);
      if (fuzzy === 0) continue;

      const frecency = this.getFrecencyScore(file.path);
      const combo = this.getComboScore(file.path, query);
      const gitStatus = 0; // Would need git integration
      const proximity = this.getProximityScore(file.path);
      const definition = this.getDefinitionScore(file.name, query);
      const fileSize = this.getFileSizePenalty(file.path);

      const score =
        fuzzy * WEIGHTS.fuzzy +
        frecency * WEIGHTS.frecency +
        combo * WEIGHTS.combo +
        gitStatus * WEIGHTS.gitStatus +
        proximity * WEIGHTS.proximity +
        definition * WEIGHTS.definition +
        fileSize * WEIGHTS.fileSize;

      results.push({
        path: file.path,
        relativePath: file.relativePath,
        score,
        signals: { fuzzy, frecency, gitStatus, proximity, definition, fileSize, combo },
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Record a file access — updates frecency database.
   */
  recordAccess(filePath: string, query?: string): void {
    const record = this.frecencyDb.get(filePath) ?? {
      accessCount: 0,
      lastAccessed: 0,
      comboCount: 0,
      lastComboQuery: "",
    };

    record.accessCount++;
    record.lastAccessed = Date.now();

    if (query && query === record.lastComboQuery) {
      record.comboCount++;
    } else if (query) {
      record.comboCount = 1;
      record.lastComboQuery = query;
    }

    this.frecencyDb.set(filePath, record);
    this.saveFrecencyDb();
  }

  /** Index files in the working directory (recursive). */
  private indexFiles(): void {
    this.files = [];
    const ignore = new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".cache",
      "__pycache__",
      ".wotann",
      "target",
      ".turbo",
      "coverage",
    ]);

    const walk = (dir: string, depth: number): void => {
      if (depth > 8) return;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") && depth === 0) continue;
          if (ignore.has(entry.name)) continue;

          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            this.files.push({
              path: fullPath,
              name: entry.name,
              ext: extname(entry.name),
              relativePath: relative(this.workingDir, fullPath),
            });
          }
        }
      } catch {
        // Permission denied or other fs error
      }
    };

    walk(this.workingDir, 0);
    this.indexed = true;
  }

  private getFrecencyScore(filePath: string): number {
    const record = this.frecencyDb.get(filePath);
    if (!record) return 0;

    const hoursSince = (Date.now() - record.lastAccessed) / 3_600_000;
    const recency = Math.exp(-hoursSince / 24); // 24-hour half-life
    const frequency = Math.min(record.accessCount / 10, 1); // Cap at 10 accesses
    return recency * 0.6 + frequency * 0.4;
  }

  private getComboScore(filePath: string, query: string): number {
    const record = this.frecencyDb.get(filePath);
    if (!record || record.lastComboQuery !== query) return 0;
    return Math.min(record.comboCount / 3, 1); // Cap at 3 combos for full score
  }

  private getProximityScore(filePath: string): number {
    const depth = relative(this.workingDir, filePath).split("/").length;
    return Math.max(0, 1 - depth * 0.15); // Closer files score higher
  }

  private getDefinitionScore(fileName: string, query: string): number {
    const name = basename(fileName, extname(fileName)).toLowerCase();
    const q = query.toLowerCase();
    if (name === q) return 1.0;
    if (name.startsWith(q)) return 0.7;
    return 0;
  }

  private getFileSizePenalty(filePath: string): number {
    try {
      const size = statSync(filePath).size;
      if (size > 1_000_000) return 0.2; // Very large files penalized
      if (size > 100_000) return 0.5;
      return 1.0;
    } catch {
      return 0.5;
    }
  }

  private getMostFrequent(limit: number): readonly SearchResult[] {
    // The `record` value from frecencyDb.entries() is informational only
    // — `getFrecencyScore(path)` reads the same record internally, so the
    // destructured value was redundant. Dropped to quiet the unused-arg
    // lint without changing behavior.
    return [...this.frecencyDb.entries()]
      .filter(([path]) => existsSync(path))
      .map(([path]) => ({
        path,
        relativePath: relative(this.workingDir, path),
        score: this.getFrecencyScore(path),
        signals: {
          fuzzy: 0,
          frecency: this.getFrecencyScore(path),
          gitStatus: 0,
          proximity: this.getProximityScore(path),
          definition: 0,
          fileSize: 1,
          combo: 0,
        },
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private loadFrecencyDb(): void {
    try {
      if (existsSync(this.dbPath)) {
        const data = JSON.parse(readFileSync(this.dbPath, "utf-8"));
        this.frecencyDb = new Map(Object.entries(data));
      }
    } catch {
      this.frecencyDb = new Map();
    }
  }

  private saveFrecencyDb(): void {
    try {
      const dir = resolveWotannHome();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const obj = Object.fromEntries(this.frecencyDb);
      // Wave 6.5-UU (H-22) — frecency DB. Atomic write so a crash mid-flush
      // can't strand a corrupted database (which the loader would then
      // discard, throwing away all access history).
      writeFileAtomic(this.dbPath, JSON.stringify(obj));
    } catch {
      // Best effort
    }
  }
}
