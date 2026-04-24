/**
 * `wotann review` — V9 Tier 14.1 port of Claude Code's `/ultrareview`.
 *
 * Claude Code's `/ultrareview` dispatches a cloud-hosted multi-agent code
 * review of the current branch or a GitHub PR, running several review
 * dimensions (security, performance, architecture, testing, style,
 * accessibility) in parallel and aggregating findings. We don't have a
 * cloud runner in this V9 session — this module ships the LOCAL
 * orchestration layer so the CLI command becomes usable today with an
 * injected reviewer, and a future commit can swap that injection for a
 * cloud-dispatched variant without touching the surface.
 *
 * Design contract (aligned with `grep.ts` / `design-verify.ts`):
 *   - Pure async function that returns a typed envelope — `ok:true` on
 *     success (even when some reviewers failed, per the spec: per-
 *     dimension failures never abort the overall review), `ok:false`
 *     only for hard errors (diff extraction fails, no reviewer provided).
 *   - No `console.log`, no `process.exit`. The CLI shell (src/index.ts)
 *     prints output.
 *   - Dependency injection everywhere: gitExec (so tests don't shell out),
 *     reviewer (so tests don't hit an LLM), now (so durations are
 *     deterministic).
 *   - Bounded-concurrency pool so a large dimension list doesn't
 *     self-DoS the reviewer provider.
 *
 * WOTANN quality bars:
 *   - QB #6 honest failures: reviewer throws are captured per-dimension
 *     and that dimension is excluded from `dimensionsRun`. The overall
 *     envelope stays `ok:true`, but the missing dimension is a
 *     detectable signal. No silent "zero findings" from a thrown error.
 *   - QB #7 per-call state: nothing mutable lives module-scope; every
 *     `runReview` builds its own pool.
 *   - QB #14 commit-claim verification: `formatReviewMarkdown` reflects
 *     what actually ran (dimension list, counts, per-dimension sections)
 *     — never a pre-baked "review passed" string.
 *
 * Spec deviations from the V9 line item ("`wotann review --cloud`"):
 *   - `--cloud` flag is deliberately NOT implemented here. The cloud
 *     runner doesn't exist in this session and adding a `--cloud` flag
 *     that falls back silently to local would violate QB #6. The
 *     command surface accepts any `ReviewerFn` (local or cloud) via
 *     injection; wiring `--cloud` to a real runner is a follow-up task.
 */

// ── Public types ─────────────────────────────────────────────

export type ReviewDimension =
  | "security"
  | "performance"
  | "architecture"
  | "testing"
  | "style"
  | "accessibility";

export const ALL_REVIEW_DIMENSIONS: readonly ReviewDimension[] = [
  "security",
  "performance",
  "architecture",
  "testing",
  "style",
  "accessibility",
];

export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ReviewTarget {
  readonly kind: "branch" | "pr" | "diff";
  /** Branch name or PR number (e.g. `#123`) — required for kind="branch"|"pr". */
  readonly ref?: string;
  /** Raw unified diff — required for kind="diff". */
  readonly diff?: string;
  /** Base ref for branch/pr (default `main`). Ignored for kind="diff". */
  readonly baseRef?: string;
}

export interface ReviewFinding {
  readonly dimension: ReviewDimension;
  readonly severity: ReviewSeverity;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly suggestion?: string;
}

export interface ReviewerContext {
  readonly target: ReviewTarget;
  readonly diffText: string;
  readonly dimension: ReviewDimension;
}

/**
 * Dispatches one dimension. The caller decides whether this runs in
 * process (a pure heuristic scan), against a local LLM, or against a
 * cloud runner — `runReview` is agnostic.
 */
export type ReviewerFn = (ctx: ReviewerContext) => Promise<readonly ReviewFinding[]>;

/**
 * Sync or async git/gh shell. Returns stdout verbatim. Tests inject a
 * mock so no process spawn happens; the CLI shell wires a real one.
 */
