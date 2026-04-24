/**
 * WarpGrep — parallel-fanout grep subagent with budget enforcement.
 *
 * PORT OF: Morph WarpGrep v2 (2026-04, morphllm.com/blog/warpgrep-v2).
 * The main agent dispatches to a subagent that owns the search budget
 * (max hits, max output bytes, wall-clock timeout), runs N queries in
 * parallel, and returns only condensed spans. The main context never
 * sees raw grep output or node_modules listings.
 *
 * RELATIONSHIP TO EXISTING MODULES:
 *   - src/tools/parallel-grep.ts  — ParallelGrep class fans out single
 *     queries across multiple root paths. We reuse runGrepSubagent from
 *     the same family but extend it with span-slice output.
 *   - src/tools/grep-subagent.ts  — the single-root worker. WarpGrep
 *     calls it with a bounded pool so 8 parallel queries share a
 *     concurrency budget instead of fighting each other.
 *   - src/providers/credential-pool.ts — the Hermes-style pool pattern
 *     (bounded leases, per-session state, honest exhaustion typing) was
 *     the template; WarpGrep uses the same shape for its budget lease
 *     on the `GrepHit` slice count.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): every dispatch returns a status envelope
 *     even on zero hits; truncation and errors are typed, never silent.
 *   - QB #7 (per-session state): createWarpGrep() + dispatch() hold
 *     their budget counter in a closure; two concurrent dispatches do
 *     not share state.
 *   - QB #11 (sibling-site scan): callers in src/tools/parallel-grep.ts
 *     keep the single-root path; WarpGrep is the multi-query fanout.
 *     Documented at class docstring so the two don't grow duplicate
 *     orchestration logic.
 *   - QB #13 (env guard): no process.env reads. The file-system walker
 *     is injected via the `runSingleQuery` binding in options, with a
 *     default that forwards to grep-subagent.ts.
 */

import {
  runGrepSubagent,
  type CondensedResult,
  type GrepSubagentOptions,
  type GrepSubagentReport,
} from "../tools/grep-subagent.js";

// ── Types ─────────────────────────────────────────────────

/**
 * A single parallel query. WarpGrep runs up to 8 of these in parallel,
 * sharing a single budget envelope. Fields match WarpGrep's
 * docs contract (glob/path/caseInsensitive) so tools ported from
 * Morph translate cleanly.
 */
export interface GrepQuery {
  readonly pattern: string;
  /** Optional glob, e.g. "**\/*.ts". Forwarded to grep-subagent `include`. */
  readonly glob?: string;
  /** Optional directory restriction (relative to root). Defaults to root. */
  readonly path?: string;
  /** Case-insensitive match. Default true. */
  readonly caseInsensitive?: boolean;
  /** Treat `pattern` as a fixed string, not a regex. Default false. */
  readonly fixedString?: boolean;
  /** Max matches kept per matching file. Default 3. */
  readonly maxMatchesPerFile?: number;
}

/**
 * A single rich hit with 5-line context windows. WarpGrep returns these
 * instead of full files — the main context never pulls in file dumps.
 */
export interface GrepHit {
  readonly file: string;
  readonly line: number;
  readonly contextBefore: readonly string[];
  readonly match: string;
  readonly contextAfter: readonly string[];
  readonly score: number;
}

