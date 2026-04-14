/**
 * Repo map generator (Aider-style).
 *
 * Produces a compact textual summary of a codebase that fits in a model's
 * context window. Each file is reduced to its top-level symbols (classes,
 * functions, exports), with a "centrality" score that reflects how often
 * the file is imported elsewhere. Files ranked by centrality × recency get
 * surfaced first when the map has to be trimmed to a token budget.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

export interface RepoMapEntry {
  readonly path: string;
  readonly language: string;
  readonly sizeBytes: number;
  readonly symbols: readonly string[];
  readonly imports: readonly string[];
  readonly centrality: number;
  readonly mtimeMs: number;
}

export interface RepoMap {
  readonly root: string;
  readonly entries: readonly RepoMapEntry[];
  readonly totalFiles: number;
  readonly truncated: boolean;
  readonly generatedAt: number;
}

export interface BuildRepoMapOptions {
  readonly root: string;
  readonly maxBytes?: number;
  readonly ignorePatterns?: readonly RegExp[];
  readonly includeExtensions?: readonly string[];
  readonly centralityFor?: (filePath: string) => number | undefined;
}

const DEFAULT_IGNORES: readonly RegExp[] = [
  /^node_modules$/,
  /^dist$/,
  /^build$/,
  /^target$/,
  /^\.next$/,
  /^\.git$/,
  /^\.turbo$/,
  /^\.DS_Store$/,
  /^coverage$/,
  /\.pyc$/,
  /\.min\./,
  /\.map$/,
  /\.lock$/,
];

const DEFAULT_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".java",
  ".cs",
  ".php",
  ".lua",
  ".scala",
  ".clj",
  ".sh",
  ".bash",
  ".zsh",
];

const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".tsx": "typescript-react",
  ".js": "javascript",
  ".jsx": "javascript-react",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".swift": "swift",
  ".kt": "kotlin",
  ".java": "java",
  ".cs": "csharp",
  ".php": "php",
  ".lua": "lua",
  ".scala": "scala",
  ".clj": "clojure",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
};

const SYMBOL_PATTERNS: Readonly<Record<string, readonly RegExp[]>> = {
  typescript: [
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/gm,
    /^export\s+\{\s*([^}]+)\s*\}/gm,
    /^(?:async\s+)?(?:function|class|interface|type|enum)\s+(\w+)/gm,
  ],
  "typescript-react": [
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/gm,
    /^(?:async\s+)?(?:function|class|interface|type|enum)\s+(\w+)/gm,
  ],
  javascript: [
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm,
    /^(?:async\s+)?(?:function|class)\s+(\w+)/gm,
  ],
  "javascript-react": [
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm,
    /^(?:async\s+)?(?:function|class)\s+(\w+)/gm,
  ],
  python: [/^(?:async\s+)?def\s+(\w+)/gm, /^class\s+(\w+)/gm],
  ruby: [/^(?:def|class|module)\s+(\w+)/gm],
  go: [/^func\s+(?:\([^)]+\)\s+)?(\w+)/gm, /^type\s+(\w+)/gm],
  rust: [/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/gm],
  swift: [
    /^(?:public\s+|internal\s+|open\s+|fileprivate\s+)?(?:struct|class|enum|protocol|actor)\s+(\w+)/gm,
    /^(?:public\s+|internal\s+|open\s+|fileprivate\s+)?func\s+(\w+)/gm,
  ],
  kotlin: [/^(?:fun|class|object|interface)\s+(\w+)/gm],
  java: [
    /^(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:final\s+)?(?:class|interface|enum)\s+(\w+)/gm,
  ],
  csharp: [
    /^\s*(?:public\s+|internal\s+|private\s+)?(?:static\s+)?(?:partial\s+)?(?:class|interface|struct|enum|record)\s+(\w+)/gm,
  ],
  php: [/^(?:function|class|interface|trait)\s+(\w+)/gm],
};

const IMPORT_PATTERNS: Readonly<Record<string, readonly RegExp[]>> = {
  typescript: [/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm],
  "typescript-react": [/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm],
  javascript: [/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm],
  "javascript-react": [/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm],
  python: [/^(?:from|import)\s+([\w.]+)/gm],
  go: [/^\s+['"]([^'"]+)['"]/gm],
  rust: [/^use\s+([\w:]+)/gm],
  swift: [/^import\s+(\w+)/gm],
};

export function buildRepoMap(options: BuildRepoMapOptions): RepoMap {
  const root = options.root;
  const ignores = options.ignorePatterns ?? DEFAULT_IGNORES;
  const exts = new Set(options.includeExtensions ?? DEFAULT_EXTENSIONS);
  const entries: RepoMapEntry[] = [];

  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (ignores.some((p) => p.test(name))) continue;
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        const ext = extname(name);
        if (!exts.has(ext)) continue;
        if (stat.size > 256 * 1024) continue;
        const language = LANGUAGE_BY_EXT[ext] ?? "plain";
        let content = "";
        try {
          content = readFileSync(full, "utf-8");
        } catch {
          continue;
        }
        const symbols = extractSymbols(content, language);
        const imports = extractImports(content, language);
        entries.push({
          path: relative(root, full),
          language,
          sizeBytes: stat.size,
          symbols,
          imports,
          centrality: 0,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  };

  walk(root);

  const importCount: Map<string, number> = new Map();
  for (const entry of entries) {
    for (const imp of entry.imports) {
      const normalised = imp.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx)$/, "");
      importCount.set(normalised, (importCount.get(normalised) ?? 0) + 1);
    }
  }
  const scored = entries.map((entry): RepoMapEntry => {
    const basename = entry.path.replace(/\.(ts|tsx|js|jsx|py|go|rs|swift)$/, "");
    const naive =
      importCount.get(basename) ?? importCount.get(basename.replace(/\/index$/, "")) ?? 0;
    const externalScore = options.centralityFor?.(entry.path) ?? 0;
    const centrality = Math.max(naive, externalScore);
    return { ...entry, centrality };
  });

  return {
    root,
    entries: scored,
    totalFiles: scored.length,
    truncated: false,
    generatedAt: Date.now(),
  };
}

export function extractSymbols(content: string, language: string): readonly string[] {
  const patterns = SYMBOL_PATTERNS[language];
  if (!patterns) return [];
  const out = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(content);
    while (match !== null) {
      const captured = match[1];
      if (captured) {
        for (const name of captured.split(/\s*,\s*/)) {
          const cleaned = name.replace(/\s+as\s+\w+/, "").trim();
          if (cleaned && /^\w+$/.test(cleaned)) out.add(cleaned);
        }
      }
      match = pattern.exec(content);
    }
  }
  return [...out].slice(0, 25);
}

