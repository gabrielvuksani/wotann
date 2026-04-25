/**
 * Connector Webhook Server — V9 T12.8 inbound webhook receiver.
 *
 * Audit found that V9 references `src/connectors/connector-webhook-server.ts`
 * but the file did not exist. This module ships an HTTP server that
 * accepts webhooks from external connectors (Linear, Jira, Slack, etc.),
 * verifies HMAC-SHA256 signatures per-connector, and dispatches typed
 * events to a caller-supplied router.
 *
 * Design
 * ──────
 * Pure node:* core — no Express, no Fastify, no third-party deps.
 * The server accepts ONLY POST + Content-Type: application/json
 * requests on a configurable path. Each request is paired with a
 * connector id (taken from a header `X-WOTANN-Connector` or a path
 * suffix `/<connectorId>`); the registry lookup yields the per-
 * connector secret. The body is read fully, the signature header
 * is compared with `crypto.timingSafeEqual`, and the parsed JSON is
 * forwarded to the registered dispatcher.
 *
 * The dispatcher is a caller-supplied function — this module never
 * mutates anything outside its own server. That keeps the boundary
 * between "transport" and "domain logic" crisp; a real connector-
 * registry can add typed handlers without touching the server.
 *
 * Quality bars
 *   QB #6  honest failures   — every error path returns a typed
 *                              response (4xx / 5xx) with a machine
 *                              parseable JSON body. No silent 200s.
 *   QB #7  per-call state    — createConnectorWebhookServer returns
 *                              a fresh closure; no module globals.
 *   QB #13 env guard         — zero process.env reads. All settings
 *                              flow through opts.
 *   QB #14 claim verify      — the response body lists the connector
 *                              id + event id we dispatched, so callers
 *                              can audit "what actually fired."
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";

// ── Public Types ──────────────────────────────────────────

export type ConnectorWebhookKind =
  | "linear"
  | "jira"
  | "slack"
  | "github"
  | "stripe"
  | "discord"
  | "intercom"
  | "custom";

export interface ConnectorSecret {
  readonly connectorId: string;
  readonly kind: ConnectorWebhookKind;
  /** HMAC shared secret; opaque bytes. Caller must rotate periodically. */
  readonly secret: string;
  /**
   * Header name carrying the HMAC signature.
   * Defaults vary by vendor:
   *   linear  -> "linear-signature"
   *   jira    -> "x-atlassian-webhook-identifier" (vendor-specific check)
   *   slack   -> "x-slack-signature"
   *   github  -> "x-hub-signature-256"
   *   stripe  -> "stripe-signature"
   * For safety we require the caller to declare it explicitly.
   */
  readonly signatureHeader: string;
  /** Optional signature prefix to strip (e.g. "sha256="). */
  readonly signaturePrefix?: string;
}

export interface DispatchEvent {
  readonly connectorId: string;
  readonly kind: ConnectorWebhookKind;
  readonly eventId: string;
  readonly receivedAt: number;
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body. `null` when the body wasn't valid JSON. */
  readonly payload: unknown;
}

export type EventDispatcher = (
  event: DispatchEvent,
) => Promise<{ readonly accepted: boolean; readonly reason?: string }>;

export interface WebhookServerOptions {
  /** Hostname to bind. Default "127.0.0.1" — explicit opt-in to public. */
  readonly host?: string;
  /** TCP port. 0 = OS-assigned (useful in tests). */
  readonly port: number;
  /** URL path to listen on. Default "/webhook". */
  readonly path?: string;
  /** Per-connector secrets, keyed by connectorId. */
  readonly secrets: Readonly<Record<string, ConnectorSecret>>;
  /** Caller dispatcher invoked AFTER signature verification. */
  readonly dispatcher: EventDispatcher;
  /** Max body size in bytes. Default 1 MB. */
  readonly maxBodyBytes?: number;
  /** Clock for deterministic tests. */
  readonly now?: () => number;
}

export interface ConnectorWebhookServer {
  readonly start: () => Promise<{ readonly host: string; readonly port: number }>;
  readonly stop: () => Promise<void>;
  readonly stats: () => WebhookServerStats;
}

export interface WebhookServerStats {
  readonly received: number;
  readonly accepted: number;
  readonly rejectedBadSignature: number;
  readonly rejectedMissingConnector: number;
  readonly rejectedBadBody: number;
  readonly errors: number;
}

// ── Constants ─────────────────────────────────────────────

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/webhook";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MB

