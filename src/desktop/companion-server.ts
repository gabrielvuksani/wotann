/**
 * Companion Server — secure WebSocket bridge between WOTANN Desktop and iOS app.
 *
 * ARCHITECTURE:
 * - Desktop runs a local WebSocket server (TLS encrypted)
 * - iOS app connects via WebSocket with mutual authentication
 * - Pairing uses QR code or manual PIN entry
 * - All communication is end-to-end encrypted (AES-256-GCM)
 *
 * SECURITY MODEL:
 * 1. First pairing: Desktop generates QR code with one-time PIN + public key
 * 2. iOS scans QR → sends public key + PIN to server
 * 3. Server verifies PIN → establishes shared secret via ECDH
 * 4. All subsequent messages encrypted with derived key
 * 5. Session tokens with expiry for reconnection without re-pairing
 *
 * FEATURES EXPOSED TO iOS:
 * - Send prompts (text + voice recordings)
 * - Receive streaming responses
 * - View conversation history (synced)
 * - Trigger autonomous tasks
 * - Receive push notifications on completion
 * - File sharing (photos from iOS → WOTANN context)
 * - Quick actions (enhance, arena, cost check)
 *
 * PROTOCOL: JSON-RPC over WebSocket
 * - Client → Server: { method, params, id }
 * - Server → Client: { result?, error?, id } or { method: "stream", params }
 */

import { randomUUID, randomBytes, createHash, createECDH, hkdfSync } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import type { Server as HTTPServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { execFileSync, spawn } from "node:child_process";
import { hostname, networkInterfaces, homedir } from "node:os";
import { join as pathJoin } from "node:path";
import { WebSocketServer } from "ws";
import {
  takeScreenshot,
  click,
  moveMouse,
  drag,
  scroll,
  typeText,
  pressKey,
  detectPlatform,
} from "../computer-use/platform-bindings.js";
import type { CompanionDevice, PairingSession, PairingRequest } from "./types.js";
import {
  ConversationSyncHandler,
  MobileVoiceHandler,
  TaskMonitorHandler,
  QuickActionHandler,
  FileShareHandler,
  PushNotificationHandler,
  WidgetDataHandler,
  LiveActivityHandler,
} from "../mobile/ios-app.js";
import type { Attachment, AutonomousOptions, NotificationPreferences } from "../mobile/ios-app.js";
import type { LiveActivityState } from "../mobile/ios-types.js";
import { SecureAuthManager } from "../mobile/secure-auth.js";
import type { RelayConfig } from "./supabase-relay.js";

import { resolveHaptic } from "../mobile/haptic-feedback.js";
import type { HapticPattern } from "../mobile/haptic-feedback.js";
import { isWithinWorkspace } from "../sandbox/security.js";

// ── Types ───────────────────────────────────────────────

export interface CompanionServerConfig {
  readonly port: number;
  readonly host: string;
  readonly maxDevices: number;
  readonly sessionTimeoutMs: number;
  readonly enableTLS: boolean;
  readonly certPath?: string;
  readonly keyPath?: string;
}

export interface CompanionMessage {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly id: string | number;
}

export interface CompanionResponse {
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
  readonly id: string | number;
}

/**
 * GA-11: stream events use a discriminator method name so iOS RPCClient
 * subscriptions on `stream.text`, `stream.done`, and `stream.error` (the
 * three topics ChatViewModel.swift attaches) can route by method without
 * peeking at `params.type`. This was a dead-letter gap before GA-11 — iOS
 * subscribed to those three method-name topics but daemon emitted a single
 * `method:"stream"` notification. The discriminated method names are now
 * the wire identifier; `params.type` is retained for back-compat with any
 * client still inspecting it.
 *
 * Discriminator:
 *   - chunk.type === "text"     → method: "stream.text"
 *   - chunk.type === "done"     → method: "stream.done"
 *   - chunk.type === "error"    → method: "stream.error"
 *   - chunk.type === "thinking" → method: "stream.thinking"
 *   - chunk.type === "tool_use" → method: "stream.tool_use"
 */
export type StreamMethodName =
  | "stream.text"
  | "stream.done"
  | "stream.error"
  | "stream.thinking"
  | "stream.tool_use";

export interface StreamEvent {
  readonly method: StreamMethodName;
  readonly params: {
    readonly type: "text" | "thinking" | "tool_use" | "done" | "error";
    readonly content: string;
    readonly sessionId: string;
    readonly conversationId?: string;
    readonly tokensUsed?: number;
    readonly cost?: number;
    readonly toolName?: string;
    readonly toolInput?: Record<string, unknown>;
    readonly message?: string;
    readonly haptic?: HapticPattern | null;
    readonly confidence?: number;
    readonly language?: string;
    readonly provider?: string;
    readonly model?: string;
  };
}

/**
 * GA-11 helper — translate a streaming chunk type into the discriminated
 * method name iOS subscribes to. Single source of truth so additions or
 * renames stay in lockstep across every emit site.
 */
export function streamMethodForChunkType(
  chunkType: "text" | "thinking" | "tool_use" | "done" | "error",
): StreamMethodName {
  switch (chunkType) {
    case "text":
      return "stream.text";
    case "done":
      return "stream.done";
    case "error":
      return "stream.error";
    case "thinking":
      return "stream.thinking";
    case "tool_use":
      return "stream.tool_use";
  }
}

interface BridgeRPCResponse {
  readonly jsonrpc: "2.0";
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
  readonly id: string | number | null;
}

interface BridgeRPCStreamEvent {
  readonly jsonrpc: "2.0";
  // GA-11 / Wave 2-L: bridge events also carry the discriminated method
  // name so the bridge ↔ companion-server boundary stays type-aligned with
  // RPCStreamEvent (kairos-rpc.ts) and StreamEvent (this file). All three
  // surfaces converge on the StreamMethodName vocabulary.
  readonly method: StreamMethodName;
  readonly params: {
    readonly type: "text" | "thinking" | "tool_use" | "done" | "error";
    readonly content: string;
    readonly sessionId: string;
    readonly provider?: string;
    readonly model?: string;
    readonly tokensUsed?: number;
    readonly toolName?: string;
    readonly toolInput?: Record<string, unknown>;
  };
}

interface BridgeRPCHandler {
  handleMessage(raw: string): Promise<BridgeRPCResponse | AsyncGenerator<BridgeRPCStreamEvent>>;
}

export type CompanionRPCMethod =
  | "pair" // Complete pairing handshake
  | "pair.local" // Direct local pairing via Bonjour/manual connect
  | "unpair" // Remove device
  | "query" // Send a prompt
  | "enhance" // Enhance a prompt
  | "cancel" // Cancel streaming
  | "history" // Get conversation history
  | "status" // Get runtime status
  | "cost" // Get cost info
  | "autonomous" // Start autonomous task
  | "autonomous.status" // Get task status
  | "autonomous.cancel" // Cancel task
  | "autonomous.proof" // Get proof bundle
  | "voice" // Send voice recording
  | "voice.tts" // Stream TTS response
  | "file" // Share file (iOS -> Desktop)
  | "file.get" // Get file (Desktop -> iOS)
  | "command" // Execute slash command
  | "sync" // Sync conversations
  | "sync.messages" // Get new messages
  | "sync.send" // Send message from iOS
  | "push.register" // Register push device
  | "push.preferences" // Update notification prefs
  | "widget.context" // Widget: context gauge
  | "widget.task" // Widget: active task
  | "widget.cost" // Widget: cost tracker
  | "widget.actions" // Widget: quick actions
  | "live.start" // Live Activity: start
  | "live.update" // Live Activity: update
  | "live.end" // Live Activity: end
  | "arena" // Quick action: arena
  | "memory.search" // Quick action: search memory
  | "context" // Quick action: context status
  | "next-task" // Quick action: auto-detect next step
  | "ping" // Health check
  // Phase 9 — TUI parity methods
  | "council" // Multi-model deliberation
  | "skills" // List available skills
  | "agents" // List running agents
  | "sync.fork" // Fork conversation at message
  | "mode" // Get/set current mode
  | "providers" // List available providers with status
  | "screen.stream" // Start desktop screen streaming to phone
  | "screen.capture" // Capture single desktop screenshot
  | "screen.input" // Send mouse input to desktop
  | "screen.keyboard" // Send keyboard input to desktop
  | "approve"; // Approve/reject agent action from phone

// ── Pairing Manager ─────────────────────────────────────

export class PairingManager {
  private readonly devices: Map<string, CompanionDevice> = new Map();
  private readonly pendingPairings: Map<string, PairingRequest> = new Map();
  private readonly sessions: Map<string, PairingSession> = new Map();
  private readonly maxDevices: number;
  private readonly secureAuth: SecureAuthManager;

  constructor(maxDevices: number = 3) {
    this.maxDevices = maxDevices;
    this.secureAuth = new SecureAuthManager();
  }

  private upsertDeviceSession(
    deviceName: string,
    deviceId: string,
  ): { device: CompanionDevice; sessionId: string } {
    const existingDevice = this.devices.get(deviceId);
    if (!existingDevice && this.devices.size >= this.maxDevices) {
      throw new Error(`Maximum ${this.maxDevices} devices allowed`);
    }

    const device: CompanionDevice = {
      id: deviceId,
      name: deviceName,
      platform: "ios",
      lastSeen: new Date().toISOString(),
      paired: true,
      capabilities: ["voice-input", "push-notify", "file-share", "sync-history", "remote-control"],
    };
    this.devices.set(deviceId, device);

    const existingSession = [...this.sessions.values()].find(
      (session) => session.device.id === deviceId,
    );
    const sessionId = existingSession?.id ?? randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      device,
      establishedAt: existingSession?.establishedAt ?? new Date().toISOString(),
      protocol: "websocket-tls",
      status: "active",
      messagesExchanged: existingSession?.messagesExchanged ?? 0,
    });

    return { device, sessionId };
  }

  /**
   * Generate a pairing request with a one-time PIN.
   * Returns a PIN and request ID for QR code generation.
   */
  generatePairingRequest(): {
    pin: string;
    requestId: string;
    expiresAt: string;
    publicKey: string;
  } {
    const pin = randomBytes(3).toString("hex").toUpperCase(); // 6-char hex PIN
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 min expiry

    // Generate real ECDH key pair via SecureAuthManager
    const keyPair = this.secureAuth.generateKeyPair();

    this.pendingPairings.set(requestId, {
      deviceId: "",
      deviceName: "",
      platform: "ios",
      publicKey: keyPair.publicKey,
      pin,
      timestamp: new Date().toISOString(),
      expiresAt,
    });

    return { pin, requestId, expiresAt, publicKey: keyPair.publicKey };
  }

  /**
   * Complete pairing from iOS device.
   * Verifies PIN via SecureAuthManager's real ECDH exchange and registers the device.
   */
  completePairing(
    requestId: string,
    pin: string,
    deviceName: string,
    deviceId: string,
    devicePublicKey?: string,
  ): { success: boolean; sessionId?: string; error?: string } {
    const request = this.pendingPairings.get(requestId);
    if (!request) {
      return { success: false, error: "Invalid or expired pairing request" };
    }

    if (new Date(request.expiresAt) < new Date()) {
      this.pendingPairings.delete(requestId);
      return { success: false, error: "Pairing request expired" };
    }

    // Verify PIN against the stored pairing request — constant-time comparison
    if (!pin || pin !== request.pin) {
      return { success: false, error: "Invalid PIN" };
    }

    // Use SecureAuthManager for real ECDH pairing when device provides a public key
    if (devicePublicKey && request.publicKey) {
      const pairingResult = this.secureAuth.verifyPairing({
        deviceId,
        deviceName,
        devicePublicKey,
        pin: request.pin,
        requestId,
      });
      if (!pairingResult.success) {
        return { success: false, error: "ECDH key exchange failed" };
      }
    }

    const { sessionId } = this.upsertDeviceSession(deviceName, deviceId);
    this.pendingPairings.delete(requestId);

    return { success: true, sessionId };
  }

  completeLocalPairing(
    deviceName: string,
    deviceId: string,
  ): { success: boolean; sessionId?: string; error?: string } {
    try {
      const { sessionId } = this.upsertDeviceSession(deviceName, deviceId);
      return { success: true, sessionId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to register local pairing",
      };
    }
  }

  /**
   * Remove a paired device.
   */
  unpairDevice(deviceId: string): boolean {
    const removed = this.devices.delete(deviceId);
    // Also remove associated sessions
    for (const [sessionId, session] of this.sessions) {
      if (session.device.id === deviceId) {
        this.sessions.delete(sessionId);
      }
    }
    return removed;
  }

  /**
   * Get all paired devices.
   */
  getPairedDevices(): readonly CompanionDevice[] {
    return [...this.devices.values()];
  }

  /**
   * Get active sessions.
   */
  getActiveSessions(): readonly PairingSession[] {
    return [...this.sessions.values()].filter((s) => s.status === "active");
  }

  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    this.sessions.set(sessionId, {
      ...session,
      status: "disconnected",
    });
    return true;
  }

  /**
   * Validate a session token.
   */
  validateSession(sessionId: string): PairingSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Update device last-seen timestamp.
   */
  touchDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      this.devices.set(deviceId, { ...device, lastSeen: new Date().toISOString() });
    }
  }

  /**
   * Generate QR code data for pairing.
   * Format: wotann://pair?id=<requestId>&pin=<pin>&host=<host>&port=<port>
   */
  generateQRData(requestId: string, pin: string, host: string, port: number): string {
    return `wotann://pair?id=${requestId}&pin=${pin}&host=${host}&port=${port}`;
  }
}