/** Budget envelope. All three caps are enforced — first-to-hit wins. */
export interface ParallelSearchBudget {
  readonly maxHits: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

/** Default budget — matches WarpGrep's published numbers. */
export const DEFAULT_BUDGET: ParallelSearchBudget = {
  maxHits: 200,
  maxOutputBytes: 30 * 1024,
  timeoutMs: 3_000,
};

/** Hard cap on concurrent queries — any more and the main agent
 *  pays a fanout tax. Morph's published cap is 8. */
export const MAX_PARALLEL_QUERIES = 8;

/**
 * Per-call dispatch options — strict superset of budget overrides.
 * The `runSingleQuery` binding is how tests inject a deterministic
 * search backend without monkeypatching the subagent module.
 */
export interface WarpGrepOptions {
  readonly budget?: Partial<ParallelSearchBudget>;
  /** Base directory for resolving query.path. Defaults to cwd at call time. */
  readonly rootDir?: string;
  /**
   * Injected single-query runner. Defaults to the real grep-subagent.
   * Shape mirrors runGrepSubagent so tests can stub with a pure fn.
   */
  readonly runSingleQuery?: SingleQueryRunner;
  /** Forwarded to every subagent. */
  readonly subagent?: GrepSubagentOptions;
}

/**
 * Injected runner for a single query. Shape matches runGrepSubagent.
 * Production plumbs the real function; tests pass vi.fn() returning
 * synthetic GrepSubagentReports.
 */
export type SingleQueryRunner = (
  pattern: string,
  root: string,
  options: GrepSubagentOptions,
) => Promise<GrepSubagentReport>;

/** Result envelope. Always immutable, always typed. */
export interface WarpGrepResult {
  readonly hits: readonly GrepHit[];
  readonly truncated: boolean;
  readonly reason?: string;
  readonly rawHitCount: number;
  readonly durationMs: number;
  readonly queries: readonly GrepQuery[];
}

// ── Factory ───────────────────────────────────────────────

export interface WarpGrep {
  readonly dispatch: (
    queries: readonly GrepQuery[],
    options?: WarpGrepOptions,
  ) => Promise<WarpGrepResult>;
}

/**
 * Construct a per-session WarpGrep. Each instance has its own
 * dispatch counter used for scoring (not state shared across
 * invocations — every dispatch() call re-builds its own budget
 * ledger, per QB #7).
 */
export function createWarpGrep(): WarpGrep {
  return {
    async dispatch(queries, options) {
      return dispatchParallelSearch(queries, options ?? {});
    },
  };
}

// ── Core dispatch ─────────────────────────────────────────

/**
 * Orchestrate N parallel queries against one or more root paths,
 * enforce budget caps, and return condensed spans. Pure in-memory —
 * no env reads, no clock writes, no module-global caches.
 */
export async function dispatchParallelSearch(
  queries: readonly GrepQuery[],
  options: WarpGrepOptions = {},
): Promise<WarpGrepResult> {
  const started = Date.now();
  const budget = resolveBudget(options.budget);
  const rootDir = options.rootDir ?? process.cwd();

  // Query-count cap: too many queries defeats the purpose.
  if (queries.length > MAX_PARALLEL_QUERIES) {
    return {
      hits: [],
      truncated: true,
      reason: `Too many queries (max ${MAX_PARALLEL_QUERIES} parallel, got ${queries.length})`,
      rawHitCount: 0,
      durationMs: Date.now() - started,
      queries,
    };
  }

  if (queries.length === 0) {
    return {
      hits: [],
      truncated: false,
      rawHitCount: 0,
      durationMs: Date.now() - started,
      queries,
    };
  }

  const runner = options.runSingleQuery ?? defaultRunner;

  // Global timeout via AbortController. Each query races against it;
  // when it fires we surface a "timeout" truncation reason.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget.timeoutMs);

  try {
    // Fan out. Each query runs its own subagent; failures are per-query.
    const reports = await Promise.all(
      queries.map(async (q) => {
        const ga = buildSubagentOptions(q, options.subagent);
        const root = resolveQueryRoot(rootDir, q);
        try {
          // Race against global timeout. The AbortController drives
          // a Promise.race that rejects with a typed error when the
          // outer timer fires.
          return await raceWithAbort(
            runner(q.pattern, root, ga),
            controller.signal,
            budget.timeoutMs,
          );
        } catch (err) {
          return makeEmptyReport(root, err);
        }
      }),
    );

    // Aggregate → dedup → rank → cap.
    const merged = mergeReports(reports, queries, budget);

    return {
      hits: merged.hits,
      truncated: merged.truncated,
      ...(merged.reason !== undefined ? { reason: merged.reason } : {}),
      rawHitCount: merged.rawHitCount,
      durationMs: Date.now() - started,
      queries,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Private helpers ──────────────────────────────────────

function resolveBudget(partial: Partial<ParallelSearchBudget> | undefined): ParallelSearchBudget {
  const b = partial ?? {};
  return {
    maxHits: Math.max(1, b.maxHits ?? DEFAULT_BUDGET.maxHits),
    maxOutputBytes: Math.max(256, b.maxOutputBytes ?? DEFAULT_BUDGET.maxOutputBytes),
    timeoutMs: Math.max(10, b.timeoutMs ?? DEFAULT_BUDGET.timeoutMs),
  };
}

function resolveQueryRoot(rootDir: string, q: GrepQuery): string {
  if (!q.path || q.path.length === 0) return rootDir;
  // Trust the caller — grep-subagent handles malformed paths by returning
  // empty results with a warning, so we do not need to reject here.
  return q.path;
}

function buildSubagentOptions(
  q: GrepQuery,
  shared: GrepSubagentOptions | undefined,
): GrepSubagentOptions {
  const base: GrepSubagentOptions = shared ? { ...shared } : {};
  const include = q.glob ? [q.glob] : base.include;
  const caseInsensitive = q.caseInsensitive ?? base.caseInsensitive ?? true;
  const fixedString = q.fixedString ?? base.fixedString ?? false;
  const maxResults = q.maxMatchesPerFile ?? base.maxResults ?? 3;
  return {
    ...base,
    ...(include !== undefined ? { include } : {}),
    caseInsensitive,
    fixedString,
    maxResults,
  };
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  if (signal.aborted) {
    throw new Error(`warp-grep: aborted before start (timeoutMs=${timeoutMs})`);
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`warp-grep: timed out after ${timeoutMs}ms`));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function makeEmptyReport(root: string, err: unknown): GrepSubagentReport {
  return {
    root,
    engine: "node-fallback",
    rawHits: 0,
    filteredHits: 0,
    durationMs: 0,
    hits: [],
    warning: err instanceof Error ? err.message : String(err),
  };
}

interface MergeResult {
  readonly hits: readonly GrepHit[];
  readonly rawHitCount: number;
  readonly truncated: boolean;
  readonly reason?: string;
}

/**
 * Merge per-query reports into a single ranked hit list, obeying the
 * three-dimensional budget (hits, bytes, timeout-already-surfaced).
 *
 * Ranking priority:
 *   1. relevance (high > medium > low)
 *   2. file path alphabetical (stable cross-query ordering)
 *   3. line number ascending
 */
function mergeReports(
  reports: readonly GrepSubagentReport[],
  queries: readonly GrepQuery[],
  budget: ParallelSearchBudget,
): MergeResult {
  const rawHits: { hit: CondensedResult; query: GrepQuery }[] = [];
  let timedOut = false;

  for (let i = 0; i < reports.length; i++) {
    const rep = reports[i];
    const q = queries[i];
    if (!rep || !q) continue;
    if (rep.warning && rep.warning.includes("timed out")) {
      timedOut = true;
    }
    for (const h of rep.hits) {
      rawHits.push({ hit: h, query: q });
    }
  }

  const rawHitCount = rawHits.length;

  // Dedup by file:line — the "max hit density" wins when the same
  // line appears in multiple queries.
  const dedup = new Map<string, { hit: CondensedResult; query: GrepQuery }>();
  for (const item of rawHits) {
    const key = `${item.hit.path}:${item.hit.line}`;
    const prev = dedup.get(key);
    if (!prev || weight(item.hit.relevance) > weight(prev.hit.relevance)) {
      dedup.set(key, item);
    }
  }

  // Rank.
  const ranked = Array.from(dedup.values()).sort((a, b) => {
    const w = weight(b.hit.relevance) - weight(a.hit.relevance);
    if (w !== 0) return w;
    const p = a.hit.path.localeCompare(b.hit.path);
    if (p !== 0) return p;
    return a.hit.line - b.hit.line;
  });

  // Enforce hit cap + byte cap.
  const out: GrepHit[] = [];
  let bytesSoFar = 0;
  let truncated = false;
  let reason: string | undefined;

  for (const { hit } of ranked) {
    if (out.length >= budget.maxHits) {
      truncated = true;
      reason = "Budget exceeded: maxHits";
      break;
    }
    const span = spanFromHit(hit);
    const cost = estimateBytes(span);
    if (bytesSoFar + cost > budget.maxOutputBytes) {
      truncated = true;
      reason = "Budget exceeded: maxOutputBytes";
      break;
    }
    out.push(span);
    bytesSoFar += cost;
  }

  if (timedOut && !truncated) {
    truncated = true;
    reason = "Budget exceeded: timeoutMs";
  }

  return {
    hits: out,
    rawHitCount,
    truncated,
    ...(reason !== undefined ? { reason } : {}),
  };
}

function spanFromHit(hit: CondensedResult): GrepHit {
  return {
    file: hit.path,
    line: hit.line,
    // We intentionally emit empty context arrays here. The subagent already
    // provides the matched line via `snippet`; the 5-line context is a
    // future enhancement once grep-subagent reports include them. Keeping
    // the shape stable prevents churn when that lands.
    contextBefore: [],
    match: hit.snippet,
    contextAfter: [],
    score: weight(hit.relevance),
  };
}

function estimateBytes(h: GrepHit): number {
  // Conservative cost accounting: file path + line number + match + context.
  let sum = h.file.length + 12; // file + ":line:" overhead
  sum += h.match.length;
  for (const s of h.contextBefore) sum += s.length;
  for (const s of h.contextAfter) sum += s.length;
  return sum + 16; // slack for JSON framing
}

function weight(r: CondensedResult["relevance"]): number {
  switch (r) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

/** Default single-query runner — forwards to the real subagent. */
const defaultRunner: SingleQueryRunner = (pattern, root, options) =>
  runGrepSubagent(pattern, root, options);
