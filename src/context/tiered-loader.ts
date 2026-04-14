/**
 * Tiered Context Loading — L0/L1/L2 extraction for token-efficient context.
 *
 * Based on OpenViking's 91% token reduction finding: instead of loading
 * entire files into context, extract tiered summaries:
 *
 * - L0 (~100 tokens): Function signatures, exports, type names only
 * - L1 (~2K tokens): Key structures, relationships, JSDoc summaries
 * - L2: Full file content (no transformation)
 *
 * Files are allocated to tiers based on relevance scores within a token budget.
 */

import { estimateTokens } from "./inspector.js";

// ── Public Types ──────────────────────────────────────

export type ContextTier = 0 | 1 | 2;

export interface TieredFile {
  readonly path: string;
  readonly tier: ContextTier;
  readonly content: string;
  readonly tokenEstimate: number;
}

export interface TieredLoaderConfig {
  readonly totalBudget: number;
  readonly l0Ratio: number;
  readonly l1Ratio: number;
  readonly l2Ratio: number;
}

export interface FileInput {
  readonly path: string;
  readonly content: string;
  readonly relevance: number;
}

// ── Constants ─────────────────────────────────────────

const DEFAULT_CONFIG: TieredLoaderConfig = {
  totalBudget: 100_000,
  l0Ratio: 0.6,
  l1Ratio: 0.3,
  l2Ratio: 0.1,
};

// ── Regex patterns for extraction ─────────────────────

/**
 * Patterns for extracting function signatures across common languages.
 */
const FUNCTION_PATTERNS: readonly RegExp[] = [
  // TypeScript/JavaScript: export function, export const fn =, export async function
  /^export\s+(?:async\s+)?function\s+\w+[^{]*/gm,
  // Arrow function exports: export const foo = (...) =>
  /^export\s+const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=>{]+)?\s*=>/gm,
  // Class method signatures (public/private/protected)
  /^\s+(?:public|private|protected|static|async|readonly|\s)*\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?(?=\s*\{)/gm,
  // Python: def foo(...) -> type:
  /^(?:async\s+)?def\s+\w+\([^)]*\)(?:\s*->\s*[^:]+)?:/gm,
  // Go: func (r *Type) Name(...) (return, error)
  /^func\s+(?:\([^)]*\)\s+)?\w+\([^)]*\)(?:\s*(?:\([^)]*\)|[^{]+))?/gm,
  // Rust: pub fn name(...) -> Type
  /^(?:pub\s+)?(?:async\s+)?fn\s+\w+[^{]*/gm,
];

/**
 * Patterns for extracting type definitions.
 */
const TYPE_PATTERNS: readonly RegExp[] = [
  // TypeScript: export interface, export type
  /^export\s+(?:interface|type)\s+\w+[^{=]*/gm,
  // TypeScript: export enum
  /^export\s+enum\s+\w+/gm,
  // Class declarations
  /^export\s+(?:abstract\s+)?class\s+\w+(?:\s+(?:extends|implements)\s+[^{]+)?/gm,
  // Python: class Name(Base):
  /^class\s+\w+(?:\([^)]*\))?:/gm,
  // Go: type Name struct/interface
  /^type\s+\w+\s+(?:struct|interface)/gm,
  // Rust: pub struct/enum/trait
  /^(?:pub\s+)?(?:struct|enum|trait)\s+\w+/gm,
];

/**
 * Patterns for extracting export statements.
 */
const EXPORT_PATTERNS: readonly RegExp[] = [
  // Named exports
  /^export\s*\{[^}]+\}/gm,
  // Default exports
  /^export\s+default\s+(?:class|function|const)\s+\w+/gm,
  // Re-exports
  /^export\s*(?:\*|{[^}]+})\s+from\s+["'][^"']+["']/gm,
  // module.exports
  /^module\.exports\s*=/gm,
];

/**
 * Patterns for extracting JSDoc/docstring summaries.
 */
const DOCSTRING_PATTERN = /\/\*\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|\/\/\/\s*.+$/gm;

// ── Tiered Context Loader ─────────────────────────────

export class TieredContextLoader {
  /**
   * L0 extraction (~100 tokens): signatures, exports, type names only.
   * Captures the "shape" of a file without any implementation details.
   */
  extractL0(content: string, language: string): string {
    const lines: string[] = [];
    lines.push(`// L0 summary (${language})`);

    // Extract export statements
    const exports = matchAll(content, EXPORT_PATTERNS);
    if (exports.length > 0) {
      lines.push("// Exports:");
      for (const exp of exports.slice(0, 20)) {
        lines.push(exp.trim());
      }
    }

    // Extract type/interface declarations (names only)
    const types = matchAll(content, TYPE_PATTERNS);
    if (types.length > 0) {
      lines.push("// Types:");
      for (const t of types.slice(0, 20)) {
        lines.push(t.trim());
      }
    }

    // Extract function signatures (no body)
    const functions = matchAll(content, FUNCTION_PATTERNS);
    if (functions.length > 0) {
      lines.push("// Functions:");
      for (const fn of functions.slice(0, 20)) {
        lines.push(fn.trim());
      }
    }

    const result = lines.join("\n");
    return result.length > 0 ? result : `// L0: no extractable signatures in ${language} file`;
  }

