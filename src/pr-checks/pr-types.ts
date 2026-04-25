/**
 * PR Checks — type definitions.
 *
 * V9 T12.5: Continue.dev PR-as-status-check. Markdown-described PR checks
 * declared in `.wotann/checks/*.md` get evaluated by a model on every PR
 * and posted as GitHub Check Runs. Types are strict and immutable so the
 * runner can pass them across module boundaries without aliasing risk.
 */

/**
 * Severity of a check — controls whether a FAIL blocks merge.
 *
 * - `blocking`: GitHub Check conclusion = `failure` on FAIL (blocks merge if branch protection requires it)
 * - `advisory`: GitHub Check conclusion = `neutral` on FAIL (annotated, doesn't block)
 */
export type PrCheckSeverity = "blocking" | "advisory";

/**
 * Status returned by a single check evaluation.
 *
 * - `pass`:    model emitted `PASS` or `PASS:` line. Maps to GitHub conclusion `success`.
 * - `fail`:    model emitted `FAIL: <reason>`. Conclusion depends on severity.
 * - `neutral`: response was unparseable (model didn't follow format). Conclusion `neutral` always.
 * - `error`:   harness-level failure (model unreachable, diff too big). Conclusion `neutral` + warning.
 */
export type PrCheckStatus = "pass" | "fail" | "neutral" | "error";

/**
 * A check definition parsed from `.wotann/checks/<id>.md`.
 *
 * Frontmatter fields (YAML):
 *   id:        unique check id (must match filename minus `.md`)
 *   severity:  blocking | advisory
 *   provider:  optional — model provider override (default: anthropic)
 *   model:     optional — model id (default: sonnet)
 *
 * Body: free-form markdown; embedded as the SYSTEM PROMPT for the subagent.
 */
export interface PrCheckDef {
  readonly id: string;
  readonly severity: PrCheckSeverity;
  readonly provider: string;
  readonly model: string;
  readonly body: string;
  readonly filename: string;
}

/**
 * Result of executing a single check on one PR diff.
 *
 * `message` is short (< 200 chars) and already-trimmed — safe to use as
 * the GitHub Check `summary` text directly.
 */
export interface PrCheckResult {
  readonly id: string;
  readonly status: PrCheckStatus;
  readonly message: string;
  readonly severity: PrCheckSeverity;
  readonly durationMs: number;
}

/**
 * Aggregate of all check results for a single PR run.
 *
 * `overall` = the worst conclusion across all results.
 * - any fail+blocking → "failure"
 * - any fail+advisory or any neutral → "neutral"
 * - otherwise → "success"
 */
export interface PrCheckRunSummary {
  readonly results: readonly PrCheckResult[];
  readonly overall: GitHubCheckConclusion;
  readonly totalDurationMs: number;
}

/**
 * GitHub Check Run conclusion. Mirrors the GitHub Checks API enum.
 * https://docs.github.com/en/rest/checks/runs
 */
export type GitHubCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required";

/**
 * Per-check function signature — pluggable so tests can inject mocks
 * without monkey-patching globals.
 *
 * Implementations MUST NOT throw — return `{status: "error", ...}` instead.
 */
export type RunCheckFn = (check: PrCheckDef, prDiff: string) => Promise<PrCheckResult>;
