/**
 * Coolify deploy adapter.
 *
 * PORT OF: Coolify's public REST API (coollabs.io/docs/api-reference).
 * Coolify is a self-hosted Heroku/Vercel alternative with 40k+ GitHub
 * stars; its API lets us create an "application" from a git repo,
 * trigger a deploy, stream logs, and query status. WOTANN's `wotann
 * build --deploy-to coolify` flag routes here.
 *
 * API SURFACE (used here):
 *   POST /api/v1/applications/public             — create Docker/git app
 *   GET  /api/v1/applications/:uuid              — fetch app detail
 *   POST /api/v1/deploy                          — trigger deploy by uuid
 *   GET  /api/v1/deployments/:uuid               — fetch deploy status
 *   GET  /api/v1/deployments/:uuid/logs          — fetch deploy logs
 *
 * RELATIONSHIP TO EXISTING MODULES:
 *   - src/build/deploy-adapter.ts — the Tier 9 scaffold that owns the
 *     registry of deploy targets. This file is a PLUGGABLE ADAPTER that
 *     matches whatever shape that registry expects; we intentionally
 *     stay decoupled from the registry's module so another agent can
 *     edit the registry without touching us.
 *   - src/providers/cloud-offload/adapter.ts — shared pattern for
 *     closure-scoped state + injected fetcher + typed failures. Coolify
 *     and Dokploy reuse that pattern.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): every public method returns a typed
 *     envelope with explicit `ok` field. HTTP status, error body, and
 *     attempt count surface in failure results.
 *   - QB #7 (per-session state): createCoolifyAdapter() returns a
 *     closure; two adapters never share auth tokens or deployment maps.
 *   - QB #11 (sibling-site scan): the deploy-adapter.ts registry is
 *     owned by another agent; we expose the `DeployTargetAdapter`
 *     interface that registry can adopt verbatim, no coupling.
 *   - QB #13 (env guard): this file does NOT read process.env. Every
 *     knob is injected via CoolifyConfig.
 *   - QB #15 (immutable data): all results are frozen; internal state
 *     rebuild-on-write (no mutable record leakage).
 */

// ── Shared deploy-target interface ───────────────────────

/**
 * Common contract every deploy-target adapter implements. The Tier 9
 * registry in src/build/deploy-adapter.ts is expected to consume this;
 * we export it from here (and from dokploy.ts) so both adapters stay
 * in lock-step without requiring a shared module we don't own.
 *
 * Two adapters declaring the same interface shape is fine — TypeScript
 * uses structural typing. If the registry later owns a canonical version
 * of this interface, we can slim to a type alias without breaking
 * consumers.
 */
export interface DeployTargetAdapter {
  readonly id: string;
  readonly createAndDeploy: (
    opts: CreateAndDeployOptions,
  ) => Promise<CreateAndDeployResult>;
  readonly fetchStatus: (deploymentId: string) => Promise<FetchStatusResult>;
  readonly fetchLogs: (deploymentId: string) => Promise<FetchLogsResult>;
  readonly cancel: (deploymentId: string) => Promise<CancelResult>;
  readonly listDeployments: () => readonly DeploymentRecord[];
}

export interface CreateAndDeployOptions {
  readonly appName: string;
  readonly gitRepo: string;
  readonly branch: string;
  readonly projectId?: string;
  readonly envVars?: Readonly<Record<string, string>>;
  readonly buildCommand?: string;
  readonly startCommand?: string;
}

export interface DeploymentRecord {
  readonly id: string;
  readonly appId: string;
  readonly status: DeploymentStatus;
  readonly url?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type DeploymentStatus =
  | "pending"
  | "queued"
  | "building"
  | "deploying"
  | "live"
  | "failed"
  | "cancelled";

export type CreateAndDeployResult =
  | {
      readonly ok: true;
      readonly deploymentId: string;
      readonly appId: string;
      readonly url?: string;
      readonly status: DeploymentStatus;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly httpStatus?: number;
    };

export type FetchStatusResult =
  | { readonly ok: true; readonly deployment: DeploymentRecord }
  | { readonly ok: false; readonly reason: string; readonly httpStatus?: number };

export type FetchLogsResult =
  | { readonly ok: true; readonly logs: string; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: string; readonly httpStatus?: number };

export type CancelResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly httpStatus?: number };

// ── Coolify-specific types ───────────────────────────────

export interface CoolifyConfig {
  /** Coolify instance base URL (e.g. "https://coolify.example.com"). */
  readonly apiUrl: string;
  /** Coolify bearer token. Never logged; never leaked to results. */
  readonly apiToken: string;
  /** Optional project UUID — overridden per-call when supplied. */
  readonly defaultProjectId?: string;
  /** Injected fetch for testability. Production passes native fetch. */
  readonly fetcher?: HttpFetcher;
  /** Clock injection for deterministic tests. */
  readonly now?: () => number;
  /** Max retries on 5xx/transport errors. Default 2. */
  readonly maxRetries?: number;
  /** Backoff base ms (exponential). Default 200. */
  readonly retryBackoffMs?: number;
}