export type GitExec = (args: readonly string[]) => string | Promise<string>;

export interface RunReviewOptions {
  readonly target: ReviewTarget;
  /** Default: all six dimensions. */
  readonly dimensions?: readonly ReviewDimension[];
  /** Injected dispatcher — one invocation per dimension. REQUIRED. */
  readonly reviewer: ReviewerFn;
  /** Inject git/gh shell. Not needed for kind="diff". */
  readonly gitExec?: GitExec;
  /** Max concurrent dimensions. Default 3. */
  readonly concurrency?: number;
  /** Inject clock for deterministic durationMs. Default Date.now. */
  readonly now?: () => number;
}

export interface DimensionFailure {
  readonly dimension: ReviewDimension;
  readonly reason: string;
}

export interface RunReviewResult {
  readonly ok: true;
  readonly target: ReviewTarget;
  readonly findings: readonly ReviewFinding[];
  readonly perDimensionCounts: Readonly<Record<ReviewDimension, number>>;
  readonly durationMs: number;
  /** Dimensions that completed. Missing entries ran but threw. */
  readonly dimensionsRun: readonly ReviewDimension[];
  /** Dimensions that threw — each entry has a reason. */
  readonly dimensionFailures: readonly DimensionFailure[];
  /** Raw diff used for the run (populated even for kind="diff"). */
  readonly diffText: string;
}

export interface RunReviewFailure {
  readonly ok: false;
  readonly error: string;
}

export type RunReviewOutcome = RunReviewResult | RunReviewFailure;

// ── Constants ────────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_BASE_REF = "main";

const SEVERITY_ORDER: Readonly<Record<ReviewSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ── Entry point ──────────────────────────────────────────────

/**
 * Execute a multi-dimension review.
 *
 * Envelope semantics:
 *   - `ok:false` => the run did not execute at all (e.g. diff
 *     extraction failed, no reviewer wired, no dimensions requested).
 *     `findings` is undefined.
 *   - `ok:true`  => at least one dimension attempted. Per-dimension
 *     failures are captured in `dimensionFailures`; the rest of the
 *     result reflects the dimensions that completed.
 *
 * @throws never — all errors surface through the envelope.
 */
export async function runReview(options: RunReviewOptions): Promise<RunReviewOutcome> {
  if (typeof options.reviewer !== "function") {
    return { ok: false, error: "reviewer function is required" };
  }

  const requestedDims = normaliseDimensions(options.dimensions);
  if (requestedDims.length === 0) {
    return { ok: false, error: "at least one review dimension is required" };
  }

  const now = options.now ?? Date.now;
  const start = now();

  // Resolve the diff text. The three target kinds have different
  // extraction paths; a failure here is an envelope-level failure
  // because no dimension can run without a diff to reason about.
  let diffText: string;
  try {
    diffText = await resolveDiffText(options.target, options.gitExec);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `failed to extract diff: ${reason}` };
  }

  const concurrency = clampConcurrency(options.concurrency, requestedDims.length);

  // Track in-order per-dimension outcome so we can surface failures
  // distinctly from successful-but-empty dimensions. The spec requires
  // that a thrown reviewer leave the dimension OUT of dimensionsRun
  // rather than represented as "ran with 0 findings" — otherwise a
  // caller cannot tell the two apart.
  const findingsByDim = new Map<ReviewDimension, readonly ReviewFinding[]>();
  const failures: DimensionFailure[] = [];

  await dispatchPool(requestedDims, concurrency, async (dim) => {
    try {
      const ctx: ReviewerContext = {
        target: options.target,
        diffText,
        dimension: dim,
      };
      const out = await options.reviewer(ctx);
      // Guard against reviewers that return non-arrays (e.g. `undefined`
      // from a pass-through stub). Treat as empty rather than crashing
      // the whole run — QB #6: honest, not silent. We also normalise
      // each finding's `dimension` so a reviewer that forgets to set it
      // is still correctly attributed.
      const normalised = Array.isArray(out)
        ? out.map((f) => (f.dimension === dim ? f : { ...f, dimension: dim }))
        : [];
      findingsByDim.set(dim, normalised);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ dimension: dim, reason });
    }
  });

  const dimensionsRun: ReviewDimension[] = [];
  const perDimensionCounts = emptyCounts();
  const allFindings: ReviewFinding[] = [];

  for (const dim of requestedDims) {
    const findings = findingsByDim.get(dim);
    if (findings === undefined) continue; // failed — excluded from dimensionsRun
    dimensionsRun.push(dim);
    perDimensionCounts[dim] = findings.length;
    for (const f of findings) allFindings.push(f);
  }

  const sorted = sortFindings(allFindings);
  const durationMs = Math.max(0, now() - start);

  return {
    ok: true,
    target: options.target,
    findings: sorted,
    perDimensionCounts,
    durationMs,
    dimensionsRun,
    dimensionFailures: failures,
    diffText,
  };
}

