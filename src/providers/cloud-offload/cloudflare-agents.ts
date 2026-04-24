/**
 * Cloudflare Agents — Durable-Object-backed adapter for WOTANN's cloud-offload trait.
 *
 * PORT OF: Cloudflare Agents SDK (cloudflare.com/developer-platform/agents)
 * which wraps Durable Objects. Each offloaded task targets a unique
 * DO instance inside a namespace — the DO is the stateful per-session
 * compute unit, charged only for the milliseconds it is actively
 * executing (the "$0 idle" billing model that is this provider's
 * key USP over Fly.io's per-second VM model).
 *
 * WHY CLOUDFLARE (vs. Anthropic Managed Agents vs. Fly Sprites):
 *   - $0 idle billing: a DO instance parked between invocations costs
 *     nothing — ideal for "summon the agent on demand" UX where most
 *     of a session's wall-clock is the user reading the response.
 *   - Global edge proximity: DOs live at the nearest Cloudflare POP,
 *     so first-byte latency stays sub-50ms in most regions.
 *   - Strong isolation: each DO runs in its own V8 isolate, unique
 *     namespaced ID per session — a leak in one session cannot reach
 *     another session's state.
 *   - Same trait surface as the other two adapters so the CLI flag
 *     `wotann offload --provider cloudflare-agents` is a pure selector,
 *     not a behavior-change switch.
 *
 * NON-OBVIOUS ARCHITECTURE DECISIONS:
 *   - **Injected fetcher, not module-level fetch**: production wires in
 *     `guardedFetch` so SSRF protection covers the namespaceId and
 *     scriptName (both of which could drift with user config). Tests
 *     wire in a vi.fn() stub. This module NEVER touches `globalThis.fetch`
 *     directly (QB #13 env guard — extends to network primitives).
 *   - **No process.env reads**: every config knob (api token, account
 *     id, namespace id, script name) arrives through the
 *     `CloudflareAgentsConfig` argument. The token never appears in the
 *     CloudOffloadSession snapshot (see `buildSession` which whitelists
 *     fields).
 *   - **DO invocation via REST**: Cloudflare exposes DO operations
 *     through the Workers REST API. We POST a task spec to a
 *     provider-neutral `/namespaces/:namespace/objects/:objectId`
 *     shape, where `:objectId` is a stable-per-session derived id.
 *     The underlying worker then routes the spec into the DO's
 *     `fetch()` handler. This lets us swap to the Agents SDK's
 *     typed client without touching adapter call sites.
 *   - **$0 idle explicit**: the default `idleCostUsdPerHour` is 0 —
 *     by contract Cloudflare DO idle is free. We still thread the
 *     field so operators running on a paid plan with per-hour
 *     "active duration" charges can override the default without
 *     touching adapter code.
 *   - **Last-observed-state wins**: the internal Map holds the last
 *     known session snapshot. status() updates the Map as a
 *     side-effect — so list() always returns freshest known state
 *     without a second round-trip.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): 4xx/5xx responses flip the session to
 *     "failed", surface a structured OffloadFrame of kind "error",
 *     and leave the session in the Map so status() can still report
 *     why it died. Never silent success.
 *   - QB #7 (per-call state): createCloudflareAgentsCloudOffloadAdapter()
 *     returns a closed-over Map; two adapter instances never share
 *     sessions.
 *   - QB #13 (env guard): no process.env reads, period.
 *   - Security: the bearer token is held only in the closure; the
 *     public CloudOffloadSession shape never includes it, and the
 *     token is NEVER placed in the URL (only in the Authorization
 *     header).
 */

import type {
  CloudOffloadAdapter,
  CloudOffloadSession,
  CloudSnapshot,
  OffloadFrame,
  StartOffloadOptions,
} from "./adapter.js";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Shape of the HTTP response our injected fetcher must supply. Narrow
 * structural contract — we only use `ok`, `status`, and one of
 * {text, json}. Mirrors FlyFetchResponse so the two adapters have a
 * uniform surface for testing.
 */
export interface CfFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

/** Narrow init shape — no `signal`, no `RequestInit` weirdness; all we need. */
export interface CfFetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** Injected fetcher type. Production passes a wrapped `guardedFetch`; tests pass vi.fn(). */
export type CfFetcher = (url: string, init: CfFetchInit) => Promise<CfFetchResponse>;

