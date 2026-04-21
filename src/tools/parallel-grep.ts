/**
 * ParallelGrep — fan-out N grep-subagents across root paths, aggregate
 * condensed summaries back to the main agent.
 *
 * PORT: Morph WarpGrep v2 (2026-04, morphllm.com/blog/warpgrep-v2).
 *
 * WHY THIS EXISTS:
 *   When the agent asks "where is X defined?" or "find all callers of
 *   Y", the naive approach (main agent runs grep, reads raw output into
 *   its own context) is expensive. WarpGrep delegates to SUBAGENTS that
 *   filter for semantic relevance and return only the condensed summary.
 *
 * GAINS CLAIMED BY MORPH:
 *   +2.1 pts on SWE-bench Pro (Codex 5.3 / Opus 4.6 / MiniMax 2.5).
 *   ~15-17% token-cost reduction via context isolation.
 *
 * WOTANN REALITY CHECK:
 *   We don't ship an RL-trained specialist. We ship the *orchestration
 *   pattern* plus an optional LlmQuery hook (same shape as B4 / B7 /
 *   B10 / C5) so callers can plug in cheap Haiku-class filtering.
 *   Honest expectation: +1.5–2.5 pp TB2 when paired with a good filter
 *   model; 0 if called without one. Our numbers are bounded below by
 *   the backing model.
 *
 * DESIGN:
 *   - `dispatch()` sharding is per-root-path — one subagent per root.
 *   - Each subagent is fully isolated (QB #7): per-session options,
 *     no module-global caching between dispatches.
 *   - Honest snippet truncation (max 500 chars) prevents context bloat.
 *   - Ripgrep preferred, Node fallback for CI environments without `rg`.
 *   - Injectable `LlmQuery` for relevance filtering (optional).
 */

import {
  runGrepSubagent,
  type CondensedResult,
  type GrepSubagentOptions,
  type GrepSubagentReport,
  type LlmQuery,
  type Relevance,
} from "./grep-subagent.js";

// ── Types ─────────────────────────────────────────────

/** Options for the aggregate `dispatch()` call. */
export interface ParallelGrepOptions extends GrepSubagentOptions {
  /** Max concurrent subagents. Default 4. Honored regardless of root count. */
  readonly concurrency?: number;
  /** Top-K aggregate cap. Default 100. Capped after dedup/sort. */
  readonly topK?: number;
  /** When true, deduplicate by `path` (keep highest relevance). Default true. */
  readonly dedupByPath?: boolean;
}

/** Aggregate report returned by `dispatch()`. */
export interface ParallelGrepReport {
  readonly query: string;
  readonly roots: readonly string[];
  readonly perRoot: readonly GrepSubagentReport[];
  readonly hits: readonly CondensedResult[];
  readonly rawHitCount: number;
  readonly dedupedHitCount: number;
  readonly returnedHitCount: number;
  readonly durationMs: number;
  /** True if at least one subagent hit the node fallback path. */
  readonly usedFallback: boolean;
  /** Aggregated warnings across all subagents. */
  readonly warnings: readonly string[];
}

// ── Class ─────────────────────────────────────────────

/**
 * `ParallelGrep` is a zero-state orchestrator — every `dispatch()` is
 * self-contained. Two concurrent callers share no state. (QB #7)
 */
export class ParallelGrep {
  /**
   * Fan out grep-subagents, one per root path, and aggregate results.
   *
   * @throws if `query` is empty or `rootPaths` is empty.
   */
  async dispatch(
    query: string,
    rootPaths: readonly string[],
    options: ParallelGrepOptions = {},
  ): Promise<ParallelGrepReport> {
    if (!query || query.trim().length === 0) {
      throw new Error("parallel-grep: empty query");
    }
    if (!rootPaths || rootPaths.length === 0) {
      throw new Error("parallel-grep: no root paths");
    }

    const started = Date.now();
    const concurrency = Math.max(1, options.concurrency ?? 4);
    const topK = Math.max(1, options.topK ?? 100);
    const dedup = options.dedupByPath ?? true;

    // Run subagents with bounded concurrency.
    const perRoot = await runBounded(
      rootPaths.map((root) => () => runGrepSubagent(query, root, options)),
      concurrency,
    );

    // Aggregate + dedup + cap.
    const allHits = perRoot.flatMap((r) => r.hits);
    const rawHitCount = allHits.length;
    const deduped = dedup ? dedupByPath(allHits) : allHits;
    const sorted = sortByRelevance(deduped);
    const capped = sorted.slice(0, topK);

    const warnings: string[] = [];
    for (const r of perRoot) {
      if (r.warning) warnings.push(`${r.root}: ${r.warning}`);
    }

    return {
      query,
      roots: [...rootPaths],
      perRoot,
      hits: capped,
      rawHitCount,
      dedupedHitCount: deduped.length,
      returnedHitCount: capped.length,
      durationMs: Date.now() - started,
      usedFallback: perRoot.some((r) => r.engine === "node-fallback"),
      warnings,
    };
  }
}

// ── Bounded concurrency ────────────────────────────────

async function runBounded<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= tasks.length) return;
      const task = tasks[idx];
      if (!task) return;
      results[idx] = await task();
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(concurrency, tasks.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ── Aggregation helpers ────────────────────────────────

function dedupByPath(hits: readonly CondensedResult[]): CondensedResult[] {
  const byPath = new Map<string, CondensedResult>();
  const order: string[] = [];
  for (const hit of hits) {
    const key = `${hit.path}:${hit.line}`;
    const prev = byPath.get(key);
    if (!prev) {
      byPath.set(key, hit);
      order.push(key);
      continue;
    }
    // Keep the higher-relevance result.
    if (relevanceWeight(hit.relevance) > relevanceWeight(prev.relevance)) {
      byPath.set(key, hit);
    }
  }
  const out: CondensedResult[] = [];
  for (const key of order) {
    const v = byPath.get(key);
    if (v) out.push(v);
  }
  return out;
}

function sortByRelevance(hits: readonly CondensedResult[]): CondensedResult[] {
  const copy = [...hits];
  copy.sort((a, b) => {
    const dr = relevanceWeight(b.relevance) - relevanceWeight(a.relevance);
    if (dr !== 0) return dr;
    const dp = a.path.localeCompare(b.path);
    if (dp !== 0) return dp;
    return a.line - b.line;
  });
  return copy;
}

function relevanceWeight(level: Relevance): number {
  switch (level) {
    case "high":
      return 2;
    case "medium":
      return 1;
    case "low":
      return 0;
  }
}

// ── Re-exports for ergonomic single-import ─────────────

export type { CondensedResult, GrepSubagentReport, LlmQuery, Relevance } from "./grep-subagent.js";
export { runGrepSubagent } from "./grep-subagent.js";
