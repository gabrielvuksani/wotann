/**
 * C16 follow-up — runtime-backed ACP handlers (ACP v1).
 *
 * Exercises the bridge between WotannRuntime-shaped stream output and
 * the v1 AcpHandlers contract. Uses a fake runtime so these tests stay
 * fast and deterministic.
 */

import { describe, it, expect } from "vitest";
import { createRuntimeAcpHandlers, type RuntimeDep } from "../../src/acp/runtime-handlers.js";
import type { StreamChunk } from "../../src/providers/types.js";
import type { WotannQueryOptions } from "../../src/core/types.js";
import {
  ACP_PROTOCOL_VERSION,
  type AcpInitializeParams,
  type AcpSessionUpdateNotification,
} from "../../src/acp/protocol.js";

function fakeRuntime(chunks: readonly StreamChunk[]): RuntimeDep {
  return {
    async *query(_options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function slowRuntime(chunks: readonly StreamChunk[], delayMs: number): RuntimeDep {
  return {
    async *query(_options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) {
        await new Promise((r) => setTimeout(r, delayMs));
        yield chunk;
      }
    },
  };
}

const clientInfo = { name: "test", version: "0" } as const;

function initParams(): AcpInitializeParams {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true } },
    clientInfo,
  };
}

function extractText(n: AcpSessionUpdateNotification): string {
  const u = n.update;
  if (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "agent_thought_chunk") {
    if (u.content.type === "text") return u.content.text;
  }
  return "";
}

describe("createRuntimeAcpHandlers — initialize", () => {
  it("reports the negotiated protocol version and v1 capability matrix", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    const result = await handlers.initialize(initParams());
    expect(result.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(result.agentCapabilities.loadSession).toBe(true);
    expect(result.agentCapabilities.promptCapabilities?.image).toBe(true);
    expect(result.agentCapabilities.mcpCapabilities?.stdio).toBe(true);
    expect(result.agentInfo?.name).toBe("wotann");
  });

  it("honours capability overrides", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: fakeRuntime([]),
      capabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        mcpCapabilities: { stdio: false, http: false, sse: false },
      },
    });
    const result = await handlers.initialize(initParams());
    expect(result.agentCapabilities.loadSession).toBe(false);
    expect(result.agentCapabilities.promptCapabilities?.image).toBe(false);
    expect(result.agentCapabilities.mcpCapabilities?.http).toBe(false);
  });

  it("advertises wotann thread-ops via _meta by default", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    const result = await handlers.initialize(initParams());
    const meta = result.agentCapabilities._meta as
      | { "wotann/thread-ops"?: unknown }
      | undefined;
    expect(meta?.["wotann/thread-ops"]).toBeDefined();
  });
});

describe("createRuntimeAcpHandlers — sessionNew", () => {
  it("returns a unique sessionId per call", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    const s1 = await handlers.sessionNew({ cwd: "/a" });
    const s2 = await handlers.sessionNew({ cwd: "/b" });
    expect(s1.sessionId).not.toEqual(s2.sessionId);
    expect(s1.sessionId.startsWith("acp-sess-")).toBe(true);
  });

  it("accepts mcpServers in session/new without erroring", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    const result = await handlers.sessionNew({
      cwd: "/tmp",
      mcpServers: [
        { transport: "stdio", name: "local-fs", command: "/usr/bin/mcp-fs" },
      ],
    });
    expect(result.sessionId).toMatch(/^acp-sess-/);
  });
});

