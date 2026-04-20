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
import { createBedrockAdapter } from "../../src/providers/bedrock-signer.js";
import { createVertexAdapter } from "../../src/providers/vertex-oauth.js";
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
      model: "claude-sonnet-4-6",
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

// ── Bedrock: tools[] on the Converse request body ──────────────────

describe("wire-level tools serialization — Bedrock Converse", () => {
  const originalFetch = globalThis.fetch;
  const captured: { value?: unknown } = {};

  beforeEach(() => {
    process.env["AWS_ACCESS_KEY_ID"] = "AKIA_TEST";
    process.env["AWS_SECRET_ACCESS_KEY"] = "secret_test";
    process.env["AWS_REGION"] = "us-east-1";
    captured.value = undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.body && init.method === "POST") {
        try {
          captured.value = JSON.parse(init.body as string);
        } catch {
          captured.value = init.body;
        }
      }
      const body = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];
    delete process.env["AWS_SESSION_TOKEN"];
    delete process.env["AWS_REGION"];
    vi.restoreAllMocks();
  });

  it("bedrock: toolConfig.tools[] present with toolSpec.inputSchema.json shape", async () => {
    // The Bedrock Converse wire wraps the tool array under `toolConfig.tools`,
    // and each tool is `{ toolSpec: { name, description, inputSchema: { json } } }`.
    // The schema pass-through MUST land verbatim under `inputSchema.json`,
    // not re-serialized into a different shape.
    const adapter = createBedrockAdapter({
      provider: "bedrock",
      token: "t",
      models: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    });
    const echoSchema: ToolSchema["inputSchema"] = {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    };
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      tools: [{ name: "echo", description: "Echo back", inputSchema: echoSchema }],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as {
      toolConfig?: {
        tools?: readonly {
          toolSpec?: {
            name?: string;
            description?: string;
            inputSchema?: { json?: Record<string, unknown> };
          };
        }[];
      };
    };
    expect(Array.isArray(body.toolConfig?.tools)).toBe(true);
    expect(body.toolConfig?.tools?.length).toBe(1);
    const spec = body.toolConfig?.tools?.[0]?.toolSpec;
    expect(spec?.name).toBe("echo");
    expect(spec?.description).toBe("Echo back");
    // Schema pass-through: the inner .json must match the caller's
    // inputSchema verbatim — no key renames, no ordering changes.
    expect(spec?.inputSchema?.json).toEqual(echoSchema);
  });

  it("bedrock: $ref in tool schema throws before hitting the wire", async () => {
    // Shared-serializer $ref guard is the reason the Bedrock adapter now
    // routes through toBedrockTools — a regression where the guard is
    // bypassed would silently emit a request that Bedrock rejects with
    // an opaque 400. This test asserts the rejection happens locally.
    const adapter = createBedrockAdapter({
      provider: "bedrock",
      token: "t",
      models: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    });
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
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
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

// ── Vertex AI: tools[] on the streamRawPredict request body ────────

describe("wire-level tools serialization — Vertex AI", () => {
  const originalFetch = globalThis.fetch;
  const captured: { value?: unknown } = {};
  let saPath = "";

  beforeEach(() => {
    // Vertex signs a JWT before the token exchange, so we need a real
    // RSA key in a service-account JSON. Generated fresh per test.
    const {
      generateKeyPairSync,
    } = require("node:crypto") as typeof import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const dir = mkdtempSync(join(tmpdir(), "wotann-vertex-wirelevel-"));
    saPath = join(dir, "sa.json");
    writeFileSync(
      saPath,
      JSON.stringify({
        client_email: "test@vertex-test.iam.gserviceaccount.com",
        private_key: pem,
        project_id: "vertex-test",
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    );
    process.env["GOOGLE_APPLICATION_CREDENTIALS"] = saPath;
    process.env["GOOGLE_CLOUD_PROJECT"] = "vertex-test";
    process.env["GOOGLE_CLOUD_REGION"] = "us-central1";
    captured.value = undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      // Token exchange: respond with a fake access token.
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "ya29.FAKE_TOKEN", expires_in: 3600 }),
          text: async () => "",
        } as unknown as Response;
      }
      // Predict endpoint: capture the body.
      if (init?.body) {
        try {
          captured.value = JSON.parse(init.body as string);
        } catch {
          captured.value = init.body;
        }
      }
      const body = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["GOOGLE_APPLICATION_CREDENTIALS"];
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    delete process.env["GOOGLE_CLOUD_REGION"];
    vi.restoreAllMocks();
    // Best-effort temp cleanup — we don't fail the test if unlink fails
    // since the OS cleans tmpdir eventually.
    try {
      readFileSync(saPath);
    } catch {
      /* already gone */
    }
  });

  it("vertex: tools[] present with Anthropic input_schema shape", async () => {
    // Vertex Claude speaks Anthropic's wire. toVertexTools delegates to
    // toAnthropicTools, so the wire body is exactly the Anthropic
    // { name, description, input_schema } trio — verified here.
    const adapter = createVertexAdapter({
      provider: "vertex",
      token: "unused",
      models: ["claude-3-5-sonnet@20241022"],
    });
    const schema: ToolSchema["inputSchema"] = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "claude-3-5-sonnet@20241022",
      tools: [{ name: "get_weather", description: "Weather fetch", inputSchema: schema }],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as {
      tools?: readonly {
        name?: string;
        description?: string;
        input_schema?: Record<string, unknown>;
      }[];
    };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools?.length).toBe(1);
    const tool = body.tools?.[0];
    expect(tool?.name).toBe("get_weather");
    expect(tool?.description).toBe("Weather fetch");
    expect(tool?.input_schema).toEqual(schema);
  });
});

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
    // Schema pass-through: exact structural equality with the caller's
    // inputSchema. A regression that e.g. strips `required` or mutates
    // `type: "object"` would fail here.
    expect(tool?.function?.parameters).toEqual(schema);
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
