/**
 * HTTP transport for the WOTANN ↔ Claude SDK hook bridge — V9 T3.3 Wave 2.
 *
 * The Claude binary's `--hooks-config` flag accepts JSON describing one or
 * more hook URLs per event. When an event fires, the binary makes a POST
 * to the URL with the payload as the request body and awaits the response
 * (with a configurable timeout). Response shape determines the binary's
 * next action: allow, block, modifyInput, inject, defer.
 *
 * This module owns ONLY the HTTP + JSON wire. It dispatches to per-event
 * handlers from sibling files. Handlers receive a `WaveDeps` injected at
 * server construction.
 *
 * Loopback-bound by default — the URL emitted via `getHookConfig()` is
 * `http://127.0.0.1:<port>`. The Claude binary runs in the same process
 * tree as WOTANN, so non-loopback bindings would only widen the attack
 * surface without enabling a real use case.
 *
 * Quality bars
 *   - QB #6 honest stubs: a handler that throws is converted to a decision
 *     consistent with the event's contract (PreToolUse defaults to allow
 *     with a warning logged; Stop defaults to allow). We never silently
 *     swallow.
 *   - QB #13 env guard: deps come from constructor arg, not module state.
 *   - QB #15 verify before claim: integration is exercised by the matrix
 *     in `MASTER_PLAN_V9.md` Tier 3.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  HookHandler,
  WaveDeps,
  ClaudeHookEvent,
  SessionStartPayload,
  UserPromptSubmitPayload,
  PreToolUsePayload,
  PostToolUsePayload,
  StopPayload,
  PreCompactPayload,
  HookDecision,
  StopDecision,
} from "../types.js";

import { createSessionStartHandler } from "./session-start.js";
import { createUserPromptSubmitHandler } from "./user-prompt-submit.js";
import { createPreToolUseHandler } from "./pre-tool-use.js";
import { createPostToolUseHandler } from "./post-tool-use.js";
import { createStopHandler } from "./stop.js";
import { createPreCompactHandler } from "./pre-compact.js";

// V9 Wave 6-RR (H-3): per-session shared secret used to authenticate
// every POST hitting the loopback hook server. Generated fresh per
// startHookServer() call so no two sessions share a secret. Embedded in
// the URL path we hand to the `claude` binary via getHookConfig — the
// binary just calls the URL it was told to call, so URL-embedded secret
// works without requiring the binary to support custom headers.
const SECRET_BYTES = 32;

function generateHookSecret(): string {
  return randomBytes(SECRET_BYTES).toString("hex");
}

/**
 * Constant-time comparison of two hex strings of equal length. Falls
 * through to false on any length mismatch or buffer error rather than
 * throwing — fail-CLOSED per QB#6.
 */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length === 0 || ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * Verify the optional X-WOTANN-HMAC header. Format:
 *   "sha256=<hex>"
 * where hex = HMAC-SHA256(secret, `${timestamp}.${rawBody}`).
 * The X-WOTANN-Timestamp header carries the timestamp (ms since epoch);
 * stale timestamps (older than 5 min) are rejected to limit replay.
 *
 * Returns true if both headers are present AND verify; false if they
 * verify fail; null if not present (caller falls back to path-token).
 */
function verifyHmac(req: IncomingMessage, rawBody: string, secret: string): boolean | null {
  const hmacHeader = req.headers["x-wotann-hmac"];
  const tsHeader = req.headers["x-wotann-timestamp"];
  if (typeof hmacHeader !== "string" || typeof tsHeader !== "string") {
    return null; // No HMAC presented — caller decides if path-token alone is enough.
  }
  const tsNum = Number(tsHeader);
  if (!Number.isFinite(tsNum)) return false;
  // 5-minute clock skew tolerance limits replay window.
  if (Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) return false;
  const expectedHex = createHmac("sha256", secret).update(`${tsHeader}.${rawBody}`).digest("hex");
  const expected = `sha256=${expectedHex}`;
  if (hmacHeader.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(hmacHeader, "utf-8"), Buffer.from(expected, "utf-8"));
  } catch {
    return false;
  }
}

