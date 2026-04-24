/**
 * Tier 12 T12.21 — OpenCode (sst) adapter tests.
 *
 * Uses a stub fetcher + ReadableStream helper so the streaming SSE
 * lifecycle is exercised end-to-end without a live OpenCode server.
 * Covers validation, text streaming, tool-call reassembly, error
 * surfaces, listModels, and isAvailable.
 */

import { describe, it, expect } from "vitest";
import {
  createOpenCodeSstAdapter,
  sseReadableStream,
  toSseBody,
  type OpenCodeFetcher,
  type OpenCodeStreamChunk,
  type OpenCodeSstConfig,
} from "../../src/providers/opencode-sst-adapter.js";

// ── Helpers ──────────────────────────────────────────────

function makeStreamingFetcher(
  sseBodyOrChunks: string | readonly unknown[],
): OpenCodeFetcher {
  const body =
    typeof sseBodyOrChunks === "string" ? sseBodyOrChunks : toSseBody(sseBodyOrChunks);
  return async (_url, _init) => ({
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => null,
    body: sseReadableStream(body),
  });
}

function makeJsonFetcher(status: number, body: unknown): OpenCodeFetcher {
  const textBody = typeof body === "string" ? body : JSON.stringify(body);
  return async (_url, _init) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => textBody,
    json: async () => body,
    body: null,
  });
}

function baseConfig(overrides: Partial<OpenCodeSstConfig> = {}): OpenCodeSstConfig {
  return {
    baseUrl: "https://api.opencode.sst.dev",
    apiKey: "test-key",
    ...overrides,
  };
}

async function collectChunks(
  gen: AsyncGenerator<OpenCodeStreamChunk>,
): Promise<OpenCodeStreamChunk[]> {
  const out: OpenCodeStreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

// ── Validation ────────────────────────────────────────────

describe("createOpenCodeSstAdapter — validation", () => {
  it("rejects missing apiKey", () => {
    expect(() =>
      createOpenCodeSstAdapter({} as unknown as OpenCodeSstConfig),
    ).toThrow(/apiKey/);
  });

  it("rejects non-URL baseUrl", () => {
    expect(() =>
      createOpenCodeSstAdapter({ apiKey: "k", baseUrl: "garbage" }),
    ).toThrow(/baseUrl/);
  });

  it("accepts defaults", () => {
    const adapter = createOpenCodeSstAdapter({ apiKey: "k" });
    expect(adapter.id).toBe("opencode-sst");
  });
});

// ── Streaming text ────────────────────────────────────────

describe("query — streaming text", () => {
  it("emits text chunks in order", async () => {
    const fetcher = makeStreamingFetcher([
      {
        choices: [{ delta: { content: "Hello " } }],
      },
      {
        choices: [{ delta: { content: "world!" } }],
      },
      {
        choices: [{ finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]);
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "hi" }));
    const text = chunks.filter((c) => c.type === "text").map((c) => c.content);
    expect(text.join("")).toBe("Hello world!");
    const done = chunks.find((c) => c.type === "done");
    expect(done).toBeDefined();
    expect(done?.tokensUsed).toBe(15);
    expect(done?.usage?.inputTokens).toBe(10);
    expect(done?.usage?.outputTokens).toBe(5);
    expect(done?.stopReason).toBe("stop");
  });

  it("emits thinking chunks from reasoning deltas", async () => {
    const fetcher = makeStreamingFetcher([
      { choices: [{ delta: { reasoning: "let me think..." } }] },
      { choices: [{ delta: { content: "answer" } }] },
      { choices: [{ finish_reason: "stop" }] },
    ]);
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "x" }));
    const thinking = chunks.filter((c) => c.type === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0]?.content).toBe("let me think...");
  });

  it("falls back to 50/50 token split when usage split missing", async () => {
    const fetcher = makeStreamingFetcher([
      { choices: [{ delta: { content: "x" } }] },
      { choices: [{ finish_reason: "stop" }], usage: { total_tokens: 100 } },
    ]);
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "x" }));
    const done = chunks.find((c) => c.type === "done");
    expect(done?.usage?.inputTokens).toBe(50);
    expect(done?.usage?.outputTokens).toBe(50);
  });
});

// ── Tool call reassembly ─────────────────────────────────

describe("query — tool calls", () => {
  it("reassembles split tool-call fragments", async () => {
    const fetcher = makeStreamingFetcher([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  function: { name: "bash", arguments: "" },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"cmd":' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"ls"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ finish_reason: "tool_calls" }] },
    ]);
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "x" }));
    const tool = chunks.find((c) => c.type === "tool_use");
    expect(tool).toBeDefined();
    expect(tool?.toolName).toBe("bash");
    expect(tool?.toolCallId).toBe("call-1");
    expect(tool?.toolInput).toEqual({ cmd: "ls" });
  });

  it("emits error on malformed tool-call JSON", async () => {
    const fetcher = makeStreamingFetcher([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c1",
                  function: { name: "broken", arguments: "not-json" },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ finish_reason: "tool_calls" }] },
    ]);
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "x" }));
    const err = chunks.find((c) => c.type === "error");
    expect(err).toBeDefined();
    expect(err?.content).toContain("malformed tool arguments");
  });
});

