/**
 * Context Tree as Markdown Files — ByteRover-inspired persistent knowledge.
 *
 * Stores project knowledge in .wotann/context-tree/ as markdown files.
 * Hierarchical: resources/, user/, agent/ directories.
 * Git-friendly, human-readable, editable.
 * Target: 96% memory accuracy (ByteRover benchmark).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────

export interface ContextEntry {
  readonly path: string;
  readonly category: "resources" | "user" | "agent";
  readonly title: string;
  readonly content: string;
  readonly l0Summary: string;    // ~10 tokens
  readonly l1Overview: string;   // ~200 tokens
  readonly updatedAt: number;
  readonly accessCount: number;
}

export interface ContextTreeStats {
  readonly totalEntries: number;
  readonly categories: Readonly<Record<string, number>>;
  readonly totalTokensL0: number;
  readonly totalTokensL1: number;
  readonly totalTokensFull: number;
}

// ── Context Tree Manager ─────────────────────────────────

export class ContextTreeManager {
  private readonly baseDir: string;
  private readonly entries: Map<string, ContextEntry> = new Map();

  constructor(wotannDir: string) {
    this.baseDir = join(wotannDir, "context-tree");
    this.ensureDirectories();
    this.loadFromDisk();
  }

  /**
   * Add or update a context entry.
   */
  upsert(
    category: ContextEntry["category"],
    title: string,
    content: string,
  ): ContextEntry {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const filePath = join(category, `${slug}.md`);

    const entry: ContextEntry = {
      path: filePath,
      category,
      title,
      content,
      l0Summary: this.generateL0(content),
      l1Overview: this.generateL1(content),
      updatedAt: Date.now(),
      accessCount: (this.entries.get(filePath)?.accessCount ?? 0) + 1,
    };

    this.entries.set(filePath, entry);
    this.writeToDisk(entry);
    return entry;
  }

  /**
   * Search the context tree by query.
   */
  search(query: string, maxResults: number = 5): readonly ContextEntry[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    if (queryTerms.length === 0) return [];

    const scored: { entry: ContextEntry; score: number }[] = [];

    for (const entry of this.entries.values()) {
      const searchText = `${entry.title} ${entry.l0Summary} ${entry.content}`.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (searchText.includes(term)) score++;
      }
      if (score > 0) {
        scored.push({ entry, score: score / queryTerms.length });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((s) => s.entry);
  }

  /**
   * Get all entries at a specific tier for context injection.
   */
  getAtTier(tier: 0 | 1 | 2, maxTokens: number): readonly string[] {
    const results: string[] = [];
    let totalTokens = 0;

    const sorted = [...this.entries.values()].sort(
      (a, b) => b.accessCount - a.accessCount,
    );

    for (const entry of sorted) {
      const text = tier === 0 ? entry.l0Summary : tier === 1 ? entry.l1Overview : entry.content;
      const tokens = Math.ceil(text.length / 4);
      if (totalTokens + tokens > maxTokens) break;
      results.push(`[${entry.title}] ${text}`);
      totalTokens += tokens;
    }

    return results;
  }

  /**
   * Get tree statistics.
   */
  getStats(): ContextTreeStats {
    const categories: Record<string, number> = {};
    let totalL0 = 0;
    let totalL1 = 0;
    let totalFull = 0;

    for (const entry of this.entries.values()) {
      categories[entry.category] = (categories[entry.category] ?? 0) + 1;
      totalL0 += Math.ceil(entry.l0Summary.length / 4);
      totalL1 += Math.ceil(entry.l1Overview.length / 4);
      totalFull += Math.ceil(entry.content.length / 4);
    }

    return {
      totalEntries: this.entries.size,
      categories,
      totalTokensL0: totalL0,
      totalTokensL1: totalL1,
      totalTokensFull: totalFull,
    };
  }

  /**
   * List all entries.
   */
  list(): readonly ContextEntry[] {
    return [...this.entries.values()];
  }

  // ── Private ────────────────────────────────────────────

  private generateL0(content: string): string {
    // Extract first meaningful sentence
    const lines = content.split("\n").filter((l) => l.trim().length > 10);
    return (lines[0] ?? content.slice(0, 100)).trim().slice(0, 100);
  }

  private generateL1(content: string): string {
    // Extract headers and first sentences after them
    const lines = content.split("\n");
    const overview: string[] = [];
    let tokens = 0;

    for (const line of lines) {
      if (tokens > 200) break;
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed.length > 20) {
        overview.push(trimmed);
        tokens += Math.ceil(trimmed.length / 4);
      }
    }

    return overview.join("\n").slice(0, 800);
  }

  private ensureDirectories(): void {
    for (const dir of ["resources", "user", "agent"]) {
      const fullPath = join(this.baseDir, dir);
      if (!existsSync(fullPath)) {
        mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  private writeToDisk(entry: ContextEntry): void {
    const fullPath = join(this.baseDir, entry.path);
    const frontmatter = [
      "---",
      `title: "${entry.title}"`,
      `category: ${entry.category}`,
      `updated: ${new Date(entry.updatedAt).toISOString()}`,
      `access_count: ${entry.accessCount}`,
      `l0: "${entry.l0Summary.replace(/"/g, '\\"')}"`,
      "---",
      "",
    ].join("\n");

    writeFileSync(fullPath, frontmatter + entry.content, "utf-8");
  }

  private loadFromDisk(): void {
    for (const category of ["resources", "user", "agent"] as const) {
      const dirPath = join(this.baseDir, category);
      if (!existsSync(dirPath)) continue;

      for (const file of readdirSync(dirPath)) {
        if (!file.endsWith(".md")) continue;
        const filePath = join(category, file);
        const fullPath = join(this.baseDir, filePath);

        try {
          const raw = readFileSync(fullPath, "utf-8");
          const content = raw.replace(/^---[\s\S]*?---\n*/m, ""); // Strip frontmatter
          const title = file.replace(/\.md$/, "").replace(/-/g, " ");

          this.entries.set(filePath, {
            path: filePath,
            category,
            title,
            content,
            l0Summary: this.generateL0(content),
            l1Overview: this.generateL1(content),
            updatedAt: Date.now(),
            accessCount: 0,
          });
        } catch {
          // Skip malformed files
        }
      }
    }
  }
}
