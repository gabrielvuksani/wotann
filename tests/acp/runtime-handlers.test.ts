/**
 * C16 follow-up — runtime-backed ACP handlers.
 *
 * Exercises the bridge between WotannRuntime-shaped stream output and
 * the AcpHandlers contract. Uses a fake runtime so these tests stay
 * fast and deterministic.
 */

import { describe, it, expect } from "vitest";
import { createRuntimeAcpHandlers, type RuntimeDep } from "../../src/acp/runtime-handlers.js";
import type { StreamChunk } from "../../src/providers/types.js";
import type { WotannQueryOptions } from "../../src/core/types.js";
import { ACP_PROTOCOL_VERSION } from "../../src/acp/protocol.js";

function fakeRuntime(chunks: readonly StreamChunk[]): RuntimeDep {
  return {
    async *query(_options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function slowRuntime(
  chunks: readonly StreamChunk[],
  delayMs: number,
): RuntimeDep {
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

describe("createRuntimeAcpHandlers", () => {
  it("initialize reports the negotiated protocol version and capability matrix", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    const result = await handlers.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    expect(result.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(result.capabilities.tools).toBe(true);
    expect(result.capabilities.prompts).toBe(true);
    expect(result.capabilities.sampling).toBe(false);
    expect(result.serverInfo.name).toBe("wotann");
  });

  it("initialize honours capability overrides", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: fakeRuntime([]),
      capabilities: { tools: false, prompts: true, sampling: true },
    });
    const result = await handlers.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    expect(result.capabilities).toEqual({
      tools: false,
      prompts: true,
      sampling: true,
    });
  });

  it("sessionCreate returns a unique sessionId per call", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    const s1 = await handlers.sessionCreate({ rootUri: "file:///a" });
    const s2 = await handlers.sessionCreate({ rootUri: "file:///b" });
    expect(s1.sessionId).not.toEqual(s2.sessionId);
    expect(s1.sessionId.startsWith("acp-sess-")).toBe(true);
  });

  it("sessionPrompt streams runtime text chunks as partials and terminates with stop", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: fakeRuntime([
        { type: "text", content: "Hello" },
        { type: "text", content: " world" },
        { type: "done", content: "", tokensUsed: 42 },
      ]),
    });
    await handlers.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    const session = await handlers.sessionCreate({ rootUri: "file:///tmp" });

    const partials: { kind: string; content: string }[] = [];
    let complete: { finishReason: string; tokens?: number } | null = null;

    await handlers.sessionPrompt(
      { sessionId: session.sessionId, text: "hi" },
      (p) => partials.push({ kind: p.kind, content: p.content }),
      (c) =>
        (complete = {
          finishReason: c.finishReason,
          tokens: c.usage?.outputTokens,
        }),
    );

    expect(partials).toEqual([
      { kind: "text", content: "Hello" },
      { kind: "text", content: " world" },
    ]);
    expect(complete).not.toBeNull();
    expect(complete!.finishReason).toBe("stop");
    expect(complete!.tokens).toBe(42);
  });

  it("sessionPrompt forwards tool_use and thinking chunks with kind preserved", async () => {
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
    await handlers.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    const session = await handlers.sessionCreate({ rootUri: "file:///tmp" });

    const partials: { kind: string; toolName?: string }[] = [];
    await handlers.sessionPrompt(
      { sessionId: session.sessionId, text: "q" },
      (p) => partials.push({ kind: p.kind, toolName: p.toolName }),
      () => {},
    );

    expect(partials.find((p) => p.kind === "thinking")).toBeDefined();
    expect(partials.find((p) => p.kind === "tool_use")?.toolName).toBe("find_symbol");
    expect(partials.find((p) => p.kind === "text")).toBeDefined();
  });

  it("sessionPrompt maps error chunks to finishReason: error", async () => {
    const handlers = createRuntimeAcpHandlers({
      runtime: fakeRuntime([{ type: "error", content: "boom" }]),
    });
    await handlers.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    const session = await handlers.sessionCreate({ rootUri: "file:///tmp" });

    let finishReason = "stop";
    await handlers.sessionPrompt(
      { sessionId: session.sessionId, text: "q" },
      () => {},
      (c) => {
        finishReason = c.finishReason;
      },
    );
    expect(finishReason).toBe("error");
  });

  it("sessionCancel aborts an in-flight sessionPrompt with finishReason: cancelled", async () => {
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
    await handlers.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    const session = await handlers.sessionCreate({ rootUri: "file:///tmp" });

    let complete: { finishReason: string } | null = null;
    const promise = handlers.sessionPrompt(
      { sessionId: session.sessionId, text: "q" },
      () => {},
      (c) => (complete = { finishReason: c.finishReason }),
    );
    // Let the first chunk fire, then cancel.
    await new Promise((r) => setTimeout(r, 15));
    await handlers.sessionCancel({ sessionId: session.sessionId });
    await promise;

    expect(complete).not.toBeNull();
    expect(complete!.finishReason).toBe("cancelled");
  });

  it("sessionPrompt against an unknown session resolves with finishReason: error", async () => {
    const handlers = createRuntimeAcpHandlers({ runtime: fakeRuntime([]) });
    let complete: { finishReason: string } | null = null;
    await handlers.sessionPrompt(
      { sessionId: "no-such-session", text: "q" },
      () => {},
      (c) => (complete = { finishReason: c.finishReason }),
    );
    expect(complete).not.toBeNull();
    expect(complete!.finishReason).toBe("error");
  });
});
