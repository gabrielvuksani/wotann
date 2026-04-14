/**
 * Supabase Realtime Relay -- enables iOS companion to reach KAIROS
 * when not on the same WiFi network.
 *
 * Architecture:
 * - Desktop KAIROS daemon subscribes to a Supabase Realtime channel
 * - iOS app publishes RPC requests to the same channel
 * - KAIROS processes the request and publishes the response back
 * - All messages are E2E encrypted using AES-256-GCM with the ECDH
 *   shared secret derived during QR pairing
 *
 * Protocol:
 * Uses Supabase Realtime's Phoenix Channels protocol directly over
 * WebSocket -- no @supabase/supabase-js SDK required. This keeps the
 * dependency footprint minimal (only `ws` which is already in package.json).
 *
 * Free tier: Supabase free tier includes unlimited realtime connections,
 * 500MB database (not used here), 2GB bandwidth. No database tables are
 * needed -- only realtime broadcast channels.
 *
 * Security model:
 * Supabase only sees encrypted blobs. The AES-256-GCM key is derived
 * from the ECDH shared secret established during local QR pairing --
 * it never touches Supabase's servers.
 */

import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────

export interface RelayConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly channelId: string;
  readonly encryptionKey: string; // ECDH shared secret from pairing (hex)
}

export interface RelayRequest {
  readonly type: "rpc_request";
  readonly id: string;
  readonly method: string;
  readonly params: unknown;
  readonly encrypted: string; // Base64-encoded EncryptedEnvelope JSON
}

export interface RelayResponse {
  readonly type: "rpc_response";
  readonly id: string;
  readonly result: unknown;
  readonly encrypted: string; // Base64-encoded EncryptedEnvelope JSON
}

export interface EncryptedEnvelope {
  readonly ciphertext: string; // Base64
  readonly iv: string; // Base64
  readonly tag: string; // Base64
}

export type RelayStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export type StatusCallback = (status: RelayStatus) => void;
export type MessageHandler = (message: unknown) => Promise<unknown>;

/** Minimal WebSocket interface -- satisfied by both `ws` and native WebSocket. */
interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

// ── Constants ────────────────────────────────────────────

const CONFIG_FILENAME = "relay.json";
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;
const WS_OPEN = 1;

/**
 * Supabase relay credentials must be configured via ~/.wotann/wotann.yaml
 * or the desktop app Settings > Remote Relay.
 * No hardcoded defaults — relay is disabled until configured.
 */
const DEFAULT_SUPABASE_URL = "";
const DEFAULT_SUPABASE_ANON_KEY = "";

// ── Encryption Helpers ──────────────────────────────────

/**
 * Derive a 256-bit AES key from the ECDH shared secret.
 * Uses SHA-256 so any length shared secret produces a valid AES-256 key.
 */
function deriveAesKey(sharedSecretHex: string): Buffer {
  return createHash("sha256").update(Buffer.from(sharedSecretHex, "hex")).digest();
}

/**
 * Encrypt a JSON-serializable value using AES-256-GCM.
 * Returns a base64-encoded JSON envelope containing ciphertext, IV, and auth tag.
 */
function encryptPayload(data: unknown, sharedSecretHex: string): string {
  const key = deriveAesKey(sharedSecretHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };

  return Buffer.from(JSON.stringify(envelope)).toString("base64");
}

/**
 * Decrypt a base64-encoded AES-256-GCM envelope back to the original value.
 * Throws if the auth tag is invalid (tampered or wrong key).
 */
function decryptPayload(encryptedBase64: string, sharedSecretHex: string): unknown {
  const key = deriveAesKey(sharedSecretHex);
  const envelope = JSON.parse(
    Buffer.from(encryptedBase64, "base64").toString("utf8"),
  ) as EncryptedEnvelope;

  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  return JSON.parse(plaintext) as unknown;
}

// ── SupabaseRelay ────────────────────────────────────────