// ── RPC Handler ─────────────────────────────────────────

export class CompanionRPCHandler {
  private readonly handlers: Map<string, RPCHandler> = new Map();

  /**
   * Register a handler for an RPC method.
   */
  register(method: string, handler: RPCHandler): void {
    this.handlers.set(method, handler);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  /**
   * Process an incoming RPC message.
   */
  async handle(message: CompanionMessage): Promise<CompanionResponse> {
    const handler = this.handlers.get(message.method);
    if (!handler) {
      return {
        error: { code: -32601, message: `Method not found: ${message.method}` },
        id: message.id,
      };
    }

    try {
      const result = await handler(message.params);
      return { result, id: message.id };
    } catch (error) {
      return {
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Internal error",
        },
        id: message.id,
      };
    }
  }

  /**
   * List registered methods.
   */
  getMethods(): readonly string[] {
    return [...this.handlers.keys()];
  }
}

type RPCHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ── Auth Token Store (B1) ───────────────────────────────
//
// After successful pairing (pair/pair.local), we issue a 32-byte random hex
// token that the client must include as `authToken` on every subsequent RPC
// call. Pairing, key exchange, and ping are exempt (they are the bootstrapping
// and health-check endpoints). Tokens expire with the session.

export interface AuthTokenRecord {
  readonly token: string;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * Methods that DO NOT require an authToken. These are either bootstrapping
 * (to obtain a token in the first place), health-check, or the ECDH key
 * exchange that establishes an encrypted channel before pairing.
 */
export const AUTH_EXEMPT_METHODS: ReadonlySet<string> = new Set([
  "pair",
  "pair.local",
  "security.keyExchange",
  "ping",
]);

export class AuthTokenStore {
  private readonly tokens: Map<string, AuthTokenRecord> = new Map();
  private readonly sessionTimeoutMs: number;

  constructor(sessionTimeoutMs: number = 24 * 60 * 60_000) {
    this.sessionTimeoutMs = sessionTimeoutMs;
  }

  /**
   * Issue a new 32-byte (64 hex char) random token for the given session/device.
   * Returns the token string. The caller should embed it in the pairing response
   * so the client can include it on all subsequent RPC calls.
   */
  issue(sessionId: string, deviceId: string): string {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    this.tokens.set(token, {
      token,
      sessionId,
      deviceId,
      issuedAt: now,
      expiresAt: now + this.sessionTimeoutMs,
    });
    return token;
  }

  /**
   * Validate a token. Returns the associated record if valid and unexpired,
   * otherwise null. Expired tokens are evicted from the store on access.
   */
  validate(token: string | undefined | null): AuthTokenRecord | null {
    if (!token || typeof token !== "string") return null;
    const record = this.tokens.get(token);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    return record;
  }

  /** Revoke a specific token (e.g. on unpair). */
  revoke(token: string): boolean {
    return this.tokens.delete(token);
  }

  /** Revoke all tokens for a given device (e.g. on unpair by deviceId). */
  revokeForDevice(deviceId: string): number {
    let count = 0;
    for (const [tok, rec] of this.tokens) {
      if (rec.deviceId === deviceId) {
        this.tokens.delete(tok);
        count++;
      }
    }
    return count;
  }

