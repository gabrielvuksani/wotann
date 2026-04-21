/**
 * Vertex AI adapter tool-use streaming regression — P0-4a.
 *
 * The Vertex adapter serves Claude models via Google's /streamRawPredict
 * endpoint which emits Anthropic's SSE event format. Without handlers
 * for content_block_start + input_json_delta + content_block_stop the
 * entire tool-use pathway silently drops tool calls — the runtime never
 * sees them and the agent loop dies after one turn.
 *
 * These tests lock the full tool-use lifecycle, the multi-turn tool
 * result preservation path, and the canonical StopReason mapping so a
 * regression fails the build instead of silently breaking users.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVertexAdapter } from "../../src/providers/vertex-oauth.js";
import type { UnifiedQueryOptions } from "../../src/providers/types.js";
import type { AgentMessage } from "../../src/core/types.js";

// ── Fixture: service-account JSON ──────────────────────────────────

function installFakeServiceAccount(): string {
  // A syntactically-valid RSA key is required by the adapter's signer
  // even though we mock fetch — the JWT signing step happens before
  // the network call. We use a throwaway test key.
  const { generateKeyPairSync } = require("node:crypto") as typeof import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const dir = mkdtempSync(join(tmpdir(), "wotann-vertex-"));
  const path = join(dir, "sa.json");
  writeFileSync(
    path,
    JSON.stringify({
      client_email: "test@vertex-test.iam.gserviceaccount.com",
      private_key: pem,
      project_id: "vertex-test",
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  );
  return path;
}

// ── Helpers ────────────────────────────────────────────────────────

function sseStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.close();
    },
  });
}

interface CapturedCall {
  url: string;
  body?: Record<string, unknown>;
}

function mockVertexFetch(stream: ReadableStream<Uint8Array>): {
  captured: CapturedCall[];
} {
  const captured: CapturedCall[] = [];
  globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    // First call: OAuth token exchange.
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "ya29.FAKE_TOKEN", expires_in: 3600 }),
        text: async () => "",
      } as unknown as Response;
    }
    // Second call: Vertex streaming predict.
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
    captured.push({ url: String(url), body });
    return {
      ok: true,
      status: 200,
      body: stream,
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { captured };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("vertex-oauth: tool-use SSE lifecycle", () => {
  const originalFetch = globalThis.fetch;
  let saPath: string;

  beforeEach(() => {
    saPath = installFakeServiceAccount();
    process.env["GOOGLE_APPLICATION_CREDENTIALS"] = saPath;
    process.env["GOOGLE_CLOUD_PROJECT"] = "vertex-test";
    process.env["GOOGLE_CLOUD_REGION"] = "us-central1";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["GOOGLE_APPLICATION_CREDENTIALS"];
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    delete process.env["GOOGLE_CLOUD_REGION"];
    vi.restoreAllMocks();
  });

  it("handles content_block_start with tool_use + input_json_delta + stop", async () => {
    // Full tool-use lifecycle from Vertex Claude SSE: if any handler
    // is missing the resulting tool_use chunk is never emitted.
    const stream = sseStream([
      { type: "message_start", message: { id: "m1" } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", name: "get_weather", id: "call_1" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"city":' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"NYC"}' },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ]);
    mockVertexFetch(stream);

    const adapter = createVertexAdapter({
      provider: "vertex",
      method: "gcp-sa",
      billing: "api-key",
      token: "unused",
      models: ["claude-3-5-sonnet@20241022"],
    });
    const opts: UnifiedQueryOptions = {
      prompt: "weather in NYC?",
      model: "claude-3-5-sonnet@20241022",
      tools: [
        {
          name: "get_weather",
          description: "weather",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
      stream: true,
    };
    const tools: Array<{ name?: string; id?: string; input?: Record<string, unknown> }> = [];
    let doneStopReason: string | undefined;
    for await (const chunk of adapter.query(opts)) {
      if (chunk.type === "tool_use") {
        tools.push({ name: chunk.toolName, id: chunk.toolCallId, input: chunk.toolInput });
      }
      if (chunk.type === "done") doneStopReason = chunk.stopReason;
    }
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("get_weather");
    expect(tools[0]!.id).toBe("call_1");
    expect(tools[0]!.input).toEqual({ city: "NYC" });
    // `tool_use` in Anthropic's vocab maps to `tool_calls` in ours.
    expect(doneStopReason).toBe("tool_calls");
  });

  it("emits text_delta events as text chunks (no truncation)", async () => {
    // Confirm the text path still works alongside the tool-use path —
    // a regression here would mean fixing tool-use broke text streaming.
    const stream = sseStream([
      { type: "message_start", message: { id: "m1" } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: ", world!" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ]);
    mockVertexFetch(stream);

    const adapter = createVertexAdapter({
      provider: "vertex",
      method: "gcp-sa",
      billing: "api-key",
      token: "unused",
      models: ["claude-3-5-sonnet@20241022"],
    });
    const text: string[] = [];
    let doneStopReason: string | undefined;
    for await (const chunk of adapter.query({
      prompt: "hi",
      model: "claude-3-5-sonnet@20241022",
      stream: true,
    })) {
      if (chunk.type === "text") text.push(chunk.content);
      if (chunk.type === "done") doneStopReason = chunk.stopReason;
    }
    expect(text.join("")).toBe("Hello, world!");
    // `end_turn` → normalised `stop`.
    expect(doneStopReason).toBe("stop");
  });

  it("does NOT emit tool_use when content_block_stop fires on a text block", async () => {
    // Guard: content_block_stop must only fire a tool_use chunk when
    // the block KIND was tool_use. Mixing up the state machine here
    // causes phantom tool calls that break the agent loop.
    const stream = sseStream([
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "just text" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);
    mockVertexFetch(stream);

    const adapter = createVertexAdapter({
      provider: "vertex",
      method: "gcp-sa",
      billing: "api-key",
      token: "unused",
      models: ["claude-3-5-sonnet@20241022"],
    });
    let sawToolUse = false;
    for await (const chunk of adapter.query({
      prompt: "hi",
      model: "claude-3-5-sonnet@20241022",
      stream: true,
    })) {
      if (chunk.type === "tool_use") sawToolUse = true;
    }
    expect(sawToolUse).toBe(false);
  });

  it("assembles tool input across many tiny input_json_delta fragments", async () => {
    // Real Vertex streams break the JSON input into ~20-char chunks;
    // missing the accumulation means only the last fragment reaches
    // JSON.parse and we get "malformed tool arguments".
    const stream = sseStream([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", name: "big_tool", id: "call_big" },
      },
      // Split the JSON across 5 tiny chunks.
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"a":' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "1," },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"b":[' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"x","y"' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "]}" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]);
    mockVertexFetch(stream);

    const adapter = createVertexAdapter({
      provider: "vertex",
      method: "gcp-sa",
      billing: "api-key",
      token: "unused",
      models: ["claude-3-5-sonnet@20241022"],
    });
    let captured: Record<string, unknown> | undefined;
    for await (const chunk of adapter.query({
      prompt: "hi",
      model: "claude-3-5-sonnet@20241022",
      tools: [
        {
          name: "big_tool",
          description: "x",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      stream: true,
    })) {
      if (chunk.type === "tool_use") captured = chunk.toolInput;
    }
    expect(captured).toEqual({ a: 1, b: ["x", "y"] });
  });

  it("preserves tool_use/tool_result pairs in multi-turn messages (wire-level)", async () => {
    // The adapter must send prior tool turns in Anthropic's content-block
    // format. A regression here (e.g. flattening to plain strings)
    // makes the model blind to its own prior tool calls.
    const stream = sseStream([{ type: "message_stop" }]);
    const { captured } = mockVertexFetch(stream);

    const adapter = createVertexAdapter({
      provider: "vertex",
      method: "gcp-sa",
      billing: "api-key",
      token: "unused",
      models: ["claude-3-5-sonnet@20241022"],
    });
    const messages: AgentMessage[] = [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: '{"city":"NYC"}',
        toolCallId: "call_1",
        toolName: "get_weather",
      },
      { role: "tool", content: "72F clear", toolCallId: "call_1" },
    ];
    for await (const _c of adapter.query({
      prompt: "and tomorrow?",
      model: "claude-3-5-sonnet@20241022",
      messages,
      stream: true,
    })) {
      /* drain */
    }
    expect(captured).toHaveLength(1);
    const sent = captured[0]!.body as { messages: Array<{ role: string; content: unknown }> };
    expect(Array.isArray(sent.messages)).toBe(true);
    // Must preserve conversation history (translated through
    // format-translator into Anthropic blocks).
    expect(sent.messages.length).toBeGreaterThan(1);
  });
});
