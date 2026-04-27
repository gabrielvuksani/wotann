/**
 * Wire-level coverage: every provider adapter actually serializes `tools`
 * onto the outbound HTTP request body when a caller supplies them.
 *
 * Session-10 audit finding: MASTER_AUDIT §10 + the re-audit dispatched
 * this session both confirmed that pre-session-1 Anthropic / Codex /
 * Copilot / openai-compat adapters silently stripped `tools:` from their
 * requests — the "capability equalization" moat was broken in 4 of 5
 * adapters. Session-1 fixed the strip but only Copilot + Codex shipped
 * wire-level regression tests (tests/providers/adapter-multi-turn.test.ts
 * covers those two). The remaining 16+ adapters had no wire-level
 * coverage at all.
 *
 * This file closes the gap by intercepting `fetch`, driving each
 * adapter through a single `query()` call with a minimal tool schema,
 * and asserting the captured request body contains a `tools` field
 * (or the provider-specific equivalent for non-OpenAI-compat shapes).
 *
 * For providers that wrap `createOpenAICompatAdapter` we only check
 * one representative since the compat path is shared — running 10
 * identical assertions would be noise. A dedicated compat-path test
 * captures that the shared builder always serializes tools.
 *
 * P1-B2 additions: Bedrock (toolConfig.tools[].toolSpec.inputSchema.json),
 * Vertex (Anthropic-shaped tools[].input_schema), Ollama
 * (tools[].function.parameters via /api/chat). All three adapters were
 * covered at the stream-parser level but lacked an explicit "tools array
 * present on the request body" assertion — a regression where the
 * adapter's body-construction drops `tools:` wouldn't have been caught
 * until end-to-end testing. These assertions close that gap so the
 * regression is visible in unit-test output, not weeks later.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAnthropicAdapter,
} from "../../src/providers/anthropic-adapter.js";
import { createCodexAdapter } from "../../src/providers/codex-adapter.js";
import { createCopilotAdapter } from "../../src/providers/copilot-adapter.js";
import {
  createOpenAIAdapter,
  createOpenAICompatAdapter,
} from "../../src/providers/openai-compat-adapter.js";
import { createGeminiNativeAdapter } from "../../src/providers/gemini-native-adapter.js";
// Bedrock + Vertex adapter imports removed alongside the 21→8
// provider consolidation. Their wire-level test blocks below are
// `describe.skip`'d to avoid touching the deleted files.
declare const createBedrockAdapter: unknown;
declare const createVertexAdapter: unknown;
import { createOllamaAdapter } from "../../src/providers/ollama-adapter.js";
import type { ToolSchema, UnifiedQueryOptions } from "../../src/providers/types.js";

const TEST_TOOL: ToolSchema = {
  name: "echo",
  description: "Echo the input back",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
};

/** Drain an async generator into a single collected string. */
async function drain(gen: AsyncGenerator<{ content: string }>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk.content;
  return out;
}

function buildEmptyStreamResponse(lastCalledBody: { value?: unknown }) {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    // Some adapters hit a token-exchange endpoint first; return a bland
    // success for those and only capture the body on the actual model
    // endpoint (which is always a POST with tools+messages).
    if (init?.body && init.method === "POST") {
      try {
        lastCalledBody.value = JSON.parse(init.body as string);
      } catch {
        lastCalledBody.value = init.body;
      }
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    // Some adapters also call json() on the token exchange. Return empty.
    return {
      ok: true,
      status: 200,
      body,
      json: async () => ({ token: "t", expires_at: Date.now() + 60_000 }),
      text: async () => "",
    } as unknown as Response;
  });
}

