/**
 * Viber channel adapter (Bot API — chatapi.viber.com).
 *
 * ZERO-DEPENDENCY: Uses fetch() against the Viber REST API.
 * No viber-bot SDK required.
 *
 * Setup:
 * 1. Create a Public Account at https://partners.viber.com
 * 2. Copy the authentication token
 * 3. Set VIBER_AUTH_TOKEN and optionally VIBER_SENDER_NAME / VIBER_SENDER_AVATAR
 * 4. Register webhook via `set_webhook`: the adapter does this on start()
 *
 * Inbound: Viber POSTs signed JSON events to an operator-owned URL.
 * The hosting server verifies the X-Viber-Content-Signature header, then
 * forwards the body here via `handleWebhookBody()`.
 *
 * Outbound: POST /pa/send_message with the receiver id.
 *
 * Security:
 * - Verifies the X-Viber-Content-Signature HMAC when present.
 * - Honest error on missing token (no silent fallback).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, ChannelType, IncomingMessage, OutgoingMessage } from "./adapter.js";

export interface ViberWebhookEvent {
  readonly event: string;
  readonly timestamp?: number;
  readonly message_token?: number | string;
  readonly sender?: {
    readonly id: string;
    readonly name?: string;
    readonly avatar?: string;
  };
  readonly message?: {
    readonly type: string;
    readonly text?: string;
    readonly tracking_data?: string;
  };
}

interface ViberApiResponse {
  readonly status: number;
  readonly status_message?: string;
  readonly message_token?: number;
}

const VIBER_API_BASE = "https://chatapi.viber.com/pa";

/**
 * Viber text messages cap at 7000 chars. We keep chunks at 6500 to reserve
 * space for "(n/m)" prefixes and future metadata.
 */
const VIBER_MESSAGE_LIMIT = 6500;

export class ViberAdapter implements ChannelAdapter {
  readonly type: ChannelType = "viber";
  readonly name = "Viber";

  private readonly authToken: string;
  private readonly senderName: string;
  private readonly senderAvatar: string;
  private connected = false;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(authToken?: string, senderName?: string, senderAvatar?: string) {
    this.authToken = authToken ?? process.env["VIBER_AUTH_TOKEN"] ?? "";
    this.senderName = senderName ?? process.env["VIBER_SENDER_NAME"] ?? "WOTANN";
    this.senderAvatar = senderAvatar ?? process.env["VIBER_SENDER_AVATAR"] ?? "";
  }

  async start(): Promise<void> {
    if (!this.authToken) {
      throw new Error(
        "VIBER_AUTH_TOKEN required. " +
          "Create a Public Account at https://partners.viber.com and copy the auth token.",
      );
    }

    // Verify credentials by fetching account info. This does NOT auto-register
    // a webhook URL because only the deploying operator knows the public URL;
    // `set_webhook` must be called from the hosting server at deploy time.
    const response = await this.post<ViberApiResponse>("/get_account_info", {});
    if (response.status !== 0) {
      throw new Error(
        `Viber account verification failed: ${response.status_message ?? "unknown"} (code ${response.status})`,
      );
    }

    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const chunks = splitMessage(message.content, VIBER_MESSAGE_LIMIT);

      for (const chunk of chunks) {
        const body = {
          receiver: message.channelId,
          type: "text",
          text: chunk,
          sender: {
            name: this.senderName,
            ...(this.senderAvatar ? { avatar: this.senderAvatar } : {}),
          },
          ...(message.replyTo ? { tracking_data: String(message.replyTo) } : {}),
        };

        const response = await this.post<ViberApiResponse>("/send_message", body);
        if (response.status !== 0) return false;
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

  /**
   * Verify a Viber webhook signature. Viber signs the raw request body
   * with HMAC-SHA256 using the auth token as the secret.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;

    const computed = createHmac("sha256", this.authToken).update(rawBody, "utf8").digest("hex");

    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Process a raw Viber webhook body. The hosting server calls this with
   * the JSON string and the X-Viber-Content-Signature header.
   */
  async handleWebhookBody(
    rawBody: string,
    signature?: string,
    options?: { skipSignature?: boolean },
  ): Promise<boolean> {
    if (!options?.skipSignature && !this.verifySignature(rawBody, signature)) {
      return false;
    }

    let parsed: ViberWebhookEvent;
    try {
      parsed = JSON.parse(rawBody) as ViberWebhookEvent;
    } catch {
      return false;
    }

    await this.handleEvent(parsed);
    return true;
  }

  /**
   * Process a decoded Viber event. Exposed so tests and alternate transports
   * (e.g. log replay) can skip signature verification during dev.
   */
  async handleEvent(event: ViberWebhookEvent): Promise<void> {
    if (!this.messageHandler) return;
    if (event.event !== "message") return;
    if (event.message?.type !== "text" || !event.message.text) return;
    if (!event.sender?.id) return;

    const msg: IncomingMessage = {
      channelType: "viber",
      channelId: event.sender.id,
      senderId: event.sender.id,
      senderName: event.sender.name ?? event.sender.id,
      content: event.message.text,
      timestamp: new Date(event.timestamp ?? Date.now()),
      replyTo: event.message_token ? String(event.message_token) : undefined,
    };

    await this.messageHandler(msg);
  }

  // ── Internal helpers ──────────────────────────────────────

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${VIBER_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "X-Viber-Auth-Token": this.authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Viber API error: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}

// ── Helpers ─────────────────────────────────────────────────

function splitMessage(text: string, maxLength: number): readonly string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(" ", maxLength);
    if (splitIdx <= 0) splitIdx = maxLength;

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
}
