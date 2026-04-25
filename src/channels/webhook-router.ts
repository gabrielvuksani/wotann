/**
 * V9 T1.6 — Channel Webhook Router.
 *
 * One HTTP server that fronts every channel adapter that wants webhook-style
 * inbound delivery. Each adapter (Slack, Telegram, Discord, WhatsApp, Teams,
 * SMS) ships its own `verifySignature(...)` helper that knows the provider's
 * exact signing scheme. THIS module is what actually CALLS those helpers —
 * before T1.6 they were dead code reachable only from unit tests.
 *
 * Dispatch model:
 *   POST /webhook/slack    -> slack.verifySignature(body, ts, sig, secret)
 *   POST /webhook/telegram -> telegram.verifySignature(remoteIp)
 *   POST /webhook/discord  -> discord.verifySignature(body, sig, ts, pubKey)
 *   POST /webhook/whatsapp -> whatsapp.verifySignature(body, sig, secret)
 *   POST /webhook/teams    -> teams.verifySignature(authHeader)
 *   POST /webhook/sms      -> sms.verifySignature(url, params, sig, token)
 *
 * Quality bars:
 *   QB #6  honest stubs        — failures return 401/400 with explicit reason
 *   QB #7  per-instance state  — each createWebhookRouter returns a fresh closure
 *   QB #13 env via constructor — port + secrets injected, NEVER read from
 *                                process.env inside the module
 *   QB #14 real contract test  — tests assert HMAC paths fire on actual vectors
 *
 * Security posture:
 *   - Reject unknown paths with 404 (no route enumeration leak).
 *   - Reject non-POST methods with 405.
 *   - Reject missing/invalid signatures with 401.
 *   - Cap raw body size (default 1 MiB) so a malicious sender can't OOM.
 *   - Body is read as raw bytes; signature paths sign over exact bytes per
 *     spec — re-serializing JSON would break Slack/WhatsApp signatures.
 *
 * Forward model:
 *   On a verified delivery, the router invokes the registered `handler(...)`
 *   with `{ provider, rawBody, headers }`. The handler is a single callback
 *   shared across providers; it is up to the caller (DispatchPlane) to route
 *   into the matching adapter's `processIncoming` path.
 */

import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

// ── Public types ───────────────────────────────────────────

/**
 * One of the six providers this router fronts. Adding a new provider means:
 *   1. extend this union
 *   2. add the matching path in DEFAULT_ROUTES
 *   3. add a verify-and-dispatch branch in handleRequest()
 *   4. extend WebhookRouterSecrets with the provider's required material
 */
export type WebhookProvider = "slack" | "telegram" | "discord" | "whatsapp" | "teams" | "sms";

/**
 * Verified-delivery payload handed to the registered handler. The router
 * never tries to parse JSON for the caller — different providers ship
 * different content types (Slack: JSON; SMS: form-encoded). The caller's
 * processIncoming knows its own provider's body shape.
 */
export interface VerifiedDelivery {
  readonly provider: WebhookProvider;
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly remoteIp: string;
}

export type WebhookHandler = (delivery: VerifiedDelivery) => Promise<void> | void;

/**
 * Provider-specific signature-verification helpers. We accept ALREADY-WIRED
 * verifiers as injected functions rather than constructing adapter instances
 * ourselves — keeps the router decoupled from adapter constructors and lets
 * tests pass mocks (a fake `() => true` for known-good cases, `() => false`
 * for known-bad cases) without standing up a Slack bot.
 *
 * The shape of each verifier matches exactly what the adapter exposes today,
 * so wiring is `verifiers.slack = adapter.verifySignature.bind(adapter)`.
 */
export interface WebhookVerifiers {
  readonly slack?: (
    rawBody: string,
    timestamp: string,
    signature: string,
    secret: string,
  ) => boolean;
  readonly telegram?: (remoteIp: string) => boolean;
  readonly discord?: (
    rawBody: string,
    signatureHex: string,
    timestamp: string,
    publicKeyHex: string,
  ) => boolean;
  readonly whatsapp?: (rawBody: string, signature: string, secret: string) => boolean;
  readonly teams?: (authHeader: string) => boolean;
  readonly sms?: (
    fullUrl: string,
    postParams: Readonly<Record<string, string>>,
    signature: string,
    authToken: string,
  ) => boolean;
}

/**
 * Per-provider secrets. Always passed in via constructor (QB #13) — never
 * loaded from process.env inside the module. Only the secrets the caller
 * actually configured need to be present; missing ones cause 503 rather
 * than 500 because the failure is "not configured" not "broken".
 */
