/**
 * Line channel adapter (LINE Messaging API).
 *
 * ZERO-DEPENDENCY: Uses fetch() against api.line.me.
 * No @line/bot-sdk required.
 *
 * Setup:
 * 1. Create a channel at https://developers.line.biz
 * 2. Get the Channel Access Token (long-lived) and Channel Secret
 * 3. Set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET
 * 4. Configure a webhook URL in the LINE Developers Console
 *
 * Inbound: LINE POSTs a signed JSON webhook to the operator-owned URL.
 * The hosting server forwards the payload to `handleWebhookBody()`.
 *
 * Outbound:
 *   1. `replyToken` path — free, must be used within 30 seconds of the
 *      inbound event. Used automatically when replyTo is a reply token.
 *   2. `push` path — consumes message quota but works any time.
 *
 * Security:
 * - Verifies the X-Line-Signature HMAC when a secret is configured.
 * - Honest errors on missing token; no silent fallback to a mock sender.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, ChannelType, IncomingMessage, OutgoingMessage } from "./adapter.js";

export interface LineWebhookEvent {
  readonly type: string;
  readonly message?: {
    readonly id: string;
    readonly type: string;
    readonly text?: string;
  };
  readonly replyToken?: string;
  readonly source?: {
    readonly type: "user" | "group" | "room";
    readonly userId?: string;
    readonly groupId?: string;
    readonly roomId?: string;
  };
  readonly timestamp?: number;
}

interface LineWebhookBody {
  readonly destination?: string;
  readonly events?: readonly LineWebhookEvent[];
}

/**
 * LINE accepts up to 5 messages per reply/push request; each text message
 * caps at 5000 chars. We keep chunks at 4500 for display safety.
 */
const LINE_MESSAGE_LIMIT = 4500;
const LINE_MAX_MESSAGES_PER_REQUEST = 5;

export class LineAdapter implements ChannelAdapter {
  readonly type: ChannelType = "line";
  readonly name = "LINE";

  private readonly channelAccessToken: string;
  private readonly channelSecret: string;
  private connected = false;
  /** Reply tokens are one-shot; we clear them after use. */
  private readonly replyTokens: Map<string, string> = new Map();
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(channelAccessToken?: string, channelSecret?: string) {
    this.channelAccessToken = channelAccessToken ?? process.env["LINE_CHANNEL_ACCESS_TOKEN"] ?? "";
    this.channelSecret = channelSecret ?? process.env["LINE_CHANNEL_SECRET"] ?? "";
  }

  async start(): Promise<void> {
    if (!this.channelAccessToken) {
      throw new Error(
        "LINE_CHANNEL_ACCESS_TOKEN required. " +
          "Create a channel at https://developers.line.biz and issue a long-lived access token.",
      );
    }

    // Verify the token works by hitting the bot info endpoint.
    const response = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${this.channelAccessToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `Invalid LINE channel access token: ${response.status} ${response.statusText}`,
      );
    }

    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
    this.replyTokens.clear();
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const chunks = splitMessage(message.content, LINE_MESSAGE_LIMIT);
      const batches = chunkInto(chunks, LINE_MAX_MESSAGES_PER_REQUEST);

      // If the caller supplies a replyTo value AND we still have a stored
      // reply token for it, use the free reply path first.
      const replyToken = message.replyTo ? this.replyTokens.get(message.replyTo) : undefined;

      let used = false;
      for (const [batchIdx, batch] of batches.entries()) {
        const messages = batch.map((text) => ({ type: "text", text }));

        let ok: boolean;
        if (batchIdx === 0 && replyToken) {
          ok = await this.postJson("/v2/bot/message/reply", {
            replyToken,
            messages,
          });
          used = true;
        } else {
          ok = await this.postJson("/v2/bot/message/push", {
            to: message.channelId,
            messages,
          });
        }

        if (!ok) return false;
      }

      // Clear the reply token so it can't be reused (LINE rejects duplicates).
      if (used && message.replyTo) {
        this.replyTokens.delete(message.replyTo);
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
   * Verify a LINE webhook signature. Returns true when the HMAC matches
   * or when no secret is configured (best-effort development mode).
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!this.channelSecret) return true; // Dev mode — no secret configured.
    if (!signature) return false;

    const computed = createHmac("sha256", this.channelSecret)
      .update(rawBody, "utf8")
      .digest("base64");

    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Process a raw LINE webhook body. The hosting server calls this with
   * the JSON string and the X-Line-Signature header.
   */
  async handleWebhookBody(rawBody: string, signature?: string): Promise<boolean> {
    if (!this.verifySignature(rawBody, signature)) return false;

    let parsed: LineWebhookBody;
    try {
      parsed = JSON.parse(rawBody) as LineWebhookBody;
    } catch {
      return false;
    }

    if (!parsed.events) return true; // Empty verification ping.

    for (const event of parsed.events) {
      await this.handleEvent(event);
    }
    return true;
  }

  /**
   * Process a single decoded LINE event. Exposed so tests and alternate
   * transports (e.g. log replay) can reuse the dispatch path without
   * needing a signed HTTP body.
   */
  async handleEvent(event: LineWebhookEvent): Promise<void> {
    if (!this.messageHandler) return;
    if (event.type !== "message") return;
    if (event.message?.type !== "text" || !event.message.text) return;
    if (!event.source) return;

    const recipient =
      event.source.type === "user"
        ? event.source.userId
        : event.source.type === "group"
          ? event.source.groupId
          : event.source.roomId;
    if (!recipient) return;

    // Stash the reply token so the next outbound message uses the free path.
    if (event.replyToken) {
      this.replyTokens.set(event.message.id, event.replyToken);
    }

    const msg: IncomingMessage = {
      channelType: "line",
      channelId: recipient,
      senderId: event.source.userId ?? recipient,
      senderName: event.source.userId ?? recipient,
      content: event.message.text,
      timestamp: new Date(event.timestamp ?? Date.now()),
      replyTo: event.message.id,
    };

    await this.messageHandler(msg);
  }

  // ── Internal helpers ──────────────────────────────────────

  private async postJson(path: string, body: unknown): Promise<boolean> {
    const response = await fetch(`https://api.line.me${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return response.ok;
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

function chunkInto<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (items.length <= size) return [items];
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
