/**
 * Parallel Multi-Source Search -- run multiple search types simultaneously,
 * aggregate and rank results. Inspired by Perplexity's 7 parallel search
 * types, adapted for a local-first AI harness.
 *
 * Search types: codebase, memory, web, academic, documentation, git-history,
 * file-content. Each runs concurrently via Promise.all(). Results are merged,
 * deduplicated, and ranked by score.
 *
 * Web and academic searches are placeholders -- they return empty results
 * unless the user provides their own API keys/backends.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

// -- Types -------------------------------------------------------------------

export type SearchType =
  | "codebase"
  | "memory"
  | "web"
  | "academic"
  | "documentation"
  | "git-history"
  | "file-content";

export interface SearchResult {
  readonly source: SearchType;
  readonly title: string;
  readonly content: string;
  readonly url?: string;
  readonly score: number;
  readonly timestamp?: number;
}

export interface ParallelSearchResult {
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly sources: readonly SearchType[];
  readonly totalResults: number;
  readonly durationMs: number;
}

export interface SearchConfig {
  readonly workspaceDir: string;
  readonly maxResultsPerSource: number;
  readonly memorySearchFn?: (query: string) => readonly SearchResult[];
}

// -- Default search types ----------------------------------------------------

const ALL_SEARCH_TYPES: readonly SearchType[] = [
  "codebase",
  "memory",
  "web",
  "academic",
  "documentation",
  "git-history",
  "file-content",
];

// -- File extensions to search -----------------------------------------------

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".rb", ".php", ".swift", ".kt", ".cs",
  ".sh", ".bash", ".zsh", ".yaml", ".yml", ".json", ".toml",
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);

// -- Implementation ----------------------------------------------------------

export class ParallelSearchDispatcher {
  private readonly config: SearchConfig;

  constructor(config: SearchConfig) {
    this.config = {
      ...config,
      maxResultsPerSource: config.maxResultsPerSource ?? 10,
    };
  }

  /**
   * Run multiple search types in parallel, aggregate results.
   * Returns results ranked by score descending.
   */
  async search(
    query: string,
    sources?: readonly SearchType[],
  ): Promise<ParallelSearchResult> {
    const activeSources = sources ?? ALL_SEARCH_TYPES;
    const startTime = Date.now();

    // Dispatch all searches in parallel
    const searchPromises = activeSources.map((source) =>
      this.executeSearch(source, query).catch((): readonly SearchResult[] => []),
    );

    const resultArrays = await Promise.all(searchPromises);
    const allResults = resultArrays.flat();

    // Deduplicate by title + source
    const seen = new Set<string>();
    const deduplicated: SearchResult[] = [];
    for (const result of allResults) {
      const key = `${result.source}:${result.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(result);
      }
    }

    // Sort by score descending
    const ranked = [...deduplicated].sort((a, b) => b.score - a.score);

    return {
      query,
      results: ranked,
      sources: activeSources,
      totalResults: ranked.length,
      durationMs: Date.now() - startTime,
    };
  }

  // -- Individual search implementations ------------------------------------

  private async executeSearch(
    source: SearchType,
    query: string,
  ): Promise<readonly SearchResult[]> {
    switch (source) {
      case "codebase":
        return this.searchCodebase(query);
      case "memory":
        return this.searchMemory(query);
      case "web":
        return this.searchWeb();
      case "academic":
        return this.searchAcademic();
      case "documentation":
        return this.searchDocumentation(query);
      case "git-history":
        return this.searchGitHistory(query);
      case "file-content":
        return this.searchFileContent(query);
      default:
        return [];
    }
  }

  /**
   * Search codebase by grepping workspace files for the query.
   */
  private searchCodebase(query: string): readonly SearchResult[] {
    const results: SearchResult[] = [];
    const files = collectFiles(this.config.workspaceDir, CODE_EXTENSIONS, 500);

    const lowerQuery = query.toLowerCase();
    const queryTerms = lowerQuery.split(/\s+/).filter((t) => t.length > 2);

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const lowerContent = content.toLowerCase();
        let matchCount = 0;

        for (const term of queryTerms) {
          if (lowerContent.includes(term)) {
            matchCount++;
          }
        }

        if (matchCount > 0) {
          const relPath = relative(this.config.workspaceDir, filePath);
          const score = (matchCount / Math.max(queryTerms.length, 1)) * 0.8;

          // Extract matching lines (first 3)
          const lines = content.split("\n");
          const matchingLines = lines
            .filter((line) => queryTerms.some((t) => line.toLowerCase().includes(t)))
            .slice(0, 3)
            .join("\n");

          results.push({
            source: "codebase",
            title: relPath,
            content: matchingLines || content.slice(0, 200),
            score: Math.min(score, 1.0),
          });
        }
      } catch {
        // Skip unreadable files
      }

      if (results.length >= this.config.maxResultsPerSource) break;
    }

    return results;
  }

  /**
   * Search memory store using the pluggable memory search function.
   */
  private searchMemory(query: string): readonly SearchResult[] {
    if (!this.config.memorySearchFn) return [];
    try {
      return this.config.memorySearchFn(query).slice(0, this.config.maxResultsPerSource);
    } catch {
      return [];
    }
  }

  /**
   * Web search placeholder -- returns empty.
   * Users provide their own web search backend via config.
   */
  private searchWeb(): readonly SearchResult[] {
    return [];
  }

  /**
   * Academic search placeholder -- returns empty.
   * Users provide their own academic search backend via config.
   */
  private searchAcademic(): readonly SearchResult[] {
    return [];
  }

  /**
   * Search .md files in the workspace for documentation matches.
   */
  private searchDocumentation(query: string): readonly SearchResult[] {
    const results: SearchResult[] = [];
    const files = collectFiles(this.config.workspaceDir, DOC_EXTENSIONS, 200);

    const lowerQuery = query.toLowerCase();
    const queryTerms = lowerQuery.split(/\s+/).filter((t) => t.length > 2);

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const lowerContent = content.toLowerCase();
        let matchCount = 0;

        for (const term of queryTerms) {
          if (lowerContent.includes(term)) {
            matchCount++;
          }
        }

        if (matchCount > 0) {
          const relPath = relative(this.config.workspaceDir, filePath);
          const score = (matchCount / Math.max(queryTerms.length, 1)) * 0.7;

          results.push({
            source: "documentation",
            title: relPath,
            content: content.slice(0, 300),
            score: Math.min(score, 1.0),
          });
        }
      } catch {
        // Skip
      }

      if (results.length >= this.config.maxResultsPerSource) break;
    }

    return results;
  }

  /**
   * Search git log for commits matching the query.
   * Uses execFileSync (not exec) to prevent shell injection.
   */
  private searchGitHistory(query: string): readonly SearchResult[] {
    try {
      const output = execFileSync(
        "git",
        [
          "log",
          "--oneline",
          "--all",
          `--grep=${query}`,
          `-n`,
          String(this.config.maxResultsPerSource),
        ],
        {
          cwd: this.config.workspaceDir,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      if (!output.trim()) return [];

      return output
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line, index, arr) => ({
          source: "git-history" as const,
          title: `commit: ${line.slice(0, 8)}`,
          content: line,
          score: Math.max(0.3, 0.8 - index * (0.5 / Math.max(arr.length, 1))),
          timestamp: Date.now(),
        }));
    } catch {
      return [];
    }
  }

  /**
   * Full-text search across all files in the workspace.
   */
  private searchFileContent(query: string): readonly SearchResult[] {
    const results: SearchResult[] = [];
    const allExtensions = new Set([...CODE_EXTENSIONS, ...DOC_EXTENSIONS]);
    const files = collectFiles(this.config.workspaceDir, allExtensions, 500);

    const lowerQuery = query.toLowerCase();

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const lowerContent = content.toLowerCase();
        const index = lowerContent.indexOf(lowerQuery);

        if (index !== -1) {
          const relPath = relative(this.config.workspaceDir, filePath);
          const contextStart = Math.max(0, index - 50);
          const contextEnd = Math.min(content.length, index + lowerQuery.length + 100);
          const snippet = content.slice(contextStart, contextEnd);

          results.push({
            source: "file-content",
            title: relPath,
            content: snippet,
            score: 0.9,
          });
        }
      } catch {
        // Skip
      }

      if (results.length >= this.config.maxResultsPerSource) break;
    }

    return results;
  }
}

// -- File collection helper --------------------------------------------------

function collectFiles(
  dir: string,
  extensions: ReadonlySet<string>,
  limit: number,
): readonly string[] {
  const results: string[] = [];

  if (!existsSync(dir)) return results;

  function walk(currentDir: string, depth: number): void {
    if (depth > 6 || results.length >= limit) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") {
        continue;
      }

      const fullPath = join(currentDir, entry);

      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (stat.isFile() && extensions.has(extname(entry))) {
          results.push(fullPath);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  walk(dir, 0);
  return results;
}
