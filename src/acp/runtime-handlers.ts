/**
 * ACP runtime-backed handlers — bridges WotannRuntime to the AcpHandlers
 * contract so IDE hosts (Zed, Goose, Air, Kiro) can connect over stdio
 * and drive the real agent, not the reference canned-response handler.
 *
 * Usage:
 *
 *   const runtime = await createRuntime(config);
 *   const handlers = createRuntimeAcpHandlers({ runtime });
 *   startAcpStdio({ handlers });
 *
 * Sessions are in-memory only — one ACP session maps to one cancellation
 * token. Conversation memory/state is delegated to the runtime's existing
 * session store, so re-creating the same rootUri session across
 * reconnections preserves continuity.
 *
 * C16 — follow-up to stdio.ts scaffolding shipped in session 8.
 */

import type { StreamChunk } from "../providers/types.js";
import type { WotannQueryOptions } from "../core/types.js";
import type {
  AcpInitializeParams,
  AcpInitializeResult,
  AcpPromptComplete,
  AcpPromptParams,
  AcpPromptPartial,
  AcpCancelParams,
  AcpSessionCreateParams,
  AcpSessionCreateResult,
} from "./protocol.js";
import { ACP_PROTOCOL_VERSION } from "./protocol.js";
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
  /** Override the default ACP server info block. */
  readonly serverName?: string;
  readonly serverVersion?: string;
  /** Force the reported capability matrix (defaults are runtime-derived). */
  readonly capabilities?: {
    readonly tools?: boolean;
    readonly prompts?: boolean;
    readonly sampling?: boolean;
  };
}

interface SessionRecord {
  readonly sessionId: string;
  readonly rootUri: string;
  readonly providerHint?: string;
  readonly modelHint?: string;
  cancelled: boolean;
}

const SESSION_PREFIX = "acp-sess-";

/**
 * Build handlers that proxy into a WotannRuntime. session/prompt streams
 * each StreamChunk as an AcpPromptPartial and terminates with a single
 * AcpPromptComplete carrying the aggregated finishReason. Cancellation
 * is cooperative — a `session/cancel` flips the session flag and the
 * generator loop exits at the next yielded chunk.
 */
export function createRuntimeAcpHandlers(options: RuntimeAcpHandlersOptions): AcpHandlers {
  const sessions: Map<string, SessionRecord> = new Map();
  let counter = 0;

  return {
    async initialize(params: AcpInitializeParams): Promise<AcpInitializeResult> {
      return {
        protocolVersion: params.protocolVersion || ACP_PROTOCOL_VERSION,
        capabilities: {
          tools: options.capabilities?.tools ?? true,
          prompts: options.capabilities?.prompts ?? true,
          sampling: options.capabilities?.sampling ?? false,
        },
        serverInfo: {
          name: options.serverName ?? "wotann",
          version: options.serverVersion ?? "0.5.0",
        },
      };
    },

    async sessionCreate(params: AcpSessionCreateParams): Promise<AcpSessionCreateResult> {
      counter += 1;
      const sessionId = `${SESSION_PREFIX}${counter}`;
      const record: SessionRecord = {
        sessionId,
        rootUri: params.rootUri,
        providerHint: params.providerHint,
        modelHint: params.modelHint,
        cancelled: false,
      };
      sessions.set(sessionId, record);
      return { sessionId };
    },

    async sessionPrompt(
      params: AcpPromptParams,
      onPartial: (p: AcpPromptPartial) => void,
      onComplete: (c: AcpPromptComplete) => void,
    ): Promise<void> {
      const record = sessions.get(params.sessionId);
      if (!record) {
        onComplete({
          sessionId: params.sessionId,
          finishReason: "error",
        });
        return;
      }
      record.cancelled = false;
      const queryOptions: WotannQueryOptions = {
        prompt: params.text,
        ...(record.providerHint
          ? { provider: record.providerHint as WotannQueryOptions["provider"] }
          : {}),
        ...(record.modelHint ? { model: record.modelHint } : {}),
      };

      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason: AcpPromptComplete["finishReason"] = "stop";

      try {
        for await (const chunk of options.runtime.query(queryOptions)) {
          if (record.cancelled) {
            finishReason = "cancelled";
            break;
          }
          switch (chunk.type) {
            case "text":
              onPartial({
                sessionId: params.sessionId,
                kind: "text",
                content: chunk.content,
              });
              break;
            case "thinking":
              onPartial({
                sessionId: params.sessionId,
                kind: "thinking",
                content: chunk.content,
              });
              break;
            case "tool_use":
              onPartial({
                sessionId: params.sessionId,
                kind: "tool_use",
                content: chunk.content,
                ...(chunk.toolName ? { toolName: chunk.toolName } : {}),
                ...(chunk.toolInput !== undefined ? { toolInput: chunk.toolInput } : {}),
              });
              break;
            case "error":
              finishReason = "error";
              onPartial({
                sessionId: params.sessionId,
                kind: "text",
                content: `[error] ${chunk.content}`,
              });
              break;
            case "done":
              // `done` carries the final usage totals when provided.
              if (chunk.tokensUsed) outputTokens = chunk.tokensUsed;
              break;
          }
        }
      } catch (err) {
        finishReason = "error";
        const msg = err instanceof Error ? err.message : String(err);
        onPartial({
          sessionId: params.sessionId,
          kind: "text",
          content: `[error] ${msg}`,
        });
      }

      onComplete({
        sessionId: params.sessionId,
        finishReason,
        usage: { inputTokens, outputTokens },
      });
    },

    async sessionCancel(params: AcpCancelParams): Promise<void> {
      const record = sessions.get(params.sessionId);
      if (record) record.cancelled = true;
    },
  };
}