// ── Helpers ───────────────────────────────────────────────

/**
 * Read the request body fully. Returns null if the limit is exceeded.
 * Pure — caller passes the limit, no env reads.
 */
function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer | null> {
  return new Promise((resolveCb, rejectCb) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > limitBytes) {
        aborted = true;
        resolveCb(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!aborted) resolveCb(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!aborted) rejectCb(err);
    });
  });
}

/**
 * Compute HMAC-SHA256 over the body and compare to the supplied
 * signature using `crypto.timingSafeEqual`. Returns false on any
 * size mismatch or hex-decode failure (defensive — never throw).
 */
export function verifyHmacSignature(
  body: Buffer,
  secret: string,
  signature: string,
  prefix: string | undefined,
): boolean {
  let hexSig = signature;
  if (prefix !== undefined && hexSig.startsWith(prefix)) {
    hexSig = hexSig.slice(prefix.length);
  }
  // Trim whitespace and lowercase to match the digest output.
  hexSig = hexSig.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hexSig)) return false;
  if (hexSig.length % 2 !== 0) return false;

  let provided: Buffer;
  try {
    provided = Buffer.from(hexSig, "hex");
  } catch {
    return false;
  }

  const expected = createHmac("sha256", secret).update(body).digest();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/**
 * Resolve the connector id from request headers + URL.
 *
 * Precedence:
 *   1. `X-WOTANN-Connector` header (explicit)
 *   2. trailing path segment after the configured webhookPath
 *
 * Returns null when neither is present.
 */
