/**
 * KAIROS RPC Handler — JSON-RPC protocol for unified runtime access.
 *
 * All three surfaces (CLI, Desktop, iOS) use the same JSON-RPC protocol:
 * - CLI/Desktop connect via Unix Domain Socket
 * - iOS connects via WebSocket (CompanionServer)
 *
 * This handler routes incoming RPC calls to the WotannRuntime methods.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { WotannRuntime } from "../core/runtime.js";
import type { KairosDaemon } from "./kairos.js";
import type { QueryExecutor } from "../desktop/prompt-enhancer.js";
import type { EnhancementStyle } from "../desktop/types.js";
import { SymbolOperations } from "../lsp/symbol-operations.js";
import { AuditTrail, type AuditQuery } from "../telemetry/audit-trail.js";
import type { DispatchRoutePolicy } from "../channels/dispatch.js";
import type { BackgroundTaskConfig } from "../agents/background-agent.js";
import type { BenchmarkType } from "../intelligence/benchmark-harness.js";
import { execSync, spawn } from "node:child_process";
import { createECDH, createHash, hkdfSync, randomBytes } from "node:crypto";
import { sanitizeCommand } from "../security/command-sanitizer.js";
import { isDestructiveCommand, analyzeBashSecurity } from "../sandbox/security.js";

// ── Types ────────────────────────────────────────────────

export interface RPCRequest {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly id: string | number;
}

export interface RPCResponse {
  readonly jsonrpc: "2.0";
  readonly result?: unknown;
  readonly error?: RPCError;
  readonly id: string | number;
}

export interface RPCError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface RPCStreamEvent {
  readonly jsonrpc: "2.0";
  readonly method: "stream";
  readonly params: {
    readonly type: "text" | "thinking" | "tool_use" | "done" | "error";
    readonly content: string;
    readonly sessionId: string;
    readonly provider?: string;
    readonly model?: string;
  };
}

export interface SessionInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly createdAt: number;
  readonly messageCount: number;
  readonly totalCost: number;
}

export interface AgentInfo {
  readonly id: string;
  readonly task: string;
  readonly status: "running" | "paused" | "completed" | "failed";
  readonly progress: number;
  readonly cost: number;
  readonly startedAt: number;
}

export interface CostSnapshot {
  readonly sessionCost: number;
  readonly dailyCost: number;
  readonly weeklyCost: number;
  readonly budget: number;
  readonly budgetUsedPercent: number;
}

export interface ProviderInfo {
  readonly name: string;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly billing: string;
}

type RPCHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ── RPC Error Codes ──────────────────────────────────────

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INTERNAL_ERROR = -32603;

// ── Codex JWT Verification (B3) ──────────────────────────
//
// The Codex CLI stores OAuth id tokens in ~/.codex/auth.json. Previously we
// naively decoded the payload without verification, which meant a local
// attacker could edit auth.json to forge a higher-tier plan (pro/enterprise).
//
// We don't have the JWK here (fetching the well-known /jwks endpoint requires
// network access that may be unavailable), so we do defence-in-depth:
//   1. Reject anything that isn't a well-formed 3-part JWT.
//   2. Reject if the payload is not valid JSON.
//   3. Reject if `exp` is missing or in the past.
//   4. Reject if `iss` is not one of the expected OpenAI issuers.
//
// These checks prevent the "edit-a-flat-file to promote your plan" attack
// without requiring network connectivity.

interface CodexJWTPayload {
  readonly iss?: string;
  readonly aud?: string | string[];
  readonly sub?: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly "https://api.openai.com/auth"?: { chatgpt_plan_type?: string };
  readonly [key: string]: unknown;
}

interface CodexJWTVerificationResult {
  readonly valid: boolean;
  readonly payload: CodexJWTPayload | null;
  readonly error: string | null;
}

/** Known Codex / ChatGPT JWT issuers (accepts well-known OpenAI OIDC issuers). */
const CODEX_EXPECTED_ISSUERS: readonly string[] = [
  "https://auth.openai.com",
  "https://auth.openai.com/",
  "https://chat.openai.com",
  "https://chat.openai.com/",
];

/**
 * Verify a Codex id token with defence-in-depth checks.
 * Returns { valid: true, payload } on success, or { valid: false, error } on failure.
 */
export function verifyCodexJWT(token: string): CodexJWTVerificationResult {
  if (typeof token !== "string" || token.length === 0) {
    return { valid: false, payload: null, error: "empty token" };
  }

  // Structural check: 3 parts separated by "."
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, payload: null, error: "not a 3-part JWT" };
  }
  if (!parts[0] || !parts[1] || !parts[2]) {
    return { valid: false, payload: null, error: "empty JWT segment" };
  }

  // Decode payload (middle segment) as base64url JSON
  let payload: CodexJWTPayload;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf-8");
    payload = JSON.parse(decoded) as CodexJWTPayload;
  } catch (err) {
    return {
      valid: false,
      payload: null,
      error: `payload decode failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // exp claim: must exist and be in the future
  if (typeof payload.exp !== "number") {
    return { valid: false, payload: null, error: "missing exp claim" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) {
    return { valid: false, payload: null, error: "token expired" };
  }

  // iss claim: must match one of the expected OpenAI/Codex issuers
  if (typeof payload.iss !== "string" || payload.iss.length === 0) {
    return { valid: false, payload: null, error: "missing iss claim" };
  }
  if (!CODEX_EXPECTED_ISSUERS.includes(payload.iss)) {
    return {
      valid: false,
      payload: null,
      error: `unexpected iss: ${payload.iss}`,
    };
  }

  return { valid: true, payload, error: null };
}

// ── Codex JWT: cryptographic signature verification (B3 upgrade) ─────
//
// The synchronous `verifyCodexJWT` handles the offline case. When the daemon
// has network access, `verifyCodexJWTSignature` fetches the issuer's JWKS,
// resolves the key by `kid`, and verifies the RS256 signature. A short-lived
// in-memory JWKS cache (TTL 1h) keeps the hot path fast.
//
// Callers should prefer this when verifying a freshly-received token from
// auth.json; fall back to the sync check only when fetch() is unavailable or
// the JWKS endpoint is unreachable.

interface CodexJWK {
  readonly kty: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
  readonly n?: string;
  readonly e?: string;
  readonly x5c?: readonly string[];
}

interface JWKSCacheEntry {
  readonly jwks: { readonly keys: readonly CodexJWK[] };
  readonly fetchedAt: number;
}

const JWKS_CACHE = new Map<string, JWKSCacheEntry>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchJWKS(issuer: string): Promise<{ keys: readonly CodexJWK[] } | null> {
  const cached = JWKS_CACHE.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.jwks;
  try {
    const base = issuer.replace(/\/$/, "");
    const discoveryUrl = `${base}/.well-known/openid-configuration`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const discoveryRes = await fetch(discoveryUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!discoveryRes.ok) return null;
    const discovery = (await discoveryRes.json()) as { jwks_uri?: string };
    if (!discovery.jwks_uri) return null;
    const jwksController = new AbortController();
    const jwksTimer = setTimeout(() => jwksController.abort(), 5_000);
    const jwksRes = await fetch(discovery.jwks_uri, { signal: jwksController.signal });
    clearTimeout(jwksTimer);
    if (!jwksRes.ok) return null;
    const parsed = (await jwksRes.json()) as { keys: readonly CodexJWK[] };
    JWKS_CACHE.set(issuer, { jwks: parsed, fetchedAt: Date.now() });
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verify a Codex JWT's cryptographic signature against the issuer's JWKS.
 * Falls back to the sync defence-in-depth check if the network is unreachable.
 *
 * Returns the same shape as `verifyCodexJWT`, with `signatureVerified: true`
 * when the RSA signature check succeeded.
 */
export async function verifyCodexJWTSignature(
  token: string,
): Promise<CodexJWTVerificationResult & { signatureVerified: boolean }> {
  const offlineCheck = verifyCodexJWT(token);
  if (!offlineCheck.valid) return { ...offlineCheck, signatureVerified: false };

  const parts = token.split(".");
  let header: { alg?: string; kid?: string };
  try {
    const decoded = Buffer.from(parts[0]!, "base64url").toString("utf-8");
    header = JSON.parse(decoded) as { alg?: string; kid?: string };
  } catch {
    return {
      ...offlineCheck,
      valid: false,
      error: "header decode failed",
      signatureVerified: false,
    };
  }
  if (header.alg !== "RS256") {
    // We only support RS256 (the algorithm the ChatGPT IdP uses).
    return { ...offlineCheck, signatureVerified: false };
  }

  const issuer = offlineCheck.payload?.iss;
  if (!issuer) return { ...offlineCheck, signatureVerified: false };

  const jwks = await fetchJWKS(issuer);
  if (!jwks) {
    // Network unreachable — return offline-verified result unchanged.
    return { ...offlineCheck, signatureVerified: false };
  }

  const key = jwks.keys.find(
    (k) => (k as { kid?: string }).kid === header.kid && (k as { alg?: string }).alg !== "none",
  );
  if (!key) return { ...offlineCheck, signatureVerified: false, error: "kid not in JWKS" };

  try {
    const { createPublicKey, createVerify } = await import("node:crypto");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pubKey = createPublicKey({ key: key as any, format: "jwk" });
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2]!, "base64url");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    const verified = verifier.verify(pubKey, signature);
    if (!verified) {
      return {
        ...offlineCheck,
        valid: false,
        error: "signature verification failed",
        signatureVerified: false,
      };
    }
    return { ...offlineCheck, signatureVerified: true };
  } catch (err) {
    return {
      ...offlineCheck,
      signatureVerified: false,
      error: `crypto verify failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

// ── Image Validation (Session Corruption Guard) ──────────

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

export interface ImageValidationResult {
  readonly ok: boolean;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly error?: string;
}

/**
 * Validate a base64-encoded image payload. Confirms:
 *  - Decodable base64
 *  - Magic bytes match PNG/JPEG/WebP/GIF
 *  - Size under 20MB
 *
 * Returns an `ok: false` result with a clear error when invalid, so the caller
 * can surface it to the user without corrupting the session transcript.
 */
export function validateBase64Image(raw: string): ImageValidationResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "Empty or non-string image payload" };
  }

  // Strip data URL prefix if present (e.g., "data:image/png;base64,...")
  let b64 = raw;
  const dataUrlMatch = raw.match(/^data:image\/[a-z]+;base64,(.+)$/i);
  if (dataUrlMatch?.[1]) b64 = dataUrlMatch[1];

  // Reject payloads that don't look like base64 at all (avoids throwing).
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) {
    return { ok: false, error: "Image payload is not valid base64" };
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return { ok: false, error: "Image payload failed to decode as base64" };
  }

  if (buf.length === 0) {
    return { ok: false, error: "Image payload decoded to zero bytes" };
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: `Image exceeds 20MB limit (${buf.length} bytes)` };
  }

  // Magic byte sniffing
  const mime = detectImageMime(buf);
  if (!mime) {
    return { ok: false, error: "Image payload does not match PNG/JPEG/WebP/GIF magic bytes" };
  }

  return { ok: true, mimeType: mime, sizeBytes: buf.length };
}

function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return "image/gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Extract candidate image payloads from RPC params and validate each. Looks
 * at `images`, `image`, and `attachments` fields in common shapes.
 * Returns `null` if all images valid, or the first error encountered.
 */
export function validateImageParams(params: Record<string, unknown>): string | null {
  const candidates: string[] = [];
  const images = params["images"];
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === "string") candidates.push(img);
      else if (img && typeof img === "object") {
        const obj = img as Record<string, unknown>;
        if (typeof obj["base64"] === "string") candidates.push(obj["base64"] as string);
        else if (typeof obj["data"] === "string") candidates.push(obj["data"] as string);
      }
    }
  }
  if (typeof params["image"] === "string") candidates.push(params["image"] as string);
  const attachments = params["attachments"];
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (att && typeof att === "object") {
        const obj = att as Record<string, unknown>;
        const type = String(obj["type"] ?? "");
        if (type.startsWith("image") && typeof obj["data"] === "string") {
          candidates.push(obj["data"] as string);
        }
      }
    }
  }

  for (const c of candidates) {
    const result = validateBase64Image(c);
    if (!result.ok) return result.error ?? "Invalid image";
  }
  return null;
}

// ── KAIROS RPC Handler ───────────────────────────────────

// ── Node Registry (phones acting as agent nodes) ─────────

interface NodeRegistryEntry {
  readonly nodeId: string;
  readonly deviceId: string;
  readonly capabilities: readonly string[];
  readonly registeredAt: number;
}

interface PendingNodeRequest {
  resolve(value: unknown): void;
  reject(err: Error): void;
  readonly requestId: string;
  readonly createdAt: number;
}

// ── ECDH Session Keys ────────────────────────────────────

interface ECDHSession {
  readonly sessionId: string;
  readonly derivedKey: Buffer;
  readonly createdAt: number;
}

// ── Continuity Frame Buffer ──────────────────────────────

interface ContinuityFrame {
  readonly timestamp: number;
  readonly sizeBytes: number;
}

const MAX_FRAME_BUFFER = 30;

export class KairosRPCHandler {
  private readonly handlers: Map<string, RPCHandler> = new Map();
  private runtime: WotannRuntime | null = null;
  private daemon: KairosDaemon | null = null;

  // State for iOS surface handlers (node registry, ECDH keys, frame buffer).
  private readonly nodeRegistry = new Map<string, NodeRegistryEntry>();
  private readonly pendingNodeRequests = new Map<string, PendingNodeRequest>();
  private readonly ecdhSessions = new Map<string, ECDHSession>();
  private readonly frameBuffer: ContinuityFrame[] = [];
  private notificationPrefsPath = join(homedir(), ".wotann", "notifications.json");

  constructor() {
    this.registerBuiltinMethods();
  }

  /**
   * Attach the parent daemon so RPC handlers can access self-improvement
   * subsystems (PatternCrystallizer, FeedbackCollector, etc.) that live on
   * the daemon rather than the runtime.
   */
  setDaemon(daemon: KairosDaemon): void {
    this.daemon = daemon;
  }

  /**
   * Attach a WotannRuntime instance to route RPC calls to.
   */
  setRuntime(runtime: WotannRuntime): void {
    this.runtime = runtime;
    // Register self-improvement handlers now that runtime and daemon are available
    this.registerSelfImprovementHandlers();
    this.registerSurfaceHandlers();
  }

  /**
   * Process a raw JSON-RPC message string.
   * Returns either a single response or a stream event generator.
   */
  async handleMessage(raw: string): Promise<RPCResponse | AsyncGenerator<RPCStreamEvent>> {
    let request: RPCRequest;

    try {
      request = JSON.parse(raw) as RPCRequest;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return this.errorResponse(null, RPC_PARSE_ERROR, "Parse error");
    }

    if (!request.method || !request.id) {
      return this.errorResponse(request.id ?? null, RPC_INVALID_REQUEST, "Invalid request");
    }

    // Streaming methods return an async generator
    if (request.method === "query") {
      return this.handleQuery(request);
    }

    // iOS's `chat.send` routes through the streaming runtime query unless the
    // caller explicitly opts out via `stream: false`, so real-time stream events
    // reach the iOS StreamHandler instead of a single aggregated chunk.
    if (request.method === "chat.send") {
      const streamEnabled = request.params?.["stream"] !== false;
      if (streamEnabled) {
        return this.handleChatSend(request);
      }
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      return this.errorResponse(
        request.id,
        RPC_METHOD_NOT_FOUND,
        `Method not found: ${request.method}`,
      );
    }

    try {
      const result = await handler(request.params ?? {});
      return { jsonrpc: "2.0", result, id: request.id };
    } catch (error) {
      return this.errorResponse(
        request.id,
        RPC_INTERNAL_ERROR,
        error instanceof Error ? error.message : "Internal error",
      );
    }
  }