export interface WebhookRouterSecrets {
  readonly slackSigningSecret?: string;
  readonly discordPublicKeyHex?: string;
  readonly whatsappAppSecret?: string;
  readonly twilioAuthToken?: string;
}

export interface WebhookRouterOptions {
  /** TCP port to listen on. Required — no env-var fallback (QB #13). */
  readonly port: number;
  /** Bind address. Defaults to `127.0.0.1` (loopback only). */
  readonly host?: string;
  /** Per-provider verify functions. Undefined providers return 404. */
  readonly verifiers: WebhookVerifiers;
  /** Per-provider secrets. */
  readonly secrets: WebhookRouterSecrets;
  /** Forward callback invoked on verified deliveries. */
  readonly handler: WebhookHandler;
  /** Cap on raw body size in bytes. Default 1_048_576 (1 MiB). */
  readonly maxBodyBytes?: number;
  /**
   * Path → provider override. If supplied, REPLACES the default routes;
   * use this for white-label deployments that want non-default paths.
   * The route matcher is exact-match — no regex/parameter parsing.
   */
  readonly routes?: Readonly<Record<string, WebhookProvider>>;
  /**
   * If provided, the public URL the router is reachable at — used to build
   * the `fullUrl` argument for the Twilio (`sms`) verifier, which signs the
   * exact URL Twilio called. When omitted, SMS verification falls back to
   * `${host}:${port}${path}` which is fine for loopback tests but wrong for
   * production behind a reverse proxy. Production callers MUST set this.
   */
  readonly publicBaseUrl?: string;
}

export interface WebhookRouter {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly address: () => { readonly host: string; readonly port: number } | null;
  readonly isListening: () => boolean;
  /**
   * Synchronous handler exposed for unit tests that don't want to bind a real
   * port. Tests construct a fake req/res pair and invoke this directly.
   */
  readonly handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

// ── Defaults ───────────────────────────────────────────────

const DEFAULT_ROUTES: Readonly<Record<string, WebhookProvider>> = Object.freeze({
  "/webhook/slack": "slack",
  "/webhook/telegram": "telegram",
  "/webhook/discord": "discord",
  "/webhook/whatsapp": "whatsapp",
  "/webhook/teams": "teams",
  "/webhook/sms": "sms",
});

const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MiB
const DEFAULT_HOST = "127.0.0.1";

// ── Factory ────────────────────────────────────────────────

/**
 * Create a fresh webhook router with its own server + closure state.
 *
 * Per QB #7, every call returns a brand-new instance. No module-level
 * mutable globals: two routers in the same process can listen on
 * different ports without interfering.
 */
export function createWebhookRouter(options: WebhookRouterOptions): WebhookRouter {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`createWebhookRouter: port must be in [0, 65535] (got ${options.port})`);
  }
  if (!options.handler) {
    throw new Error("createWebhookRouter: handler required");
  }

  const host = options.host ?? DEFAULT_HOST;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const routes = options.routes ?? DEFAULT_ROUTES;
  const verifiers = options.verifiers;
  const secrets = options.secrets;
  const handler = options.handler;
  const publicBaseUrl = options.publicBaseUrl;

  // Per-instance mutable state — encapsulated, NEVER exported.
  let server: Server | null = null;
  let listening = false;

  const start = (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const s = createServer((req, res) => {
        // Fire-and-forget — handleRequest writes its own response and
        // catches its own errors. We never throw out of this callback,
        // because Node would crash the whole server.
        void handleRequest(req, res).catch((err) => {
          // Last-resort 500 if handleRequest itself throws.
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "internal-error",
                message: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        });
      });
      s.on("error", (err) => {
        if (!listening) {
          reject(err);
        }
      });
      s.listen(options.port, host, () => {
        server = s;
        listening = true;
        resolve();
      });
    });
  };

  const stop = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (!server) {
        listening = false;
        resolve();
        return;
      }
      const s = server;
      server = null;
      s.close(() => {
        listening = false;
        resolve();
      });
    });
  };

  const address = (): { readonly host: string; readonly port: number } | null => {
    if (!server) return null;
    const addr = server.address();
    if (!addr || typeof addr === "string") return null;
    return { host: addr.address, port: addr.port };
  };

  const isListening = (): boolean => listening;

  // ── Request handler — exported for tests ─────────────────

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "method-not-allowed", method: req.method ?? "(unknown)" });
      return;
    }
    const url = req.url ?? "/";
    // Strip query string for route matching — providers MAY append a
    // `secret_token=` etc. to the configured webhook URL.
    const path = url.split("?")[0] ?? url;
    const provider = routes[path];
    if (!provider) {
      writeJson(res, 404, { error: "route-not-found" });
      return;
    }

    // Read body up to the configured cap.
    let rawBody: string;
    try {
      rawBody = await readBody(req, maxBodyBytes);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "read-failed";
      writeJson(res, 413, { error: "body-too-large-or-read-failed", reason });
      return;
    }

    const headers = normalizeHeaders(req.headers);
    const remoteIp = req.socket?.remoteAddress ?? "";

    // Per-provider verification.
    const verified = verifyForProvider(provider, {
      rawBody,
      headers,
      remoteIp,
      verifiers,
      secrets,
      url,
      publicBaseUrl,
      host,
      port: address()?.port ?? options.port,
    });

    if (verified.kind === "not-configured") {
      writeJson(res, 503, {
        error: "verifier-not-configured",
        provider,
        reason: verified.reason,
      });
      return;
    }
    if (verified.kind === "rejected") {
      writeJson(res, 401, {
        error: "signature-verification-failed",
        provider,
        reason: verified.reason,
      });
      return;
    }

    // Verified. Forward to the handler. Errors propagate up so handleRequest's
    // outer catch in start() can write a 500. We deliberately await — the
    // sender may rely on a 200 only after we've durably handed off.
    try {
      await handler({
        provider,
        rawBody,
        headers,
        remoteIp,
      });
    } catch (err) {
      writeJson(res, 500, {
        error: "handler-error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    writeJson(res, 200, { ok: true, provider });
  };

  return {
    start,
    stop,
    address,
    isListening,
    handleRequest,
  };
}

// ── Per-provider verification dispatch ─────────────────────

interface VerifyContext {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly remoteIp: string;
  readonly verifiers: WebhookVerifiers;
  readonly secrets: WebhookRouterSecrets;
  readonly url: string;
  readonly publicBaseUrl?: string;
  readonly host: string;
  readonly port: number;
}

type VerifyOutcome =
  | { readonly kind: "verified" }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "not-configured"; readonly reason: string };

