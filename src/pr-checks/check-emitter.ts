/**
 * GitHub Check Run emitter — POSTs Check Run payloads to the GitHub Checks API.
 *
 * V9 T12.5: each PR-check result becomes a separate Check Run entry under
 * the PR (so reviewers see them listed individually). Uses the `application/vnd.github+json`
 * media type and the v2022-11-28 API contract.
 *
 * QB #6 (honest stubs): bad input fails with explicit error; transient API
 * failures retry per the spec (3 attempts, exponential backoff). No silent OK.
 *
 * SECURITY: token is read from `GITHUB_TOKEN` env var by default; tests inject
 * their own. Never log the token or the request body (PR diffs may contain
 * secrets that the no-hardcoded-secrets check is itself trying to flag).
 */

import type { GitHubCheckConclusion, PrCheckResult, PrCheckRunSummary } from "./pr-types.js";

export interface EmitConfig {
  /** repo slug `<owner>/<repo>` */
  readonly repo: string;
  /** head SHA the checks are anchored to */
  readonly headSha: string;
  /** GitHub token (Actions: secrets.GITHUB_TOKEN) */
  readonly token: string;
  /** Optional fetch shim — injectable for tests. */
  readonly fetchFn?: typeof fetch;
  /** Number of retries on transient (5xx) failures. Default 3. */
  readonly retries?: number;
  /** Optional sleep shim — injectable for tests. */
  readonly sleepFn?: (ms: number) => Promise<void>;
  /** Base URL for GitHub API. Default `https://api.github.com`. */
  readonly apiBase?: string;
}

export interface EmitResult {
  readonly ok: boolean;
  readonly checkRunId?: number;
  readonly statusCode?: number;
  readonly error?: string;
  readonly attempts: number;
}

/**
 * Emit a single Check Run for one check result.
 *
 * Returns `{ok: false, error: ...}` on failure (after retries) — never throws.
 *
 * Status codes treated as transient (retried): 502, 503, 504, 408, 429.
 * All other non-2xx codes return immediately with the status code surfaced.
 */
export async function emitCheckRun(result: PrCheckResult, config: EmitConfig): Promise<EmitResult> {
  if (!config.repo.includes("/")) {
    return { ok: false, error: "config.repo must be 'owner/name'", attempts: 0 };
  }
  if (!config.headSha) {
    return { ok: false, error: "config.headSha is required", attempts: 0 };
  }
  if (!config.token) {
    return { ok: false, error: "config.token is required", attempts: 0 };
  }

  const fetchFn = config.fetchFn ?? fetch;
  const sleepFn = config.sleepFn ?? defaultSleep;
  const retries = config.retries ?? 3;
  const apiBase = config.apiBase ?? "https://api.github.com";
  const url = `${apiBase}/repos/${config.repo}/check-runs`;
  const body = JSON.stringify(buildCheckRunPayload(result, config.headSha));

  let attempt = 0;
  let lastStatusCode: number | undefined;
  let lastError: string | undefined;

  while (attempt < retries) {
    attempt++;
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt >= retries) {
        return { ok: false, error: lastError, attempts: attempt };
      }
      await sleepFn(backoffMs(attempt));
      continue;
    }

    lastStatusCode = response.status;

    if (response.status >= 200 && response.status < 300) {
      let id: number | undefined;
      try {
        const parsed = (await response.json()) as { id?: number };
        if (typeof parsed.id === "number") id = parsed.id;
      } catch {
        // Body unparseable but status was 2xx — still success, just no id.
      }
      return { ok: true, checkRunId: id, statusCode: response.status, attempts: attempt };
    }

    if (!isTransient(response.status)) {
      let errBody = "";
      try {
        errBody = (await response.text()).slice(0, 256);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        statusCode: response.status,
        error: `GitHub API non-transient ${response.status}: ${errBody || "no body"}`,
        attempts: attempt,
      };
    }

    if (attempt >= retries) {
      return {
        ok: false,
        statusCode: response.status,
        error: `GitHub API transient ${response.status} after ${attempt} attempts`,
        attempts: attempt,
      };
    }
    await sleepFn(backoffMs(attempt));
  }

  return {
    ok: false,
    statusCode: lastStatusCode,
    error: lastError ?? "unknown emit failure",
    attempts: attempt,
  };
}

/**
 * Emit all results in a summary. Continues on failure — returns array of
 * EmitResult in same order as `summary.results` so callers can correlate.
 *
 * Per-call state (QB #7): does NOT mutate config; each emit gets its own
 * retry counter independent of siblings.
 */
export async function emitAllChecks(
  summary: PrCheckRunSummary,
  config: EmitConfig,
): Promise<readonly EmitResult[]> {
  const out: EmitResult[] = [];
  for (const result of summary.results) {
    const r = await emitCheckRun(result, config);
    out.push(r);
  }
  return out;
}

/**
 * Build the GitHub Check Run JSON payload from a single result.
 *
 * Mapping:
 *   pass     → conclusion=success
 *   fail+blocking → conclusion=failure
 *   fail+advisory → conclusion=neutral
 *   neutral  → conclusion=neutral
 *   error    → conclusion=neutral (with explicit summary text)
 *
 * Every Check Run is `status=completed` — we don't emit progress checkpoints.
 */
export function buildCheckRunPayload(
  result: PrCheckResult,
  headSha: string,
): Readonly<Record<string, unknown>> {
  const conclusion = mapConclusion(result);
  const title =
    result.status === "pass"
      ? `${result.id}: PASS`
      : result.status === "fail"
        ? `${result.id}: FAIL`
        : result.status === "neutral"
          ? `${result.id}: NEUTRAL`
          : `${result.id}: ERROR`;

  return {
    name: `wotann/${result.id}`,
    head_sha: headSha,
    status: "completed",
    conclusion,
    started_at: new Date(Date.now() - result.durationMs).toISOString(),
    completed_at: new Date().toISOString(),
    output: {
      title,
      summary: result.message.slice(0, 65535),
      text: `Check: ${result.id}\nSeverity: ${result.severity}\nStatus: ${result.status}\nDuration: ${result.durationMs}ms`,
    },
  };
}

export function mapConclusion(result: PrCheckResult): GitHubCheckConclusion {
  switch (result.status) {
    case "pass":
      return "success";
    case "fail":
      return result.severity === "blocking" ? "failure" : "neutral";
    case "neutral":
    case "error":
      return "neutral";
    default:
      return "neutral";
  }
}

/**
 * Compute aggregate conclusion across all results. Used by the workflow
 * summary step to decide whether to set the overall PR commit status.
 */
export function computeOverallConclusion(results: readonly PrCheckResult[]): GitHubCheckConclusion {
  let hasNeutral = false;
  for (const r of results) {
    const c = mapConclusion(r);
    if (c === "failure") return "failure";
    if (c === "neutral") hasNeutral = true;
  }
  return hasNeutral ? "neutral" : "success";
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s — bounded so a flaky GH API doesn't stretch CI runs > 30s.
  return Math.min(1000 * 2 ** (attempt - 1), 4000);
}

function isTransient(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
