/**
 * ACP server dispatcher (C16).
 *
 * Pure message-routing layer over the codec in protocol.ts. Callers
 * register handlers for the ACP methods their runtime implements and
 * the dispatcher produces JsonRpcResponse / JsonRpcNotification
 * objects that can be written to stdout (or any duplex stream).
 *
 * Keeping this free of I/O lets tests drive the dispatcher directly
 * with strings + assertions; the actual stdio wiring is a thin
 * wrapper left for the main entry point.
 */

import {
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  JSON_RPC_ERROR_CODES,
  decodeJsonRpc,
  encodeJsonRpc,
  isDecodedMessage,
  makeError,
  makeNotification,
  makeResponse,
  type AcpInitializeParams,
  type AcpInitializeResult,
  type AcpPromptParams,
  type AcpSessionCreateParams,
  type AcpSessionCreateResult,
  type AcpCancelParams,
  type AcpPromptPartial,
  type AcpPromptComplete,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";

// ── Handler interface ────────────────────────────────────────

export interface AcpHandlers {
  initialize(params: AcpInitializeParams): Promise<AcpInitializeResult>;
  sessionCreate(params: AcpSessionCreateParams): Promise<AcpSessionCreateResult>;
  /**
   * Prompt is intentionally a streaming method — the dispatcher pumps
   * `partial` callbacks into `onPartial` / `onComplete` notifications.
   */
  sessionPrompt(
    params: AcpPromptParams,
    onPartial: (p: AcpPromptPartial) => void,
    onComplete: (c: AcpPromptComplete) => void,
  ): Promise<void>;
  sessionCancel(params: AcpCancelParams): Promise<void>;
}

export interface AcpServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface AcpServerOptions {
  readonly handlers: AcpHandlers;
  readonly serverInfo: AcpServerInfo;
  /**
   * Called whenever the dispatcher needs to emit a notification
   * (streaming partials, tool events, etc.). Callers connect this to
   * stdout/socket send.
   */
  readonly emit: (frame: string) => void;
}

export class AcpServer {
  private initialized = false;
  private readonly handlers: AcpHandlers;
  private readonly serverInfo: AcpServerInfo;
  private readonly emit: (frame: string) => void;

  constructor(options: AcpServerOptions) {
    this.handlers = options.handlers;
    this.serverInfo = options.serverInfo;
    this.emit = options.emit;
  }

  /**
   * Handle a single frame (one JSON-RPC message). Returns a response
   * object when the frame was a request; `undefined` for notifications
   * or already-emitted responses. The caller should write the returned
   * response (if any) to the same transport.
   */
  async handleFrame(raw: string): Promise<JsonRpcResponse | undefined> {
    const decoded = decodeJsonRpc(raw);
    if (!isDecodedMessage(decoded)) {
      return decoded;
    }
    if (decoded.kind === "notification") {
      // We don't expect server-bound notifications in the current ACP
      // shape, but silently ignore them rather than bouncing errors
      // back (per JSON-RPC semantics).
      return undefined;
    }
    if (decoded.kind === "response") {
      // Client response to a server-initiated request — out of scope
      // for the dispatcher here; callers can observe by overriding.
      return undefined;
    }
    return this.handleRequest(decoded.message as JsonRpcRequest);
  }

  private async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (req.method) {
        case ACP_METHODS.Initialize:
          return await this.onInitialize(req);
        case ACP_METHODS.SessionCreate:
          return await this.onSessionCreate(req);
        case ACP_METHODS.SessionPrompt:
          return await this.onSessionPrompt(req);
        case ACP_METHODS.SessionCancel:
          return await this.onSessionCancel(req);
        default:
          return makeError(
            req.id,
            JSON_RPC_ERROR_CODES.MethodNotFound,
            `Unknown method: ${req.method}`,
          );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      return makeError(req.id, JSON_RPC_ERROR_CODES.InternalError, message);
    }
  }

  private async onInitialize(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = req.params as AcpInitializeParams | undefined;
    if (!params?.protocolVersion || !params.clientInfo) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "initialize: missing protocolVersion or clientInfo",
      );
    }
    const result = await this.handlers.initialize(params);
    this.initialized = true;
    // Surface WOTANN's own server info if the handler left it off.
    const merged: AcpInitializeResult = {
      protocolVersion: result.protocolVersion || ACP_PROTOCOL_VERSION,
      capabilities: result.capabilities,
      serverInfo: result.serverInfo ?? this.serverInfo,
    };
    return makeResponse(req.id, merged);
  }

  private async onSessionCreate(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    const params = req.params as AcpSessionCreateParams | undefined;
    if (!params?.rootUri) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "session/create: missing rootUri",
      );
    }
    const result = await this.handlers.sessionCreate(params);
    return makeResponse(req.id, result);
  }

  private async onSessionPrompt(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    const params = req.params as AcpPromptParams | undefined;
    if (!params?.sessionId || typeof params.text !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "session/prompt: missing sessionId or text",
      );
    }
    const onPartial = (p: AcpPromptPartial) => {
      this.emit(encodeJsonRpc(makeNotification(ACP_METHODS.PromptPartial, p)));
    };
    const onComplete = (c: AcpPromptComplete) => {
      this.emit(encodeJsonRpc(makeNotification(ACP_METHODS.PromptComplete, c)));
    };
    await this.handlers.sessionPrompt(params, onPartial, onComplete);
    return makeResponse(req.id, { accepted: true });
  }

  private async onSessionCancel(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    const params = req.params as AcpCancelParams | undefined;
    if (!params?.sessionId) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "session/cancel: missing sessionId",
      );
    }
    await this.handlers.sessionCancel(params);
    return makeResponse(req.id, { cancelled: true });
  }

  private notInitialized(id: JsonRpcId): JsonRpcResponse {
    return makeError(
      id,
      JSON_RPC_ERROR_CODES.ServerNotInitialized,
      "initialize must be called first",
    );
  }
}

// ── Helper: build a response/notification bus for tests ──────

export interface RecordingBus {
  readonly frames: string[];
  readonly send: (frame: string) => void;
  notifications(): JsonRpcNotification[];
}

export function createRecordingBus(): RecordingBus {
  const frames: string[] = [];
  return {
    frames,
    send(frame: string): void {
      frames.push(frame);
    },
    notifications(): JsonRpcNotification[] {
      return frames
        .map((f) => {
          try {
            return JSON.parse(f) as JsonRpcNotification;
          } catch {
            return null;
          }
        })
        .filter(
          (m): m is JsonRpcNotification =>
            m !== null && typeof m.method === "string" && !("id" in m),
        );
    },
  };
}