export function extractImports(content: string, language: string): readonly string[] {
  const patterns = IMPORT_PATTERNS[language];
  if (!patterns) return [];
  const out = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(content);
    while (match !== null) {
      const captured = match[1];
      if (captured) out.add(captured);
      match = pattern.exec(content);
    }
  }
  return [...out].slice(0, 20);
}

export function renderRepoMap(map: RepoMap, maxBytes = 8_000): string {
  const ranked = [...map.entries].sort((a, b) => {
    const recencyScoreA = Math.log(Math.max(1, Date.now() - a.mtimeMs)) * -0.3;
    const recencyScoreB = Math.log(Math.max(1, Date.now() - b.mtimeMs)) * -0.3;
    const scoreA = a.centrality + recencyScoreA;
    const scoreB = b.centrality + recencyScoreB;
    return scoreB - scoreA;
  });

  const lines: string[] = [`# Repo map — ${map.totalFiles} files @ ${map.root}`, ""];
  let byteBudget = maxBytes - (lines[0]?.length ?? 0) - 2;
  let truncatedCount = 0;
  for (const entry of ranked) {
    const block = [
      `## ${entry.path}`,
      `  lang=${entry.language} centrality=${entry.centrality} symbols=${entry.symbols.length}`,
      ...(entry.symbols.length > 0 ? [`  ${entry.symbols.slice(0, 12).join(", ")}`] : []),
      "",
    ].join("\n");
    if (block.length > byteBudget) {
      truncatedCount += 1;
      continue;
    }
    lines.push(block);
    byteBudget -= block.length;
  }

  if (truncatedCount > 0) {
    lines.push(`_...${truncatedCount} files omitted to fit ${maxBytes}-byte budget_`);
  }
  return lines.join("\n");
}

export function summariseRepoMap(map: RepoMap): string {
  const languages = new Map<string, number>();
  for (const entry of map.entries) {
    languages.set(entry.language, (languages.get(entry.language) ?? 0) + 1);
  }
  const langSummary = [...languages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, count]) => `${lang}:${count}`)
    .join(" ");
  return `repo(${map.totalFiles} files, ${langSummary})`;
}
