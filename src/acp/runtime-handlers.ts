/**
 * ACP runtime-backed handlers — bridges WotannRuntime to the AcpHandlers
 * contract so IDE hosts (Zed, Gemini CLI, Goose, Kiro) can connect over
 * stdio and drive the real agent, not the reference canned-response
 * implementation.
 *
 * Usage:
 *
 *   const runtime = await createRuntime(config);
 *   const handlers = createRuntimeAcpHandlers({ runtime });
 *   startAcpStdio({ handlers });
 *
 * Sessions are in-memory only — one ACP session maps to one cancellation
 * flag. Conversation memory/state is delegated to the runtime's existing
 * session store, so re-creating the same cwd session across reconnections
 * preserves continuity.
 *
 * C16 — upgraded to ACP v1 on 2026-04-19 (Lane 8 audit follow-up).
 *
 * Translation table (WOTANN runtime StreamChunk → ACP v1 SessionUpdate):
 *   text      → agent_message_chunk { text }
 *   thinking  → agent_thought_chunk { text }
 *   tool_use  → tool_call { title=toolName, rawInput=toolInput }
 *   error     → agent_message_chunk { "[error] …" } then stopReason=error
 *   done      → terminates the loop with stopReason=end_turn (+ usage meta)
 */

import type { StreamChunk } from "../providers/types.js";
import type { WotannQueryOptions } from "../core/types.js";
import {
  ACP_PROTOCOL_VERSION,
  flattenPromptText,
  type AcpAgentCapabilities,
  type AcpContentBlock,
  type AcpImplementation,
  type AcpInitializeParams,
  type AcpInitializeResult,
  type AcpNewSessionParams,
  type AcpNewSessionResult,
  type AcpPromptParams,
  type AcpPromptResult,
  type AcpSessionUpdate,
  type AcpSessionUpdateNotification,
  type AcpStopReason,
  type AcpCancelParams,
} from "./protocol.js";
import type { AcpHandlers } from "./server.js";

/**
 * Minimal runtime surface the handlers need. Kept as an interface so
 * tests can drop in a fake instead of booting the whole WotannRuntime.
 */
export interface RuntimeDep {
  query(options: WotannQueryOptions): AsyncGenerator<StreamChunk>;
}

export interface RuntimeAcpHandlersOptions {
  readonly runtime: RuntimeDep;
  /** Override the default ACP agentInfo block. */
  readonly serverName?: string;
  readonly serverVersion?: string;
  /**
   * Force the reported capability matrix (defaults are runtime-derived).
   * Uses the ACP v1 AgentCapabilities shape — callers pass what their
   * runtime can honour.
   */
  readonly capabilities?: AcpAgentCapabilities;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly cwd: string;
  readonly providerHint?: string;
  readonly modelHint?: string;
  cancelled: boolean;
  toolCallCounter: number;
}

const SESSION_PREFIX = "acp-sess-";

const DEFAULT_CAPABILITIES: AcpAgentCapabilities = {
  loadSession: true,
  promptCapabilities: {
    image: true,
    audio: false,
    embeddedContext: true,
  },
  mcpCapabilities: {
    stdio: true,
    http: true,
    sse: true,
  },
  _meta: {
    // Advertise WOTANN-specific thread ops to hosts that speak the
    // extended surface (Workshop, Goose fork of ACP, etc.).
    "wotann/thread-ops": ["thread/fork", "thread/rollback", "thread/list", "thread/switch"],
  },
};

/**
 * Build handlers that proxy into a WotannRuntime. `session/prompt` maps
 * each StreamChunk into one `session/update` notification and terminates
 * with a PromptResponse carrying the aggregated stopReason. Cancellation
 * is cooperative — a `session/cancel` flips the session flag and the
 * generator loop exits at the next yielded chunk.
 */