// ── Formatting ───────────────────────────────────────────────

/**
 * Produce a markdown report suitable for a PR comment or a terminal
 * paste. Grouped by severity (critical first), with a per-dimension
 * count summary and an explicit "No issues found" footer when empty.
 *
 * Deterministic output: the same `RunReviewResult` always renders the
 * same string (modulo the durationMs line, which the caller can
 * override by injecting `now`).
 */
export function formatReviewMarkdown(result: RunReviewResult): string {
  const lines: string[] = [];
  lines.push(`# Review — ${describeTarget(result.target)}`);
  lines.push("");
  lines.push(summaryLine(result));

  if (result.dimensionFailures.length > 0) {
    lines.push("");
    lines.push("## Dimension failures");
    for (const f of result.dimensionFailures) {
      lines.push(`- **${f.dimension}**: ${f.reason}`);
    }
  }

  lines.push("");
  lines.push("## Per-dimension");
  for (const dim of ALL_REVIEW_DIMENSIONS) {
    if (!result.dimensionsRun.includes(dim)) continue;
    const count = result.perDimensionCounts[dim];
    lines.push(`- **${dim}**: ${count} finding${count === 1 ? "" : "s"}`);
  }

  if (result.findings.length === 0) {
    lines.push("");
    lines.push("No issues found.");
    return lines.join("\n");
  }

  const groups = groupBySeverity(result.findings);
  for (const sev of severityOrderList()) {
    const group = groups[sev];
    if (!group || group.length === 0) continue;
    lines.push("");
    lines.push(`## ${titleCase(sev)} (${group.length})`);
    for (const finding of group) {
      lines.push(renderFinding(finding));
    }
  }
  return lines.join("\n");
}

function summaryLine(result: RunReviewResult): string {
  const total = result.findings.length;
  const ran = result.dimensionsRun.length;
  const failed = result.dimensionFailures.length;
  const failedNote = failed > 0 ? `, ${failed} failed` : "";
  return `Ran ${ran} dimension${ran === 1 ? "" : "s"}${failedNote} in ${result.durationMs}ms — ${total} total finding${total === 1 ? "" : "s"}.`;
}

function renderFinding(finding: ReviewFinding): string {
  const location = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
  const lines: string[] = [];
  lines.push(`- **[${finding.dimension}]** \`${location}\` — ${finding.message}`);
  if (finding.suggestion !== undefined && finding.suggestion.length > 0) {
    lines.push(`  - _Suggestion_: ${finding.suggestion}`);
  }
  return lines.join("\n");
}

function groupBySeverity(
  findings: readonly ReviewFinding[],
): Record<ReviewSeverity, ReviewFinding[]> {
  const out: Record<ReviewSeverity, ReviewFinding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: [],
  };
  for (const f of findings) {
    out[f.severity].push(f);
  }
  return out;
}

