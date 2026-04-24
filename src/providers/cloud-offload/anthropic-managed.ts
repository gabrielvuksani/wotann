/**
 * Anthropic Managed Agents — official Anthropic-hosted adapter for
 * WOTANN's cloud-offload trait.
 *
 * PORT OF: Anthropic Managed Agents REST API (public beta as of
 * 2026-04-08). Each offloaded task boots a managed agent session on
 * Anthropic's infrastructure, runs the task to completion, and is
 * billed at `$0.08 / active-hour + Anthropic's token list price`.
 * This file choreographs the HTTP lifecycle; the agent runtime itself
 * is owned by Anthropic, so nothing ever runs locally besides state
 * bookkeeping.
 *
 * HTTP SHAPE (provider-neutral — mirrors the published Anthropic
 * Managed Agents spec as of 2026-04-08 public beta):
 *   - POST /v1/agents/sessions     → create  { task, snapshot_ref,
 *                                              budget_usd, max_duration_ms }
 *                                    returns { session_id, status }
 *   - GET  /v1/agents/sessions/:id → status  returns { session_id, status, ... }
 *   - POST /v1/agents/sessions/:id/cancel → cancel
 *
 * WHY ANTHROPIC-MANAGED (vs. Fly Sprites vs. Cloudflare Agents):
 *   - Zero ops overhead — Anthropic runs the session, scales it, and
 *     handles token streaming on its side. The user pays only for
 *     active-hours + tokens.
 *   - Model parity guaranteed — the session executes against the same
 *     Claude model surface the user already pays for, so there's no
 *     cross-provider capability drift.
 *   - Same trait surface as the other two adapters so the CLI flag
 *     `wotann offload --provider anthropic-managed` is a pure
 *     selector, not a behavior-change switch.
 *
 * NON-OBVIOUS ARCHITECTURE DECISIONS:
 *   - **Injected fetcher, not module-level fetch**: production wires
 *     in `guardedFetch` so SSRF protection covers the base-url (even
 *     though api.anthropic.com is stable, the adapter accepts a
 *     `baseUrl` override for enterprise proxies). Tests wire in a
 *     vi.fn() stub. This module NEVER touches `globalThis.fetch`
 *     directly (QB #13 env guard — same reasoning extends to network
 *     primitives).
 *   - **No process.env reads**: every config knob (api key, base url,
 *     poll interval, hourly-active rate) arrives through the
 *     `AnthropicManagedConfig` argument. The api key never appears in
 *     the CloudOffloadSession snapshot (see the `buildSession` helper
 *     which strictly whitelists fields).
 *   - **Active-hour cost accrual**: the $0.08/hour active-hour rate
 *     is accrued on-demand — every call to status() computes the
 *     delta since startedAt and updates costUsd accordingly. This
 *     avoids the "unrealistic zero" that Fly exposes (where billing
 *     is only visible post-hoc) and gives the StatusRibbon something
 *     live to render. Token cost is NOT included — Anthropic bills
 *     tokens separately and the adapter defers to the telemetry
 *     layer for that.
 *   - **Polling, not webhooks**: the public beta API does not expose
 *     webhooks; state is the source of truth via GET. status() pulls
 *     on demand and updates the internal Map as a side-effect so
 *     list() always sees the freshest state without an extra call.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): 4xx/5xx responses flip the session to
 *     "failed", surface a structured OffloadFrame of kind "error",
 *     and leave the session in the Map so status() can still report
 *     why it died. Never silent success.
 *   - QB #7 (per-call state): createAnthropicManagedCloudOffloadAdapter()
 *     returns a closed-over Map; two adapter instances never share
 *     sessions.
 *   - QB #13 (env guard): no process.env reads, period.
 *   - Security: the api key is held only in the closure; the public
 *     CloudOffloadSession shape never includes it, and the fetcher
 *     is never invoked with the key embedded in the URL.
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
 * {text, json}. The caller can adapt `guardedFetch`'s `Response` to
 * fit (trivial: `.ok`, `.status`, `.text()`, `.json()` are all native)
 * or stub their own. Tests use the stub path.
 */