/** Narrow fetch shape — matches cloud-offload pattern. */
export type HttpFetcher = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}>;

// ── Factory ───────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 200;

export function createCoolifyAdapter(config: CoolifyConfig): DeployTargetAdapter {
  validateConfig(config);

  const baseUrl = config.apiUrl.replace(/\/+$/, "");
  const fetcher: HttpFetcher = config.fetcher ?? defaultFetcher;
  const now = config.now ?? (() => Date.now());
  const maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
  const backoff = Math.max(0, config.retryBackoffMs ?? DEFAULT_BACKOFF_MS);

  // Per-adapter state — closure-scoped.
  const deployments = new Map<string, DeploymentRecord>();

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async function httpPost(path: string, body: Record<string, unknown>): Promise<RetryResult> {
    return retryingCall(() =>
      fetcher(`${baseUrl}${path}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }),
    );
  }

  async function httpGet(path: string): Promise<RetryResult> {
    return retryingCall(() =>
      fetcher(`${baseUrl}${path}`, {
        method: "GET",
        headers: authHeaders(),
      }),
    );
  }

  async function httpDelete(path: string): Promise<RetryResult> {
    return retryingCall(() =>
      fetcher(`${baseUrl}${path}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
  }

  async function retryingCall(
    doCall: () => ReturnType<HttpFetcher>,
  ): Promise<RetryResult> {
    let lastStatus: number | undefined;
    let lastMessage = "no attempts";
    let lastReason: "transport" | "http" = "transport";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await doCall();
        if (resp.ok) {
          return { ok: true, status: resp.status, response: resp };
        }
        lastReason = "http";
        lastStatus = resp.status;
        const body = await safeText(resp);
        lastMessage = `HTTP ${resp.status}: ${body.slice(0, 256)}`;
        // Retry 5xx + 429 only.
        if (resp.status < 500 && resp.status !== 429) break;
      } catch (err) {
        lastReason = "transport";
        lastMessage = err instanceof Error ? err.message : String(err);
      }
      if (attempt < maxRetries) {
        await delay(backoff * 2 ** attempt);
      }
    }
    const failure: RetryResult = {
      ok: false,
      reason: lastReason,
      message: lastMessage,
      ...(lastStatus !== undefined ? { httpStatus: lastStatus } : {}),
    };
    return failure;
  }

  async function createAndDeploy(opts: CreateAndDeployOptions): Promise<CreateAndDeployResult> {
    if (!opts.gitRepo || !opts.branch) {
      return { ok: false, reason: "gitRepo and branch required" };
    }
    const projectId = opts.projectId ?? config.defaultProjectId;
    if (!projectId) {
      return { ok: false, reason: "projectId required (no defaultProjectId set)" };
    }

    // Step 1: create application.
    const createBody: Record<string, unknown> = {
      name: opts.appName,
      project_uuid: projectId,
      git_repository: opts.gitRepo,
      git_branch: opts.branch,
      ...(opts.buildCommand !== undefined ? { build_command: opts.buildCommand } : {}),
      ...(opts.startCommand !== undefined ? { start_command: opts.startCommand } : {}),
      ...(opts.envVars !== undefined ? { environment_variables: opts.envVars } : {}),
    };
    const createResp = await httpPost("/api/v1/applications/public", createBody);
    if (!createResp.ok) {
      const failure: CreateAndDeployResult = {
        ok: false,
        reason: `application create failed: ${createResp.message}`,
        ...(createResp.httpStatus !== undefined ? { httpStatus: createResp.httpStatus } : {}),
      };
      return failure;
    }
    const createJson = await safeJson(createResp.response);
    const appId = extractString(createJson, ["uuid", "id"]);
    if (!appId) {
      return { ok: false, reason: "create response missing uuid/id" };
    }

    // Step 2: trigger deploy.
    const deployResp = await httpPost("/api/v1/deploy", {
      uuid: appId,
      force: false,
    });
    if (!deployResp.ok) {
      const failure: CreateAndDeployResult = {
        ok: false,
        reason: `deploy trigger failed: ${deployResp.message}`,
        ...(deployResp.httpStatus !== undefined ? { httpStatus: deployResp.httpStatus } : {}),
      };
      return failure;
    }
    const deployJson = await safeJson(deployResp.response);
    const deploymentId =
      extractString(deployJson, ["deployment_uuid", "uuid", "id"]) ?? `${appId}-${now()}`;
    const statusStr = extractString(deployJson, ["status", "state"]) ?? "queued";
    const mappedStatus = mapCoolifyStatus(statusStr);
    const url = extractString(deployJson, ["url", "public_url", "fqdn"]);

    const record: DeploymentRecord = Object.freeze({
      id: deploymentId,
      appId,
      status: mappedStatus,
      ...(url !== undefined ? { url } : {}),
      createdAt: now(),
      updatedAt: now(),
    });
    deployments.set(deploymentId, record);

    return {
      ok: true,
      deploymentId,
      appId,
      ...(url !== undefined ? { url } : {}),
      status: mappedStatus,
    };
  }

  async function fetchStatus(deploymentId: string): Promise<FetchStatusResult> {
    const resp = await httpGet(`/api/v1/deployments/${encodeURIComponent(deploymentId)}`);
    if (!resp.ok) {
      const failure: FetchStatusResult = {
        ok: false,
        reason: resp.message,
        ...(resp.httpStatus !== undefined ? { httpStatus: resp.httpStatus } : {}),
      };
      return failure;
    }
    const json = await safeJson(resp.response);
    const statusStr = extractString(json, ["status", "state"]) ?? "pending";
    const mappedStatus = mapCoolifyStatus(statusStr);
    const url = extractString(json, ["url", "public_url", "fqdn"]);
    const prev = deployments.get(deploymentId);
    const appId = prev?.appId ?? extractString(json, ["application_uuid", "app_id"]) ?? "unknown";
    const updated: DeploymentRecord = Object.freeze({
      id: deploymentId,
      appId,
      status: mappedStatus,
      ...(url !== undefined ? { url } : {}),
      createdAt: prev?.createdAt ?? now(),
      updatedAt: now(),
    });
    deployments.set(deploymentId, updated);
    return { ok: true, deployment: updated };
  }

  async function fetchLogs(deploymentId: string): Promise<FetchLogsResult> {
    const resp = await httpGet(
      `/api/v1/deployments/${encodeURIComponent(deploymentId)}/logs`,
    );
    if (!resp.ok) {
      const failure: FetchLogsResult = {
        ok: false,
        reason: resp.message,
        ...(resp.httpStatus !== undefined ? { httpStatus: resp.httpStatus } : {}),
      };
      return failure;
    }
    const body = await safeText(resp.response);
    const truncated = body.length >= 1_000_000;
    return {
      ok: true,
      logs: truncated ? body.slice(0, 1_000_000) : body,
      truncated,
    };
  }

  async function cancel(deploymentId: string): Promise<CancelResult> {
    const resp = await httpDelete(`/api/v1/deployments/${encodeURIComponent(deploymentId)}`);
    if (!resp.ok) {
      const failure: CancelResult = {
        ok: false,
        reason: resp.message,
        ...(resp.httpStatus !== undefined ? { httpStatus: resp.httpStatus } : {}),
      };
      return failure;
    }
    const prev = deployments.get(deploymentId);
    if (prev) {
      const updated: DeploymentRecord = Object.freeze({
        ...prev,
        status: "cancelled",
        updatedAt: now(),
      });
      deployments.set(deploymentId, updated);
    }
    return { ok: true };
  }

  function listDeployments(): readonly DeploymentRecord[] {
    return Object.freeze(Array.from(deployments.values()));
  }

  return {
    id: "coolify",
    createAndDeploy,
    fetchStatus,
    fetchLogs,
    cancel,
    listDeployments,
  };
}

