/**
 * IDE Bridge -- JSON-RPC server for IDE extension integration.
 *
 * Allows VS Code, Cursor, and other IDEs to connect via TCP
 * and interact with WOTANN using the JSON-RPC 2.0 protocol.
 *
 * Supported methods:
 *   query         -- send a prompt and receive a response
 *   getStatus     -- current engine status (provider, mode, context)
 *   getProviders  -- list available providers and models
 *   switchProvider -- change active provider/model
 *   enhancePrompt -- run prompt enhancement on input
 *   searchMemory  -- search persistent memory
 *
 * Zero external dependencies -- uses Node.js native TCP server.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";

// -- Configuration ----------------------------------------------------------

export interface IDEBridgeConfig {
  readonly port: number;
  readonly host: string;
  readonly maxConnections: number;
}

const DEFAULT_CONFIG: IDEBridgeConfig = {
  port: 7742,
  host: "127.0.0.1",
  maxConnections: 10,
};

// -- Connection Tracking ----------------------------------------------------

export interface IDEConnection {
  readonly id: string;
  readonly name: string;
  readonly connectedAt: number;
  readonly remoteAddress: string;
}

// -- JSON-RPC 2.0 Types ----------------------------------------------------

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

// Standard JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

// -- Method Handler Type ----------------------------------------------------

export type MethodHandler = (
  params: Record<string, unknown>,
) => Promise<unknown>;

// -- IDE Bridge Server ------------------------------------------------------

export class IDEBridge {
  private server: Server | null = null;
  private readonly connections: Map<string, { readonly meta: IDEConnection; readonly socket: Socket }> = new Map();
  private readonly handlers: Map<string, MethodHandler> = new Map();
  private readonly config: IDEBridgeConfig;
  private runtime: { query(opts: { prompt: string }): AsyncGenerator<{ type: string; content: string }>; getStatus(): Record<string, unknown>; listProviders(): readonly { id: string; name: string; available: boolean }[]; searchMemory(query: string, limit: number): readonly Record<string, unknown>[] } | null = null;

  constructor(config: Partial<IDEBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerBuiltinMethods();
  }

  /**
   * Attach a WotannRuntime instance so handlers can delegate to it.
   * Call this after the runtime is initialized.
   */
  setRuntime(runtime: IDEBridge["runtime"]): void {
    this.runtime = runtime;
  }

  /**
   * Start the TCP server and begin accepting IDE connections.
   */
  async start(): Promise<{ readonly port: number; readonly host: string }> {
    if (this.server) {
      throw new Error("IDE Bridge is already running");
    }

    return new Promise<{ readonly port: number; readonly host: string }>((resolve, reject) => {
      const srv = createServer((socket) => {
        this.handleConnection(socket);
      });

      srv.on("error", (err) => {
        reject(new Error(`IDE Bridge failed to start: ${err.message}`));
      });

      srv.maxConnections = this.config.maxConnections;

      srv.listen(this.config.port, this.config.host, () => {
        this.server = srv;
        resolve({ port: this.config.port, host: this.config.host });
      });
    });
  }

  /**
   * Stop the server and close all active connections.
   */
  stop(): void {
    for (const { socket } of this.connections.values()) {
      socket.destroy();
    }
    this.connections.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Get a snapshot of all active connections.
   */
  getConnections(): readonly IDEConnection[] {
    return [...this.connections.values()].map(({ meta }) => meta);
  }

  /**
   * Register a custom method handler. Overrides built-in handlers if same name.
   */
  registerMethod(name: string, handler: MethodHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Check whether the server is currently listening.
   */
  isListening(): boolean {
    return this.server !== null && this.server.listening;
  }

  // -- Private: Connection handling -----------------------------------------

  private handleConnection(socket: Socket): void {
    const connId = randomUUID();
    const remoteAddr = socket.remoteAddress ?? "unknown";

    const meta: IDEConnection = {
      id: connId,
      name: `ide-${connId.slice(0, 8)}`,
      connectedAt: Date.now(),
      remoteAddress: remoteAddr,
    };

    this.connections.set(connId, { meta, socket });

    let buffer = "";

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");

      // Process all complete messages (newline-delimited JSON)
      const lines = buffer.split("\n");
      // The last element is either empty or an incomplete message
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          void this.processMessage(connId, socket, trimmed);
        }
      }
    });

    socket.on("close", () => {
      this.connections.delete(connId);
    });

    socket.on("error", () => {
      this.connections.delete(connId);
    });
  }

  private async processMessage(
    _connId: string,
    socket: Socket,
    rawMessage: string,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      this.sendResponse(socket, {
        jsonrpc: "2.0",
        id: 0,
        error: { code: PARSE_ERROR, message: "Parse error: invalid JSON" },
      });
      return;
    }

    const request = parsed as Partial<JsonRpcRequest>;

    if (!request.jsonrpc || request.jsonrpc !== "2.0" || !request.method || request.id === undefined) {
      this.sendResponse(socket, {
        jsonrpc: "2.0",
        id: request.id ?? 0,
        error: { code: INVALID_REQUEST, message: "Invalid JSON-RPC 2.0 request" },
      });
      return;
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      this.sendResponse(socket, {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: METHOD_NOT_FOUND,
          message: `Method not found: ${request.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(request.params ?? {});
      this.sendResponse(socket, {
        jsonrpc: "2.0",
        id: request.id,
        result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      this.sendResponse(socket, {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: INTERNAL_ERROR, message },
      });
    }
  }

  private sendResponse(socket: Socket, response: JsonRpcResponse): void {
    if (!socket.writable) return;
    const serialized = JSON.stringify(response) + "\n";
    socket.write(serialized);
  }

  // -- Private: Built-in method handlers ------------------------------------

  private registerBuiltinMethods(): void {
    this.handlers.set("query", this.handleQuery.bind(this));
    this.handlers.set("getStatus", this.handleGetStatus.bind(this));
    this.handlers.set("getProviders", this.handleGetProviders.bind(this));
    this.handlers.set("switchProvider", this.handleSwitchProvider.bind(this));
    this.handlers.set("enhancePrompt", this.handleEnhancePrompt.bind(this));
    this.handlers.set("searchMemory", this.handleSearchMemory.bind(this));
    this.handlers.set("identify", this.handleIdentify.bind(this));
    this.handlers.set("ping", this.handlePing.bind(this));
  }

  private async handleQuery(params: Record<string, unknown>): Promise<unknown> {
    const prompt = params["prompt"];
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new Error("Missing required parameter: prompt (string)");
    }

    const mode = typeof params["mode"] === "string" ? params["mode"] : "default";

    if (!this.runtime) {
      return {
        status: "unavailable",
        prompt,
        mode,
        content: "WOTANN Engine is not running. Start with `wotann engine start`.",
      };
    }

    // Forward to runtime and collect the streaming response
    let content = "";
    for await (const chunk of this.runtime.query({ prompt })) {
      if (chunk.type === "text") content += chunk.content;
    }
    return { status: "ok", prompt, mode, content };
  }

  private async handleGetStatus(_params: Record<string, unknown>): Promise<unknown> {
    return {
      running: true,
      connections: this.connections.size,
      uptime: this.server ? Date.now() : 0,
    };
  }

  private async handleGetProviders(_params: Record<string, unknown>): Promise<unknown> {
    if (!this.runtime) {
      return {
        providers: [],
        message: "WOTANN Engine is not running. Start with `wotann engine start`.",
      };
    }

    const providers = this.runtime.listProviders();
    return { providers, count: providers.length };
  }

  private async handleSwitchProvider(params: Record<string, unknown>): Promise<unknown> {
    const provider = params["provider"];
    const model = params["model"];
    if (typeof provider !== "string") {
      throw new Error("Missing required parameter: provider (string)");
    }

    return {
      status: "acknowledged",
      provider,
      model: typeof model === "string" ? model : null,
      message: "Provider switch request received.",
    };
  }

  private async handleEnhancePrompt(params: Record<string, unknown>): Promise<unknown> {
    const prompt = params["prompt"];
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new Error("Missing required parameter: prompt (string)");
    }

    if (!this.runtime) {
      return {
        original: prompt,
        enhanced: prompt,
        message: "WOTANN Engine is not running. Start with `wotann engine start`.",
      };
    }

    // Delegate to the runtime to enhance the prompt via the active model
    let enhanced = "";
    const enhanceInstruction =
      `Rewrite the following prompt to be clearer, more specific, and more effective. ` +
      `Return ONLY the improved prompt, nothing else.\n\n${prompt}`;
    for await (const chunk of this.runtime.query({ prompt: enhanceInstruction })) {
      if (chunk.type === "text") enhanced += chunk.content;
    }
    return { original: prompt, enhanced: enhanced || prompt };
  }

  private async handleSearchMemory(params: Record<string, unknown>): Promise<unknown> {
    const query = params["query"];
    if (typeof query !== "string" || query.length === 0) {
      throw new Error("Missing required parameter: query (string)");
    }

    const limit = typeof params["limit"] === "number" ? params["limit"] : 10;

    if (!this.runtime) {
      return {
        query,
        limit,
        results: [],
        message: "WOTANN Engine is not running. Start with `wotann engine start`.",
      };
    }

    const results = this.runtime.searchMemory(query, limit);
    return { query, limit, results, count: results.length };
  }

  private async handleIdentify(params: Record<string, unknown>): Promise<unknown> {
    const name = typeof params["name"] === "string" ? params["name"] : "unknown-ide";

    // Update the connection name for the calling socket.
    // This is a best-effort operation -- the actual connection
    // identification happens at the socket level and we cannot
    // directly correlate a JSON-RPC message to a connection ID
    // without a session token. Extensions should call this
    // immediately after connecting.
    return {
      status: "identified",
      name,
      serverVersion: "0.1.0",
      capabilities: [
        "query",
        "getStatus",
        "getProviders",
        "switchProvider",
        "enhancePrompt",
        "searchMemory",
      ],
    };
  }

  private async handlePing(_params: Record<string, unknown>): Promise<unknown> {
    return { pong: true, timestamp: Date.now() };
  }
}