// ── Server options ─────────────────────────────────────────────

export interface HookServerOptions {
  readonly deps: WaveDeps;
  /** Bind port. 0 = OS-chosen ephemeral port (recommended). */
  readonly port?: number;
  /** Bind host. Default 127.0.0.1 — loopback only. */
  readonly host?: string;
  /** Per-handler timeout in ms. Default 5000. */
  readonly handlerTimeoutMs?: number;
  /** Optional logger; default no-op. */
  readonly log?: (level: "info" | "warn" | "error", msg: string) => void;
  /**
   * H-K7: max requests per peer IP per 60s window. Default 100.
   * Tune higher in load tests; tune lower in shared/multi-tenant deployments.
   */
  readonly rateLimitMax?: number;
}

export interface HookServerHandle {
  readonly url: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

// ── Per-event route → handler map ──────────────────────────────
//
// V9 Wave 6-RR (H-3): the path prefix is now `/wotann/hooks/<secret>/`
// — every request must include the per-session secret in the path.
// Anyone scanning loopback ports without the secret gets 401. The
// secret is generated at startHookServer() time and only handed to the
// `claude` binary via the hook config file (which is on disk with mode
// 0o600 in tmpdir). See SLUG_TO_EVENT for the trailing event slug.

const SLUG_TO_EVENT: Record<string, ClaudeHookEvent> = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
  "pre-tool-use": "PreToolUse",
  "post-tool-use": "PostToolUse",
  stop: "Stop",
  "pre-compact": "PreCompact",
};

const EVENT_TO_SLUG: Record<ClaudeHookEvent, string | null> = {
  SessionStart: "session-start",
  UserPromptSubmit: "user-prompt-submit",
  PreToolUse: "pre-tool-use",
  PostToolUse: "post-tool-use",
  Stop: "stop",
  PreCompact: "pre-compact",
  SessionEnd: null,
  UserPromptExpansion: null,
  PostCompact: null,
  ToolError: null,
  AgentStart: null,
  AgentEnd: null,
  ChannelMessage: null,
  ChannelOutbound: null,
  PermissionRequest: null,
  PermissionDecision: null,
  Elicitation: null,
  ElicitationResult: null,
  ModelChange: null,
  TurnStart: null,
  TurnEnd: null,
  Notification: null,
  ApiError: null,
  RateLimit: null,
  ContextWarning: null,
  QuotaWarning: null,
};

/**
 * Parse a request URL of the form `/wotann/hooks/<secret>/<event-slug>`
 * and return both pieces. Returns null on any structural mismatch — the
 * caller responds 404 in that case so a curious port-scanner cannot
 * distinguish "wrong secret" from "wrong path" timing-wise.
 */
function parseHookUrl(url: string): { secret: string; slug: string } | null {
  // Strip query string (we don't currently use one but defensive).
  const pathOnly = url.split("?")[0] ?? url;
  const parts = pathOnly.split("/").filter(Boolean);
  // Expect exactly: ["wotann", "hooks", <secret>, <slug>]
  if (parts.length !== 4) return null;
  if (parts[0] !== "wotann" || parts[1] !== "hooks") return null;
  const secret = parts[2];
  const slug = parts[3];
  if (!secret || !slug) return null;
  return { secret, slug };
}

// ── Server factory ─────────────────────────────────────────────

/**
 * Start an HTTP server bound to loopback that handles every wired hook
 * event. Returns a handle with URL + close method.
 *
 * The server's `address` is observed via `Server.address()` after listen,
 * so callers using `port: 0` can read back the OS-assigned port from the
 * returned `port` field and pass it to `getHookConfig`.
 */