function severityOrderList(): readonly ReviewSeverity[] {
  return ["critical", "high", "medium", "low", "info"];
}

function titleCase(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

function describeTarget(target: ReviewTarget): string {
  switch (target.kind) {
    case "branch":
      return `branch \`${target.ref ?? "HEAD"}\` vs \`${target.baseRef ?? DEFAULT_BASE_REF}\``;
    case "pr":
      return `PR ${target.ref ?? "(unknown)"}`;
    case "diff":
      return `supplied diff (${(target.diff ?? "").length} bytes)`;
  }
}

// ── Diff extraction ──────────────────────────────────────────

async function resolveDiffText(
  target: ReviewTarget,
  gitExec: GitExec | undefined,
): Promise<string> {
  switch (target.kind) {
    case "diff": {
      if (typeof target.diff !== "string") {
        throw new Error("kind=diff requires target.diff");
      }
      return target.diff;
    }
    case "branch": {
      if (typeof gitExec !== "function") {
        throw new Error("kind=branch requires gitExec");
      }
      const base = target.baseRef ?? DEFAULT_BASE_REF;
      const head = target.ref ?? "HEAD";
      // Classic GitHub-style "review what this branch added on top of
      // base" diff. The triple-dot form is intentional — it asks git
      // for the diff against the merge-base, which is what reviewers
      // actually care about (ignores commits base got after branching).
      const out = await gitExec(["diff", "--no-color", `${base}...${head}`]);
      return out;
    }
    case "pr": {
      if (typeof gitExec !== "function") {
        throw new Error("kind=pr requires gitExec");
      }
      if (typeof target.ref !== "string" || target.ref.length === 0) {
        throw new Error("kind=pr requires target.ref (PR number or URL)");
      }
      // Strip a leading `#` so both "#123" and "123" work — `gh pr diff`
      // wants the number, URL, or branch. We only strip one leading `#`
      // so "##" stays invalid and surfaces honestly from gh.
      const ref = target.ref.startsWith("#") ? target.ref.slice(1) : target.ref;
      const out = await gitExec(["pr", "diff", ref]);
      return out;
    }
  }
}

// ── Internals ────────────────────────────────────────────────

function normaliseDimensions(
  requested: readonly ReviewDimension[] | undefined,
): readonly ReviewDimension[] {
  if (requested === undefined) return ALL_REVIEW_DIMENSIONS;
  // Preserve caller order but dedupe — a reviewer should not fire twice
  // for the same dimension if the caller accidentally listed it twice.
  const seen = new Set<ReviewDimension>();
  const out: ReviewDimension[] = [];
  for (const d of requested) {
    if (seen.has(d)) continue;
    if (!ALL_REVIEW_DIMENSIONS.includes(d)) continue; // defensive: bad input dropped, not thrown
    seen.add(d);
    out.push(d);
  }
  return out;
}

function clampConcurrency(requested: number | undefined, maxDims: number): number {
  const n = requested ?? DEFAULT_CONCURRENCY;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), maxDims);
}

function emptyCounts(): Record<ReviewDimension, number> {
  return {
    security: 0,
    performance: 0,
    architecture: 0,
    testing: 0,
    style: 0,
    accessibility: 0,
  };
}

/**
 * Bounded-concurrency pool. Dispatch each item through `task`, never
 * running more than `limit` in flight. Each task's errors are caught
 * inside the task (the caller's responsibility) — this pool only
 * handles scheduling, not error policy.
 */
async function dispatchPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < effectiveLimit; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          const item = items[idx];
          if (item === undefined) return;
          await task(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

function sortFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  // Copy before sort — callers may retain the input array. This is the
  // immutability bar from the coding-style rule: never mutate an input.
  const copy = [...findings];
  copy.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) return fileCmp;
    const la = a.line ?? Number.MAX_SAFE_INTEGER;
    const lb = b.line ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    return a.message.localeCompare(b.message);
  });
  return copy;
}