function verifyForProvider(provider: WebhookProvider, ctx: VerifyContext): VerifyOutcome {
  switch (provider) {
    case "slack":
      return verifySlack(ctx);
    case "telegram":
      return verifyTelegram(ctx);
    case "discord":
      return verifyDiscord(ctx);
    case "whatsapp":
      return verifyWhatsApp(ctx);
    case "teams":
      return verifyTeams(ctx);
    case "sms":
      return verifySms(ctx);
  }
}

function verifySlack(ctx: VerifyContext): VerifyOutcome {
  const fn = ctx.verifiers.slack;
  const secret = ctx.secrets.slackSigningSecret;
  if (!fn) return { kind: "not-configured", reason: "no-verifier" };
  if (!secret) return { kind: "not-configured", reason: "no-signing-secret" };
  const ts = ctx.headers["x-slack-request-timestamp"] ?? "";
  const sig = ctx.headers["x-slack-signature"] ?? "";
  if (!ts || !sig) return { kind: "rejected", reason: "missing-headers" };
  return fn(ctx.rawBody, ts, sig, secret)
    ? { kind: "verified" }
    : { kind: "rejected", reason: "hmac-mismatch" };
}

function verifyTelegram(ctx: VerifyContext): VerifyOutcome {
  const fn = ctx.verifiers.telegram;
  if (!fn) return { kind: "not-configured", reason: "no-verifier" };
  // Telegram does NOT HMAC-sign webhook bodies — only IP-allowlist matters.
  // Defense in depth: caller may also configure a path-secret token via the
  // `routes` override (e.g. `/webhook/telegram-{secret}`), but the primary
  // gate is IP.
  if (!ctx.remoteIp) return { kind: "rejected", reason: "no-remote-ip" };
  return fn(ctx.remoteIp)
    ? { kind: "verified" }
    : { kind: "rejected", reason: "ip-not-in-allowlist" };
}

function verifyDiscord(ctx: VerifyContext): VerifyOutcome {
  const fn = ctx.verifiers.discord;
  const pubKey = ctx.secrets.discordPublicKeyHex;
  if (!fn) return { kind: "not-configured", reason: "no-verifier" };
  if (!pubKey) return { kind: "not-configured", reason: "no-public-key" };
  const sig = ctx.headers["x-signature-ed25519"] ?? "";
  const ts = ctx.headers["x-signature-timestamp"] ?? "";
  if (!sig || !ts) return { kind: "rejected", reason: "missing-headers" };
  return fn(ctx.rawBody, sig, ts, pubKey)
    ? { kind: "verified" }
    : { kind: "rejected", reason: "ed25519-mismatch" };
}