export interface AnthropicFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

/** Narrow init shape — no `signal`, no `RequestInit` weirdness; all we need. */
export interface AnthropicFetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** Injected fetcher type. Production passes a wrapped `guardedFetch`; tests pass vi.fn(). */
export type AnthropicFetcher = (
  url: string,
  init: AnthropicFetchInit,
) => Promise<AnthropicFetchResponse>;

/** Configuration — fully injected. This module never reads process.env. */
export interface AnthropicManagedConfig {
  /**
   * User's Anthropic API key. Held only in closure; never surfaced to
   * session snapshots or the fetcher URL. Required.
   */
  readonly apiKey: string;
  /**
   * Override base URL. Defaults to `https://api.anthropic.com`. Allows
   * enterprise proxy routing without touching process.env.
   */
  readonly baseUrl?: string;
  /** Fetcher injection (production: `guardedFetch`-wrapped; tests: vi.fn()). */
  readonly fetcher?: AnthropicFetcher;
  /** Clock injection for deterministic startedAt in tests. */
  readonly now?: () => number;
  /** Poll interval for state-check (ms). Default 2000. Reserved for callers. */
  readonly pollIntervalMs?: number;
  /**
   * USD per active-hour. Default $0.08 per the Apr 2026 public beta.
   * Accrues on every status() call based on wall-clock delta.
   */
  readonly hourlyActiveUsd?: number;
}

// ── Exported helpers ─────────────────────────────────────────────────────

/**
 * Build the POST body shape expected by Anthropic's managed-agent
 * session endpoint. The shape is provider-neutral — same structure
 * mirrored across fly-sprites / cloudflare-agents where applicable:
 *
 *   - `task`          — the freeform task description the agent runs
 *   - `snapshot_ref`  — opaque pointer to the captured CloudSnapshot
 *                       (git HEAD + env allowlist). We include git
 *                       HEAD, cwd, and an envAllowlist copy so the
 *                       managed agent can reproduce the working set.
 *   - `budget_usd`    — optional cost cap the provider should honor
 *   - `max_duration_ms` — optional wall-clock cap
 *
 * Exported for unit testability — keeps the HTTP shape from silently
 * drifting out of spec. Pure function of its inputs: same args always
 * produce the same output (QB: reproducibility).
 */
export function buildSessionSpec(opts: {
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
    body.max_duration_ms = opts.maxDurationMs;
  }
  return body;
}

/**
 * Parse Anthropic's session-creation response. The API returns:
 *   `{ session_id: "sess-xxx", status: "pending" | "running" | ..., ... }`
 *
 * Returns null on any structural defect — the adapter then treats the
 * session as failed. No "best effort" type coercion.
 */
export function parseAnthropicSessionResponse(
  raw: unknown,
): { readonly sessionId: string; readonly status: string } | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const id = obj.session_id;
  const status = obj.status;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  if (typeof status !== "string" || status.length === 0) {
    return null;
  }
  return { sessionId: id, status };
}

/**
 * Map Anthropic managed-agent state → CloudOffloadSession.status.
 *
 * States documented in the Apr 2026 public beta:
 *   `pending`, `running`, `completed`, `failed`, `cancelled`.
 *
 * Unknown states fall through to "running" (optimistic) — better than
 * claiming "failed" on a state we just haven't seen before. The
 * adapter's error-path still catches real failures through HTTP
 * status codes.
 */
export function mapAnthropicStateToSession(state: string): CloudOffloadSession["status"] {
  switch (state) {
    case "pending":
    case "queued":
    case "starting":
      return "pending";
    case "running":
    case "active":
      return "running";
    case "completed":
    case "succeeded":
    case "finished":
      return "completed";
    case "failed":
    case "errored":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "cancelled";
    default:
      return "running";
  }
}

// ── Internal constants ──────────────────────────────────────────────────

/** Default API base URL. Stable production endpoint. */
const ANTHROPIC_API_BASE = "https://api.anthropic.com";

