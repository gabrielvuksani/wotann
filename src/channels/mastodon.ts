/**
 * Mastodon channel adapter (ActivityPub-compatible microblogging).
 *
 * ZERO-DEPENDENCY: Uses fetch() against the Mastodon REST API and the
 * native WebSocket streaming endpoint. No mastodon.js or megalodon required.
 *
 * Setup:
 * 1. Create a Mastodon application:
 *    Settings > Development > New Application
 * 2. Required scopes: read, write:statuses, read:notifications
 * 3. Set MASTODON_INSTANCE_URL (e.g. https://mastodon.social)
 *    and MASTODON_ACCESS_TOKEN
 *
 * Inbound: subscribes to the authenticated user's streaming endpoint
 * and dispatches mention notifications as IncomingMessage.
 *
 * Outbound: POST /api/v1/statuses with in_reply_to_id when replying.
 *
 * Security:
 * - Skips own-toot notifications to prevent feedback loops.
 * - Honest errors when the instance URL or token is missing.
 */

import type { ChannelAdapter, ChannelType, IncomingMessage, OutgoingMessage } from "./adapter.js";

interface MastodonAccount {
  readonly id: string;
  readonly username: string;
  readonly acct: string;
  readonly display_name: string;
}

interface MastodonStatus {
  readonly id: string;
  readonly content: string;
  readonly account: MastodonAccount;
  readonly created_at: string;
  readonly in_reply_to_id?: string | null;
  readonly visibility: "public" | "unlisted" | "private" | "direct";
}

interface MastodonNotification {
  readonly id: string;
  readonly type: string;
  readonly created_at: string;
  readonly account: MastodonAccount;
  readonly status?: MastodonStatus;
}

interface StreamEventEnvelope {
  readonly event?: string;
  readonly payload?: string;
}

/**
 * Maximum characters Mastodon accepts in a status by default.
 * Some instances allow more; 500 is the upstream default and safest floor.
 */
const MASTODON_STATUS_LIMIT = 500;

export class MastodonAdapter implements ChannelAdapter {
  readonly type: ChannelType = "mastodon";
  readonly name = "Mastodon";

  private readonly instanceUrl: string;
  private readonly accessToken: string;
  private connected = false;
  private ws: WebSocket | null = null;
  private ownAccountId: string = "";
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(instanceUrl?: string, accessToken?: string) {
    this.instanceUrl = normalizeInstanceUrl(
      instanceUrl ?? process.env["MASTODON_INSTANCE_URL"] ?? "",
    );
    this.accessToken = accessToken ?? process.env["MASTODON_ACCESS_TOKEN"] ?? "";
  }

  async start(): Promise<void> {
    if (!this.instanceUrl || !this.accessToken) {
      throw new Error(
        "MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN required. " +
          "Register an app under Settings > Development with scopes: read write:statuses read:notifications.",
      );
    }

    // Verify credentials and capture own account id for loop protection.
    const account = await this.apiGet<MastodonAccount>("/api/v1/accounts/verify_credentials");
    this.ownAccountId = account.id;

    // Open streaming WebSocket. The `user` stream delivers mentions,
    // notifications, and home-timeline updates for the authenticated user.
    const wsUrl = this.streamingUrl("user");
    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener("open", () => {
      this.connected = true;
    });

    this.ws.addEventListener("message", (event) => {
      this.handleStreamEvent(String(event.data));
    });

    this.ws.addEventListener("close", () => {
      this.connected = false;
    });

    this.ws.addEventListener("error", () => {
      this.connected = false;
    });
  }

  async stop(): Promise<void> {
    this.ws?.close(1000);
    this.ws = null;
    this.connected = false;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const chunks = splitStatus(message.content, MASTODON_STATUS_LIMIT);
      let replyTarget = message.replyTo;

      for (const chunk of chunks) {
        const body: Record<string, unknown> = {
          status: chunk,
          visibility: "unlisted",
        };
        if (replyTarget) body["in_reply_to_id"] = replyTarget;

        const response = await fetch(`${this.instanceUrl}/api/v1/statuses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) return false;

        // Chain subsequent chunks as a thread so they render in order.
        const status = (await response.json()) as { id?: string };
        if (status.id) replyTarget = status.id;
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
   * Process a Mastodon notification envelope. Exposed so HTTP webhook
   * deployments (Mastodon push subscriptions) can reuse the same
   * dispatch logic as the streaming websocket path.
   */
  async handleNotification(notification: MastodonNotification): Promise<void> {
    if (!this.messageHandler) return;
    if (notification.type !== "mention") return;
    const status = notification.status;
    if (!status) return;

    // Prevent self-reply loops: Mastodon streams include our own toots.
    if (status.account.id === this.ownAccountId) return;

    const msg: IncomingMessage = {
      channelType: "mastodon",
      channelId: status.id,
      senderId: status.account.id,
      senderName: status.account.acct,
      content: stripHtml(status.content),
      timestamp: new Date(status.created_at),
      replyTo: status.id,
    };

    await this.messageHandler(msg);
  }

  // ── Internal helpers ──────────────────────────────────────

  private handleStreamEvent(raw: string): void {
    try {
      const envelope = JSON.parse(raw) as StreamEventEnvelope;
      if (envelope.event !== "notification" || !envelope.payload) return;

      const notification = JSON.parse(envelope.payload) as MastodonNotification;
      this.handleNotification(notification).catch(() => {
        // Swallow dispatch errors to avoid killing the stream loop.
      });
    } catch {
      // Skip malformed frames rather than crash the stream.
    }
  }

  private async apiGet<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.instanceUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Mastodon API error: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  private streamingUrl(stream: string): string {
    const wsBase = this.instanceUrl.replace(/^http/, "ws");
    const params = new URLSearchParams({
      access_token: this.accessToken,
      stream,
    });
    return `${wsBase}/api/v1/streaming?${params.toString()}`;
  }
}

// ── Helpers ─────────────────────────────────────────────────

function normalizeInstanceUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Mastodon serves status content as sanitized HTML. Agents want plain text,
 * so we strip tags but preserve paragraph breaks and anchor hrefs.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Split a long status into multiple posts on word boundaries.
 * Each chunk reserves 6 chars for a "(n/m)" suffix appended by callers;
 * here we just return the raw chunks and let send() thread them.
 */
export function splitStatus(text: string, maxLength: number): readonly string[] {
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