  /**
   * L1 extraction (~2K tokens): key structures, relationships, JSDoc summaries.
   * Captures enough to understand how a file fits in the broader system.
   */
  extractL1(content: string, language: string): string {
    const lines: string[] = [];
    lines.push(`// L1 summary (${language})`);

    // Include all imports (show dependencies)
    const imports = extractImports(content);
    if (imports.length > 0) {
      lines.push("// Dependencies:");
      for (const imp of imports) {
        lines.push(imp);
      }
      lines.push("");
    }

    // Include JSDoc/docstring comments (summarize purpose)
    const docstrings = extractDocstrings(content);
    if (docstrings.length > 0) {
      lines.push("// Documentation:");
      for (const doc of docstrings.slice(0, 10)) {
        // Truncate long docstrings to first sentence
        const firstSentence = doc.replace(/\n/g, " ").replace(/\s+/g, " ").slice(0, 200);
        lines.push(`// ${firstSentence}`);
      }
      lines.push("");
    }

    // Include full type definitions (interfaces, types, enums)
    const typeBlocks = extractTypeBlocks(content);
    if (typeBlocks.length > 0) {
      lines.push("// Type definitions:");
      for (const block of typeBlocks.slice(0, 15)) {
        lines.push(block);
      }
      lines.push("");
    }

    // Include function signatures with JSDoc
    const signedFunctions = extractSignaturesWithDocs(content);
    if (signedFunctions.length > 0) {
      lines.push("// Function signatures:");
      for (const fn of signedFunctions.slice(0, 20)) {
        lines.push(fn);
      }
    }

    // Include class outlines (methods without bodies)
    const classOutlines = extractClassOutlines(content);
    if (classOutlines.length > 0) {
      lines.push("// Class outlines:");
      for (const cls of classOutlines) {
        lines.push(cls);
      }
    }

    return lines.join("\n");
  }

  /**
   * L2 extraction: full file content, no transformation.
   */
  extractL2(content: string): string {
    return content;
  }

  /**
   * Allocate files to tiers within a token budget based on relevance.
   *
   * Strategy:
   * - Sort files by relevance (highest first)
   * - Top files get L2 (full content)
   * - Middle files get L1 (structural summaries)
   * - Bottom files get L0 (signatures only)
   * - Respect total token budget
   */
  allocateTiers(
    files: readonly FileInput[],
    config: TieredLoaderConfig = DEFAULT_CONFIG,
  ): readonly TieredFile[] {
    if (files.length === 0) return [];

    // Sort by relevance descending
    const sorted = [...files].sort((a, b) => b.relevance - a.relevance);

    // Calculate how many files per tier
    const totalFiles = sorted.length;
    const l2Count = Math.max(1, Math.round(totalFiles * config.l2Ratio));
    const l1Count = Math.max(0, Math.round(totalFiles * config.l1Ratio));
    // l0Count is the remainder

    const result: TieredFile[] = [];
    let tokensUsed = 0;

    for (let i = 0; i < sorted.length; i++) {
      const file = sorted[i]!;
      const language = detectLanguage(file.path);

      let tier: ContextTier;
      let content: string;

      if (i < l2Count) {
        // Top relevance: full content
        tier = 2;
        content = this.extractL2(file.content);
      } else if (i < l2Count + l1Count) {
        // Medium relevance: structural summary
        tier = 1;
        content = this.extractL1(file.content, language);
      } else {
        // Low relevance: signatures only
        tier = 0;
        content = this.extractL0(file.content, language);
      }

      const tokenEstimate = estimateTokens(content);

      // Check budget — downgrade tiers if needed
      if (tokensUsed + tokenEstimate > config.totalBudget) {
        const downgraded = this.downgradeToBudget(
          file, language, tier, tokensUsed, config.totalBudget,
        );
        if (downgraded) {
          tokensUsed += downgraded.tokenEstimate;
          result.push(downgraded);
        }
        continue;
      }

      tokensUsed += tokenEstimate;
      result.push({ path: file.path, tier, content, tokenEstimate });
    }

    return result;
  }

  /**
   * Attempt to downgrade a file's tier to fit within budget.
   */
  private downgradeToBudget(
    file: FileInput,
    language: string,
    currentTier: ContextTier,
    tokensUsed: number,
    totalBudget: number,
  ): TieredFile | null {
    const remaining = totalBudget - tokensUsed;

    if (currentTier === 2) {
      // Try L1
      const l1Content = this.extractL1(file.content, language);
      const l1Estimate = estimateTokens(l1Content);
      if (l1Estimate <= remaining) {
        return { path: file.path, tier: 1, content: l1Content, tokenEstimate: l1Estimate };
      }
      // Try L0
      const l0Content = this.extractL0(file.content, language);
      const l0Estimate = estimateTokens(l0Content);
      if (l0Estimate <= remaining) {
        return { path: file.path, tier: 0, content: l0Content, tokenEstimate: l0Estimate };
      }
    } else if (currentTier === 1) {
      // Try L0
      const l0Content = this.extractL0(file.content, language);
      const l0Estimate = estimateTokens(l0Content);
      if (l0Estimate <= remaining) {
        return { path: file.path, tier: 0, content: l0Content, tokenEstimate: l0Estimate };
      }
    }

    return null; // Cannot fit even at L0
  }
}

