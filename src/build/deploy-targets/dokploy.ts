/**
 * Dokploy deploy adapter.
 *
 * PORT OF: Dokploy's public REST API (docs.dokploy.com/api). Dokploy
 * is a Coolify-competitor self-hosted PaaS with ~12k GitHub stars. Its
 * API is similar in shape but uses different endpoint paths and body
 * shapes. Same adapter contract as coolify.ts so the registry can swap
 * targets without branching.
 *
 * API SURFACE (used here):
 *   POST /api/application.create             — create app from git
 *   POST /api/application.deploy             — trigger deploy
 *   GET  /api/deployment.one?deploymentId=   — fetch deploy detail
 *   GET  /api/deployment.logs?deploymentId=  — fetch deploy logs
 *   POST /api/deployment.cancel              — cancel in-flight deploy
 *
 * RELATIONSHIP TO EXISTING MODULES:
 *   - src/build/deploy-targets/coolify.ts — sibling adapter that shares
 *     the DeployTargetAdapter contract. Both expose the same interface
 *     so src/build/deploy-adapter.ts can register them identically.
 *   - src/providers/cloud-offload/adapter.ts — architectural template:
 *     injected fetcher, per-adapter state, typed failure envelopes.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): every public method returns a typed
 *     `{ok: true|false}` envelope. HTTP errors and transport errors
 *     are distinguishable in failure results.
 *   - QB #7 (per-session state): createDokployAdapter() returns a
 *     closure; two adapters never share state.
 *   - QB #11 (sibling-site scan): DeployTargetAdapter shape is
 *     duplicated here instead of imported to avoid cross-file
 *     dependency. TypeScript structural typing guarantees compat.
 *   - QB #13 (env guard): zero process.env reads; every knob is
 *     injected via DokployConfig.
 *   - QB #15 (immutable data): deployment records are frozen; listing
 *     returns a frozen snapshot.
 */

// ── Shared deploy-target interface (duplicated on purpose) ──

/**
 * The same contract coolify.ts declares. Duplicated rather than imported
 * so neither adapter becomes load-bearing for the other — if one is
 * removed the other still compiles. See coolify.ts docstring for the
 * rationale.
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

// ── Dokploy-specific types ───────────────────────────────

export interface DokployConfig {
  /** Dokploy instance base URL. */
  readonly apiUrl: string;
  /** Dokploy API key. Held in closure; never leaked to results. */
  readonly apiKey: string;
  /** Optional default projectId used when CreateAndDeployOptions omits it. */
  readonly defaultProjectId?: string;
  /** Injected fetch for testability. */
  readonly fetcher?: HttpFetcher;
  /** Clock injection for deterministic tests. */
  readonly now?: () => number;
  /** Max retries on 5xx/transport errors. Default 2. */
  readonly maxRetries?: number;
  /** Backoff base ms (exponential). Default 200. */
  readonly retryBackoffMs?: number;
}

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

