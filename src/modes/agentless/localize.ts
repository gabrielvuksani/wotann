/**
 * Agentless LOCALIZE phase.
 *
 * Goal: rank the top-5 candidate files for a bug given an issue description.
 *
 * Algorithm (matches Agentless paper, simplified):
 *   1. Extract 3-8 keywords from the issue via cheap LLM call (or simple heuristics if no LLM).
 *   2. ripgrep each keyword across the repo.
 *   3. Aggregate hits by file; rank by hit-density + symbol-match weighting.
 *   4. Return top-5 candidates with evidence.
 *
 * QB #6: empty hits → empty candidateFiles + zero error; never silent PASS.
 * QB #7: no module-global state — every call gets fresh data.
 */

import { execFileNoThrow } from "../../utils/execFileNoThrow.js";
import type {
  AgentlessIssue,
  AgentlessModel,
  CodeSearchFn,
  LocalizeCandidate,
  LocalizeResult,
} from "./types.js";

export interface LocalizeOptions {
  /** repo root absolute path */
  readonly root: string;
  /** Cheap-model for keyword extraction. If absent, uses heuristic extractor. */
  readonly keywordModel?: AgentlessModel;
  /** Code-search shim — defaults to ripgrep via execFileNoThrow. */
  readonly codeSearchFn?: CodeSearchFn;
  /** Max number of candidates returned (default 5). */
  readonly topK?: number;
  /** Max keywords to extract from issue (default 6). */
  readonly maxKeywords?: number;
}

/**
 * Run the LOCALIZE phase. Always returns a result — never throws on empty
 * search results or model failure.
 */
export async function localizeIssue(
  issue: AgentlessIssue,
  opts: LocalizeOptions,
): Promise<LocalizeResult> {
  const t0 = Date.now();
  const topK = opts.topK ?? 5;
  const maxKeywords = opts.maxKeywords ?? 6;

  const keywords = await extractKeywords(issue, opts.keywordModel, maxKeywords);
  const search = opts.codeSearchFn ?? defaultRipgrepSearch;

  // Run searches sequentially to keep it simple; ripgrep is fast enough.
  const hitsByFile = new Map<string, { readonly hits: number; readonly evidence: Set<string> }>();
  for (const kw of keywords) {
    let results: readonly { readonly file: string; readonly count: number }[];
    try {
      results = await search(kw, opts.root);
    } catch {
      results = [];
    }
    for (const r of results) {
      const existing = hitsByFile.get(r.file);
      if (existing) {
        const evidence = new Set(existing.evidence);
        evidence.add(kw);
        hitsByFile.set(r.file, { hits: existing.hits + r.count, evidence });
      } else {
        hitsByFile.set(r.file, { hits: r.count, evidence: new Set([kw]) });
      }
    }
  }

  const candidates: LocalizeCandidate[] = [];
  let maxHits = 0;
  for (const [, v] of hitsByFile) {
    if (v.hits > maxHits) maxHits = v.hits;
  }
  for (const [file, v] of hitsByFile) {
    candidates.push({
      file,
      score: maxHits > 0 ? v.hits / maxHits : 0,
      hitCount: v.hits,
      evidence: [...v.evidence].slice(0, 5),
    });
  }
  candidates.sort((a, b) => {
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
    return a.file.localeCompare(b.file);
  });

  return {
    keywords,
    candidateFiles: candidates.slice(0, topK),
    searchedRoots: [opts.root],
    durationMs: Date.now() - t0,
  };
}

/**
 * Extract keywords from an issue. Uses the keywordModel if present;
 * otherwise applies a fast heuristic that picks identifier-shaped tokens.
 */
export async function extractKeywords(
  issue: AgentlessIssue,
  model: AgentlessModel | undefined,
  max: number,
): Promise<readonly string[]> {
  if (model) {
    const prompt = [
      "Extract 3-6 keywords from this bug report that are most likely to appear in code (identifiers, function names, file paths, error strings).",
      "Output ONLY the keywords, one per line, no commentary.",
      "",
      `Title: ${issue.title}`,
      `Body: ${issue.body.slice(0, 4000)}`,
    ].join("\n");
    try {
      const r = await model.query(prompt, { maxTokens: 256 });
      const kws = r.text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("-"))
        .map((l) => l.replace(/^["'`]|["'`]$/g, ""))
        .filter((l) => l.length >= 2 && l.length <= 64)
        .slice(0, max);
      if (kws.length > 0) return kws;
    } catch {
      // Fall through to heuristic.
    }
  }
  return heuristicKeywords(`${issue.title}\n${issue.body}`, max);
}

/**
 * Heuristic keyword extractor: pick identifier-shaped tokens, filter common
 * English stopwords, dedupe, take top N by length (longer = more specific).
 *
 * Test-friendly — no model call, deterministic.
 */
export function heuristicKeywords(text: string, max: number): readonly string[] {
  const STOP = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "when",
    "where",
    "what",
    "should",
    "would",
    "could",
    "have",
    "has",
    "but",
    "not",
    "can",
    "use",
    "using",
    "into",
    "after",
    "before",
    "issue",
    "bug",
    "fix",
    "fixes",
    "fixed",
    "test",
    "tests",
    "code",
    "file",
  ]);
  const tokens = text
    .split(/[^A-Za-z0-9_./-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && t.length <= 64)
    .filter((t) => !STOP.has(t.toLowerCase()))
    .filter((t) => /[A-Za-z]/.test(t));

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      ordered.push(t);
    }
  }

  // Bias toward identifier-shaped tokens and longer tokens.
  ordered.sort((a, b) => {
    const aIdent = /[A-Z_./]/.test(a) ? 1 : 0;
    const bIdent = /[A-Z_./]/.test(b) ? 1 : 0;
    if (aIdent !== bIdent) return bIdent - aIdent;
    return b.length - a.length;
  });
  return ordered.slice(0, max);
}

/**
 * Default ripgrep-backed code search. Uses `execFileNoThrow` (argv-pass,
 * no shell interpolation — safe even with attacker-controlled keywords).
 *
 * Returns an empty array on any failure so localize stays robust.
 */
export const defaultRipgrepSearch: CodeSearchFn = async (keyword, root) => {
  const r = await execFileNoThrow("rg", [
    "--count",
    "--no-messages",
    "--smart-case",
    "--max-count=200",
    "--",
    keyword,
    root,
  ]);
  if (r.exitCode !== 0 && r.exitCode !== 1) {
    // 1 = no matches; anything else = real failure.
    return [];
  }
  const out: { file: string; count: number }[] = [];
  for (const line of r.stdout.split("\n")) {
    const m = /^(.+):(\d+)$/.exec(line);
    if (m && m[1] && m[2]) {
      out.push({ file: m[1], count: parseInt(m[2], 10) || 0 });
    }
  }
  return out;
};