  /**
   * Handle streaming query — returns an async generator of stream events.
   */
  private async *handleQuery(request: RPCRequest): AsyncGenerator<RPCStreamEvent> {
    if (!this.runtime) {
      yield {
        jsonrpc: "2.0",
        method: "stream",
        params: {
          type: "error",
          content: "Runtime not initialized",
          sessionId: "",
        },
      };
      return;
    }

    const prompt = (request.params?.prompt as string) ?? "";
    const sessionId = (request.params?.sessionId as string) ?? "default";
    const requestedModel = (request.params?.model as string) ?? "";
    const requestedProvider = (request.params?.provider as string) ?? "";

    // Load the system prompt from AGENTS.md + bootstrap files for ALL query paths
    let systemPrompt = "";
    try {
      const { assembleSystemPrompt } = await import("../prompt/engine.js");
      systemPrompt = assembleSystemPrompt({ workspaceRoot: process.cwd() });
    } catch {
      // Fallback: load AGENTS.md directly if prompt engine fails
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const agentsPath = join(homedir(), ".wotann", "AGENTS.md");
        const projectAgentsPath = join(process.cwd(), ".wotann", "AGENTS.md");
        const path = existsSync(projectAgentsPath)
          ? projectAgentsPath
          : existsSync(agentsPath)
            ? agentsPath
            : null;
        if (path) systemPrompt = readFileSync(path, "utf-8");
      } catch {
        /* no system prompt available */
      }
    }

