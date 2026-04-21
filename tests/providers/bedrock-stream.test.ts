/**
 * Bedrock stream parser regression tests — P0-4a.
 *
 * The pre-fix adapter scanned the raw bytes of Bedrock's Converse
 * event-stream with regex against JSON-shaped substrings. Three known
 * failure modes were observed in audit:
 *
 *   (a) Payload straddles TCP chunk boundary — the regex matches the
 *       partial half and swallows the tail (or double-emits).
 *   (b) JSON payload contains `}"` inside a string value — the lazy
 *       regex `[^}]*?` terminates early and the payload is truncated.
 *   (c) Binary event-stream headers interleaved between payloads show
 *       up as UTF-8 replacement characters in the decoded text.
 *
 * This suite locks those three failure modes down against the proper
 * AWS event-stream binary framing codec (`bedrock-eventstream.ts`):
 * frames decoded from raw binary bytes, not regex-matched JSON.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  decodeEventStreamFrames,
  encodeEventStreamMessage,
  getEventType,
  getMessageType,
} from "../../src/providers/bedrock-eventstream.js";
import { createBedrockAdapter } from "../../src/providers/bedrock-signer.js";
import type { UnifiedQueryOptions } from "../../src/providers/types.js";

// ── Codec unit tests ───────────────────────────────────────────────

describe("bedrock-eventstream: framing codec", () => {
  it("round-trips a single string-header frame", () => {
    const payload = Buffer.from(JSON.stringify({ delta: { text: "hello" } }));
    const frame = encodeEventStreamMessage(
      { ":event-type": "contentBlockDelta", ":content-type": "application/json" },
      payload,
    );
    const { messages, remaining } = decodeEventStreamFrames(Buffer.from(frame));
    expect(messages).toHaveLength(1);
    expect(remaining).toHaveLength(0);
    const msg = messages[0]!;
    expect(getEventType(msg)).toBe("contentBlockDelta");
    expect(msg.headers[":content-type"]).toBe("application/json");
    expect(msg.payload.toString("utf-8")).toContain('"text":"hello"');
  });

  it("decodes multiple frames concatenated in one buffer", () => {
    const p1 = encodeEventStreamMessage(
      { ":event-type": "contentBlockDelta" },
      Buffer.from('{"delta":{"text":"a"}}'),
    );
    const p2 = encodeEventStreamMessage(
      { ":event-type": "contentBlockStop" },
      Buffer.from('{"contentBlockIndex":0}'),
    );
    const combined = Buffer.concat([Buffer.from(p1), Buffer.from(p2)]);
    const { messages, remaining } = decodeEventStreamFrames(combined);
    expect(messages).toHaveLength(2);
    expect(remaining).toHaveLength(0);
    expect(getEventType(messages[0]!)).toBe("contentBlockDelta");
    expect(getEventType(messages[1]!)).toBe("contentBlockStop");
  });

  it("handles a buffer that ends mid-frame — returns partial bytes as `remaining`", () => {
    // Partial frame case (a): TCP chunk boundary. The decoder must
    // preserve the incomplete bytes so the caller can append the next
    // chunk and try again without losing data.
    const full = encodeEventStreamMessage(
      { ":event-type": "contentBlockDelta" },
      Buffer.from('{"delta":{"text":"boundary test"}}'),
    );
    // Cut in half to simulate TCP fragmentation.
    const half = Buffer.from(full).subarray(0, 24);
    const { messages, remaining } = decodeEventStreamFrames(half);
    expect(messages).toHaveLength(0);
    expect(remaining.length).toBe(24);
  });

  it("preserves payload containing `}\"` — the regex truncation bug (b)", () => {
    // The pre-fix regex `[^}]*?` greedily stopped at the first `}`,
    // which meant any payload like {"text":"value }"} was truncated.
    // Binary framing is byte-exact: length is in the prelude, not
    // inferred from content.
    const payload = Buffer.from('{"delta":{"text":"value }\" with brace-quote"}}');
    const frame = encodeEventStreamMessage({ ":event-type": "contentBlockDelta" }, payload);
    const { messages } = decodeEventStreamFrames(Buffer.from(frame));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.payload.toString("utf-8")).toBe(
      '{"delta":{"text":"value }" with brace-quote"}}',
    );
  });

  it("preserves payload with binary-interleaved bytes — regression for (c)", () => {
    // Any byte sequence is fair game in the payload. The pre-fix
    // regex saw raw bytes decoded as UTF-8 with replacement chars and
    // mismatched. With framing, we know the payload bytes exactly.
    const payload = Buffer.concat([
      Buffer.from('{"delta":{"text":"'),
      Buffer.from([0xff, 0xfe, 0xfd]), // would become �� via utf-8
      Buffer.from('"}}'),
    ]);
    const frame = encodeEventStreamMessage({ ":event-type": "contentBlockDelta" }, payload);
    const { messages } = decodeEventStreamFrames(Buffer.from(frame));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.payload.length).toBe(payload.length);
    // Byte-identity — no corruption from replacement chars.
    expect(Buffer.compare(messages[0]!.payload, payload)).toBe(0);
  });

  it("exposes :message-type header for routing event vs exception", () => {
    const frame = encodeEventStreamMessage(
      { ":message-type": "event", ":event-type": "contentBlockDelta" },
      Buffer.from("{}"),
    );
    const { messages } = decodeEventStreamFrames(Buffer.from(frame));
    expect(getMessageType(messages[0]!)).toBe("event");
  });

  it("throws on a structurally-invalid frame (total_length < prelude+headers+trailer)", () => {
    const bad = Buffer.alloc(12);
    // total_length = 10 (impossibly small)
    bad.writeUInt32BE(10, 0);
    bad.writeUInt32BE(0, 4);
    bad.writeUInt32BE(0, 8);
    expect(() => decodeEventStreamFrames(bad)).toThrow(/invalid/i);
  });
});

// ── Adapter integration tests ──────────────────────────────────────

describe("bedrock-signer: adapter stream parser using event-stream framing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env["AWS_ACCESS_KEY_ID"] = "AKIA_TEST";
    process.env["AWS_SECRET_ACCESS_KEY"] = "secret_test";
    process.env["AWS_REGION"] = "us-east-1";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];
    delete process.env["AWS_SESSION_TOKEN"];
    delete process.env["AWS_REGION"];
    vi.restoreAllMocks();
  });

  function mockStream(frames: Uint8Array[]) {
    const body = new ReadableStream({
      start(controller) {
        for (const f of frames) controller.enqueue(f);
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
      text: async () => "",
    } as unknown as Response);
  }

  it("emits text from a contentBlockDelta text event carrying a brace-quote sequence", async () => {
    // This payload would have been truncated by the prior regex scanner
    // because the lazy `[^}]*?` pattern would stop at the first `}`.
    const tricky = '{"delta":{"text":"value } \\" tricky","type":"text_delta"}}';
    const frame = encodeEventStreamMessage({ ":event-type": "contentBlockDelta" }, Buffer.from(tricky));
    mockStream([frame]);

    const adapter = createBedrockAdapter({
      provider: "bedrock",
      method: "aws-iam",
      billing: "api-key",
      token: "t",
      models: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    });
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      stream: true,
    };
    const collected: string[] = [];
    for await (const chunk of adapter.query(opts)) {
      if (chunk.type === "text") collected.push(chunk.content);
    }
    // Must contain the entire text, not truncated at the `}`.
    expect(collected.join("")).toBe('value } " tricky');
  });

  it("reassembles a frame split across two TCP chunks", async () => {
    // Simulate TCP fragmentation: the adapter must buffer across
    // chunks and parse only when enough bytes arrive. With the old
    // regex scanner, the partial chunk matched a malformed JSON
    // fragment and either dropped or duplicated the text.
    const full = encodeEventStreamMessage(
      { ":event-type": "contentBlockDelta" },
      Buffer.from('{"delta":{"text":"reassembled","type":"text_delta"}}'),
    );
    const buf = Buffer.from(full);
    const part1 = new Uint8Array(buf.subarray(0, 20));
    const part2 = new Uint8Array(buf.subarray(20));
    mockStream([part1, part2]);

    const adapter = createBedrockAdapter({
      provider: "bedrock",
      method: "aws-iam",
      billing: "api-key",
      token: "t",
      models: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    });
    const collected: string[] = [];
    for await (const chunk of adapter.query({
      prompt: "hi",
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      stream: true,
    })) {
      if (chunk.type === "text") collected.push(chunk.content);
    }
    // Exactly once — not duplicated, not dropped.
    expect(collected.join("")).toBe("reassembled");
  });

  it("assembles a tool_use call from contentBlockStart + delta + stop events", async () => {
    // Full tool-use lifecycle: start with name+id, deltas carry the
    // JSON input tokens, stop signals completion and parse.
    const f1 = encodeEventStreamMessage(
      { ":event-type": "contentBlockStart" },
      Buffer.from(
        '{"start":{"toolUse":{"toolUseId":"call_1","name":"get_weather"}},"contentBlockIndex":0}',
      ),
    );
    const f2 = encodeEventStreamMessage(
      { ":event-type": "contentBlockDelta" },
      Buffer.from(
        '{"delta":{"toolUse":{"input":"{\\"city\\":"}},"contentBlockIndex":0}',
      ),
    );
    const f3 = encodeEventStreamMessage(
      { ":event-type": "contentBlockDelta" },
      Buffer.from(
        '{"delta":{"toolUse":{"input":"\\"NYC\\"}"}},"contentBlockIndex":0}',
      ),
    );
    const f4 = encodeEventStreamMessage(
      { ":event-type": "contentBlockStop" },
      Buffer.from('{"contentBlockIndex":0}'),
    );
    const f5 = encodeEventStreamMessage(
      { ":event-type": "messageStop" },
      Buffer.from('{"stopReason":"tool_use"}'),
    );
    mockStream([f1, f2, f3, f4, f5]);

    const adapter = createBedrockAdapter({
      provider: "bedrock",
      method: "aws-iam",
      billing: "api-key",
      token: "t",
      models: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    });
    const toolChunks: Array<{ name?: string; input?: Record<string, unknown>; id?: string }> = [];
    let doneStopReason: string | undefined;
    for await (const chunk of adapter.query({
      prompt: "what's the weather?",
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      tools: [
        {
          name: "get_weather",
          description: "weather fetch",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
      stream: true,
    })) {
      if (chunk.type === "tool_use") {
        toolChunks.push({
          name: chunk.toolName,
          input: chunk.toolInput,
          id: chunk.toolCallId,
        });
      }
      if (chunk.type === "done") doneStopReason = chunk.stopReason;
    }
    expect(toolChunks).toHaveLength(1);
    expect(toolChunks[0]!.name).toBe("get_weather");
    expect(toolChunks[0]!.id).toBe("call_1");
    expect(toolChunks[0]!.input).toEqual({ city: "NYC" });
    expect(doneStopReason).toBe("tool_calls");
  });

  it("maps messageStop stopReason values to canonical StopReason", async () => {
    const frame = encodeEventStreamMessage(
      { ":event-type": "messageStop" },
      Buffer.from('{"stopReason":"max_tokens"}'),
    );
    mockStream([frame]);

    const adapter = createBedrockAdapter({
      provider: "bedrock",
      method: "aws-iam",
      billing: "api-key",
      token: "t",
      models: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    });
    let doneStopReason: string | undefined;
    for await (const chunk of adapter.query({
      prompt: "hi",
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      stream: true,
    })) {
      if (chunk.type === "done") doneStopReason = chunk.stopReason;
    }
    expect(doneStopReason).toBe("max_tokens");
  });

  it("routes exception-typed frames through the error channel", async () => {
    // :message-type=exception payloads carry error bodies, not events.
    // The adapter must surface these as error chunks rather than try
    // to parse them as contentBlockDelta.
    const frame = encodeEventStreamMessage(
      { ":message-type": "exception", ":exception-type": "ThrottlingException" },
      Buffer.from('{"message":"rate limited"}'),
    );
    mockStream([frame]);

    const adapter = createBedrockAdapter({
      provider: "bedrock",
      method: "aws-iam",
      billing: "api-key",
      token: "t",
      models: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    });
    const errors: string[] = [];
    for await (const chunk of adapter.query({
      prompt: "hi",
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      stream: true,
    })) {
      if (chunk.type === "error") errors.push(chunk.content);
    }
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/Throttling|rate limited/i);
  });
});
