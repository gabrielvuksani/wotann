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
  type AcpFsErrorResult,
  type AcpFsListParams,
  type AcpFsListResult,
  type AcpFsReadParams,
  type AcpFsReadResult,
  type AcpFsWriteParams,
  type AcpFsWriteResult,
  type AcpInitializeParams,
  type AcpInitializeResult,
  type AcpNewSessionParams,
  type AcpNewSessionResult,
  type AcpPermissionsRequestParams,
  type AcpPermissionsRequestResult,
  type AcpPromptParams,
  type AcpPromptResult,
  type AcpSessionUpdateNotification,
  type AcpImplementation,
  type AcpToolsListParams,
  type AcpToolsListResult,
  type AcpToolsInvokeParams,
  type AcpToolsInvokeResult,
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
  /**
   * Zed 0.3 parity — return the runtime's tool registry shaped as ACP
   * ToolDefinitions. Optional; hosts that don't implement tools fall
   * back to the existing session/prompt surface. When omitted the
   * dispatcher returns `MethodNotFound` for tools/list.
   */
  toolsList?(params: AcpToolsListParams): Promise<AcpToolsListResult>;
  /**
   * Zed 0.3 parity — invoke a tool by name with validated arguments.
   * The handler is responsible for validating `arguments` against the
   * tool's inputSchema; the dispatcher only performs shape checks
   * (name present, arguments is an object).
   */
  toolsInvoke?(params: AcpToolsInvokeParams): Promise<AcpToolsInvokeResult>;
  /**
   * Wave 5-EE — interactive permission elevation. Resolves whether
   * `tool` with `args` would be allowed under the active
   * PermissionMode (per-session if `sessionId` is supplied). Returns
   * one of `allow` / `deny` / `ask` so the editor can render the
   * right UI affordance before the underlying tool fires.
   *
   * Optional — when omitted the dispatcher returns MethodNotFound,
   * which lets minimal/reference servers stay slim.
   */
  permissionsRequest?(params: AcpPermissionsRequestParams): Promise<AcpPermissionsRequestResult>;
  /**
   * Wave 5-EE — proxy a file read through the agent. The handler is
   * responsible for workspace-bound + symlink-defence checks (using
   * canonicalizePathForCheck + isWithinWorkspace). On refusal the
   * handler returns an `AcpFsErrorResult` envelope rather than
   * throwing, so JSON-RPC errors are reserved for transport-level
   * failures (QB#6 honest fallback).
   */
  fsRead?(params: AcpFsReadParams): Promise<AcpFsReadResult | AcpFsErrorResult>;
  /**
   * Wave 5-EE — proxy a file write through the agent. Uses
   * `safeWriteFile` (O_NOFOLLOW on POSIX) so a pre-existing symlink
   * at the leaf is refused with `permission-denied`. Returns an
   * `AcpFsErrorResult` envelope on refusal; throws only on truly
   * unexpected I/O.
   */
  fsWrite?(params: AcpFsWriteParams): Promise<AcpFsWriteResult | AcpFsErrorResult>;
  /**
   * Wave 5-EE — list directory entries inside the workspace. Symlink
   * entries are reported as kind="symlink" rather than dereferenced,
   * so callers decide whether to follow.
   */
  fsList?(params: AcpFsListParams): Promise<AcpFsListResult | AcpFsErrorResult>;
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
        case ACP_METHODS.ToolsList:
          return await this.onToolsList(req);
        case ACP_METHODS.ToolsInvoke:
          return await this.onToolsInvoke(req);
        case ACP_METHODS.PermissionsRequest:
          return await this.onPermissionsRequest(req);
        case ACP_METHODS.FsRead:
          return await this.onFsRead(req);
        case ACP_METHODS.FsWrite:
          return await this.onFsWrite(req);
        case ACP_METHODS.FsList:
          return await this.onFsList(req);
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

  private async onToolsList(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    if (!this.handlers.toolsList) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.MethodNotFound,
        "tools/list: handler not implemented by this agent",
      );
    }
    // Shape-check only — a plain {} is a valid request (no session scope).
    const raw = (req.params ?? {}) as Record<string, unknown>;
    if (raw.sessionId !== undefined && typeof raw.sessionId !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "tools/list: sessionId must be a string when provided",
      );
    }
    const params: AcpToolsListParams =
      typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {};
    const result = await this.handlers.toolsList(params);
    return makeResponse(req.id, result);
  }

  private async onToolsInvoke(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    if (!this.handlers.toolsInvoke) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.MethodNotFound,
        "tools/invoke: handler not implemented by this agent",
      );
    }
    const raw = (req.params ?? {}) as Record<string, unknown>;
    if (typeof raw.name !== "string" || raw.name.length === 0) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "tools/invoke: missing or empty `name`",
      );
    }
    if (
      raw.arguments !== undefined &&
      (typeof raw.arguments !== "object" || raw.arguments === null || Array.isArray(raw.arguments))
    ) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "tools/invoke: `arguments` must be an object when provided",
      );
    }
    if (raw.sessionId !== undefined && typeof raw.sessionId !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "tools/invoke: sessionId must be a string when provided",
      );
    }
    const params: AcpToolsInvokeParams = {
      name: raw.name,
      ...(raw.arguments !== undefined
        ? { arguments: raw.arguments as Record<string, unknown> }
        : {}),
      ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}),
    };
    const result = await this.handlers.toolsInvoke(params);
    return makeResponse(req.id, result);
  }

  // ── Wave 5-EE: permissions/request + fs/* dispatcher methods ─

  private async onPermissionsRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    if (!this.handlers.permissionsRequest) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.MethodNotFound,
        "permissions/request: handler not implemented by this agent",
      );
    }
    const raw = (req.params ?? {}) as Record<string, unknown>;
    if (typeof raw["tool"] !== "string" || raw["tool"].length === 0) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "permissions/request: missing or empty `tool`",
      );
    }
    if (
      raw["args"] !== undefined &&
      (typeof raw["args"] !== "object" || raw["args"] === null || Array.isArray(raw["args"]))
    ) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "permissions/request: `args` must be an object when provided",
      );
    }
    if (raw["sessionId"] !== undefined && typeof raw["sessionId"] !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "permissions/request: sessionId must be a string when provided",
      );
    }
    const params: AcpPermissionsRequestParams = {
      tool: raw["tool"],
      ...(raw["args"] !== undefined ? { args: raw["args"] as Record<string, unknown> } : {}),
      ...(typeof raw["sessionId"] === "string" ? { sessionId: raw["sessionId"] } : {}),
    };
    const result = await this.handlers.permissionsRequest(params);
    return makeResponse(req.id, result);
  }

  private async onFsRead(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    if (!this.handlers.fsRead) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.MethodNotFound,
        "fs/read: handler not implemented by this agent",
      );
    }
    const raw = (req.params ?? {}) as Record<string, unknown>;
    if (typeof raw["path"] !== "string" || raw["path"].length === 0) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "fs/read: missing or empty `path`",
      );
    }
    if (raw["sessionId"] !== undefined && typeof raw["sessionId"] !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "fs/read: sessionId must be a string when provided",
      );
    }
    const params: AcpFsReadParams = {
      path: raw["path"],
      ...(typeof raw["sessionId"] === "string" ? { sessionId: raw["sessionId"] } : {}),
    };
    const result = await this.handlers.fsRead(params);
    return makeResponse(req.id, result);
  }

  private async onFsWrite(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    if (!this.handlers.fsWrite) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.MethodNotFound,
        "fs/write: handler not implemented by this agent",
      );
    }
    const raw = (req.params ?? {}) as Record<string, unknown>;
    if (typeof raw["path"] !== "string" || raw["path"].length === 0) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "fs/write: missing or empty `path`",
      );
    }
    if (typeof raw["content"] !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "fs/write: `content` must be a string",
      );
    }
    if (raw["sessionId"] !== undefined && typeof raw["sessionId"] !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "fs/write: sessionId must be a string when provided",
      );
    }
    const params: AcpFsWriteParams = {
      path: raw["path"],
      content: raw["content"],
      ...(typeof raw["sessionId"] === "string" ? { sessionId: raw["sessionId"] } : {}),
    };
    const result = await this.handlers.fsWrite(params);
    return makeResponse(req.id, result);
  }

  private async onFsList(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.initialized) return this.notInitialized(req.id);
    if (!this.handlers.fsList) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.MethodNotFound,
        "fs/list: handler not implemented by this agent",
      );
    }
    const raw = (req.params ?? {}) as Record<string, unknown>;
    if (typeof raw["dir"] !== "string" || raw["dir"].length === 0) {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "fs/list: missing or empty `dir`",
      );
    }
    if (raw["sessionId"] !== undefined && typeof raw["sessionId"] !== "string") {
      return makeError(
        req.id,
        JSON_RPC_ERROR_CODES.InvalidParams,
        "fs/list: sessionId must be a string when provided",
      );
    }
    const params: AcpFsListParams = {
      dir: raw["dir"],
      ...(typeof raw["sessionId"] === "string" ? { sessionId: raw["sessionId"] } : {}),
    };
    const result = await this.handlers.fsList(params);
    return makeResponse(req.id, result);
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