export class SupabaseRelay {
  private config: RelayConfig | null = null;
  private status: RelayStatus = "disconnected";
  private messageHandler: MessageHandler | null = null;
  private statusCallback: StatusCallback | null = null;

  // WebSocket state
  private ws: WsLike | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private refCounter = 0;
  private joinRef: string | null = null;
  private intentionalDisconnect = false;

  private readonly configPath: string;

  constructor() {
    this.configPath = join(homedir(), ".wotann", CONFIG_FILENAME);
  }

  // ── Config Management ────────────────────────────────

  /**
   * Load relay configuration from ~/.wotann/relay.json.
   * Created during QR pairing (auto-configured, user never sees Supabase).
   * Returns null if file does not exist or is malformed.
   */
  loadConfig(): RelayConfig | null {
    if (!existsSync(this.configPath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Validate required fields
      if (
        typeof parsed.supabaseUrl !== "string" ||
        typeof parsed.supabaseAnonKey !== "string" ||
        typeof parsed.channelId !== "string" ||
        typeof parsed.encryptionKey !== "string"
      ) {
        return null;
      }

      const config: RelayConfig = {
        supabaseUrl: parsed.supabaseUrl,
        supabaseAnonKey: parsed.supabaseAnonKey,
        channelId: parsed.channelId,
        encryptionKey: parsed.encryptionKey,
      };

      this.config = config;
      return config;
    } catch {
      return null;
    }
  }

  /**
   * Auto-configure relay during QR pairing.
   * Creates ~/.wotann/relay.json with a new channel ID.
   * Returns the channel ID (to encode in the QR code for iOS).
   */
  static configureOnPair(pairingData: {
    readonly supabaseUrl?: string;
    readonly supabaseAnonKey?: string;
    readonly sharedSecret: string;
  }): string {
    const channelId = `wotann-relay-${randomBytes(8).toString("hex")}`;

    const config: RelayConfig = {
      supabaseUrl:
        pairingData.supabaseUrl ??
        process.env.SUPABASE_URL ??
        process.env.WOTANN_SUPABASE_URL ??
        DEFAULT_SUPABASE_URL,
      supabaseAnonKey:
        pairingData.supabaseAnonKey ??
        process.env.SUPABASE_ANON_KEY ??
        process.env.WOTANN_SUPABASE_ANON_KEY ??
        DEFAULT_SUPABASE_ANON_KEY,
      channelId,
      encryptionKey: pairingData.sharedSecret,
    };

    const wotannDir = join(homedir(), ".wotann");
    if (!existsSync(wotannDir)) {
      mkdirSync(wotannDir, { recursive: true });
    }
    writeFileSync(join(wotannDir, CONFIG_FILENAME), JSON.stringify(config, null, 2));

    return channelId;
  }

  // ── Connection Lifecycle ─────────────────────────────

  /**
   * Connect to the Supabase Realtime channel.
   * Called by KAIROS daemon on startup if relay.json exists.
   *
   * The handler receives decrypted RPC request payloads and must return
   * the result to send back. The relay encrypts and publishes the response.
   */
  async connect(handler: MessageHandler): Promise<void> {
    // 1. Load config if not already loaded
    if (!this.config) {
      const loaded = this.loadConfig();
      if (!loaded) {
        this.setStatus("disconnected");
        return;
      }
    }

    this.messageHandler = handler;
    this.intentionalDisconnect = false;
    this.setStatus("connecting");

    const connected = await this.openWebSocket();
    if (!connected) {
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the relay. Stops heartbeat and reconnection timers.
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.messageHandler = null;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Best-effort close
      }
      this.ws = null;
    }

    this.setStatus("disconnected");
  }

  /**
   * Register a callback invoked whenever the relay status changes.
   * Useful for daemon logging and UI status indicators.
   */
  onStatusChange(callback: StatusCallback): void {
    this.statusCallback = callback;
  }

  /**
   * Get the current connection status.
   */
  getStatus(): RelayStatus {
    return this.status;
  }

  /**
   * Get the loaded config (null if not loaded).
   */
  getConfig(): RelayConfig | null {
    return this.config;
  }

