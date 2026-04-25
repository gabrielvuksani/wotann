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
}

export interface HookServerHandle {
  readonly url: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

// ── Per-event route → handler map ──────────────────────────────

const ROUTE_TO_EVENT: Record<string, ClaudeHookEvent> = {
  "/wotann/hooks/session-start": "SessionStart",
  "/wotann/hooks/user-prompt-submit": "UserPromptSubmit",
  "/wotann/hooks/pre-tool-use": "PreToolUse",
  "/wotann/hooks/post-tool-use": "PostToolUse",
  "/wotann/hooks/stop": "Stop",
  "/wotann/hooks/pre-compact": "PreCompact",
};

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

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url) {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    const route = ROUTE_TO_EVENT[req.url];
    if (!route) {
      sendJson(res, 404, { error: "not_found", url: req.url });
      return;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch (err) {
      log("warn", `bad json on ${req.url}: ${err instanceof Error ? err.message : String(err)}`);
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
  const url = `http://${host}:${port}`;

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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
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

export function getHookRoutes(baseUrl: string): Record<ClaudeHookEvent, string | null> {
  const out: Partial<Record<ClaudeHookEvent, string | null>> = {};
  const reverseRoutes: Partial<Record<ClaudeHookEvent, string>> = {};
  for (const [route, event] of Object.entries(ROUTE_TO_EVENT)) {
    reverseRoutes[event as ClaudeHookEvent] = route;
  }
  const allEvents: ClaudeHookEvent[] = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "UserPromptExpansion",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "PreCompact",
    "PostCompact",
    "ToolError",
    "AgentStart",
    "AgentEnd",
    "ChannelMessage",
    "ChannelOutbound",
    "PermissionRequest",
    "PermissionDecision",
    "Elicitation",
    "ElicitationResult",
    "ModelChange",
    "TurnStart",
    "TurnEnd",
    "Notification",
    "ApiError",
    "RateLimit",
    "ContextWarning",
    "QuotaWarning",
  ];
  for (const ev of allEvents) {
    const route = reverseRoutes[ev];
    out[ev] = route ? `${baseUrl}${route}` : null;
  }
  return out as Record<ClaudeHookEvent, string | null>;
}