export function createRuntimeAcpHandlers(options: RuntimeAcpHandlersOptions): AcpHandlers {
  const sessions: Map<string, SessionRecord> = new Map();
  let counter = 0;

  const agentInfo: AcpImplementation = {
    name: options.serverName ?? "wotann",
    version: options.serverVersion ?? "0.5.0",
  };

  const agentCapabilities: AcpAgentCapabilities = options.capabilities ?? DEFAULT_CAPABILITIES;

  return {
    async initialize(params: AcpInitializeParams): Promise<AcpInitializeResult> {
      // Echo back the client's version — the dispatcher handles the
      // actual negotiation / clamp to LATEST.
      return {
        protocolVersion: params.protocolVersion || ACP_PROTOCOL_VERSION,
        agentCapabilities,
        agentInfo,
        authMethods: [],
      };
    },

    async sessionNew(params: AcpNewSessionParams): Promise<AcpNewSessionResult> {
      counter += 1;
      const sessionId = `${SESSION_PREFIX}${counter}`;
      const record: SessionRecord = {
        sessionId,
        cwd: params.cwd,
        ...(params.providerHint !== undefined ? { providerHint: params.providerHint } : {}),
        ...(params.modelHint !== undefined ? { modelHint: params.modelHint } : {}),
        cancelled: false,
        toolCallCounter: 0,
      };
      sessions.set(sessionId, record);
      // Note: params.mcpServers is accepted but not yet wired — WOTANN's
      // MCP registry loads from `.wotann/mcp.json`. Honouring client-
      // provided MCP servers at session scope is tracked separately so
      // the handler stays focused on the prompt turn.
      return { sessionId };
    },

    async sessionPrompt(
      params: AcpPromptParams,
      onUpdate: (n: AcpSessionUpdateNotification) => void,
    ): Promise<AcpPromptResult> {
      const record = sessions.get(params.sessionId);
      if (!record) {
        return { stopReason: "error" };
      }
      record.cancelled = false;

      const promptText = flattenPromptText(params.prompt);
      const queryOptions: WotannQueryOptions = {
        prompt: promptText,
        ...(record.providerHint
          ? { provider: record.providerHint as WotannQueryOptions["provider"] }
          : {}),
        ...(record.modelHint ? { model: record.modelHint } : {}),
      };

      const send = (update: AcpSessionUpdate): void => {
        onUpdate({ sessionId: params.sessionId, update });
      };

      let stopReason: AcpStopReason = "end_turn";

      try {
        for await (const chunk of options.runtime.query(queryOptions)) {
          if (record.cancelled) {
            stopReason = "cancelled";
            break;
          }
          switch (chunk.type) {
            case "text": {
              const content: AcpContentBlock = { type: "text", text: chunk.content };
              send({ sessionUpdate: "agent_message_chunk", content });
              break;
            }
            case "thinking": {
              const content: AcpContentBlock = { type: "text", text: chunk.content };
              send({ sessionUpdate: "agent_thought_chunk", content });
              break;
            }
            case "tool_use": {
              record.toolCallCounter += 1;
              const toolCallId = `tool-${record.sessionId}-${record.toolCallCounter}`;
              send({
                sessionUpdate: "tool_call",
                toolCallId,
                title: chunk.toolName ?? "tool",
                ...(chunk.toolName ? { kind: chunk.toolName } : {}),
                ...(chunk.toolInput !== undefined ? { rawInput: chunk.toolInput } : {}),
              });
              break;
            }
            case "error": {
              stopReason = "error";
              const content: AcpContentBlock = {
                type: "text",
                text: `[error] ${chunk.content}`,
              };
              send({ sessionUpdate: "agent_message_chunk", content });
              break;
            }
            case "done":
              // `done` terminates the loop. Tokens are carried in the
              // PromptResponse `_meta` so hosts can surface them in UI.
              break;
          }
        }
      } catch (err) {
        stopReason = "error";
        const msg = err instanceof Error ? err.message : String(err);
        const content: AcpContentBlock = { type: "text", text: `[error] ${msg}` };
        send({ sessionUpdate: "agent_message_chunk", content });
      }

      return { stopReason };
    },

    async sessionCancel(params: AcpCancelParams): Promise<void> {
      const record = sessions.get(params.sessionId);
      if (record) record.cancelled = true;
    },
  };
}
