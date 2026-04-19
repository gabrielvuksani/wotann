/**
 * Agent Client Protocol (ACP) — wire types + codec (C16).
 *
 * ACP is a JSON-RPC 2.0-based open protocol shared by Zed, Block Goose,
 * Gemini CLI and other agent hosts so an editor/IDE can talk to any
 * compliant agent backend. This module owns the protocol types and the
 * parse/serialize codec so WOTANN can act as server (or, later, client).
 * Runtime wiring (dispatch into WotannRuntime) lives in
 * `src/acp/server.ts` + `src/acp/runtime-handlers.ts`.
 *
 * Spec reference: https://agentclientprotocol.com/ (v1, integer major).
 *
 * v1 vs legacy-0.2 changes (upgrade carried out 2026-04-19 per
 * Lane 8 audit findings — ACP 0.2 -> v1):
 *   - `protocolVersion` is now an integer MAJOR version (1), not a
 *     semver string. The agent responds with the client's version when
 *     supported, or its own LATEST when not.
 *   - `initialize` payloads carry `clientCapabilities` /
 *     `agentCapabilities` (not a merged `capabilities`) and
 *     `agentInfo` (not `serverInfo`). `authMethods` replaces the
 *     previous unused optional block.
 *   - Session creation is `session/new` + NewSessionRequest/Response
 *     (replaces the older `session/create` shape). The request carries
 *     `cwd` and an `mcpServers` list so hosts can advertise
 *     client-provided MCP tools at connect time (the v1 path to
 *     "tools/list" + "clientProvidedMcp" semantics Lane 8 flagged).
 *   - Streaming now flows through a single `session/update`
 *     notification carrying a tagged SessionUpdate union
 *     (agent_message_chunk, agent_thought_chunk, tool_call,
 *     tool_call_update, plan, ...). The old `prompt/partial` +
 *     `prompt/complete` notifications are gone; PromptResponse itself
 *     carries the final `stopReason`.
 *   - Cancellation is `session/cancel` as a JSON-RPC NOTIFICATION
 *     (no id, no response), matching how Zed / Gemini CLI drive it.
 *
 * WOTANN-specific thread ops (`thread/fork` etc.) remain additive over
 * ACP v1 — they ride through the same JSON-RPC channel but are not
 * part of the upstream spec. Hosts that don't speak them just get
 * MethodNotFound; hosts that do (the Norse-themed Workshop) get
 * conversation-branch control.
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

// ── ACP version ──────────────────────────────────────────────

/**
 * ACP protocol version. v1 uses a single `uint16` MAJOR identifier
 * (breaking changes bump this integer; additive changes are exposed as
 * capabilities). Current latest per agentclientprotocol.com: `1`.
 */
export type AcpProtocolVersion = number;

export const ACP_PROTOCOL_VERSION: AcpProtocolVersion = 1;

/**
 * Range bounds match the spec's uint16 declaration. Used by the
 * dispatcher to reject obviously-bogus client versions.
 */
export const ACP_PROTOCOL_VERSION_MIN = 0;
export const ACP_PROTOCOL_VERSION_MAX = 65535;

// ── Capability + info blocks ─────────────────────────────────

export interface AcpClientFsCapabilities {
  readonly readTextFile?: boolean;
  readonly writeTextFile?: boolean;
}

export interface AcpClientCapabilities {
  readonly fs?: AcpClientFsCapabilities;
  readonly terminal?: boolean;
  /** Extension point — hosts may advertise custom flags. */
  readonly _meta?: Record<string, unknown>;
}

export interface AcpPromptCapabilities {
  readonly image?: boolean;
  readonly audio?: boolean;
  readonly embeddedContext?: boolean;
}

export interface AcpMcpCapabilities {
  readonly http?: boolean;
  readonly sse?: boolean;
  readonly stdio?: boolean;
}

export interface AcpAgentCapabilities {
  readonly loadSession?: boolean;
  readonly promptCapabilities?: AcpPromptCapabilities;
  readonly mcpCapabilities?: AcpMcpCapabilities;
  /** Extension point — WOTANN uses this to announce thread ops. */
  readonly _meta?: Record<string, unknown>;
}

