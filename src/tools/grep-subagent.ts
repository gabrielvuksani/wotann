/**
 * Grep Subagent — single-root code search worker.
 *
 * PORT: Morph WarpGrep v2 (2026-04, morphllm.com/blog/warpgrep-v2).
 *
 * Each subagent runs ONE grep pass over ONE root path and returns a
 * CONDENSED summary `{ path, line, snippet, relevance }`. The main
 * agent never sees raw grep output — only the filtered summaries.
 * This keeps main-agent context small and lets the subagent use a
 * cheap model for relevance filtering.
 *
 * WOTANN DIFFERENCES FROM MORPH:
 *   - We don't ship an RL-trained specialist. Instead, optional
 *     LlmQuery (same shape used by chain-of-verification, pre-
 *     completion-verifier) lets callers plug in cheap Haiku-style
 *     models for relevance scoring.
 *   - Ripgrep is preferred; Node fallback when `rg` isn't installed
 *     (QB #6: honest stubs over silent success — we set `engine` so
 *     callers can see which backend ran).
 *   - Per-session state: no module-globals. A fresh worker state is
 *     created per dispatch (QB #7).
 *
 * Snippet lengths are capped at SNIPPET_MAX_LEN chars to prevent
 * 500-line snippets from eating context back.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────

/**
 * Provider-agnostic LLM call shape. Matches chain-of-verification.ts
 * and pre-completion-verifier.ts so callers can reuse bindings.
 */
export type LlmQuery = (
  prompt: string,
  options?: { readonly maxTokens?: number; readonly temperature?: number },
) => Promise<string>;

export type Relevance = "high" | "medium" | "low";

/** A single condensed hit returned by a subagent. */
export interface CondensedResult {
  readonly path: string;
  readonly line: number;
  readonly snippet: string;
  readonly relevance: Relevance;
}

/** Per-subagent options. */
export interface GrepSubagentOptions {
  /** Glob-like includes; matched via simple extension / suffix. */
  readonly include?: readonly string[];
  /** Glob-like excludes; any path containing an excluded segment is skipped. */
  readonly exclude?: readonly string[];
  /** Max results returned per subagent. Default 50. */
  readonly maxResults?: number;
  /** If true, treat `query` as a fixed string, not a regex. Default false. */
  readonly fixedString?: boolean;
  /** If true, case-insensitive. Default true. */
  readonly caseInsensitive?: boolean;
  /**
   * Optional LLM for relevance filtering. When supplied, every hit gets
   * scored and hits scoring below `relevanceThreshold` are dropped.
   */
  readonly llmQuery?: LlmQuery;
  /** Minimum relevance to keep when llmQuery is supplied. Default "medium". */
  readonly relevanceThreshold?: Relevance;
  /** Max snippet length in chars. Default 200. Hard-capped at 500. */
  readonly maxSnippetLen?: number;
  /** Max files to visit per subagent in Node fallback. Default 2000. */
  readonly maxFilesFallback?: number;
  /** Extensions to search when no include provided. */
  readonly defaultExtensions?: readonly string[];
}

/** Diagnostic envelope returned by `runGrepSubagent`. */
export interface GrepSubagentReport {
  readonly root: string;
  readonly engine: "ripgrep" | "node-fallback";
  readonly rawHits: number;
  readonly filteredHits: number;
  readonly durationMs: number;
  readonly hits: readonly CondensedResult[];
  /** Warning when LLM filtering was requested but failed. */
  readonly warning?: string;
}

// ── Constants ────────────────────────────────────────────

const SNIPPET_MAX_LEN = 500;
const DEFAULT_SNIPPET_LEN = 200;
const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_FILES_FALLBACK = 2000;
const RIPGREP_TIMEOUT_MS = 20_000;

const DEFAULT_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".cpp",
  ".cc",
  ".c",
  ".h",
  ".hpp",
  ".rb",
  ".php",
  ".swift",
  ".m",
  ".mm",
  ".md",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
];

const DEFAULT_EXCLUDE_SEGMENTS: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "dist-cjs",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".turbo",
  ".vercel",
];

const RELEVANCE_ORDER: Readonly<Record<Relevance, number>> = {
  high: 2,
  medium: 1,
  low: 0,
};

// ── Public API ──────────────────────────────────────────

/**
 * Run a single grep-subagent over `root`. Always returns a report even
 * on zero hits — callers use `engine` / `warning` to detect fallback
 * or degradation.
 */
