/**
 * `wotann grep` — semantic code search via B9 ParallelGrep (Morph
 * WarpGrep v2 port). Wires the library shipped in
 * `src/tools/parallel-grep.ts` to the CLI surface so users can actually
 * invoke it from a shell; prior to this wiring the library had zero
 * runtime callers.
 *
 * Design contract:
 *   - Default behaviour (no flags) => single-worker sequential dispatch
 *     over cwd. Same semantics as a plain grep for discovery; no tokens
 *     spent.
 *   - `--parallel` fans out 4 workers across the supplied paths (or cwd
 *     if none given). Concurrency cap is honored regardless of root
 *     count by the underlying ParallelGrep.
 *   - `--relevance-filter` enables the optional LLM scorer. When no
 *     LlmQuery is injected (test path) or when the caller opts out,
 *     the heuristic ripgrep-only ranking is returned unchanged and a
 *     warning is surfaced on the result so the user isn't misled.
 *   - `--json` returns the raw `ParallelGrepReport` verbatim so tooling
 *     can pipe it. Human output is line-based and respects terminal
 *     width (capped at 160 chars to avoid runaway wrapping).
 *
 * Honest fallbacks (QB #6):
 *   - ripgrep unavailable => ParallelGrep's subagent falls back to the
 *     node walker; `report.usedFallback` is true and the engine field
 *     on each subagent report says `node-fallback`. The printed output
 *     surfaces this so the caller knows which backend produced results.
 *   - no paths passed => `[process.cwd()]` — honest default, not silent.
 *   - relevance-filter requested with no provider => we leave
 *     `llmQuery` unset, tag `relevanceFilterAvailable=false`, and add
 *     a warning line so users know the flag was a no-op.
 *
 * Per-session state (QB #7): every `runGrep` call constructs a fresh
 * `ParallelGrep`. Two concurrent CLI invocations share zero mutable
 * state.
 */

import type { Command } from "commander";
import { ParallelGrep } from "../../tools/parallel-grep.js";
import type { CondensedResult, LlmQuery, ParallelGrepReport } from "../../tools/parallel-grep.js";

// ── Public types ─────────────────────────────────────────────

export interface GrepCommandOptions {
  /** When true, fan out across paths with 4 workers. Default false (N=1). */
  readonly parallel?: boolean;
  /** Top-K aggregate cap. Default 20. */
  readonly topK?: number;
  /** Emit JSON to the caller. Default false. */
  readonly json?: boolean;
  /** Enable LLM relevance filter. Requires `llmQuery` to actually fire. */
  readonly relevanceFilter?: boolean;
  /**
   * Injectable LLM callback. When `relevanceFilter` is true but this is
   * omitted, the command records the fallback in the report so callers
   * know the flag had no effect.
   */
  readonly llmQuery?: LlmQuery;
  /** Override worker count when `parallel` is true. Default 4. */
  readonly parallelism?: number;
  /**
   * Override the ParallelGrep for tests (e.g. to exercise a specific
   * engine without touching the filesystem).
   */
  readonly grep?: ParallelGrep;
}

