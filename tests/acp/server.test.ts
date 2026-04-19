/**
 * C16 — ACP server dispatcher tests (ACP v1).
 */

import { describe, it, expect } from "vitest";
import {
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  JSON_RPC_ERROR_CODES,
  encodeJsonRpc,
  makeNotification,
  makeRequest,
  type AcpCancelParams,
  type AcpInitializeParams,
  type AcpInitializeResult,
  type AcpNewSessionParams,
  type AcpNewSessionResult,
  type AcpPromptParams,
  type AcpPromptResult,
  type AcpSessionUpdateNotification,
} from "../../src/acp/protocol.js";
import { AcpServer, createRecordingBus, type AcpHandlers } from "../../src/acp/server.js";

function mkHandlers(
  overrides: Partial<{
    init: (p: AcpInitializeParams) => Promise<AcpInitializeResult>;
    newSession: (p: AcpNewSessionParams) => Promise<AcpNewSessionResult>;
    prompt: (
      p: AcpPromptParams,
      onUpdate: (n: AcpSessionUpdateNotification) => void,
    ) => Promise<AcpPromptResult>;
    cancel: (p: AcpCancelParams) => Promise<void>;
  }> = {},
): AcpHandlers {
  return {
    initialize:
      overrides.init ??
      (async () => ({
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, audio: false, embeddedContext: true },
          mcpCapabilities: { stdio: true, http: true, sse: false },
        },
        agentInfo: { name: "wotann", version: "0.5.0" },
      })),
    sessionNew: overrides.newSession ?? (async () => ({ sessionId: "s1" })),
    sessionPrompt:
      overrides.prompt ??
      (async (_params, onUpdate) => {
        onUpdate({
          sessionId: "s1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        });
        return { stopReason: "end_turn" };
      }),
    sessionCancel: overrides.cancel ?? (async () => undefined),
  };
}

const SERVER_INFO = { name: "wotann", version: "0.5.0" };

function initParams(): AcpInitializeParams {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    },
    clientInfo: { name: "test", version: "0" },
  };
}

describe("AcpServer.handleFrame — initialize", () => {
  it("responds with integer protocolVersion + agentInfo + agentCapabilities", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });

    const raw = encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams()));
    const res = await server.handleFrame(raw);
    expect(res?.result).toMatchObject({
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentInfo: SERVER_INFO,
    });
    const result = res?.result as { agentCapabilities: { promptCapabilities?: unknown } };
    expect(result.agentCapabilities.promptCapabilities).toBeDefined();
  });

  it("falls through to InvalidParams when protocolVersion is a string", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const raw = encodeJsonRpc(
      makeRequest(1, ACP_METHODS.Initialize, {
        protocolVersion: "0.2.0",
        clientInfo: { name: "test", version: "0" },
      }),
    );
    const res = await server.handleFrame(raw);
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidParams);
  });

  it("negotiates down to LATEST when the client asks for a higher version", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers({
        init: async (p) => ({
          protocolVersion: p.protocolVersion,
          agentCapabilities: {},
          agentInfo: SERVER_INFO,
        }),
      }),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const raw = encodeJsonRpc(
      makeRequest(1, ACP_METHODS.Initialize, {
        protocolVersion: ACP_PROTOCOL_VERSION + 50,
        clientInfo: { name: "t", version: "0" },
      }),
    );
    const res = await server.handleFrame(raw);
    expect(res?.result).toMatchObject({ protocolVersion: ACP_PROTOCOL_VERSION });
  });
});