export interface AcpImplementation {
  readonly name: string;
  readonly title?: string;
  readonly version: string;
}

export interface AcpAuthMethod {
  readonly kind: "agent" | "oauth" | "apiKey" | "none";
  readonly name: string;
  readonly description?: string;
}

// ── MCP server config (carried in session/new) ───────────────

/**
 * MCP server configuration attached to `session/new`. Per ACP v1 the
 * client advertises MCP servers it wants the agent to connect to at
 * session-scope; the agent then brokers `tools/list`-style discovery
 * internally. Supports the three transports ACP recognises.
 */
export type AcpMcpServerConfig = AcpMcpStdioConfig | AcpMcpHttpConfig | AcpMcpSseConfig;

export interface AcpMcpStdioConfig {
  readonly transport: "stdio";
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: readonly { readonly name: string; readonly value: string }[];
}

export interface AcpMcpHttpConfig {
  readonly transport: "http";
  readonly name: string;
  readonly url: string;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
}

export interface AcpMcpSseConfig {
  readonly transport: "sse";
  readonly name: string;
  readonly url: string;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
}

// ── Initialize ───────────────────────────────────────────────

export interface AcpInitializeParams {
  readonly protocolVersion: AcpProtocolVersion;
  readonly clientCapabilities?: AcpClientCapabilities;
  readonly clientInfo?: AcpImplementation;
  readonly _meta?: Record<string, unknown>;
}

export interface AcpInitializeResult {
  readonly protocolVersion: AcpProtocolVersion;
  readonly agentCapabilities: AcpAgentCapabilities;
  readonly agentInfo?: AcpImplementation;
  readonly authMethods?: readonly AcpAuthMethod[];
  readonly _meta?: Record<string, unknown>;
}

// ── session/new ──────────────────────────────────────────────

export interface AcpNewSessionParams {
  readonly cwd: string;
  readonly mcpServers?: readonly AcpMcpServerConfig[];
  /** Optional routing hints — WOTANN-level addition, ignored by vanilla hosts. */
  readonly providerHint?: string;
  readonly modelHint?: string;
  readonly _meta?: Record<string, unknown>;
}

export interface AcpNewSessionResult {
  readonly sessionId: string;
  readonly _meta?: Record<string, unknown>;
}

// ── session/prompt ───────────────────────────────────────────

/**
 * ContentBlock — a tagged union matching ACP v1. WOTANN currently
 * produces `text` and consumes `text` + `resource_link`; the other
 * variants are declared so strict routing is possible without widening
 * to `unknown` downstream.
 */
export type AcpContentBlock =
  | AcpTextContentBlock
  | AcpImageContentBlock
  | AcpAudioContentBlock
  | AcpEmbeddedResourceBlock
  | AcpResourceLinkBlock;

export interface AcpTextContentBlock {
  readonly type: "text";
  readonly text: string;
  readonly annotations?: Record<string, unknown>;
}

export interface AcpImageContentBlock {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
  readonly annotations?: Record<string, unknown>;
}

export interface AcpAudioContentBlock {
  readonly type: "audio";
  readonly data: string;
  readonly mimeType: string;
  readonly annotations?: Record<string, unknown>;
}

export interface AcpEmbeddedResourceBlock {
  readonly type: "resource";
  readonly resource: {
    readonly uri: string;
    readonly mimeType?: string;
    readonly text?: string;
    readonly blob?: string;
  };
  readonly annotations?: Record<string, unknown>;
}

export interface AcpResourceLinkBlock {
  readonly type: "resource_link";
  readonly uri: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly annotations?: Record<string, unknown>;
}

export interface AcpPromptParams {
  readonly sessionId: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly _meta?: Record<string, unknown>;
}

export type AcpStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"
  | "error";

export interface AcpPromptResult {
  readonly stopReason: AcpStopReason;
  readonly _meta?: Record<string, unknown>;
}

// ── session/update (notification) ────────────────────────────

export type AcpSessionUpdate =
  | AcpAgentMessageChunkUpdate
  | AcpAgentThoughtChunkUpdate
  | AcpToolCallUpdate
  | AcpToolCallStatusUpdate
  | AcpPlanUpdate;

