/**
 * Agentless mode — type definitions.
 *
 * V9 T12.6: ports CMU/SWE-research "Agentless" paper. Three discrete phases —
 * LOCALIZE → REPAIR → VALIDATE — each emitting a typed artifact. No
 * autonomous loop; cost-bounded by construction.
 *
 * Paper baseline: 32% SWE-Bench Lite, $0.34/issue. WOTANN matches the
 * pattern but keeps everything pluggable so the rest of the harness
 * (shadow-git, test runner, model adapter) can be injected at runtime.
 */

/**
 * Issue input — minimal shape; can be extended by callers without breaking
 * downstream. Source field tracks where it came from (for telemetry).
 */
export interface AgentlessIssue {
  readonly title: string;
  readonly body: string;
  readonly source?: "cli" | "github" | "linear" | "jira" | "manual";
  readonly id?: string;
}

/**
 * Per-file localization candidate — a file ranked by keyword density.
 *
 * `score` is in [0, 1] — relative ranking only, not a probability.
 * `evidence` is the list of keyword hits that contributed to the score
 * (truncated to first 5 per file for readability).
 */
export interface LocalizeCandidate {
  readonly file: string;
  readonly score: number;
  readonly hitCount: number;
  readonly evidence: readonly string[];
}

/**
 * LOCALIZE phase output. `keywords` is what we extracted; `candidateFiles`
 * is the ranked list. Empty `candidateFiles` is OK — repair phase can
 * still try with raw issue text + project README. Never throws on no hits.
 */
export interface LocalizeResult {
  readonly keywords: readonly string[];
  readonly candidateFiles: readonly LocalizeCandidate[];
  readonly searchedRoots: readonly string[];
  readonly durationMs: number;
}

/**
 * REPAIR phase output. `diff` is a unified diff produced by the model;
 * `null` means we couldn't extract a diff from the response.
 *
 * `rawResponse` is kept so the orchestrator can log it on validation
 * failure (otherwise it's lost — and "model said something nonsensical"
 * is a real-world bug worth diagnosing).
 */
export interface RepairResult {
  readonly diff: string | null;
  readonly rawResponse: string;
  readonly modelUsed: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * VALIDATE phase output. Distinguishes:
 *   - tests passed → `{passed: true}`
 *   - tests failed → `{passed: false, testResult: {failed: N, ...}}`
 *   - apply failed → `{passed: false, applyError: "..."}`
 *
 * Branch state is always reverted on exit (try/finally in validate.ts).
 */
export interface ValidateResult {
  readonly passed: boolean;
  readonly applyError?: string;
  readonly testResult?: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  readonly branchUsed?: string;
  readonly durationMs: number;
}

/**
 * Final orchestrator output. `outcome` is the headline result; the
 * intermediates are kept so the caller can render a transcript.
 */
export interface OrchestratorResult {
  readonly outcome: "success" | "blocked-localize" | "blocked-repair" | "blocked-validate";
  readonly issue: AgentlessIssue;
  readonly localize: LocalizeResult;
  readonly repair?: RepairResult;
  readonly validate?: ValidateResult;
  readonly totalDurationMs: number;
}

/**
 * Pluggable model query — narrow contract so we don't leak provider types.
 */
export interface AgentlessModel {
  readonly name: string;
  query(
    prompt: string,
    opts?: { readonly maxTokens?: number },
  ): Promise<{
    readonly text: string;
    readonly tokensIn: number;
    readonly tokensOut: number;
  }>;
}

/**
 * Pluggable code search — accepts a keyword, returns files+hits.
 * Default impl uses ripgrep; tests inject a stub.
 */
export interface CodeSearchFn {
  (
    keyword: string,
    root: string,
  ): Promise<readonly { readonly file: string; readonly count: number }[]>;
}

/**
 * Pluggable test runner — applies a diff in a tmp branch, runs tests, returns result.
 * Default uses shadowGit + npm test; tests inject a stub.
 */
export interface TestRunnerFn {
  (diff: string): Promise<ValidateResult>;
}
