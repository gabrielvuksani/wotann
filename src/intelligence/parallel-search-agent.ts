/**
 * T12.3 — Parallel Search Agent (~180 LOC, V9 §T12.3 WarpGrep wrapper).
 *
 * Thin agent-side wrapper around the {@link ParallelSearchDispatcher}
 * primitive in `./parallel-search.ts`. The primitive exposes a single-
 * query, multi-source search; the agent surface accepts a *list* of
 * queries, fans them out concurrently with a hard budget, and returns a
 * ranked, deduplicated, size-bounded result set the model can consume.
 *
 * Why a wrapper? The primitive has no concept of:
 *
 *   - **Query budgets** — a model can ask for 50 queries and starve the
 *     event loop. We cap at 8 queries per call.
 *   - **Output budgets** — raw results can be megabytes; LLM context is
 *     scarce. We cap at 200 hits and 30KB of serialised content.
 *   - **Wall-clock budget** — the primitive blocks until every source
 *     finishes; we abort at 3000ms so the model never stalls waiting on
 *     git-history / academic searches.
 *   - **Honest envelopes** — the primitive throws on bad input. The agent
 *     wrapper catches and returns `{ok:false, error, ...}` so the model
 *     gets a structured failure (QB #6).
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: every failure path returns
 *     `{ok:false, reason, error}` — never throws into the dispatch layer.
 *   - QB #7  per-call state: no module-level state. Each call constructs
 *     a fresh ParallelSearchDispatcher.
 *   - QB #10 sibling-site safety: the runtime tool dispatch case in
 *     `runtime-tool-dispatch.ts` is the single emit site. No parallel
 *     construction of the primitive elsewhere.
 *   - QB #13 env guard: never reads process.env. Workspace dir is passed
 *     via context.
 */

import {
  ParallelSearchDispatcher,
  type SearchType,
  type SearchResult,
  type SearchConfig,
} from "./parallel-search.js";

// ── Public types ────────────────────────────────────────────

/** Re-exported as the agent-facing hit shape. The underlying primitive
 *  uses `SearchResult` — keep them isomorphic so callers (runtime
 *  dispatch, TUI search overlay) can pivot between the two without a
 *  shim layer. */
export type SearchHit = SearchResult;

export interface ParallelSearchAgentContext {
  /** Workspace directory the codebase / git-history searches operate on. */
  readonly workspaceDir: string;
  /** Optional memory search backend. Skipped when null. */
  readonly memorySearchFn?: (query: string) => readonly SearchResult[];
}

export interface ParallelSearchAgentBudget {
  /** Max queries fanned out. Defaults to {@link MAX_QUERIES}. */
  readonly maxQueries?: number;
  /** Max hits in the merged result. Defaults to {@link MAX_HITS}. */
  readonly maxHits?: number;
  /** Max bytes of `content` retained across hits. Defaults to {@link MAX_OUTPUT_BYTES}. */
  readonly maxOutputBytes?: number;
  /** Wall-clock budget. Defaults to {@link MAX_WALLCLOCK_MS}. */
  readonly maxWallclockMs?: number;
  /** Optional restriction of search sources. Defaults to all sources. */
  readonly sources?: readonly SearchType[];
}

export interface ParallelSearchOk {
  readonly ok: true;
  readonly hits: readonly SearchHit[];
  readonly totalHits: number;
  readonly truncated: {
    readonly byQueryCap: boolean;
    readonly byHitCap: boolean;
    readonly byByteCap: boolean;
    readonly byWallclock: boolean;
  };
  readonly durationMs: number;
}

export interface ParallelSearchFail {
  readonly ok: false;
  readonly error: string;
  readonly reason: "no-queries" | "invalid-input" | "primitive-threw";
}

export type ParallelSearchResult = ParallelSearchOk | ParallelSearchFail;

// ── Defaults (per spec) ─────────────────────────────────────

export const MAX_QUERIES = 8;
export const MAX_HITS = 200;
export const MAX_OUTPUT_BYTES = 30 * 1024;
export const MAX_WALLCLOCK_MS = 3000;

// ── Implementation ──────────────────────────────────────────