// ── Extraction Helpers ────────────────────────────────

/**
 * Run multiple regex patterns against content, collecting all matches.
 */
function matchAll(content: string, patterns: readonly RegExp[]): readonly string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    // Create a fresh regex to avoid stale lastIndex
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[0]) {
        results.push(match[0]);
      }
    }
  }
  return results;
}

/**
 * Extract import/require statements.
 */
function extractImports(content: string): readonly string[] {
  const patterns = [
    /^import\s+.+$/gm,                         // ES imports
    /^const\s+\w+\s*=\s*require\(.+\)$/gm,     // CommonJS
    /^from\s+\S+\s+import\s+.+$/gm,            // Python
    /^use\s+\S+;?$/gm,                          // Rust
  ];
  return matchAll(content, patterns);
}

/**
 * Extract docstring/JSDoc comment bodies.
 */
function extractDocstrings(content: string): readonly string[] {
  const regex = new RegExp(DOCSTRING_PATTERN.source, DOCSTRING_PATTERN.flags);
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[0]) {
      // Clean up: remove comment markers
      const cleaned = match[0]
        .replace(/^\/\*\*\s*/m, "")
        .replace(/\s*\*\/$/m, "")
        .replace(/^\s*\*\s?/gm, "")
        .replace(/^"""/gm, "")
        .replace(/^'''/gm, "")
        .replace(/^\/\/\/\s*/gm, "")
        .trim();
      if (cleaned.length > 10) {
        results.push(cleaned);
      }
    }
  }
  return results;
}

/**
 * Extract full type/interface/enum blocks (including their body).
 */
function extractTypeBlocks(content: string): readonly string[] {
  const blocks: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match type/interface/enum declarations
    if (/^export\s+(?:interface|type|enum)\s+\w+/.test(line)) {
      // Collect the block until closing brace at same indent level
      const blockLines = [line];
      let braceDepth = 0;
      let started = false;

      for (let j = i; j < lines.length && j < i + 50; j++) {
        const blockLine = lines[j]!;
        for (const char of blockLine) {
          if (char === "{") {
            braceDepth++;
            started = true;
          }
          if (char === "}") braceDepth--;
        }
        if (j > i) blockLines.push(blockLine);
        if (started && braceDepth <= 0) break;
      }

      blocks.push(blockLines.join("\n"));
    }
  }

  return blocks;
}

/**
 * Extract function signatures with preceding JSDoc comments.
 */
function extractSignaturesWithDocs(content: string): readonly string[] {
  const results: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Check if this is a function signature line
    const isFunctionLine =
      /^export\s+(?:async\s+)?function\s+\w+/.test(line) ||
      /^export\s+const\s+\w+\s*=\s*(?:async\s+)?\(/.test(line) ||
      /^\s+(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/.test(line);

    if (isFunctionLine) {
      // Look backwards for JSDoc
      const docLines: string[] = [];
      let j = i - 1;
      while (j >= 0 && j >= i - 15) {
        const prev = lines[j]!.trim();
        if (prev.startsWith("*") || prev.startsWith("/**") || prev === "*/") {
          docLines.unshift(lines[j]!);
        } else if (prev === "") {
          // Skip empty lines between doc and function
        } else {
          break;
        }
        j--;
      }

      if (docLines.length > 0) {
        results.push([...docLines, line].join("\n"));
      } else {
        results.push(line);
      }
    }
  }

  return results;
}

/**
 * Extract class outlines: class declaration + method signatures without bodies.
 */
function extractClassOutlines(content: string): readonly string[] {
  const outlines: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/^export\s+(?:abstract\s+)?class\s+\w+/.test(line)) {
      const classLines: string[] = [line];

      // Scan class body for method signatures
      let braceDepth = 0;
      let started = false;

      for (let j = i; j < lines.length; j++) {
        const classLine = lines[j]!;
        for (const char of classLine) {
          if (char === "{") {
            braceDepth++;
            started = true;
          }
          if (char === "}") braceDepth--;
        }

        // Capture method signature lines (depth 1 = class body)
        if (braceDepth === 1 && j > i) {
          const trimmed = classLine.trim();
          if (
            /^(?:public|private|protected|static|async|abstract|readonly|\s)*\w+\s*\(/.test(trimmed) ||
            /^(?:public|private|protected|static|readonly)\s+\w+/.test(trimmed) ||
            /^constructor\s*\(/.test(trimmed)
          ) {
            classLines.push(`  ${trimmed.replace(/\{[\s\S]*$/, "").trim()}`);
          }
        }

        if (started && braceDepth <= 0) {
          classLines.push("}");
          break;
        }
      }

      outlines.push(classLines.join("\n"));
    }
  }

  return outlines;
}

/**
 * Detect programming language from file extension.
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    dart: "dart",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
  };
  return map[ext] ?? "unknown";
}