describe("AcpServer.handleFrame — session lifecycle", () => {
  it("session/new fails with ServerNotInitialized before initialize", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    const raw = encodeJsonRpc(makeRequest(2, ACP_METHODS.SessionNew, { cwd: "/tmp" }));
    const res = await server.handleFrame(raw);
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.ServerNotInitialized);
  });

  it("session/new succeeds after initialize", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(makeRequest(2, ACP_METHODS.SessionNew, { cwd: "/tmp" })),
    );
    expect(res?.result).toEqual({ sessionId: "s1" });
  });

  it("session/new rejects missing cwd with InvalidParams", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(makeRequest(2, ACP_METHODS.SessionNew, {})),
    );
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidParams);
  });

  it("session/new forwards mcpServers and hint metadata to the handler", async () => {
    const bus = createRecordingBus();
    let captured: AcpNewSessionParams | undefined;
    const server = new AcpServer({
      handlers: mkHandlers({
        newSession: async (p) => {
          captured = p;
          return { sessionId: "hinted" };
        },
      }),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const params: AcpNewSessionParams = {
      cwd: "/tmp",
      mcpServers: [
        { transport: "stdio", name: "fs", command: "/usr/bin/mcp-fs", args: ["--stdio"] },
      ],
      providerHint: "anthropic",
      modelHint: "claude-4",
    };
    await server.handleFrame(encodeJsonRpc(makeRequest(2, ACP_METHODS.SessionNew, params)));
    expect(captured?.cwd).toBe("/tmp");
    expect(captured?.mcpServers?.[0]?.name).toBe("fs");
    expect(captured?.providerHint).toBe("anthropic");
  });
});

describe("AcpServer.handleFrame — session/prompt", () => {
  it("emits session/update notifications + returns stopReason", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(
        makeRequest(3, ACP_METHODS.SessionPrompt, {
          sessionId: "s1",
          prompt: [{ type: "text", text: "hi" }],
        }),
      ),
    );
    expect(res?.result).toMatchObject({ stopReason: "end_turn" });

    const notifs = bus.notifications();
    const updates = notifs.filter((n) => n.method === ACP_METHODS.SessionUpdate);
    expect(updates).toHaveLength(1);
    const first = updates[0]?.params as {
      sessionId: string;
      update: { sessionUpdate: string };
    };
    expect(first.sessionId).toBe("s1");
    expect(first.update.sessionUpdate).toBe("agent_message_chunk");
  });

  it("InvalidParams when session/prompt misses sessionId", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(makeRequest(4, ACP_METHODS.SessionPrompt, {
        prompt: [{ type: "text", text: "hi" }],
      })),
    );
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidParams);
  });

  it("InvalidParams when prompt field is missing/not an array", async () => {
    const bus = createRecordingBus();
    const server = new AcpServer({
      handlers: mkHandlers(),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(
        makeRequest(4, ACP_METHODS.SessionPrompt, { sessionId: "s1", prompt: "hi" }),
      ),
    );
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidParams);
  });
});

describe("AcpServer.handleFrame — session/cancel", () => {
  it("honours session/cancel when delivered as a notification", async () => {
    const bus = createRecordingBus();
    let cancelled: string | null = null;
    const server = new AcpServer({
      handlers: mkHandlers({
        cancel: async (p) => {
          cancelled = p.sessionId;
        },
      }),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(makeNotification(ACP_METHODS.SessionCancel, { sessionId: "s1" })),
    );
    expect(res).toBeUndefined();
    expect(cancelled).toBe("s1");
  });

  it("accepts session/cancel delivered as a request (legacy hosts)", async () => {
    const bus = createRecordingBus();
    let cancelled: string | null = null;
    const server = new AcpServer({
      handlers: mkHandlers({
        cancel: async (p) => {
          cancelled = p.sessionId;
        },
      }),
      serverInfo: SERVER_INFO,
      emit: bus.send,
    });
    await server.handleFrame(
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    const res = await server.handleFrame(
      encodeJsonRpc(makeRequest(9, ACP_METHODS.SessionCancel, { sessionId: "s1" })),
    );
    expect(res?.result).toEqual({ cancelled: true });
    expect(cancelled).toBe("s1");
  });
});

describe("AcpServer.handleFrame — misc", () => {
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
      encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams())),
    );
    expect(res?.error?.code).toBe(JSON_RPC_ERROR_CODES.InternalError);
    expect(res?.error?.message).toMatch(/boom/);
  });

  it("unknown notifications are ignored silently", async () => {
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
