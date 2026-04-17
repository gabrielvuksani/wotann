/**
 * C16 — ACP server dispatcher tests.
 */

import { describe, it, expect } from "vitest";
import {
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  JSON_RPC_ERROR_CODES,
  encodeJsonRpc,
  makeRequest,
} from "../../src/acp/protocol.js";
import type {
  AcpCancelParams,
  AcpInitializeParams,
  AcpInitializeResult,
  AcpPromptComplete,
  AcpPromptParams,
  AcpPromptPartial,
  AcpSessionCreateParams,
  AcpSessionCreateResult,
} from "../../src/acp/protocol.js";
import { AcpServer, createRecordingBus, type AcpHandlers } from "../../src/acp/server.js";

function mkHandlers(
  overrides: Partial<{
    init: (p: AcpInitializeParams) => Promise<AcpInitializeResult>;
    create: (p: AcpSessionCreateParams) => Promise<AcpSessionCreateResult>;
    prompt: (
      p: AcpPromptParams,
      onPartial: (p: AcpPromptPartial) => void,
      onComplete: (c: AcpPromptComplete) => void,
    ) => Promise<void>;
    cancel: (p: AcpCancelParams) => Promise<void>;
  }> = {},
): AcpHandlers {
  return {
    initialize:
      overrides.init ??
      (async () => ({
        protocolVersion: ACP_PROTOCOL_VERSION,
        capabilities: { tools: true, prompts: true, sampling: false },
        serverInfo: { name: "wotann", version: "0.5.0" },
      })),
    sessionCreate: overrides.create ?? (async () => ({ sessionId: "s1" })),
    sessionPrompt:
      overrides.prompt ??
      (async (_params, onPartial, onComplete) => {
        onPartial({ sessionId: "s1", kind: "text", content: "hello" });
        onComplete({ sessionId: "s1", finishReason: "stop" });
      }),
    sessionCancel: overrides.cancel ?? (async () => undefined),
  };
}

const SERVER_INFO = { name: "wotann", version: "0.5.0" };

describe("AcpServer.handleFrame", () => {
  it("initialize responds with merged capabilities and server info", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });

    const raw = encodeJsonRpc(
      makeRequest(1, ACP_METHODS.Initialize, {
        protocolVersion: ACP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    );
    const res = await server.handleFrame(raw);
    expect(res?.result).toMatchObject({
      protocolVersion: ACP_PROTOCOL_VERSION,
      serverInfo: SERVER_INFO,
    });
  });

  it("other methods fail with ServerNotInitialized before initialize", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const raw = encodeJsonRpc(
      makeRequest(2, ACP_METHODS.SessionCreate, { rootUri: "file:///tmp" }),
    );
    const res = await server.handleFrame(raw);
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.ServerNotInitialized);
  });

  it("session/create succeeds after initialize", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(
        makeRequest(1, ACP_METHODS.Initialize, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        }),
      ),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(makeRequest(2, ACP_METHODS.SessionCreate, { rootUri: "file:///tmp" })),
    );
    expect(res?.result).toEqual({ sessionId: "s1" });
  });

  it("session/prompt emits prompt/partial + prompt/complete notifications", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(
        makeRequest(1, ACP_METHODS.Initialize, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        }),
      ),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(
        makeRequest(3, ACP_METHODS.SessionPrompt, { sessionId: "s1", text: "hi" }),
      ),
    );
    expect(res?.result).toMatchObject({ accepted: true });

    const notifs = bus.notifications();
    const partials = notifs.filter((n) => n.method === ACP_METHODS.PromptPartial);
    const completes = notifs.filter((n) => n.method === ACP_METHODS.PromptComplete);
    expect(partials).toHaveLength(1);
    expect(completes).toHaveLength(1);
  });

  it("InvalidParams when session/prompt misses sessionId", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(
        makeRequest(1, ACP_METHODS.Initialize, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        }),
      ),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(makeRequest(4, ACP_METHODS.SessionPrompt, { text: "hi" })),
    );
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidParams);
  });

  it("MethodNotFound for unknown methods", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const res = await server.handleFrame(
      encodeJsonRpc(makeRequest(5, "totally/not/a/real/method", {})),
    );
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.MethodNotFound);
  });

  it("handler errors translate to InternalError", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers({
        init: async () => {
          throw new Error("boom");
        },
      }),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const res = await server.handleFrame(
      encodeJsonRpc(
        makeRequest(1, ACP_METHODS.Initialize, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        }),
      ),
    );
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.InternalError);
    expect(res?.error?.message).toMatch(/boom/);
  });

  it("notifications to the server are ignored silently", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const res = await server.handleFrame(
      JSON.stringify({ jsonrpc: "2.0", method: "client/ping", params: {} }),
    );
    expect(res).toBeUndefined();
  });

  it("malformed frames surface as ParseError response", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const res = await server.handleFrame("{not json");
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.ParseError);
  });
});