export async function runGrepSubagent(
  query: string,
  root: string,
  options: GrepSubagentOptions = {},
): Promise<GrepSubagentReport> {
  if (!query || query.trim().length === 0) {
    throw new Error("grep-subagent: empty query");
  }
  if (!root || root.trim().length === 0) {
    throw new Error("grep-subagent: empty root");
  }

  const started = Date.now();
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxSnippetLen = Math.min(options.maxSnippetLen ?? DEFAULT_SNIPPET_LEN, SNIPPET_MAX_LEN);

  // 1. Pick engine. We always attempt ripgrep first unless explicitly disabled.
  let engine: "ripgrep" | "node-fallback" = "ripgrep";
  let rawHits: CondensedResult[] = [];
  let warning: string | undefined;

  try {
    rawHits = await ripgrepSearch(query, root, options, maxSnippetLen);
  } catch (e) {
    engine = "node-fallback";
    // Fall back to Node walker so callers get an answer, not a silent zero.
    try {
      rawHits = await nodeFallbackSearch(query, root, options, maxSnippetLen);
    } catch (ne) {
      const detail = ne instanceof Error ? ne.message : String(ne);
      warning = `node-fallback failed: ${detail}`;
    }
  }

  // 2. LLM relevance filter (optional).
  let finalHits: CondensedResult[] = rawHits;
  if (options.llmQuery && rawHits.length > 0) {
    try {
      finalHits = await llmFilterHits(rawHits, query, options);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      warning = `llm filter failed, returning unfiltered results: ${detail}`;
    }
  }

  // 3. Honest top-K cap.
  const capped = finalHits.slice(0, maxResults);

  return {
    root,
    engine,
    rawHits: rawHits.length,
    filteredHits: capped.length,
    durationMs: Date.now() - started,
    hits: capped,
    warning,
  };
}

// ── Ripgrep backend ────────────────────────────────────

async function ripgrepSearch(
  query: string,
  root: string,
  options: GrepSubagentOptions,
  maxSnippetLen: number,
): Promise<CondensedResult[]> {
  const args: string[] = [
    "--no-heading",
    "--line-number",
    "--no-messages",
    "--color=never",
    "--max-count=200",
  ];
  if (options.caseInsensitive ?? true) args.push("--ignore-case");
  if (options.fixedString) args.push("--fixed-strings");

  // Respect include/exclude as globs — rg uses `-g`.
  for (const inc of options.include ?? []) {
    args.push("--glob", inc);
  }
  for (const exc of options.exclude ?? []) {
    args.push("--glob", `!${exc}`);
  }
  // Default excludes (never search node_modules etc.).
  for (const seg of DEFAULT_EXCLUDE_SEGMENTS) {
    args.push("--glob", `!**/${seg}/**`);
  }

  args.push("--", query, root);

  const { stdout } = await execFileAsync("rg", args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: RIPGREP_TIMEOUT_MS,
  });

  return parseRipgrepLines(stdout, maxSnippetLen);
}

function parseRipgrepLines(stdout: string, maxSnippetLen: number): CondensedResult[] {
  const lines = stdout.split("\n");
  const hits: CondensedResult[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    // ripgrep format: path:line:match
    const firstColon = raw.indexOf(":");
    if (firstColon < 0) continue;
    const secondColon = raw.indexOf(":", firstColon + 1);
    if (secondColon < 0) continue;
    const path = raw.slice(0, firstColon);
    const lineStr = raw.slice(firstColon + 1, secondColon);
    const snippetRaw = raw.slice(secondColon + 1);
    const line = Number.parseInt(lineStr, 10);
    if (!Number.isFinite(line) || line <= 0) continue;
    hits.push({
      path,
      line,
      snippet: truncateSnippet(snippetRaw, maxSnippetLen),
      relevance: "medium",
    });
  }
  return hits;
}

// ── Node fallback backend ─────────────────────────────

async function nodeFallbackSearch(
  query: string,
  root: string,
  options: GrepSubagentOptions,
  maxSnippetLen: number,
): Promise<CondensedResult[]> {
  const caseInsensitive = options.caseInsensitive ?? true;
  const fixedString = options.fixedString ?? false;
  const maxFiles = options.maxFilesFallback ?? DEFAULT_MAX_FILES_FALLBACK;

  // Include globs: keep both the literal ".ext" form (for defaultExtensions
  // fallback) AND compiled RegExps (for general glob matching).
  const includeGlobs = options.include ?? [];
  const excludeGlobs = options.exclude ?? [];
  const includeExts = includeGlobs
    .map((g) => (g.startsWith("*.") ? g.slice(1) : null))
    .filter((s): s is string => Boolean(s));
  const defaultExts = options.defaultExtensions ?? DEFAULT_EXTENSIONS;
  const extensions = includeExts.length > 0 ? includeExts : defaultExts;
  const includeRegexes = includeGlobs.map(globToRegex);
  const excludeRegexes = excludeGlobs.map(globToRegex);
  const excludeSegments = new Set<string>(DEFAULT_EXCLUDE_SEGMENTS);

  const rx = fixedString ? null : safeRegex(query, caseInsensitive);
  const needle = caseInsensitive ? query.toLowerCase() : query;

  const hits: CondensedResult[] = [];
  const stack: string[] = [root];
  let visited = 0;

  while (stack.length > 0 && visited < maxFiles) {
    const current = stack.pop();
    if (!current) break;
    const stats = await safeStat(current);
    if (!stats) continue;
    if (stats.isDirectory()) {
      const segments = current.split("/");
      if (segments.some((seg) => excludeSegments.has(seg))) continue;
      const entries = await safeReaddir(current);
      for (const entry of entries) {
        stack.push(join(current, entry));
      }
      continue;
    }
    if (!stats.isFile()) continue;
    const ext = extname(current);
    if (!extensions.includes(ext)) continue;
    // Glob filters (applied to basename AND full path) — exclude beats include.
    if (excludeRegexes.length > 0 && excludeRegexes.some((re) => re.test(current))) continue;
    if (includeRegexes.length > 0 && !includeRegexes.some((re) => re.test(current))) {
      continue;
    }
    visited++;
    const content = await safeReadFile(current);
    if (!content) continue;
    const fileLines = content.split("\n");
    for (let i = 0; i < fileLines.length; i++) {
      const lineText = fileLines[i];
      if (!lineText) continue;
      const match = rx
        ? rx.test(lineText)
        : caseInsensitive
          ? lineText.toLowerCase().includes(needle)
          : lineText.includes(needle);
      if (!match) continue;
      hits.push({
        path: current,
        line: i + 1,
        snippet: truncateSnippet(lineText, maxSnippetLen),
        relevance: "medium",
      });
      if (hits.length >= 500) break;
    }
    if (hits.length >= 500) break;
  }

  return hits;
}

