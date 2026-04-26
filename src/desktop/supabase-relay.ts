/**
 * Supabase Realtime Relay — enables iOS connectivity when not on same WiFi.
 *
 * Architecture:
 * - Desktop KAIROS publishes RPC responses to a Supabase Realtime channel
 * - iOS subscribes to the same channel
 * - All traffic E2E encrypted with existing ECDH keys (Supabase sees only encrypted blobs)
 * - Auto-configured on first QR pairing — user never sees Supabase
 *
 * Free tier: 500MB database, 2GB bandwidth, unlimited real-time connections
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveWotannHome } from "../utils/wotann-home.js";
import WebSocket from "ws";

// ── Types ────────────────────────────────────────────────

export interface RelayConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly channelId: string;
  readonly devicePairId: string;
}

export interface RelayMessage {
  readonly type: "rpc-response" | "rpc-request" | "heartbeat";
  readonly payload: string; // E2E encrypted blob
  readonly timestamp: number;
  readonly sender: "desktop" | "ios";
}

/** Minimal WebSocket interface — satisfied by both `ws` and native WebSocket. */
interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

// ── Constants ────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const WS_OPEN = 1;

// ── Relay Manager ────────────────────────────────────────

export class SupabaseRelay {
  private config: RelayConfig | null = null;
  private connected = false;
  private readonly configPath: string;
  private onMessageCallback: ((msg: RelayMessage) => void) | null = null;

  private ws: WsLike | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private refCounter = 0;
  private joinRef: string | null = null;
  private intentionalDisconnect = false;

  constructor() {
    const wotannDir = resolveWotannHome();
    this.configPath = join(wotannDir, "relay.json");
  }