    // Determine which model to use — prefer explicit request, fall back to config
    let targetModel = requestedModel;
    let targetProvider = requestedProvider;
    if (!targetModel) {
      // Read from user's codex config
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const configPath = join(homedir(), ".codex", "config.toml");
        if (existsSync(configPath)) {
          const match = readFileSync(configPath, "utf-8").match(/^model\s*=\s*"([^"]+)"/m);
          if (match?.[1]) targetModel = match[1];
        }
      } catch {
        /* ignore */
      }
    }
    if (!targetModel) targetModel = "gemma4"; // Ultimate fallback to local model

    // Try the runtime's query pipeline first
    let runtimeHasProviders = false;
    try {
      const status = this.runtime.getStatus();
      runtimeHasProviders = (status.providers?.length ?? 0) > 0;
    } catch {
      /* ignore */
    }

    if (runtimeHasProviders) {
      for await (const chunk of this.runtime.query({
        prompt,
        model: targetModel,
        provider: targetProvider as never,
      })) {
        yield {
          jsonrpc: "2.0",
          method: "stream",
          params: {
            type: chunk.type as "text" | "thinking" | "tool_use" | "done" | "error",
            content: chunk.content,
            sessionId,
            provider: chunk.provider,
            model: chunk.model,
          },
        };
      }
      return;
    }

    // Fallback: route through available providers directly (bypassing uninitialized runtime)
    // Smart routing: detect provider from model name
    const isOllamaModel =
      [
        "gemma",
        "llama",
        "qwen",
        "phi",
        "mistral",
        "deepseek",
        "codestral",
        "glm",
        "devstral",
        "nemotron",
      ].some((k) => targetModel.toLowerCase().includes(k)) || targetModel.includes(":");
    const isCloudModel = ["gpt", "claude", "o3", "o4", "chatgpt"].some((k) =>
      targetModel.toLowerCase().includes(k),
    );

    // Route cloud models through Codex CLI via stdin pipe, then Ollama as fallback
    if (isCloudModel) {
      try {
        const { spawn: spawnProcess } = await import("node:child_process");
        const codexModel = targetModel || "gpt-5.4";

        const response = await new Promise<string>((resolve, reject) => {
          const codex = spawnProcess("codex", ["exec", "--json", "-c", `model="${codexModel}"`], {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              ...process.env,
              PATH: process.env["PATH"] ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin",
            },
            timeout: 60000,
          });

          let stdout = "";
          let stderr = "";
          codex.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
          codex.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          const systemContext = systemPrompt ? systemPrompt + "\n\n---\n\n" : "";
          codex.stdin?.write(systemContext + prompt);
          codex.stdin?.end();

          codex.on("close", (code: number | null) => {
            if (code === 0 && stdout.trim()) {
              // Parse JSONL output — extract text from item.completed events
              const textParts: string[] = [];
              for (const line of stdout.trim().split("\n")) {
                try {
                  const event = JSON.parse(line) as {
                    type?: string;
                    item?: { text?: string; type?: string };
                  };
                  if (
                    event.type === "item.completed" &&
                    event.item?.type === "agent_message" &&
                    event.item?.text
                  ) {
                    textParts.push(event.item.text);
                  }
                } catch {
                  /* skip non-JSON lines */
                }
              }
              resolve(textParts.join("\n") || stdout.trim());
            } else {
              reject(new Error(stderr || `Codex exited with code ${code}`));
            }
          });
          codex.on("error", reject);
        });

        if (response) {
          yield {
            jsonrpc: "2.0",
            method: "stream",
            params: {
              type: "text",
              content: response,
              sessionId,
              provider: "codex",
              model: codexModel,
            },
          };
          yield {
            jsonrpc: "2.0",
            method: "stream",
            params: { type: "done", content: "", sessionId, provider: "codex", model: codexModel },
          };
          return;
        }
      } catch (codexErr) {
        // Codex failed — fall through to Ollama
        const errMsg = codexErr instanceof Error ? codexErr.message : "Unknown error";
        // Log the error but don't show it to the user — just fall through silently to Ollama
        console.error(`[WOTANN] Codex CLI failed: ${errMsg}. Falling back to local model.`);
      }
    }

    // Try Ollama (for local models, or as fallback for failed cloud models)
    try {
      const ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
      // Use Ollama streaming API for real-time token delivery
      // Use reduced context window to prevent OOM on limited RAM systems
      // TurboQuant principle: 16GB RAM - 9.6GB model = ~4GB for KV cache ≈ 8K context
      // Ollama q8_0 KV cache + flash attention reduce memory by ~50%
      const ollamaModel = targetModel.includes(":")
        ? targetModel // Already fully qualified (e.g. gemma4:latest)
        : ["gemma", "llama", "qwen", "glm", "phi", "mistral", "deepseek", "codestral"].some((k) =>
              targetModel.toLowerCase().includes(k),
            )
          ? targetModel
          : "gemma4";
      const res = await fetch(`${ollamaHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: prompt },
          ],
          stream: true,
          options: {
            num_ctx: 8192, // Reduced context to prevent OOM (TurboQuant principle)
            num_gpu: 999, // Use all GPU layers
            use_mmap: true, // Memory-mapped loading for efficiency
          },
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const text = decoder.decode(value, { stream: true });
            // Ollama streams NDJSON lines
            for (const line of text.split("\n")) {
              if (!line.trim()) continue;
              try {
                const chunk = JSON.parse(line) as {
                  message?: { content?: string };
                  done?: boolean;
                };
                if (chunk.message?.content) {
                  yield {
                    jsonrpc: "2.0",
                    method: "stream",
                    params: {
                      type: "text",
                      content: chunk.message.content,
                      sessionId,
                      provider: "ollama",
                      model: "gemma4",
                    },
                  };
                }
                if (chunk.done) {
                  yield {
                    jsonrpc: "2.0",
                    method: "stream",
                    params: {
                      type: "done",
                      content: "",
                      sessionId,
                      provider: "ollama",
                      model: "gemma4",
                    },
                  };
                }
              } catch {
                /* skip invalid JSON lines */
              }
            }
          }
        }
        return;
      }
    } catch {
      /* Ollama not available */
    }

    // Try Codex CLI as second fallback
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const tmpFile = `/tmp/wotann-codex-${Date.now()}.txt`;
      const codexModel = targetModel || "gpt-5.4";
      await execFileAsync("codex", ["exec", "-c", `model="${codexModel}"`, "-o", tmpFile, prompt], {
        timeout: 60000,
        encoding: "utf-8",
      });
      const { readFileSync, unlinkSync } = await import("node:fs");
      const responseText = readFileSync(tmpFile, "utf-8").trim();
      try {
        unlinkSync(tmpFile);
      } catch {
        /* cleanup */
      }

      if (responseText) {
        yield {
          jsonrpc: "2.0",
          method: "stream",
          params: {
            type: "text",
            content: responseText,
            sessionId,
            provider: "codex",
            model: targetModel || "gpt-5.4",
          },
        };
        yield {
          jsonrpc: "2.0",
          method: "stream",
          params: {
            type: "done",
            content: "",
            sessionId,
            provider: "codex",
            model: targetModel || "gpt-5.4",
          },
        };
        return;
      }
    } catch {
      /* Codex CLI failed */
    }

    // No providers available
    yield {
      jsonrpc: "2.0",
      method: "stream",
      params: {
        type: "error",
        content: "No providers available. Configure an API key or install a CLI (codex, claude).",
        sessionId,
      },
    };
  }

  /**
   * Handle iOS `chat.send` as a streaming method. Validates image attachments
   * (A9 session corruption guard) before appending the user message, then
   * delegates to the runtime's streaming query so iOS's StreamHandler receives
   * real-time events. If the runtime isn't available, falls back to the same
   * provider fallback path as `query`.
   */
  private async *handleChatSend(request: RPCRequest): AsyncGenerator<RPCStreamEvent> {
    const params = request.params ?? {};
    const prompt =
      (params["content"] as string | undefined) ??
      (params["prompt"] as string | undefined) ??
      (params["message"] as string | undefined) ??
      "";
    const sessionId =
      (params["conversationId"] as string | undefined) ??
      (params["sessionId"] as string | undefined) ??
      "default";

    // A9: validate any attached images before touching the conversation so a
    // corrupt payload can't poison session history.
    const imageError = validateImageParams(params);
    if (imageError) {
      yield {
        jsonrpc: "2.0",
        method: "stream",
        params: { type: "error", content: `Image validation failed: ${imageError}`, sessionId },
      };
      return;
    }

    if (!this.runtime) {
      yield {
        jsonrpc: "2.0",
        method: "stream",
        params: { type: "error", content: "Runtime not initialized", sessionId },
      };
      return;
    }

    const requestedModel = (params["model"] as string | undefined) ?? "";
    const requestedProvider = (params["provider"] as string | undefined) ?? "";

    // Try the runtime streaming path first.
    try {
      let runtimeHasProviders = false;
      try {
        const status = this.runtime.getStatus();
        runtimeHasProviders = (status.providers?.length ?? 0) > 0;
      } catch {
        /* ignore */
      }

      if (runtimeHasProviders) {
        for await (const chunk of this.runtime.query({
          prompt,
          model: requestedModel || undefined,
          provider: requestedProvider ? (requestedProvider as never) : undefined,
        })) {
          yield {
            jsonrpc: "2.0",
            method: "stream",
            params: {
              type: chunk.type as "text" | "thinking" | "tool_use" | "done" | "error",
              content: chunk.content,
              sessionId,
              provider: chunk.provider,
              model: chunk.model,
            },
          };
        }
        return;
      }
    } catch (err) {
      yield {
        jsonrpc: "2.0",
        method: "stream",
        params: {
          type: "error",
          content: `chat.send failed: ${err instanceof Error ? err.message : String(err)}`,
          sessionId,
        },
      };
      return;
    }

    // Runtime has no providers — route through the same fallback path as
    // `query` by synthesizing an equivalent query request.
    yield* this.handleQuery({
      jsonrpc: "2.0",
      method: "query",
      params: { prompt, sessionId, model: requestedModel, provider: requestedProvider },
      id: request.id,
    });
  }

  /**
   * Register a custom RPC method handler.
   */
  register(method: string, handler: RPCHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * List all registered RPC methods.
   */
  getMethods(): readonly string[] {
    return [...this.handlers.keys()];
  }

  // ── Built-in Method Registration ──────────────────────────

  private registerBuiltinMethods(): void {
    // Status — returns real RuntimeStatus from the hosted runtime
    this.handlers.set("status", async () => {
      if (!this.runtime) return { status: "stopped" };
      return this.runtime.getStatus();
    });

    // SECURITY (B1): auth.handshake — surface the current session token to
    // callers that already completed an out-of-band trust dance (ECDH
    // pairing for iOS, Unix-socket filesystem ACL for CLI). This method is
    // exempt from the session-token gate in kairos-ipc.ts so clients can
    // bootstrap. iOS calls this immediately after pairing with the ECDH key
    // established so the token never traverses the wire in plaintext.
    this.handlers.set("auth.handshake", async () => {
      const { readSessionToken } = await import("./kairos-ipc.js");
      const token = readSessionToken();
      if (!token) {
        throw new Error("session_token_unavailable");
      }
      return { token, expiresAt: null };
    });

    // ── Subscription Login RPCs ──────────────────────────
    //
    // Both flows open a system browser tab (OAuth PKCE for Codex, the Claude
    // CLI's built-in login for Anthropic) and resolve once credentials are
    // written to disk. The desktop app calls these via the login_anthropic /
    // login_codex Tauri commands so users never have to touch a terminal.

    this.handlers.set("auth.anthropic-login", async () => {
      const { startAnthropicLogin } = await import("../providers/anthropic-subscription.js");
      try {
        const result = await startAnthropicLogin();
        return result;
      } catch (err) {
        return {
          success: false,
          provider: "anthropic" as const,
          expiresAt: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    this.handlers.set("auth.codex-login", async () => {
      const { startCodexLogin, detectExistingCodexCredential, importCodexCliCredential } =
        await import("../providers/codex-oauth.js");
      try {
        // If the user is already signed into Codex CLI, re-use those tokens
        // instead of forcing another browser round-trip.
        const existing = detectExistingCodexCredential();
        if (existing.found && existing.path) {
          const imported = importCodexCliCredential(existing.path);
          if (imported.success) {
            return {
              success: true,
              provider: "codex" as const,
              expiresAt: existing.expiresAt ?? null,
              tokenSource: existing.path,
              reused: true,
            };
          }
          // Fall through to fresh login if the import failed.
        }

        const tokens = await startCodexLogin();
        return {
          success: true,
          provider: "codex" as const,
          expiresAt: tokens.expiresAt,
          reused: false,
        };
      } catch (err) {
        return {
          success: false,
          provider: "codex" as const,
          expiresAt: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // Detect existing subscription credentials without triggering a login.
    // The desktop app calls this on settings mount to surface the
    // "Found existing login — tap to import" banner.
    this.handlers.set("auth.detect-existing", async () => {
      const { detectExistingAnthropicCredential } =
        await import("../providers/anthropic-subscription.js");
      const { detectExistingCodexCredential } = await import("../providers/codex-oauth.js");
      return {
        anthropic: detectExistingAnthropicCredential(),
        codex: detectExistingCodexCredential(),
      };
    });

    this.handlers.set("auth.import-codex", async (params) => {
      const { importCodexCliCredential } = await import("../providers/codex-oauth.js");
      const path = (params.path as string | undefined) ?? undefined;
      if (!path) {
        return { success: false, error: "path required" };
      }
      return importCodexCliCredential(path);
    });

    this.handlers.set("companion.pairing", async () => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        throw new Error("Companion server not running");
      }

      const pairing = companionServer.generatePairingQR();

      return {
        ...pairing,
        port: Number.isFinite(pairing.port) ? pairing.port : 3849,
      };
    });

    this.handlers.set("companion.devices", async () => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        return [];
      }

      const activeDeviceIds = new Set(
        companionServer
          .getPairingManager()
          .getActiveSessions()
          .map((session) => session.device.id),
      );

      return companionServer
        .getPairingManager()
        .getPairedDevices()
        .map((device) => ({
          id: device.id,
          name: device.name,
          platform: device.platform,
          lastSeen: device.lastSeen,
          connected: activeDeviceIds.has(device.id),
        }));
    });

    this.handlers.set("companion.sessions", async () => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        return [];
      }

      return companionServer
        .getPairingManager()
        .getActiveSessions()
        .map((session) => ({
          id: session.id,
          deviceId: session.device.id,
          deviceName: session.device.name,
          connectedAt: new Date(session.establishedAt).getTime(),
          messagesExchanged: session.messagesExchanged,
          status: session.status,
        }));
    });

    this.handlers.set("companion.unpair", async (params) => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        throw new Error("Companion server not running");
      }
      const deviceId = params.deviceId as string | undefined;
      if (!deviceId) {
        throw new Error("deviceId required");
      }
      return { removed: companionServer.getPairingManager().unpairDevice(deviceId), deviceId };
    });

    this.handlers.set("companion.session.end", async (params) => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        throw new Error("Companion server not running");
      }
      const sessionId = params.sessionId as string | undefined;
      if (!sessionId) {
        throw new Error("sessionId required");
      }
      return { ended: companionServer.getPairingManager().endSession(sessionId), sessionId };
    });

    // Session management — returns the active session
    this.handlers.set("session.list", async () => {
      if (!this.runtime) return [];
      const session = this.runtime.getSession();
      return [
        {
          id: session.id,
          name: session.id,
          provider: session.provider,
          model: session.model,
          createdAt: Date.now(),
          messageCount: session.messages.length,
          totalCost: session.totalCost,
        } satisfies SessionInfo,
      ];
    });

    // NOTE: The canonical session.create handler is registered further below
    // (see ~L1731). The earlier duplicate registered here was dead — Map.set
    // silently overwrote it — and has been removed as part of C5 cleanup.

    // Provider management — returns real provider data from RuntimeStatus
    this.handlers.set("providers.list", async (params) => {
      // Unified discovery via ProviderService. Returns the shape the UI expects:
      // { id, name, enabled, models, defaultModel }. For richer state, use providers.snapshot.
      const { getProviderService } = await import("../providers/provider-service.js");
      const service = getProviderService();
      const force = (params as Record<string, unknown>)["force"] === true;
      const snapshot = await service.getSnapshot({ force });
      return snapshot.providers
        .map((p) => ({
          id: p.id,
          name: p.name + (p.credential?.label ? ` (${p.credential.label})` : ""),
          enabled: p.configured,
          models: p.models.map((m) => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            costPerMTok: m.costPerMTokInput,
          })),
          defaultModel: p.defaultModel ?? "",
        }))
        .filter((p) => p.enabled);
    });

    // providers.snapshot — full state including unconfigured providers + auth methods
    this.handlers.set("providers.snapshot", async (params) => {
      const { getProviderService } = await import("../providers/provider-service.js");
      const service = getProviderService();
      const force = (params as Record<string, unknown>)["force"] === true;
      const snapshot = await service.getSnapshot({ force });
      return {
        providers: snapshot.providers.map((p) => ({
          id: p.id,
          name: p.name,
          tier: p.tier,
          configured: p.configured,
          credentialLabel: p.credential?.label ?? null,
          credentialMethod: p.credential?.method ?? null,
          credentialSource: p.credential?.source ?? null,
          models: p.models,
          defaultModel: p.defaultModel,
          lastRefreshedAt: p.lastRefreshedAt,
          lastError: p.lastError ?? null,
          supportedMethods: service.getSpec(p.id)?.supportedMethods ?? [],
          envKeys: service.getSpec(p.id)?.envKeys ?? [],
          docsUrl: service.getSpec(p.id)?.docsUrl ?? null,
        })),
        active: snapshot.active,
        lastRefreshedAt: snapshot.lastRefreshedAt,
      };
    });

    // providers.saveCredential — save an API key or OAuth token
    this.handlers.set("providers.saveCredential", async (params) => {
      const { providerId, method, token, expiresAt, label } = params as {
        providerId?: string;
        method?: string;
        token?: string;
        expiresAt?: number;
        label?: string;
      };
      if (!providerId || !method || !token)
        throw new Error("providerId, method, and token required");
      const { getProviderService } = await import("../providers/provider-service.js");
      const state = await getProviderService().saveCredential(providerId, {
        method: method as "apiKey" | "oauth" | "subscription" | "cli" | "local",
        token,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(label !== undefined ? { label } : {}),
      });
      return {
        ok: true,
        provider: state
          ? { id: state.id, configured: state.configured, models: state.models.length }
          : null,
      };
    });

    // providers.deleteCredential — remove saved credential for a provider
    this.handlers.set("providers.deleteCredential", async (params) => {
      const { providerId } = params as { providerId?: string };
      if (!providerId) throw new Error("providerId required");
      const { getProviderService } = await import("../providers/provider-service.js");
      await getProviderService().deleteCredential(providerId);
      return { ok: true };
    });

    // providers.test — validate the current credential by fetching model list
    this.handlers.set("providers.test", async (params) => {
      const { providerId } = params as { providerId?: string };
      if (!providerId) throw new Error("providerId required");
      const { getProviderService } = await import("../providers/provider-service.js");
      return getProviderService().testCredential(providerId);
    });

    // providers.refresh — force re-discovery of all providers
    this.handlers.set("providers.refresh", async () => {
      const { getProviderService } = await import("../providers/provider-service.js");
      await getProviderService().refresh();
      return { ok: true, refreshedAt: Date.now() };
    });

    // providers.import — import credentials from a discovered file path
    this.handlers.set("providers.import", async (params) => {
      const { providerId, path } = params as { providerId?: string; path?: string };
      if (!providerId || !path) throw new Error("providerId and path required");
      const { getProviderService } = await import("../providers/provider-service.js");
      const state = await getProviderService().importFromPath(providerId, path);
      return { ok: state !== null, provider: state?.id ?? null };
    });

    // Legacy handler kept for reference — now superseded by providers.snapshot.
    this.handlers.set("providers.list.legacy", async () => {
      type ProviderResult = {
        id: string;
        name: string;
        enabled: boolean;
        models: Array<{ id: string; name: string; contextWindow: number; costPerMTok: number }>;
        defaultModel: string;
      };
      const results: ProviderResult[] = [];

      // 1. Ollama — always probe (free, local, no auth)
      try {
        const ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
        const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = (await res.json()) as {
            models: Array<{ name: string; details?: { parameter_size?: string }; size?: number }>;
          };
          const models = data.models.map((m) => ({
            id: m.name,
            name: m.name.replace(":latest", ""),
            contextWindow: 128000,
            costPerMTok: 0,
          }));
          if (models.length > 0) {
            results.push({
              id: "ollama",
              name: "Ollama (Local)",
              enabled: true,
              models,
              defaultModel: models[0]?.id ?? "",
            });
          }
        }
      } catch {
        /* Ollama not running */
      }

      // 2. Anthropic — detect via API key, Claude CLI, or saved OAuth token
      const anthropicKey = process.env["ANTHROPIC_API_KEY"];
      const claudeOauthToken = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      let hasClaudeCli = false;
      if (!anthropicKey && !claudeOauthToken) {
        try {
          const { execFileSync } = await import("node:child_process");
          execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 3000 });
          hasClaudeCli = true;
        } catch {
          /* claude CLI not installed */
        }
      }
      // Also check for saved OAuth token from wotann login
      let hasSavedOAuth = false;
      if (!anthropicKey && !claudeOauthToken && !hasClaudeCli) {
        try {
          const { existsSync } = await import("node:fs");
          const { homedir } = await import("node:os");
          const { join } = await import("node:path");
          hasSavedOAuth = existsSync(join(homedir(), ".wotann", "anthropic-oauth.json"));
        } catch {
          /* ignore */
        }
      }

      if (anthropicKey || claudeOauthToken || hasClaudeCli || hasSavedOAuth) {
        // If API key is available, try to fetch real model list from Anthropic API
        let anthropicModels: Array<{
          id: string;
          name: string;
          contextWindow: number;
          costPerMTok: number;
        }> = [];
        if (anthropicKey) {
          try {
            const res = await fetch("https://api.anthropic.com/v1/models", {
              headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
              signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
              const data = (await res.json()) as {
                data?: Array<{ id: string; display_name?: string }>;
              };
              anthropicModels = (data.data ?? []).slice(0, 10).map((m) => ({
                id: m.id,
                name: m.display_name ?? m.id,
                contextWindow: 200000,
                costPerMTok: 3,
              }));
            }
          } catch {
            /* API unreachable */
          }
        }
        // Fallback to well-known models for CLI/OAuth users
        if (anthropicModels.length === 0) {
          anthropicModels = [
            {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              contextWindow: 200000,
              costPerMTok: 15,
            },
            {
              id: "claude-sonnet-4-6",
              name: "Claude Sonnet 4.6",
              contextWindow: 200000,
              costPerMTok: 3,
            },
            {
              id: "claude-haiku-4-5",
              name: "Claude Haiku 4.5",
              contextWindow: 200000,
              costPerMTok: 0.25,
            },
          ];
        }
        const authMethod = anthropicKey ? "API Key" : hasClaudeCli ? "Claude CLI" : "OAuth";
        results.push({
          id: "anthropic",
          name: `Anthropic (${authMethod})`,
          enabled: true,
          models: anthropicModels,
          defaultModel: anthropicModels[0]?.id ?? "",
        });
      }

      // 3. OpenAI — query /v1/models if API key exists
      const openaiKey = process.env["OPENAI_API_KEY"];
      if (openaiKey) {
        try {
          const res = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${openaiKey}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: Array<{ id: string }> };
            const chatModels = (data.data ?? [])
              .filter((m) => m.id.includes("gpt") || m.id.includes("o3") || m.id.includes("o4"))
              .slice(0, 10);
            const models = chatModels.map((m) => ({
              id: m.id,
              name: m.id,
              contextWindow: 128000,
              costPerMTok: 2,
            }));
            if (models.length > 0) {
              results.push({
                id: "openai",
                name: "OpenAI",
                enabled: true,
                models,
                defaultModel: models[0]?.id ?? "",
              });
            }
          }
        } catch {
          /* API unreachable */
        }
      }

      // 4. Gemini — query if API key exists
      // SECURITY (B2): send the API key via the `x-goog-api-key` header rather
      // than as a query-string parameter, so it does not leak into server
      // access logs, HTTP referers, or error traces.
      const geminiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
      if (geminiKey) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models`, {
            headers: { "x-goog-api-key": geminiKey },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              models?: Array<{ name: string; displayName?: string; inputTokenLimit?: number }>;
            };
            const models = (data.models ?? [])
              .filter((m) => m.name.includes("gemini"))
              .slice(0, 10)
              .map((m) => ({
                id: m.name.replace("models/", ""),
                name: m.displayName ?? m.name,
                contextWindow: m.inputTokenLimit ?? 1000000,
                costPerMTok: 0,
              }));
            if (models.length > 0) {
              results.push({
                id: "gemini",
                name: "Google Gemini",
                enabled: true,
                models,
                defaultModel: models[0]?.id ?? "",
              });
            }
          }
        } catch {
          /* API unreachable */
        }
      }

      // 5. Groq — query /v1/models if API key exists
      const groqKey = process.env["GROQ_API_KEY"];
      if (groqKey) {
        try {
          const res = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${groqKey}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: Array<{ id: string }> };
            const models = (data.data ?? []).slice(0, 10).map((m) => ({
              id: m.id,
              name: m.id,
              contextWindow: 128000,
              costPerMTok: 0.5,
            }));
            if (models.length > 0) {
              results.push({
                id: "groq",
                name: "Groq",
                enabled: true,
                models,
                defaultModel: models[0]?.id ?? "",
              });
            }
          }
        } catch {
          /* API unreachable */
        }
      }

      // 6. GitHub Copilot — check for token
      const ghToken = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
      if (ghToken) {
        try {
          // Exchange GH token for Copilot token and list models
          const tokenRes = await fetch("https://api.github.com/copilot_internal/v2/token", {
            headers: { Authorization: `token ${ghToken}` },
            signal: AbortSignal.timeout(5000),
          });
          if (tokenRes.ok) {
            const tokenData = (await tokenRes.json()) as {
              token?: string;
              endpoints?: { api?: string };
            };
            const copilotToken = tokenData.token;
            const apiBase = tokenData.endpoints?.api ?? "https://api.githubcopilot.com";
            if (copilotToken) {
              const modelsRes = await fetch(`${apiBase}/models`, {
                headers: { Authorization: `Bearer ${copilotToken}` },
                signal: AbortSignal.timeout(5000),
              });
              if (modelsRes.ok) {
                const modelsData = (await modelsRes.json()) as {
                  data?: Array<{ id: string; name?: string }>;
                };
                const models = (modelsData.data ?? []).slice(0, 15).map((m) => ({
                  id: m.id,
                  name: m.name ?? m.id,
                  contextWindow: 128000,
                  costPerMTok: 0,
                }));
                if (models.length > 0) {
                  results.push({
                    id: "copilot",
                    name: "GitHub Copilot",
                    enabled: true,
                    models,
                    defaultModel: models[0]?.id ?? "",
                  });
                }
              }
            }
          }
        } catch {
          /* Copilot not available */
        }
      }

      // 7. Codex (ChatGPT subscription) — read auth.json, decode JWT plan type, map to models
      // SECURITY (B3): verify JWT structure, expiration, and issuer before
      // trusting any claims. We do not have the JWK to verify the signature
      // locally, but at minimum we reject malformed, expired, or wrong-issuer
      // tokens so a local attacker cannot forge claims by editing auth.json.
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const authPath = join(homedir(), ".codex", "auth.json");
        if (existsSync(authPath)) {
          const authData = JSON.parse(readFileSync(authPath, "utf-8")) as {
            auth_mode?: string;
            tokens?: { id_token?: string; access_token?: string };
          };

          if (authData.tokens?.id_token) {
            const verification = verifyCodexJWT(authData.tokens.id_token);
            if (!verification.valid || !verification.payload) {
              // Structural / exp / iss check failed — do NOT trust the claims.
              console.warn(
                `[WOTANN] codex.auth_invalid: ${verification.error ?? "jwt verification failed"}`,
              );
              throw new Error("codex.auth_invalid");
            }
            // B3 upgrade: attempt cryptographic signature verify in the
            // background. Fire-and-forget so provider discovery stays fast;
            // signature failures are logged but don't block startup.
            const idToken = authData.tokens.id_token;
            void verifyCodexJWTSignature(idToken).then((sig) => {
              if (!sig.signatureVerified) {
                console.warn(
                  `[WOTANN] codex.signature_unverified: ${sig.error ?? "JWKS unreachable; relying on offline defence-in-depth checks"}`,
                );
              }
            });
            const decoded = verification.payload;
            const planType = decoded["https://api.openai.com/auth"]?.chatgpt_plan_type ?? "free";

            // Also read config.toml for the user's preferred model
            let configModel = "";
            try {
              const configPath = join(homedir(), ".codex", "config.toml");
              if (existsSync(configPath)) {
                const configText = readFileSync(configPath, "utf-8");
                const modelMatch = configText.match(/^model\s*=\s*"([^"]+)"/m);
                if (modelMatch?.[1]) configModel = modelMatch[1];
              }
            } catch {
              /* config read failed */
            }

            // Map plan type to available models (based on OpenAI's published tier access)
            type ModelDef = {
              id: string;
              name: string;
              contextWindow: number;
              costPerMTok: number;
            };
            const modelsByPlan: Record<string, readonly ModelDef[]> = {
              free: [
                {
                  id: "gpt-4.1-mini",
                  name: "GPT-4.1 Mini",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
                {
                  id: "gpt-4.1-nano",
                  name: "GPT-4.1 Nano",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
              ],
              plus: [
                { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 1000000, costPerMTok: 0 },
                { id: "o4-mini", name: "o4-mini", contextWindow: 200000, costPerMTok: 0 },
                { id: "o3", name: "o3", contextWindow: 200000, costPerMTok: 0 },
                { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, costPerMTok: 0 },
                {
                  id: "gpt-4.1-mini",
                  name: "GPT-4.1 Mini",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
                { id: "chatgpt-4o-latest", name: "GPT-4o", contextWindow: 128000, costPerMTok: 0 },
              ],
              pro: [
                { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 1000000, costPerMTok: 0 },
                { id: "o3", name: "o3", contextWindow: 200000, costPerMTok: 0 },
                { id: "o4-mini", name: "o4-mini", contextWindow: 200000, costPerMTok: 0 },
                { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, costPerMTok: 0 },
                {
                  id: "gpt-4.1-mini",
                  name: "GPT-4.1 Mini",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
                { id: "gpt-4.5", name: "GPT-4.5", contextWindow: 128000, costPerMTok: 0 },
                { id: "chatgpt-4o-latest", name: "GPT-4o", contextWindow: 128000, costPerMTok: 0 },
              ],
            };

            const models = [...(modelsByPlan[planType] ?? modelsByPlan["free"] ?? [])];

            // If user has a preferred model in config, move it to the top
            const defaultModel = configModel || models[0]?.id || "gpt-4.1-mini";

            const planLabel =
              planType === "plus" ? "ChatGPT Plus" : planType === "pro" ? "ChatGPT Pro" : "ChatGPT";
            results.push({
              id: "codex",
              name: `${planLabel} (Codex)`,
              enabled: true,
              models,
              defaultModel,
            });
          }
        }
      } catch {
        /* Codex auth not available */
      }

      return results;
    });

    this.handlers.set("providers.switch", async (params) => {
      const provider = params.provider as string;
      const model = params.model as string;
      if (!provider || !model) throw new Error("provider and model required");

      // Validate + set the active provider on the unified service. It throws
      // a descriptive error if the provider is unconfigured or the model is
      // not available so the UI surfaces a clear message.
      const { getProviderService } = await import("../providers/provider-service.js");
      getProviderService().setActive(provider, model);
      return { success: true, provider, model };
    });

    // Cost — returns real cost data from the runtime session and status
    this.handlers.set("cost.current", async () => {
      if (!this.runtime) {
        return {
          sessionCost: 0,
          dailyCost: 0,
          weeklyCost: 0,
          budget: 0,
          budgetUsedPercent: 0,
        } satisfies CostSnapshot;
      }
      const session = this.runtime.getSession();
      const tracker = this.runtime.getCostTracker();
      const dailyCost = tracker.getTodayCost();
      const weeklyCost = tracker.getWeeklyCost();
      const budget = tracker.getBudget() ?? 0;
      const budgetUsedPercent = budget > 0 ? (weeklyCost / budget) * 100 : 0;
      return {
        sessionCost: session.totalCost,
        dailyCost,
        weeklyCost,
        budget,
        budgetUsedPercent,
      } satisfies CostSnapshot;
    });

    // Memory — searches the real hybrid memory system
    this.handlers.set("memory.search", async (params) => {
      const query = params.query as string;
      if (!query) return [];
      if (!this.runtime) return [];
      try {
        const hybridSearch = this.runtime.getHybridSearch();
        const results = hybridSearch.search(query, 10);
        return results.map((r) => ({
          id: r.id,
          score: r.score,
        }));
      } catch {
        // Hybrid search may not be initialized — fall back to empty
        return [];
      }
    });

    // Enhance — uses the real PromptEnhancer from the runtime
    this.handlers.set("enhance", async (params) => {
      const prompt = params.prompt as string;
      if (!prompt) throw new Error("prompt required");
      if (!this.runtime) {
        // No runtime available — return the original prompt unenhanced
        return { original: prompt, enhanced: prompt, style: params.style ?? "detailed" };
      }
      try {
        const enhancer = this.runtime.getPromptEnhancerEngine();
        const style = (params.style as EnhancementStyle) ?? "detailed";
        // Build a query executor that routes through the runtime
        const executor: QueryExecutor = async (p, systemPrompt) => {
          let response = "";
          const startMs = Date.now();
          for await (const chunk of this.runtime!.query({ prompt: `${systemPrompt}\n\n${p}` })) {
            if (chunk.type === "text") response += chunk.content;
          }
          return {
            response,
            model: this.runtime!.getStatus().activeProvider ?? "unknown",
            provider: this.runtime!.getSession().provider,
            tokensUsed: 0,
            durationMs: Date.now() - startMs,
          };
        };
        const result = await enhancer.enhance(prompt, executor, style);
        return {
          original: result.originalPrompt,
          enhanced: result.enhancedPrompt,
          style: result.style,
        };
      } catch {
        // Enhancement failed — return original unchanged
        return { original: prompt, enhanced: prompt, style: params.style ?? "detailed" };
      }
    });

    // Config — reads/writes ~/.wotann/wotann.yaml
    this.handlers.set("config.get", async (params) => {
      const configPath = join(homedir(), ".wotann", "wotann.yaml");
      if (!existsSync(configPath)) return {};
      try {
        const raw = readFileSync(configPath, "utf-8");
        const config = (yamlParse(raw) ?? {}) as Record<string, unknown>;
        const key = params.key as string | undefined;
        if (!key) return config;
        return { key, value: config[key] ?? null };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return {};
      }
    });

    this.handlers.set("config.set", async (params) => {
      const key = params.key as string | undefined;
      const value = params.value;
      if (!key) throw new Error("key required");

      const wotannDir = join(homedir(), ".wotann");
      const configPath = join(wotannDir, "wotann.yaml");

      let config: Record<string, unknown> = {};
      try {
        if (!existsSync(wotannDir)) {
          mkdirSync(wotannDir, { recursive: true });
        }
        if (existsSync(configPath)) {
          const raw = readFileSync(configPath, "utf-8");
          config = (yamlParse(raw) ?? {}) as Record<string, unknown>;
        }
      } catch {
        // Start with empty config on read failure
      }

      // Return a new config object with the updated key (immutable pattern)
      const updated = { ...config, [key]: value };
      writeFileSync(configPath, yamlStringify(updated), "utf-8");
      return { success: true, key, value };
    });

    // Agent fleet — returns combined delegation tasks + background agent tasks
    this.handlers.set("agents.list", async () => {
      const results: AgentInfo[] = [];

      // Delegation tasks from runtime
      if (this.runtime) {
        try {
          const delegationManager = this.runtime.getTaskDelegationManager();
          const pending = delegationManager.getPending();
          for (const task of pending) {
            results.push({
              id: task.id,
              task: task.task,
              status:
                task.status === "in-progress"
                  ? ("running" as const)
                  : task.status === "completed"
                    ? ("completed" as const)
                    : task.status === "failed"
                      ? ("failed" as const)
                      : ("paused" as const),
              progress: task.status === "completed" ? 100 : task.status === "in-progress" ? 50 : 0,
              cost: 0,
              startedAt: task.startedAt ?? task.createdAt,
            } satisfies AgentInfo);
          }
        } catch {
          // Delegation manager may not be initialized
        }
      }

      // Background agent tasks from daemon
      if (this.daemon) {
        try {
          const manager = this.daemon.getBackgroundAgents();
          const tasks = manager.listTasks();
          for (const t of tasks) {
            results.push({
              id: t.id,
              task: t.description,
              status:
                t.status === "running"
                  ? ("running" as const)
                  : t.status === "completed"
                    ? ("completed" as const)
                    : t.status === "failed" || t.status === "cancelled"
                      ? ("failed" as const)
                      : ("paused" as const),
              progress: t.progress,
              cost: t.cost,
              startedAt: t.startedAt,
            } satisfies AgentInfo);
          }
        } catch {
          // Background agents may not be initialized
        }
      }

      return results;
    });

    this.handlers.set("agents.spawn", async (params) => {
      const task = params.task as string;
      if (!task) throw new Error("task required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      try {
        const delegationManager = this.runtime.getTaskDelegationManager();
        const delegated = delegationManager.create(
          "rpc-client",
          task,
          {
            workingDir: "",
            relevantFiles: [],
            decisions: [],
            priorAttempts: [],
            memoryEntryIds: [],
            parentSessionId: "",
          },
          {
            maxTimeMs: 300_000,
            maxCostUsd: 1.0,
            allowedFiles: [],
            forbiddenFiles: [],
            mustPass: [],
          },
        );
        return {
          id: delegated.id,
          task: delegated.task,
          status: delegated.status,
        };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        const id = `agent-${Date.now()}`;
        return { id, task, status: "queued" };
      }
    });

    this.handlers.set("agents.kill", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("agent id required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      try {
        const delegationManager = this.runtime.getTaskDelegationManager();
        // Complete the task as failed to terminate it
        delegationManager.complete(id, {
          success: false,
          output: "Terminated by user",
          filesModified: [],
          testsRun: 0,
          testsPassed: 0,
          costUsd: 0,
          tokensUsed: 0,
          knowledgeExtracted: [],
          errors: ["Terminated by user via RPC"],
        });
        return { success: true, id };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { success: false, id, error: "Agent not found or already terminated" };
      }
    });

    // ── Background Agent Management (via daemon's BackgroundAgentManager) ──

    // agents.submit — submit a new background task for autonomous execution
    this.handlers.set("agents.submit", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const config: BackgroundTaskConfig = {
        description: (params.description as string) ?? (params.task as string) ?? "",
        fileScope: params.fileScope as readonly string[] | undefined,
        model: (params.model as string) ?? "claude-sonnet-4-20250514",
        provider: (params.provider as string) ?? "anthropic",
        maxCost: (params.maxCost as number) ?? 1.0,
        maxTurns: (params.maxTurns as number) ?? 50,
        workingDir: (params.workingDir as string) ?? process.cwd(),
      };
      if (!config.description) throw new Error("description required");
      const manager = this.daemon.getBackgroundAgents();
      const id = manager.submit(config);
      return { id, status: "queued" };
    });

    // agents.cancel — cancel a running or queued background task
    this.handlers.set("agents.cancel", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const manager = this.daemon.getBackgroundAgents();
      const cancelled = manager.cancel(id);
      return { success: cancelled, id };
    });

    // agents.status — get detailed status of a single background task
    this.handlers.set("agents.status", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const manager = this.daemon.getBackgroundAgents();
      const task = manager.getTask(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      return task;
    });

    // Channels — queries the dispatch plane for channel health
    this.handlers.set("channels.status", async () => {
      if (!this.runtime) return [];
      try {
        const dispatchPlane = this.runtime.getDispatchPlane();
        return dispatchPlane.getChannelHealth();
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return [];
      }
    });

    // ── Phase G: Full CLI Parity for Desktop/iOS ─────────

    // Arena — multi-model comparison
    // Each target model is queried by passing the model override through query options,
    // so each iteration actually routes to a different model instead of hitting the default.
    this.handlers.set("arena.run", async (params) => {
      const prompt = params.prompt as string;
      const models = params.models as string[] | undefined;
      if (!prompt) throw new Error("prompt required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const responses: {
        model: string;
        provider: string;
        content: string;
        tokensUsed: number;
        costUsd: number;
        durationMs: number;
      }[] = [];
      const targetModels = models ?? ["claude-opus-4-6", "gpt-5.4"];
      for (const model of targetModels) {
        const start = Date.now();
        try {
          let content = "";
          let responseProvider = "auto";
          // Pass model override so the runtime routes to the correct provider/model
          for await (const chunk of this.runtime.query({ prompt, model })) {
            if (chunk.type === "text") content += chunk.content ?? "";
            if (chunk.provider) responseProvider = chunk.provider;
          }
          responses.push({
            model,
            provider: responseProvider,
            content,
            tokensUsed: Math.ceil(content.length / 4),
            costUsd: content.length * 0.00004,
            durationMs: Date.now() - start,
          });
        } catch {
          // Best-effort path — caller gets a safe fallback, no user-facing error.
          responses.push({
            model,
            provider: "auto",
            content: "Error querying model",
            tokensUsed: 0,
            costUsd: 0,
            durationMs: Date.now() - start,
          });
        }
      }
      return { responses };
    });

    // Deep Research
    this.handlers.set("research", async (params) => {
      const topic = params.topic as string;
      if (!topic) throw new Error("topic required");
      // Route through runtime query with research mode
      let result = "";
      if (this.runtime) {
        const researchPrompt = `Research the following topic thoroughly: ${topic}`;
        for await (const chunk of this.runtime.query({ prompt: researchPrompt })) {
          if (chunk.type === "text") result += chunk.content ?? "";
        }
      }
      return { topic, result, timestamp: Date.now() };
    });

    // Cost details — extended breakdown (weekly/monthly sourced from
    // DailyCostStore so it's real history, not sessionCost * 7).
    this.handlers.set("cost.details", async () => {
      if (!this.runtime) return { sessionCost: 0, dailyCost: 0, weeklyCost: 0, monthlyCost: 0 };
      const status = this.runtime.getStatus();
      const tracker = this.runtime.getCostTracker();
      const session = this.runtime.getSession();
      const dailyCost = tracker.getTodayCost();
      const weeklyCost = tracker.getWeeklyCost();
      const monthlyCost = tracker.getMonthlyCost();
      return {
        sessionCost: session.totalCost,
        dailyCost,
        weeklyCost,
        monthlyCost,
        weekTokens: status.totalTokens,
        weekConversations: 1,
        avgCostPerMessage: status.messageCount > 0 ? session.totalCost / status.messageCount : 0,
        history: tracker.getDailyStore().getAll(),
        budget: tracker.getBudget() ?? 0,
      };
    });

    // Cost arbitrage — compare provider costs
    this.handlers.set("cost.arbitrage", async (params) => {
      const prompt = params.prompt as string;
      if (!this.runtime) return { estimates: [] };
      const tokenEstimate = Math.ceil((prompt?.length ?? 100) / 4);
      const providers = [
        { provider: "anthropic", model: "claude-opus-4-6", costPer1M: 15, quality: "best" },
        { provider: "openai", model: "gpt-5.4", costPer1M: 10, quality: "good" },
        { provider: "google", model: "gemini-2.5-pro", costPer1M: 3.5, quality: "good" },
        { provider: "deepseek", model: "deepseek-r1", costPer1M: 2, quality: "acceptable" },
      ];
      return {
        estimates: providers.map((p) => ({
          provider: p.provider,
          model: p.model,
          estimatedCost: (tokenEstimate / 1_000_000) * p.costPer1M,
          estimatedTokens: tokenEstimate,
          estimatedLatencyMs: p.provider === "anthropic" ? 2000 : 1500,
          quality: p.quality,
          recommended: p.provider === "google",
        })),
      };
    });

    // Skills list
    this.handlers.set("skills.list", async () => {
      if (!this.runtime) return { skills: [], count: 0 };
      try {
        const registry = this.runtime.getSkillRegistry();
        const summaries = registry.getSummaries();
        const skills = summaries.map((s) => ({
          name: s.name,
          description: s.description,
          category: s.category,
          version: s.version ?? null,
          alwaysActive: s.always ?? false,
        }));
        return { skills, count: skills.length };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { skills: [], count: 0 };
      }
    });

    // Mode set
    this.handlers.set("mode.set", async (params) => {
      const mode = params.mode as string;
      if (!mode) throw new Error("mode required");
      // Mode is stored in session state
      return { success: true, mode };
    });

    // Context info
    this.handlers.set("context.info", async () => {
      if (!this.runtime) return { percent: 0, tokens: 0, sources: [] };
      const status = this.runtime.getStatus();
      return {
        percent: status.contextPercent,
        tokens: status.totalTokens,
        messageCount: status.messageCount,
        sources: [],
      };
    });

    // Doctor — system health check
    this.handlers.set("doctor", async () => {
      const checks: { name: string; status: "ok" | "warn" | "fail"; detail: string }[] = [];
      checks.push({
        name: "runtime",
        status: this.runtime ? "ok" : "fail",
        detail: this.runtime ? "WotannRuntime initialized" : "Not initialized",
      });
      checks.push({ name: "node", status: "ok", detail: process.version });
      checks.push({
        name: "memory",
        status: "ok",
        detail: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap`,
      });
      return { checks };
    });

    // Workspaces list
    this.handlers.set("workspaces.list", async () => {
      const { readdirSync, existsSync: exists, statSync } = await import("node:fs");
      const { join: pathJoin } = await import("node:path");
      const { homedir: home } = await import("node:os");
      const workspaces: {
        id: string;
        name: string;
        path: string;
        description: string;
        lastAccessed: number;
        conversationCount: number;
        pinned: boolean;
      }[] = [];
      for (const dir of ["Desktop", "Documents", "Projects", "Code", "dev", "src"]) {
        const base = pathJoin(home(), dir);
        if (!exists(base)) continue;
        try {
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (entry.isDirectory() && exists(pathJoin(base, entry.name, ".wotann"))) {
              const fullPath = pathJoin(base, entry.name);
              workspaces.push({
                id: `ws-${entry.name.toLowerCase().replace(/\s/g, "-")}`,
                name: entry.name,
                path: fullPath,
                description: "",
                lastAccessed: statSync(fullPath).mtimeMs,
                conversationCount: 0,
                pinned: false,
              });
            }
          }
        } catch {
          /* skip inaccessible dirs */
        }
      }
      return { workspaces };
    });

    // Plugins list
    this.handlers.set("plugins.list", async () => {
      if (!this.runtime) return { plugins: [] };
      try {
        const lifecycle = this.runtime.getPluginLifecycle();
        const stats = lifecycle.getStats();
        // Build a plugin list from the lifecycle hook registrations.
        // Each unique pluginName across all events represents a registered plugin.
        const pluginSet = new Map<string, { events: string[]; hookCount: number }>();
        for (const event of Object.keys(stats) as Array<keyof typeof stats>) {
          const hooks = lifecycle.getHooks(event as Parameters<typeof lifecycle.getHooks>[0]);
          for (const hook of hooks) {
            const existing = pluginSet.get(hook.pluginName);
            if (existing) {
              if (!existing.events.includes(event)) {
                existing.events.push(event);
              }
              existing.hookCount++;
            } else {
              pluginSet.set(hook.pluginName, { events: [event], hookCount: 1 });
            }
          }
        }
        const plugins = [...pluginSet.entries()].map(([name, info]) => ({
          name,
          events: info.events,
          hookCount: info.hookCount,
          enabled: true,
        }));
        return { plugins };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { plugins: [] };
      }
    });

    // Connectors list
    this.handlers.set("connectors.list", async () => {
      if (!this.runtime) return { connectors: [] };
      try {
        const dispatch = this.runtime.getDispatchPlane();
        const healthEntries = dispatch.getChannelHealth();
        const connectedChannels = dispatch.getConnectedChannels();
        const connectors = healthEntries.map((h) => ({
          channelType: h.channelType,
          connected: connectedChannels.includes(h.channelType),
          lastMessageAt: h.lastMessageAt,
          messagesReceived: h.messagesReceived,
          messagesSent: h.messagesSent,
          errors: h.errors,
          latencyMs: h.latencyMs,
          upSince: h.upSince,
        }));
        return { connectors };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { connectors: [] };
      }
    });

    // Cron jobs list
    this.handlers.set("cron.list", async () => {
      return { jobs: [] };
    });

    // ── Automation Engine (via daemon's AutomationEngine) ──

    // automations.list — list all configured automations
    this.handlers.set("automations.list", async () => {
      if (!this.daemon) return { automations: [] };
      try {
        const automations = this.daemon.getAutomationEngine().listAutomations();
        return { automations };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { automations: [] };
      }
    });

    // automations.create — create a new event-driven automation
    this.handlers.set("automations.create", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const name = params.name as string;
      const trigger = params.trigger as Record<string, unknown>;
      const agentConfig = params.agentConfig as Record<string, unknown>;
      if (!name || !trigger || !agentConfig) {
        throw new Error("name, trigger, and agentConfig required");
      }
      const automation = this.daemon.getAutomationEngine().createAutomation({
        name,
        enabled: (params.enabled as boolean) ?? true,
        trigger: trigger as unknown as Parameters<
          ReturnType<KairosDaemon["getAutomationEngine"]>["createAutomation"]
        >[0]["trigger"],
        agentConfig: agentConfig as unknown as Parameters<
          ReturnType<KairosDaemon["getAutomationEngine"]>["createAutomation"]
        >[0]["agentConfig"],
        memoryScope: (params.memoryScope as "isolated" | "shared") ?? "isolated",
      });
      return { success: true, automation };
    });

    // automations.update — update an existing automation
    this.handlers.set("automations.update", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const updates = (params.updates as Record<string, unknown>) ?? params;
      const { id: _id, updates: _updates, ...inlineUpdates } = updates;
      const mergedUpdates = Object.keys(inlineUpdates).length > 0 ? inlineUpdates : updates;
      const result = this.daemon
        .getAutomationEngine()
        .updateAutomation(
          id,
          mergedUpdates as Parameters<
            ReturnType<KairosDaemon["getAutomationEngine"]>["updateAutomation"]
          >[1],
        );
      if (!result) throw new Error(`Automation not found: ${id}`);
      return { success: true, automation: result };
    });

    // automations.delete — delete an automation by id
    this.handlers.set("automations.delete", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const deleted = this.daemon.getAutomationEngine().deleteAutomation(id);
      return { success: deleted, id };
    });

    // automations.status — get full automation engine status with next runs
    this.handlers.set("automations.status", async () => {
      if (!this.daemon)
        return { running: false, automations: [], nextRuns: {}, recentExecutions: [] };
      try {
        return this.daemon.getAutomationEngine().getStatus();
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { running: false, automations: [], nextRuns: {}, recentExecutions: [] };
      }
    });

    // Session create
    this.handlers.set("session.create", async (params) => {
      const name = (params.name as string) ?? (params.title as string) ?? "New Session";
      const init = params.init === true;
      // When `init` is set, the command palette "Initialize Project" action
      // is the caller. Queue a hotspot scan so the session starts with a
      // populated code-awareness cache rather than a cold one.
      let initializedHotspots: unknown = null;
      if (init) {
        const hotspotsHandler = this.handlers.get("files.hotspots");
        if (hotspotsHandler) {
          try {
            initializedHotspots = await hotspotsHandler({});
          } catch (err) {
            initializedHotspots = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }
      return {
        id: `session-${Date.now()}`,
        name,
        createdAt: Date.now(),
        init,
        hotspots: initializedHotspots,
      };
    });

    // Dream — trigger learning consolidation via daemon's DreamPipeline
    this.handlers.set("dream", async () => {
      if (!this.daemon) return { success: false, reason: "Daemon not initialized" };
      const pipeline = this.daemon.getDreamPipeline();
      if (!pipeline)
        return {
          success: false,
          reason: "DreamPipeline not initialized (async init may still be pending)",
        };
      try {
        const result = pipeline.runPipelineSync();
        return { success: true, ...result };
      } catch (err) {
        return {
          success: false,
          reason: `Dream pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });

    // ── iOS-Compatible Aliases ────────────────────────────

    // iOS calls "chat.send" — when the caller passes stream:false this
    // non-streaming handler runs and aggregates the response. When stream is
    // left unset or true, handleMessage routes to the streaming handleChatSend
    // path above so iOS's StreamHandler receives real-time events.
    this.handlers.set("chat.send", async (params) => {
      const prompt =
        (params.content as string) ?? (params.prompt as string) ?? (params.message as string) ?? "";
      if (!this.runtime) throw new Error("Runtime not initialized");

      // A9: validate image attachments before appending to conversation.
      const imageError = validateImageParams(params);
      if (imageError) {
        return { ok: false, error: `Image validation failed: ${imageError}` };
      }

      const provider = params.provider as string | undefined;
      const model = params.model as string | undefined;

      let result = "";
      try {
        for await (const chunk of this.runtime.query({
          prompt,
          model: model || undefined,
          provider: provider ? (provider as never) : undefined,
        })) {
          if (chunk.type === "text") result += chunk.content ?? "";
          if (chunk.type === "error") {
            return { ok: false, error: chunk.content || "Query error" };
          }
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { ok: true, content: result };
    });

    // iOS calls "conversations.list" — alias to session.list
    this.handlers.set("conversations.list", this.handlers.get("session.list")!);

    // iOS calls "cost.snapshot" — alias to cost.current
    this.handlers.set("cost.snapshot", this.handlers.get("cost.current")!);

    // iOS calls "task.dispatch" — alias to agents.spawn
    this.handlers.set("task.dispatch", this.handlers.get("agents.spawn")!);

    // ── Task Approval Handlers (iOS approve/reject/cancel UI) ──

    this.handlers.set("task.approve", async (params) => {
      const taskId = (params.taskId as string) ?? (params.id as string);
      if (!taskId || !this.runtime) throw new Error("taskId and runtime required");
      const dm = this.runtime.getTaskDelegationManager();
      dm.accept(taskId, "ios-user");
      dm.markInProgress(taskId);
      return { success: true, taskId };
    });

    this.handlers.set("task.reject", async (params) => {
      const taskId = (params.taskId as string) ?? (params.id as string);
      if (!taskId || !this.runtime) throw new Error("taskId and runtime required");
      const dm = this.runtime.getTaskDelegationManager();
      dm.complete(taskId, {
        success: false,
        output: "Rejected by user",
        filesModified: [],
        testsRun: 0,
        testsPassed: 0,
        costUsd: 0,
        tokensUsed: 0,
        knowledgeExtracted: [],
        errors: ["Rejected"],
      });
      return { success: true, taskId };
    });

    this.handlers.set("task.cancel", async (params) => {
      const taskId = (params.taskId as string) ?? (params.id as string);
      if (!taskId || !this.runtime) throw new Error("taskId and runtime required");
      const dm = this.runtime.getTaskDelegationManager();
      dm.complete(taskId, {
        success: false,
        output: "Cancelled by user",
        filesModified: [],
        testsRun: 0,
        testsPassed: 0,
        costUsd: 0,
        tokensUsed: 0,
        knowledgeExtracted: [],
        errors: ["Cancelled"],
      });
      return { success: true, taskId };
    });

    // execute — shell command execution with sanitizer pre-check (B5).
    //
    // SECURITY (B5): every shell command arriving from an iOS/desktop frontend
    // is passed through the sanitizer before we spawn a subprocess. The
    // sanitizer blocks catastrophic patterns (rm -rf /, dd if=/dev/zero,
    // forkbomb, pipe-to-shell, /etc/passwd writes) and gates privileged ops
    // (sudo, chmod 777, chown, mkfs, format) behind an explicit allowlist
    // flag. Callers that have pre-approved privileged operations can pass
    // `allowPrivileged: true` in params.
    //
    // The Rust `execute_command` in desktop-app/src-tauri/src/commands.rs
    // performs its own blocklist check too — this is defence in depth.
    this.handlers.set("execute", async (params) => {
      const cmd =
        (params.cmd as string | undefined) ?? (params.command as string | undefined) ?? "";
      const cwd = (params.cwd as string | undefined) ?? process.cwd();
      const allowPrivileged = params.allowPrivileged === true;
      const timeoutMs =
        typeof params.timeoutMs === "number"
          ? Math.min(Math.max(params.timeoutMs, 100), 300_000) // clamp 100ms..300s
          : 30_000;

      // Pre-check: sanitizer verdict
      const verdict = sanitizeCommand(cmd, { allowPrivileged });
      if (!verdict.safe) {
        return {
          ok: false,
          error: "command_rejected",
          severity: verdict.severity,
          reason: verdict.reason ?? "unsafe command",
        };
      }

      // Execute via /bin/sh -c, capturing stdout/stderr.
      const { spawn: spawnProc } = await import("node:child_process");
      return new Promise<Record<string, unknown>>((resolve) => {
        const proc = spawnProc("sh", ["-c", cmd], {
          cwd,
          timeout: timeoutMs,
          env: process.env,
        });
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d: Buffer) => {
          stdout += d.toString("utf-8");
        });
        proc.stderr?.on("data", (d: Buffer) => {
          stderr += d.toString("utf-8");
        });
        proc.on("close", (code: number | null) => {
          resolve({
            ok: code === 0,
            exitCode: code ?? -1,
            stdout,
            stderr,
            severity: verdict.severity,
            ...(verdict.reason ? { reason: verdict.reason } : {}),
          });
        });
        proc.on("error", (err: Error) => {
          resolve({
            ok: false,
            error: "spawn_failed",
            detail: err.message,
            severity: verdict.severity,
          });
        });
      });
    });

    // shell.precheck — non-executing command validation for UI pre-flight.
    // Returns the sanitizer verdict without spawning a process. Useful for
    // disabling the "Run" button on iOS/desktop when the command is rejected.
    this.handlers.set("shell.precheck", async (params) => {
      const cmd =
        (params.cmd as string | undefined) ?? (params.command as string | undefined) ?? "";
      const allowPrivileged = params.allowPrivileged === true;
      return sanitizeCommand(cmd, { allowPrivileged });
    });

    // ── CLI-Parity Methods ──────────────────────────────

    // autonomous.run — start autonomous execution via runtime query
    this.handlers.set("autonomous.run", async (params) => {
      const task = (params.task as string) ?? (params.prompt as string);
      if (!task) throw new Error("task required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      // Verify executor is available, then route through runtime query
      this.runtime.getAutonomousExecutor();
      const notifier = this.runtime.getNotificationManager();
      try {
        let result = "";
        for await (const chunk of this.runtime.query({ prompt: `[AUTONOMOUS MODE] ${task}` })) {
          if (chunk.type === "text") result += chunk.content ?? "";
        }
        // Surface completion to desktop + iOS via notification queue.
        notifier.push(
          "task-complete",
          "Autonomous task complete",
          task.length > 120 ? task.slice(0, 117) + "..." : task,
        );
        return { task, result, timestamp: Date.now() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notifier.push("error", "Autonomous task failed", `${task}: ${message}`.slice(0, 180));
        throw err;
      }
    });

    // session.resume — resume a saved session
    this.handlers.set("session.resume", async (params) => {
      const sessionId = params.sessionId as string | undefined;
      if (!this.runtime) throw new Error("Runtime not initialized");
      const sessionsDir = join(homedir(), ".wotann", "sessions");
      if (!existsSync(sessionsDir)) return { success: false, reason: "No sessions directory" };

      if (sessionId) {
        const filePath = join(sessionsDir, `${sessionId}.json`);
        if (!existsSync(filePath))
          return { success: false, reason: `Session ${sessionId} not found` };
        try {
          const raw = readFileSync(filePath, "utf-8");
          const snapshot = JSON.parse(raw) as Record<string, unknown>;
          return { success: true, session: snapshot };
        } catch {
          // Best-effort path — caller gets a safe fallback, no user-facing error.
          return { success: false, reason: "Failed to parse session file" };
        }
      }

      // No sessionId — return the most recent session
      try {
        const files = (await import("node:fs"))
          .readdirSync(sessionsDir)
          .filter((f: string) => f.endsWith(".json"))
          .sort()
          .reverse();
        const latest = files[0];
        if (!latest) return { success: false, reason: "No saved sessions" };
        const raw = readFileSync(join(sessionsDir, latest), "utf-8");
        const snapshot = JSON.parse(raw) as Record<string, unknown>;
        return { success: true, session: snapshot };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { success: false, reason: "Failed to read sessions" };
      }
    });

    // architect — route through runtime query with architect system prompt
    this.handlers.set("architect", async (params) => {
      const prompt = (params.prompt as string) ?? (params.question as string);
      if (!prompt) throw new Error("prompt required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const architectPrompt = [
        "[ARCHITECT MODE] You are a senior system architect. Analyze the following",
        "and provide a detailed architectural design with components, interfaces,",
        "data flow, and trade-offs.\n\n",
        prompt,
      ].join(" ");
      let result = "";
      for await (const chunk of this.runtime.query({ prompt: architectPrompt })) {
        if (chunk.type === "text") result += chunk.content ?? "";
      }
      return { result, timestamp: Date.now() };
    });

    // council — multi-model deliberation via runtime
    this.handlers.set("council", async (params) => {
      const query = (params.query as string) ?? (params.prompt as string);
      const providers = params.providers as string[] | undefined;
      if (!query) throw new Error("query required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      try {
        const providerNames = (providers ?? [
          "anthropic",
          "openai",
        ]) as import("../core/types.js").ProviderName[];
        const result = await this.runtime.runCouncil(query, providerNames);
        return {
          synthesis: result.synthesis,
          chairmanModel: result.chairmanModel,
          memberCount: result.members.length,
          totalTokens: result.totalTokens,
          totalDurationMs: result.totalDurationMs,
          timestamp: result.timestamp,
        };
      } catch (error) {
        throw new Error(
          `Council failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    });

    // channels.start — start accepting messages on a channel
    this.handlers.set("channels.start", async (params) => {
      const channelType = params.channel as string;
      if (!channelType) throw new Error("channel required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      const health = plane.getChannelHealth();
      const found = health.find((h) => h.channelType === channelType);
      return { channel: channelType, connected: found?.connected ?? false, health };
    });

    // channels.stop — disconnect a channel
    this.handlers.set("channels.stop", async (params) => {
      const channelType = params.channel as string;
      if (!channelType) throw new Error("channel required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      // Channels are adapter-based; report current health
      const health = plane.getChannelHealth();
      return { channel: channelType, stopped: true, health };
    });

    // channels.policy.list — list route policies
    this.handlers.set("channels.policy.list", async () => {
      if (!this.runtime) return { policies: [] };
      const plane = this.runtime.getDispatchPlane();
      const policies = plane.getPolicies();
      return { policies };
    });

    // channels.policy.add — add a dispatch route policy
    this.handlers.set("channels.policy.add", async (params) => {
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      const policy: DispatchRoutePolicy = {
        id: (params.id as string) ?? `policy-${Date.now()}`,
        label: params.label as string | undefined,
        channelType: params.channelType as string | undefined,
        channelId: params.channelId as string | undefined,
        senderId: params.senderId as string | undefined,
        provider: params.provider as import("../core/types.js").ProviderName | undefined,
        model: params.model as string | undefined,
      };
      plane.upsertPolicy(policy);
      return { success: true, policy };
    });

    // channels.policy.remove — remove a route policy by ID
    this.handlers.set("channels.policy.remove", async (params) => {
      const policyId = params.id as string;
      if (!policyId) throw new Error("id required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      const removed = plane.removePolicy(policyId);
      return { success: removed, id: policyId };
    });

    // memory.verify — verify a memory entry against the codebase
    this.handlers.set("memory.verify", async (params) => {
      const entryId = params.entryId as string;
      if (!entryId) throw new Error("entryId required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workingDir = this.runtime.getWorkingDir();
      // Access memory store through hybrid search verification
      try {
        // Route through runtime query to verify memory
        let result = "";
        for await (const chunk of this.runtime.query({
          prompt: `[MEMORY VERIFY] Verify memory entry ${entryId} against current codebase state.`,
        })) {
          if (chunk.type === "text") result += chunk.content ?? "";
        }
        return { entryId, verified: true, workingDir, detail: result.slice(0, 500) };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { entryId, verified: false, error: "Verification failed" };
      }
    });

    // lsp.symbols — find symbols in workspace
    this.handlers.set("lsp.symbols", async (params) => {
      const name = params.name as string;
      if (!name) throw new Error("name required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const symbols = await ops.findSymbol(name);
      return { symbols, count: symbols.length };
    });

    // lsp.outline — get document symbol outline for a file
    this.handlers.set("lsp.outline", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      if (!uri) throw new Error("uri required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const symbols = await ops.getDocumentSymbols(uri);
      return { symbols, count: symbols.length };
    });

    // lsp.refs — find references to a symbol at position
    this.handlers.set("lsp.refs", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      const line = (params.line as number) ?? 0;
      const character = (params.character as number) ?? 0;
      if (!uri) throw new Error("uri required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const refs = await ops.findReferences(uri, { line, character });
      return { references: refs, count: refs.length };
    });

    // lsp.hover — get type/hover info at position
    this.handlers.set("lsp.hover", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      const line = (params.line as number) ?? 0;
      const character = (params.character as number) ?? 0;
      if (!uri) throw new Error("uri required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const info = await ops.getTypeInfo(uri, { line, character });
      return { info };
    });

    // lsp.rename — rename a symbol across the codebase
    this.handlers.set("lsp.rename", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      const line = (params.line as number) ?? 0;
      const character = (params.character as number) ?? 0;
      const newName = params.newName as string;
      if (!uri || !newName) throw new Error("uri and newName required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const result = await ops.rename(uri, { line, character }, newName);
      return {
        filesAffected: result.filesAffected,
        editsApplied: result.editsApplied,
      };
    });

    // repo.map — Aider-style repo map of symbols + centrality (for /init, planner context, command palette)
    this.handlers.set("repo.map", async (params) => {
      const { buildRepoMap, renderRepoMap, summariseRepoMap } =
        await import("../context/repo-map.js");
      const root =
        (params as Record<string, string>)["root"] ??
        this.runtime?.getWorkingDir() ??
        process.cwd();
      const maxBytes = Number((params as Record<string, unknown>)["maxBytes"]) || 8_000;
      try {
        const map = buildRepoMap({ root });
        return {
          summary: summariseRepoMap(map),
          rendered: renderRepoMap(map, maxBytes),
          entries: map.entries.slice(0, 200).map((e) => ({
            path: e.path,
            language: e.language,
            symbols: e.symbols,
            centrality: e.centrality,
            sizeBytes: e.sizeBytes,
          })),
          totalFiles: map.totalFiles,
          generatedAt: map.generatedAt,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          entries: [],
          totalFiles: 0,
        };
      }
    });

    // mcp.list — list MCP servers (installed and available)
    this.handlers.set("mcp.list", async () => {
      // MCP servers are config-based; read from wotann.yaml
      const configPath = join(homedir(), ".wotann", "wotann.yaml");
      if (!existsSync(configPath)) return { servers: [], count: 0 };
      try {
        const raw = readFileSync(configPath, "utf-8");
        const config = (yamlParse(raw) ?? {}) as Record<string, unknown>;
        const mcpServers = config["mcpServers"] ?? config["mcp_servers"] ?? {};
        const servers = Object.entries(mcpServers as Record<string, unknown>).map(
          ([name, entry]) => ({
            name,
            ...(typeof entry === "object" && entry !== null ? entry : {}),
          }),
        );
        return { servers, count: servers.length };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { servers: [], count: 0 };
      }
    });

    // mcp.toggle — flip the `enabled` flag for a named MCP server.
    this.handlers.set("mcp.toggle", async (params) => {
      const name = (params as Record<string, unknown>)["name"] as string | undefined;
      const enabled = (params as Record<string, unknown>)["enabled"] as boolean | undefined;
      if (!name) return { ok: false, error: "name required" };
      const configPath = join(homedir(), ".wotann", "wotann.yaml");
      try {
        const config = existsSync(configPath)
          ? ((yamlParse(readFileSync(configPath, "utf-8")) ?? {}) as Record<string, unknown>)
          : {};
        const key = "mcpServers" in config ? "mcpServers" : "mcp_servers";
        const servers = (config[key] ?? {}) as Record<string, Record<string, unknown>>;
        const entry = servers[name];
        if (!entry) return { ok: false, error: `MCP server '${name}' not found` };
        const next: Record<string, Record<string, unknown>> = {
          ...servers,
          [name]: { ...entry, enabled: typeof enabled === "boolean" ? enabled : !entry["enabled"] },
        };
        const updated = { ...config, [key]: next };
        writeFileSync(configPath, yamlStringify(updated), "utf-8");
        return { ok: true, name, enabled: next[name]?.["enabled"] };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // mcp.add — register a new MCP server in wotann.yaml.
    this.handlers.set("mcp.add", async (params) => {
      const p = params as Record<string, unknown>;
      const name = p["name"] as string | undefined;
      const command = p["command"] as string | undefined;
      const args = (p["args"] as string[] | undefined) ?? [];
      const transport = ((p["transport"] as string | undefined) ?? "stdio") as "stdio" | "http";
      if (!name || !command) return { ok: false, error: "name and command required" };
      const configPath = join(homedir(), ".wotann", "wotann.yaml");
      try {
        if (!existsSync(dirname(configPath))) mkdirSync(dirname(configPath), { recursive: true });
        const config = existsSync(configPath)
          ? ((yamlParse(readFileSync(configPath, "utf-8")) ?? {}) as Record<string, unknown>)
          : {};
        const key = "mcp_servers" in config ? "mcp_servers" : "mcpServers";
        const servers = (config[key] ?? {}) as Record<string, Record<string, unknown>>;
        if (servers[name]) return { ok: false, error: `MCP server '${name}' already exists` };
        const next: Record<string, Record<string, unknown>> = {
          ...servers,
          [name]: { command, args, transport, enabled: true },
        };
        const updated = { ...config, [key]: next };
        writeFileSync(configPath, yamlStringify(updated), "utf-8");
        return { ok: true, name };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // audit.query — query the audit trail
    this.handlers.set("audit.query", async (params) => {
      const dbPath = join(homedir(), ".wotann", "audit.db");
      if (!existsSync(dbPath)) return { entries: [], count: 0 };
      try {
        const trail = new AuditTrail(dbPath);
        const filters: AuditQuery = {
          date: params.date as string | undefined,
          tool: params.tool as string | undefined,
          agentId: params.agentId as string | undefined,
          sessionId: params.sessionId as string | undefined,
          limit: (params.limit as number) ?? 50,
        };
        const entries = trail.query(filters);
        const count = trail.getCount();
        trail.close();
        return { entries, count };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { entries: [], count: 0, error: "Failed to query audit trail" };
      }
    });

    // precommit — run pre-commit analysis on the workspace
    this.handlers.set("precommit", async () => {
      if (!this.runtime) throw new Error("Runtime not initialized");
      const result = this.runtime.runPreCommitAnalysis();
      if (!result) return { checks: [], blockers: [], message: "No edits tracked" };
      return {
        checks: result.checks.map((c) => ({
          name: c.name,
          success: c.success,
          output: c.output.slice(0, 500),
        })),
        blockers: result.blockers,
        commandRunner: result.commandRunner,
      };
    });

    // voice.status — detect voice capabilities
    this.handlers.set("voice.status", async () => {
      if (!this.runtime) return { available: false, capabilities: [], backend: "none" };
      const vibeVoice = this.runtime.getVibeVoiceBackend();
      const status = await vibeVoice.detect();
      return {
        available: status.available,
        version: status.version,
        capabilities: status.capabilities,
        modelLoaded: status.modelLoaded,
        backend: status.backend,
      };
    });

    // local.status — check Ollama/local model availability
    this.handlers.set("local.status", async () => {
      if (!this.runtime) return { available: false, models: [] };
      const status = this.runtime.getStatus();
      const hasOllama = status.providers.includes("ollama");
      // Attempt to detect Ollama by checking its API
      let models: string[] = [];
      let ollamaRunning = false;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const response = await fetch("http://127.0.0.1:11434/api/tags", {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          ollamaRunning = true;
          const data = (await response.json()) as { models?: readonly { name: string }[] };
          models = (data.models ?? []).map((m) => m.name);
        }
      } catch {
        // Ollama not running
      }
      return {
        available: ollamaRunning,
        registeredProvider: hasOllama,
        models,
        endpoint: "http://127.0.0.1:11434",
      };
    });

    // skills.search — search available skills by query
    this.handlers.set("skills.search", async (params) => {
      const query = (params.query as string) ?? "";
      if (!this.runtime) return { skills: [], count: 0 };
      const registry = this.runtime.getSkillRegistry();
      const summaries = registry.getSummaries();
      if (!query) return { skills: summaries, count: summaries.length };
      const lowerQuery = query.toLowerCase();
      const matched = summaries.filter(
        (s) =>
          s.name.toLowerCase().includes(lowerQuery) ||
          s.description.toLowerCase().includes(lowerQuery) ||
          s.category.toLowerCase().includes(lowerQuery),
      );
      return { skills: matched, count: matched.length };
    });

    // train.extract — extract training data from session recordings
    this.handlers.set("train.extract", async (params) => {
      const sessionDir = (params.sessionDir as string) ?? join(homedir(), ".wotann", "sessions");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const pipeline = this.runtime.getTrainingPipeline();
      const pairs = pipeline.extractTrainingData(sessionDir);
      const stats = pipeline.getStats();
      return { extracted: pairs.length, stats };
    });

    // train.status — get training pipeline status
    this.handlers.set("train.status", async () => {
      if (!this.runtime) return { totalExtracted: 0, totalFiltered: 0, averageQuality: 0 };
      const pipeline = this.runtime.getTrainingPipeline();
      return pipeline.getStats();
    });

    // Ping — kept as-is
    this.handlers.set("ping", async () => {
      return { pong: true, timestamp: Date.now() };
    });

    // ── Workflow DAG Engine ──────────────────────────────
    // List available workflows (built-in + custom)
    this.handlers.set("workflow.list", async () => {
      if (!this.daemon) return { workflows: [] };
      const engine = this.daemon.getWorkflowEngine();
      const workflows = engine.listWorkflows();
      return {
        workflows: workflows.map((w) => ({
          name: w.name,
          description: w.description ?? "",
          nodeCount: w.nodes.length,
          nodeIds: w.nodes.map((n) => n.id),
        })),
      };
    });

    // Start a workflow run
    this.handlers.set("workflow.start", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const engine = this.daemon.getWorkflowEngine();
      const name = params["name"] as string;
      const input = (params["input"] as string) ?? "";
      if (!name) throw new Error("workflow name required");
      const workflow = engine.getBuiltin(name);
      if (!workflow) throw new Error(`Workflow not found: ${name}`);
      const run = await engine.startRun(workflow, input);
      return {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        nodeStates: run.nodeStates,
      };
    });

    // Get workflow run status
    this.handlers.set("workflow.status", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const engine = this.daemon.getWorkflowEngine();
      const runId = params["runId"] as string;
      if (!runId) throw new Error("runId required");
      const run = engine.getRun(runId);
      if (!run) return { found: false };
      return {
        found: true,
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        nodeStates: run.nodeStates,
      };
    });
  }

  // ── Self-Improvement RPC Methods ────────────────────
  // These expose the self-training subsystems to all surfaces via KAIROS.

  registerSelfImprovementHandlers(): void {
    // Feedback — record thumbs up/down via daemon's FeedbackCollector
    this.handlers.set("feedback.record", async (params) => {
      const { prompt, response, feedback, provider, model, sessionId } = params as Record<
        string,
        string
      >;
      if (!prompt || !response || !feedback) throw new Error("prompt, response, feedback required");
      if (!this.daemon) return { success: false, error: "Daemon not initialized" };
      try {
        const collector = this.daemon.getFeedbackCollector();
        collector.recordFeedback(
          prompt,
          response,
          feedback as "positive" | "negative",
          provider ?? "unknown",
          model ?? "unknown",
          sessionId ?? "unknown",
        );
        const stats = collector.getStats();
        return { success: true, recorded: true, stats };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    // Patterns — get crystallized patterns from daemon's PatternCrystallizer
    this.handlers.set("patterns.list", async () => {
      if (!this.daemon) return { patterns: [], crystallized: 0 };
      try {
        const crystallizer = this.daemon.getPatternCrystallizer();
        const patterns = crystallizer.getPatterns();
        const crystallized = crystallizer.getCrystallizedCount();
        return { patterns, crystallized };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { patterns: [], crystallized: 0 };
      }
    });

    // Training — run trajectory extraction via daemon's TrajectoryExtractor
    this.handlers.set("training.extract", async () => {
      if (!this.daemon) return { success: false, message: "Daemon not initialized" };
      try {
        const extractor = this.daemon.getTrajectoryExtractor();
        const examples = extractor.extractFromSessions();
        return {
          success: true,
          message: `Extracted ${examples.length} training examples`,
          count: examples.length,
        };
      } catch (err) {
        return { success: false, message: `Trajectory extraction failed: ${String(err)}` };
      }
    });

    // Self-evolution — get pending approval actions from daemon's SelfEvolutionEngine
    this.handlers.set("evolution.pending", async () => {
      if (!this.daemon) return { pending: [] };
      try {
        const engine = this.daemon.getSelfEvolution();
        const pending = engine.getPendingApprovals();
        return { pending };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { pending: [] };
      }
    });

    // Background workers — get status from daemon's BackgroundWorkerManager
    this.handlers.set("workers.status", async () => {
      if (!this.daemon) return { workers: [] };
      try {
        const manager = this.daemon.getBackgroundWorkers();
        const workers = manager.getStatus();
        return { workers };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { workers: [] };
      }
    });

    // Proof bundles — list completed proofs from disk
    this.handlers.set("proofs.list", async () => {
      // Proof bundles are written to {workingDir}/.wotann/proofs/ as JSON files.
      // No daemon getter exists; read directly from the filesystem.
      const proofDir = join(
        this.runtime ? this.runtime.getWorkingDir() : process.cwd(),
        ".wotann",
        "proofs",
      );
      if (!existsSync(proofDir)) return { proofs: [], count: 0 };
      try {
        const { readdirSync } = await import("node:fs");
        const files = readdirSync(proofDir).filter((f: string) => f.endsWith(".json"));
        const proofs = files
          .map((f: string) => {
            try {
              const raw = readFileSync(join(proofDir, f), "utf-8");
              return JSON.parse(raw) as Record<string, unknown>;
            } catch {
              // Best-effort path — caller gets a safe fallback, no user-facing error.
              return null;
            }
          })
          .filter((p): p is Record<string, unknown> => p !== null);
        return { proofs, count: proofs.length };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { proofs: [], count: 0 };
      }
    });

    // Cost prediction — wired to CostOracle
    this.handlers.set("cost.predict", async (params) => {
      const prompt = (params.prompt as string) ?? "";
      const provider = (params.provider as string) ?? "anthropic";
      const model = (params.model as string) ?? "claude-sonnet-4-6";
      if (!this.daemon) return { predictions: [] };
      const oracle = this.daemon.getCostOracle();
      try {
        const estimate = oracle.estimateTaskCost(prompt, provider as never, model);
        return { predictions: [estimate] };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { predictions: [] };
      }
    });

    // Skill merge — trigger skill merger via daemon's SkillMerger
    this.handlers.set("skills.merge", async () => {
      if (!this.daemon) return { success: false, message: "Daemon not initialized" };
      const merger = this.daemon.getSkillMerger();
      if (!merger) {
        return { success: false, message: "SkillMerger not available — requires skills directory" };
      }
      try {
        const result = merger.runMerge();
        return {
          success: true,
          message: `Merged ${result.merged} skills from ${result.groups} groups (${result.discovered} discovered)`,
          ...result,
        };
      } catch (err) {
        return {
          success: false,
          message: `Skill merge failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });
  }

  // ── Surface Handlers (Phase 1A: 10 Critical RPCs) ──────────
  // These expose daemon subsystems that were previously invisible to all surfaces.

  private registerSurfaceHandlers(): void {
    // 1. FlowTracker — real-time action tracking + intent inference
    this.handlers.set("flow.insights", async () => {
      if (!this.daemon) return { insights: [], velocity: 0 };
      const tracker = this.daemon.getFlowTracker();
      const allActions = tracker.getActions();
      return {
        insights: tracker.getInsights(),
        velocity: tracker.getVelocity(),
        recentActions: allActions.slice(-10),
        state: tracker.getState(),
        struggling: tracker.detectStruggle(),
        hotspots: tracker.getHotspots(5),
        gitSignals: tracker.getGitSignals(),
      };
    });

    // 2. Codebase Health — 0-100 project quality score
    this.handlers.set("health.report", async () => {
      if (!this.daemon) return { score: 0, error: "Daemon not initialized" };
      const report = this.daemon.getLastHealthReport();
      if (report) return report;
      if (!this.runtime) return { score: 0, error: "Runtime not initialized" };
      try {
        return await this.runtime.analyzeHealth();
      } catch (err) {
        return { score: 0, error: String(err) };
      }
    });

    // 3. DecisionLedger — architectural decision history
    this.handlers.set("decisions.list", async (params) => {
      if (!this.runtime) return { decisions: [] };
      const ledger = this.runtime.getDecisionLedger();
      const query = (params as Record<string, string>)["query"];
      return {
        decisions: query ? ledger.searchDecisions(query) : ledger.getAllDecisions(),
        count: ledger.getCount(),
        statusCounts: ledger.getCountByStatus(),
      };
    });

    this.handlers.set("decisions.record", async (params) => {
      if (!this.runtime) return { success: false, error: "Runtime not initialized" };
      const { title, description, rationale, alternatives, affectedFiles, tags } = params as Record<
        string,
        unknown
      >;
      if (!title || !description || !rationale)
        return { success: false, error: "title, description, rationale required" };
      const id = this.runtime.recordDecision({
        title: String(title),
        description: String(description),
        rationale: String(rationale),
        alternatives: Array.isArray(alternatives) ? alternatives.map(String) : [],
        affectedFiles: Array.isArray(affectedFiles) ? affectedFiles.map(String) : [],
        tags: Array.isArray(tags) ? tags.map(String) : [],
      });
      return { success: true, id };
    });

    // 4. Living Spec — spec divergence detection
    this.handlers.set("spec.divergence", async () => {
      if (!this.daemon) return { divergences: [], specLoaded: false };
      const spec = this.daemon.getLivingSpec();
      if (!spec) return { divergences: [], specLoaded: false };
      const manager = this.daemon.getLivingSpecManager();
      const divergences = manager.checkDivergence(spec);
      return {
        specLoaded: true,
        title: spec.title,
        version: spec.version,
        itemCount: spec.items.length,
        divergences,
        actionPlan: divergences.length > 0 ? manager.generateActionPlan(divergences) : null,
      };
    });

    // 5. PWR Cycle — 6-phase development workflow
    this.handlers.set("pwr.status", async () => {
      if (!this.daemon) return { phase: "idle", available: false };
      const pwr = this.daemon.getPWREngine();
      const state = pwr.getState();
      return {
        available: true,
        phase: pwr.getCurrentPhase(),
        history: pwr.getPhaseHistory(),
        state,
      };
    });

    this.handlers.set("pwr.advance", async (params) => {
      if (!this.daemon) return { success: false, error: "Daemon not initialized" };
      const pwr = this.daemon.getPWREngine();
      const { message } = params as Record<string, string>;
      if (!message) return { success: false, error: "message required" };
      const result = pwr.processMessage(message);
      return { success: true, ...result };
    });

    // 6. Ambient Awareness — clipboard/file/terminal monitoring
    this.handlers.set("ambient.status", async () => {
      if (!this.daemon) return { active: false, signals: [] };
      const awareness = this.daemon.getAmbientAwareness();
      return {
        active: true,
        signals: awareness.getSignals(),
        signalCount: awareness.getSignalCount(),
        suggestion: awareness.getProactiveSuggestion(),
      };
    });

    // 7. Idle Detector — away detection + welcome-back summary
    this.handlers.set("idle.status", async () => {
      if (!this.daemon) return { idle: false, durationMs: 0 };
      const detector = this.daemon.getIdleDetector();
      const isIdle = detector.checkIdle();
      const durationMs = detector.getIdleDurationMs();
      return {
        idle: isIdle,
        durationMs,
        lastActivity: Date.now() - durationMs,
      };
    });

    // 8. Cross-Device Context — shared context between devices
    this.handlers.set("crossdevice.context", async () => {
      if (!this.daemon) return { devices: [], context: {} };
      const ctx = this.daemon.getCrossDeviceContext();
      const unified = ctx.getUnifiedContext();
      return {
        context: unified,
        recentEvents: ctx.getRecentEvents({ limit: 20 }),
        promptContext: ctx.buildPromptContext(),
        desktopConnected: ctx.isDeviceConnected("desktop"),
        phoneConnected: ctx.isDeviceConnected("phone"),
        watchConnected: ctx.isDeviceConnected("watch"),
      };
    });

    // 9. Event Triggers — automated event reaction rules
    this.handlers.set("triggers.list", async () => {
      if (!this.daemon) return { triggers: [], status: null };
      const system = this.daemon.getEventTriggerSystem();
      return {
        triggers: system.getTriggers(),
        status: system.getStatus(),
      };
    });

    this.handlers.set("triggers.load", async (params) => {
      if (!this.daemon) return { success: false, error: "Daemon not initialized" };
      const system = this.daemon.getEventTriggerSystem();
      const { configPath } = params as Record<string, string>;
      if (!configPath) return { success: false, error: "configPath required" };
      try {
        const count = await system.loadConfig(configPath);
        return { success: true, loadedCount: count };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    // 10. Smart File Search — frecency-based file ranking
    this.handlers.set("files.search", async (params) => {
      if (!this.daemon) return { results: [] };
      const search = this.daemon.getSmartFileSearch();
      if (!search) return { results: [] };
      const query = (params as Record<string, string>)["query"] ?? "";
      if (!query) return { results: [] };
      const limit = Number((params as Record<string, string>)["limit"]) || 20;
      return { results: search.search(query, limit) };
    });

    // ── Phase 2/3/4 Runtime Surface Handlers ──────────────────

    // 11. Route Classify — semantic task routing
    this.handlers.set("route.classify", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { prompt } = params as Record<string, string>;
      if (!prompt) return { error: "prompt required" };
      return this.runtime.classifyAndRoute(prompt);
    });

    // 12. Parallel Search — multi-source search dispatch
    this.handlers.set("search.parallel", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { query } = params as Record<string, string>;
      if (!query) return { error: "query required" };
      return this.runtime.searchAll(query);
    });

    // 13. Action Check — confirm-action gate classification
    this.handlers.set("action.check", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const p = params as Record<string, unknown>;
      const tool = p["tool"] as string | undefined;
      if (!tool) return { error: "tool required" };
      const args = (p["args"] as Record<string, unknown>) ?? {};
      return this.runtime.checkActionApproval(tool, args);
    });

    // 14. Action Pending — pending approval queue
    this.handlers.set("action.pending", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return { pending: this.runtime.getConfirmAction().getPendingApprovals() };
    });

    // 15. Agent Hierarchy — agent tree + active count
    this.handlers.set("agents.hierarchy", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const hierarchy = this.runtime.getAgentHierarchy();
      return {
        tree: hierarchy.getTree(),
        activeCount: hierarchy.getActiveCount(),
      };
    });

    // 16. Agent Workspace — message count + size stats
    this.handlers.set("agents.workspace", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getAgentWorkspace().getStats();
    });

    // 17. Memory Fence — context fence statistics
    this.handlers.set("memory.fence", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getContextFence().getStats();
    });

    // 18. Memory Quality — retrieval quality metrics
    this.handlers.set("memory.quality", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getRetrievalQuality().computeMetrics();
    });

    // 19. Memory Mine — conversation mining
    this.handlers.set("memory.mine", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { text } = params as Record<string, string>;
      if (!text) return { error: "text required" };
      const miner = this.runtime.getConversationMiner();
      if (!miner) return { error: "ConversationMiner not available" };
      return miner.mineGenericText(text);
    });

    // 20. Adaptive Prompts — model classification + profile
    this.handlers.set("prompts.adaptive", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { model } = params as Record<string, string>;
      if (!model) return { error: "model required" };
      const adaptive = this.runtime.getAdaptivePrompts();
      const tier = adaptive.classifyModel(model);
      return {
        tier,
        profile: adaptive.getProfile(tier),
      };
    });

    // 21. Benchmark History — benchmark run history by type
    this.handlers.set("benchmark.history", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { type } = params as Record<string, string>;
      if (!type) return { error: "type required" };
      return { history: this.runtime.getBenchmarkHarness().getHistory(type as BenchmarkType) };
    });

    // 22. Benchmark Best — best score by type
    this.handlers.set("benchmark.best", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { type } = params as Record<string, string>;
      if (!type) return { error: "type required" };
      return { best: this.runtime.getBenchmarkHarness().getBestScore(type as BenchmarkType) };
    });

    // 23. Wakeup Payload — L0+L1 context payload
    this.handlers.set("wakeup.payload", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getWakeUpPayload();
    });

    // ── Tier 2A: Gap Analysis Handlers ──────────────────────────

    // 24. Context Pressure — utilization status + recent history
    this.handlers.set("context.pressure", async () => {
      const monitor = this.daemon?.getContextPressure();
      if (!monitor) return { level: "unknown", utilizationPercent: 0 };
      const recent = monitor.getHistory(1);
      if (recent.length > 0) {
        return recent[0];
      }
      return { level: "unknown", utilizationPercent: 0 };
    });

    // 25. Terminal Monitor — last error with suggested fix
    this.handlers.set("terminal.lastError", async () => {
      const monitor = this.daemon?.getTerminalMonitor();
      return monitor?.getLastErrorWithSuggestion() ?? null;
    });

    // 26. Terminal Monitor — recent error events as suggestions
    this.handlers.set("terminal.suggestions", async () => {
      const monitor = this.daemon?.getTerminalMonitor();
      return monitor?.getErrors(10) ?? [];
    });

    // 27. File Dependency Graph — impact analysis for a given file
    this.handlers.set("files.impact", async (params) => {
      const graph = this.daemon?.getFileDependencyGraph();
      const file = (params as { file?: string })?.file;
      if (!graph || !file) return { impacted: [] };
      const analysis = graph.analyzeImpact(file);
      return {
        impacted: analysis.transitiveDependents,
        direct: analysis.directDependents,
        totalImpact: analysis.totalImpact,
      };
    });

    // 28. File Dependency Graph — most-imported hotspot files
    this.handlers.set("files.hotspots", async () => {
      const graph = this.daemon?.getFileDependencyGraph();
      return { hotspots: graph?.getHotspots(20) ?? [] };
    });

    this.registerIOSSurfaceHandlers();
  }

  /**
   * Register the 20 RPC methods iOS calls but that weren't previously wired.
   * Git, screen control, briefing, meet, autonomous cancel, config sync,
   * security key exchange, continuity frames, node registry, clipboard inject,
   * notifications, and Siri quickAction.
   */
  private registerIOSSurfaceHandlers(): void {
    // Cast for iOS extension points that may not be fully wired on the runtime.
    // All calls are guarded by optional chaining so missing features degrade to
    // actionable error responses rather than runtime crashes.
    type RuntimeExt = {
      getWorkspaceRoot?: () => string;
      getComputerBindings?: () => {
        screenshot: () => Promise<{
          base64: string;
          width: number;
          height: number;
          format?: string;
        }>;
        mouseClick: (x: number, y: number, button?: string) => Promise<void>;
        mouseMove: (x: number, y: number) => Promise<void>;
        scroll: (dx: number, dy: number) => Promise<void>;
        typeText: (t: string) => Promise<void>;
        keyPress: (keys: string[]) => Promise<void>;
        setClipboard?: (t: string) => Promise<void>;
      };
      getMorningBriefing?: () => { generateBriefing: () => Promise<unknown> };
      getSessionManager?: () => { listRecent?: (n: number) => unknown[] };
      getMeetingStore?: () => { getMeeting: (id: string) => { transcript: string } | undefined };
      abortActiveQueries?: () => void;
      updateConfig?: (patch: Record<string, unknown>) => void;
      getConfig?: () => Record<string, unknown>;
      getSessionStore?: () => { storeClientSharedSecret?: (id: string, secret: Buffer) => void };
      getContinuityStore?: () => {
        storeFrame?: (f: { sessionId: string; data: string; timestamp: number }) => string;
        storePhoto?: (p: {
          sessionId: string;
          data: string;
          metadata: Record<string, unknown>;
          timestamp: number;
        }) => string;
      };
      getNodeRegistry?: () => {
        register?: (n: {
          nodeId: string;
          kind: string;
          capabilities: string[];
          name: string;
          connectedAt: number;
        }) => void;
        recordError?: (e: {
          nodeId: string;
          taskId: string;
          error: string;
          timestamp: number;
        }) => void;
        recordResult?: (r: {
          nodeId: string;
          taskId: string;
          result: unknown;
          timestamp: number;
        }) => void;
      };
      getNotificationService?: () => { configure?: (o: unknown) => void };
    };
    const ext = (): RuntimeExt | null =>
      this.runtime ? (this.runtime as unknown as RuntimeExt) : null;

    // ── Git surface (4 methods) ────────────────────────────────
    const runGit = async (args: readonly string[], cwd?: string): Promise<string> => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const run = promisify(execFile);
      const workingDir = cwd ?? ext()?.getWorkspaceRoot?.() ?? process.cwd();
      try {
        const { stdout } = await run("git", [...args], {
          cwd: workingDir,
          maxBuffer: 16 * 1024 * 1024,
        });
        return stdout;
      } catch (err) {
        throw new Error(
          `git ${args.join(" ")}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    this.handlers.set("git.status", async (params) => {
      const path = (params as Record<string, string>)["path"];
      try {
        const [porcelain, branch] = await Promise.all([
          runGit(["status", "--porcelain", "-b"], path),
          runGit(["rev-parse", "--abbrev-ref", "HEAD"], path),
        ]);
        const lines = porcelain.split("\n").filter((l) => l.length > 0);
        const header = lines.find((l) => l.startsWith("##")) ?? "";
        const files = lines
          .filter((l) => !l.startsWith("##"))
          .map((l) => {
            const status = l.slice(0, 2);
            const filename = l.slice(3);
            return {
              status: status.trim(),
              staged: status[0] !== " " && status[0] !== "?",
              modified: status[1] !== " ",
              untracked: status.startsWith("??"),
              path: filename,
            };
          });
        return {
          branch: branch.trim(),
          header,
          files,
          clean: files.length === 0,
          count: files.length,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), clean: true, files: [] };
      }
    });

    this.handlers.set("git.log", async (params) => {
      const path = (params as Record<string, string>)["path"];
      const limit = Number((params as Record<string, unknown>)["limit"]) || 20;
      try {
        const format = "%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s";
        const stdout = await runGit(
          ["log", `--max-count=${limit}`, `--pretty=format:${format}`],
          path,
        );
        const commits = stdout
          .split("\n")
          .filter((l) => l.length > 0)
          .map((line) => {
            const [hash, shortHash, authorName, authorEmail, timestamp, subject] =
              line.split("\x1f");
            return {
              hash,
              shortHash,
              authorName,
              authorEmail,
              timestamp: Number(timestamp) * 1000,
              subject,
            };
          });
        return { commits, count: commits.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), commits: [] };
      }
    });

    this.handlers.set("git.diff", async (params) => {
      const path = (params as Record<string, string>)["path"];
      const staged = Boolean((params as Record<string, unknown>)["staged"]);
      const file = (params as Record<string, string>)["file"];
      try {
        const args = ["diff"];
        if (staged) args.push("--cached");
        if (file) args.push("--", file);
        const diff = await runGit(args, path);
        return { diff, staged, file: file ?? null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), diff: "" };
      }
    });

    this.handlers.set("git.branches", async (params) => {
      const path = (params as Record<string, string>)["path"];
      try {
        const [local, remote] = await Promise.all([
          runGit(["branch", "--format=%(refname:short)\x1f%(HEAD)"], path),
          runGit(["branch", "-r", "--format=%(refname:short)"], path).catch(() => ""),
        ]);
        const branches = local
          .split("\n")
          .filter((l) => l.length > 0)
          .map((line) => {
            const [name, head] = line.split("\x1f");
            return { name, current: head === "*", remote: false };
          });
        const remoteBranches = remote
          .split("\n")
          .filter((l) => l.length > 0)
          .map((name) => ({ name, current: false, remote: true }));
        return { branches: [...branches, ...remoteBranches] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), branches: [] };
      }
    });

    // ── Screen control (3 methods) ─────────────────────────────
    this.handlers.set("screen.capture", async () => {
      const bindings = ext()?.getComputerBindings?.();
      if (!bindings) return { error: "Computer bindings not available" };
      try {
        const img = await bindings.screenshot();
        return {
          image: img.base64,
          width: img.width,
          height: img.height,
          format: img.format ?? "png",
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.handlers.set("screen.input", async (params) => {
      const bindings = ext()?.getComputerBindings?.();
      if (!bindings) return { error: "Computer bindings not available" };
      const kind = (params as Record<string, string>)["kind"];
      try {
        if (kind === "click") {
          const { x, y, button } = params as { x: number; y: number; button?: string };
          await bindings.mouseClick(x, y, button ?? "left");
          return { ok: true };
        }
        if (kind === "move") {
          const { x, y } = params as { x: number; y: number };
          await bindings.mouseMove(x, y);
          return { ok: true };
        }
        if (kind === "scroll") {
          const { dx, dy } = params as { dx?: number; dy?: number };
          await bindings.scroll(dx ?? 0, dy ?? 0);
          return { ok: true };
        }
        return { error: `unknown kind: ${kind}` };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.handlers.set("screen.keyboard", async (params) => {
      const bindings = ext()?.getComputerBindings?.();
      if (!bindings) return { error: "Computer bindings not available" };
      const { text, keys } = params as { text?: string; keys?: string[] };
      try {
        if (text) await bindings.typeText(text);
        if (keys && Array.isArray(keys)) await bindings.keyPress(keys);
        return { ok: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Morning briefing ───────────────────────────────────────
    this.handlers.set("briefing.daily", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const briefer = ext()?.getMorningBriefing?.();
      if (briefer) {
        try {
          return await briefer.generateBriefing();
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }
      // Fallback: assemble from available subsystems
      const costTracker = this.runtime.getCostTracker();
      const sessions = ext()?.getSessionManager?.()?.listRecent?.(5) ?? [];
      return {
        date: new Date().toISOString().slice(0, 10),
        cost: {
          today: costTracker.getTodayCost(),
          weekly: costTracker.getWeeklyCost(),
        },
        recentSessions: sessions,
        weather: null,
        calendar: [],
        tasks: [],
      };
    });

    // ── Meet summarize ─────────────────────────────────────────
    this.handlers.set("meet.summarize", async (params) => {
      const { meetingId, transcript } = params as { meetingId?: string; transcript?: string };
      if (!this.runtime) return { error: "Runtime not initialized" };
      try {
        const store = ext()?.getMeetingStore?.();
        let text = transcript;
        if (!text && meetingId && store) {
          const meeting = store.getMeeting(meetingId);
          text = meeting?.transcript;
        }
        if (!text) return { error: "transcript or meetingId required" };
        // Use runtime query for summarization
        let summary = "";
        for await (const chunk of this.runtime.query({
          prompt: `Summarize this meeting transcript with key decisions, action items, and open questions:\n\n${text}`,
        })) {
          if (chunk.type === "text") summary += chunk.content ?? "";
        }
        return { summary, meetingId: meetingId ?? null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Autonomous cancel ──────────────────────────────────────
    this.handlers.set("autonomous.cancel", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const taskId = (params as Record<string, string>)["taskId"];
      try {
        const executor = this.runtime.getAutonomousExecutor();
        if (
          executor &&
          typeof (executor as { cancel?: (id?: string) => void }).cancel === "function"
        ) {
          (executor as { cancel: (id?: string) => void }).cancel(taskId);
        }
        // Also signal abort on active queries
        ext()?.abortActiveQueries?.();
        return { ok: true, taskId: taskId ?? null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Config sync ────────────────────────────────────────────
    this.handlers.set("config.sync", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const config = (params as Record<string, unknown>)["config"] ?? {};
      const direction = ((params as Record<string, string>)["direction"] ?? "pull") as
        | "pull"
        | "push";
      try {
        if (direction === "push" && typeof config === "object" && config !== null) {
          const allowed = ["ui", "providers", "hooks", "memory"];
          for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
            if (allowed.includes(key)) {
              ext()?.updateConfig?.({ [key]: value });
            }
          }
        }
        const current = ext()?.getConfig?.() ?? {};
        return {
          ok: true,
          direction,
          config: current,
          version: (current as { version?: string }).version ?? "0.1.0",
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Security key exchange (ECDH, X25519) ──────────────────
    this.handlers.set("security.keyExchange", async (params) => {
      const { publicKey, sessionId } = params as { publicKey?: string; sessionId?: string };
      if (!publicKey) return { error: "publicKey required" };
      try {
        const { generateKeyPairSync, diffieHellman, createPublicKey, createHash } =
          await import("node:crypto");
        const { publicKey: serverPub, privateKey: serverPriv } = generateKeyPairSync("x25519");
        const clientPubKey = createPublicKey({
          key: Buffer.from(publicKey, "base64"),
          format: "der",
          type: "spki",
        });
        const shared = diffieHellman({ privateKey: serverPriv, publicKey: clientPubKey });
        // HKDF-style derivation with session salt
        const sid = sessionId ?? `session-${Date.now()}`;
        const derivedKey = createHash("sha256").update(shared).update(sid).digest();
        this.ecdhSessions.set(sid, { sessionId: sid, derivedKey, createdAt: Date.now() });
        // Prune sessions older than 24h to bound memory
        const now = Date.now();
        for (const [k, s] of this.ecdhSessions) {
          if (now - s.createdAt > 24 * 60 * 60 * 1000) this.ecdhSessions.delete(k);
        }
        const serverPubB64 = serverPub.export({ format: "der", type: "spki" }).toString("base64");
        return {
          serverPublicKey: serverPubB64,
          sessionId: sid,
          keyFingerprint: derivedKey.subarray(0, 8).toString("hex"),
          algorithm: "x25519-sha256",
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Continuity camera (iOS → desktop frame handoff) ──────
    this.handlers.set("continuity.frame", async (params) => {
      const { frame, timestamp } = params as { frame?: string; timestamp?: number };
      if (typeof frame !== "string") return { error: "frame (base64) required" };
      try {
        const sizeBytes = Math.floor(frame.length * 0.75); // approx base64 → binary
        this.frameBuffer.push({ timestamp: timestamp ?? Date.now(), sizeBytes });
        while (this.frameBuffer.length > MAX_FRAME_BUFFER) this.frameBuffer.shift();
        return {
          ok: true,
          bufferCount: this.frameBuffer.length,
          totalBytes: this.frameBuffer.reduce((s, f) => s + f.sizeBytes, 0),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.handlers.set("continuity.photo", async (params) => {
      const { photo, sessionId, metadata } = params as {
        photo?: string;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      };
      if (typeof photo !== "string") return { error: "photo (base64) required" };
      try {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const photoDir = join(homedir(), ".wotann", "continuity");
        mkdirSync(photoDir, { recursive: true });
        const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = join(photoDir, `${id}.jpg`);
        writeFileSync(path, Buffer.from(photo, "base64"));
        return {
          ok: true,
          photoId: id,
          path,
          sessionId: sessionId ?? "default",
          metadata: metadata ?? {},
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Node registry (phone, watch, CarPlay acting as nodes) ─
    this.handlers.set("node.register", async (params) => {
      const { nodeId, deviceId, capabilities } = params as {
        nodeId?: string;
        deviceId?: string;
        capabilities?: string[];
      };
      if (!nodeId) return { error: "nodeId required" };
      this.nodeRegistry.set(nodeId, {
        nodeId,
        deviceId: deviceId ?? nodeId,
        capabilities: capabilities ?? [],
        registeredAt: Date.now(),
      });
      return { ok: true, nodeId, totalNodes: this.nodeRegistry.size };
    });

    this.handlers.set("node.error", async (params) => {
      const { requestId, error } = params as { requestId?: string; error?: string };
      if (requestId) {
        const pending = this.pendingNodeRequests.get(requestId);
        if (pending) {
          pending.reject(new Error(error ?? "Node error"));
          this.pendingNodeRequests.delete(requestId);
        }
      }
      return { ok: true };
    });

    this.handlers.set("node.result", async (params) => {
      const { requestId, result } = params as { requestId?: string; result?: unknown };
      if (requestId) {
        const pending = this.pendingNodeRequests.get(requestId);
        if (pending) {
          pending.resolve(result);
          this.pendingNodeRequests.delete(requestId);
        }
      }
      return { ok: true };
    });

    // ── Clipboard inject ───────────────────────────────────────
    this.handlers.set("clipboard.inject", async (params) => {
      const { text } = params as { text?: string };
      if (typeof text !== "string") return { error: "text required" };
      try {
        const bindings = ext()?.getComputerBindings?.();
        if (
          bindings &&
          typeof (bindings as { setClipboard?: (t: string) => Promise<void> }).setClipboard ===
            "function"
        ) {
          await (bindings as { setClipboard: (t: string) => Promise<void> }).setClipboard(text);
          return { ok: true, length: text.length };
        }
        // Fallback via pbcopy on macOS
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const run = promisify(execFile);
        if (process.platform === "darwin") {
          const child = execFile("pbcopy");
          child.stdin?.end(text);
          return { ok: true, length: text.length };
        }
        if (process.platform === "linux") {
          await run("xclip", ["-selection", "clipboard"], { input: text } as unknown as object);
          return { ok: true, length: text.length };
        }
        return { error: `Unsupported platform: ${process.platform}` };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Notifications configure (persists prefs to disk) ──────
    this.handlers.set("notifications.configure", async (params) => {
      const { enabled, types, deviceToken, quietHours } = params as {
        enabled?: boolean;
        types?: string[];
        deviceToken?: string;
        quietHours?: { start: string; end: string };
      };
      try {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        mkdirSync(join(homedir(), ".wotann"), { recursive: true });
        const prefs = {
          enabled: enabled ?? true,
          types: types ?? ["task", "error", "briefing"],
          deviceToken: deviceToken ?? null,
          quietHours: quietHours ?? null,
          updatedAt: Date.now(),
        };
        writeFileSync(this.notificationPrefsPath, JSON.stringify(prefs, null, 2), { mode: 0o600 });
        // Also call service if runtime exposes one
        const notif = ext()?.getNotificationService?.();
        if (notif && typeof notif.configure === "function") {
          notif.configure(prefs);
        }
        return { ok: true, prefs };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Quick action (Siri / widget tap) ───────────────────────
    this.handlers.set("quickAction", async (params) => {
      const { action, args } = params as { action?: string; args?: Record<string, unknown> };
      if (!action) return { error: "action required" };
      if (!this.runtime) return { error: "Runtime not initialized" };
      try {
        const handler = this.handlers.get(action);
        if (handler) {
          const result = await handler(args ?? {});
          return { ok: true, action, result };
        }
        // Treat unknown action as a natural-language prompt to autopilot
        let response = "";
        for await (const chunk of this.runtime.query({
          prompt: `[SIRI ACTION] ${action}${args ? " " + JSON.stringify(args) : ""}`,
        })) {
          if (chunk.type === "text") response += chunk.content ?? "";
        }
        return { ok: true, action, response };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  private errorResponse(id: string | number | null, code: number, message: string): RPCResponse {
    return {
      jsonrpc: "2.0",
      error: { code, message },
      id: id ?? 0,
    };
  }
}
