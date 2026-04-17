/**
 * C16 — ACP stdio runtime tests.
 */

import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { startAcpStdio, referenceHandlers } from "../../src/acp/stdio.js";
import { ACP_METHODS, ACP_PROTOCOL_VERSION, encodeJsonRpc, makeRequest } from "../../src/acp/protocol.js";

class CapturingWritable extends Writable {
  private readonly chunks: string[] = [];
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
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
    const poll = () => {
      if (output.lines().length >= options.expectedLines) return resolve();
      if (Date.now() > deadline) return resolve();
      setTimeout(poll, 10);
    };
    poll();
  });
  await handle.stop();
  return output.lines();
}

describe("startAcpStdio", () => {
  it("responds to initialize over stdio", async () => {
    const req = encodeJsonRpc(
      makeRequest(1, ACP_METHODS.Initialize, {
        protocolVersion: ACP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    );
    const lines = await withServer([req], { expectedLines: 1 });
    const parsed = JSON.parse(lines[0]!) as { result?: { protocolVersion: string } };
    expect(parsed.result?.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
  });

  it("streams prompt/partial + prompt/complete notifications + accepted response", async () => {
    const initReq = encodeJsonRpc(
      makeRequest(1, ACP_METHODS.Initialize, {
        protocolVersion: ACP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    );
    const createReq = encodeJsonRpc(
      makeRequest(2, ACP_METHODS.SessionCreate, { rootUri: "file:///tmp" }),
    );
    const promptReq = encodeJsonRpc(
      makeRequest(3, ACP_METHODS.SessionPrompt, { sessionId: "ref-session-1", text: "hi" }),
    );
    const lines = await withServer([initReq, createReq, promptReq], { expectedLines: 5 });

    // Expect: init response, create response, partial notification,
    // complete notification, prompt response
    const methods = lines.map((l) => {
      const msg = JSON.parse(l) as { method?: string; id?: number };
      return msg.method ?? `response:${msg.id ?? "?"}`;
    });
    expect(methods).toContain(ACP_METHODS.PromptPartial);
    expect(methods).toContain(ACP_METHODS.PromptComplete);
  });

  it("ignores blank input lines", async () => {
    const req = encodeJsonRpc(
      makeRequest(7, ACP_METHODS.Initialize, {
        protocolVersion: ACP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    );
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

describe("referenceHandlers", () => {
  it("initialize returns the protocol version", async () => {
    const h = referenceHandlers();
    const r = await h.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(r.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
  });

  it("increments session counter across creates", async () => {
    const h = referenceHandlers();
    const s1 = await h.sessionCreate({ rootUri: "file:///a" });
    const s2 = await h.sessionCreate({ rootUri: "file:///b" });
    expect(s1.sessionId).toBe("ref-session-1");
    expect(s2.sessionId).toBe("ref-session-2");
  });

  it("sessionPrompt emits one partial and one complete", async () => {
    const h = referenceHandlers();
    const partials: unknown[] = [];
    const completes: unknown[] = [];
    await h.sessionPrompt(
      { sessionId: "s1", text: "hi" },
      (p) => partials.push(p),
      (c) => completes.push(c),
    );
    expect(partials).toHaveLength(1);
    expect(completes).toHaveLength(1);
  });
});
