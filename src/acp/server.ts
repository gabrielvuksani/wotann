/**
 * ACP server dispatcher (C16, upgraded to ACP v1 on 2026-04-19).
 *
 * Pure message-routing layer over the codec in protocol.ts. Callers
 * register handlers for the ACP v1 methods their runtime implements
 * and the dispatcher produces JsonRpcResponse / JsonRpcNotification
 * objects that can be written to stdout (or any duplex stream).
 *
 * Keeping this free of I/O lets tests drive the dispatcher directly
 * with strings + assertions; the actual stdio wiring is a thin
 * wrapper left for the main entry point in `stdio.ts`.
 *
 * ACP v1 dispatch surface (vs legacy 0.2):
 *   - `initialize`                  — request
 *   - `session/new`                 — request (carries cwd + mcpServers,
 *                                     client-provided MCP discovery
 *                                     channel per spec)
 *   - `session/prompt`              — request, returns PromptResponse
 *     with final `stopReason`; intermediate streaming rides on
 *     `session/update` notifications (replaces the 0.2
 *     `prompt/partial` + `prompt/complete` pair).
 *   - `session/cancel`              — NOTIFICATION (no id, no response).
 *   - WOTANN `thread/*`             — additive request routes for
 *     conversation-branch control; not part of upstream ACP.
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
  negotiateProtocolVersion,
  type AcpCancelParams,
  type AcpInitializeParams,
  type AcpInitializeResult,
  type AcpNewSessionParams,
  type AcpNewSessionResult,
  type AcpPromptParams,
  type AcpPromptResult,
  type AcpSessionUpdateNotification,
  type AcpImplementation,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";
import { dispatchThreadMethod, type ThreadHandlerDeps } from "./thread-handlers.js";

// ── Handler interface ────────────────────────────────────────

export interface AcpHandlers {
  initialize(params: AcpInitializeParams): Promise<AcpInitializeResult>;
  sessionNew(params: AcpNewSessionParams): Promise<AcpNewSessionResult>;
  /**
   * Prompt is intentionally a streaming method. The dispatcher pumps
   * `onUpdate` into `session/update` notifications; the handler
   * resolves with the final PromptResponse (stopReason) when the turn
   * ends or cancellation is observed.
   */
  sessionPrompt(
    params: AcpPromptParams,
    onUpdate: (n: AcpSessionUpdateNotification) => void,
  ): Promise<AcpPromptResult>;
  sessionCancel(params: AcpCancelParams): Promise<void>;
}

export type AcpServerInfo = AcpImplementation;

export interface AcpServerOptions {
  readonly handlers: AcpHandlers;
  readonly serverInfo: AcpServerInfo;
  /**
   * Called whenever the dispatcher needs to emit a notification
   * (streaming updates, tool events, etc.). Callers connect this to
   * stdout/socket send.
   */
  readonly emit: (frame: string) => void;
  /**
   * Optional — wires WOTANN's thread/fork, thread/rollback, thread/list,
   * thread/switch additive RPC routes. Omit to leave them unhandled
   * (JSON-RPC MethodNotFound), include to enable conversation-branch
   * control for hosts that speak it.
   */
  readonly threadDeps?: ThreadHandlerDeps;
}

export class AcpServer {
  private initialized = false;
  private readonly handlers: AcpHandlers;
  private readonly serverInfo: AcpServerInfo;
  private readonly emit: (frame: string) => void;
  private readonly threadDeps: ThreadHandlerDeps | null;

  constructor(options: AcpServerOptions) {
    this.handlers = options.handlers;
    this.serverInfo = options.serverInfo;
    this.emit = options.emit;
    this.threadDeps = options.threadDeps ?? null;
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
      await this.handleNotification(decoded.message as JsonRpcNotification);
      return undefined;
    }
    if (decoded.kind === "response") {
      // Client response to a server-initiated request — out of scope
      // for the dispatcher here; callers can observe by overriding.
      return undefined;
    }
    return this.handleRequest(decoded.message as JsonRpcRequest);
  }

  private async handleNotification(note: JsonRpcNotification): Promise<void> {
    // `session/cancel` is the only client→agent notification WOTANN
    // currently honours. Everything else is silently ignored per
    // JSON-RPC semantics — bouncing errors to notifications violates
    // the spec and confuses hosts like Zed that re-send the same
    // frame on retry.
    if (note.method === ACP_METHODS.SessionCancel) {
      const params = note.params as AcpCancelParams | undefined;
      if (!params?.sessionId) return;
      try {
        await this.handlers.sessionCancel(params);
      } catch {
        /* cancel is best-effort */
      }
    }
  }

  private async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    // WOTANN additive thread/* routes — only wired when threadDeps is supplied.
    if (this.threadDeps && typeof req.method === "string" && req.method.startsWith("thread/")) {
      try {
        const result = dispatchThreadMethod(req.method, req.params, this.threadDeps);
        if (result !== null) return makeResponse(req.id, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown thread error";
        return makeError(req.id, JSON_RPC_ERROR_CODES.InternalError, message);
      }
    }

    try {
      switch (req.method) {
        case ACP_METHODS.Initialize:
          return await this.onInitialize(req);
        case ACP_METHODS.SessionNew:
          return await this.onSessionNew(req);
        case ACP_METHODS.SessionPrompt:
          return await this.onSessionPrompt(req);
        case ACP_METHODS.SessionCancel:
          // Spec says cancel is a notification, but some hosts still
          // send it as a request. Honour it and respond `{ok:true}`
          // so the host doesn't block on the reply.
          return await this.onSessionCancelAsRequest(req);
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
    if (params === undefined || typeof params.protocolVersion !== "number") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "initialize: missing or non-integer protocolVersion",
      );
    }
    const result = await this.handlers.initialize(params);
    this.initialized = true;
    // Surface WOTANN's own agent info if the handler left it off.
    // Negotiate the version at the dispatcher layer so handlers can
    // be naive about downgrade logic.
    const negotiated = negotiateProtocolVersion(result.protocolVersion ?? params.protocolVersion);
    const merged: AcpInitializeResult = {
      protocolVersion: negotiated,
      agentCapabilities: result.agentCapabilities,
      agentInfo: result.agentInfo ?? this.serverInfo,
      ...(result.authMethods ? { authMethods: result.authMethods } : {}),
      ...(result._meta ? { _meta: result._meta } : {}),
    };
    return makeResponse(req.id, merged);
  }

  private async onSessionNew(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    const params = req.params as AcpNewSessionParams | undefined;
    if (!params?.cwd || typeof params.cwd !== "string") {
      return makeError(req.id, JSON_RPC_ERROR_CODES.InvalidParams, "session/new: missing cwd");
    }
    const result = await this.handlers.sessionNew(params);
    return makeResponse(req.id, result);
  }

  private async onSessionPrompt(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    const params = req.params as AcpPromptParams | undefined;
    if (!params?.sessionId || !Array.isArray(params.prompt)) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "session/prompt: missing sessionId or prompt[]",
      );
    }
    const onUpdate = (n: AcpSessionUpdateNotification): void => {
      this.emit(encodeJsonRpc(makeNotification(ACP_METHODS.SessionUpdate, n)));
    };
    const result = await this.handlers.sessionPrompt(params, onUpdate);
    return makeResponse(req.id, result);
  }

  private async onSessionCancelAsRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
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

// Re-export the version so call-sites don't reach into protocol.ts
// just to emit a banner. The recordingBus/server pair is the stable
// public surface of this module.
export { ACP_PROTOCOL_VERSION };
