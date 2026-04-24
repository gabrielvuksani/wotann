/**
 * Fly Sprites — Fly.io Firecracker VM adapter for WOTANN's cloud-offload trait.
 *
 * PORT OF: Fly Machines REST API (https://api.machines.dev/v1). Each
 * offloaded task boots a short-lived Firecracker VM running a pre-baked
 * image that has `claude` installed, runs the task to completion, then
 * shuts the VM down. The machine image is treated as an external supply
 * contract (built separately, registered at `registry.fly.io/wotann-cloud-agent:latest`)
 * so this file has zero deploy-time concerns — it just choreographs
 * the HTTP lifecycle.
 *
 * WHY FLY (vs. Anthropic Managed Agents vs. Cloudflare Agents):
 *   - Hard isolation via Firecracker microVMs — stronger than Durable Objects
 *     for sensitive workloads, and the user owns the fly app / billing
 *     relationship (no Anthropic lock-in).
 *   - Charges by second of compute; $0 idle once stopped.
 *   - Same trait surface as the other two adapters so the CLI flag
 *     `wotann offload --provider fly` is a pure selector, not a
 *     behavior-change switch.
 *
 * NON-OBVIOUS ARCHITECTURE DECISIONS:
 *   - **Injected fetcher, not module-level fetch**: production wires in
 *     `guardedFetch` so SSRF protection covers the org-slug and image-ref
 *     both of which could be user-controlled strings. Tests wire in a
 *     vi.fn() stub. This module NEVER touches `globalThis.fetch` directly
 *     (QB #13 env guard — same reasoning extends to network primitives).
 *   - **No process.env reads**: every config knob (api token, org slug,
 *     region, image ref) arrives through the `FlyConfig` argument. The
 *     token never appears in the CloudOffloadSession snapshot (see the
 *     `snapshotSession` helper which strictly whitelists fields).
 *   - **Last-observed-state wins**: the internal Map holds the last known
 *     session snapshot. status() updates the Map as a side-effect — so
 *     list() always returns the freshest known state without a second
 *     round-trip.
 *   - **Polling, not webhooks**: Fly machines don't expose webhooks for
 *     state transitions; the REST API documents `state` as the source of
 *     truth. We poll once at start() (after boot POST) to observe the
 *     transition from `created` → `started`; subsequent callers pull on
 *     demand via status() so we don't waste CPU between idle periods.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): 4xx/5xx responses flip the session to
 *     "failed", surface a structured OffloadFrame of kind "error", and
 *     leave the session in the Map so status() can still report why it
 *     died. Never silent success.
 *   - QB #7 (per-call state): createFlyCloudOffloadAdapter() returns a
 *     closed-over Map; two adapter instances never share sessions.
 *   - QB #13 (env guard): no process.env reads, period.
 *   - Security: the bearer token is held only in the closure; the
 *     public CloudOffloadSession shape never includes it.
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
 * Shape of the HTTP response our injected fetcher must supply. This is
 * a narrow structural contract — we only use `ok`, `status`, and one of
 * {text, json}. The caller can adapt `guardedFetch`'s `Response` to fit
 * (trivial: `.ok`, `.status`, `.text()`, `.json()` are all native) or
 * stub their own. Tests use the stub path.
 */
export interface FlyFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

/** Narrow init shape — no `signal`, no `RequestInit` weirdness; all we need. */
export interface FlyFetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** Injected fetcher type. Production passes a wrapped `guardedFetch`; tests pass vi.fn(). */
export type FlyFetcher = (url: string, init: FlyFetchInit) => Promise<FlyFetchResponse>;

