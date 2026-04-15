/**
 * Google Chat channel adapter (E9).
 *
 * Two integration modes:
 *   1. Webhook-out — drop-in webhook URL; post WOTANN responses as cards.
 *   2. Bot API — Google Chat app with OAuth service account; receive
 *      incoming messages via Google's Pub/Sub push endpoint.
 *
 * Mode 1 ships today (zero-config, no service account). Mode 2 is
 * scaffolded but requires Google Cloud setup; we document the stub but
 * don't auto-connect it without explicit config.
 *
 * Config:
 *   GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/.../messages?key=...
 */

import type { ChannelAdapter, ChannelMessage, ChannelType } from "./gateway.js";

export interface GoogleChatConfig {
  readonly webhookUrl?: string;
  readonly serviceAccountKey?: string;
  readonly spaceName?: string;
}

export class GoogleChatAdapter implements ChannelAdapter {
  readonly type: ChannelType = "google-chat";
  readonly name = "Google Chat";
  connected = false;

  private readonly config: GoogleChatConfig;
  private readonly handlers: Array<(m: ChannelMessage) => void> = [];

  constructor(config: GoogleChatConfig = {}) {
    this.config = config;
  }

  async connect(): Promise<boolean> {
    if (!this.config.webhookUrl && !this.config.serviceAccountKey) {
       
      console.warn("[google-chat] No webhookUrl or serviceAccountKey configured");
      return false;
    }
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  onMessage(handler: (m: ChannelMessage) => void): void {
    this.handlers.push(handler);
  }

  async send(channelId: string, content: string, _replyTo?: string): Promise<boolean> {
    if (!this.connected) return false;
    const url = this.config.webhookUrl;
    if (!url) return false;

    // Google Chat accepts either a plain `text` payload or a rich `cardsV2`
    // payload. We use `text` for compat unless the caller wraps the message
    // with a known marker.
    const body = { text: content, space: { name: channelId || this.config.spaceName || "" } };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Dispatch an incoming push message from Pub/Sub / Cloud Functions. The
   * hosting application decodes the Pub/Sub envelope and calls this with
   * the `message.data` event JSON.
   */
  dispatchIncoming(event: unknown): void {
    const parsed = event as {
      type?: string;
      message?: { text?: string; sender?: { name?: string; displayName?: string } };
      space?: { name?: string };
      eventTime?: string;
    };
    if (parsed.type !== "MESSAGE" || !parsed.message?.text) return;

    const senderName =
      parsed.message.sender?.displayName ?? parsed.message.sender?.name ?? "unknown";
    const msg: ChannelMessage = {
      id: `gchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelType: this.type,
      channelId: parsed.space?.name ?? "",
      senderId: senderName,
      senderName,
      content: parsed.message.text,
      timestamp: parsed.eventTime ? Date.parse(parsed.eventTime) : Date.now(),
    };
    for (const handler of this.handlers) handler(msg);
  }
}
