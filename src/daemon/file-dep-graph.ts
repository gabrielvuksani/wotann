/**
 * File Dependency Graph — lightweight import/require scanner.
 * Answers "what files are affected if I change X?" using adjacency lists
 * built from static import analysis.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname, resolve, extname } from "node:path";

// ── Types ────────────────────────────────────────────────────

export interface FileDependency {
  readonly source: string; // importing file
  readonly target: string; // imported file
  readonly type: "import" | "require" | "dynamic-import";
}

export interface DependencyGraph {
  readonly files: readonly string[];
  readonly edges: readonly FileDependency[];
  readonly fileCount: number;
  readonly edgeCount: number;
}

export interface ImpactAnalysis {
  readonly changedFile: string;
  readonly directDependents: readonly string[];
  readonly transitiveDependents: readonly string[];
  readonly totalImpact: number;
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".jsx"];

// Patterns that capture the specifier from import/require statements
const IMPORT_RE = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const REQUIRE_RE = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

// ── Helpers ──────────────────────────────────────────────────

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/** Resolve a relative import specifier to an absolute path. */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  knownFiles: ReadonlySet<string>,
): string | null {
  if (!isRelative(specifier)) {
    return null; // skip bare/package specifiers
  }

  const base = resolve(dirname(fromFile), specifier);

  // Try exact match first, then with known extensions
  if (knownFiles.has(base)) {
    return base;
  }

  for (const ext of DEFAULT_EXTENSIONS) {
    const withExt = base + ext;
    if (knownFiles.has(withExt)) {
      return withExt;
    }
  }

  // Try /index with extensions
  for (const ext of DEFAULT_EXTENSIONS) {
    const indexPath = join(base, `index${ext}`);
    if (knownFiles.has(indexPath)) {
      return indexPath;
    }
  }

  return null;
}

/** Recursively collect files from a directory matching given extensions. */
async function collectFiles(
  dir: string,
  extensions: ReadonlySet<string>,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    const promises: Promise<void>[] = [];

    for (const entry of entries) {
      const full = join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
          continue;
        }
        promises.push(walk(full));
      } else if (entry.isFile() && extensions.has(extname(entry.name))) {
        results.push(full);
      }
    }

    await Promise.all(promises);
  }

  await walk(dir);
  return results;
}

/** Extract import specifiers from file content. */
function extractSpecifiers(
  content: string,
): readonly { readonly specifier: string; readonly type: FileDependency["type"] }[] {
  const results: { readonly specifier: string; readonly type: FileDependency["type"] }[] = [];

  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      results.push({ specifier, type: "import" });
    }
  }

  for (const match of content.matchAll(REQUIRE_RE)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      results.push({ specifier, type: "require" });
    }
  }

  for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      results.push({ specifier, type: "dynamic-import" });
    }
  }

  return results;
}

// ── Graph Class ──────────────────────────────────────────────

export class FileDependencyGraph {
  /** source -> [targets] (what does this file import?) */
  private readonly forward: Map<string, Set<string>> = new Map();
  /** target -> [sources] (who imports this file?) */
  private readonly reverse: Map<string, Set<string>> = new Map();
  private readonly allEdges: FileDependency[] = [];
  private readonly allFiles: Set<string> = new Set();

  /** Scan a directory, parse imports, and build the graph. */
  async buildFromDirectory(
    dir: string,
    extensions?: readonly string[],
  ): Promise<DependencyGraph> {
    const extSet = new Set(extensions ?? DEFAULT_EXTENSIONS);
    const files = await collectFiles(dir, extSet);
    const fileSet = new Set(files);

    // Reset state for a fresh build
    this.forward.clear();
    this.reverse.clear();
    this.allEdges.length = 0;
    this.allFiles.clear();

    for (const f of files) {
      this.allFiles.add(f);
    }

    // Read all files in parallel, then extract deps
    const fileContents = await Promise.all(
      files.map(async (filePath) => {
        const content = await readFile(filePath, "utf-8");
        return { filePath, content } as const;
      }),
    );

    for (const { filePath, content } of fileContents) {
      const specifiers = extractSpecifiers(content);
      for (const { specifier, type } of specifiers) {
        const resolved = resolveSpecifier(filePath, specifier, fileSet);
        if (resolved !== null) {
          this.addEdge(filePath, resolved, type);
        }
      }
    }

    return {
      files: [...this.allFiles],
      edges: [...this.allEdges],
      fileCount: this.allFiles.size,
      edgeCount: this.allEdges.length,
    };
  }

  /** Get files that directly import a given file. */
  getDirectDependents(filePath: string): readonly string[] {
    const dependents = this.reverse.get(filePath);
    return dependents ? [...dependents] : [];
  }

  /** Get the full transitive closure of dependents via BFS. */
  getTransitiveDependents(filePath: string): readonly string[] {
    const visited = new Set<string>();
    const queue: string[] = [...this.getDirectDependents(filePath)];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const nextDeps = this.reverse.get(current);
      if (nextDeps) {
        for (const dep of nextDeps) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }
    }

    return [...visited];
  }

  /** Analyze the impact of changing a given file. */
  analyzeImpact(filePath: string): ImpactAnalysis {
    const directDependents = this.getDirectDependents(filePath);
    const transitiveDependents = this.getTransitiveDependents(filePath);

    return {
      changedFile: filePath,
      directDependents,
      transitiveDependents,
      totalImpact: transitiveDependents.length,
    };
  }

  /** Get the most-imported files (hotspots), sorted descending by import count. */
  getHotspots(limit?: number): readonly { readonly file: string; readonly importedBy: number }[] {
    const entries: { readonly file: string; readonly importedBy: number }[] = [];

    for (const [file, importers] of this.reverse) {
      entries.push({ file, importedBy: importers.size });
    }

    entries.sort((a, b) => b.importedBy - a.importedBy);
    return limit !== undefined ? entries.slice(0, limit) : entries;
  }

  // ── Private ────────────────────────────────────────────────

  private addEdge(
    source: string,
    target: string,
    type: FileDependency["type"],
  ): void {
    // Forward map
    const fwd = this.forward.get(source) ?? new Set();
    fwd.add(target);
    this.forward.set(source, fwd);

    // Reverse map
    const rev = this.reverse.get(target) ?? new Set();
    rev.add(source);
    this.reverse.set(target, rev);

    this.allEdges.push({ source, target, type });
  }
}