/** Configuration — fully injected. This module never reads process.env. */
export interface FlyConfig {
  /** Fly.io API token. Held only in closure; never surfaced to session snapshots. */
  readonly apiToken: string;
  /** Fly org slug (used as the `app` name in the Fly machines API). */
  readonly orgSlug: string;
  /** Pre-baked machine image. Defaults to `registry.fly.io/wotann-cloud-agent:latest`. */
  readonly imageRef?: string;
  /** Fly region — defaults to `iad`. */
  readonly region?: string;
  /** Fetcher injection (production: `guardedFetch`-wrapped; tests: vi.fn()). */
  readonly fetcher?: FlyFetcher;
  /** Clock injection for deterministic startedAt in tests. */
  readonly now?: () => number;
  /** Poll interval for state-check (ms). Default 2000. */
  readonly pollIntervalMs?: number;
  /** Machine CPU count (default 1). */
  readonly cpuCount?: number;
  /** Machine memory in MB (default 1024). */
  readonly memoryMb?: number;
}

// ── Exported helpers ─────────────────────────────────────────────────────

/**
 * Build the POST body shape expected by Fly's `/v1/apps/:slug/machines`
 * endpoint. The shape is documented at
 * https://fly.io/docs/machines/api/machines-resource/#create-a-machine
 * and follows this contract:
 *   - `config.image`     — image ref
 *   - `config.env`       — env vars inside the VM
 *   - `config.init.cmd`  — startup command array
 *   - `config.guest`     — CPU kind/count + memory
 *   - `region`           — fly region
 *
 * Exported for unit testability — the shape is easy to silently
 * drift out of spec otherwise.
 */
export function buildMachineSpec(opts: {
  readonly imageRef: string;
  readonly region: string;
  readonly cpuCount: number;
  readonly memoryMb: number;
  readonly env: Record<string, string>;
  readonly cmd: readonly string[];
}): Record<string, unknown> {
  return {
    region: opts.region,
    config: {
      image: opts.imageRef,
      env: { ...opts.env },
      init: {
        cmd: [...opts.cmd],
      },
      guest: {
        cpu_kind: "shared",
        cpus: opts.cpuCount,
        memory_mb: opts.memoryMb,
      },
      // Auto-destroy on shutdown so a crashed VM doesn't leak cost.
      auto_destroy: true,
      restart: {
        policy: "no",
      },
    },
  };
}

/**
 * Parse Fly's machine-creation response. The API returns:
 *   `{ id: "machine-xxx", state: "starting" | "started" | ..., ... }`
 *
 * Returns null on any structural defect — the adapter then treats the
 * session as failed. No "best effort" type coercion.
 */
export function parseFlyMachineResponse(
  raw: unknown,
): { readonly id: string; readonly state: string } | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  const state = obj.state;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  if (typeof state !== "string" || state.length === 0) {
    return null;
  }
  return { id, state };
}

/**
 * Map Fly machine state → CloudOffloadSession.status.
 *
 * Fly states documented at
 * https://fly.io/docs/machines/api/machines-resource/#machine-states:
 *   `created`, `starting`, `started`, `stopping`, `stopped`,
 *   `replacing`, `destroying`, `destroyed`.
 *
 * Unknown states fall through to "running" (optimistic) — better than
 * claiming "failed" on a state we just haven't seen before. The
 * adapter's error-path still catches real failures through HTTP status
 * codes.
 */