export interface AcpAgentMessageChunkUpdate {
  readonly sessionUpdate: "agent_message_chunk";
  readonly content: AcpContentBlock;
}

export interface AcpAgentThoughtChunkUpdate {
  readonly sessionUpdate: "agent_thought_chunk";
  readonly content: AcpContentBlock;
}

export interface AcpToolCallUpdate {
  readonly sessionUpdate: "tool_call";
  readonly toolCallId: string;
  readonly title: string;
  readonly kind?: string;
  readonly status?: "pending" | "in_progress" | "completed" | "failed";
  readonly rawInput?: unknown;
}

export interface AcpToolCallStatusUpdate {
  readonly sessionUpdate: "tool_call_update";
  readonly toolCallId: string;
  readonly status?: "pending" | "in_progress" | "completed" | "failed";
  readonly content?: readonly AcpContentBlock[];
  readonly rawOutput?: unknown;
}

export interface AcpPlanUpdate {
  readonly sessionUpdate: "plan";
  readonly entries: readonly {
    readonly content: string;
    readonly priority?: "low" | "medium" | "high";
    readonly status?: "pending" | "in_progress" | "completed";
  }[];
}

export interface AcpSessionUpdateNotification {
  readonly sessionId: string;
  readonly update: AcpSessionUpdate;
  readonly _meta?: Record<string, unknown>;
}

// ── session/cancel (notification) ────────────────────────────

export interface AcpCancelParams {
  readonly sessionId: string;
}

// ── Method table ─────────────────────────────────────────────

export const ACP_METHODS = {
  // Core client→agent methods (ACP v1).
  Initialize: "initialize",
  Authenticate: "authenticate",
  SessionNew: "session/new",
  SessionPrompt: "session/prompt",
  SessionCancel: "session/cancel", // notification
  SessionUpdate: "session/update", // notification (agent→client)
  // WOTANN-specific thread ops — additive, namespaced away from spec.
  ThreadFork: "thread/fork",
  ThreadRollback: "thread/rollback",
  ThreadList: "thread/list",
  ThreadSwitch: "thread/switch",
} as const;

// ── WOTANN thread-op params/results (unchanged shape) ────────

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
  const err: JsonRpcError = data === undefined ? { code, message } : { code, message, data };
  return { jsonrpc: "2.0", id, error: err };
}

export function makeNotification(method: string, params?: unknown): JsonRpcNotification {
  return params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
}

export function makeRequest(id: JsonRpcId, method: string, params?: unknown): JsonRpcRequest {
  return params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };
}

export function isDecodedMessage(v: DecodedMessage | JsonRpcResponse): v is DecodedMessage {
  return "kind" in v;
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Extract plain text from a prompt payload (ContentBlock[]). Everything
 * that isn't `text` is skipped with a placeholder — callers that need
 * image/audio bytes should walk the blocks themselves. Central helper
 * so the dispatcher and runtime handler agree on what "the user said"
 * means when the host sends a multi-modal prompt.
 */
export function flattenPromptText(blocks: readonly AcpContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        parts.push(block.text);
        break;
      case "image":
        parts.push(`[image:${block.mimeType}]`);
        break;
      case "audio":
        parts.push(`[audio:${block.mimeType}]`);
        break;
      case "resource":
        if (block.resource.text) parts.push(block.resource.text);
        else parts.push(`[resource:${block.resource.uri}]`);
        break;
      case "resource_link":
        parts.push(`[link:${block.uri}]`);
        break;
    }
  }
  return parts.join("");
}

/**
 * Whether a client-requested protocol version is one we can honour.
 * Per spec the agent should downgrade to its own LATEST if not; callers
 * use this to decide which version to report back.
 */
export function negotiateProtocolVersion(clientVersion: unknown): AcpProtocolVersion {
  if (typeof clientVersion !== "number" || !Number.isInteger(clientVersion)) {
    return ACP_PROTOCOL_VERSION;
  }
  if (clientVersion < ACP_PROTOCOL_VERSION_MIN || clientVersion > ACP_PROTOCOL_VERSION_MAX) {
    return ACP_PROTOCOL_VERSION;
  }
  if (clientVersion > ACP_PROTOCOL_VERSION) return ACP_PROTOCOL_VERSION;
  return clientVersion;
}