/**
 * Fan out a list of queries through the parallel-search primitive,
 * merge + rank + budget the result, and hand back an honest envelope.
 *
 * Behaviour notes:
 *
 *   - Empty / non-string queries are silently dropped (filter, not error).
 *   - When ALL queries are dropped the result is `{ok:false, reason:"no-queries"}`.
 *   - Wall-clock budget is enforced via Promise.race against a timer; the
 *     in-flight primitive calls aren't aborted (the primitive doesn't
 *     accept an AbortSignal), but their results are discarded once the
 *     timer fires. `truncated.byWallclock` is set to true so the caller
 *     can surface "partial results".
 */
export async function dispatchParallelSearch(
  queries: readonly unknown[],
  budget: ParallelSearchAgentBudget,
  ctx: ParallelSearchAgentContext,
): Promise<ParallelSearchResult> {
  if (typeof ctx.workspaceDir !== "string" || ctx.workspaceDir.length === 0) {
    return {
      ok: false,
      reason: "invalid-input",
      error: "parallel_search: workspaceDir must be a non-empty string",
    };
  }

  const maxQueries = budget.maxQueries && budget.maxQueries > 0 ? budget.maxQueries : MAX_QUERIES;
  const maxHits = budget.maxHits && budget.maxHits > 0 ? budget.maxHits : MAX_HITS;
  const maxOutputBytes =
    budget.maxOutputBytes && budget.maxOutputBytes > 0 ? budget.maxOutputBytes : MAX_OUTPUT_BYTES;
  const maxWallclockMs =
    budget.maxWallclockMs && budget.maxWallclockMs > 0 ? budget.maxWallclockMs : MAX_WALLCLOCK_MS;

  // Normalise + cap the query list.
  const cleaned: string[] = [];
  for (const raw of queries) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    cleaned.push(trimmed);
  }
  if (cleaned.length === 0) {
    return {
      ok: false,
      reason: "no-queries",
      error: "parallel_search: no non-empty string queries supplied",
    };
  }
  const byQueryCap = cleaned.length > maxQueries;
  const queryList = byQueryCap ? cleaned.slice(0, maxQueries) : cleaned;

  const config: SearchConfig = {
    workspaceDir: ctx.workspaceDir,
    maxResultsPerSource: Math.max(1, Math.ceil(maxHits / queryList.length)),
    ...(ctx.memorySearchFn ? { memorySearchFn: ctx.memorySearchFn } : {}),
  };
  const dispatcher = new ParallelSearchDispatcher(config);

  const startedAt = Date.now();

  // Wallclock race — Promise.race against a timeout. The primitive lacks
  // AbortSignal so the racing promise's rejection is the cancellation
  // signal: the in-flight searches keep running but their results are
  // ignored once the race resolves.
  let byWallclock = false;
  let allResults: SearchResult[];
  try {
    const racing = Promise.all(
      queryList.map((q) => dispatcher.search(q, budget.sources).then((r) => r.results)),
    ).then((arrays) => arrays.flat());

    const timer = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("__wallclock__")), maxWallclockMs);
    });

    allResults = (await Promise.race([racing, timer])) as SearchResult[];
  } catch (err) {
    if (err instanceof Error && err.message === "__wallclock__") {
      byWallclock = true;
      allResults = [];
    } else {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: "primitive-threw",
        error: `parallel_search: dispatcher threw — ${reason}`,
      };
    }
  }

  // Dedup by (source,title,content-prefix) so the same hit from multiple
  // queries collapses. Sort by score descending; cap by hit count and
  // byte budget.
  const seen = new Set<string>();
  const ranked: SearchHit[] = [];
  for (const hit of allResults.sort((a, b) => b.score - a.score)) {
    const key = `${hit.source}::${hit.title}::${hit.content.slice(0, 64)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(hit);
  }

  let runningBytes = 0;
  const capped: SearchHit[] = [];
  let byByteCap = false;
  for (const hit of ranked) {
    if (capped.length >= maxHits) break;
    const size = hit.content.length + hit.title.length;
    if (runningBytes + size > maxOutputBytes) {
      byByteCap = true;
      break;
    }
    runningBytes += size;
    capped.push(hit);
  }
  const byHitCap = ranked.length > capped.length && !byByteCap;

  return {
    ok: true,
    hits: capped,
    totalHits: ranked.length,
    truncated: { byQueryCap, byHitCap, byByteCap, byWallclock },
    durationMs: Date.now() - startedAt,
  };
}