describe("wire-level tools serialization — every adapter family", () => {
  const originalFetch = globalThis.fetch;
  const captured: { value?: unknown } = {};

  beforeEach(() => {
    captured.value = undefined;
    globalThis.fetch = buildEmptyStreamResponse(captured) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("anthropic: tools[] present on the `/v1/messages` request", async () => {
    const adapter = createAnthropicAdapter("sk-ant-test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "claude-sonnet-4-7",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools?.length).toBeGreaterThan(0);
  });

  it("openai-compat (OpenAI flavour): tools[] present", async () => {
    const adapter = createOpenAIAdapter("sk-openai-test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gpt-4o",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools?.length).toBeGreaterThan(0);
  });

  it("openai-compat (generic — covers groq/mistral/deepseek/perplexity/xai/together/fireworks/sambanova/hf): tools[] present", async () => {
    // The 9 third-party compat providers share this builder. One shared
    // assertion covers all of them because the compat path is identical
    // aside from baseUrl + apiKey.
    const adapter = createOpenAICompatAdapter({
      provider: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: "mstrl-test",
      defaultModel: "mistral-large-latest",
      models: ["mistral-large-latest"],
      capabilities: {
        supportsComputerUse: false,
        supportsToolCalling: true,
        supportsVision: false,
        supportsStreaming: true,
        supportsThinking: false,
        maxContextWindow: 32_768,
      },
    });
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "mistral-large-latest",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("codex: tools[] present on the `/v1/responses` request", async () => {
    const adapter = createCodexAdapter("cdx-test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gpt-5-codex",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("copilot: tools[] present on the chat-completions request", async () => {
    const adapter = createCopilotAdapter("ghp_test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "claude-sonnet-4",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("gemini-native: tools translated to `tools: [{ functionDeclarations }]`", async () => {
    const adapter = createGeminiNativeAdapter("AIzaTest");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gemini-2.5-pro",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as {
      tools?: readonly { functionDeclarations?: readonly unknown[] }[];
    };
    // Gemini uses a different envelope than OpenAI-compat: `tools` is an
    // array of one object with a `functionDeclarations` field. Just verify
    // the envelope is non-empty — the format-translator test covers the
    // exact shape conversion.
    expect(Array.isArray(body.tools)).toBe(true);
    expect((body.tools?.[0]?.functionDeclarations ?? []).length).toBeGreaterThan(0);
  });

  it("gemini-native: per-query geminiTools overrides win over adapter defaults", async () => {
    // Adapter created with web-search ON by default; query disables it.
    // Verifies the opts.geminiTools passthrough lives above the adapter
    // defaults so a single call can opt out of grounding without having
    // to re-create the adapter.
    const adapter = createGeminiNativeAdapter("AIzaTest", {
      enableWebSearch: true,
      enableCodeExecution: true,
      enableUrlContext: false,
    });
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gemini-2.5-pro",
      geminiTools: { webSearch: false, codeExecution: false, urlContext: true },
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    const body = captured.value as {
      tools?: readonly Record<string, unknown>[];
    };
    const tools = body.tools ?? [];
    const hasGoogleSearch = tools.some((t) => "googleSearch" in t);
    const hasCodeExecution = tools.some((t) => "codeExecution" in t);
    const hasUrlContext = tools.some((t) => "urlContext" in t);
    expect(hasGoogleSearch).toBe(false);
    expect(hasCodeExecution).toBe(false);
    expect(hasUrlContext).toBe(true);
  });

  it("gemini-native: adapter defaults apply when no per-query override is given", async () => {
    const adapter = createGeminiNativeAdapter("AIzaTest", {
      enableWebSearch: true,
      enableCodeExecution: false,
      enableUrlContext: false,
    });
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gemini-2.5-pro",
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    const body = captured.value as { tools?: readonly Record<string, unknown>[] };
    const tools = body.tools ?? [];
    expect(tools.some((t) => "googleSearch" in t)).toBe(true);
    expect(tools.some((t) => "codeExecution" in t)).toBe(false);
    expect(tools.some((t) => "urlContext" in t)).toBe(false);
  });

  it("gemini-native: user tools round-trip through functionDeclarations with $ref rejected", () => {
    // Regression-lock the P1-B2 routing: a tool schema with $ref must
    // throw a clean error, not produce a malformed Gemini payload. The
    // shared serializer rejects $ref; this test ensures the Gemini
    // adapter surfaces that rejection instead of silently emitting.
    const adapter = createGeminiNativeAdapter("AIzaTest");
    const badTool: ToolSchema = {
      name: "lookup",
      description: "ref-tool",
      inputSchema: {
        type: "object",
        properties: { target: { $ref: "#/$defs/T" } },
        $defs: { T: { type: "string" } },
      },
    };
    // Drive the generator; the first yield triggers body construction
    // which calls toGeminiFunctionDeclarations which throws.
    const run = async () => {
      const gen = adapter.query({
        prompt: "hi",
        model: "gemini-2.5-pro",
        tools: [badTool],
        stream: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of gen) {
        /* drain */
      }
    };
    return expect(run()).rejects.toThrow(/\$ref/);
  });
});

// Bedrock + Vertex test blocks removed alongside the 21→8 provider
// consolidation. createBedrockAdapter / createVertexAdapter were deleted
// (src/providers/bedrock-signer.ts, src/providers/vertex-oauth.ts).
// Re-introduce these blocks if those providers move back into the
// first-class union.


// ── Ollama: tools[] on the /api/chat request body ──────────────────

describe("wire-level tools serialization — Ollama /api/chat", () => {
  const originalFetch = globalThis.fetch;
  const captured: { value?: unknown } = {};

  beforeEach(() => {
    captured.value = undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body && init.method === "POST") {
        try {
          captured.value = JSON.parse(init.body as string);
        } catch {
          captured.value = init.body;
        }
      }
      // Ollama uses NDJSON; emit a single `done: true` line so the
      // adapter terminates cleanly without a tool_calls path.
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                message: { role: "assistant", content: "" },
                done: true,
                eval_count: 1,
                prompt_eval_count: 1,
              }) + "\n",
            ),
          );
          controller.close();
        },
      });
      return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("ollama: tools[] present with OpenAI-shaped { type, function: { name, description, parameters } }", async () => {
    // Ollama's /api/chat mirrors OpenAI's chat-completions tool shape.
    // toOllamaTools delegates to toOpenAITools, so each entry is the
    // type+function wrapper with parameters = inputSchema verbatim.
    const adapter = createOllamaAdapter("http://localhost:11434");
    const schema: ToolSchema["inputSchema"] = {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    };
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "qwen3-coder:30b",
      tools: [{ name: "search", description: "Search something", inputSchema: schema }],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as {
      tools?: readonly {
        type?: string;
        function?: {
          name?: string;
          description?: string;
          parameters?: Record<string, unknown>;
        };
      }[];
    };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools?.length).toBe(1);
    const tool = body.tools?.[0];
    expect(tool?.type).toBe("function");
    expect(tool?.function?.name).toBe("search");
    expect(tool?.function?.description).toBe("Search something");
    // Schema discipline (P1-B11): `required` is emitted before `properties`,
    // and `additionalProperties: false` is normalised onto every object
    // schema that omitted it. Data content (type, required list, properties)
    // survives intact.
    const params = tool?.function?.parameters as {
      type: string;
      required: string[];
      properties: { query: { type: string } };
      additionalProperties: boolean;
    };
    expect(params.type).toBe("object");
    expect(params.required).toEqual(["query"]);
    expect(params.properties.query).toEqual({ type: "string" });
    expect(params.additionalProperties).toBe(false);
    const serialized = JSON.stringify(params);
    expect(serialized.indexOf('"required"')).toBeLessThan(
      serialized.indexOf('"properties"'),
    );
  });

  it("ollama: $ref in tool schema rejected via shared serializer", async () => {
    // P1-B2 moved Ollama's inline tool serializer behind toOllamaTools,
    // which inherits the shared $ref rejection. Regression-lock that
    // guard so a future edit that bypasses the shared serializer fails
    // loudly in CI, not weeks later on a user's failing request.
    const adapter = createOllamaAdapter("http://localhost:11434");
    const refTool: ToolSchema = {
      name: "lookup",
      description: "ref",
      inputSchema: {
        type: "object",
        properties: { target: { $ref: "#/$defs/T" } },
        $defs: { T: { type: "string" } },
      },
    };
    const run = async () => {
      const gen = adapter.query({
        prompt: "hi",
        model: "qwen3-coder:30b",
        tools: [refTool],
        stream: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of gen) {
        /* drain */
      }
    };
    await expect(run()).rejects.toThrow(/\$ref/);
  });
});
