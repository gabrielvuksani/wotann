/**
 * QMD-style precision retrieval for local project context.
 *
 * When the native qmd runtime is not available, this falls back to lightweight
 * paragraph/chunk scoring so the runtime still injects only the most relevant
 * snippets instead of full files.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

export interface ContextChunk {
  readonly id: string;
  readonly source: string;
  readonly content: string;
  readonly score: number;
}

export type QMDMode = "fallback" | "disabled";

const SEARCHABLE_EXTENSIONS = new Set([
  ".md", ".txt", ".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml",
  ".py", ".go", ".rs", ".java", ".cs", ".sh",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".wotann",
  "node_modules",
  "dist",
  "build",
  ".next",
]);

export class QMDContextEngine {
  private projectDir: string | null = null;
  private mode: QMDMode = "disabled";

  async initialize(projectDir: string): Promise<void> {
    this.projectDir = resolve(projectDir);
    this.mode = existsSync(this.projectDir) ? "fallback" : "disabled";
  }

  getMode(): QMDMode {
    return this.mode;
  }

  async getRelevantContext(query: string, limit: number = 10): Promise<readonly ContextChunk[]> {
    if (this.mode === "disabled" || !this.projectDir) return [];

    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const results: ContextChunk[] = [];
    for (const filePath of walkFiles(this.projectDir)) {
      const ext = extname(filePath);
      if (!SEARCHABLE_EXTENSIONS.has(ext)) continue;

      const raw = safeRead(filePath);
      if (!raw) continue;

      const chunks = splitIntoChunks(raw, ext);
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        if (!chunk) continue;
        const score = scoreChunk(chunk, terms);
        if (score <= 0) continue;

        results.push({
          id: `${filePath}:${index}`,
          source: relative(this.projectDir, filePath) || filePath,
          content: chunk,
          score,
        });
      }
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

export function formatQMDContext(chunks: readonly ContextChunk[]): string {
  if (chunks.length === 0) return "";

  return [
    "## QMD Precision Context",
    "Relevant project snippets selected for this query:",
    "",
    ...chunks.flatMap((chunk, index) => [
      `### Match ${index + 1}: ${chunk.source}`,
      chunk.content.trim(),
      "",
    ]),
  ].join("\n").trim();
}

function walkFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];

  const results: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    const stats = statSync(current);

    if (!stats.isDirectory()) {
      results.push(current);
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      queue.push(join(current, entry.name));
    }
  }

  return results;
}

function safeRead(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function splitIntoChunks(content: string, ext: string): readonly string[] {
  if (ext === ".md" || ext === ".txt") {
    return content
      .split(/\n\s*\n/g)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)
      .slice(0, 200);
  }

  const lines = content.split("\n");
  const chunks: string[] = [];
  const windowSize = 12;
  const overlap = 4;

  for (let index = 0; index < lines.length; index += windowSize - overlap) {
    const chunk = lines.slice(index, index + windowSize).join("\n").trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks.slice(0, 200);
}

function scoreChunk(chunk: string, terms: readonly string[]): number {
  const haystack = chunk.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const occurrences = haystack.split(term).length - 1;
    if (occurrences <= 0) continue;
    score += occurrences * Math.max(term.length, 1);
  }

  return score;
}

function tokenize(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}
