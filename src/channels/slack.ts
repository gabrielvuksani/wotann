/**
 * Slack channel adapter using the Web API + Socket Mode.
 *
 * ZERO-DEPENDENCY: Uses fetch() against the Slack Web API.
 * For real-time events, uses the Socket Mode WebSocket API
 * (no public URL required — works behind firewalls).
 *
 * Setup:
 * 1. Create a Slack App at https://api.slack.com/apps
 * 2. Enable Socket Mode
 * 3. Add Bot Token Scopes: chat:write, app_mentions:read, im:history
 * 4. Set SLACK_BOT_TOKEN=xoxb-... and SLACK_APP_TOKEN=xapp-...
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage, ChannelType } from "./adapter.js";
// V9 T1.6 — HMAC verification imports for verifySignature().
import { createHmac, timingSafeEqual } from "node:crypto";

interface SlackMessage {
  readonly type: string;
  readonly subtype?: string;
  readonly text?: string;
  readonly user?: string;
  readonly bot_id?: string;
  readonly channel?: string;
  readonly ts?: string;
  readonly thread_ts?: string;
}

interface SlackEvent {
  readonly type: string;
  readonly event?: SlackMessage;
  readonly envelope_id?: string;
}

interface SlackUserInfo {
  readonly ok: boolean;
  readonly user?: {
    readonly name: string;
    readonly real_name?: string;
  };
}

export class SlackAdapter implements ChannelAdapter {
  readonly type: ChannelType = "slack";
  readonly name = "Slack";

  private readonly botToken: string;
  private readonly appToken: string;
  private connected = false;
  private ws: WebSocket | null = null;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private readonly userCache = new Map<string, string>();

  constructor(botToken?: string, appToken?: string) {
    this.botToken = botToken ?? process.env["SLACK_BOT_TOKEN"] ?? "";
    this.appToken = appToken ?? process.env["SLACK_APP_TOKEN"] ?? "";
  }

  /**
   * V9 T1.6 — Verify a Slack webhook signature.
   *
   * Slack's scheme: compute `v0=hex(HMAC-SHA256(v0:<timestamp>:<body>, signing_secret))`
   * and compare to the `X-Slack-Signature` header. The `X-Slack-Request-Timestamp`
   * header is part of the signature base so old captured requests can't be
   * replayed with a stale signature. Implementations should additionally reject
   * timestamps older than 5 minutes (per Slack's guidance).
   *
   * @param rawBody Unmodified request body as received (must be the raw bytes,
   *                not a re-serialized JSON — Slack signs the exact bytes).
   * @param timestamp Value of `X-Slack-Request-Timestamp` header.
   * @param signature Value of `X-Slack-Signature` header (format: `v0=…`).
   * @param signingSecret The app's signing secret (from api.slack.com/apps →
   *                     Basic Information → Signing Secret).
   * @returns true when the signature is valid AND the timestamp is within 5min.
   */
  verifySignature(
    rawBody: string,
    timestamp: string,
    signature: string,
    signingSecret: string,
  ): boolean {
    if (!signingSecret || !signature || !timestamp) return false;
    // Replay protection: reject timestamps more than 5 minutes old.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > 300) return false;

    const base = `v0:${timestamp}:${rawBody}`;
    const expected = `v0=${createHmac("sha256", signingSecret).update(base, "utf8").digest("hex")}`;
    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (!this.botToken || !this.appToken) {
      throw new Error(
        "SLACK_BOT_TOKEN and SLACK_APP_TOKEN required. Create a Slack App at https://api.slack.com/apps",
      );
    }

    // Get WebSocket URL via Socket Mode
    const response = await fetch("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.appToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = (await response.json()) as { ok: boolean; url?: string };
    if (!data.ok || !data.url) {
      throw new Error("Failed to open Slack Socket Mode connection");
    }

    this.ws = new WebSocket(data.url);

    this.ws.addEventListener("open", () => {
      this.connected = true;
    });

    this.ws.addEventListener("message", (event) => {
      this.handleSocketEvent(String(event.data));
    });

    this.ws.addEventListener("close", () => {
      this.connected = false;
    });

    this.ws.addEventListener("error", () => {
      this.connected = false;
    });
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected || !this.botToken) return false;

    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: message.channelId,
          text: message.content,
          thread_ts: message.replyTo,
          mrkdwn: message.format === "markdown",
        }),
      });

      const data = (await response.json()) as { ok: boolean };
      return data.ok;
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

  // ── Socket Mode Event Handling ──────────────────────────

  private async handleSocketEvent(rawData: string): Promise<void> {
    try {
      const event = JSON.parse(rawData) as SlackEvent;

      // Acknowledge the event
      if (event.envelope_id && this.ws) {
        this.ws.send(JSON.stringify({ envelope_id: event.envelope_id }));
      }

      // Process message events
      if (event.type === "events_api" && event.event?.type === "message") {
        await this.processMessage(event.event);
      }
    } catch {
      // Skip malformed events
    }
  }

  private async processMessage(slackMsg: SlackMessage): Promise<void> {
    if (!slackMsg.text || !slackMsg.channel || !slackMsg.user) return;
    if (!this.messageHandler) return;

    // Skip bot messages — bot_id is set on all bot-authored messages,
    // subtype "bot_message" covers webhook-style bots, and USLACKBOT is
    // Slack's built-in responder. Without this, the adapter's own replies
    // would loop back as new inbound messages.
    if (slackMsg.bot_id) return;
    if (slackMsg.subtype === "bot_message") return;
    if (slackMsg.user === "USLACKBOT") return;

    const senderName = await this.resolveUserName(slackMsg.user);

    const msg: IncomingMessage = {
      channelType: "slack",
      channelId: slackMsg.channel,
      senderId: slackMsg.user,
      senderName,
      content: slackMsg.text,
      timestamp: new Date(parseFloat(slackMsg.ts ?? "0") * 1000),
      replyTo: slackMsg.thread_ts,
    };

    await this.messageHandler(msg);
  }

  private async resolveUserName(userId: string): Promise<string> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    try {
      const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
        headers: { Authorization: `Bearer ${this.botToken}` },
      });
      const data = (await response.json()) as SlackUserInfo;
      const name = data.user?.real_name ?? data.user?.name ?? userId;
      this.userCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }
}
