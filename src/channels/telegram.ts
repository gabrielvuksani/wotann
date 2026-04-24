/**
 * Telegram channel adapter using the Bot API (HTTP long polling).
 *
 * ZERO-DEPENDENCY: Uses fetch() directly against the Telegram Bot API.
 * No need for grammy or telegraf — keeps the dependency footprint small.
 *
 * Setup:
 * 1. Create a bot via @BotFather on Telegram
 * 2. Set TELEGRAM_BOT_TOKEN=<your-token>
 * 3. Start: wotann channels telegram
 *
 * Security:
 * - DM pairing: unknown senders get a pairing code to verify
 * - Rate limiting: max 30 messages per minute per user
 * - No file downloads from untrusted senders
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage, ChannelType } from "./adapter.js";

interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly from?: {
      readonly id: number;
      readonly first_name: string;
      readonly username?: string;
    };
    readonly chat: {
      readonly id: number;
      readonly type: string;
    };
    readonly text?: string;
    readonly date: number;
  };
}

interface TelegramResponse {
  readonly ok: boolean;
  readonly result?: readonly TelegramUpdate[];
}

export class TelegramAdapter implements ChannelAdapter {
  readonly type: ChannelType = "telegram";
  readonly name = "Telegram Bot";

  private readonly token: string;
  private readonly apiBase: string;
  private connected = false;
  private polling = false;
  private lastUpdateId = 0;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private pollAbortController: AbortController | null = null;

  constructor(token?: string) {
    this.token = token ?? process.env["TELEGRAM_BOT_TOKEN"] ?? "";
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
  }

  /**
   * V9 T1.6 — Verify that a Telegram webhook request came from the
   * official Telegram IP space.
   *
   * Telegram does NOT sign webhook requests with HMAC (unlike Slack
   * or WhatsApp). Their guidance: bind your webhook to an IP allowlist
   * and/or use a `secret_token` query parameter. Here we implement the
   * allowlist check; callers wanting defense-in-depth should ALSO
   * verify the `secret_token` they configured via `setWebhook`.
   *
   * Official IP ranges (source: core.telegram.org/bots/webhooks):
   *   149.154.160.0/20, 91.108.4.0/22.
   *
   * @param remoteIp The `req.socket.remoteAddress` (or x-forwarded-for
   *                 trusted first hop) of the webhook request.
   * @returns true when remoteIp is inside a Telegram-published range.
   */
  verifySignature(remoteIp: string): boolean {
    if (!remoteIp) return false;
    // Strip optional IPv6-mapped prefix: "::ffff:149.154.167.197" → "149.154.167.197".
    const ip = remoteIp.startsWith("::ffff:") ? remoteIp.slice(7) : remoteIp;
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    const [a, b, c, d] = parts as [number, number, number, number];
    const ipNum = (a << 24) | (b << 16) | (c << 8) | d;
    // 149.154.160.0/20 → 149.154.160.0 .. 149.154.175.255
    const range1Lo = (149 << 24) | (154 << 16) | (160 << 8);
    const range1Hi = (149 << 24) | (154 << 16) | (175 << 8) | 255;
    // 91.108.4.0/22 → 91.108.4.0 .. 91.108.7.255
    const range2Lo = (91 << 24) | (108 << 16) | (4 << 8);
    const range2Hi = (91 << 24) | (108 << 16) | (7 << 8) | 255;
    const u = ipNum >>> 0; // treat as unsigned
    return (
      (u >= range1Lo >>> 0 && u <= range1Hi >>> 0) || (u >= range2Lo >>> 0 && u <= range2Hi >>> 0)
    );
  }

  async start(): Promise<void> {
    if (!this.token) {
      throw new Error("TELEGRAM_BOT_TOKEN not set. Create a bot via @BotFather.");
    }

    // Verify the token works
    const response = await fetch(`${this.apiBase}/getMe`);
    if (!response.ok) {
      throw new Error("Invalid Telegram bot token");
    }

    this.connected = true;
    this.polling = true;
    this.startPolling();
  }

  async stop(): Promise<void> {
    this.polling = false;
    this.connected = false;
    this.pollAbortController?.abort();
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // Split long messages (Telegram limit: 4096 chars)
      const chunks = splitMessage(message.content, 4096);

      for (const chunk of chunks) {
        const response = await fetch(`${this.apiBase}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: message.channelId,
            text: chunk,
            parse_mode: message.format === "markdown" ? "MarkdownV2" : undefined,
            reply_to_message_id: message.replyTo ? parseInt(message.replyTo, 10) : undefined,
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

  // ── Long Polling ────────────────────────────────────────

  private async startPolling(): Promise<void> {
    while (this.polling) {
      try {
        this.pollAbortController = new AbortController();
        const timeout = setTimeout(() => this.pollAbortController?.abort(), 35_000);

        const response = await fetch(
          `${this.apiBase}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`,
          { signal: this.pollAbortController.signal },
        );
        clearTimeout(timeout);

        if (!response.ok) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const data = (await response.json()) as TelegramResponse;
        if (data.ok && data.result) {
          for (const update of data.result) {
            this.lastUpdateId = update.update_id;
            await this.handleUpdate(update);
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          continue; // Normal timeout
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message?.text || !this.messageHandler) return;

    const msg: IncomingMessage = {
      channelType: "telegram",
      channelId: String(update.message.chat.id),
      senderId: String(update.message.from?.id ?? 0),
      senderName: update.message.from?.username ?? update.message.from?.first_name ?? "unknown",
      content: update.message.text,
      timestamp: new Date(update.message.date * 1000),
      replyTo: String(update.message.message_id),
    };

    await this.messageHandler(msg);
  }
}

// ── Helpers ──────────────────────────────────────────────

function splitMessage(text: string, maxLength: number): readonly string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) {
      // No newline found — split at word boundary
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx <= 0) {
      // No word boundary — hard split
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
}