  /**
   * Load relay configuration from disk.
   * Returns false if no config exists (relay not set up).
   */
  loadConfig(): boolean {
    if (!existsSync(this.configPath)) {
      return false;
    }
    try {
      const content = readFileSync(this.configPath, "utf-8");
      this.config = JSON.parse(content) as RelayConfig;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Auto-configure relay during QR pairing.
   * Generates a unique channel ID and stores the config.
   */
  autoConfigureOnPair(devicePairId: string): RelayConfig {
    // Supabase relay credentials must be configured via ~/.wotann/wotann.yaml
    // or the desktop app Settings > Remote Relay.
    // No hardcoded defaults — relay is disabled until configured.
    const DEFAULT_SUPABASE_URL = "";
    const DEFAULT_SUPABASE_KEY = "";

    const config: RelayConfig = {
      // iOS team expects SUPABASE_URL / SUPABASE_ANON_KEY. Fall back to the
      // legacy WOTANN_SUPABASE_* names so existing installs keep working
      // while users migrate their env files.
      supabaseUrl:
        process.env.SUPABASE_URL ?? process.env.WOTANN_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
      supabaseAnonKey:
        process.env.SUPABASE_ANON_KEY ??
        process.env.WOTANN_SUPABASE_ANON_KEY ??
        DEFAULT_SUPABASE_KEY,
      channelId: `wotann-relay-${devicePairId.slice(0, 8)}`,
      devicePairId,
    };

    // Persist to disk
    const dir = resolveWotannHome();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    this.config = config;
    return config;
  }

  // ── Private helpers ──────────────────────────────────

  private nextRef(): string {
    this.refCounter += 1;
    return String(this.refCounter);
  }

  private topic(): string {
    return `realtime:${this.config!.channelId}`;
  }

  /** Build the Supabase Realtime WebSocket URL from an HTTPS project URL. */
  private buildWsUrl(): string {
    // this.config!.supabaseUrl looks like "https://xxx.supabase.co"
    const httpsUrl = this.config!.supabaseUrl.replace(/\/$/, "");
    const wsUrl = httpsUrl.replace(/^https:\/\//, "wss://");
    return `${wsUrl}/realtime/v1/websocket?apikey=${this.config!.supabaseAnonKey}&vsn=1.0.0`;
  }

  /** Send a JSON message over the WebSocket. */
  private wsSend(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Join the Phoenix channel after the WebSocket opens. */
  private sendJoin(): void {
    this.joinRef = this.nextRef();
    this.wsSend({
      topic: this.topic(),
      event: "phx_join",
      payload: { config: { broadcast: { self: false } } },
      ref: this.joinRef,
    });
  }

  /** Start the 30-second heartbeat loop. */
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

  /** Handle a raw incoming WebSocket message. */
  private handleMessage(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // Ignore non-JSON frames
    }

    const event = parsed.event as string | undefined;

    // Join acknowledgement
    if (event === "phx_reply" && parsed.ref === this.joinRef) {
      const resp = parsed.payload as { status?: string } | undefined;
      if (resp?.status === "ok") {
        this.connected = true;
        this.reconnectAttempt = 0;
        console.log(`Supabase relay connected: channel ${this.config!.channelId}`);
      } else {
        console.error("Supabase relay join rejected:", resp);
      }
      return;
    }

    // Incoming broadcast from iOS
    if (event === "broadcast") {
      const outer = parsed.payload as { event?: string; payload?: unknown } | undefined;
      if (outer?.event === "relay" && outer.payload && this.onMessageCallback) {
        const relayMsg = outer.payload as RelayMessage;
        this.onMessageCallback(relayMsg);
      }
      return;
    }

    // System messages (phx_error, phx_close) — trigger reconnect
    if (event === "phx_error" || event === "phx_close") {
      this.handleDisconnect();
    }
  }

  /** Schedule a reconnection with exponential backoff. */
  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;

    console.log(`Supabase relay reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        // connect() handles its own errors; schedule next retry
        this.scheduleReconnect();
      });
    }, delay);
  }

  /** Clean up after an unexpected disconnect. */
  private handleDisconnect(): void {
    this.connected = false;
    this.stopHeartbeat();
    this.ws = null;
    this.scheduleReconnect();
  }

  // ── Public API ───────────────────────────────────────

  /**
   * Connect to the Supabase Realtime channel via raw WebSocket.
   * Uses the Phoenix Channels protocol — no Supabase SDK required.
   * All messages are E2E encrypted — Supabase only sees encrypted blobs.
   */
  async connect(): Promise<boolean> {
    if (!this.config?.supabaseUrl || !this.config?.supabaseAnonKey) {
      console.log("Supabase relay not configured — remote access unavailable");
      return false;
    }

    // Tear down any existing connection cleanly
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.stopHeartbeat();
    this.intentionalDisconnect = false;

    const wsUrl = this.buildWsUrl();

    return new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(wsUrl);
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
          this.handleMessage(raw);

          // Resolve the connect() promise once we get a successful join reply
          if (!resolved && this.connected) {
            resolved = true;
            resolve(true);
          }
        });

        ws.on("close", () => {
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
          this.handleDisconnect();
        });

        ws.on("error", (err: unknown) => {
          console.error("Supabase relay WebSocket error:", err);
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        });

        // Timeout: if join hasn't been acknowledged in 10s, give up this attempt
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(false);
            this.handleDisconnect();
          }
        }, 10_000);
      } catch (error) {
        console.error("Supabase relay connection failed:", error);
        resolve(false);
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Publish an encrypted RPC response to the channel.
   * iOS subscriber receives it in real-time via Phoenix broadcast.
   */
  async publish(encryptedPayload: string): Promise<void> {
    if (!this.connected || !this.config) return;

    const message: RelayMessage = {
      type: "rpc-response",
      payload: encryptedPayload,
      timestamp: Date.now(),
      sender: "desktop",
    };

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
   * Register a callback for incoming iOS messages.
   */
  onMessage(callback: (msg: RelayMessage) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * Disconnect from the relay and stop all timers.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.connected = false;
    this.stopHeartbeat();
    this.onMessageCallback = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    console.log("Supabase relay disconnected");
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConfig(): RelayConfig | null {
    return this.config;
  }
}