/**
 * Minimal glob -> RegExp translator for the Node fallback.
 * Handles `*`, `**`, `?`, and literal characters. The resulting regex
 * is anchored at end-of-path, so `*.md` matches `/x/foo.md` but not
 * `/x/foo.markdown`. `**` matches any path segment (including slashes).
 */
function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    const next = glob[i + 1];
    if (c === "*" && next === "*") {
      re += ".*";
      i++;
      continue;
    }
    if (c === "*") {
      re += "[^/]*";
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      continue;
    }
    if (c && /[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
      continue;
    }
    re += c ?? "";
  }
  return new RegExp(re + "$", "i");
}

function safeRegex(source: string, caseInsensitive: boolean): RegExp | null {
  try {
    return new RegExp(source, caseInsensitive ? "i" : undefined);
  } catch {
    return null;
  }
}

async function safeReaddir(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function safeStat(
  path: string,
): Promise<{ isFile: () => boolean; isDirectory: () => boolean } | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path, "utf8");
    return buf;
  } catch {
    return null;
  }
}

// ── LLM relevance filter ──────────────────────────────

async function llmFilterHits(
  hits: readonly CondensedResult[],
  query: string,
  options: GrepSubagentOptions,
): Promise<CondensedResult[]> {
  const llmQuery = options.llmQuery;
  if (!llmQuery) return [...hits];
  const threshold = RELEVANCE_ORDER[options.relevanceThreshold ?? "medium"];

  // Batch all hits into ONE prompt — cheap single-call per subagent.
  // Morph's insight: the subagent uses a cheap model, so batching is fine.
  const numbered = hits
    .map((h, i) => `${i}: ${h.path}:${h.line} :: ${h.snippet.slice(0, 140)}`)
    .join("\n");
  const prompt = buildFilterPrompt(query, numbered);
  const response = await llmQuery(prompt, { maxTokens: 1024, temperature: 0 });
  const scores = parseRelevanceResponse(response, hits.length);

  const scored: CondensedResult[] = [];
  for (let i = 0; i < hits.length; i++) {
    const src = hits[i];
    if (!src) continue;
    const level = scores[i] ?? "medium";
    if (RELEVANCE_ORDER[level] < threshold) continue;
    scored.push({ ...src, relevance: level });
  }

  // Sort: high > medium > low
  scored.sort((a, b) => RELEVANCE_ORDER[b.relevance] - RELEVANCE_ORDER[a.relevance]);
  return scored;
}

function buildFilterPrompt(query: string, numbered: string): string {
  return [
    `You are a code-search relevance filter. The user searched for:`,
    `  "${query}"`,
    ``,
    `Below is a numbered list of grep matches. For each, output ONE line:`,
    `  <index>: <high|medium|low>`,
    ``,
    `Rules:`,
    `  - high = directly answers the query (definition, primary caller)`,
    `  - medium = related but not primary (comment, test, unrelated caller)`,
    `  - low = coincidental match (string literal, unrelated context)`,
    ``,
    `Matches:`,
    numbered,
  ].join("\n");
}

function parseRelevanceResponse(raw: string, count: number): readonly Relevance[] {
  const out: Relevance[] = new Array(count).fill("medium" as Relevance);
  const lines = raw.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s*[-:]\s*(high|medium|low)\b/i);
    if (!match) continue;
    const idxStr = match[1];
    const levelStr = match[2];
    if (!idxStr || !levelStr) continue;
    const idx = Number.parseInt(idxStr, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= count) continue;
    out[idx] = levelStr.toLowerCase() as Relevance;
  }
  return out;
}

// ── Utilities ──────────────────────────────────────────

function truncateSnippet(raw: string, maxLen: number): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "…[truncated]";
}
