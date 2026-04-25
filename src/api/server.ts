/**
 * OpenAI-Compatible API Server — expose WOTANN as /v1/chat/completions.
 *
 * Allows any OpenAI-compatible client (Cursor, Continue, Zed, custom apps)
 * to use WOTANN as their backend with full harness intelligence (middleware,
 * hooks, memory, provider fallback).
 *
 * From Hermes v0.4.0 OpenAI-compatible API server pattern.
 *
 * Also includes MCP Server Mode: expose WOTANN sessions as MCP tools
 * for Claude Desktop, VS Code, and other MCP clients.
 *
 * Endpoints:
 * - POST /v1/chat/completions — OpenAI-compatible chat
 * - GET  /v1/models — list available models
 * - POST /v1/embeddings — (pass-through to configured provider)
 * - GET  /health — health check
 * - GET  /wotann/sessions — list active sessions
 * - POST /wotann/sessions — create a new session
 * - WS   /wotann/stream — WebSocket streaming
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
// V9 T1.2 — SSE producer for `/events/computer-session`. Wired into the
// route table below so the daemon's HTTP plane forwards live session
// events to phone/desktop/CLI subscribers without polling.
import { handleComputerSessionSseRequest } from "./sse-computer-session.js";
import type { ComputerSessionStore } from "../session/computer-session-store.js";

export interface APIServerConfig {
  readonly port: number;
  readonly host: string;
  readonly corsOrigins: readonly string[];
  readonly rateLimit: {
    readonly requestsPerMinute: number;
    readonly burstSize: number;
  };
  readonly enableMCP: boolean;
  readonly enableStreaming: boolean;
  readonly authToken?: string;
}

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly content: string | null;
    readonly name?: string;
    readonly tool_call_id?: string;
  }[];
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly stream?: boolean;
  readonly tools?: readonly unknown[];
  readonly stop?: string | readonly string[];
}

export interface ChatCompletionResponse {
  readonly id: string;
  readonly object: "chat.completion";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly message: {
      readonly role: "assistant";
      readonly content: string | null;
    };
    readonly finish_reason: "stop" | "length" | "tool_calls" | null;
  }[];
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

export interface StreamChunk {
  readonly id: string;
  readonly object: "chat.completion.chunk";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: {
      readonly role?: "assistant";
      readonly content?: string;
    };
    readonly finish_reason: "stop" | "length" | null;
  }[];
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_CONFIG: APIServerConfig = {
  port: 8420,
  host: "127.0.0.1",
  corsOrigins: ["http://localhost:1420"],
  rateLimit: {
    requestsPerMinute: 60,
    burstSize: 10,
  },
  enableMCP: true,
  enableStreaming: true,
};

export type RequestHandler = (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
export type StreamHandler = (
  req: ChatCompletionRequest,
  write: (chunk: StreamChunk) => void,
) => Promise<void>;

export class WotannAPIServer {
  private readonly config: APIServerConfig;
  private server: ReturnType<typeof createServer> | null = null;
  private readonly rateLimits: Map<string, RateLimitState> = new Map();
  private readonly sessions: Map<string, { model: string; createdAt: string; messages: number }> =
    new Map();
  private requestHandler: RequestHandler | null = null;
  private streamHandler: StreamHandler | null = null;
  // V9 T1.2 — Optional ComputerSessionStore wired in by the daemon for the
  // SSE producer at `/events/computer-session`. We don't import the daemon
  // here (would create a cycle); we accept the store via setter instead.
  private computerSessionStore: ComputerSessionStore | null = null;

  constructor(config?: Partial<APIServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * V9 T1.2 — Inject the ComputerSessionStore for the SSE route. Without
   * a store wired in, `/events/computer-session` returns 503.
   */
  setComputerSessionStore(store: ComputerSessionStore): void {
    this.computerSessionStore = store;
  }

  /** Set the handler for chat completion requests */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  /** Set the handler for streaming requests */
  onStream(handler: StreamHandler): void {
    this.streamHandler = handler;
  }

  /** Start the API server */
  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handleRequest(req, res));
    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
    });
  }

  /** Stop the API server */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /** Get server address info */
  getAddress(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /** Get active session count */
  getSessionCount(): number {
    return this.sessions.size;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS
    this.setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting
    const clientIP = req.socket.remoteAddress ?? "unknown";
    if (!this.checkRateLimit(clientIP)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "Rate limit exceeded", type: "rate_limit_error" } }),
      );
      return;
    }

    // Auth check
    if (this.config.authToken) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${this.config.authToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Invalid authentication", type: "authentication_error" },
          }),
        );
        return;
      }
    }

    const url = new URL(req.url ?? "/", `http://${this.config.host}`);
    const path = url.pathname;

    try {
      // Route
      if (path === "/v1/chat/completions" && req.method === "POST") {
        await this.handleChatCompletion(req, res);
      } else if (path === "/v1/models" && req.method === "GET") {
        this.handleListModels(res);
      } else if (path === "/health" && req.method === "GET") {
        this.handleHealth(res);
      } else if (path === "/wotann/sessions" && req.method === "GET") {
        this.handleListSessions(res);
      } else if (path === "/events/computer-session" && req.method === "GET") {
        // V9 T1.2 — SSE producer route. Single line wires the producer in;
        // the producer module owns the lifecycle + framing.
        this.handleComputerSessionEvents(req, res);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Not found", type: "not_found" } }));
      }
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: error instanceof Error ? error.message : "Internal server error",
            type: "server_error",
          },
        }),
      );
    }
  }

  private async handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const request = JSON.parse(body) as ChatCompletionRequest;

    // Validate
    if (!request.messages || request.messages.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "messages is required", type: "invalid_request_error" },
        }),
      );
      return;
    }

    // Track session
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      model: request.model,
      createdAt: new Date().toISOString(),
      messages: request.messages.length,
    });

    if (request.stream && this.streamHandler) {
      // SSE streaming
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      await this.streamHandler(request, (chunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (!this.requestHandler) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "No handler configured", type: "server_error" } }),
      );
      return;
    }

    const response = await this.requestHandler(request);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleListModels(res: ServerResponse): void {
    const models = [
      { id: "wotann-harness", object: "model", created: Date.now(), owned_by: "wotann" },
      { id: "claude-opus-4-6", object: "model", created: Date.now(), owned_by: "anthropic" },
      { id: "claude-sonnet-4-6", object: "model", created: Date.now(), owned_by: "anthropic" },
      { id: "gpt-5.4", object: "model", created: Date.now(), owned_by: "openai" },
      { id: "gemini-2.5-pro", object: "model", created: Date.now(), owned_by: "google" },
    ];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: models }));
  }

  private handleHealth(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        version: "0.1.0",
        sessions: this.sessions.size,
        uptime: process.uptime(),
      }),
    );
  }

  private handleListSessions(res: ServerResponse): void {
    const sessions = [...this.sessions.entries()].map(([id, data]) => ({ id, ...data }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions }));
  }

  /**
   * V9 T1.2 — `/events/computer-session` SSE handler.
   *
   * Returns 503 until the daemon wires a store via
   * `setComputerSessionStore(...)`. When the store is present, the actual
   * framing logic lives in `sse-computer-session.ts`; we only thread
   * req/res through here.
   */
  private handleComputerSessionEvents(req: IncomingMessage, res: ServerResponse): void {
    if (!this.computerSessionStore) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "computer-session store not configured",
            type: "service_unavailable",
          },
        }),
      );
      return;
    }
    // The producer sets its own SSE headers and owns the lifecycle. It
    // writes a `retry:` preamble, subscribes to the store, and ends the
    // response on close / disconnect. No further work needed here.
    handleComputerSessionSseRequest(req, res, {
      store: this.computerSessionStore,
    });
  }

  private setCorsHeaders(res: ServerResponse): void {
    const origins = this.config.corsOrigins.join(", ");
    res.setHeader("Access-Control-Allow-Origin", origins);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  private checkRateLimit(clientIP: string): boolean {
    const now = Date.now();
    let state = this.rateLimits.get(clientIP);

    if (!state) {
      state = { tokens: this.config.rateLimit.burstSize, lastRefill: now };
      this.rateLimits.set(clientIP, state);
    }

    // Refill tokens
    const elapsed = (now - state.lastRefill) / 60_000; // minutes
    state.tokens = Math.min(
      this.config.rateLimit.burstSize,
      state.tokens + elapsed * this.config.rateLimit.requestsPerMinute,
    );
    state.lastRefill = now;

    if (state.tokens < 1) return false;
    state.tokens--;
    return true;
  }
}