export function createDokployAdapter(config: DokployConfig): DeployTargetAdapter {
  validateConfig(config);

  const baseUrl = config.apiUrl.replace(/\/+$/, "");
  const fetcher: HttpFetcher = config.fetcher ?? defaultFetcher;
  const now = config.now ?? (() => Date.now());
  const maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
  const backoff = Math.max(0, config.retryBackoffMs ?? DEFAULT_BACKOFF_MS);

  const deployments = new Map<string, DeploymentRecord>();

  /**
   * Dokploy's convention puts the API key in an `x-api-key` header
   * rather than a Bearer token. Documented in docs.dokploy.com/api.
   */
  function authHeaders(): Record<string, string> {
    return {
      "x-api-key": config.apiKey,
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

  async function retryingCall(
    doCall: () => ReturnType<HttpFetcher>,
  ): Promise<RetryResult> {
    let lastStatus: number | undefined;
    let lastMessage = "no attempts";
    let lastReason: "transport" | "http" = "transport";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await doCall();
        if (resp.ok) return { ok: true, status: resp.status, response: resp };
        lastReason = "http";
        lastStatus = resp.status;
        const body = await safeText(resp);
        lastMessage = `HTTP ${resp.status}: ${body.slice(0, 256)}`;
        // Retry only 5xx + 429.
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
      projectId,
      repository: opts.gitRepo,
      branch: opts.branch,
      ...(opts.buildCommand !== undefined ? { buildCommand: opts.buildCommand } : {}),
      ...(opts.startCommand !== undefined ? { startCommand: opts.startCommand } : {}),
      ...(opts.envVars !== undefined ? { env: opts.envVars } : {}),
    };
    const createResp = await httpPost("/api/application.create", createBody);
    if (!createResp.ok) {
      const failure: CreateAndDeployResult = {
        ok: false,
        reason: `application create failed: ${createResp.message}`,
        ...(createResp.httpStatus !== undefined ? { httpStatus: createResp.httpStatus } : {}),
      };
      return failure;
    }
    const createJson = await safeJson(createResp.response);
    const appId = extractString(createJson, ["applicationId", "id"]);
    if (!appId) {
      return { ok: false, reason: "create response missing applicationId/id" };
    }

    // Step 2: trigger deploy.
    const deployResp = await httpPost("/api/application.deploy", { applicationId: appId });
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
      extractString(deployJson, ["deploymentId", "id"]) ?? `${appId}-${now()}`;
    const statusStr = extractString(deployJson, ["status", "state"]) ?? "queued";
    const mapped = mapDokployStatus(statusStr);
    const url = extractString(deployJson, ["url", "domain", "publicUrl"]);

    const record: DeploymentRecord = Object.freeze({
      id: deploymentId,
      appId,
      status: mapped,
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
      status: mapped,
    };
  }

  async function fetchStatus(deploymentId: string): Promise<FetchStatusResult> {
    const resp = await httpGet(
      `/api/deployment.one?deploymentId=${encodeURIComponent(deploymentId)}`,
    );
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
    const mapped = mapDokployStatus(statusStr);
    const url = extractString(json, ["url", "domain", "publicUrl"]);
    const prev = deployments.get(deploymentId);
    const appId = prev?.appId ?? extractString(json, ["applicationId", "appId"]) ?? "unknown";
    const updated: DeploymentRecord = Object.freeze({
      id: deploymentId,
      appId,
      status: mapped,
      ...(url !== undefined ? { url } : {}),
      createdAt: prev?.createdAt ?? now(),
      updatedAt: now(),
    });
    deployments.set(deploymentId, updated);
    return { ok: true, deployment: updated };
  }

  async function fetchLogs(deploymentId: string): Promise<FetchLogsResult> {
    const resp = await httpGet(
      `/api/deployment.logs?deploymentId=${encodeURIComponent(deploymentId)}`,
    );
    if (!resp.ok) {
      const failure: FetchLogsResult = {
        ok: false,
        reason: resp.message,
        ...(resp.httpStatus !== undefined ? { httpStatus: resp.httpStatus } : {}),
      };
      return failure;
    }
    // Dokploy returns logs as JSON { logs: string } OR plain text.
    // Try JSON first then fall back to text.
    const json = await safeJson(resp.response);
    let body: string;
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      const logs = obj.logs ?? obj.output ?? obj.data;
      body = typeof logs === "string" ? logs : JSON.stringify(logs ?? "");
    } else {
      body = await safeText(resp.response);
    }
    const truncated = body.length >= 1_000_000;
    return {
      ok: true,
      logs: truncated ? body.slice(0, 1_000_000) : body,
      truncated,
    };
  }

  async function cancel(deploymentId: string): Promise<CancelResult> {
    const resp = await httpPost("/api/deployment.cancel", { deploymentId });
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
    id: "dokploy",
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

function validateConfig(config: DokployConfig): void {
  if (!config) throw new Error("dokploy: config required");
  if (!config.apiUrl || !/^https?:\/\//.test(config.apiUrl)) {
    throw new Error("dokploy: apiUrl (http/https URL) required");
  }
  if (!config.apiKey || typeof config.apiKey !== "string") {
    throw new Error("dokploy: apiKey (string) required");
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
  const data = obj.data;
  if (data && typeof data === "object") {
    return extractString(data, keys);
  }
  return undefined;
}

/**
 * Map Dokploy's status strings to the canonical DeploymentStatus enum.
 * Observed values from docs.dokploy.com: `idle`, `running`, `done`,
 * `error`, `canceled`. We normalize aggressively so downstream
 * consumers never leak provider specifics.
 */
export function mapDokployStatus(raw: string): DeploymentStatus {
  const s = raw.toLowerCase();
  if (s === "done" || s === "succeeded" || s === "live" || s.includes("running")) {
    return "live";
  }
  if (s === "error" || s === "failed" || s.includes("error")) return "failed";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s.includes("build")) return "building";
  if (s.includes("deploy")) return "deploying";
  if (s === "queued" || s === "idle" || s.includes("pending")) return "queued";
  return "pending";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