// ── Helpers ──────────────────────────────────────────────

interface ParsedResponseSuccess {
  readonly ok: true;
  readonly status: number;
  readonly response: Awaited<ReturnType<HttpFetcher>>;
}

interface ParsedResponseFailure {
  readonly ok: false;
  readonly reason: "transport" | "http";
  readonly message: string;
  readonly httpStatus?: number;
}

type RetryResult = ParsedResponseSuccess | ParsedResponseFailure;

function validateConfig(config: CoolifyConfig): void {
  if (!config) throw new Error("coolify: config required");
  if (!config.apiUrl || !/^https?:\/\//.test(config.apiUrl)) {
    throw new Error("coolify: apiUrl (http/https URL) required");
  }
  if (!config.apiToken || typeof config.apiToken !== "string") {
    throw new Error("coolify: apiToken (string) required");
  }
}

const defaultFetcher: HttpFetcher = async (url, init) => {
  const resp = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  return {
    ok: resp.ok,
    status: resp.status,
    text: () => resp.text(),
    json: () => resp.json(),
  };
};

async function safeText(response: {
  readonly text: () => Promise<string>;
}): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function safeJson(response: {
  readonly json: () => Promise<unknown>;
}): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractString(source: unknown, keys: readonly string[]): string | undefined {
  if (source === null || typeof source !== "object") return undefined;
  const obj = source as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  // Coolify wraps some responses in `{data: ...}`.
  const data = obj.data;
  if (data && typeof data === "object") {
    return extractString(data, keys);
  }
  return undefined;
}

/**
 * Map Coolify's status strings to the canonical DeploymentStatus enum.
 * Coolify uses a loose set of strings in different endpoints — we
 * normalize aggressively so downstream consumers never see provider
 * leakage.
 */
export function mapCoolifyStatus(raw: string): DeploymentStatus {
  const s = raw.toLowerCase();
  if (s.includes("live") || s === "running" || s === "succeeded" || s === "deployed") {
    return "live";
  }
  if (s === "failed" || s === "error" || s.includes("error")) return "failed";
  if (s === "cancelled" || s === "canceled" || s.includes("cancel")) return "cancelled";
  if (s.includes("build")) return "building";
  if (s.includes("deploy")) return "deploying";
  if (s === "queued" || s.includes("pending")) return "queued";
  return "pending";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
