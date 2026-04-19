/**
 * DingTalk channel adapter (Robot API — oapi.dingtalk.com).
 *
 * DingTalk ("钉钉") is Alibaba's enterprise collaboration platform. The
 * custom-robot API exposes a signed group webhook for outbound messages;
 * inbound callbacks are available but require the group admin to install
 * an enterprise bot — a heavier integration we scaffold via
 * `handleCallback()` but do not require.
 *
 * ZERO-DEPENDENCY: Uses fetch() against oapi.dingtalk.com.
 *
 * Setup:
 * 1. Create a custom group robot in the DingTalk group settings:
 *    群设置 > 智能群助手 > 添加机器人 > 自定义
 * 2. Copy the webhook URL (contains `access_token=`)
 * 3. Optionally enable "加签" (signed) mode and copy the secret
 * 4. Set DINGTALK_WEBHOOK_URL and optionally DINGTALK_SECRET
 *
 * Outbound: POST JSON body with `msgtype` and `text` content.
 *
 * Inbound: The API returns callbacks only for "enterprise bots", not custom
 * group robots. When operators install the enterprise variant, Alibaba's
 * edge forwards JSON POSTs to an operator-owned endpoint; that server should
 * decode the payload and invoke `handleCallback()`. Custom-robot deployments
 * skip the inbound path entirely, which is honest: the adapter does not
 * pretend to receive messages on webhook-only mode.
 */

import { createHmac } from "node:crypto";
import type { ChannelAdapter, ChannelType, IncomingMessage, OutgoingMessage } from "./adapter.js";

export interface DingTalkCallbackPayload {
  readonly msgtype: string;
  readonly text?: { readonly content?: string };
  readonly senderId?: string;
  readonly senderNick?: string;
  readonly conversationId?: string;
  readonly msgId?: string;
  readonly createAt?: number;
}

interface DingTalkApiResponse {
  readonly errcode: number;
  readonly errmsg?: string;
}

/**
 * DingTalk caps text messages at 20KB per request. We keep chunks at ~19000
 * chars to leave room for envelope padding.
 */
const DINGTALK_MESSAGE_LIMIT = 19_000;

export class DingTalkAdapter implements ChannelAdapter {
  readonly type: ChannelType = "dingtalk";
  readonly name = "DingTalk";

  private readonly webhookUrl: string;
  private readonly secret: string;
  private connected = false;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(webhookUrl?: string, secret?: string) {
    this.webhookUrl = webhookUrl ?? process.env["DINGTALK_WEBHOOK_URL"] ?? "";
    this.secret = secret ?? process.env["DINGTALK_SECRET"] ?? "";
  }

  async start(): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error(
        "DINGTALK_WEBHOOK_URL required. " +
          "Create a custom group robot and copy its access_token webhook URL.",
      );
    }

    // A webhook URL is opaque until first use; we mark connected without
    // a synthetic request so we don't exhaust the per-minute rate limit.
    // Failures surface honestly on the first send().
    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const chunks = splitMessage(message.content, DINGTALK_MESSAGE_LIMIT);

      for (const chunk of chunks) {
        const url = this.buildSignedUrl();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "text",
            text: { content: chunk },
          }),
        });

        if (!response.ok) return false;
        const data = (await response.json()) as DingTalkApiResponse;
        if (data.errcode !== 0) return false;
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
   * Process an enterprise-bot callback payload. Alibaba posts these JSON
   * envelopes to the operator's HTTPS endpoint; the hosting server should
   * pass the decoded JSON here.
   */
  async handleCallback(payload: DingTalkCallbackPayload): Promise<void> {
    if (!this.messageHandler) return;
    if (payload.msgtype !== "text" || !payload.text?.content) return;
    if (!payload.senderId && !payload.conversationId) return;

    const channelId = payload.conversationId ?? payload.senderId ?? "";
    const senderId = payload.senderId ?? channelId;

    const msg: IncomingMessage = {
      channelType: "dingtalk",
      channelId,
      senderId,
      senderName: payload.senderNick ?? senderId,
      content: payload.text.content,
      timestamp: new Date(payload.createAt ?? Date.now()),
      replyTo: payload.msgId ?? undefined,
    };

    await this.messageHandler(msg);
  }

  // ── Internal helpers ──────────────────────────────────────

  /**
   * When signing is enabled (加签), DingTalk requires a `timestamp` and
   * `sign=HMAC-SHA256(secret, timestamp + '\n' + secret)` in the URL.
   */
  private buildSignedUrl(): string {
    if (!this.secret) return this.webhookUrl;

    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${this.secret}`;
    const signature = createHmac("sha256", this.secret)
      .update(stringToSign, "utf8")
      .digest("base64");

    const separator = this.webhookUrl.includes("?") ? "&" : "?";
    const params = new URLSearchParams({
      timestamp: String(timestamp),
      sign: signature,
    });
    return `${this.webhookUrl}${separator}${params.toString()}`;
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