export function resolveConnectorId(req: IncomingMessage, webhookPath: string): string | null {
  const header = req.headers["x-wotann-connector"];
  if (typeof header === "string" && header.trim().length > 0) return header.trim();
  const url = req.url ?? "";
  if (!url.startsWith(webhookPath)) return null;
  const remainder = url.slice(webhookPath.length).replace(/^\/+/, "");
  if (remainder.length === 0) return null;
  // Strip query string + everything after the first path segment.
  const firstSegment = remainder.split(/[/?#]/)[0];
  if (firstSegment === undefined || firstSegment.length === 0) return null;
  // Defensive: only allow safe id characters.
  if (!/^[A-Za-z0-9_.-]+$/.test(firstSegment)) return null;
  return firstSegment;
}

/**
 * Pull a single header value as string, even when node returns it as
 * a string or array.
 */
function headerString(req: IncomingMessage, name: string): string | null {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") return raw[0];
  return null;
}

function snapshotHeaders(req: IncomingMessage): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ── Factory ───────────────────────────────────────────────

/**
 * Construct a fresh webhook server. Per QB #7 each call returns a
 * brand-new instance with its own server reference + counters.
 */
export function createConnectorWebhookServer(
  options: WebhookServerOptions,
): ConnectorWebhookServer {
  const host = options.host ?? DEFAULT_HOST;
  const path = options.path ?? DEFAULT_PATH;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const now = options.now ?? ((): number => Date.now());
  const port = options.port;
  const secrets = options.secrets;
  const dispatcher = options.dispatcher;

  // Per-instance mutable counters (encapsulated, never exported).
  const counters = {
    received: 0,
    accepted: 0,
    rejectedBadSignature: 0,
    rejectedMissingConnector: 0,
    rejectedBadBody: 0,
    errors: 0,
  };

  let server: Server | null = null;

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    counters.received += 1;

    if (req.method !== "POST") {
      writeJson(res, 405, { error: "method_not_allowed", expected: "POST" });
      return;
    }

    const url = req.url ?? "";
    if (!url.startsWith(path)) {
      writeJson(res, 404, { error: "not_found" });
      return;
    }

    const contentType = headerString(req, "content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      counters.rejectedBadBody += 1;
      writeJson(res, 415, { error: "unsupported_media_type", expected: "application/json" });
      return;
    }

    const connectorId = resolveConnectorId(req, path);
    if (!connectorId) {
      counters.rejectedMissingConnector += 1;
      writeJson(res, 400, { error: "connector_id_required" });
      return;
    }

    const secret = secrets[connectorId];
    if (!secret) {
      counters.rejectedMissingConnector += 1;
      writeJson(res, 404, { error: "connector_not_registered", connectorId });
      return;
    }

    const body = await readBody(req, maxBodyBytes);
    if (body === null) {
      counters.rejectedBadBody += 1;
      writeJson(res, 413, { error: "payload_too_large", limitBytes: maxBodyBytes });
      return;
    }

    const signature = headerString(req, secret.signatureHeader);
    if (!signature) {
      counters.rejectedBadSignature += 1;
      writeJson(res, 401, {
        error: "missing_signature",
        signatureHeader: secret.signatureHeader,
      });
      return;
    }

    const validSignature = verifyHmacSignature(
      body,
      secret.secret,
      signature,
      secret.signaturePrefix,
    );
    if (!validSignature) {
      counters.rejectedBadSignature += 1;
      writeJson(res, 401, { error: "bad_signature", connectorId });
      return;
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(body.toString("utf-8"));
    } catch {
      counters.rejectedBadBody += 1;
      writeJson(res, 400, { error: "invalid_json", connectorId });
      return;
    }

    const eventId = inferEventId(payload, headerString(req, "x-event-id"));
    const event: DispatchEvent = {
      connectorId,
      kind: secret.kind,
      eventId,
      receivedAt: now(),
      headers: snapshotHeaders(req),
      payload,
    };

    try {
      const outcome = await dispatcher(event);
      if (outcome.accepted) {
        counters.accepted += 1;
        writeJson(res, 200, {
          accepted: true,
          connectorId,
          eventId,
        });
      } else {
        counters.errors += 1;
        writeJson(res, 422, {
          accepted: false,
          connectorId,
          eventId,
          reason: outcome.reason ?? "rejected_by_dispatcher",
        });
      }
    } catch (err) {
      counters.errors += 1;
      const msg = err instanceof Error ? err.message : String(err);
      writeJson(res, 500, {
        error: "dispatcher_threw",
        connectorId,
        eventId,
        reason: msg,
      });
    }
  };

  const start = (): Promise<{ readonly host: string; readonly port: number }> => {
    return new Promise((resolveCb, rejectCb) => {
      const s = createServer((req, res) => {
        // Defensive try/catch around the request handler — node would
        // otherwise crash on an unhandled rejection.
        handleRequest(req, res).catch((err) => {
          counters.errors += 1;
          try {
            const msg = err instanceof Error ? err.message : String(err);
            writeJson(res, 500, { error: "handler_threw", reason: msg });
          } catch {
            /* connection already closed; nothing to do */
          }
        });
      });
      s.on("error", (err) => {
        rejectCb(err);
      });
      s.listen(port, host, () => {
        server = s;
        const addr = s.address();
        if (typeof addr === "object" && addr !== null) {
          resolveCb({ host: addr.address, port: addr.port });
        } else {
          resolveCb({ host, port });
        }
      });
    });
  };

  const stop = (): Promise<void> => {
    return new Promise((resolveCb) => {
      if (!server) {
        resolveCb();
        return;
      }
      server.close(() => {
        server = null;
        resolveCb();
      });
    });
  };

  const stats = (): WebhookServerStats => ({
    received: counters.received,
    accepted: counters.accepted,
    rejectedBadSignature: counters.rejectedBadSignature,
    rejectedMissingConnector: counters.rejectedMissingConnector,
    rejectedBadBody: counters.rejectedBadBody,
    errors: counters.errors,
  });

  return { start, stop, stats };
}

/**
 * Best-effort event-id extraction. Tries several common JSON keys
 * before falling back to the X-Event-Id header. Returns
 * `unknown-<receivedAt>` when nothing is available so the dispatch
 * record always has a stable id.
 */
export function inferEventId(payload: unknown, fallbackHeader: string | null): string {
  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    for (const key of ["id", "event_id", "eventId", "delivery_id", "deliveryId"]) {
      const v = obj[key];
      if (typeof v === "string" && v.length > 0) return v;
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    const event = obj["event"];
    if (typeof event === "object" && event !== null) {
      const eventId = (event as Record<string, unknown>)["id"];
      if (typeof eventId === "string" && eventId.length > 0) return eventId;
    }
  }
  if (fallbackHeader && fallbackHeader.length > 0) return fallbackHeader;
  return `unknown-${Date.now()}`;
}

/**
 * Build a webhook URL for the given host:port + connectorId. Useful
 * for calling code (e.g. setup wizards) that needs to print the URL
 * a user should give to Linear/Jira/Slack.
 */
export function buildWebhookUrl(
  baseHost: string,
  port: number,
  path: string,
  connectorId: string,
  protocol: "http" | "https" = "http",
): string {
  const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;
  return new URL(`${protocol}://${baseHost}:${port}${cleanPath}/${connectorId}`).toString();
}