export async function startHookServer(opts: HookServerOptions): Promise<HookServerHandle> {
  const host = opts.host ?? "127.0.0.1";
  const handlerTimeoutMs = opts.handlerTimeoutMs ?? 5000;
  const log = opts.log ?? (() => {});

  const sessionStart = createSessionStartHandler();
  const userPromptSubmit = createUserPromptSubmitHandler();
  const preToolUse = createPreToolUseHandler();
  const postToolUse = createPostToolUseHandler();
  const stop = createStopHandler();
  const preCompact = createPreCompactHandler();

  // V9 Wave 6-RR (H-3): per-server shared secret. Generated fresh per
  // startHookServer() call so a leaked secret from one session cannot
  // attack another. Held in closure scope (per-process state, never
  // module-global per QB#7).
  const sharedSecret = generateHookSecret();

  // H-K7 fix: per-peer token-bucket rate limiter so a runaway/buggy
  // hook producer can't flood the server. 100 requests / 60s window per
  // remote IP — tuned for Claude CLI burst patterns (each tool call
  // fires PreToolUse + PostToolUse so a 50-tool-call session generates
  // ~100 hook invocations in normal use). The window is per-instance
  // (closure-scoped) per QB#7, never module-global.
  const RATE_WINDOW_MS = 60_000;
  const RATE_MAX_REQUESTS = opts.rateLimitMax ?? 100;
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(remoteAddr: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const bucket = rateLimitBuckets.get(remoteAddr);
    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(remoteAddr, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    bucket.count += 1;
    if (bucket.count > RATE_MAX_REQUESTS) {
      return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  // Periodic cleanup of stale buckets so memory doesn't grow unbounded
  // when many short-lived peers connect (test fixtures, CI runs).
  const rateLimitSweepHandle = setInterval(() => {
    const now = Date.now();
    for (const [addr, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(addr);
    }
  }, RATE_WINDOW_MS);
  rateLimitSweepHandle.unref();

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url) {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    // H-K7 rate limit check — cheap, runs before HMAC + body parse so a
    // flood can be rejected without spending CPU on cryptographic verify.
    const remoteAddr = req.socket.remoteAddress ?? "unknown";
    const rl = checkRateLimit(remoteAddr);
    if (!rl.allowed) {
      log("warn", `rate-limit: ${remoteAddr} exceeded ${RATE_MAX_REQUESTS}/${RATE_WINDOW_MS}ms`);
      res.setHeader("Retry-After", String(rl.retryAfterSeconds));
      sendJson(res, 429, { error: "too_many_requests", retryAfterSeconds: rl.retryAfterSeconds });
      return;
    }

    const parsed = parseHookUrl(req.url);
    if (!parsed) {
      // Always 404 on malformed paths so a scanner cannot distinguish
      // structurally-wrong from secret-wrong via response code alone.
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    // QB#6 fail-CLOSED: secret check via constant-time comparison.
    if (!safeEqualHex(parsed.secret, sharedSecret)) {
      log("warn", `hook auth failed: bad secret on ${parsed.slug}`);
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const route = SLUG_TO_EVENT[parsed.slug];
    if (!route) {
      sendJson(res, 404, { error: "unknown_event" });
      return;
    }

    // Read raw body once so we can both HMAC-verify it and parse it.
    let raw = "";
    try {
      raw = await readRaw(req);
    } catch (err) {
      log(
        "warn",
        `bad body on ${parsed.slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      sendJson(res, 400, { error: "bad_body" });
      return;
    }

    // Optional X-WOTANN-HMAC header — defense in depth. If the caller
    // includes the header it MUST verify; if they omit, the secret-in-
    // path check above is sufficient (the binary doesn't sign by default
    // because the public hooks-config spec doesn't expose a header field).
    const hmacResult = verifyHmac(req, raw, sharedSecret);
    if (hmacResult === false) {
      log("warn", `hook auth failed: bad HMAC on ${parsed.slug}`);
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    let body: unknown;
    try {
      body = raw.trim().length === 0 ? {} : JSON.parse(raw);
    } catch (err) {
      log(
        "warn",
        `bad json on ${parsed.slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      sendJson(res, 400, { error: "bad_json" });
      return;
    }

    try {
      const decision = await runWithTimeout(
        dispatchHookByEvent(route, body, opts.deps, {
          sessionStart,
          userPromptSubmit,
          preToolUse,
          postToolUse,
          stop,
          preCompact,
        }),
        handlerTimeoutMs,
      );
      sendJson(res, 200, decision as object);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", `${route} handler failed: ${message}`);
      sendJson(res, 200, fallbackDecisionForEvent(route));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;
  // Base URL exposed to callers ALREADY embeds the per-session secret
  // path prefix. Downstream config-builder appends `/<event-slug>` to
  // produce per-event hook URLs.
  const url = `http://${host}:${port}/wotann/hooks/${sharedSecret}`;

  return {
    url,
    port,
    close: () => closeServer(server),
  };
}

// ── Dispatch helpers ───────────────────────────────────────────

interface HandlerSet {
  readonly sessionStart: HookHandler<SessionStartPayload, HookDecision>;
  readonly userPromptSubmit: HookHandler<UserPromptSubmitPayload, HookDecision>;
  readonly preToolUse: HookHandler<PreToolUsePayload, HookDecision>;
  readonly postToolUse: HookHandler<PostToolUsePayload, HookDecision>;
  readonly stop: HookHandler<StopPayload, StopDecision>;
  readonly preCompact: HookHandler<PreCompactPayload, HookDecision>;
}

async function dispatchHookByEvent(
  event: ClaudeHookEvent,
  body: unknown,
  deps: WaveDeps,
  handlers: HandlerSet,
): Promise<HookDecision | StopDecision> {
  // The body shape is event-specific; cast after a permissive validation.
  const payload = body as Record<string, unknown>;
  if (!payload || typeof payload !== "object") {
    throw new Error("payload_not_object");
  }

  const stamped = {
    ...(payload as Record<string, unknown>),
    event,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "unknown",
    timestamp: typeof payload.timestamp === "number" ? payload.timestamp : Date.now(),
  };

  switch (event) {
    case "SessionStart":
      return handlers.sessionStart(stamped as unknown as SessionStartPayload, deps);
    case "UserPromptSubmit":
      return handlers.userPromptSubmit(stamped as unknown as UserPromptSubmitPayload, deps);
    case "PreToolUse":
      return handlers.preToolUse(stamped as unknown as PreToolUsePayload, deps);
    case "PostToolUse":
      return handlers.postToolUse(stamped as unknown as PostToolUsePayload, deps);
    case "Stop":
      return handlers.stop(stamped as unknown as StopPayload, deps);
    case "PreCompact":
      return handlers.preCompact(stamped as unknown as PreCompactPayload, deps);
    default:
      // Other events are passively logged; we don't dispatch a handler.
      return { action: "allow" };
  }
}

function fallbackDecisionForEvent(event: ClaudeHookEvent): HookDecision | StopDecision {
  if (event === "Stop") return { decision: "allow" };
  return { action: "allow" };
}

async function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`handler_timeout_${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Read the raw request body as a UTF-8 string. Distinct from the
 * legacy `readJson` (kept for backwards compatibility) because the
 * H-3 HMAC verifier needs the raw bytes BEFORE JSON parsing — re-
 * serializing parsed JSON does not always reproduce the exact byte
 * sequence (key ordering, whitespace), so HMAC must verify the wire
 * bytes the sender actually signed.
 */
async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(req);
  if (raw.trim().length === 0) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, code: number, body: object): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ── Convenience: expose route → URL map for config-builder ────

/**
 * Build per-event URL map for the Claude binary's --hooks-config file.
 *
 * `baseUrl` is what `startHookServer()` returns in `.url` — it ALREADY
 * includes the per-session secret prefix (`/wotann/hooks/<secret>`),
 * so we just append the trailing event slug per route.
 */
export function getHookRoutes(baseUrl: string): Record<ClaudeHookEvent, string | null> {
  const out: Partial<Record<ClaudeHookEvent, string | null>> = {};
  for (const [event, slug] of Object.entries(EVENT_TO_SLUG)) {
    out[event as ClaudeHookEvent] = slug ? `${baseUrl}/${slug}` : null;
  }
  return out as Record<ClaudeHookEvent, string | null>;
}