// ── Transport + HTTP errors ──────────────────────────────

describe("query — error paths", () => {
  it("surfaces transport errors as error chunks", async () => {
    const fetcher: OpenCodeFetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "x" }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe("error");
    expect(chunks[0]?.content).toContain("ECONNREFUSED");
  });

  it("surfaces HTTP 401 as error chunk", async () => {
    const fetcher: OpenCodeFetcher = async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
      json: async () => ({}),
      body: null,
    });
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "x" }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe("error");
    expect(chunks[0]?.content).toContain("401");
  });

  it("surfaces empty body as error chunk", async () => {
    const fetcher: OpenCodeFetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => null,
      body: null,
    });
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const chunks = await collectChunks(adapter.query({ prompt: "x" }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe("error");
    expect(chunks[0]?.content).toContain("empty response body");
  });
});

// ── Request shape ────────────────────────────────────────

describe("query — request shape", () => {
  it("forwards tools as OpenAI-compat function schema", async () => {
    let capturedBody = "";
    const fetcher: OpenCodeFetcher = async (_url, init) => {
      capturedBody = init.body ?? "";
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => null,
        body: sseReadableStream(
          toSseBody([{ choices: [{ finish_reason: "stop" }] }]),
        ),
      };
    };
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    await collectChunks(
      adapter.query({
        prompt: "x",
        tools: [
          {
            name: "bash",
            description: "run shell",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
    );
    const body = JSON.parse(capturedBody);
    expect(body.tools).toBeDefined();
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("bash");
    expect(body.tool_choice).toBe("auto");
  });

  it("sends Authorization bearer header", async () => {
    let headers: Record<string, string> = {};
    const fetcher: OpenCodeFetcher = async (_url, init) => {
      headers = init.headers;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => null,
        body: sseReadableStream(
          toSseBody([{ choices: [{ finish_reason: "stop" }] }]),
        ),
      };
    };
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher, apiKey: "secret" }));
    await collectChunks(adapter.query({ prompt: "x" }));
    expect(headers["Authorization"]).toBe("Bearer secret");
  });

  it("forwards extra headers", async () => {
    let headers: Record<string, string> = {};
    const fetcher: OpenCodeFetcher = async (_url, init) => {
      headers = init.headers;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => null,
        body: sseReadableStream(
          toSseBody([{ choices: [{ finish_reason: "stop" }] }]),
        ),
      };
    };
    const adapter = createOpenCodeSstAdapter(
      baseConfig({ fetcher, headers: { "X-Custom": "value" } }),
    );
    await collectChunks(adapter.query({ prompt: "x" }));
    expect(headers["X-Custom"]).toBe("value");
  });
});

// ── listModels ───────────────────────────────────────────

describe("listModels", () => {
  it("extracts ids from OpenAI-compat /v1/models response", async () => {
    const fetcher = makeJsonFetcher(200, {
      data: [
        { id: "claude-sonnet-4" },
        { id: "gpt-5.4" },
        { id: "local-ollama" },
      ],
    });
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const models = await adapter.listModels();
    expect(models).toContain("claude-sonnet-4");
    expect(models).toContain("gpt-5.4");
  });

  it("returns default model on HTTP error", async () => {
    const fetcher = makeJsonFetcher(500, {});
    const adapter = createOpenCodeSstAdapter(
      baseConfig({ fetcher, defaultModel: "my-default" }),
    );
    const models = await adapter.listModels();
    expect(models).toEqual(["my-default"]);
  });

  it("returns default on transport error", async () => {
    const fetcher: OpenCodeFetcher = async () => {
      throw new Error("network down");
    };
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    const models = await adapter.listModels();
    expect(models.length).toBeGreaterThan(0);
  });
});

// ── isAvailable ──────────────────────────────────────────

describe("isAvailable", () => {
  it("returns true on healthy response", async () => {
    const fetcher = makeJsonFetcher(200, { status: "ok" });
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    expect(await adapter.isAvailable()).toBe(true);
  });

  it("returns false on 500", async () => {
    const fetcher = makeJsonFetcher(500, {});
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("returns false on transport error", async () => {
    const fetcher: OpenCodeFetcher = async () => {
      throw new Error("x");
    };
    const adapter = createOpenCodeSstAdapter(baseConfig({ fetcher }));
    expect(await adapter.isAvailable()).toBe(false);
  });
});

// ── Per-adapter isolation ────────────────────────────────

describe("per-adapter isolation", () => {
  it("returns independent adapter instances", () => {
    const a = createOpenCodeSstAdapter({ apiKey: "k1" });
    const b = createOpenCodeSstAdapter({ apiKey: "k2" });
    expect(a).not.toBe(b);
    expect(a.id).toBe("opencode-sst");
    expect(b.id).toBe("opencode-sst");
  });
});