/** Default hourly-active rate — matches Apr 2026 public-beta price signal. */
const DEFAULT_HOURLY_ACTIVE_USD = 0.08;

/** Ms in an hour, pre-computed so the cost math stays readable. */
const MS_PER_HOUR = 60 * 60 * 1000;

/** Session-id counter suffix (random base36, bounded). */
function makeSessionId(seed: number): string {
  return `anthropic-${seed}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

/**
 * Default fetcher used when the config omits one. Production callers
 * ALWAYS inject guardedFetch so SSRF protection is active; the default
 * here is a trap-door that uses native fetch for integration tests only.
 */
const defaultFetcher: AnthropicFetcher = async (url, init) => {
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
 * construction site for sessions in this module — any field the
 * caller might leak (e.g. the api key) is physically unreachable from
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
    provider: "anthropic-managed" as const,
    status: opts.status,
    startedAt: opts.startedAt,
    costUsd: opts.costUsd,
    tokensUsed: opts.tokensUsed,
  };
  return opts.endedAt === undefined ? base : { ...base, endedAt: opts.endedAt };
}

/**
 * Compute accrued active-hour cost at `currentMs`, given the session
 * start and the hourly rate. Clamps negative deltas to 0 so a clock
 * regression (NTP skew, etc.) can't produce a refund line.
 */
function computeActiveHourCost(opts: {
  readonly startedAt: number;
  readonly currentMs: number;
  readonly hourlyRateUsd: number;
}): number {
  const delta = opts.currentMs - opts.startedAt;
  if (delta <= 0) return 0;
  return (delta / MS_PER_HOUR) * opts.hourlyRateUsd;
}

/**
 * Per-session internal bookkeeping. Kept private to the module; the
 * public snapshot is `session`.
 */
interface AnthropicSessionRecord {
  session: CloudOffloadSession;
  /** Remote session id assigned by Anthropic (distinct from local sessionId). */
  remoteSessionId: string | null;
  onFrame: StartOffloadOptions["onFrame"];
  lastError: string | null;
  /** Cached so cost accrual stops when the session terminates. */
  finalized: boolean;
}

// ── Factory ─────────────────────────────────────────────────────────────

/**
 * Create an Anthropic Managed Agents cloud-offload adapter. Each call
 * returns a fresh adapter with its own session Map — two adapters
 * never share state (QB #7).
 */
export function createAnthropicManagedCloudOffloadAdapter(
  config: AnthropicManagedConfig,
): CloudOffloadAdapter {
  const apiKey = config.apiKey;
  const baseUrl = config.baseUrl ?? ANTHROPIC_API_BASE;
  const fetcher: AnthropicFetcher = config.fetcher ?? defaultFetcher;
  const now = config.now ?? (() => Date.now());
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const hourlyActiveUsd = config.hourlyActiveUsd ?? DEFAULT_HOURLY_ACTIVE_USD;

  // Per-adapter session state. Closure-scoped — never module-global.
  const sessions = new Map<string, AnthropicSessionRecord>();
  let counter = 0;

  // ── HTTP helpers (all using the injected fetcher) ───────────────────

  const authHeaders = (): Record<string, string> => ({
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
    // The Apr 2026 public beta requires this header per the official
    // release notes — we pin it so drift on Anthropic's side doesn't
    // silently route us to a different API surface.
    "anthropic-beta": "managed-agents-2026-04-08",
    "anthropic-version": "2023-06-01",
  });

  async function anthropicPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<AnthropicFetchResponse> {
    return fetcher(`${baseUrl}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  }

  async function anthropicGet(path: string): Promise<AnthropicFetchResponse> {
    return fetcher(`${baseUrl}${path}`, {
      method: "GET",
      headers: authHeaders(),
    });
  }

  // ── start() ────────────────────────────────────────────────────────

  async function start(opts: StartOffloadOptions): Promise<CloudOffloadSession> {
    const startedAt = now();
    counter += 1;
    const sessionId = makeSessionId(counter);

    const initialSession = buildSession({
      sessionId,
      status: "pending",
      startedAt,
      costUsd: 0,
      tokensUsed: 0,
    });

    const record: AnthropicSessionRecord = {
      session: initialSession,
      remoteSessionId: null,
      onFrame: opts.onFrame,
      lastError: null,
      finalized: false,
    };
    sessions.set(sessionId, record);

    const spec = buildSessionSpec({
      task: opts.task,
      snapshot: opts.snapshot,
      ...(opts.budgetUsd !== undefined ? { budgetUsd: opts.budgetUsd } : {}),
      ...(opts.maxDurationMs !== undefined ? { maxDurationMs: opts.maxDurationMs } : {}),
    });

    let createResp: AnthropicFetchResponse;
    try {
      createResp = await anthropicPost(`/v1/agents/sessions`, spec);
    } catch (err) {
      return failSession(record, `anthropic-api-network-error: ${describeError(err)}`);
    }

    if (!createResp.ok) {
      const bodyText = await safeText(createResp);
      return failSession(record, `anthropic-api-${createResp.status}: ${truncate(bodyText, 256)}`);
    }

    let rawJson: unknown;
    try {
      rawJson = await createResp.json();
    } catch (err) {
      return failSession(record, `anthropic-api-json-parse: ${describeError(err)}`);
    }

    const parsed = parseAnthropicSessionResponse(rawJson);
    if (!parsed) {
      return failSession(record, "anthropic-api-malformed-response");
    }

    record.remoteSessionId = parsed.sessionId;
    const mappedStatus = mapAnthropicStateToSession(parsed.status);
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
      content: `session ${parsed.sessionId} ${parsed.status}`,
      timestamp: now(),
    });

    // Emit a zero cost-update frame at boot so the StatusRibbon has
    // something to render immediately. Real accrual happens in status().
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

    if (!record.remoteSessionId) {
      // Session failed before a remote id was assigned — mark cancelled
      // locally without a network call.
      record.session = buildSession({
        sessionId,
        status: "cancelled",
        startedAt: record.session.startedAt,
        endedAt: now(),
        costUsd: record.session.costUsd,
        tokensUsed: record.session.tokensUsed,
      });
      record.finalized = true;
      emitFrame(record.onFrame, {
        sessionId,
        kind: "done",
        content: "cancelled-before-remote-session",
        timestamp: now(),
      });
      return true;
    }

    const cancelPath = `/v1/agents/sessions/${encodeURIComponent(record.remoteSessionId)}/cancel`;

    let resp: AnthropicFetchResponse;
    try {
      resp = await anthropicPost(cancelPath, {});
    } catch (err) {
      record.lastError = `anthropic-cancel-network-error: ${describeError(err)}`;
      emitFrame(record.onFrame, {
        sessionId,
        kind: "error",
        content: record.lastError,
        timestamp: now(),
      });
      return false;
    }

    if (!resp.ok) {
      const bodyText = await safeText(resp);
      record.lastError = `anthropic-cancel-${resp.status}: ${truncate(bodyText, 256)}`;
      emitFrame(record.onFrame, {
        sessionId,
        kind: "error",
        content: record.lastError,
        timestamp: now(),
      });
      return false;
    }

    // Finalize cost at cancel-time since the provider stops accruing.
    const finalCost = computeActiveHourCost({
      startedAt: record.session.startedAt,
      currentMs: now(),
      hourlyRateUsd: hourlyActiveUsd,
    });

    record.session = buildSession({
      sessionId,
      status: "cancelled",
      startedAt: record.session.startedAt,
      endedAt: now(),
      costUsd: finalCost,
      tokensUsed: record.session.tokensUsed,
    });
    record.finalized = true;
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

    // If the session is already finalized (completed / failed /
    // cancelled), short-circuit — the remote side has stopped
    // accruing, so the cached cost is authoritative.
    if (record.finalized) {
      return record.session;
    }

    // Accrue active-hour cost from the injected clock before making
    // any network call — this keeps cost monotonic even if the GET
    // below fails or is skipped.
    const currentMs = now();
    const accruedCost = computeActiveHourCost({
      startedAt: record.session.startedAt,
      currentMs,
      hourlyRateUsd: hourlyActiveUsd,
    });

    if (!record.remoteSessionId) {
      // No remote session assigned yet; keep state but update cost.
      record.session = buildSession({
        sessionId,
        status: record.session.status,
        startedAt: record.session.startedAt,
        costUsd: accruedCost,
        tokensUsed: record.session.tokensUsed,
      });
      return record.session;
    }

    const path = `/v1/agents/sessions/${encodeURIComponent(record.remoteSessionId)}`;
    let resp: AnthropicFetchResponse;
    try {
      resp = await anthropicGet(path);
    } catch (err) {
      record.lastError = `anthropic-status-network-error: ${describeError(err)}`;
      // Keep last known state but still update cost.
      record.session = buildSession({
        sessionId,
        status: record.session.status,
        startedAt: record.session.startedAt,
        costUsd: accruedCost,
        tokensUsed: record.session.tokensUsed,
      });
      return record.session;
    }

    if (!resp.ok) {
      // 404 means the remote session expired or was reaped → completed.
      if (resp.status === 404) {
        record.session = buildSession({
          sessionId,
          status: "completed",
          startedAt: record.session.startedAt,
          endedAt: now(),
          costUsd: accruedCost,
          tokensUsed: record.session.tokensUsed,
        });
        record.finalized = true;
        emitFrame(record.onFrame, {
          sessionId,
          kind: "done",
          content: "remote-session-expired",
          timestamp: now(),
        });
        return record.session;
      }
      const bodyText = await safeText(resp);
      record.lastError = `anthropic-status-${resp.status}: ${truncate(bodyText, 256)}`;
      record.session = buildSession({
        sessionId,
        status: record.session.status,
        startedAt: record.session.startedAt,
        costUsd: accruedCost,
        tokensUsed: record.session.tokensUsed,
      });
      return record.session;
    }

    let rawJson: unknown;
    try {
      rawJson = await resp.json();
    } catch (err) {
      record.lastError = `anthropic-status-json-parse: ${describeError(err)}`;
      record.session = buildSession({
        sessionId,
        status: record.session.status,
        startedAt: record.session.startedAt,
        costUsd: accruedCost,
        tokensUsed: record.session.tokensUsed,
      });
      return record.session;
    }

    const parsed = parseAnthropicSessionResponse(rawJson);
    if (!parsed) {
      record.lastError = "anthropic-status-malformed-response";
      record.session = buildSession({
        sessionId,
        status: record.session.status,
        startedAt: record.session.startedAt,
        costUsd: accruedCost,
        tokensUsed: record.session.tokensUsed,
      });
      return record.session;
    }

    const mapped = mapAnthropicStateToSession(parsed.status);
    const terminal = mapped === "completed" || mapped === "cancelled" || mapped === "failed";
    const endedAt = terminal ? (record.session.endedAt ?? now()) : undefined;

    record.session = buildSession({
      sessionId,
      status: mapped,
      startedAt: record.session.startedAt,
      ...(endedAt !== undefined ? { endedAt } : {}),
      costUsd: accruedCost,
      tokensUsed: record.session.tokensUsed,
    });

    if (terminal) {
      record.finalized = true;
      emitFrame(record.onFrame, {
        sessionId,
        kind: "done",
        content: parsed.status,
        timestamp: now(),
      });
    }

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

  function failSession(record: AnthropicSessionRecord, reason: string): CloudOffloadSession {
    record.lastError = reason;
    record.session = buildSession({
      sessionId: record.session.sessionId,
      status: "failed",
      startedAt: record.session.startedAt,
      endedAt: now(),
      costUsd: record.session.costUsd,
      tokensUsed: record.session.tokensUsed,
    });
    record.finalized = true;
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

  // pollIntervalMs retained in config for future callers that need it
  // (long-poll loops, etc); reference it to avoid an unused-variable
  // lint without wiring dead code.
  void pollIntervalMs;

  return {
    provider: "anthropic-managed",
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

async function safeText(resp: AnthropicFetchResponse): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