// ── Wave 5-EE: default fs/* + permissions/request handler factory ──

import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { canonicalizePathForCheck, safeWriteFile } from "../utils/path-realpath.js";
import { isWithinWorkspace, resolvePermission, classifyRisk } from "../sandbox/security.js";
import type { PermissionMode } from "../core/types.js";

/**
 * Per-session bindings consumed by `createFsHandlers()`. Owned by the
 * caller (one record per session, not a module-global Map) — satisfies
 * QB#7 by routing every request through a session-resolver callback
 * rather than sharing handler state across sessions.
 */
export interface AcpFsHandlerSession {
  readonly workspaceRoot: string;
  readonly permissionMode: PermissionMode;
}

export interface AcpFsHandlerDeps {
  /**
   * Resolve the per-session workspace + permission mode. Return null
   * when the sessionId is unknown — the dispatcher then refuses with
   * `permission-denied` rather than reading from a default workspace.
   */
  readonly getSession: (sessionId: string | undefined) => AcpFsHandlerSession | null;
  /**
   * Optional cap on `fs/read` size (bytes). Defaults to 5 MiB so a
   * pathological request can't blow up the JSON-RPC frame. Reads
   * larger than the cap return `permission-denied` with an explanatory
   * message — honest, no truncation surprise.
   */
  readonly maxReadBytes?: number;
}

