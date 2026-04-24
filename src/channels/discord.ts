/**
 * Discord channel adapter using the Bot Gateway (WebSocket).
 *
 * ZERO-DEPENDENCY: Uses fetch() for REST API and WebSocket for gateway.
 * No need for discord.js — keeps dependency footprint minimal.
 *
 * Setup:
 * 1. Create a Discord Bot at https://discord.com/developers/applications
 * 2. Enable "Message Content" intent in Bot settings
 * 3. Set DISCORD_BOT_TOKEN=<your-token>
 * 4. Invite bot to server with appropriate permissions
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage, ChannelType } from "./adapter.js";
// V9 T1.6 — Ed25519 signature verification for Discord Interactions.
import { createPublicKey, verify } from "node:crypto";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

interface DiscordMessage {
  readonly id: string;
  readonly channel_id: string;
  readonly content: string;
  readonly author: {
    readonly id: string;
    readonly username: string;
    readonly bot?: boolean;
  };
  readonly timestamp: string;
  readonly referenced_message?: { readonly id: string };
}

interface GatewayEvent {
  readonly op: number;
  readonly t?: string;
  readonly d?: Record<string, unknown>;
  readonly s?: number;
}

export class DiscordAdapter implements ChannelAdapter {
  readonly type: ChannelType = "discord";
  readonly name = "Discord Bot";

  private readonly token: string;
  private connected = false;
  private ws: WebSocket | null = null;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private sequenceNumber: number | null = null;
  private botUserId: string | null = null;

  constructor(token?: string) {
    this.token = token ?? process.env["DISCORD_BOT_TOKEN"] ?? "";
  }

  /**
   * V9 T1.6 — Verify a Discord Interactions webhook signature.
   *
   * Discord uses Ed25519 signatures (NOT HMAC). Outgoing interactions
   * include:
   *   X-Signature-Ed25519: hex-encoded 64-byte signature
   *   X-Signature-Timestamp: unix timestamp as sent in the header
   * The signed message is `timestamp + rawBody` (concatenation,
   * UTF-8). Verify against the bot application's Public Key (hex,
   * from the Discord Developer Portal).
   *
   * Node's WebCrypto subtle.verify supports Ed25519 natively since
   * Node 18; crypto.verify with algorithm name "ed25519" works on
   * Node 20+. We use the legacy crypto API for broader compat.
   *
   * @param rawBody Raw request body (as received).
   * @param signatureHex Value of X-Signature-Ed25519 header.
   * @param timestamp Value of X-Signature-Timestamp header.
   * @param publicKeyHex Discord bot application's Public Key (hex).
   * @returns true when the signature is valid.
   */
  verifySignature(
    rawBody: string,
    signatureHex: string,
    timestamp: string,
    publicKeyHex: string,
  ): boolean {
    if (!signatureHex || !timestamp || !publicKeyHex) return false;
    try {
      // Wrap the raw 32-byte Ed25519 public key in DER/SPKI so
      // createPublicKey accepts it. The DER prefix below is the
      // OID wrapping for Ed25519 (RFC 8410).
      const rawKey = Buffer.from(publicKeyHex, "hex");
      if (rawKey.length !== 32) return false;
      const derPrefix = Buffer.from([
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
      ]);
      const spkiDer = Buffer.concat([derPrefix, rawKey]);
      const publicKey = createPublicKey({
        key: spkiDer,
        format: "der",
        type: "spki",
      });
      const data = Buffer.from(timestamp + rawBody, "utf8");
      const sig = Buffer.from(signatureHex, "hex");
      if (sig.length !== 64) return false;
      // Ed25519 verify takes `null` as the algorithm argument because
      // the algorithm is bound to the key — not a parameter to pick.
      return verify(null, data, publicKey, sig);
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (!this.token) {
      throw new Error(
        "DISCORD_BOT_TOKEN not set. Create a bot at https://discord.com/developers/applications",
      );
    }

    // Verify token and get bot user info
    const meResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${this.token}` },
    });
    if (!meResponse.ok) throw new Error("Invalid Discord bot token");
    const me = (await meResponse.json()) as { id: string };
    this.botUserId = me.id;

    // Connect to gateway — connected flag is set when READY event fires
    this.ws = new WebSocket(DISCORD_GATEWAY);

    this.ws.addEventListener("message", (event) => {
      this.handleGatewayEvent(String(event.data));
    });

    this.ws.addEventListener("close", () => {
      this.cleanup();
    });

    this.ws.addEventListener("error", () => {
      this.cleanup();
    });
  }

  async stop(): Promise<void> {
    this.cleanup();
    this.ws?.close(1000);
    this.ws = null;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // Split long messages (Discord limit: 2000 chars)
      const chunks = splitDiscordMessage(message.content, 2000);

      for (const chunk of chunks) {
        const response = await fetch(`${DISCORD_API}/channels/${message.channelId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: chunk,
            message_reference: message.replyTo ? { message_id: message.replyTo } : undefined,
          }),
        });

        if (!response.ok) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Gateway Event Handling ──────────────────────────────

  private handleGatewayEvent(rawData: string): void {
    try {
      const event = JSON.parse(rawData) as GatewayEvent;

      if (event.s !== null && event.s !== undefined) {
        this.sequenceNumber = event.s;
      }

      switch (event.op) {
        case 10: // Hello — start heartbeat
          this.startHeartbeat((event.d as { heartbeat_interval: number }).heartbeat_interval);
          this.identify();
          break;
        case 11: // Heartbeat ACK
          break;
        case 0: // Dispatch
          if (event.t === "READY") {
            this.connected = true;
          } else if (event.t === "MESSAGE_CREATE") {
            this.handleMessageCreate(event.d as unknown as DiscordMessage);
          }
          break;
      }
    } catch {
      // Skip malformed events
    }
  }

  private identify(): void {
    if (!this.ws) return;

    this.ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: this.token,
          intents: (1 << 9) | (1 << 12) | (1 << 15), // GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT
          properties: {
            os: process.platform,
            browser: "wotann",
            device: "wotann",
          },
        },
      }),
    );
  }

  private startHeartbeat(intervalMs: number): void {
    this.heartbeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.sequenceNumber }));
    }, intervalMs);
  }

  private handleMessageCreate(msg: DiscordMessage): void {
    // Skip bot messages (including our own)
    if (msg.author.bot) return;
    if (msg.author.id === this.botUserId) return;
    if (!msg.content.trim()) return;
    if (!this.messageHandler) return;

    const incomingMsg: IncomingMessage = {
      channelType: "discord",
      channelId: msg.channel_id,
      senderId: msg.author.id,
      senderName: msg.author.username,
      content: msg.content,
      timestamp: new Date(msg.timestamp),
      replyTo: msg.referenced_message?.id,
    };

    // Fire and forget — don't block the gateway
    this.messageHandler(incomingMsg).catch(() => {});
  }

  private cleanup(): void {
    this.connected = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────

function splitDiscordMessage(text: string, maxLength: number): readonly string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Split at code block boundary if possible
    let splitIdx = remaining.lastIndexOf("```\n", maxLength);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(" ", maxLength);
    if (splitIdx <= 0) splitIdx = maxLength;

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
}