describe("createRuntimeAcpHandlers — sessionPrompt", () => {
  it("streams runtime text chunks as agent_message_chunk session/update notifications", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: fakeRuntime([
        { type: "text", content: "Hello" },
        { type: "text", content: " world" },
        { type: "done", content: "", tokensUsed: 42 },
      ]),
    });
    await handlers.initialize(initParams());
    const session = await handlers.sessionNew({ cwd: "/tmp" });

    const updates: AcpSessionUpdateNotification[] = [];
    const result = await handlers.sessionPrompt(
      { sessionId: session.sessionId, prompt: [{ type: "text", text: "hi" }] },
      (n) => updates.push(n),
    );

    const texts = updates
      .filter((n) => n.update.sessionUpdate === "agent_message_chunk")
      .map(extractText);
    expect(texts).toEqual(["Hello", " world"]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("forwards tool_use chunks as tool_call updates", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: fakeRuntime([
        { type: "thinking", content: "let me think" },
        {
          type: "tool_use",
          content: "",
          toolName: "find_symbol",
          toolInput: { name: "WotannRuntime" },
        },
        { type: "text", content: "done" },
      ]),
    });
    await handlers.initialize(initParams());
    const session = await handlers.sessionNew({ cwd: "/tmp" });

    const updates: AcpSessionUpdateNotification[] = [];
    await handlers.sessionPrompt(
      { sessionId: session.sessionId, prompt: [{ type: "text", text: "q" }] },
      (n) => updates.push(n),
    );

    const kinds = updates.map((u) => u.update.sessionUpdate);
    expect(kinds).toContain("agent_thought_chunk");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("agent_message_chunk");

    const toolCall = updates.find((n) => n.update.sessionUpdate === "tool_call");
    const raw = (toolCall!.update as { title: string; rawInput?: unknown });
    expect(raw.title).toBe("find_symbol");
    expect(raw.rawInput).toEqual({ name: "WotannRuntime" });
  });

  it("maps error chunks to stopReason=error and inlines the error text", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: fakeRuntime([{ type: "error", content: "boom" }]),
    });
    await handlers.initialize(initParams());
    const session = await handlers.sessionNew({ cwd: "/tmp" });

    const updates: AcpSessionUpdateNotification[] = [];
    const result = await handlers.sessionPrompt(
      { sessionId: session.sessionId, prompt: [{ type: "text", text: "q" }] },
      (n) => updates.push(n),
    );
    expect(result.stopReason).toBe("error");
    expect(updates.some((u) => extractText(u).includes("[error] boom"))).toBe(true);
  });

  it("sessionCancel aborts an in-flight sessionPrompt with stopReason=cancelled", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: slowRuntime(
        [
          { type: "text", content: "first" },
          { type: "text", content: "second" },
          { type: "text", content: "third" },
        ],
        10,
      ),
    });
    await handlers.initialize(initParams());
    const session = await handlers.sessionNew({ cwd: "/tmp" });

    const promise = handlers.sessionPrompt(
      { sessionId: session.sessionId, prompt: [{ type: "text", text: "q" }] },
      () => {},
    );
    // Let the first chunk fire, then cancel.
    await new Promise((r) => setTimeout(r, 15));
    await handlers.sessionCancel({ sessionId: session.sessionId });
    const result = await promise;

    expect(result.stopReason).toBe("cancelled");
  });

  it("unknown session resolves with stopReason=error", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    const result = await handlers.sessionPrompt(
      { sessionId: "no-such-session", prompt: [{ type: "text", text: "q" }] },
      () => {},
    );
    expect(result.stopReason).toBe("error");
  });

  it("multi-modal prompts flatten into a single text query", async () => {
    const received: WotannQueryOptions[] = [];
    const handlers = createRuntimeAcpHandlers({
      runtime: {
        async *query(options) {
          received.push(options);
          yield { type: "text", content: "ok" };
        },
      },
    });
    await handlers.initialize(initParams());
    const session = await handlers.sessionNew({ cwd: "/tmp" });
    await handlers.sessionPrompt(
      {
        sessionId: session.sessionId,
        prompt: [
          { type: "text", text: "part one " },
          { type: "image", data: "abc", mimeType: "image/png" },
          { type: "text", text: " part two" },
        ],
      },
      () => {},
    );
    expect(received[0]?.prompt).toContain("part one");
    expect(received[0]?.prompt).toContain("part two");
    expect(received[0]?.prompt).toContain("[image:image/png]");
  });
});