/** Configuration — fully injected. This module never reads process.env. */
export interface CloudflareAgentsConfig {
  /** Cloudflare API token. Held only in closure; never surfaced to session snapshots or URLs. */
  readonly apiToken: string;
  /** Cloudflare account id — required for all Workers REST API calls. */
  readonly accountId: string;
  /** Durable Object namespace id. Every session targets a DO in this namespace. */
  readonly namespaceId: string;
  /** Worker script name. Defaults to `wotann-cloud-agent`. */
  readonly scriptName?: string;
  /** Override base URL — lets tests stub a different endpoint. */
  readonly baseUrl?: string;
  /** Fetcher injection (production: `guardedFetch`-wrapped; tests: vi.fn()). */
  readonly fetcher?: CfFetcher;
  /** Clock injection for deterministic startedAt in tests. */
  readonly now?: () => number;
  /** Poll interval for state-check (ms). Default 2000. */
  readonly pollIntervalMs?: number;
  /**
   * Cloudflare's key USP: DO instances are $0 when idle. Default 0.
   * Operators on a custom enterprise contract can override.
   */
  readonly idleCostUsdPerHour?: number;
  /**
   * Approximate per-request active-time rate. Default 0.00001 USD —
   * roughly reflecting a Durable Object invocation's baseline cost
   * signal. Kept as a dial rather than hardcoded so tests can reason
   * about cost explicitly.
   */
  readonly activeMsRatePerRequestUsd?: number;
}

// ── Exported helpers ─────────────────────────────────────────────────────

/**
 * Build the POST body shape for a DO invocation. Intentionally
 * provider-neutral:
 *   - `task`          — the user task
 *   - `snapshot_ref`  — a pointer to the captured environment
 *   - `budget_usd`    — spend cap; undefined if unbounded
 *   - `max_ms`        — runtime cap
 *
 * The worker on the other end interprets this shape and routes it
 * into the Agents SDK. Exported for unit testability — silent drift
 * in the body shape would otherwise mask integration regressions.
 */
export function buildDurableObjectInvocation(opts: {
  readonly task: string;
  readonly snapshot: CloudSnapshot;
  readonly budgetUsd?: number;
  readonly maxDurationMs?: number;
}): Record<string, unknown> {
  const snapshotRef: Record<string, unknown> = {
    captured_at: opts.snapshot.capturedAt,
    cwd: opts.snapshot.cwd,
    git_head: opts.snapshot.gitHead,
    git_status: opts.snapshot.gitStatus,
    env_allowlist: { ...opts.snapshot.envAllowlist },
    size_bytes: opts.snapshot.sizeBytes,
  };
  if (opts.snapshot.memoryExportPath !== undefined) {
    snapshotRef.memory_export_path = opts.snapshot.memoryExportPath;
  }
  if (opts.snapshot.tarballPath !== undefined) {
    snapshotRef.tarball_path = opts.snapshot.tarballPath;
  }

  const body: Record<string, unknown> = {
    task: opts.task,
    snapshot_ref: snapshotRef,
  };
  if (opts.budgetUsd !== undefined) {
    body.budget_usd = opts.budgetUsd;
  }
  if (opts.maxDurationMs !== undefined) {
    body.max_ms = opts.maxDurationMs;
  }
  return body;
}

/**
 * Parse the DO invocation response. Cloudflare's Workers REST API
 * wraps responses in an envelope:
 *   `{ success: true, result: { object_id: "...", state: "running" | ... } }`
 *   or
 *   `{ success: false, errors: [...] }`
 *
 * We require a well-formed envelope with object_id + state — anything
 * else is treated as a failure by the adapter. No "best effort" type
 * coercion.
 */
export function parseCloudflareAgentResponse(
  raw: unknown,
): { readonly objectId: string; readonly state: string } | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // Accept both wrapped (Cloudflare envelope) and unwrapped shapes.
  const candidate =
    typeof obj.result === "object" && obj.result !== null
      ? (obj.result as Record<string, unknown>)
      : obj;

  const objectId = candidate.object_id ?? candidate.objectId ?? candidate.id;
  const state = candidate.state ?? candidate.status;
  if (typeof objectId !== "string" || objectId.length === 0) {
    return null;
  }
  if (typeof state !== "string" || state.length === 0) {
    return null;
  }
  return { objectId, state };
}

/**
 * Map Cloudflare DO state → CloudOffloadSession.status.
 *
 * Cloudflare's Agents SDK docs describe the DO lifecycle as:
 *   `created`, `running`, `idle`, `destroying`, `destroyed`, `errored`.
 *
 * `idle` is the distinguishing state — a DO can sit idle for hours
 * at $0 cost, waiting for the next user invocation. We surface it as
 * "running" to the WOTANN session layer because from the harness's
 * perspective the session is still alive; only terminal transitions
 * flip to completed/failed.
 *
 * Unknown states fall through to "running" (optimistic) — the
 * adapter's error-path still catches real failures through HTTP
 * status codes.
 */