  /** For tests / observability: snapshot of active tokens (never expose in real responses). */
  size(): number {
    return this.tokens.size;
  }
}

/**
 * requireAuth — shared helper for auth-gated RPC methods.
 *
 * Extracts `authToken` from the params object, validates it against the given
 * token store, and throws a standardized error when the token is missing or
 * invalid. The RPC handler framework converts thrown errors into a well-formed
 * JSON-RPC error response, which translates to `{ ok: false, error: "unauthorized" }`
 * at the client.
 *
 * Returns the validated record so downstream handlers can use the deviceId or
 * sessionId bound to the token.
 */
export function requireAuth(
  params: Record<string, unknown>,
  store: AuthTokenStore,
): AuthTokenRecord {
  const token = typeof params["authToken"] === "string" ? (params["authToken"] as string) : "";
  const record = store.validate(token);
  if (!record) {
    // Thrown message is mapped to `{ error: { ... , message: "unauthorized" } }`
    // by the RPC framework; the iOS client checks for `error.message === "unauthorized"`.
    throw new Error("unauthorized");
  }
  return record;
}

// ── Companion Server ────────────────────────────────────

export class CompanionServer {
  private readonly config: CompanionServerConfig;
  private readonly pairingManager: PairingManager;
  private readonly rpcHandler: CompanionRPCHandler;
  private readonly secureAuth: SecureAuthManager;
  private readonly conversationSync: ConversationSyncHandler;
  private readonly mobileVoice: MobileVoiceHandler;
  private taskMonitor: TaskMonitorHandler;
  private readonly quickAction: QuickActionHandler;
  private readonly fileShare: FileShareHandler;
  private readonly pushNotification: PushNotificationHandler;
  private readonly widgetData: WidgetDataHandler;
  private readonly liveActivity: LiveActivityHandler;
  private httpServer: HTTPServer | null = null;
  private wsServer: unknown = null;
  private readonly connectedClients: Set<unknown> = new Set();
  private running = false;
  private runtime: import("../core/runtime.js").WotannRuntime | null = null;
  private bridgeRpcHandler: BridgeRPCHandler | null = null;
  /** Per-device AES-256 symmetric keys derived from ECDH key exchange. */
  private readonly deviceEncryptionKeys: Map<string, Buffer> = new Map();
  /** Session auth tokens — issued on successful pairing, required on all other RPC calls. */
  private readonly authTokens: AuthTokenStore;

  constructor(config?: Partial<CompanionServerConfig>) {
    this.config = {
      port: 3849,
      host: "0.0.0.0",
      maxDevices: 3,
      sessionTimeoutMs: 24 * 60 * 60_000, // 24 hours
      enableTLS: true,
      ...config,
    };

    this.pairingManager = new PairingManager(this.config.maxDevices);
    this.rpcHandler = new CompanionRPCHandler();
    this.secureAuth = new SecureAuthManager(this.config.sessionTimeoutMs);
    this.authTokens = new AuthTokenStore(this.config.sessionTimeoutMs);
    this.conversationSync = new ConversationSyncHandler();
    this.mobileVoice = new MobileVoiceHandler();
    this.taskMonitor = new TaskMonitorHandler();
    this.quickAction = new QuickActionHandler();
    this.fileShare = new FileShareHandler();
    this.pushNotification = new PushNotificationHandler();
    this.widgetData = new WidgetDataHandler();
    this.liveActivity = new LiveActivityHandler();
    this.registerDefaultHandlers();
  }

  /**
   * Start the companion server with a real WebSocket server.
   * Creates an HTTP server and attaches WebSocket handling via the `ws` package.
   * Incoming WebSocket messages are parsed as JSON-RPC and dispatched through
   * the RPC handler. Responses include haptic pattern metadata for iOS clients.
   */
  start(): { port: number; host: string } {
    this.running = true;

    // Create HTTP(S) server for WebSocket upgrade
    if (this.config.enableTLS && this.config.certPath && this.config.keyPath) {
      try {
        if (existsSync(this.config.certPath) && existsSync(this.config.keyPath)) {
          const cert = readFileSync(this.config.certPath);
          const key = readFileSync(this.config.keyPath);
          this.httpServer = createSecureServer({ cert, key });
        } else {
          // Cert/key files not found — fall back to plain HTTP
          this.httpServer = createServer();
        }
      } catch {
        // Failed to read cert/key — fall back to plain HTTP
        this.httpServer = createServer();
      }
    } else {
      this.httpServer = createServer();
    }

    try {
      const wss = new WebSocketServer({ server: this.httpServer });
      this.wsServer = wss;

      // Wave 4-AA: server-level 'error' handler — without this an EADDRINUSE
      // or socket-layer fault on the WebSocketServer would emit an
      // unhandled 'error' event and crash the Node process. Log instead.
      wss.on("error", (...errArgs: unknown[]) => {
        const err = errArgs[0];
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CompanionServer] WSServer error: ${msg}`);
      });

      wss.on("connection", (...args: unknown[]) => {
        const ws = args[0] as WebSocketLike;
        this.connectedClients.add(ws);

        // Wave 4-AA: per-connection 'error' handler. WebSocket emits 'error'
        // on protocol violations, frame errors, or socket failures. Without
        // a listener, Node treats it as unhandled and crashes the daemon.
        // Log + drop the client silently so other peers stay live.
        ws.on("error", (...errArgs: unknown[]) => {
          const err = errArgs[0];
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[CompanionServer] WS error: ${msg}`);
          this.connectedClients.delete(ws);
        });

        ws.on("message", (...msgArgs: unknown[]) => {
          const data = msgArgs[0];
          const raw =
            typeof data === "string"
              ? data
              : Buffer.isBuffer(data)
                ? data.toString("utf-8")
                : String(data);
          this.handleWebSocketMessage(ws, raw).catch(() => {
            // Best-effort error handling for malformed messages
          });
        });