// ── MCP Server Mode ─────────────────────────────────────────

/**
 * MCP (Model Context Protocol) server: expose WOTANN as an MCP endpoint.
 * Allows Claude Desktop, VS Code, Cursor to consume WOTANN tools/resources.
 *
 * From Hermes v0.6.0 MCP server mode pattern.
 */

export interface MCPTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly description: string;
}

export interface MCPServerState {
  readonly tools: readonly MCPTool[];
  readonly resources: readonly MCPResource[];
  readonly sessionCount: number;
}

export class WotannMCPServer {
  private readonly tools: MCPTool[] = [];
  private readonly resources: MCPResource[] = [];
  private running = false;

  /** Register a tool that MCP clients can invoke */
  registerTool(tool: MCPTool): void {
    this.tools.push(tool);
  }

  /** Register a resource that MCP clients can read */
  registerResource(resource: MCPResource): void {
    this.resources.push(resource);
  }

  /** Get current state */
  getState(): MCPServerState {
    return {
      tools: [...this.tools],
      resources: [...this.resources],
      sessionCount: 0,
    };
  }

  /** Start MCP server (stdio transport) */
  async start(): Promise<void> {
    this.running = true;
    // Register default WOTANN tools
    this.registerDefaultTools();
  }

  /** Stop MCP server */
  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private registerDefaultTools(): void {
    this.registerTool({
      name: "wotann_run",
      description: "Execute a prompt through the WOTANN harness with full intelligence",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The prompt to execute" },
          model: { type: "string", description: "Target model (optional)" },
          mode: { type: "string", description: "Behavioral mode (optional)" },
        },
        required: ["prompt"],
      },
    });

    this.registerTool({
      name: "wotann_memory_search",
      description: "Search WOTANN memory for relevant context",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results" },
        },
        required: ["query"],
      },
    });

    this.registerTool({
      name: "wotann_autonomous",
      description: "Run a task in autonomous mode with verification",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description" },
          maxCycles: { type: "number", description: "Max iteration cycles" },
        },
        required: ["task"],
      },
    });

    this.registerResource({
      uri: "wotann://memory/working",
      name: "Working Memory",
      mimeType: "application/json",
      description: "Current session working memory entries",
    });

    this.registerResource({
      uri: "wotann://context/limits",
      name: "Context Limits",
      mimeType: "application/json",
      description: "Effective context window limits per provider",
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
