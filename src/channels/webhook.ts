/**
 * Generic Webhook channel adapter.
 * Receives inbound messages via HTTP POST and sends outbound via configurable URLs.
 * Zero external dependencies — uses Node.js native HTTP server.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { ChannelAdapter, ChannelMessage, ChannelType } from "./gateway.js";

export interface WebhookConfig {
  readonly port: number;
  readonly host: string;
  readonly path: string;
  readonly outboundUrl?: string;
  readonly secret?: string;
}

const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  port: 7891,
  host: "127.0.0.1",
  path: "/wotann/webhook",
};

export class WebhookAdapter implements ChannelAdapter {
  readonly type: ChannelType = "webhook";
  readonly name = "Generic Webhook (HTTP)";
  connected = false;
  private readonly webhookConfig: WebhookConfig;
  private messageHandlers: Array<(message: ChannelMessage) => void> = [];
  private server: Server | null = null;

  constructor(config?: Partial<WebhookConfig>) {
    this.webhookConfig = { ...DEFAULT_WEBHOOK_CONFIG, ...config };
  }

  async connect(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on("error", () => {
        this.connected = false;
        resolve(false);
      });

      this.server.listen(this.webhookConfig.port, this.webhookConfig.host, () => {
        this.connected = true;
        resolve(true);
      });
    });
  }

  async disconnect(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.connected = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async send(channelId: string, content: string, _replyTo?: string): Promise<boolean> {
    const url = this.webhookConfig.outboundUrl ?? channelId;
    if (!url || url === "broadcast" || url === "forward" || url === "cross-channel") return true;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          channelId,
          timestamp: Date.now(),
          source: "wotann",
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  onMessage(handler: (message: ChannelMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only accept POST to the configured path
    if (req.method !== "POST" || req.url !== this.webhookConfig.path) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Validate secret if configured (timing-safe comparison to prevent timing attacks)
    if (this.webhookConfig.secret) {
      const authHeader = req.headers["authorization"] ?? "";
      const expected = `Bearer ${this.webhookConfig.secret}`;
      const authBuf = Buffer.from(authHeader);
      const expectedBuf = Buffer.from(expected);
      const ok = authBuf.length === expectedBuf.length && timingSafeEqual(authBuf, expectedBuf);
      if (!ok) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        content?: string;
        senderId?: string;
        senderName?: string;
        channelId?: string;
        metadata?: Record<string, unknown>;
      };

      if (!body.content) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing content field" }));
        return;
      }

      const message: ChannelMessage = {
        id: randomUUID(),
        channelType: "webhook",
        channelId: body.channelId ?? "webhook",
        senderId: body.senderId ?? "webhook-sender",
        senderName: body.senderName,
        content: body.content,
        timestamp: Date.now(),
        metadata: body.metadata,
      };

      for (const handler of this.messageHandlers) {
        handler(message);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, messageId: message.id }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
    }
  }
}
