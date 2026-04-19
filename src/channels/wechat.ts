/**
 * WeChat channel adapter (WeCom / WeChat Work — qyapi.weixin.qq.com).
 *
 * WeChat Work ("企业微信") is Tencent's enterprise Slack-style product and
 * exposes a stable bot/webhook HTTP API. The consumer WeChat messenger
 * itself does NOT expose a public bot API; WeChat Work is the only
 * WeChat-family platform where an automated agent can participate
 * without reverse-engineering the client, so that's what we target here.
 *
 * ZERO-DEPENDENCY: Uses fetch() against the WeChat Work REST API.
 *
 * Outbound:
 *   1. Group robot webhook (preferred, no OAuth) — cheapest route.
 *   2. App messages via gettoken + /cgi-bin/message/send for DMs.
 *
 * Inbound: Tencent delivers inbound payloads to an operator-owned
 * HTTP endpoint; the adapter exposes `handleCallback()` so the host
 * server can forward decrypted payloads.
 *
 * Security:
 * - Honest errors when credentials are missing (no silent fallback).
 * - Skips echoes of our own messages when the Tencent payload flags
 *   them via the FromUserName equal to the configured agent id.
 */

import type { ChannelAdapter, ChannelType, IncomingMessage, OutgoingMessage } from "./adapter.js";

export interface WeChatWorkCallbackPayload {
  readonly MsgType: string;
  readonly Content?: string;
  readonly FromUserName: string;
  readonly ToUserName?: string;
  readonly CreateTime?: number | string;
  readonly MsgId?: string;
  readonly AgentID?: string;
}

interface WeChatTokenResponse {
  readonly errcode: number;
  readonly errmsg?: string;
  readonly access_token?: string;
  readonly expires_in?: number;
}

interface WeChatSendResponse {
  readonly errcode: number;
  readonly errmsg?: string;
}

/**
 * WeChat Work caps a single text message at 2048 bytes (UTF-8).
 * We keep 2000 to leave headroom for emoji surrogates and prefixes.
 */
const WECHAT_MESSAGE_LIMIT = 2000;

export class WeChatAdapter implements ChannelAdapter {
  readonly type: ChannelType = "wechat";
  readonly name = "WeChat Work";

  private readonly corpId: string;
  private readonly corpSecret: string;
  private readonly agentId: string;
  private readonly webhookUrl: string;
  private connected = false;
  private accessToken: string = "";
  private tokenExpiresAt: number = 0;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(config?: {
    corpId?: string;
    corpSecret?: string;
    agentId?: string;
    webhookUrl?: string;
  }) {
    this.corpId = config?.corpId ?? process.env["WECHAT_CORP_ID"] ?? "";
    this.corpSecret = config?.corpSecret ?? process.env["WECHAT_CORP_SECRET"] ?? "";
    this.agentId = config?.agentId ?? process.env["WECHAT_AGENT_ID"] ?? "";
    this.webhookUrl = config?.webhookUrl ?? process.env["WECHAT_WEBHOOK_URL"] ?? "";
  }

  async start(): Promise<void> {
    const hasWebhook = Boolean(this.webhookUrl);
    const hasApp = Boolean(this.corpId && this.corpSecret && this.agentId);

    if (!hasWebhook && !hasApp) {
      throw new Error(
        "WeChat requires either WECHAT_WEBHOOK_URL (group robot) or " +
          "WECHAT_CORP_ID + WECHAT_CORP_SECRET + WECHAT_AGENT_ID (app). " +
          "Register an app at https://work.weixin.qq.com",
      );
    }

    // For webhook-only mode there is nothing to verify — the webhook URL
    // is a signed, Tencent-hosted target and we only learn if it's valid
    // on first send. That's honest: we don't pretend to have authenticated.
    if (hasApp) {
      await this.refreshToken();
    }

    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
    this.accessToken = "";
    this.tokenExpiresAt = 0;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const chunks = splitMessage(message.content, WECHAT_MESSAGE_LIMIT);

      for (const chunk of chunks) {
        const delivered = this.webhookUrl
          ? await this.sendViaWebhook(chunk)
          : await this.sendViaApp(message.channelId, chunk);

        if (!delivered) return false;
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
   * Process a decrypted WeChat Work callback payload. Tencent posts these
   * to an operator-owned HTTPS endpoint; the hosting server forwards the
   * decrypted message XML-to-JSON here.
   */
  async handleCallback(payload: WeChatWorkCallbackPayload): Promise<void> {
    if (!this.messageHandler) return;
    if (payload.MsgType !== "text" || !payload.Content) return;

    // Skip echoes of our own agent id — WeChat Work emits outgoing app
    // messages back to the callback endpoint in some deployments.
    if (this.agentId && payload.FromUserName === this.agentId) return;

    const timestamp = payload.CreateTime ? new Date(Number(payload.CreateTime) * 1000) : new Date();

    const msg: IncomingMessage = {
      channelType: "wechat",
      channelId: payload.FromUserName,
      senderId: payload.FromUserName,
      senderName: payload.FromUserName,
      content: payload.Content,
      timestamp,
      replyTo: payload.MsgId ?? undefined,
    };

    await this.messageHandler(msg);
  }

  // ── Internal helpers ──────────────────────────────────────

  private async sendViaWebhook(content: string): Promise<boolean> {
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content },
      }),
    });

    if (!response.ok) return false;
    const data = (await response.json()) as WeChatSendResponse;
    return data.errcode === 0;
  }

  private async sendViaApp(touser: string, content: string): Promise<boolean> {
    await this.ensureValidToken();

    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${this.accessToken}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser,
        msgtype: "text",
        agentid: Number(this.agentId),
        text: { content },
      }),
    });

    if (!response.ok) return false;
    const data = (await response.json()) as WeChatSendResponse;
    return data.errcode === 0;
  }

  private async refreshToken(): Promise<void> {
    const params = new URLSearchParams({
      corpid: this.corpId,
      corpsecret: this.corpSecret,
    });
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error("Failed to authenticate with WeChat Work");
    }

    const data = (await response.json()) as WeChatTokenResponse;
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(
        `WeChat Work gettoken failed: ${data.errmsg ?? "unknown error"} (code ${data.errcode})`,
      );
    }

    this.accessToken = data.access_token;
    // Refresh 5 minutes before expiry to avoid mid-call stalls.
    const ttl = data.expires_in ?? 7200;
    this.tokenExpiresAt = Date.now() + (ttl - 300) * 1000;
  }

  private async ensureValidToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshToken();
    }
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