function verifyWhatsApp(ctx: VerifyContext): VerifyOutcome {
  const fn = ctx.verifiers.whatsapp;
  const secret = ctx.secrets.whatsappAppSecret;
  if (!fn) return { kind: "not-configured", reason: "no-verifier" };
  if (!secret) return { kind: "not-configured", reason: "no-app-secret" };
  const sig = ctx.headers["x-hub-signature-256"] ?? "";
  if (!sig) return { kind: "rejected", reason: "missing-header" };
  return fn(ctx.rawBody, sig, secret)
    ? { kind: "verified" }
    : { kind: "rejected", reason: "hmac-mismatch" };
}

function verifyTeams(ctx: VerifyContext): VerifyOutcome {
  const fn = ctx.verifiers.teams;
  if (!fn) return { kind: "not-configured", reason: "no-verifier" };
  const auth = ctx.headers["authorization"] ?? "";
  if (!auth) return { kind: "rejected", reason: "missing-authorization" };
  return fn(auth) ? { kind: "verified" } : { kind: "rejected", reason: "jwt-structural-fail" };
}

function verifySms(ctx: VerifyContext): VerifyOutcome {
  const fn = ctx.verifiers.sms;
  const token = ctx.secrets.twilioAuthToken;
  if (!fn) return { kind: "not-configured", reason: "no-verifier" };
  if (!token) return { kind: "not-configured", reason: "no-auth-token" };
  const sig = ctx.headers["x-twilio-signature"] ?? "";
  if (!sig) return { kind: "rejected", reason: "missing-header" };

  // Twilio signs over the EXACT URL it called + sorted POST params.
  // Body is application/x-www-form-urlencoded — parse it once here.
  const params = parseFormUrlEncoded(ctx.rawBody);

  // Build the URL Twilio would have signed. Prefer publicBaseUrl when set
  // (production behind a reverse proxy); fall back to host:port (loopback).
  const path = ctx.url;
  const fullUrl = ctx.publicBaseUrl
    ? joinUrl(ctx.publicBaseUrl, path)
    : `http://${ctx.host}:${ctx.port}${path}`;

  return fn(fullUrl, params, sig, token)
    ? { kind: "verified" }
    : { kind: "rejected", reason: "twilio-mismatch" };
}

// ── Helpers ────────────────────────────────────────────────

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        // Stop reading and reject. We don't drain the rest of the stream;
        // closing the response with 413 will signal the sender.
        req.destroy();
        reject(new Error(`body-exceeds-${maxBytes}`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => reject(err));
  });
}

function normalizeHeaders(raw: IncomingMessage["headers"]): Readonly<Record<string, string>> {
  // Lower-case keys, take the first value if Node gave us an array. We want
  // a deterministic shape so downstream verifiers don't have to handle the
  // string|string[]|undefined union.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      out[k.toLowerCase()] = v[0] ?? "";
    } else if (typeof v === "string") {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
}

/**
 * Parse application/x-www-form-urlencoded body into a flat object. Keys
 * with multiple values are collapsed to the FIRST value — Twilio's
 * webhook payload never contains duplicate keys, so this matches the
 * canonical shape its signature is computed over.
 */
function parseFormUrlEncoded(body: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!body) return out;
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key =
      eq >= 0
        ? decodeURIComponent(pair.slice(0, eq).replace(/\+/g, " "))
        : decodeURIComponent(pair);
    const value = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " ")) : "";
    if (!(key in out)) out[key] = value;
  }
  return out;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function joinUrl(base: string, path: string): string {
  // Trim trailing slash on base; ensure leading slash on path.
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

// ── Test-fixture HMAC helper ───────────────────────────────

/**
 * Compute the Slack signature header value (`v0=<hex>`) for a body+timestamp
 * pair. Exposed so tests can synthesize valid headers without standing up
 * a real Slack instance. Mirrors `SlackAdapter.verifySignature`'s scheme.
 *
 * NOT used at runtime — production servers receive the signature from
 * Slack and verify it; they never compute it themselves.
 */
export function slackTestSignature(rawBody: string, timestamp: string, secret: string): string {
  const base = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac("sha256", secret).update(base, "utf8").digest("hex")}`;
}

/**
 * WhatsApp (Meta Cloud API) signature header value (`sha256=<hex>`) for a
 * body. Mirrors `WhatsAppAdapter.verifySignature` exactly.
 */
export function whatsappTestSignature(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}
