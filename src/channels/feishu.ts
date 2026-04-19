/**
 * Feishu / Lark channel adapter (open.feishu.cn / open.larksuite.com).
 *
 * Feishu ("飞书") is ByteDance's enterprise collaboration suite and Lark is
 * its international brand. Both speak the same Open Platform API, so a
 * single adapter covers both domains by switching the base URL via
 * FEISHU_DOMAIN (defaults to the mainland-China `feishu.cn` host; set to
 * `larksuite.com` for international tenants).
 *
 * ZERO-DEPENDENCY: Uses fetch() against the Feishu Open Platform API.
 *
 * Setup:
 * 1. Create an app at https://open.feishu.cn/app (or larksuite.com/app)
 * 2. Enable "Bot" capability; grant `im:message` and `im:message.group_at_msg`
 *    permissions.
 * 3. Publish the app to your tenant.
 * 4. Set FEISHU_APP_ID, FEISHU_APP_SECRET, and optionally FEISHU_DOMAIN.
 *
 * Inbound: Feishu POSTs signed JSON events to the configured webhook URL.
 * The hosting server decodes the envelope (optionally decrypting when
 * encryption is enabled) and forwards it to `handleEvent()`.
 *
 * Outbound: acquire a tenant access token via /auth/v3/tenant_access_token/internal,
 * then POST to /im/v1/messages with receive_id_type=chat_id|user_id|open_id.
 */

import type { ChannelAdapter, ChannelType, IncomingMessage, OutgoingMessage } from "./adapter.js";

export interface FeishuEventEnvelope {
  readonly schema?: string;
  readonly header?: {
    readonly event_type?: string;
    readonly event_id?: string;
    readonly create_time?: string;
    readonly tenant_key?: string;
  };
  readonly event?: {
    readonly sender?: {
      readonly sender_id?: {
        readonly open_id?: string;
        readonly user_id?: string;
      };
      readonly sender_type?: string;
    };
    readonly message?: {
      readonly message_id?: string;
      readonly chat_id?: string;
      readonly message_type?: string;
      readonly content?: string; // JSON-encoded per Feishu spec.
      readonly create_time?: string;
    };
  };
}

interface FeishuTokenResponse {
  readonly code: number;
  readonly msg?: string;
  readonly tenant_access_token?: string;
  readonly expire?: number;
}

interface FeishuSendResponse {
  readonly code: number;
  readonly msg?: string;
  readonly data?: { readonly message_id?: string };
}

/**
 * Feishu text messages cap at 30KB, but the Open Platform recommends 4000
 * visible chars to keep mobile rendering reasonable.
 */
const FEISHU_MESSAGE_LIMIT = 4000;

export class FeishuAdapter implements ChannelAdapter {
  readonly type: ChannelType = "feishu";
  readonly name = "Feishu";

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly apiBase: string;
  private connected = false;
  private accessToken: string = "";
  private tokenExpiresAt: number = 0;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(appId?: string, appSecret?: string, domain?: string) {
    this.appId = appId ?? process.env["FEISHU_APP_ID"] ?? "";
    this.appSecret = appSecret ?? process.env["FEISHU_APP_SECRET"] ?? "";
    const chosenDomain = domain ?? process.env["FEISHU_DOMAIN"] ?? "feishu.cn";
    this.apiBase = `https://open.${chosenDomain}/open-apis`;
  }

  async start(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      throw new Error(
        "FEISHU_APP_ID and FEISHU_APP_SECRET required. " +
          "Create an app at https://open.feishu.cn/app and enable the bot capability.",
      );
    }

    await this.refreshToken();
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
      await this.ensureValidToken();
      const chunks = splitMessage(message.content, FEISHU_MESSAGE_LIMIT);

      // Feishu needs to know whether the receiver id is a chat_id / open_id / user_id.
      // We auto-classify based on prefix to avoid forcing callers to pass hints.
      const receiveIdType = classifyReceiveIdType(message.channelId);
      const url = `${this.apiBase}/im/v1/messages?receive_id_type=${receiveIdType}`;

      for (const chunk of chunks) {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            receive_id: message.channelId,
            msg_type: "text",
            content: JSON.stringify({ text: chunk }),
          }),
        });

        if (!response.ok) return false;
        const data = (await response.json()) as FeishuSendResponse;
        if (data.code !== 0) return false;
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
   * Process a decoded Feishu event envelope. The hosting server is
   * responsible for HMAC verification and decryption (when enabled), then
   * forwards the parsed JSON here.
   */
  async handleEvent(envelope: FeishuEventEnvelope): Promise<void> {
    if (!this.messageHandler) return;
    if (envelope.header?.event_type !== "im.message.receive_v1") return;

    const ev = envelope.event;
    if (!ev?.message || !ev.sender) return;
    if (ev.message.message_type !== "text") return;

    const content = parseTextContent(ev.message.content);
    if (!content) return;

    const channelId = ev.message.chat_id ?? ev.sender.sender_id?.open_id ?? "";
    const senderId = ev.sender.sender_id?.open_id ?? ev.sender.sender_id?.user_id ?? channelId;
    if (!channelId || !senderId) return;

    const msg: IncomingMessage = {
      channelType: "feishu",
      channelId,
      senderId,
      senderName: senderId,
      content,
      timestamp: new Date(Number(ev.message.create_time ?? Date.now())),
      replyTo: ev.message.message_id ?? undefined,
    };

    await this.messageHandler(msg);
  }

  // ── Internal helpers ──────────────────────────────────────

  private async refreshToken(): Promise<void> {
    const response = await fetch(`${this.apiBase}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to authenticate with Feishu/Lark");
    }

    const data = (await response.json()) as FeishuTokenResponse;
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu token fetch failed: ${data.msg ?? "unknown"} (code ${data.code})`);
    }

    this.accessToken = data.tenant_access_token;
    const ttl = data.expire ?? 7200;
    // Refresh 5 minutes before expiry.
    this.tokenExpiresAt = Date.now() + Math.max(60, ttl - 300) * 1000;
  }

  private async ensureValidToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshToken();
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Classify a Feishu receiver id by prefix.
 * - `oc_*` -> chat_id (group chat)
 * - `ou_*` -> open_id (user, per-app identifier)
 * - `on_*` -> union_id
 * - otherwise -> user_id (tenant-specific)
 */
export function classifyReceiveIdType(
  receiverId: string,
): "chat_id" | "open_id" | "union_id" | "user_id" {
  if (receiverId.startsWith("oc_")) return "chat_id";
  if (receiverId.startsWith("ou_")) return "open_id";
  if (receiverId.startsWith("on_")) return "union_id";
  return "user_id";
}

/**
 * Feishu wraps text message content in a JSON string: `{"text": "hello"}`.
 * We parse it defensively and return undefined on malformed inputs rather
 * than crashing the dispatch loop.
 */
function parseTextContent(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return typeof parsed.text === "string" ? parsed.text : undefined;
  } catch {
    return undefined;
  }
}

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