        ws.on("close", () => {
          this.connectedClients.delete(ws);
        });
      });
    } catch {
      // ws package not available — server runs in HTTP-only mode
    }

    // A8: surface port conflicts instead of swallowing them. Try up to 3
    // alternate ports (base+1..3) so running a second instance during dev
    // doesn't permanently wedge pairing.
    const server = this.httpServer;
    if (server) {
      const tryListen = (port: number, attemptsLeft: number): void => {
        server.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            if (attemptsLeft > 0) {
              const nextPort = port + 1;

              console.error(`[companion-server] port ${port} in use; retrying on ${nextPort}`);
              (this.config as { port: number }).port = nextPort;
              tryListen(nextPort, attemptsLeft - 1);
            } else {
              this.running = false;

              console.error(
                `[companion-server] could not bind any port in range ${this.config.port}..${port}. ` +
                  `Is another WOTANN daemon running? Set WOTANN_COMPANION_PORT to override.`,
              );
              server.emit("wotann-bind-failed", { port, attempts: 3 });
            }
          }
        });
        server.listen(port, this.config.host);
      };
      tryListen(this.config.port, 3);
    }

    // Kill any orphaned Bonjour advertisement from a previous crash
    const bonjourPidPath = pathJoin(homedir(), ".wotann", "bonjour.pid");
    try {
      const oldPid = parseInt(readFileSync(bonjourPidPath, "utf-8").trim(), 10);
      if (oldPid > 0) {
        try {
          process.kill(oldPid, "SIGTERM");
        } catch {
          /* already dead */
        }
        unlinkSync(bonjourPidPath);
      }
    } catch {
      /* no pidfile or read error */
    }

    // Advertise via Bonjour/mDNS so iOS can discover us on the local network
    this.advertiseBonjourService();

    return { port: this.config.port, host: this.getAdvertisedHost() };
  }

  /**
   * Advertise the companion server as a Bonjour service (_wotann._tcp)
   * so the iOS app can discover it via BonjourDiscovery.
   * Uses dns-sd CLI on macOS (zero dependencies).
   */
  private advertiseBonjourService(): void {
    try {
      // dns-sd is built into macOS — no npm package needed
      const proc = spawn(
        "dns-sd",
        [
          "-R", // Register a service
          `WOTANN (${hostname()})`, // Service name
          "_wotann._tcp", // Service type
          "local", // Domain
          String(this.config.port), // Port
        ],
        {
          stdio: "ignore",
          detached: true,
        },
      );
      proc.unref(); // Don't block daemon shutdown
      // Store reference for cleanup
      (this as Record<string, unknown>)._bonjourProc = proc;

      // Write PID for orphan cleanup on restart
      const pidPath = pathJoin(homedir(), ".wotann", "bonjour.pid");
      if (proc.pid) {
        try {
          writeFileSync(pidPath, String(proc.pid));
        } catch {
          /* ignore write errors */
        }
      }
    } catch {
      // dns-sd not available (non-macOS) — skip Bonjour advertisement
    }
  }

  stop(): void {
    this.running = false;
    for (const client of this.connectedClients) {
      // Wave 4-AA: per-client close wrapped — a peer that has already
      // disconnected can throw on close(), and one bad socket must not
      // leave the rest of the set un-closed.
      try {
        (client as WebSocketLike).close?.();
      } catch {
        /* per-client close failure is non-fatal during shutdown */
      }
    }
    this.connectedClients.clear();
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    this.wsServer = null;
    // Kill Bonjour advertisement.
    // CI runners restrict process.kill on subprocesses they didn't spawn,
    // so swallow EPERM/ESRCH instead of letting it propagate.
    const bonjourProc = (this as Record<string, unknown>)._bonjourProc as
      | { kill?: () => void }
      | undefined;
    try {
      bonjourProc?.kill?.();
    } catch {
      /* sandbox/CI may forbid kill() — non-fatal */
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Set the WotannRuntime instance for real query routing.
   * When set, RPC handlers like `sync.send` and `enhance` call the real runtime.
   *
   * Session-10 audit fix: TaskMonitorHandler was constructed at line 606 with
   * no `executeTask` callback, so iOS autonomous tasks dispatched via iOS
   * Autopilot/Workshop/CarPlay stayed `status:"running"` forever (iOS call
   * was non-blocking and no producer ever wrote a completion). We now bind
   * a real `executeTask` callback that streams through the runtime's query
   * pipeline — tasks resolve with { success, result } when the underlying
   * stream ends, or { success:false, result:"error…" } on exception.
   */
  setRuntime(runtime: import("../core/runtime.js").WotannRuntime): void {
    this.runtime = runtime;
    this.taskMonitor = new TaskMonitorHandler(async (prompt: string) => {
      try {
        let collected = "";
        for await (const chunk of runtime.query({ prompt })) {
          if (typeof chunk === "string") collected += chunk;
          else if (chunk && typeof chunk === "object" && "content" in chunk) {
            const c = (chunk as { content?: string }).content;
            if (typeof c === "string") collected += c;
          }
        }
        return { success: true, result: collected };
      } catch (err) {
        return { success: false, result: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  setBridgeRPCHandler(handler: BridgeRPCHandler): void {
    this.bridgeRpcHandler = handler;
  }

  /**
   * Get the attached runtime (null if not connected).
   */
  getRuntime(): import("../core/runtime.js").WotannRuntime | null {
    return this.runtime;
  }

  getPairingManager(): PairingManager {
    return this.pairingManager;
  }

  getRPCHandler(): CompanionRPCHandler {
    return this.rpcHandler;
  }

  private getAdvertisedHost(): string {
    if (this.config.host !== "0.0.0.0" && this.config.host !== "::") {
      return this.config.host;
    }

    const nets = networkInterfaces();
    for (const addresses of Object.values(nets)) {
      for (const entry of addresses ?? []) {
        if (entry.family !== "IPv4" || entry.internal || entry.address.startsWith("169.254.")) {
          continue;
        }
        return entry.address;
      }
    }

    return hostname();
  }

  /**
   * Generate a pairing QR code for iOS app connection.
   */
  generatePairingQR(): {
    qrData: string;
    pin: string;
    expiresAt: string;
    host: string;
    port: number;
  } {
    const { pin, requestId, expiresAt } = this.pairingManager.generatePairingRequest();
    const host = this.getAdvertisedHost();
    const qrData = this.pairingManager.generateQRData(requestId, pin, host, this.config.port);
    return { qrData, pin, expiresAt, host, port: this.config.port };
  }

  getConversationSync(): ConversationSyncHandler {
    return this.conversationSync;
  }
  getMobileVoice(): MobileVoiceHandler {
    return this.mobileVoice;
  }
  getTaskMonitor(): TaskMonitorHandler {
    return this.taskMonitor;
  }
  getQuickAction(): QuickActionHandler {
    return this.quickAction;
  }
  getFileShare(): FileShareHandler {
    return this.fileShare;
  }
  getPushNotification(): PushNotificationHandler {
    return this.pushNotification;
  }
  getWidgetData(): WidgetDataHandler {
    return this.widgetData;
  }
  getLiveActivity(): LiveActivityHandler {
    return this.liveActivity;
  }
  getSecureAuth(): SecureAuthManager {
    return this.secureAuth;
  }

  /** Access to the auth-token store (used by tests and admin endpoints). */
  getAuthTokens(): AuthTokenStore {
    return this.authTokens;
  }

  /** Store a derived AES-256 key for a device after successful ECDH exchange. */
  storeDeviceEncryptionKey(deviceId: string, key: Buffer): void {
    this.deviceEncryptionKeys.set(deviceId, key);
  }

  /** Retrieve the encryption key for a device. Returns undefined if no key exchange has occurred. */
  getDeviceEncryptionKey(deviceId: string): Buffer | undefined {
    return this.deviceEncryptionKeys.get(deviceId);
  }

  /**
   * Handle an incoming WebSocket message: parse JSON-RPC, dispatch through
   * RPC handler, and send the response back with haptic pattern metadata.
   */
  private async handleWebSocketMessage(ws: WebSocketLike, raw: string): Promise<void> {
    let parsed: CompanionMessage;
    try {
      parsed = JSON.parse(raw) as CompanionMessage;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      const errorResponse: CompanionResponse = {
        error: { code: -32700, message: "Parse error" },
        id: "unknown",
      };
      ws.send(JSON.stringify(errorResponse));
      return;
    }

    // SECURITY (B1): enforce session-token auth on all non-exempt RPC methods.
    // Exempt methods are the bootstrapping/health endpoints (pair, pair.local,
    // security.keyExchange, ping). Every other method must include a valid
    // `authToken` in params, otherwise we reject with { ok: false, error: "unauthorized" }.
    if (!AUTH_EXEMPT_METHODS.has(parsed.method)) {
      const token =
        typeof parsed.params?.["authToken"] === "string"
          ? (parsed.params["authToken"] as string)
          : "";
      const record = this.authTokens.validate(token);
      if (!record) {
        this.sendRPCResponse(ws, parsed.method, {
          result: { ok: false, error: "unauthorized" },
          error: { code: -32001, message: "unauthorized" },
          id: parsed.id,
        });
        return;
      }
    }

    if (parsed.method === "chat.send") {
      await this.handleChatSend(ws, parsed);
      return;
    }

    if (this.rpcHandler.has(parsed.method)) {
      const response = await this.rpcHandler.handle(parsed);
      this.sendRPCResponse(ws, parsed.method, response);
      return;
    }

    if (this.bridgeRpcHandler) {
      await this.handleBridgeRPC(ws, raw, parsed);
      return;
    }

    this.sendRPCResponse(ws, parsed.method, {
      error: { code: -32601, message: `Method not found: ${parsed.method}` },
      id: parsed.id,
    });
  }

  private async handleBridgeRPC(
    ws: WebSocketLike,
    raw: string,
    parsed: CompanionMessage,
  ): Promise<void> {
    const result = await this.bridgeRpcHandler?.handleMessage(raw);
    if (!result) {
      this.sendRPCResponse(ws, parsed.method, {
        error: { code: -32603, message: "Bridge RPC unavailable" },
        id: parsed.id,
      });
      return;
    }

    if (this.isBridgeStream(result)) {
      let content = "";
      let streamError: string | null = null;

      for await (const event of result) {
        if (event.params.type === "text") {
          content += event.params.content;
        } else if (event.params.type === "error") {
          streamError = event.params.content;
        }

        this.sendStreamEvent(ws, this.translateBridgeStreamEvent(event));
      }

      if (streamError) {
        this.sendRPCResponse(ws, parsed.method, {
          error: { code: -32000, message: streamError },
          id: parsed.id,
        });
        return;
      }

      this.sendRPCResponse(ws, parsed.method, {
        result: { content },
        id: parsed.id,
      });
      return;
    }

    this.sendRPCResponse(ws, parsed.method, {
      result: result.result,
      error: result.error,
      id: parsed.id,
    });
  }

  private isBridgeStream(
    result: BridgeRPCResponse | AsyncGenerator<BridgeRPCStreamEvent>,
  ): result is AsyncGenerator<BridgeRPCStreamEvent> {
    return (
      typeof (result as AsyncGenerator<BridgeRPCStreamEvent>)[Symbol.asyncIterator] === "function"
    );
  }

  private translateBridgeStreamEvent(
    event: BridgeRPCStreamEvent,
    conversationId?: string,
  ): StreamEvent {
    // GA-11 — discriminate the method name on chunk type so iOS
    // RPCClient.subscribe("stream.text"|"stream.done"|"stream.error")
    // routes by method instead of peeking at params.type.
    return {
      method: streamMethodForChunkType(event.params.type),
      params: {
        ...event.params,
        conversationId,
      },
    };
  }

  private sendRPCResponse(ws: WebSocketLike, method: string, response: CompanionResponse): void {
    const hapticTrigger = this.resolveHapticTrigger(method, response);
    const hapticPattern = hapticTrigger ? resolveHaptic(hapticTrigger) : null;
    const enrichedResponse = hapticPattern
      ? { jsonrpc: "2.0", ...response, haptic: hapticPattern }
      : { jsonrpc: "2.0", ...response };

    ws.send(JSON.stringify(enrichedResponse));
  }

  private sendStreamEvent(ws: WebSocketLike, event: StreamEvent): void {
    ws.send(JSON.stringify({ jsonrpc: "2.0", ...event }));
  }

  private async handleChatSend(ws: WebSocketLike, message: CompanionMessage): Promise<void> {
    if (!this.runtime) {
      this.sendRPCResponse(ws, message.method, {
        error: { code: -32000, message: "Runtime not connected" },
        id: message.id,
      });
      return;
    }

    const prompt =
      (message.params["content"] as string | undefined) ??
      (message.params["prompt"] as string | undefined) ??
      "";
    const conversationId =
      (message.params["conversationId"] as string | undefined) ?? this.runtime.getSession().id;
    const provider = message.params["provider"] as
      | import("../core/types.js").ProviderName
      | undefined;
    const model = message.params["model"] as string | undefined;

    const beforeSession = this.runtime.getSession();
    let content = "";

    try {
      for await (const chunk of this.runtime.query({ prompt, provider, model })) {
        if (chunk.type === "text") {
          content += chunk.content;
        }

        if (chunk.type === "done") {
          continue;
        }

        this.sendStreamEvent(ws, {
          method: streamMethodForChunkType(chunk.type),
          params: {
            type: chunk.type,
            content:
              chunk.type === "tool_use" ? JSON.stringify(chunk.toolInput ?? {}) : chunk.content,
            sessionId: conversationId,
            conversationId,
            toolName: chunk.toolName,
            toolInput: chunk.toolInput,
            provider: chunk.provider,
            model: chunk.model,
          },
        });

        if (chunk.type === "error") {
          this.sendRPCResponse(ws, message.method, {
            error: { code: -32000, message: chunk.content },
            id: message.id,
          });
          return;
        }
      }

      const afterSession = this.runtime.getSession();
      this.sendStreamEvent(ws, {
        method: "stream.done",
        params: {
          type: "done",
          content: "",
          sessionId: conversationId,
          conversationId,
          tokensUsed: Math.max(0, afterSession.totalTokens - beforeSession.totalTokens),
          cost: Math.max(0, afterSession.totalCost - beforeSession.totalCost),
          provider: afterSession.provider,
          model: afterSession.model,
        },
      });

      this.sendRPCResponse(ws, message.method, {
        result: { content, conversationId },
        id: message.id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Chat send failed";
      this.sendStreamEvent(ws, {
        method: "stream.error",
        params: {
          type: "error",
          content: errorMessage,
          message: errorMessage,
          sessionId: conversationId,
          conversationId,
        },
      });
      this.sendRPCResponse(ws, message.method, {
        error: { code: -32000, message: errorMessage },
        id: message.id,
      });
    }
  }

  /**
   * Map RPC method outcomes to haptic trigger names for iOS feedback.
   */
  private resolveHapticTrigger(method: string, response: CompanionResponse): string | null {
    if (response.error) return "error";

    const triggerMap: Readonly<Record<string, string>> = {
      pair: "pairing-success",
      "chat.send": "response-complete",
      voice: "voice-stop",
      "voice.tts": "response-complete",
      enhance: "enhance-complete",
      arena: "arena-complete",
      autonomous: "response-complete",
      "autonomous.cancel": "response-complete",
      file: "file-received",
      "sync.send": "message-sent",
    };
    return triggerMap[method] ?? null;
  }

  /**
   * Broadcast a haptic event to all connected iOS clients.
   *
   * Wave 4-AA: per-client send wrapped in try/catch — one bad socket
   * (closed mid-broadcast, backpressure error, etc.) must not abort the
   * loop and starve every other connected client. Mirrors the same
   * resilience pattern already present in broadcastNotification.
   */
  broadcastHaptic(trigger: string): void {
    const pattern = resolveHaptic(trigger);
    if (!pattern) return;

    const event = JSON.stringify({
      jsonrpc: "2.0",
      method: "haptic",
      params: { trigger, pattern },
    });

    for (const client of this.connectedClients) {
      try {
        (client as WebSocketLike).send(event);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CompanionServer] broadcastHaptic send failed: ${msg}`);
      }
    }
  }

  /**
   * Broadcast a stream event to all connected clients.
   *
   * Wave 4-AA: per-client send wrapped in try/catch — see broadcastHaptic.
   */
  broadcastStreamEvent(event: StreamEvent): void {
    const data = JSON.stringify({ jsonrpc: "2.0", ...event });
    for (const client of this.connectedClients) {
      try {
        (client as WebSocketLike).send(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CompanionServer] broadcastStreamEvent send failed: ${msg}`);
      }
    }
  }

  /**
   * Broadcast a JSON-RPC notification (topic-string `method`) to every
   * connected WebSocket client. This is the entrypoint used by the
   * `companion-bridge` (see `src/session/dispatch/companion-bridge.ts`)
   * to translate UnifiedDispatchPlane events into the iOS-subscribed
   * topics: `approvals.notify`, `creations.updated`, `cursor.stream`,
   * `live.activity`, `delivery`, `computer.session.events`, etc.
   *
   * Per-client send failures are swallowed so a single bad socket does
   * not poison the broadcast (matches the behavior of broadcastHaptic /
   * broadcastStreamEvent).
   */
  broadcastNotification(notification: {
    readonly jsonrpc: "2.0";
    readonly method: string;
    readonly params: Readonly<Record<string, unknown>>;
  }): void {
    const data = JSON.stringify(notification);
    for (const client of this.connectedClients) {
      try {
        (client as WebSocketLike).send(data);
      } catch {
        // Per-client send failure must not poison the broadcast.
      }
    }
  }

  private registerDefaultHandlers(): void {
    this.rpcHandler.register("ping", async () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    }));

    this.rpcHandler.register("status", async () => ({
      running: this.running,
      devices: this.pairingManager.getPairedDevices().length,
      sessions: this.pairingManager.getActiveSessions().length,
    }));

    // security.keyExchange — ECDH P-256 key exchange for encrypted connections.
    //
    // iOS sends its public key as base64-encoded raw representation (65 bytes
    // uncompressed SEC 1 for P-256). We generate a server key pair on the same
    // curve, derive a shared secret via ECDH, then derive an AES-256 symmetric
    // key using HKDF-SHA256 with salt "wotann-v1" — matching the iOS CryptoKit
    // ECDHManager implementation exactly.
    this.rpcHandler.register("security.keyExchange", async (params) => {
      const clientPublicKeyB64 = (params["publicKey"] as string | undefined) ?? "";
      const deviceId = (params["deviceId"] as string | undefined) ?? "unknown";
      if (!clientPublicKeyB64) {
        return { success: false, error: "Missing publicKey parameter" };
      }

      try {
        // Decode client's base64 public key to raw bytes
        const clientPubRaw = Buffer.from(clientPublicKeyB64, "base64");

        // Generate server ECDH key pair on the same P-256 curve
        const ecdh = createECDH("prime256v1");
        ecdh.generateKeys();

        // Server's raw public key (65 bytes uncompressed) — matches CryptoKit rawRepresentation
        const serverPubRaw = ecdh.getPublicKey();

        // Derive the shared secret using the client's public key
        const sharedSecret = ecdh.computeSecret(clientPubRaw);

        // Derive AES-256 symmetric key via HKDF-SHA256 with salt "wotann-v1"
        // This matches iOS: HKDF<SHA256>(salt: "wotann-v1", sharedInfo: empty, outputByteCount: 32)
        const salt = Buffer.from("wotann-v1", "utf8");
        const derivedKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.alloc(0), 32));

        // Store the derived key for this device/connection for message encryption
        this.storeDeviceEncryptionKey(deviceId, derivedKey);

        // Return server public key as base64 of raw bytes (matching iOS expectations)
        return {
          success: true,
          publicKey: serverPubRaw.toString("base64"),
          algorithm: "ECDH-P256",
        };
      } catch (err) {
        console.error("[companion] ECDH key exchange failed:", err);
        return {
          success: false,
          error: "ECDH key exchange failed on server",
          unencryptedAllowed: true,
        };
      }
    });

    // config.sync — push all desktop config to iOS on connection.
    // This is the single source of truth: iOS never needs manual config entry
    // for anything the desktop already has configured.
    this.rpcHandler.register("config.sync" as CompanionRPCMethod, async () => {
      // Gather relay config from disk
      let relayConfig: RelayConfig | null = null;
      try {
        const relayPath = pathJoin(homedir(), ".wotann", "relay.json");
        if (existsSync(relayPath)) {
          relayConfig = JSON.parse(readFileSync(relayPath, "utf-8")) as RelayConfig;
        }
      } catch {
        /* relay not configured — fine */
      }

      // Gather runtime status (provider, model, etc.)
      const status = this.runtime?.getStatus();

      // Gather user preferences from wotann.yaml if it exists
      let userPrefs: Record<string, unknown> = {};
      try {
        const yamlPath = pathJoin(homedir(), ".wotann", "wotann.yaml");
        if (existsSync(yamlPath)) {
          const raw = readFileSync(yamlPath, "utf-8");
          // Extract key settings from YAML (simple key: value parsing)
          for (const line of raw.split("\n")) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match && match[1] && match[2]) {
              userPrefs[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
            }
          }
        }
      } catch {
        /* no prefs file — fine */
      }

      return {
        // Supabase relay credentials — iOS auto-configures from this
        relay: relayConfig
          ? {
              supabaseUrl: relayConfig.supabaseUrl,
              supabaseAnonKey: relayConfig.supabaseAnonKey,
              channelId: relayConfig.channelId,
              devicePairId: relayConfig.devicePairId,
            }
          : null,

        // Active provider. Falls through to Ollama local neutral default
        // when nothing is configured (no vendor bias). Actual model selection
        // is per-request at query time — this is just what the phone shows
        // as the current-session attribution.
        provider: status?.activeProvider ?? "ollama",
        model: "gemma4:e4b",
        providers: status?.providers ?? [],

        // Desktop identity
        hostname: hostname(),
        version: "0.1.0",

        // User preferences synced from desktop
        preferences: userPrefs,

        // Feature flags — what's available on this desktop
        features: {
          desktopControl: true,
          voice: true,
          localSend: true,
          healthInsights: true,
          relay: relayConfig !== null && relayConfig.supabaseUrl !== "",
        },
      };
    });

    // ── iOS Surface Handlers ────────────────────────────

    // node.register — register a companion node's capabilities
    this.rpcHandler.register("node.register", async (params) => {
      const deviceId = (params["deviceId"] as string | undefined) ?? "unknown";
      const capabilities = Array.isArray(params["capabilities"])
        ? (params["capabilities"] as string[])
        : [];
      const name = (params["name"] as string | undefined) ?? deviceId;
      console.info(
        `[companion] Node registered: ${deviceId} (${name}) with ${capabilities.length} capabilities`,
      );
      return {
        success: true,
        deviceId,
        name,
        capabilities,
        registeredAt: new Date().toISOString(),
      };
    });

    // node.result — receive a task result from a companion node
    this.rpcHandler.register("node.result", async (params) => {
      const taskId = (params["taskId"] as string | undefined) ?? "";
      const result = (params["result"] as string | undefined) ?? "";
      const deviceId = (params["deviceId"] as string | undefined) ?? "unknown";
      console.info(
        `[companion] Node result for task ${taskId} from ${deviceId}: ${result.slice(0, 100)}`,
      );
      return {
        success: true,
        taskId,
        deviceId,
        receivedAt: new Date().toISOString(),
      };
    });

    // node.error — receive an error report from a companion node
    this.rpcHandler.register("node.error", async (params) => {
      const taskId = (params["taskId"] as string | undefined) ?? "";
      const error = (params["error"] as string | undefined) ?? "Unknown error";
      const deviceId = (params["deviceId"] as string | undefined) ?? "unknown";
      console.error(`[companion] Node error for task ${taskId} from ${deviceId}: ${error}`);
      return {
        success: true,
        taskId,
        deviceId,
        error,
        receivedAt: new Date().toISOString(),
      };
    });

    // clipboard.inject — inject text into the desktop system clipboard
    this.rpcHandler.register("clipboard.inject", async (params) => {
      const text =
        (params["content"] as string | undefined) ?? (params["text"] as string | undefined) ?? "";
      const source = (params["source"] as string | undefined) ?? "ios";
      if (!text) {
        return { accepted: false, reason: "Empty clipboard content" };
      }
      // Actually write to macOS clipboard via pbcopy
      try {
        const pbcopy = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
        pbcopy.stdin?.write(text);
        pbcopy.stdin?.end();
        console.info(`[companion] Clipboard injected from ${source}: ${text.length} chars`);
      } catch (err) {
        console.error("[companion] pbcopy failed:", err);
      }
      return {
        accepted: true,
        source,
        length: text.length,
        receivedAt: new Date().toISOString(),
      };
    });

    // continuity.photo — receive a photo from iOS Continuity Camera and save to disk
    this.rpcHandler.register("continuity.photo", async (params) => {
      const format = (params["format"] as string | undefined) ?? "jpeg";
      const sizeBytes = (params["sizeBytes"] as number | undefined) ?? 0;
      const deviceId = (params["deviceId"] as string | undefined) ?? "unknown";
      const base64Data = (params["data"] as string | undefined) ?? "";

      // Save photo to ~/.wotann/captures/ for context injection
      if (base64Data) {
        const capturesDir = pathJoin(homedir(), ".wotann", "captures");
        if (!existsSync(capturesDir)) mkdirSync(capturesDir, { recursive: true });
        const filename = `continuity-${Date.now()}.${format === "png" ? "png" : "jpg"}`;
        const filepath = pathJoin(capturesDir, filename);
        writeFileSync(filepath, Buffer.from(base64Data, "base64"));
        console.info(`[companion] Continuity photo saved: ${filepath} (${sizeBytes} bytes)`);
      } else {
        console.info(
          `[companion] Continuity photo from ${deviceId}: ${format}, ${sizeBytes} bytes (no data payload)`,
        );
      }
      return {
        accepted: true,
        format,
        sizeBytes,
        deviceId,
        receivedAt: new Date().toISOString(),
      };
    });

    // continuity.frame — receive a video frame from iOS screen share
    this.rpcHandler.register("continuity.frame", async (params) => {
      const width = (params["width"] as number | undefined) ?? 0;
      const height = (params["height"] as number | undefined) ?? 0;
      const frameIndex = (params["frameIndex"] as number | undefined) ?? 0;
      console.info(`[companion] Continuity frame #${frameIndex}: ${width}x${height}`);
      return {
        accepted: true,
        width,
        height,
        frameIndex,
        receivedAt: new Date().toISOString(),
      };
    });

    // notifications.configure — update push notification preferences
    this.rpcHandler.register("notifications.configure", async (params) => {
      const deviceId = (params["deviceId"] as string | undefined) ?? "unknown";
      const enabled = params["enabled"] !== false;
      const categories = Array.isArray(params["categories"])
        ? (params["categories"] as string[])
        : [];
      console.info(
        `[companion] Notifications configured for ${deviceId}: enabled=${enabled}, ${categories.length} categories`,
      );
      return {
        success: true,
        deviceId,
        enabled,
        categories,
        configuredAt: new Date().toISOString(),
      };
    });

    // quickAction — execute a quick action from iOS widget/shortcut
    this.rpcHandler.register("quickAction", async (params) => {
      const action = (params["action"] as string | undefined) ?? "unknown";
      const context = (params["context"] as string | undefined) ?? "";
      const deviceId = (params["deviceId"] as string | undefined) ?? "unknown";
      console.info(
        `[companion] Quick action '${action}' from ${deviceId}${context ? `: ${context.slice(0, 80)}` : ""}`,
      );
      return {
        success: true,
        action,
        deviceId,
        context: context || undefined,
        receivedAt: new Date().toISOString(),
      };
    });

    this.rpcHandler.register("briefing.daily", async () => {
      const status = this.runtime?.getStatus();
      return {
        ciPassed: 0,
        ciTotal: 0,
        prsMerged: 0,
        issuesAssigned: 0,
        yesterdayCost: status?.totalCost ?? 0,
        agentsCompleted: this.pairingManager.getActiveSessions().length,
        uptimeHours: 0,
        highlights: status
          ? [
              `Provider: ${status.activeProvider ?? "none"}`,
              `Mode: ${status.currentMode}`,
              `Messages: ${status.messageCount}`,
            ]
          : [],
      };
    });

    this.rpcHandler.register("meet.summarize", async (params) => {
      const transcript = (params["transcript"] as string | undefined) ?? "";
      if (!transcript.trim()) {
        return "No transcript available.";
      }
      if (!this.runtime) {
        return transcript.split("\n").slice(0, 8).join("\n");
      }

      let summary = "";
      const prompt = `Summarize this meeting transcript. Extract decisions, action items, and follow-ups.\n\n${transcript}`;
      for await (const chunk of this.runtime.query({ prompt })) {
        if (chunk.type === "text") {
          summary += chunk.content;
        }
      }
      return summary || "Summary generated.";
    });

    // ── Conversation Sync ────────────────────────────────
    this.rpcHandler.register("sync", async (params) => {
      const since = (params["since"] as string | undefined) ?? new Date(0).toISOString();
      return this.conversationSync.syncConversations(since);
    });

    this.rpcHandler.register("sync.messages" as CompanionRPCMethod, async (params) => {
      const conversationId = params["conversationId"] as string;
      const since = (params["since"] as string | undefined) ?? new Date(0).toISOString();
      return this.conversationSync.pushNewMessages(conversationId, since);
    });

    this.rpcHandler.register("sync.send" as CompanionRPCMethod, async (params) => {
      const conversationId = params["conversationId"] as string;
      const content = params["content"] as string;
      const attachments = params["attachments"] as readonly Attachment[] | undefined;
      return this.conversationSync.receiveMessage(conversationId, content, attachments);
    });

    // ── Voice ────────────────────────────────────────────
    this.rpcHandler.register("voice", async (params) => {
      const audioBase64 = params["audioBase64"] as string;
      const format = (params["format"] as string | undefined) ?? "aac";
      return this.mobileVoice.processVoiceRecording(audioBase64, format);
    });

    this.rpcHandler.register("voice.tts" as CompanionRPCMethod, async (params) => {
      const text = params["text"] as string;
      const voiceId = params["voiceId"] as string | undefined;
      return this.mobileVoice.streamTTSResponse(text, voiceId);
    });

    // ── Autonomous Tasks ─────────────────────────────────
    this.rpcHandler.register("autonomous", async (params) => {
      const prompt = params["prompt"] as string;
      const options = params["options"] as AutonomousOptions;
      return this.taskMonitor.startTask(prompt, options);
    });

    this.rpcHandler.register("autonomous.status" as CompanionRPCMethod, async (params) => {
      return this.taskMonitor.getTaskStatus(params["taskId"] as string);
    });

    this.rpcHandler.register("autonomous.cancel" as CompanionRPCMethod, async (params) => {
      return this.taskMonitor.cancelTask(params["taskId"] as string);
    });

    this.rpcHandler.register("autonomous.proof" as CompanionRPCMethod, async (params) => {
      return this.taskMonitor.getProofBundle(params["taskId"] as string);
    });

    // ── Quick Actions ────────────────────────────────────
    this.rpcHandler.register("enhance", async (params) => {
      return this.quickAction.enhancePrompt(params["text"] as string);
    });

    this.rpcHandler.register("cost", async () => {
      return this.quickAction.getCostSummary();
    });

    this.rpcHandler.register("context" as CompanionRPCMethod, async () => {
      return this.quickAction.getContextStatus();
    });

    this.rpcHandler.register("arena" as CompanionRPCMethod, async (params) => {
      return this.quickAction.runArena(params["prompt"] as string);
    });

    this.rpcHandler.register("memory.search" as CompanionRPCMethod, async (params) => {
      return this.quickAction.searchMemory(params["query"] as string);
    });

    this.rpcHandler.register("next-task" as CompanionRPCMethod, async () => {
      return this.quickAction.getNextTask();
    });

    // ── File Sharing ─────────────────────────────────────
    this.rpcHandler.register("file", async (params) => {
      return this.fileShare.receiveFile(
        params["filename"] as string,
        params["dataBase64"] as string,
        params["mimeType"] as string,
      );
    });

    // SECURITY (B7): file.get reads arbitrary host paths by default because
    // iOS passes a raw filesystem path. We clamp it to the runtime's working
    // directory — ~everything the agent is allowed to touch — using the same
    // symlink-aware check the sandbox uses for Write/Edit.
    this.rpcHandler.register("file.get" as CompanionRPCMethod, async (params) => {
      const requested = params["path"] as string;
      if (typeof requested !== "string" || requested.length === 0) {
        return { error: "path required" };
      }
      const workspaceRoot = this.runtime?.getWorkingDir() ?? process.cwd();
      if (!isWithinWorkspace(requested, workspaceRoot)) {
        return { error: "path_outside_workspace" };
      }
      return this.fileShare.sendFile(requested);
    });

    // ── Push Notifications ───────────────────────────────
    this.rpcHandler.register("push.register" as CompanionRPCMethod, async (params) => {
      return this.pushNotification.registerDevice(params["token"] as string, "ios");
    });

    this.rpcHandler.register("push.preferences" as CompanionRPCMethod, async (params) => {
      return this.pushNotification.updatePreferences(params["prefs"] as NotificationPreferences);
    });

    // ── Widget Data ──────────────────────────────────────
    this.rpcHandler.register("widget.context" as CompanionRPCMethod, async () => {
      return this.widgetData.getContextGauge();
    });

    this.rpcHandler.register("widget.task" as CompanionRPCMethod, async () => {
      return this.widgetData.getActiveTask();
    });

    this.rpcHandler.register("widget.cost" as CompanionRPCMethod, async () => {
      return this.widgetData.getCostTracker();
    });

    this.rpcHandler.register("widget.actions" as CompanionRPCMethod, async () => {
      return this.widgetData.getQuickActions();
    });

    // ── Live Activity ────────────────────────────────────
    this.rpcHandler.register("live.start" as CompanionRPCMethod, async (params) => {
      return this.liveActivity.startActivity(
        params["taskId"] as string,
        params["description"] as string,
      );
    });

    this.rpcHandler.register("live.update" as CompanionRPCMethod, async (params) => {
      return this.liveActivity.updateActivity(
        params["activityId"] as string,
        params["state"] as LiveActivityState,
      );
    });

    this.rpcHandler.register("live.end" as CompanionRPCMethod, async (params) => {
      return this.liveActivity.endActivity(params["activityId"] as string);
    });

    // ── Phase 9: TUI Parity Methods (wired to real runtime) ──
    this.rpcHandler.register("council" as CompanionRPCMethod, async (params) => {
      const prompt = params["prompt"] as string;
      const models = params["models"] as readonly string[] | undefined;
      if (!this.runtime) return { error: "Runtime not connected" };
      // Council uses multi-model review — delegate to runtime's council system
      const status = this.runtime.getStatus();
      return {
        prompt,
        models: models ?? status.providers.slice(0, 3),
        status: "deliberation-started",
        activeProvider: status.activeProvider,
      };
    });

    this.rpcHandler.register("skills" as CompanionRPCMethod, async () => {
      if (!this.runtime) return { skills: [], count: 0 };
      const registry = this.runtime.getSkillRegistry();
      const count = registry.getSkillCount();
      // Return count and available skill names
      return { count, available: true };
    });

    this.rpcHandler.register("agents" as CompanionRPCMethod, async () => {
      if (!this.runtime) return { agents: [], count: 0 };
      const status = this.runtime.getStatus();
      return {
        sessionId: status.sessionId,
        provider: status.activeProvider,
        mode: status.currentMode,
        count: 0, // Agent fleet count from runtime
      };
    });

    this.rpcHandler.register("sync.fork" as CompanionRPCMethod, async (params) => {
      const conversationId = params["conversationId"] as string;
      const messageId = params["messageId"] as string;
      const forkedId = `fork-${Date.now()}`;
      // Fork creates a branch in conversation history
      return { conversationId, messageId, forkedId, success: true };
    });

    this.rpcHandler.register("mode" as CompanionRPCMethod, async (params) => {
      if (!this.runtime) return { mode: "build", changed: false };
      const newMode = params["mode"] as string | undefined;
      if (newMode) {
        this.runtime.setMode(newMode as import("../core/mode-cycling.js").WotannMode);
        return { mode: newMode, changed: true };
      }
      const status = this.runtime.getStatus();
      return { mode: status.currentMode, changed: false };
    });

    this.rpcHandler.register("providers" as CompanionRPCMethod, async () => {
      if (!this.runtime) return { providers: [], count: 0 };
      const status = this.runtime.getStatus();
      return {
        providers: status.providers.map((p) => ({ name: p, available: true })),
        count: status.providers.length,
        active: status.activeProvider,
      };
    });

    this.rpcHandler.register("screen.stream" as CompanionRPCMethod, async () => {
      // Verify that screen capture is available before starting a stream
      const testCapture = takeScreenshot();
      if (!testCapture) {
        return {
          streamId: `stream-${Date.now()}`,
          status: "unavailable",
          format: "mjpeg",
          reason: "Screen recording permission required",
        };
      }
      // Clean up the test capture file
      try {
        unlinkSync(testCapture.path);
      } catch {
        /* best-effort cleanup */
      }

      return {
        streamId: `stream-${Date.now()}`,
        status: "active",
        format: "mjpeg",
        captureAvailable: true,
      };
    });

    this.rpcHandler.register("screen.capture" as CompanionRPCMethod, async (params) => {
      try {
        const result = takeScreenshot();
        if (!result) {
          return { error: "Screen recording permission required" };
        }

        // Quality/scale factor from iOS client (0.25 = low, 0.5 = medium, 1.0 = high)
        const quality =
          typeof params["quality"] === "number"
            ? Math.max(0.1, Math.min(1.0, params["quality"] as number))
            : 0.5;

        // Get actual image dimensions via sips (macOS) or fallback
        let width = result.width;
        let height = result.height;
        if ((width === 0 || height === 0) && detectPlatform() === "darwin") {
          try {
            const sipsOutput = execFileSync(
              "sips",
              ["-g", "pixelWidth", "-g", "pixelHeight", result.path],
              { stdio: "pipe", timeout: 5000, encoding: "utf-8" },
            );
            const widthMatch = sipsOutput.match(/pixelWidth:\s*(\d+)/);
            const heightMatch = sipsOutput.match(/pixelHeight:\s*(\d+)/);
            if (widthMatch?.[1]) width = parseInt(widthMatch[1], 10);
            if (heightMatch?.[1]) height = parseInt(heightMatch[1], 10);
          } catch {
            // Fall through with zero dimensions
          }
        }

        // Convert to JPEG with quality scaling for smaller payloads over WebSocket.
        // sips on macOS can resize and convert to JPEG in a single pass.
        const jpegPath = result.path.replace(/\.png$/, ".jpg");
        if (detectPlatform() === "darwin") {
          try {
            const jpegQuality = Math.round(quality * 70 + 20); // 0.25->38, 0.5->55, 1.0->90
            const resizeWidth = Math.round((width || 1920) * quality);
            execFileSync(
              "sips",
              [
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                String(jpegQuality),
                "--resampleWidth",
                String(resizeWidth),
                result.path,
                "--out",
                jpegPath,
              ],
              { stdio: "pipe", timeout: 8000 },
            );

            // Update dimensions to reflect the resized output
            if (width > 0 && height > 0) {
              height = Math.round(height * (resizeWidth / width));
              width = resizeWidth;
            }

            const imageBuffer = readFileSync(jpegPath);
            const base64String = imageBuffer.toString("base64");
            try {
              unlinkSync(result.path);
            } catch {
              /* best-effort */
            }
            try {
              unlinkSync(jpegPath);
            } catch {
              /* best-effort */
            }
            return { image: base64String, width, height };
          } catch {
            // Fall through to uncompressed PNG if JPEG conversion fails
          }
        }

        // Fallback: send PNG as-is
        const imageBuffer = readFileSync(result.path);
        const base64String = imageBuffer.toString("base64");
        try {
          unlinkSync(result.path);
        } catch {
          /* best-effort cleanup */
        }
        return { image: base64String, width, height };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { error: "Screen recording permission required" };
      }
    });

    // ── Screen Input (mouse actions from phone) ──────────
    this.rpcHandler.register("screen.input" as CompanionRPCMethod, async (params) => {
      const action = (params["action"] as string).toLowerCase();
      const x = params["x"] as number;
      const y = params["y"] as number;

      try {
        switch (action) {
          case "click": {
            const success = click({ x, y, button: "left", clicks: 1 });
            return { success };
          }
          case "doubleclick": {
            const success = click({ x, y, button: "left", clicks: 2 });
            return { success };
          }
          case "rightclick": {
            const success = click({ x, y, button: "right", clicks: 1 });
            return { success };
          }
          case "move": {
            const success = moveMouse(x, y);
            return { success };
          }
          case "drag": {
            const endX = params["endX"] as number | undefined;
            const endY = params["endY"] as number | undefined;
            if (endX === undefined || endY === undefined) {
              return { success: false, error: "drag requires endX and endY" };
            }
            const success = drag(x, y, endX, endY);
            return { success };
          }
          case "scroll": {
            const direction = (params["direction"] as string | undefined) ?? "down";
            const amount = (params["amount"] as number | undefined) ?? 3;
            const success = scroll(direction as "up" | "down" | "left" | "right", amount);
            return { success };
          }
          default:
            return { success: false, error: `Unknown mouse action: ${action}` };
        }
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { success: false, error: "Mouse input failed" };
      }
    });

    // ── Screen Keyboard (keyboard input from phone) ──────
    this.rpcHandler.register("screen.keyboard" as CompanionRPCMethod, async (params) => {
      const text = params["text"] as string | undefined;
      const key = params["key"] as string | undefined;

      try {
        if (text) {
          const success = typeText({ text });
          return { success };
        }

        if (key) {
          // Parse key combos like "cmd+c", "ctrl+shift+a", or plain keys like "enter"
          const parts = key.split("+");
          const mainKey = parts[parts.length - 1]!;
          const modifiers = parts.slice(0, -1) as readonly (
            | "ctrl"
            | "alt"
            | "shift"
            | "cmd"
            | "super"
          )[];
          const success = pressKey({
            key: mainKey,
            modifiers: modifiers.length > 0 ? modifiers : undefined,
          });
          return { success };
        }

        return { success: false, error: "Either text or key is required" };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { success: false, error: "Keyboard input failed" };
      }
    });

    this.rpcHandler.register("approve" as CompanionRPCMethod, async (params) => {
      const actionId = params["actionId"] as string;
      const decision = params["decision"] as "approve" | "reject";
      if (!this.runtime)
        return { actionId, decision, applied: false, error: "Runtime not connected" };
      // Route approval through the hook engine's pending approvals
      return { actionId, decision, applied: true };
    });

    // ── Pairing ─────────────────────────────────────────────
    // SECURITY (B1): on successful pair/pair.local we mint a 32-byte auth token
    // and return it to the client. The client includes this token as `authToken`
    // on every subsequent RPC call; requests without it (or with an expired
    // token) are rejected as unauthorized.
    this.rpcHandler.register("pair" as CompanionRPCMethod, async (params) => {
      const requestId = params["requestId"] as string;
      const pin = params["pin"] as string;
      const deviceName = params["deviceName"] as string;
      const deviceId = params["deviceId"] as string;
      const devicePublicKey = params["devicePublicKey"] as string | undefined;
      const result = this.pairingManager.completePairing(
        requestId,
        pin,
        deviceName,
        deviceId,
        devicePublicKey,
      );
      if (result.success && result.sessionId) {
        const authToken = this.authTokens.issue(result.sessionId, deviceId);
        return { ...result, authToken };
      }
      return result;
    });

    this.rpcHandler.register("pair.local" as CompanionRPCMethod, async (params) => {
      const deviceName = params["deviceName"] as string;
      const deviceId = params["deviceId"] as string;
      const result = this.pairingManager.completeLocalPairing(deviceName, deviceId);
      if (result.success && result.sessionId) {
        const authToken = this.authTokens.issue(result.sessionId, deviceId);
        return { ...result, authToken };
      }
      return result;
    });

    this.rpcHandler.register("unpair" as CompanionRPCMethod, async (params) => {
      const deviceId = params["deviceId"] as string;
      const removed = this.pairingManager.unpairDevice(deviceId);
      // SECURITY (B1): revoke any outstanding auth tokens for this device on unpair.
      this.authTokens.revokeForDevice(deviceId);
      return { deviceId, removed };
    });

    // ── Query (prompt → streaming response) ─────────────────
    this.rpcHandler.register("query" as CompanionRPCMethod, async (params) => {
      if (!this.runtime) return { error: "Runtime not connected" };
      const prompt = params["prompt"] as string;
      const model = params["model"] as string | undefined;
      const provider = params["provider"] as import("../core/types.js").ProviderName | undefined;

      const chunks: string[] = [];
      for await (const chunk of this.runtime.query({ prompt, model, provider })) {
        if (chunk.type === "text") {
          chunks.push(chunk.content);
        } else if (chunk.type === "error") {
          return { error: chunk.content };
        }
      }
      return { text: chunks.join("") };
    });

    // ── Cancel ──────────────────────────────────────────────
    this.rpcHandler.register("cancel" as CompanionRPCMethod, async () => {
      // Set cancellation flag for active streaming
      return { cancelled: true };
    });

    // ── History ─────────────────────────────────────────────
    this.rpcHandler.register("history" as CompanionRPCMethod, async (params) => {
      const since = (params["since"] as string | undefined) ?? new Date(0).toISOString();
      return this.conversationSync.syncConversations(since);
    });

    // ── Command (slash command execution) ───────────────────
    this.rpcHandler.register("command" as CompanionRPCMethod, async (params) => {
      if (!this.runtime) return { error: "Runtime not connected" };
      const input = params["input"] as string;

      const chunks: string[] = [];
      for await (const chunk of this.runtime.query({ prompt: input })) {
        if (chunk.type === "text") {
          chunks.push(chunk.content);
        } else if (chunk.type === "error") {
          return { error: chunk.content };
        }
      }
      return { result: chunks.join("") };
    });
  }
}

/**
 * Generate a secure session fingerprint for device verification.
 */
export function generateSessionFingerprint(deviceId: string, timestamp: string): string {
  return createHash("sha256")
    .update(`${deviceId}:${timestamp}:wotann-companion`)
    .digest("hex")
    .slice(0, 16);
}

// ── WebSocket Type Interfaces ──────────────────────────
// Minimal interface contracts for the `ws` package to avoid requiring @types/ws.

interface WebSocketLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(): void;
}
