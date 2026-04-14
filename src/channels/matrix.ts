/**
 * Matrix/Element channel adapter.
 *
 * ZERO-DEPENDENCY: Uses fetch() against the Matrix Client-Server API.
 * No need for the matrix-js-sdk npm package.
 *
 * Setup:
 * 1. Create a Matrix account or use an existing homeserver
 * 2. Get an access token (e.g., via Element settings > Help > Access Token)
 * 3. Set MATRIX_HOMESERVER_URL and MATRIX_ACCESS_TOKEN
 *
 * Uses long-polling /sync for real-time message delivery.
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage, ChannelType } from "./adapter.js";

// ── Types ──────────────────────────────────────────────────

interface MatrixSyncResponse {
  readonly next_batch: string;
  readonly rooms?: {
    readonly join?: Readonly<Record<string, MatrixJoinedRoom>>;
  };
}

interface MatrixJoinedRoom {
  readonly timeline?: {
    readonly events?: readonly MatrixEvent[];
  };
}

interface MatrixEvent {
  readonly event_id: string;
  readonly type: string;
  readonly sender: string;
  readonly origin_server_ts: number;
  readonly content?: {
    readonly msgtype?: string;
    readonly body?: string;
  };
}

interface MatrixWhoAmI {
  readonly user_id: string;
}

// ── Matrix Adapter ─────────────────────────────────────────

export class MatrixAdapter implements ChannelAdapter {
  readonly type: ChannelType = "matrix";
  readonly name = "Matrix/Element";

  private readonly homeserverUrl: string;
  private readonly accessToken: string;
  private connected = false;
  private syncing = false;
  private syncBatch: string = "";
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private userId: string = "";
  private syncAbortController: AbortController | null = null;

  constructor(homeserverUrl?: string, accessToken?: string) {
    this.homeserverUrl = normalizeUrl(
      homeserverUrl ?? process.env["MATRIX_HOMESERVER_URL"] ?? "",
    );
    this.accessToken = accessToken ?? process.env["MATRIX_ACCESS_TOKEN"] ?? "";
  }

  async start(): Promise<void> {
    if (!this.homeserverUrl || !this.accessToken) {
      throw new Error(
        "MATRIX_HOMESERVER_URL and MATRIX_ACCESS_TOKEN required. "
        + "Get an access token from Element settings.",
      );
    }

    // Verify credentials
    const whoami = await this.matrixGet<MatrixWhoAmI>("/_matrix/client/v3/account/whoami");
    this.userId = whoami.user_id;

    this.connected = true;
    this.syncing = true;
    this.startSync();
  }

  async stop(): Promise<void> {
    this.syncing = false;
    this.connected = false;
    this.syncAbortController?.abort();
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const txnId = `m${Date.now()}`;
      const endpoint = `/_matrix/client/v3/rooms/${encodeURIComponent(message.channelId)}/send/m.room.message/${txnId}`;

      const body = {
        msgtype: "m.text",
        body: message.content,
        format: message.format === "html" ? "org.matrix.custom.html" : undefined,
        formatted_body: message.format === "html" ? message.content : undefined,
      };

      const response = await fetch(`${this.homeserverUrl}${endpoint}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      return response.ok;
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

  // ── Long-Polling Sync ────────────────────────────────────

  private async startSync(): Promise<void> {
    while (this.syncing) {
      try {
        this.syncAbortController = new AbortController();
        const timeout = setTimeout(() => this.syncAbortController?.abort(), 35_000);

        const params = new URLSearchParams({
          timeout: "30000",
          filter: JSON.stringify({ room: { timeline: { limit: 10 } } }),
        });

        if (this.syncBatch) {
          params.set("since", this.syncBatch);
        }

        const response = await fetch(
          `${this.homeserverUrl}/_matrix/client/v3/sync?${params}`,
          {
            headers: { "Authorization": `Bearer ${this.accessToken}` },
            signal: this.syncAbortController.signal,
          },
        );
        clearTimeout(timeout);

        if (!response.ok) {
          await delay(5000);
          continue;
        }

        const data = (await response.json()) as MatrixSyncResponse;
        this.syncBatch = data.next_batch;

        if (data.rooms?.join) {
          for (const [roomId, room] of Object.entries(data.rooms.join)) {
            await this.processRoomEvents(roomId, room);
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          continue;
        }
        await delay(5000);
      }
    }
  }

  private async processRoomEvents(roomId: string, room: MatrixJoinedRoom): Promise<void> {
    if (!room.timeline?.events || !this.messageHandler) return;

    for (const event of room.timeline.events) {
      // Skip non-message events
      if (event.type !== "m.room.message") continue;
      if (event.content?.msgtype !== "m.text") continue;
      if (!event.content.body) continue;

      // Skip own messages
      if (event.sender === this.userId) continue;

      const msg: IncomingMessage = {
        channelType: "matrix",
        channelId: roomId,
        senderId: event.sender,
        senderName: event.sender.split(":")[0]?.slice(1) ?? event.sender,
        content: event.content.body,
        timestamp: new Date(event.origin_server_ts),
        replyTo: event.event_id,
      };

      await this.messageHandler(msg);
    }
  }

  // ── HTTP Helpers ─────────────────────────────────────────

  private async matrixGet<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.homeserverUrl}${endpoint}`, {
      headers: { "Authorization": `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Matrix API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

// ── Helpers ────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