  /**
   * Check if the relay is connected and ready to relay messages.
   */
  isConnected(): boolean {
    return this.status === "connected";
  }

  // ── WebSocket Transport ──────────────────────────────

  /**
   * Build the Supabase Realtime WebSocket URL from the HTTPS project URL.
   * Supabase Realtime uses the Phoenix Channels protocol over WebSocket.
   */
  private buildWsUrl(): string {
    const httpsUrl = this.config!.supabaseUrl.replace(/\/$/, "");
    const wsUrl = httpsUrl.replace(/^https:\/\//, "wss://");
    return `${wsUrl}/realtime/v1/websocket?apikey=${this.config!.supabaseAnonKey}&vsn=1.0.0`;
  }

  /**
   * Phoenix channel topic derived from the channel ID.
   */
  private topic(): string {
    return `realtime:${this.config!.channelId}`;
  }

  /**
   * Monotonically increasing reference counter for Phoenix protocol messages.
   */
  private nextRef(): string {
    this.refCounter += 1;
    return String(this.refCounter);
  }

  /**
   * Send a JSON message over the WebSocket if it is open.
   */
  private wsSend(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Open the raw WebSocket connection to Supabase Realtime.
   * Returns true if the channel join succeeds within the timeout.
   */
  private openWebSocket(): Promise<boolean> {
    const wsUrl = this.buildWsUrl();

    return new Promise<boolean>((resolve) => {
      try {
        // Use the `ws` package (already a dependency in package.json)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const WsConstructor = require("ws") as new (url: string) => WsLike;
        const ws = new WsConstructor(wsUrl);
        this.ws = ws;

        let resolved = false;

        ws.on("open", () => {
          this.sendJoin();
          this.startHeartbeat();
        });

        ws.on("message", (...args: unknown[]) => {
          const data = args[0];
          const raw =
            typeof data === "string"
              ? data
              : Buffer.isBuffer(data)
                ? data.toString("utf-8")
                : String(data);

          this.handleRawMessage(raw);

          // Resolve once we get a successful join reply
          if (!resolved && this.status === "connected") {
            resolved = true;
            resolve(true);
          }
        });

        ws.on("close", () => {
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
          this.handleUnexpectedDisconnect();
        });

        ws.on("error", (err: unknown) => {
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
          // Error details are intentionally not logged to avoid leaking
          // Supabase credentials in console output
          void err;
        });

        // Timeout: give up after CONNECT_TIMEOUT_MS
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(false);
            this.handleUnexpectedDisconnect();
          }
        }, CONNECT_TIMEOUT_MS);
      } catch {
        resolve(false);
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Send the Phoenix channel join message with broadcast config.
   * `self: false` prevents the desktop from receiving its own broadcasts.
   */
  private sendJoin(): void {
    this.joinRef = this.nextRef();
    this.wsSend({
      topic: this.topic(),
      event: "phx_join",
      payload: { config: { broadcast: { self: false } } },
      ref: this.joinRef,
    });
  }

  // ── Heartbeat ────────────────────────────────────────

  /**
   * Start the 30-second Phoenix heartbeat loop to keep the connection alive.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.wsSend({
        topic: "phoenix",
        event: "heartbeat",
        payload: {},
        ref: "heartbeat",
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Reconnection ─────────────────────────────────────

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectTimer) return;

    this.setStatus("reconnecting");

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.messageHandler) {
        void this.connect(this.messageHandler).catch(() => {
          // connect() handles its own retry scheduling
        });
      }
    }, delay);
  }

  /**
   * Clean up after an unexpected disconnect and schedule a retry.
   */
  private handleUnexpectedDisconnect(): void {
    this.stopHeartbeat();
    this.ws = null;

    if (this.status === "connected") {
      // Only schedule reconnect if we were previously connected
      this.setStatus("reconnecting");
    }

    this.scheduleReconnect();
  }

  // ── Message Handling ─────────────────────────────────

  /**
   * Handle a raw incoming WebSocket message (Phoenix Channels protocol).
   */
  private handleRawMessage(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // Ignore non-JSON frames
    }

    const event = parsed.event as string | undefined;

    // Channel join acknowledgement
    if (event === "phx_reply" && parsed.ref === this.joinRef) {
      const resp = parsed.payload as { status?: string } | undefined;
      if (resp?.status === "ok") {
        this.setStatus("connected");
        this.reconnectAttempt = 0;
      }
      return;
    }

    // Incoming broadcast from iOS
    if (event === "broadcast") {
      const outer = parsed.payload as
        | {
            event?: string;
            payload?: unknown;
          }
        | undefined;

      if (outer?.event === "relay" && outer.payload) {
        void this.handleRelayMessage(outer.payload);
      }
      return;
    }

    // System error events -- trigger reconnect
    if (event === "phx_error" || event === "phx_close") {
      this.handleUnexpectedDisconnect();
    }
  }

  /**
   * Process an incoming relay message from iOS.
   * 1. Verify it is an rpc_request
   * 2. Decrypt the encrypted payload
   * 3. Pass to the message handler
   * 4. Encrypt the result
   * 5. Publish the rpc_response back
   */
  private async handleRelayMessage(payload: unknown): Promise<void> {
    if (!this.config || !this.messageHandler) return;

    const msg = payload as Record<string, unknown>;

    // Only process rpc_request messages from iOS
    if (msg.type !== "rpc_request") return;

    const requestId = msg.id as string | undefined;
    const encrypted = msg.encrypted as string | undefined;

    if (!requestId || !encrypted) return;

    try {
      // Decrypt the request payload
      const decrypted = decryptPayload(encrypted, this.config.encryptionKey);

      // Process through the handler (e.g., KairosRPCHandler)
      const result = await this.messageHandler(decrypted);

      // Encrypt the response
      const encryptedResult = encryptPayload(result, this.config.encryptionKey);

      // Build and publish the response
      const response: RelayResponse = {
        type: "rpc_response",
        id: requestId,
        result: null, // Actual result is in the encrypted field
        encrypted: encryptedResult,
      };

      this.publishBroadcast(response);
    } catch {
      // Decryption or handler failure -- send an encrypted error response
      try {
        const errorResult = encryptPayload(
          { error: { code: -32000, message: "Relay processing error" } },
          this.config.encryptionKey,
        );

        const errorResponse: RelayResponse = {
          type: "rpc_response",
          id: requestId ?? "unknown",
          result: null,
          encrypted: errorResult,
        };

        this.publishBroadcast(errorResponse);
      } catch {
        // If even the error response fails to encrypt, silently drop
      }
    }
  }

  /**
   * Publish a message to the Supabase Realtime channel as a Phoenix broadcast.
   */
  private publishBroadcast(message: RelayRequest | RelayResponse): void {
    this.wsSend({
      topic: this.topic(),
      event: "broadcast",
      payload: {
        type: "broadcast",
        event: "relay",
        payload: message,
      },
      ref: this.nextRef(),
    });
  }

  /**
   * Publish an encrypted RPC response directly (for use by companion server).
   * This is a convenience method when the companion server wants to forward
   * a response through the relay without going through the request/response cycle.
   */
  async publishResponse(requestId: string, result: unknown): Promise<void> {
    if (!this.config || this.status !== "connected") return;

    const encryptedResult = encryptPayload(result, this.config.encryptionKey);

    const response: RelayResponse = {
      type: "rpc_response",
      id: requestId,
      result: null,
      encrypted: encryptedResult,
    };

    this.publishBroadcast(response);
  }

  // ── Status Management ────────────────────────────────

  private setStatus(newStatus: RelayStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    if (this.statusCallback) {
      this.statusCallback(newStatus);
    }
  }
}

// ── Exported Encryption Helpers ─────────────────────────
// Exposed for use by the companion server when it needs to encrypt/decrypt
// relay messages independently (e.g., forwarding WebSocket responses).

export { encryptPayload, decryptPayload, deriveAesKey };