const DEFAULT_MAX_READ_BYTES = 5 * 1024 * 1024;

/**
 * Build a partial AcpHandlers containing only the Wave 5-EE routes
 * (`permissionsRequest` + `fsRead` + `fsWrite` + `fsList`). Compose into
 * a full handlers object via spread, e.g.:
 *
 *   const handlers: AcpHandlers = {
 *     ...createRuntimeAcpHandlers({ runtime }),
 *     ...createFsHandlers({ getSession }),
 *   };
 *
 * Every route enforces `isWithinWorkspace` AFTER `canonicalizePathForCheck`,
 * so a symlinked path is always evaluated by its real target. Refusals
 * return the structured `AcpFsErrorResult` envelope (QB#6); only truly
 * unexpected errors are thrown for the dispatcher to wrap as JSON-RPC
 * InternalError.
 */
export function createFsHandlers(
  deps: AcpFsHandlerDeps,
): Pick<AcpHandlers, "permissionsRequest" | "fsRead" | "fsWrite" | "fsList"> {
  const maxReadBytes = deps.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;

  /**
   * Resolve a request path against its session's workspace, performing
   * symlink-safe canonicalisation. Returns either the canonical absolute
   * path (when safe) or an `AcpFsErrorResult` describing why we refused.
   */
  const guard = (
    rawPath: string,
    session: AcpFsHandlerSession | null,
  ): { canonical: string; session: AcpFsHandlerSession } | AcpFsErrorResult => {
    if (!session) {
      return {
        error: "permission-denied",
        message: "session not found or not yet established",
      };
    }
    let canonical: string;
    try {
      canonical = canonicalizePathForCheck(rawPath);
    } catch {
      return { error: "permission-denied", message: "path canonicalisation failed" };
    }
    if (!isWithinWorkspace(canonical, session.workspaceRoot)) {
      return {
        error: "permission-denied",
        message: `path escapes workspace ${session.workspaceRoot}`,
      };
    }
    // Defence-in-depth: if the leaf exists and is a symlink, refuse
    // even though canonicalisation already followed it. The symlink
    // target is inside the workspace per the check above, but we
    // still don't want to silently read/write through one — the host
    // should request the canonical path explicitly. Mirrors the
    // assertNotSymlink stance used by safeWriteFile.
    try {
      const stat = lstatSync(rawPath);
      if (stat.isSymbolicLink()) {
        return {
          error: "permission-denied",
          message: `refusing to operate on symbolic link at ${rawPath}`,
        };
      }
    } catch {
      // ENOENT / EACCES is fine — fall through; subsequent fs op
      // surfaces the real failure as `not-found` / `io-error`.
    }
    return { canonical, session };
  };

  return {
    async permissionsRequest(
      params: AcpPermissionsRequestParams,
    ): Promise<AcpPermissionsRequestResult> {
      const session = deps.getSession(params.sessionId);
      if (!session) {
        // Per QB#6 honest fallback: refuse-by-default when we don't
        // know the session's PermissionMode. Returning "ask" would
        // prompt the user for an unidentified session, which is worse.
        return { decision: "deny", reason: "session not found" };
      }
      const risk = classifyRisk(params.tool, params.args);
      const internal = resolvePermission(session.permissionMode, risk);
      // resolvePermission emits "allow" / "deny" / "always-allow"; ACP
      // only knows "allow" / "deny" / "ask". Collapse "always-allow"
      // to "allow" (semantically equivalent for a single-shot query)
      // and promote "deny" to "ask" in the interactive default mode so
      // the editor prompts instead of silently blocking.
      let decision: AcpPermissionsRequestResult["decision"];
      if (internal === "always-allow" || internal === "allow") {
        decision = "allow";
      } else if (session.permissionMode === "default") {
        decision = "ask";
      } else {
        decision = "deny";
      }
      return {
        decision,
        reason: `tool=${params.tool} risk=${risk} mode=${session.permissionMode}`,
      };
    },

    async fsRead(params: AcpFsReadParams): Promise<AcpFsReadResult | AcpFsErrorResult> {
      const session = deps.getSession(params.sessionId);
      const guarded = guard(params.path, session);
      if ("error" in guarded) return guarded;
      try {
        const stat = statSync(guarded.canonical);
        if (!stat.isFile()) {
          return {
            error: "permission-denied",
            message: `${params.path} is not a regular file`,
          };
        }
        if (stat.size > maxReadBytes) {
          return {
            error: "permission-denied",
            message: `file exceeds maxReadBytes=${maxReadBytes} (size=${stat.size})`,
          };
        }
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return { error: "not-found", message: `no such file: ${params.path}` };
        }
        return {
          error: "io-error",
          message: `stat failed: ${(err as Error)?.message ?? String(err)}`,
        };
      }
      try {
        const content = readFileSync(guarded.canonical, "utf-8");
        return { content };
      } catch (err: unknown) {
        return {
          error: "io-error",
          message: `read failed: ${(err as Error)?.message ?? String(err)}`,
        };
      }
    },

    async fsWrite(params: AcpFsWriteParams): Promise<AcpFsWriteResult | AcpFsErrorResult> {
      const session = deps.getSession(params.sessionId);
      const guarded = guard(params.path, session);
      if ("error" in guarded) return guarded;
      try {
        // safeWriteFile uses O_NOFOLLOW on POSIX so a pre-existing
        // symlink at the leaf is refused atomically with ELOOP — even
        // if our lstat precheck somehow missed it (TOCTOU window).
        safeWriteFile(guarded.canonical, params.content);
        return { bytesWritten: Buffer.byteLength(params.content, "utf-8") };
      } catch (err: unknown) {
        const message = (err as Error)?.message ?? String(err);
        // safeWriteFile throws a clear "refused to follow symbolic
        // link" message on ELOOP; map that to permission-denied so the
        // host renders it as a refusal rather than an opaque I/O bug.
        if (message.includes("refused to follow symbolic link")) {
          return { error: "permission-denied", message };
        }
        return { error: "io-error", message: `write failed: ${message}` };
      }
    },

    async fsList(params: AcpFsListParams): Promise<AcpFsListResult | AcpFsErrorResult> {
      const session = deps.getSession(params.sessionId);
      const guarded = guard(params.dir, session);
      if ("error" in guarded) return guarded;
      let dirents;
      try {
        dirents = readdirSync(guarded.canonical, { withFileTypes: true });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return { error: "not-found", message: `no such directory: ${params.dir}` };
        }
        if (code === "ENOTDIR") {
          return { error: "permission-denied", message: `${params.dir} is not a directory` };
        }
        return {
          error: "io-error",
          message: `readdir failed: ${(err as Error)?.message ?? String(err)}`,
        };
      }
      const entries = dirents.map((d) => {
        const type = d.isFile()
          ? ("file" as const)
          : d.isDirectory()
            ? ("directory" as const)
            : d.isSymbolicLink()
              ? ("symlink" as const)
              : ("other" as const);
        let size = 0;
        if (type === "file") {
          try {
            const childPath = `${guarded.canonical}/${d.name}`;
            size = statSync(childPath).size;
          } catch {
            // Honest fallback: report size=0 rather than hide the
            // entry; the caller can re-stat individually if needed.
            size = 0;
          }
        }
        return { name: d.name, type, size };
      });
      return { entries };
    },
  };
}