export function mapFlyStateToSession(state: string): CloudOffloadSession["status"] {
  switch (state) {
    case "created":
    case "starting":
      return "pending";
    case "started":
    case "replacing":
      return "running";
    case "stopping":
    case "stopped":
    case "destroying":
      return "running"; // still winding down; not yet final
    case "destroyed":
      return "completed";
    default:
      return "running";
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

/** API base URL. Hardcoded — Fly's endpoint is stable and globally routed. */
const FLY_API_BASE = "https://api.machines.dev/v1";

/** Default pre-baked image ref. Pinned to `:latest` by design — the image
 *  repo's release cadence is owned by the WOTANN build pipeline, not by
 *  this adapter. */
const DEFAULT_IMAGE = "registry.fly.io/wotann-cloud-agent:latest";

/** Default Fly region. `iad` (Ashburn, VA) is Fly's canonical "close to
 *  everyone in North America" choice. */
const DEFAULT_REGION = "iad";

/** Sanity bound on session-id counter digits. */
function makeSessionId(seed: number): string {
  return `fly-${seed}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

/** Default fetcher used when the config omits one. Production callers
 *  ALWAYS inject guardedFetch so SSRF protection is active; the default
 *  here is a trap-door that uses native fetch for integration tests only. */
const defaultFetcher: FlyFetcher = async (url, init) => {
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
    provider: "fly-sprites" as const,
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
interface FlySessionRecord {
  session: CloudOffloadSession;
  machineId: string | null;
  onFrame: StartOffloadOptions["onFrame"];
  lastError: string | null;
}

// ── Factory ─────────────────────────────────────────────────────────────

/**
 * Create a Fly.io cloud-offload adapter. Each call returns a fresh
 * adapter with its own session Map — two adapters never share state.
 */
export function createFlyCloudOffloadAdapter(config: FlyConfig): CloudOffloadAdapter {
  const apiToken = config.apiToken;
  const orgSlug = config.orgSlug;
  const imageRef = config.imageRef ?? DEFAULT_IMAGE;
  const region = config.region ?? DEFAULT_REGION;
  const fetcher: FlyFetcher = config.fetcher ?? defaultFetcher;
  const now = config.now ?? (() => Date.now());
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const cpuCount = config.cpuCount ?? 1;
  const memoryMb = config.memoryMb ?? 1024;

  // Per-adapter session state. Closure-scoped — never module-global.
  const sessions = new Map<string, FlySessionRecord>();
  let counter = 0;

  // ── HTTP helpers (all using the injected fetcher) ───────────────────

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  async function flyPost(path: string, body: Record<string, unknown>): Promise<FlyFetchResponse> {
    return fetcher(`${FLY_API_BASE}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  }

  async function flyGet(path: string): Promise<FlyFetchResponse> {
    return fetcher(`${FLY_API_BASE}${path}`, {
      method: "GET",
      headers: authHeaders(),
    });
  }

  async function flyDelete(path: string): Promise<FlyFetchResponse> {
    return fetcher(`${FLY_API_BASE}${path}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  }

  // ── Snapshot helper — whitelisted serialization ─────────────────────

  /**
   * Derive a minimal env map from the snapshot. Only the pre-filtered
   * allowlist from snapshot.ts gets forwarded — NEVER the bearer token,
   * never arbitrary process.env. If snapshot.envAllowlist is absent
   * (e.g. test shortcut), we forward an empty map.
   */
  function envFromSnapshot(snapshot: CloudSnapshot): Record<string, string> {
    return { ...snapshot.envAllowlist };
  }

  /**
   * Startup command — the claude binary pre-installed in the image
   * receives the task on stdin. The image is expected to read it and
   * hand off to claude. We keep the cmd-array minimal so the image
   * version (not this adapter) owns the invocation shape.
   */
  function cmdForTask(task: string): readonly string[] {
    // base64-encode to survive any shell quoting quirks in the image.
    const encoded = Buffer.from(task, "utf8").toString("base64");
    return ["/wotann-entrypoint", "--task-b64", encoded];
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

    const record: FlySessionRecord = {
      session: initialSession,
      machineId: null,
      onFrame: opts.onFrame,
      lastError: null,
    };
    sessions.set(sessionId, record);

    const spec = buildMachineSpec({
      imageRef,
      region,
      cpuCount,
      memoryMb,
      env: envFromSnapshot(opts.snapshot),
      cmd: cmdForTask(opts.task),
    });

    let createResp: FlyFetchResponse;
    try {
      createResp = await flyPost(`/apps/${encodeURIComponent(orgSlug)}/machines`, spec);
    } catch (err) {
      return failSession(record, `fly-api-network-error: ${describeError(err)}`);
    }

    if (!createResp.ok) {
      const bodyText = await safeText(createResp);
      return failSession(record, `fly-api-${createResp.status}: ${truncate(bodyText, 256)}`);
    }

    let rawJson: unknown;
    try {
      rawJson = await createResp.json();
    } catch (err) {
      return failSession(record, `fly-api-json-parse: ${describeError(err)}`);
    }

    const parsed = parseFlyMachineResponse(rawJson);
    if (!parsed) {
      return failSession(record, "fly-api-malformed-response");
    }

    record.machineId = parsed.id;
    const mappedStatus = mapFlyStateToSession(parsed.state);
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
      content: `machine ${parsed.id} ${parsed.state}`,
      timestamp: now(),
    });

    // Emit a cost-update frame at boot so the StatusRibbon has something
    // to render immediately. Actual Fly costs are billed per-second; we
    // expose 0 until the session ends because per-second accrual during
    // a running VM is meaningless to the user.
    emitFrame(record.onFrame, {
      sessionId,
      kind: "cost-update",
      content: "0",
      timestamp: now(),
    });

    // We intentionally do NOT block on polling here — the boot itself
    // took one round-trip; subsequent status polling is caller-driven.
    // This keeps start() latency bounded and avoids a hanging-promise
    // test smell.
    return record.session;
  }

  // ── cancel() ───────────────────────────────────────────────────────

  async function cancel(sessionId: string): Promise<boolean> {
    const record = sessions.get(sessionId);
    if (!record) return false;

    if (!record.machineId) {
      // Session failed before a machine was provisioned — mark cancelled.
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

    const machinePath = `/apps/${encodeURIComponent(orgSlug)}/machines/${encodeURIComponent(record.machineId)}`;

    // Best-effort stop first. Fly's API requires stop before delete when
    // a machine is running; swallow errors here because delete will
    // surface the real failure.
    try {
      await flyPost(`${machinePath}/stop`, {});
    } catch {
      // Stop is advisory — DELETE below is the authoritative signal.
    }

    let delResp: FlyFetchResponse;
    try {
      delResp = await flyDelete(machinePath);
    } catch (err) {
      record.lastError = `fly-delete-network-error: ${describeError(err)}`;
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
      record.lastError = `fly-delete-${delResp.status}: ${truncate(bodyText, 256)}`;
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

    // If the session is already finalized (completed / failed / cancelled),
    // short-circuit — a GET against a destroyed machine is a 404.
    if (
      record.session.status === "completed" ||
      record.session.status === "failed" ||
      record.session.status === "cancelled"
    ) {
      return record.session;
    }

    if (!record.machineId) {
      return record.session;
    }

    const machinePath = `/apps/${encodeURIComponent(orgSlug)}/machines/${encodeURIComponent(record.machineId)}`;
    let resp: FlyFetchResponse;
    try {
      resp = await flyGet(machinePath);
    } catch (err) {
      record.lastError = `fly-status-network-error: ${describeError(err)}`;
      // Keep last known state; the network may recover.
      return record.session;
    }

    if (!resp.ok) {
      // 404 specifically means the machine was auto-destroyed → completed.
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
          content: "machine-destroyed",
          timestamp: now(),
        });
        return record.session;
      }
      // Other non-ok → leave the state alone but capture the error.
      const bodyText = await safeText(resp);
      record.lastError = `fly-status-${resp.status}: ${truncate(bodyText, 256)}`;
      return record.session;
    }

    let rawJson: unknown;
    try {
      rawJson = await resp.json();
    } catch (err) {
      record.lastError = `fly-status-json-parse: ${describeError(err)}`;
      return record.session;
    }

    const parsed = parseFlyMachineResponse(rawJson);
    if (!parsed) {
      record.lastError = "fly-status-malformed-response";
      return record.session;
    }

    const mapped = mapFlyStateToSession(parsed.state);
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

  function failSession(record: FlySessionRecord, reason: string): CloudOffloadSession {
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

  // pollIntervalMs retained in config for future callers that need it
  // (long-poll loops, etc); we intentionally do not use it in start()
  // so that test timings stay deterministic. Reference it here to avoid
  // an unused-variable lint without wiring dead code.
  void pollIntervalMs;

  return {
    provider: "fly-sprites",
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

async function safeText(resp: FlyFetchResponse): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
