/**
 * WebChat channel adapter — HTTP/SSE-based chat interface.
 *
 * Provides a lightweight web chat endpoint that any browser can connect to.
 * Uses Server-Sent Events (SSE) for streaming responses.
 *
 * ENDPOINTS:
 * - POST /api/chat — send a message, get streaming response via SSE
 * - GET  /api/chat/stream — SSE stream for ongoing responses
 * - GET  /api/status — health check and session info
 *
 * This makes WOTANN accessible from any web browser without installing anything.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { ChannelAdapter, ChannelMessage } from "./gateway.js";

export interface WebChatConfig {
  readonly port: number;
  readonly host: string;
  readonly corsOrigin: string;
  readonly maxMessageLength: number;
  readonly sessionTimeout: number;
}

const DEFAULT_CONFIG: WebChatConfig = {
  port: 3847,
  host: "127.0.0.1",
  corsOrigin: "http://localhost:1420",
  maxMessageLength: 100_000,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
};

interface SSEClient {
  readonly id: string;
  readonly res: ServerResponse;
  readonly connectedAt: number;
}

export class WebChatAdapter implements ChannelAdapter {
  readonly type = "webchat" as const;
  readonly name = "WebChat (HTTP/SSE)";
  connected = false;

  private config: WebChatConfig;
  private server: ReturnType<typeof createServer> | null = null;
  private messageHandler: ((message: ChannelMessage) => void) | null = null;
  private sseClients: Map<string, SSEClient> = new Map();
  private pendingResponses: Map<string, (content: string) => void> = new Map();
  private listeningPort: number;

  constructor(config?: Partial<WebChatConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.listeningPort = this.config.port;
  }

  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", () => {
        this.connected = false;
        resolve(false);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.connected = true;
        const address = this.server?.address();
        if (address && typeof address === "object") {
          this.listeningPort = address.port;
        }
        resolve(true);
      });
    });
  }

  async disconnect(): Promise<void> {
    // Close all SSE connections
    for (const client of this.sseClients.values()) {
      client.res.end();
    }
    this.sseClients.clear();

    return new Promise((resolve) => {
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

  async send(channelId: string, content: string, replyTo?: string): Promise<boolean> {
    // Send to specific SSE client
    const client = this.sseClients.get(channelId);
    if (client) {
      const data = JSON.stringify({ type: "message", content, replyTo, timestamp: Date.now() });
      client.res.write(`data: ${data}\n\n`);
      return true;
    }

    // Check for pending response resolver
    const resolver = replyTo ? this.pendingResponses.get(replyTo) : undefined;
    if (resolver) {
      resolver(content);
      this.pendingResponses.delete(replyTo!);
      return true;
    }

    // Broadcast to all SSE clients as fallback
    let sent = false;
    for (const c of this.sseClients.values()) {
      const data = JSON.stringify({ type: "message", content, replyTo, timestamp: Date.now() });
      c.res.write(`data: ${data}\n\n`);
      sent = true;
    }
    return sent;
  }

  onMessage(handler: (message: ChannelMessage) => void): void {
    this.messageHandler = handler;
  }

  getPort(): number { return this.listeningPort; }
  getClientCount(): number { return this.sseClients.size; }

  // ── HTTP Request Handler ───────────────────────────────────

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", this.config.corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? "/";

    if (req.method === "POST" && url === "/api/chat") {
      this.handleChatMessage(req, res);
    } else if (req.method === "GET" && url.startsWith("/api/chat/stream")) {
      this.handleSSEConnection(req, res);
    } else if (req.method === "GET" && url === "/api/status") {
      this.handleStatus(res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }

  private handleChatMessage(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > this.config.maxMessageLength) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Message too large" }));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as { message?: string; senderId?: string };
        const content = parsed.message ?? "";
        if (!content.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Empty message" }));
          return;
        }

        const messageId = randomUUID();
        const message: ChannelMessage = {
          id: messageId,
          channelType: "webchat",
          channelId: "webchat-default",
          senderId: parsed.senderId ?? "webchat-user",
          content,
          timestamp: Date.now(),
        };

        // Create a promise that resolves when the response is ready
        const responsePromise = new Promise<string>((resolve) => {
          this.pendingResponses.set(messageId, resolve);
          // Timeout after 60 seconds
          setTimeout(() => {
            if (this.pendingResponses.has(messageId)) {
              this.pendingResponses.delete(messageId);
              resolve("Request timed out");
            }
          }, 60_000);
        });

        // Send to message handler
        if (this.messageHandler) {
          this.messageHandler(message);
        }

        // Wait for response and send back
        void responsePromise.then((response) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: messageId, response, timestamp: Date.now() }));
        });
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  }

  private handleSSEConnection(_req: IncomingMessage, res: ServerResponse): void {
    const clientId = randomUUID();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Send connected event
    res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

    this.sseClients.set(clientId, { id: clientId, res, connectedAt: Date.now() });

    // Clean up on disconnect
    res.on("close", () => {
      this.sseClients.delete(clientId);
    });

    // Keep alive ping every 30 seconds
    const keepAlive = setInterval(() => {
      if (this.sseClients.has(clientId)) {
        res.write(":keepalive\n\n");
      } else {
        clearInterval(keepAlive);
      }
    }, 30_000);
  }

  private handleStatus(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      connected: this.connected,
      clients: this.sseClients.size,
      port: this.listeningPort,
      uptime: Date.now(),
    }));
  }
}