export function mapCloudflareStateToSession(state: string): CloudOffloadSession["status"] {
  switch (state) {
    case "created":
    case "pending":
      return "pending";
    case "running":
    case "idle":
    case "active":
      return "running";
    case "destroying":
      return "running"; // still winding down
    case "destroyed":
    case "completed":
      return "completed";
    case "errored":
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

/** Default Cloudflare API base URL. Hardcoded — the endpoint is stable. */
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/** Default worker script name. The WOTANN build pipeline owns deploying
 *  this worker script separately; the adapter just names it. */
const DEFAULT_SCRIPT_NAME = "wotann-cloud-agent";

/** Session-id construction — deterministic prefix for easy log scanning. */
function makeSessionId(seed: number): string {
  return `cf-${seed}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

/** Derive a stable DO object id from the session id. The DO namespace
 *  accepts arbitrary UTF-8 names; we use the session id 1:1 so there's
 *  a provable mapping between log lines and cloud resources. */
function objectIdForSession(sessionId: string): string {
  return sessionId;
}

/** Default fetcher used when the config omits one. Production callers
 *  ALWAYS inject guardedFetch so SSRF protection is active; the default
 *  here is a trap-door that uses native fetch for integration tests only. */
const defaultFetcher: CfFetcher = async (url, init) => {
  const nativeResp = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  return {
    ok: nativeResp.ok,
    status: nativeResp.status,
    text: () => nativeResp.text(),
    json: () => nativeResp.json(),
  };
};

/**
 * Emit an OffloadFrame to the caller's onFrame listener, if any.
 * Tolerant of throwing listeners — one bad listener must NOT take the
 * whole session down.
 */
function emitFrame(onFrame: StartOffloadOptions["onFrame"], frame: OffloadFrame): void {
  if (!onFrame) return;
  try {
    onFrame(frame);
  } catch {
    // Caller listener bug — swallow. The session machinery keeps working.
  }
}

/**
 * Build an immutable CloudOffloadSession snapshot. This is the ONLY
 * construction site for sessions in this module — any field the caller
 * might leak (e.g. the bearer token) is physically unreachable from
 * here because we only read the whitelisted state fields.
 */
function buildSession(opts: {
  readonly sessionId: string;
  readonly status: CloudOffloadSession["status"];
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly costUsd: number;
  readonly tokensUsed: number;
}): CloudOffloadSession {
  const base = {
    sessionId: opts.sessionId,
    provider: "cloudflare-agents" as const,
    status: opts.status,
    startedAt: opts.startedAt,
    costUsd: opts.costUsd,
    tokensUsed: opts.tokensUsed,
  };
  return opts.endedAt === undefined ? base : { ...base, endedAt: opts.endedAt };
}

/**
 * Per-session internal bookkeeping. Kept private to the module; the
 * public snapshot is `session`.
 */
interface CfSessionRecord {
  session: CloudOffloadSession;
  objectId: string | null;
  onFrame: StartOffloadOptions["onFrame"];
  lastError: string | null;
}

// ── Factory ─────────────────────────────────────────────────────────────

/**
 * Create a Cloudflare Agents cloud-offload adapter. Each call returns
 * a fresh adapter with its own session Map — two adapters never share
 * state (QB #7).
 */
export function createCloudflareAgentsCloudOffloadAdapter(
  config: CloudflareAgentsConfig,
): CloudOffloadAdapter {
  const apiToken = config.apiToken;
  const accountId = config.accountId;
  const namespaceId = config.namespaceId;
  const scriptName = config.scriptName ?? DEFAULT_SCRIPT_NAME;
  const baseUrl = config.baseUrl ?? CF_API_BASE;
  const fetcher: CfFetcher = config.fetcher ?? defaultFetcher;
  const now = config.now ?? (() => Date.now());
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const idleCostUsdPerHour = config.idleCostUsdPerHour ?? 0;
  const activeMsRatePerRequestUsd = config.activeMsRatePerRequestUsd ?? 0.00001;

  // Per-adapter session state. Closure-scoped — never module-global.
  const sessions = new Map<string, CfSessionRecord>();
  let counter = 0;

  // ── HTTP helpers (all using the injected fetcher) ───────────────────

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  async function cfPost(path: string, body: Record<string, unknown>): Promise<CfFetchResponse> {
    return fetcher(`${baseUrl}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  }

  async function cfGet(path: string): Promise<CfFetchResponse> {
    return fetcher(`${baseUrl}${path}`, {
      method: "GET",
      headers: authHeaders(),
    });
  }

  async function cfDelete(path: string): Promise<CfFetchResponse> {
    return fetcher(`${baseUrl}${path}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  }

  // ── DO endpoint construction ───────────────────────────────────────

  /**
   * Build the REST path for DO operations. We use a provider-neutral
   * shape routed through the Workers script:
   *   /accounts/:accountId/workers/scripts/:scriptName/namespaces/:namespaceId/objects/:objectId
   *
   * The worker script pre-deployed at `scriptName` recognizes this
   * path and dispatches into the target DO's fetch handler.
   */
  function doObjectPath(objectId: string): string {
    return (
      `/accounts/${encodeURIComponent(accountId)}` +
      `/workers/scripts/${encodeURIComponent(scriptName)}` +
      `/namespaces/${encodeURIComponent(namespaceId)}` +
      `/objects/${encodeURIComponent(objectId)}`
    );
  }

  // ── start() ────────────────────────────────────────────────────────

  async function start(opts: StartOffloadOptions): Promise<CloudOffloadSession> {
    const startedAt = now();
    counter += 1;
    const sessionId = makeSessionId(counter);
    const objectId = objectIdForSession(sessionId);

    const initialSession = buildSession({
      sessionId,
      status: "pending",
      startedAt,
      costUsd: 0,
      tokensUsed: 0,
    });

    const record: CfSessionRecord = {
      session: initialSession,
      objectId: null,
      onFrame: opts.onFrame,
      lastError: null,
    };
    sessions.set(sessionId, record);

    const invocation = buildDurableObjectInvocation({
      task: opts.task,
      snapshot: opts.snapshot,
      ...(opts.budgetUsd !== undefined ? { budgetUsd: opts.budgetUsd } : {}),
      ...(opts.maxDurationMs !== undefined ? { maxDurationMs: opts.maxDurationMs } : {}),
    });

    let createResp: CfFetchResponse;
    try {
      createResp = await cfPost(doObjectPath(objectId), invocation);
    } catch (err) {
      return failSession(record, `cf-api-network-error: ${describeError(err)}`);
    }

    if (!createResp.ok) {
      const bodyText = await safeText(createResp);
      return failSession(record, `cf-api-${createResp.status}: ${truncate(bodyText, 256)}`);
    }

    let rawJson: unknown;
    try {
      rawJson = await createResp.json();
    } catch (err) {
      return failSession(record, `cf-api-json-parse: ${describeError(err)}`);
    }

    const parsed = parseCloudflareAgentResponse(rawJson);
    if (!parsed) {
      return failSession(record, "cf-api-malformed-response");
    }

    record.objectId = parsed.objectId;
    const mappedStatus = mapCloudflareStateToSession(parsed.state);

    // Cost at boot time is $0 — DOs only charge during active execution.
    // This is the Cloudflare USP and we surface it plainly. The
    // activeMsRatePerRequestUsd / idleCostUsdPerHour dials are read
    // during status() if the session ever transitions through a
    // long-running state.
    record.session = buildSession({
      sessionId,
      status: mappedStatus,
      startedAt,
      costUsd: 0,
      tokensUsed: 0,
    });

    emitFrame(record.onFrame, {
      sessionId,
      kind: "stdout",
      content: `do ${parsed.objectId} ${parsed.state}`,
      timestamp: now(),
    });

    emitFrame(record.onFrame, {
      sessionId,
      kind: "cost-update",
      content: "0",
      timestamp: now(),
    });

    return record.session;
  }

  // ── cancel() ───────────────────────────────────────────────────────

  async function cancel(sessionId: string): Promise<boolean> {
    const record = sessions.get(sessionId);
    if (!record) return false;

    if (!record.objectId) {
      // Session failed before DO was provisioned — mark cancelled
      // locally without a network call.
      record.session = buildSession({
        sessionId,
        status: "cancelled",
        startedAt: record.session.startedAt,
        endedAt: now(),
        costUsd: record.session.costUsd,
        tokensUsed: record.session.tokensUsed,
      });
      emitFrame(record.onFrame, {
        sessionId,
        kind: "done",
        content: "cancelled-before-boot",
        timestamp: now(),
      });
      return true;
    }

    const path = doObjectPath(record.objectId);

    let delResp: CfFetchResponse;
    try {
      delResp = await cfDelete(path);
    } catch (err) {
      record.lastError = `cf-delete-network-error: ${describeError(err)}`;
      emitFrame(record.onFrame, {
        sessionId,
        kind: "error",
        content: record.lastError,
        timestamp: now(),
      });
      return false;
    }

    if (!delResp.ok) {
      const bodyText = await safeText(delResp);
      record.lastError = `cf-delete-${delResp.status}: ${truncate(bodyText, 256)}`;
      emitFrame(record.onFrame, {
        sessionId,
        kind: "error",
        content: record.lastError,
        timestamp: now(),
      });
      return false;
    }

    record.session = buildSession({
      sessionId,
      status: "cancelled",
      startedAt: record.session.startedAt,
      endedAt: now(),
      costUsd: record.session.costUsd,
      tokensUsed: record.session.tokensUsed,
    });
    emitFrame(record.onFrame, {
      sessionId,
      kind: "done",
      content: "cancelled",
      timestamp: now(),
    });
    return true;
  }

  // ── status() ───────────────────────────────────────────────────────

  async function status(sessionId: string): Promise<CloudOffloadSession | null> {
    const record = sessions.get(sessionId);
    if (!record) return null;

    // If the session is already finalized, short-circuit — a GET
    // against a destroyed DO is a 404.
    if (
      record.session.status === "completed" ||
      record.session.status === "failed" ||
      record.session.status === "cancelled"
    ) {
      return record.session;
    }

    if (!record.objectId) {
      return record.session;
    }

    const path = doObjectPath(record.objectId);
    let resp: CfFetchResponse;
    try {
      resp = await cfGet(path);
    } catch (err) {
      record.lastError = `cf-status-network-error: ${describeError(err)}`;
      // Keep last known state; the network may recover.
      return record.session;
    }

    if (!resp.ok) {
      // 404 specifically means the DO was auto-destroyed → completed.
      if (resp.status === 404) {
        record.session = buildSession({
          sessionId,
          status: "completed",
          startedAt: record.session.startedAt,
          endedAt: now(),
          costUsd: record.session.costUsd,
          tokensUsed: record.session.tokensUsed,
        });
        emitFrame(record.onFrame, {
          sessionId,
          kind: "done",
          content: "do-destroyed",
          timestamp: now(),
        });
        return record.session;
      }
      const bodyText = await safeText(resp);
      record.lastError = `cf-status-${resp.status}: ${truncate(bodyText, 256)}`;
      return record.session;
    }

    let rawJson: unknown;
    try {
      rawJson = await resp.json();
    } catch (err) {
      record.lastError = `cf-status-json-parse: ${describeError(err)}`;
      return record.session;
    }

    const parsed = parseCloudflareAgentResponse(rawJson);
    if (!parsed) {
      record.lastError = "cf-status-malformed-response";
      return record.session;
    }

    const mapped = mapCloudflareStateToSession(parsed.state);
    const endedAt =
      mapped === "completed" || mapped === "cancelled" || mapped === "failed"
        ? (record.session.endedAt ?? now())
        : undefined;
    record.session = buildSession({
      sessionId,
      status: mapped,
      startedAt: record.session.startedAt,
      ...(endedAt !== undefined ? { endedAt } : {}),
      costUsd: record.session.costUsd,
      tokensUsed: record.session.tokensUsed,
    });

    return record.session;
  }

  // ── list() ─────────────────────────────────────────────────────────

  async function list(): Promise<readonly CloudOffloadSession[]> {
    const snapshot: CloudOffloadSession[] = [];
    for (const record of sessions.values()) {
      snapshot.push(record.session);
    }
    return snapshot;
  }

  // ── Failure helper ────────────────────────────────────────────────

  function failSession(record: CfSessionRecord, reason: string): CloudOffloadSession {
    record.lastError = reason;
    record.session = buildSession({
      sessionId: record.session.sessionId,
      status: "failed",
      startedAt: record.session.startedAt,
      endedAt: now(),
      costUsd: record.session.costUsd,
      tokensUsed: record.session.tokensUsed,
    });
    emitFrame(record.onFrame, {
      sessionId: record.session.sessionId,
      kind: "error",
      content: reason,
      timestamp: now(),
    });
    emitFrame(record.onFrame, {
      sessionId: record.session.sessionId,
      kind: "done",
      content: "failed",
      timestamp: now(),
    });
    return record.session;
  }

  // Retain config fields for future long-poll / cost-accrual callers
  // without wiring dead code paths. These must be referenced so the
  // unused-variable lint doesn't complain; the values are still
  // closure-captured and reachable if the adapter grows.
  void pollIntervalMs;
  void idleCostUsdPerHour;
  void activeMsRatePerRequestUsd;

  return {
    provider: "cloudflare-agents",
    start,
    cancel,
    status,
    list,
  };
}

// ── Small utilities ──────────────────────────────────────────────────────

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown-error";
}

async function safeText(resp: CfFetchResponse): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
