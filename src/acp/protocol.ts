/**
 * Agent Client Protocol (ACP) — wire types + codec (C16).
 *
 * ACP is a JSON-RPC 2.0-based open protocol spec shared by Zed, Block
 * Goose, and several other agent hosts so an editor/IDE can talk to
 * any compliant agent backend. This module owns the protocol types
 * and the parse/serialize codec so WOTANN can act as either client
 * or server. Runtime wiring (dispatch into WotannRuntime) lives
 * separately in src/acp/server.ts.
 *
 * Spec reference: https://agentclientprotocol.com/ (v0.x)
 */

// ── JSON-RPC 2.0 primitives ──────────────────────────────────

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export const JSON_RPC_ERROR_CODES = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  RequestCancelled: -32800,
  ContentTooLarge: -32801,
} as const;

// ── ACP-specific methods and payloads ────────────────────────

/** Server-side handler for the `initialize` method. */
export interface AcpInitializeParams {
  readonly protocolVersion: string;
  readonly capabilities: {
    readonly tools?: boolean;
    readonly prompts?: boolean;
    readonly sampling?: boolean;
  };
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
}

export interface AcpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: {
    readonly tools: boolean;
    readonly prompts: boolean;
    readonly sampling: boolean;
  };
  readonly serverInfo: {
    readonly name: string;
    readonly version: string;
  };
}

export interface AcpSessionCreateParams {
  readonly rootUri: string;
  readonly providerHint?: string;
  readonly modelHint?: string;
}

export interface AcpSessionCreateResult {
  readonly sessionId: string;
}

export interface AcpPromptParams {
  readonly sessionId: string;
  readonly text: string;
  readonly attachments?: readonly { readonly uri: string; readonly mime: string }[];
}

export interface AcpPromptPartial {
  readonly sessionId: string;
  readonly kind: "text" | "tool_use" | "tool_result" | "thinking";
  readonly content: string;
  readonly toolName?: string;
  readonly toolInput?: unknown;
}

export interface AcpPromptComplete {
  readonly sessionId: string;
  readonly finishReason: "stop" | "length" | "tool_use" | "error" | "cancelled";
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface AcpCancelParams {
  readonly sessionId: string;
}

export const ACP_METHODS = {
  Initialize: "initialize",
  SessionCreate: "session/create",
  SessionPrompt: "session/prompt",
  SessionCancel: "session/cancel",
  ToolCallStart: "tools/start",
  ToolCallResult: "tools/result",
  PromptPartial: "prompt/partial",
  PromptComplete: "prompt/complete",
  // Codex-parity thread ops — see src/core/conversation-branching.ts
  ThreadFork: "thread/fork",
  ThreadRollback: "thread/rollback",
  ThreadList: "thread/list",
  ThreadSwitch: "thread/switch",
} as const;

export interface AcpThreadForkParams {
  readonly sessionId: string;
  readonly name: string;
  /** Optional — fork from a specific turn. Default = current head. */
  readonly fromTurnId?: string;
}

export interface AcpThreadForkResult {
  readonly branchId: string;
  readonly name: string;
  readonly forkPoint: string | null;
  readonly inheritedTurnCount: number;
}

export interface AcpThreadRollbackParams {
  readonly sessionId: string;
  /**
   * Either `n` (drop N most recent turns) OR `toTurnId` (drop
   * everything after a specific turn). Exactly one required.
   */
  readonly n?: number;
  readonly toTurnId?: string;
}

export interface AcpThreadRollbackResult {
  readonly droppedTurnCount: number;
  readonly droppedTurnIds: readonly string[];
}

export interface AcpThreadListParams {
  readonly sessionId: string;
}

export interface AcpThreadListResult {
  readonly branches: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly turnCount: number;
    readonly forkPoint: string | null;
    readonly isActive: boolean;
  }>;
}

export interface AcpThreadSwitchParams {
  readonly sessionId: string;
  readonly nameOrId: string;
}

export interface AcpThreadSwitchResult {
  readonly switched: boolean;
  readonly activeBranchId: string;
}

export const ACP_PROTOCOL_VERSION = "0.2.0";

// ── Codec ────────────────────────────────────────────────────

export interface DecodedMessage {
  readonly kind: "request" | "response" | "notification";
  readonly message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
}

/**
 * Decode a JSON-RPC frame. Returns an `error` JsonRpcResponse shape
 * when the frame is malformed (never throws) — callers use the
 * discriminator to decide how to route.
 */
export function decodeJsonRpc(raw: string): DecodedMessage | JsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: JSON_RPC_ERROR_CODES.ParseError, message: "Invalid JSON" },
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: JSON_RPC_ERROR_CODES.InvalidRequest, message: "Not a JSON object" },
    };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj["jsonrpc"] !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: (obj["id"] as JsonRpcId) ?? null,
      error: { code: JSON_RPC_ERROR_CODES.InvalidRequest, message: "Missing jsonrpc: 2.0" },
    };
  }
  const hasResult = "result" in obj;
  const hasError = "error" in obj;
  const hasMethod = typeof obj["method"] === "string";
  const hasId = "id" in obj && obj["id"] !== undefined;

  if (hasResult || hasError) {
    return {
      kind: "response",
      message: obj as unknown as JsonRpcResponse,
    };
  }
  if (hasMethod && !hasId) {
    return {
      kind: "notification",
      message: obj as unknown as JsonRpcNotification,
    };
  }
  if (hasMethod && hasId) {
    return {
      kind: "request",
      message: obj as unknown as JsonRpcRequest,
    };
  }
  return {
    jsonrpc: "2.0",
    id: (obj["id"] as JsonRpcId) ?? null,
    error: {
      code: JSON_RPC_ERROR_CODES.InvalidRequest,
      message: "Message has neither method nor result/error",
    },
  };
}

export function encodeJsonRpc(msg: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): string {
  return JSON.stringify(msg);
}

export function makeResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function makeError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export function makeNotification(method: string, params?: unknown): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}

export function makeRequest(id: JsonRpcId, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

export function isDecodedMessage(v: DecodedMessage | JsonRpcResponse): v is DecodedMessage {
  return "kind" in v;
}
