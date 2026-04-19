/**
 * C16 — ACP stdio runtime tests (ACP v1).
 */

import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { startAcpStdio, referenceHandlers } from "../../src/acp/stdio.js";
import {
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  encodeJsonRpc,
  makeRequest,
  type AcpInitializeParams,
} from "../../src/acp/protocol.js";

class CapturingWritable extends Writable {
  private readonly chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (e?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk));
    cb();
  }
  lines(): string[] {
    return this.chunks
      .join("")
      .split("\n")
      .filter((s) => s.length > 0);
  }
}

async function withServer(
  inputLines: readonly string[],
  options: { expectedLines: number; timeoutMs?: number },
): Promise<readonly string[]> {
  const input = new PassThrough();
  const output = new CapturingWritable();
  const handle = startAcpStdio({
    handlers: referenceHandlers(),
    input,
    output,
    serverInfo: { name: "wotann-test", version: "0.0.0" },
  });
  for (const line of inputLines) input.write(line + "\n");
  input.end();

  const timeoutMs = options.timeoutMs ?? 2_000;
  await new Promise<void>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = (): void => {
      if (output.lines().length >= options.expectedLines) return resolve();
      if (Date.now() > deadline) return resolve();
      setTimeout(poll, 10);
    };
    poll();
  });
  await handle.stop();
  return output.lines();
}

function initParams(): AcpInitializeParams {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true }, terminal: false },
    clientInfo: { name: "test", version: "0" },
  };
}

describe("startAcpStdio", () => {
  it("responds to initialize over stdio with integer protocolVersion", async () => {
    const req = encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams()));
    const lines = await withServer([req], { expectedLines: 1 });
    const parsed = JSON.parse(lines[0]!) as {
      result?: { protocolVersion: number; agentInfo?: { name: string } };
    };
    expect(parsed.result?.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(parsed.result?.agentInfo?.name).toBe("wotann-reference");
  });

  it("streams session/update notifications + PromptResponse", async () => {
    const initReq = encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParams()));
    const newReq = encodeJsonRpc(makeRequest(2, ACP_METHODS.SessionNew, { cwd: "/tmp" }));
    const promptReq = encodeJsonRpc(
      makeRequest(3, ACP_METHODS.SessionPrompt, {
        sessionId: "ref-session-1",
        prompt: [{ type: "text", text: "hi" }],
      }),
    );
    const lines = await withServer([initReq, newReq, promptReq], { expectedLines: 4 });

    // Expect: init response, new response, session/update, prompt response
    const methods = lines.map((l) => {
      const msg = JSON.parse(l) as { method?: string; id?: number };
      return msg.method ?? `response:${msg.id ?? "?"}`;
    });
    expect(methods).toContain(ACP_METHODS.SessionUpdate);
    const promptResponseLine = lines.find((l) => {
      const parsed = JSON.parse(l) as { id?: number; result?: { stopReason?: string } };
      return parsed.id === 3;
    });
    expect(promptResponseLine).toBeDefined();
    const promptResult = JSON.parse(promptResponseLine!) as {
      result: { stopReason: string };
    };
    expect(promptResult.result.stopReason).toBe("end_turn");
  });

  it("ignores blank input lines", async () => {
    const req = encodeJsonRpc(makeRequest(7, ACP_METHODS.Initialize, initParams()));
    const lines = await withServer(["", "   ", req, ""], { expectedLines: 1 });
    expect(lines.length).toBe(1);
  });

  it("surfaces a ParseError response when a frame is malformed", async () => {
    const lines = await withServer(["{not json}"], { expectedLines: 1 });
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!) as { error?: { code: number } };
    expect(parsed.error?.code).toBe(-32700); // ParseError
  });
});

describe("startAcpStdio — clientProvidedMcp (Zed 0.3 parity)", () => {
  async function runWithMcpCallback(
    initParamsWithMcp: Record<string, unknown>,
  ): Promise<{ captured: Array<{ servers: ReadonlyArray<unknown> }>; lines: string[] }> {
    const input = new PassThrough();
    const output = new CapturingWritable();
    const captured: Array<{ servers: ReadonlyArray<unknown> }> = [];
    const handle = startAcpStdio({
      handlers: referenceHandlers(),
      input,
      output,
      serverInfo: { name: "wotann-test", version: "0.0.0" },
      onClientProvidedMcp: async (mcp) => {
        captured.push({ servers: mcp.servers });
      },
    });
    const req = encodeJsonRpc(makeRequest(1, ACP_METHODS.Initialize, initParamsWithMcp));
    input.write(req + "\n");
    input.end();
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 2_000;
      const poll = (): void => {
        if (output.lines().length >= 1) return resolve();
        if (Date.now() > deadline) return resolve();
        setTimeout(poll, 10);
      };
      poll();
    });
    await handle.stop();
    return { captured, lines: output.lines() };
  }

  it("calls onClientProvidedMcp callback when servers are present on initialize", async () => {
    const params = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: { name: "zed", version: "0.3.0" },
      clientProvidedMcp: {
        servers: [
          { transport: "stdio", name: "fs-mcp", command: "/usr/bin/mcp-fs", args: ["--stdio"] },
          { transport: "http", name: "http-mcp", url: "https://tools.example.com/mcp" },
        ],
      },
    };
    const { captured, lines } = await runWithMcpCallback(params);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.servers).toHaveLength(2);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { result?: { protocolVersion: number } };
    expect(parsed.result?.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
  });

  it("does not call the callback when clientProvidedMcp is omitted", async () => {
    const params = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: { name: "zed", version: "0.3.0" },
    };
    const { captured } = await runWithMcpCallback(params);
    expect(captured).toHaveLength(0);
  });

  it("preserves initialize result shape when callback is wired", async () => {
    const params = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: { name: "zed", version: "0.3.0" },
      clientProvidedMcp: { servers: [] },
    };
    const { lines } = await runWithMcpCallback(params);
    const parsed = JSON.parse(lines[0]!) as {
      result?: { protocolVersion: number; agentInfo?: { name: string } };
    };
    expect(parsed.result?.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(parsed.result?.agentInfo).toBeDefined();
  });
});

describe("referenceHandlers", () => {
  it("initialize returns an integer protocol version and agentInfo", async () => {
    const h = referenceHandlers();
    const r = await h.initialize(initParams());
    expect(r.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(r.agentInfo?.name).toBe("wotann-reference");
    expect(r.agentCapabilities).toBeDefined();
  });

  it("increments session counter across session/new calls", async () => {
    const h = referenceHandlers();
    const s1 = await h.sessionNew({ cwd: "/a" });
    const s2 = await h.sessionNew({ cwd: "/b" });
    expect(s1.sessionId).toBe("ref-session-1");
    expect(s2.sessionId).toBe("ref-session-2");
  });

  it("sessionPrompt emits exactly one session/update and returns end_turn", async () => {
    const h = referenceHandlers();
    const updates: unknown[] = [];
    const result = await h.sessionPrompt(
      { sessionId: "s1", prompt: [{ type: "text", text: "hi" }] },
      (n) => updates.push(n),
    );
    expect(updates).toHaveLength(1);
    expect(result.stopReason).toBe("end_turn");
  });
});