export interface GrepResult {
  readonly report: ParallelGrepReport;
  /** True when the user asked for LLM filtering AND an llmQuery was wired. */
  readonly relevanceFilterApplied: boolean;
  /**
   * Lines for human rendering. Always populated regardless of `json` so
   * the caller can choose the output format.
   */
  readonly lines: readonly string[];
  /**
   * Warnings synthesized by the command shell on top of the underlying
   * report warnings (e.g. "relevance-filter requested but no provider").
   */
  readonly extraWarnings: readonly string[];
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_TOP_K = 20;
const DEFAULT_PARALLEL_WORKERS = 4;
const TERM_WIDTH_MAX = 160;

// ── Entry point ──────────────────────────────────────────────

/**
 * Execute a grep dispatch. Pure logic — no `console.log`, no
 * `process.exit`. The CLI shell (src/index.ts) is responsible for
 * printing `lines` or the JSON payload and for the process exit code.
 *
 * @throws if `query` is empty (surfaced verbatim from ParallelGrep).
 */
export async function runGrep(
  query: string,
  paths: readonly string[],
  options: GrepCommandOptions = {},
): Promise<GrepResult> {
  // Honest default: no paths => cwd. The user sees exactly which root
  // was searched via the `report.roots` field in JSON mode.
  const rootPaths: readonly string[] = paths.length > 0 ? paths : [process.cwd()];

  const topK = normaliseTopK(options.topK);
  const parallel = options.parallel === true;
  const workers = parallel ? Math.max(1, options.parallelism ?? DEFAULT_PARALLEL_WORKERS) : 1;

  // Relevance-filter requested but no llmQuery => heuristic fallback.
  // We set `applied` based on whether we have a real callback to pass
  // through, not on whether the flag was set.
  const relevanceRequested = options.relevanceFilter === true;
  const relevanceApplied = relevanceRequested && typeof options.llmQuery === "function";

  // Per-session state (QB #7): allow injection for tests but default to
  // a fresh instance so concurrent CLI runs don't share caches.
  const pg = options.grep ?? new ParallelGrep();

  const dispatchOptions: Parameters<ParallelGrep["dispatch"]>[2] = {
    concurrency: workers,
    topK,
  };
  if (relevanceApplied && options.llmQuery) {
    // Only wire the LLM through when we actually have one. This keeps
    // the fallback note honest — `applied=false` means we did zero LLM
    // work, not that we tried and failed silently.
    (dispatchOptions as { llmQuery?: LlmQuery }).llmQuery = options.llmQuery;
  }

  const report = await pg.dispatch(query, rootPaths, dispatchOptions);

  const extraWarnings: string[] = [];
  if (relevanceRequested && !relevanceApplied) {
    extraWarnings.push(
      "--relevance-filter requested but no llmQuery provider wired; heuristic ranking returned instead.",
    );
  }

  const lines = options.json
    ? [] // caller will stringify the full GrepResult
    : renderLines(report, {
        relevanceFilterApplied: relevanceApplied,
        extraWarnings,
        termWidth: detectTermWidth(),
      });

  return {
    report,
    relevanceFilterApplied: relevanceApplied,
    lines,
    extraWarnings,
  };
}

// ── Commander registration ───────────────────────────────────

/**
 * Attach `wotann grep` to the CLI `program`. The shell is the
 * ONLY place that touches stdout and exit codes — the command module
 * itself stays testable without stubbing process.
 */
export function registerGrepCommand(program: Command): void {
  program
    .command("grep <query> [paths...]")
    .description(
      "Semantic grep via B9 ParallelGrep — ripgrep-first with node fallback, optional LLM relevance filter",
    )
    .option("--parallel", "Fan out across paths with 4 workers")
    .option(
      "--parallelism <n>",
      "Override worker count when --parallel is set",
      `${DEFAULT_PARALLEL_WORKERS}`,
    )
    .option("--top-k <n>", "Return top K results", `${DEFAULT_TOP_K}`)
    .option(
      "--relevance-filter",
      "Score hits with LLM relevance (requires provider; heuristic fallback otherwise)",
    )
    .option("--json", "Emit JSON instead of formatted text")
    .action(
      async (
        query: string,
        paths: string[],
        opts: {
          parallel?: boolean;
          parallelism?: string;
          topK?: string;
          relevanceFilter?: boolean;
          json?: boolean;
        },
      ) => {
        // LLM binding for relevance-filter is a separate wiring task.
        // Today the CLI shell deliberately leaves `llmQuery` unset so
        // the honest heuristic fallback kicks in (with an on-result
        // warning). Tests exercise the applied-path by calling
        // `runGrep` directly with an injected `llmQuery`. This keeps
        // the command shell free of provider/runtime knowledge.
        const llmQuery: LlmQuery | undefined = undefined;

        const runOpts: GrepCommandOptions = {
          parallel: opts.parallel === true,
          parallelism: opts.parallelism
            ? Math.max(1, Number.parseInt(opts.parallelism, 10) || DEFAULT_PARALLEL_WORKERS)
            : DEFAULT_PARALLEL_WORKERS,
          topK: opts.topK
            ? Math.max(1, Number.parseInt(opts.topK, 10) || DEFAULT_TOP_K)
            : DEFAULT_TOP_K,
          relevanceFilter: opts.relevanceFilter === true,
          json: opts.json === true,
          ...(llmQuery ? { llmQuery } : {}),
        };

        try {
          const result = await runGrep(query, paths ?? [], runOpts);
          if (opts.json) {
            process.stdout.write(JSON.stringify(serializeResult(result), null, 2) + "\n");
          } else {
            for (const line of result.lines) {
              process.stdout.write(line + "\n");
            }
          }
          // Non-zero exit only on outright failure; zero hits is a
          // legitimate answer, not an error.
          if (result.report.warnings.length > 0 && result.report.returnedHitCount === 0) {
            // Surface degraded runs with exit=2 so shell pipelines can
            // detect "something was weird but we returned no hits."
            process.exitCode = 2;
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          process.stderr.write(`grep error: ${reason}\n`);
          process.exitCode = 1;
        }
      },
    );
}

// ── Rendering ────────────────────────────────────────────────

interface RenderContext {
  readonly relevanceFilterApplied: boolean;
  readonly extraWarnings: readonly string[];
  readonly termWidth: number;
}

function renderLines(report: ParallelGrepReport, ctx: RenderContext): string[] {
  const lines: string[] = [];
  const engineLabel = report.usedFallback ? "ripgrep+node-fallback" : "ripgrep";
  const filterLabel = ctx.relevanceFilterApplied ? "llm" : "heuristic";

  lines.push(
    `grep "${truncate(report.query, 60)}" — ${report.returnedHitCount}/${report.rawHitCount} hit(s), ${report.roots.length} root(s), ${report.durationMs}ms (${engineLabel}, ${filterLabel})`,
  );

  if (ctx.extraWarnings.length > 0) {
    for (const w of ctx.extraWarnings) {
      lines.push(`  ! ${w}`);
    }
  }
  if (report.warnings.length > 0) {
    for (const w of report.warnings) {
      lines.push(`  ! ${w}`);
    }
  }

  if (report.hits.length === 0) {
    lines.push("  (no matches)");
    return lines;
  }

  for (const hit of report.hits) {
    lines.push(renderHit(hit, ctx.termWidth));
  }
  return lines;
}

function renderHit(hit: CondensedResult, termWidth: number): string {
  const prefix = `  ${hit.relevance.padEnd(6)} ${hit.path}:${hit.line}: `;
  const budget = Math.max(20, termWidth - prefix.length);
  return prefix + truncate(hit.snippet, budget);
}

function detectTermWidth(): number {
  // Respect the caller's terminal but cap so we don't produce absurdly
  // wide lines on 240-column monitors.
  const reported = typeof process.stdout.columns === "number" ? process.stdout.columns : 80;
  if (!Number.isFinite(reported) || reported <= 0) return 80;
  return Math.min(reported, TERM_WIDTH_MAX);
}

function truncate(raw: string, max: number): string {
  if (raw.length <= max) return raw;
  if (max <= 1) return raw.slice(0, max);
  return raw.slice(0, max - 1) + "…";
}

// ── JSON serialisation ───────────────────────────────────────

interface SerialisedGrepResult {
  readonly query: string;
  readonly roots: readonly string[];
  readonly returnedHitCount: number;
  readonly dedupedHitCount: number;
  readonly rawHitCount: number;
  readonly durationMs: number;
  readonly usedFallback: boolean;
  readonly relevanceFilterApplied: boolean;
  readonly warnings: readonly string[];
  readonly hits: readonly CondensedResult[];
}

function serializeResult(result: GrepResult): SerialisedGrepResult {
  const { report } = result;
  return {
    query: report.query,
    roots: report.roots,
    returnedHitCount: report.returnedHitCount,
    dedupedHitCount: report.dedupedHitCount,
    rawHitCount: report.rawHitCount,
    durationMs: report.durationMs,
    usedFallback: report.usedFallback,
    relevanceFilterApplied: result.relevanceFilterApplied,
    warnings: [...report.warnings, ...result.extraWarnings],
    hits: report.hits,
  };
}

// ── Utilities ────────────────────────────────────────────────

function normaliseTopK(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_TOP_K;
  if (requested < 1) return 1;
  return Math.floor(requested);
}
